import type { BrowserContext, WebSocketRoute } from "@playwright/test";
import { DEFAULT_CATEGORIES, LIMITS } from "../../src/shared/constants";
import type { ClientMessage, Phase, RoomSnapshot, ServerMessage } from "../../src/shared/protocol";

type StoredItem = {
  id: string;
  clientId: string;
  categoryId: string;
  text: string;
  createdAt: number;
};
type Client = { ws: WebSocketRoute; clientId: string };

const NEXT_PHASE: Partial<Record<Phase, Phase>> = {
  write: "group",
  group: "vote",
  vote: "discuss",
  discuss: "done",
};

export class FakeRoom {
  readonly code: string;
  readonly received: ClientMessage[] = [];
  phase: Phase = "write";
  voteLimit: number = LIMITS.voteLimitDefault;
  private ownerClientId: string | null = null;
  private readonly participants = new Map<string, { ready: boolean }>();
  private readonly clients = new Set<Client>();
  private readonly items: StoredItem[] = [];
  private readonly createdAt = Date.now();
  private seq = 0;

  constructor(code = "ABC234") {
    this.code = code;
  }

  async attach(context: BrowserContext): Promise<void> {
    await context.routeWebSocket(`**/ws/${this.code}`, (ws) => {
      let client: Client | null = null;
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw)) as ClientMessage;
        this.received.push(msg);
        if (msg.type === "hello") {
          client = { ws, clientId: msg.clientId };
          this.join(client);
        } else if (client) {
          this.handle(client, msg);
        }
      });
      ws.onClose(() => {
        if (!client) return;
        this.clients.delete(client);
        this.broadcastPresence();
      });
    });
  }

  private join(client: Client) {
    this.ownerClientId ??= client.clientId;
    if (!this.participants.has(client.clientId)) {
      this.participants.set(client.clientId, { ready: false });
    }
    this.clients.add(client);
    this.send(client, { type: "snapshot", room: this.snapshotFor(client.clientId) });
    this.broadcastPresence();
  }

  private handle(client: Client, msg: ClientMessage) {
    const reqId = msg.reqId;
    const ack = () => reqId && this.send(client, { type: "ack", reqId });
    const fail = (code: "stale" | "forbidden") =>
      this.send(client, { type: "error", code, message: code, reqId });

    switch (msg.type) {
      case "addItem": {
        const item = {
          id: `item-${++this.seq}`,
          clientId: client.clientId,
          categoryId: msg.categoryId,
          text: msg.text.trim(),
          createdAt: Date.now(),
        };
        this.items.push(item);
        this.sendToAuthor(item, { type: "itemUpserted", item: this.view(item, true) });
        this.broadcastCounts();
        return ack();
      }
      case "editItem": {
        const item = this.items.find((entry) => entry.id === msg.itemId);
        if (item) {
          item.text = msg.text.trim();
          this.sendToAuthor(item, { type: "itemUpserted", item: this.view(item, true) });
        }
        return ack();
      }
      case "deleteItem": {
        const index = this.items.findIndex((entry) => entry.id === msg.itemId);
        const [item] = this.items.splice(index, 1);
        if (item) this.sendToAuthor(item, { type: "itemRemoved", itemId: item.id });
        this.broadcastCounts();
        return ack();
      }
      case "setReady": {
        const participant = this.participants.get(client.clientId);
        if (participant) participant.ready = msg.ready;
        this.sendToClient(client.clientId, { type: "youReady", ready: msg.ready });
        this.broadcastPresence();
        return ack();
      }
      case "setVoteLimit":
        if (client.clientId !== this.ownerClientId) return fail("forbidden");
        this.voteLimit = msg.limit;
        this.broadcast(() => ({ type: "voteLimit", limit: msg.limit }));
        return ack();
      case "advance": {
        if (client.clientId !== this.ownerClientId) return fail("forbidden");
        const next = NEXT_PHASE[this.phase];
        if (msg.from !== this.phase || !next) return fail("stale");
        this.phase = next;
        for (const participant of this.participants.values()) participant.ready = false;
        this.broadcast((clientId) => ({ type: "snapshot", room: this.snapshotFor(clientId) }));
        return ack();
      }
      default:
        return ack();
    }
  }

  private view(item: StoredItem, mine: boolean) {
    return {
      id: item.id,
      categoryId: item.categoryId,
      groupId: this.phase === "write" ? null : `group-${item.id}`,
      text: item.text,
      reactions: [],
      createdAt: item.createdAt,
      ...(mine ? { mine: true as const } : {}),
    };
  }

  private snapshotFor(clientId: string): RoomSnapshot {
    const writing = this.phase === "write";
    const visible = writing ? this.items.filter((item) => item.clientId === clientId) : this.items;
    return {
      code: this.code,
      createdAt: this.createdAt,
      expiresAt: this.createdAt + 24 * 60 * 60_000,
      serverNow: Date.now(),
      phase: this.phase,
      categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
      isOwner: clientId === this.ownerClientId,
      presence: this.presence(),
      youReady: this.participants.get(clientId)?.ready ?? false,
      timer: { kind: "none" },
      voteLimit: this.voteLimit,
      items: visible.map((item) => this.view(item, writing)),
      groups: writing
        ? []
        : this.items.map((item) => ({
            id: `group-${item.id}`,
            categoryId: item.categoryId,
            title: null,
            itemIds: [item.id],
            createdAt: item.createdAt,
          })),
      categoryCounts: this.counts(),
      myVotes: {},
      voteTotals: null,
      discuss: null,
      comments: [],
      actions: [],
    };
  }

  private counts() {
    const counts: Record<string, number> = {};
    for (const category of DEFAULT_CATEGORIES) counts[category.id] = 0;
    for (const item of this.items) counts[item.categoryId] = (counts[item.categoryId] ?? 0) + 1;
    return counts;
  }

  private presence() {
    const connected = new Set([...this.clients].map((client) => client.clientId));
    let readyCount = 0;
    for (const clientId of connected) {
      if (this.participants.get(clientId)?.ready) readyCount += 1;
    }
    return {
      participantCount: this.participants.size,
      connectedCount: connected.size,
      readyCount,
    };
  }

  private broadcastPresence() {
    const presence = this.presence();
    this.broadcast(() => ({ type: "presence", presence }));
  }

  private broadcastCounts() {
    const counts = this.counts();
    this.broadcast(() => ({ type: "categoryCounts", counts }));
  }

  private sendToAuthor(item: StoredItem, msg: ServerMessage) {
    this.sendToClient(item.clientId, msg);
  }

  private sendToClient(clientId: string, msg: ServerMessage) {
    for (const client of this.clients) if (client.clientId === clientId) this.send(client, msg);
  }

  private broadcast(build: (clientId: string) => ServerMessage) {
    for (const client of this.clients) this.send(client, build(client.clientId));
  }

  private send(client: Client, msg: ServerMessage) {
    client.ws.send(JSON.stringify(msg));
  }
}
