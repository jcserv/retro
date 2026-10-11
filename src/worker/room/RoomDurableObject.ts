import { DurableObject } from "cloudflare:workers";
import { AI, CloseCode } from "../../shared/constants";
import {
  type ClientMessage,
  type ErrorCode,
  parseClientMessage,
  type ServerMessage,
} from "../../shared/protocol";
import { utcDay } from "../ai/AiBudget";
import { type Suggester, suggesterFor } from "../ai/suggester";
import { closedSocketResponse } from "../closedSocket";
import { actorFor, type Change, createRoom, handle, joinRoom } from "./commands";
import { SocketRateLimiter } from "./rateLimit";
import { migrate } from "./schema";
import { RoomStore } from "./store";
import { completeSuggestion, type ModelOutput, prepareSuggestion } from "./suggestions";
import { project, snapshot, type ViewContext } from "./views";

export type InitResult = "created" | "exists";

type Attachment = { clientId: string | null; ip: string };

const MAX_FRAME_CHARS = 8 * 1024;

const ERROR_MESSAGES = {
  invalid_message: "Invalid message",
  too_long: "Text is too long",
  empty: "Text is empty",
  rate_limited: "Too many messages, slow down",
  not_found: "Room not found",
  forbidden: "Only the owner can do that",
  wrong_phase: "Suggestions are only available while grouping",
  suggest_busy: "Wait a moment before asking for suggestions again",
  suggest_room_limit: "This room has used all of its AI suggestions",
  suggest_rate_limited: "Too many suggestion requests, try again in a minute",
  suggest_daily_limit: "AI suggestions are used up for today",
  suggest_too_large: "Too many items for suggestions",
  suggest_ineligible: "Nothing left to group",
  suggest_failed: "Couldn't get suggestions, try again",
  suggest_unavailable: "AI suggestions are not available",
} satisfies Partial<Record<ErrorCode, string>>;

