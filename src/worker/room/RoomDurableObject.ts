import { DurableObject } from "cloudflare:workers";
import { CloseCode } from "../../shared/constants";
import {
  type ClientMessage,
  type ErrorCode,
  parseClientMessage,
  type ServerMessage,
} from "../../shared/protocol";
import { closedSocketResponse } from "../closedSocket";
import { actorFor, type Change, createRoom, handle, joinRoom } from "./commands";
import { SocketRateLimiter } from "./rateLimit";
import { migrate } from "./schema";
import { RoomStore } from "./store";
import { project, snapshot, type ViewContext } from "./views";

export type InitResult = "created" | "exists";

type Attachment = { clientId: string | null };

const MAX_FRAME_CHARS = 8 * 1024;

const ERROR_MESSAGES: Record<"invalid_message" | "too_long" | "empty" | "rate_limited", string> = {
  invalid_message: "Invalid message",
  too_long: "Text is too long",
  empty: "Text is empty",
  rate_limited: "Too many messages, slow down",
};

export class RoomDurableObject extends DurableObject<Env> {
  readonly #store: RoomStore;
  readonly #limiters = new Map<WebSocket, SocketRateLimiter>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    this.#store = new RoomStore(ctx.storage);
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

  override async fetch(_request: Request): Promise<Response> {
    if (!this.#isLive(Date.now()))
      return closedSocketResponse(CloseCode.NotFound, "Room not found");
    const { 0: client, 1: server } = new WebSocketPair();
    this.ctx.acceptWebSocket(server);
    server.serializeAttachment({ clientId: null } satisfies Attachment);
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
    ws.serializeAttachment({ clientId: message.clientId } satisfies Attachment);
    const viewer = actorFor(this.#store, message.clientId);
    send(ws, { type: "snapshot", room: snapshot(this.#store, viewer, this.#viewContext(now)) });
    this.#broadcast(joined.changes, now);
    if (message.reqId !== undefined) send(ws, { type: "ack", reqId: message.reqId });
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
    return { now, connectedClientIds: new Set(clientIds) };
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

function reqIdOf(parsed: ReturnType<typeof parseClientMessage> | null): string | undefined {
  if (!parsed) return undefined;
  return parsed.ok ? parsed.message.reqId : parsed.reqId;
}
