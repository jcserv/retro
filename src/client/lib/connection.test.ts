import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { CloseCode } from "../../shared/constants";
import type { ServerMessage } from "../../shared/protocol";
import { makeSnapshot } from "../test/fixtures";
import {
  BACKOFF_MAX_MS,
  BACKOFF_MIN_MS,
  backoffDelay,
  type ConnectionStatus,
  IntentError,
  PING_INTERVAL_MS,
  REQUEST_TIMEOUT_MS,
  RoomConnection,
  roomSocketUrl,
  type SocketLike,
} from "./connection";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  closedWith: number | undefined;
  onopen: SocketLike["onopen"] = null;
  onmessage: SocketLike["onmessage"] = null;
  onclose: SocketLike["onclose"] = null;

  constructor(readonly url: string) {}

  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.closedWith = code;
  }
  serverOpen() {
    this.readyState = 1;
    this.onopen?.(new Event("open"));
  }
  serverSend(msg: ServerMessage | string) {
    const data = typeof msg === "string" ? msg : JSON.stringify(msg);
    this.onmessage?.({ data } as MessageEvent);
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code } as CloseEvent);
  }
  sentJson() {
    return this.sent.filter((data) => data !== "ping").map((data) => JSON.parse(data));
  }
}

const CLIENT_ID = "6f1c1b1e-7a43-4c49-9f52-6c1f0f3c8f10";