export class RoomDurableObject extends DurableObject<Env> {
  readonly #store: RoomStore;
  readonly #limiters = new Map<WebSocket, SocketRateLimiter>();
  readonly #suggester: Suggester | null;

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#store = new RoomStore(ctx.storage);
    this.#suggester = suggesterFor(env);
    ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    void ctx.blockConcurrencyWhile(async () => migrate(ctx.storage.sql));
  }

  async init(params: { code: string; ownerClientId: string; now: number }): Promise<InitResult> {
    const room = this.#store.getRoom();
    if (room && params.now < room.expiresAt) return "exists";
    if (room) await this.#wipe(CloseCode.Expired);
    createRoom(this.#store, params);
    await this.ctx.storage.setAlarm(this.#store.getRoom()?.expiresAt ?? params.now);
    return "created";
  }

  exists(): boolean {
    return this.#isLive(Date.now());
  }

  override async fetch(request: Request): Promise<Response> {
    if (!this.#isLive(Date.now()))
      return closedSocketResponse(CloseCode.NotFound, "Room not found");
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
    server.serializeAttachment({ clientId: null, ip } satisfies Attachment);
    return new Response(null, { status: 101, webSocket: client });
  }

  override async webSocketMessage(ws: WebSocket, data: string | ArrayBuffer): Promise<void> {
    if (ws.readyState !== WebSocket.OPEN) return;
    const now = Date.now();
    const decision = this.#limiterFor(ws, now).consume(now);
    if (decision === "close") {
      this.#close(ws, CloseCode.RateLimited, "Rate limited");
      return;
    }
    const raw = typeof data === "string" && data.length <= MAX_FRAME_CHARS ? data : null;
    const parsed = raw === null ? null : parseClientMessage(raw);
    const clientId = this.#clientIdOf(ws);

    if (!this.#isLive(now)) {
      this.#close(ws, CloseCode.Expired, "Room expired");
      return;
    }
    if (decision === "reject") {
      this.#sendError(ws, "rate_limited", ERROR_MESSAGES.rate_limited, reqIdOf(parsed));
      return;
    }
    if (clientId === null) {
      if (parsed?.ok && parsed.message.type === "hello") {
        this.#hello(ws, parsed.message, now);
      } else {
        this.#close(ws, CloseCode.Unauthenticated, "Expected hello");
      }
      return;
    }
    if (!parsed?.ok) {
      const code = parsed?.code ?? "invalid_message";
      this.#sendError(ws, code, ERROR_MESSAGES[code], parsed?.reqId);
      return;
    }
    const message = parsed.message;
    if (message.type === "hello") {
      this.#sendError(ws, "invalid_message", "Already said hello", message.reqId);
      return;
    }
    if (message.type === "suggestGroups") {
      await this.#suggest(ws, clientId, message.reqId, now);
      return;
    }
    const result = handle(this.#store, actorFor(this.#store, clientId), message, now);
    if (!result.ok) {
      this.#sendError(ws, result.code, result.message, message.reqId);
      return;
    }
    this.#broadcast(result.changes, now);
    if (message.reqId !== undefined) send(ws, { type: "ack", reqId: message.reqId });
  }

  override async webSocketClose(ws: WebSocket, code: number, reason: string): Promise<void> {
    this.#close(ws, code, reason);
    this.#disconnected(ws);
  }

  override async webSocketError(ws: WebSocket): Promise<void> {
    this.#disconnected(ws);
  }

  override async alarm(): Promise<void> {
    await this.#wipe(CloseCode.Expired);
  }

  #hello(ws: WebSocket, message: Extract<ClientMessage, { type: "hello" }>, now: number): void {
    const joined = joinRoom(this.#store, message.clientId, now);
    if (!joined.ok) {
      this.#close(ws, CloseCode.RoomFull, "Room is full");
      return;
    }
    ws.serializeAttachment({ clientId: message.clientId, ip: this.#ipOf(ws) } satisfies Attachment);
    const viewer = actorFor(this.#store, message.clientId);
    send(ws, { type: "snapshot", room: snapshot(this.#store, viewer, this.#viewContext(now)) });
    this.#broadcast(joined.changes, now);
    if (message.reqId !== undefined) send(ws, { type: "ack", reqId: message.reqId });
  }

  async #suggest(
    ws: WebSocket,
    clientId: string,
    reqId: string | undefined,
    now: number,
  ): Promise<void> {
    const suggester = this.#suggester;
    const actor = actorFor(this.#store, clientId);
    const prepared = prepareSuggestion(this.#store, actor, now, suggester !== null);
    if (!prepared.ok || !suggester) {
      const code = prepared.ok ? "suggest_unavailable" : prepared.code;
      this.#sendError(ws, code, messageFor(code), reqId);
      return;
    }

    const denied = await this.#spendBudget(this.#ipOf(ws), now);
    if (denied) {
      this.#store.setAiPending(null);
      this.#sendError(ws, denied, ERROR_MESSAGES[denied], reqId);
      return;
    }
    this.#store.recordAiRun(now);
    if (reqId !== undefined) send(ws, { type: "ack", reqId });
    this.#broadcast([{ kind: "suggestionsChanged" }], now);

    const output = await runWithTimeout(suggester, prepared.input);
    const done = completeSuggestion(this.#store, prepared.idMap, output, crypto.randomUUID());
    const finishedAt = Date.now();
    this.#broadcast([{ kind: "suggestionsChanged" }], finishedAt);
    if (!done.ok) {
      for (const owner of this.#authenticatedSockets()) {
        if (actorFor(this.#store, owner.clientId).isOwner) {
          this.#sendError(owner.ws, done.code, ERROR_MESSAGES[done.code]);
        }
      }
    }
  }

  async #spendBudget(
    ip: string,
    now: number,
  ): Promise<"suggest_rate_limited" | "suggest_daily_limit" | "suggest_failed" | null> {
    try {
      const { success } = await this.env.AI_SUGGEST_LIMITER.limit({ key: ip });
      if (!success) return "suggest_rate_limited";
      const budget = this.env.AI_BUDGET.getByName("global");
      if (!(await budget.reserve(utcDay(now), AI.dailyRequestCap))) return "suggest_daily_limit";
      return null;
    } catch {
      return "suggest_failed";
    }
  }

  #disconnected(ws: WebSocket): void {
    this.#limiters.delete(ws);
    if (this.#clientIdOf(ws) === null || !this.#store.getRoom()) return;
    this.#broadcast([{ kind: "presenceChanged" }], Date.now(), ws);
  }

  async #wipe(code: number): Promise<void> {
    for (const ws of this.ctx.getWebSockets()) this.#close(ws, code, "Room expired");
    await this.ctx.storage.deleteAlarm();
    await this.ctx.storage.deleteAll();
    migrate(this.ctx.storage.sql);
  }

  #isLive(now: number): boolean {
    const room = this.#store.getRoom();
    return room !== null && now < room.expiresAt;
  }

  #limiterFor(ws: WebSocket, now: number): SocketRateLimiter {
    let limiter = this.#limiters.get(ws);
    if (!limiter) {
      limiter = new SocketRateLimiter(now);
      this.#limiters.set(ws, limiter);
    }
    return limiter;
  }

  #clientIdOf(ws: WebSocket): string | null {
    return (ws.deserializeAttachment() as Attachment | null)?.clientId ?? null;
  }

  #ipOf(ws: WebSocket): string {
    return (ws.deserializeAttachment() as Partial<Attachment> | null)?.ip ?? "unknown";
  }

  #authenticatedSockets(exclude?: WebSocket): Array<{ ws: WebSocket; clientId: string }> {
    const sockets: Array<{ ws: WebSocket; clientId: string }> = [];
    for (const ws of this.ctx.getWebSockets()) {
      if (ws === exclude || ws.readyState !== WebSocket.OPEN) continue;
      const clientId = this.#clientIdOf(ws);
      if (clientId !== null) sockets.push({ ws, clientId });
    }
    return sockets;
  }

  #viewContext(now: number, exclude?: WebSocket): ViewContext {
    const clientIds = this.#authenticatedSockets(exclude).map(({ clientId }) => clientId);
    return { now, connectedClientIds: new Set(clientIds), aiEnabled: this.#suggester !== null };
  }

  #broadcast(changes: readonly Change[], now: number, exclude?: WebSocket): void {
    if (changes.length === 0) return;
    const ctx = this.#viewContext(now, exclude);
    for (const { ws, clientId } of this.#authenticatedSockets(exclude)) {
      const viewer = actorFor(this.#store, clientId);
      for (const change of changes) {
        const message = project(this.#store, change, viewer, ctx);
        if (message) send(ws, message);
      }
    }
  }

  #sendError(ws: WebSocket, code: ErrorCode, message: string, reqId?: string): void {
    send(
      ws,
      reqId === undefined
        ? { type: "error", code, message }
        : { type: "error", code, message, reqId },
    );
  }

  #close(ws: WebSocket, code: number, reason: string): void {
    this.#limiters.delete(ws);
    try {
      ws.close(code, reason);
    } catch {}
  }
}

function send(ws: WebSocket, message: ServerMessage): void {
  ws.send(JSON.stringify(message));
}

function messageFor(code: ErrorCode): string {
  return (ERROR_MESSAGES as Partial<Record<ErrorCode, string>>)[code] ?? "Request failed";
}

async function runWithTimeout(
  suggester: Suggester,
  input: Parameters<Suggester>[0],
): Promise<ModelOutput> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new Error("timeout"));
    }, AI.timeoutMs);
  });
  try {
    return { ok: true, value: await Promise.race([suggester(input, controller.signal), timeout]) };
  } catch {
    return { ok: false };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function reqIdOf(parsed: ReturnType<typeof parseClientMessage> | null): string | undefined {
  if (!parsed) return undefined;
  return parsed.ok ? parsed.message.reqId : parsed.reqId;
}
