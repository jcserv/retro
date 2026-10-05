import { exports } from "cloudflare:workers";
import type { RoomSnapshot, ServerMessage } from "../../src/shared/protocol";

type Waiter = { match: (message: ServerMessage) => boolean; resolve: (m: ServerMessage) => void };

export class TestSocket {
  readonly received: ServerMessage[] = [];
  readonly raw: string[] = [];
  readonly closed: Promise<{ code: number; reason: string }>;
  #cursor = 0;
  #waiters: Waiter[] = [];
  #seq = 0;

  constructor(readonly ws: WebSocket) {
    this.closed = new Promise((resolve) => {
      ws.addEventListener("close", (event) => resolve({ code: event.code, reason: event.reason }));
    });
    ws.addEventListener("message", (event) => {
      const data = event.data as string;
      this.raw.push(data);
      if (data === "pong") return;
      const message = JSON.parse(data) as ServerMessage;
      this.received.push(message);
      this.#flush();
    });
  }

  send(message: unknown): void {
    this.ws.send(typeof message === "string" ? message : JSON.stringify(message));
  }

  next<T extends ServerMessage["type"]>(type?: T): Promise<Extract<ServerMessage, { type: T }>> {
    return new Promise((resolve) => {
      this.#waiters.push({
        match: (message) => type === undefined || message.type === type,
        resolve: resolve as (m: ServerMessage) => void,
      });
      this.#flush();
    });
  }

  async request(intent: Record<string, unknown>): Promise<ServerMessage> {
    const reqId = `r${++this.#seq}`;
    this.send({ ...intent, reqId });
    const reply = await this.#until(
      (m) => (m.type === "ack" || m.type === "error") && m.reqId === reqId,
    );
    return reply;
  }

  async ok(intent: Record<string, unknown>): Promise<void> {
    const reply = await this.request(intent);
    if (reply.type !== "ack")
      throw new Error(`${String(intent.type)} failed: ${JSON.stringify(reply)}`);
  }

  async rejects(intent: Record<string, unknown>): Promise<string> {
    const reply = await this.request(intent);
    if (reply.type !== "error") throw new Error(`${String(intent.type)} unexpectedly succeeded`);
    return reply.code;
  }

  async sync(): Promise<void> {
    await this.request({ type: "sync" });
  }

  latest<T extends ServerMessage["type"]>(
    type: T,
  ): Extract<ServerMessage, { type: T }> | undefined {
    return this.received.findLast((m) => m.type === type) as
      | Extract<ServerMessage, { type: T }>
      | undefined;
  }

  close(): void {
    this.ws.close(1000, "done");
  }

  #until(match: (message: ServerMessage) => boolean): Promise<ServerMessage> {
    return new Promise((resolve) => {
      this.#waiters.push({ match, resolve });
      this.#flush();
    });
  }

  #flush(): void {
    while (this.#waiters.length > 0) {
      const waiter = this.#waiters[0] as Waiter;
      const index = this.received.findIndex((m, i) => i >= this.#cursor && waiter.match(m));
      if (index === -1) return;
      this.#cursor = index + 1;
      this.#waiters.shift();
      waiter.resolve(this.received[index] as ServerMessage);
    }
  }
}

export async function openSocket(code: string): Promise<TestSocket> {
  const response = await exports.default.fetch(`https://example.com/ws/${code}`, {
    headers: { Upgrade: "websocket" },
  });
  const ws = response.webSocket;
  if (response.status !== 101 || !ws) throw new Error(`upgrade failed: ${response.status}`);
  ws.accept();
  return new TestSocket(ws);
}

export async function connect(
  code: string,
  clientId: string,
): Promise<{ socket: TestSocket; room: RoomSnapshot }> {
  const socket = await openSocket(code);
  socket.send({ type: "hello", clientId });
  const { room } = await socket.next("snapshot");
  return { socket, room };
}

let ipCounter = 0;

export async function createRoom(clientId: string): Promise<string> {
  const response = await postRoom({ clientId }, `10.0.0.${++ipCounter}`);
  if (response.status !== 201) throw new Error(`createRoom failed: ${response.status}`);
  const { code } = (await response.json()) as { code: string };
  return code;
}

export function postRoom(body: unknown, ip = "192.0.2.1"): Promise<Response> {
  return exports.default.fetch("https://example.com/api/rooms", {
    method: "POST",
    headers: { "Content-Type": "application/json", "CF-Connecting-IP": ip },
    body: JSON.stringify(body),
  });
}