function setup() {
  const sockets: FakeSocket[] = [];
  const statuses: ConnectionStatus[] = [];
  const messages: ServerMessage[] = [];
  let wake = () => {};
  const unsubscribe = vi.fn();
  const connection = new RoomConnection({
    code: "ABC234",
    clientId: CLIENT_ID,
    url: "ws://test/ws/ABC234",
    onMessage: (msg) => messages.push(msg),
    onStatus: (status) => statuses.push(status),
    createSocket: (url) => {
      const socket = new FakeSocket(url);
      sockets.push(socket);
      return socket;
    },
    subscribeWake: (fn) => {
      wake = fn;
      return unsubscribe;
    },
    random: () => 0,
  });
  const latest = () => {
    const socket = sockets.at(-1);
    if (!socket) throw new Error("no socket");
    return socket;
  };
  const connectAndSync = () => {
    connection.connect();
    latest().serverOpen();
    latest().serverSend({ type: "snapshot", room: makeSnapshot() });
  };
  return {
    connection,
    sockets,
    statuses,
    messages,
    latest,
    connectAndSync,
    unsubscribe,
    wake: () => wake(),
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("RoomConnection", () => {
  test("sends hello first and reports open only once the snapshot arrives", () => {
    const { connection, latest, statuses } = setup();
    connection.connect();
    expect(statuses).toEqual(["connecting"]);

    latest().serverOpen();
    expect(latest().sentJson()).toEqual([{ type: "hello", clientId: CLIENT_ID }]);
    expect(statuses).toEqual(["connecting"]);

    latest().serverSend({ type: "snapshot", room: makeSnapshot() });
    expect(statuses).toEqual(["connecting", "open"]);
  });

  test("resolves an intent on its ack and rejects on its error", async () => {
    const { connection, latest, connectAndSync } = setup();
    connectAndSync();

    const added = connection.send({ type: "addItem", categoryId: "well", text: "hi" }, "r1");
    const voted = connection.send({ type: "vote", groupId: "g1" }, "r2");
    expect(latest().sentJson().slice(1)).toEqual([
      { type: "addItem", categoryId: "well", text: "hi", reqId: "r1" },
      { type: "vote", groupId: "g1", reqId: "r2" },
    ]);

    latest().serverSend({
      type: "error",
      code: "vote_limit",
      message: "No votes left",
      reqId: "r2",
    });
    latest().serverSend({ type: "ack", reqId: "r1" });

    await expect(added).resolves.toBeUndefined();
    await expect(voted).rejects.toEqual(new IntentError("vote_limit", "No votes left"));
  });

  test("rejects an intent after the request timeout", async () => {
    const { connection, connectAndSync } = setup();
    connectAndSync();
    const result = connection.send({ type: "setReady", ready: true });
    vi.advanceTimersByTime(REQUEST_TIMEOUT_MS);
    await expect(result).rejects.toMatchObject({ code: "timeout" });
  });

  test("rejects intents immediately while not synced, and pending ones on close", async () => {
    const { connection, latest } = setup();
    connection.connect();
    latest().serverOpen();
    await expect(connection.send({ type: "setReady", ready: true })).rejects.toMatchObject({
      code: "disconnected",
    });

    latest().serverSend({ type: "snapshot", room: makeSnapshot() });
    const inFlight = connection.send({ type: "setReady", ready: true });
    latest().serverClose(1006);
    await expect(inFlight).rejects.toMatchObject({ code: "disconnected" });
  });

  test("reconnects with growing backoff and resets it after a snapshot", () => {
    const { connection, sockets, latest, statuses } = setup();
    connection.connect();
    latest().serverClose(1006);
    expect(statuses).toEqual(["connecting", "reconnecting"]);

    vi.advanceTimersByTime(BACKOFF_MIN_MS - 1);
    expect(sockets).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(sockets).toHaveLength(2);

    latest().serverClose(CloseCode.Unauthenticated);
    vi.advanceTimersByTime(BACKOFF_MIN_MS);
    expect(sockets).toHaveLength(3);

    latest().serverOpen();
    latest().serverSend({ type: "snapshot", room: makeSnapshot() });
    expect(statuses.at(-1)).toBe("open");
    latest().serverClose(1001);
    vi.advanceTimersByTime(BACKOFF_MIN_MS);
    expect(sockets).toHaveLength(4);
  });

  test.each([
    [CloseCode.NotFound, "not_found"],
    [CloseCode.Expired, "not_found"],
    [CloseCode.RoomFull, "full"],
  ] as const)("close code %i is terminal (%s)", (code, status) => {
    const { connection, sockets, latest, statuses, unsubscribe } = setup();
    connection.connect();
    latest().serverOpen();
    latest().serverClose(code);
    vi.advanceTimersByTime(BACKOFF_MAX_MS * 2);
    expect(sockets).toHaveLength(1);
    expect(statuses.at(-1)).toBe(status);
    expect(unsubscribe).toHaveBeenCalled();
  });

  test("a wake event skips the backoff wait", () => {
    const { connection, sockets, latest, wake } = setup();
    connection.connect();
    for (let i = 0; i < 5; i++) {
      vi.runOnlyPendingTimers();
      latest().serverClose(1006);
    }
    const count = sockets.length;
    wake();
    expect(sockets).toHaveLength(count + 1);
    wake();
    expect(sockets).toHaveLength(count + 1);
  });

  test("pings on an interval and ignores the pong reply", () => {
    const { latest, messages, connectAndSync } = setup();
    connectAndSync();
    vi.advanceTimersByTime(PING_INTERVAL_MS * 2);
    expect(latest().sent.filter((data) => data === "ping")).toHaveLength(2);
    latest().serverSend("pong");
    expect(messages.map((msg) => msg.type)).toEqual(["snapshot"]);
  });

  test("dispose closes the socket and never reconnects", () => {
    const { connection, sockets, latest, connectAndSync, unsubscribe } = setup();
    connectAndSync();
    const socket = latest();
    connection.dispose();
    expect(socket.closedWith).toBe(1000);
    socket.serverClose(1000);
    vi.advanceTimersByTime(BACKOFF_MAX_MS * 2);
    expect(sockets).toHaveLength(1);
    expect(unsubscribe).toHaveBeenCalled();
  });
});

describe("backoffDelay", () => {
  test("starts at the minimum and caps at the maximum", () => {
    expect(backoffDelay(0, () => 1)).toBe(BACKOFF_MIN_MS);
    expect(backoffDelay(3, () => 1)).toBe(4_000);
    expect(backoffDelay(10, () => 1)).toBe(BACKOFF_MAX_MS);
    expect(backoffDelay(10, () => 0)).toBe(BACKOFF_MIN_MS);
  });
});

describe("roomSocketUrl", () => {
  test("uses wss on https", () => {
    expect(roomSocketUrl("ABC234", { protocol: "https:", host: "retro.dev" })).toBe(
      "wss://retro.dev/ws/ABC234",
    );
    expect(roomSocketUrl("ABC234", { protocol: "http:", host: "localhost:5173" })).toBe(
      "ws://localhost:5173/ws/ABC234",
    );
  });
});
