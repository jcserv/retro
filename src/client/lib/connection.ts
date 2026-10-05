import { CloseCode } from "../../shared/constants";
import type { ClientMessage, ErrorCode, ServerMessage } from "../../shared/protocol";

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export type Intent = DistributiveOmit<Exclude<ClientMessage, { type: "hello" }>, "reqId">;

export type ConnectionStatus = "connecting" | "open" | "reconnecting" | "not_found" | "full";

export type IntentErrorCode = ErrorCode | "disconnected" | "timeout";

export class IntentError extends Error {
  constructor(
    readonly code: IntentErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "IntentError";
  }
}

export type MessageMeta = { receivedAt: number; helloSentAt: number | null };

export type SocketLike = {
  readonly readyState: number;
  onopen: ((event: Event) => void) | null;
  onmessage: ((event: MessageEvent) => void) | null;
  onclose: ((event: CloseEvent) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
};

export type ConnectionOptions = {
  code: string;
  clientId: string;
  onMessage: (msg: ServerMessage, meta: MessageMeta) => void;
  onStatus: (status: ConnectionStatus) => void;
  url?: string;
  createSocket?: (url: string) => SocketLike;
  subscribeWake?: (wake: () => void) => () => void;
  random?: () => number;
};

export const REQUEST_TIMEOUT_MS = 10_000;
export const PING_INTERVAL_MS = 30_000;
export const BACKOFF_MIN_MS = 500;
export const BACKOFF_MAX_MS = 10_000;

const SOCKET_OPEN = 1;

const TERMINAL_CLOSES: Partial<Record<number, ConnectionStatus>> = {
  [CloseCode.NotFound]: "not_found",
  [CloseCode.Expired]: "not_found",
  [CloseCode.RoomFull]: "full",
};

export function backoffDelay(attempt: number, random: () => number): number {
  const ceiling = Math.min(BACKOFF_MAX_MS, BACKOFF_MIN_MS * 2 ** attempt);
  return BACKOFF_MIN_MS + random() * (ceiling - BACKOFF_MIN_MS);
}

export function roomSocketUrl(code: string, location: Pick<Location, "protocol" | "host">): string {
  const scheme = location.protocol === "https:" ? "wss:" : "ws:";
  return `${scheme}//${location.host}/ws/${encodeURIComponent(code)}`;
}

function browserWake(wake: () => void): () => void {
  const onVisibility = () => {
    if (document.visibilityState === "visible") wake();
  };
  window.addEventListener("online", wake);
  document.addEventListener("visibilitychange", onVisibility);
  return () => {
    window.removeEventListener("online", wake);
    document.removeEventListener("visibilitychange", onVisibility);
  };
}

type Pending = {
  resolve: () => void;
  reject: (error: IntentError) => void;
  timeout: ReturnType<typeof setTimeout>;
};

export class RoomConnection {
  private socket: SocketLike | null = null;
  private status: ConnectionStatus | null = null;
  private attempt = 0;
  private synced = false;
  private helloSentAt: number | null = null;
  private retryTimer: ReturnType<typeof setTimeout> | null = null;
  private pingTimer: ReturnType<typeof setInterval> | null = null;
  private unsubscribeWake: (() => void) | null = null;
  private disposed = false;
  private readonly pending = new Map<string, Pending>();
  private readonly createSocket: (url: string) => SocketLike;
  private readonly random: () => number;

  constructor(private readonly options: ConnectionOptions) {
    this.createSocket = options.createSocket ?? ((url) => new WebSocket(url));
    this.random = options.random ?? Math.random;
  }

  connect(): void {
    if (this.disposed || this.socket) return;
    this.unsubscribeWake ??= (this.options.subscribeWake ?? browserWake)(() => this.wake());
    this.open();
  }

  send(intent: Intent, reqId: string = crypto.randomUUID()): Promise<void> {
    const socket = this.socket;
    if (!socket || !this.synced || socket.readyState !== SOCKET_OPEN) {
      return Promise.reject(new IntentError("disconnected", "Not connected to the room"));
    }
    return new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(reqId);
        reject(new IntentError("timeout", "The server did not respond in time"));
      }, REQUEST_TIMEOUT_MS);
      this.pending.set(reqId, { resolve, reject, timeout });
      socket.send(JSON.stringify({ ...intent, reqId }));
    });
  }

  dispose(): void {
    this.disposed = true;
    this.unsubscribeWake?.();
    this.unsubscribeWake = null;
    this.clearTimers();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      this.detach(socket);
      socket.close(1000, "dispose");
    }
    this.rejectAllPending();
  }

  private open(): void {
    this.setStatus(this.status === null ? "connecting" : "reconnecting");
    const url = this.options.url ?? roomSocketUrl(this.options.code, location);
    const socket = this.createSocket(url);
    this.socket = socket;
    this.synced = false;
    socket.onopen = () => {
      this.helloSentAt = Date.now();
      socket.send(JSON.stringify({ type: "hello", clientId: this.options.clientId }));
      this.pingTimer = setInterval(() => socket.send("ping"), PING_INTERVAL_MS);
    };
    socket.onmessage = (event) => this.receive(event.data);
    socket.onclose = (event) => this.handleClose(socket, event.code);
  }

  private receive(data: unknown): void {
    if (typeof data !== "string" || data === "pong") return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data) as ServerMessage;
    } catch {
      return;
    }
    if (msg.type === "snapshot" && !this.synced) {
      this.synced = true;
      this.attempt = 0;
      this.setStatus("open");
    }
    this.options.onMessage(msg, {
      receivedAt: Date.now(),
      helloSentAt: msg.type === "snapshot" ? this.helloSentAt : null,
    });
    if (msg.type === "snapshot") this.helloSentAt = null;
    if (msg.type === "ack") this.settle(msg.reqId);
    if (msg.type === "error" && msg.reqId) {
      this.settle(msg.reqId, new IntentError(msg.code, msg.message));
    }
  }

  private settle(reqId: string, error?: IntentError): void {
    const entry = this.pending.get(reqId);
    if (!entry) return;
    this.pending.delete(reqId);
    clearTimeout(entry.timeout);
    if (error) entry.reject(error);
    else entry.resolve();
  }

  private handleClose(socket: SocketLike, code: number): void {
    if (socket !== this.socket) return;
    this.detach(socket);
    this.socket = null;
    this.synced = false;
    this.clearTimers();
    this.rejectAllPending();
    const terminal = TERMINAL_CLOSES[code];
    if (terminal) {
      this.setStatus(terminal);
      this.unsubscribeWake?.();
      this.unsubscribeWake = null;
      return;
    }
    this.setStatus("reconnecting");
    const delay = backoffDelay(this.attempt, this.random);
    this.attempt += 1;
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null;
      this.open();
    }, delay);
  }

  private wake(): void {
    if (this.disposed || this.retryTimer === null) return;
    clearTimeout(this.retryTimer);
    this.retryTimer = null;
    this.open();
  }

  private detach(socket: SocketLike): void {
    socket.onopen = null;
    socket.onmessage = null;
    socket.onclose = null;
  }

  private clearTimers(): void {
    if (this.retryTimer !== null) clearTimeout(this.retryTimer);
    if (this.pingTimer !== null) clearInterval(this.pingTimer);
    this.retryTimer = null;
    this.pingTimer = null;
  }

  private rejectAllPending(): void {
    for (const [reqId, entry] of this.pending) {
      clearTimeout(entry.timeout);
      entry.reject(new IntentError("disconnected", "Lost connection to the room"));
      this.pending.delete(reqId);
    }
  }

  private setStatus(status: ConnectionStatus): void {
    if (status === this.status) return;
    this.status = status;
    this.options.onStatus(status);
  }
}
