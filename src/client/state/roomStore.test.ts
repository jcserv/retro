import { describe, expect, test } from "vitest";
import type { ServerMessage } from "../../shared/protocol";
import { createClock } from "../lib/clock";
import {
  type ConnectionOptions,
  type Intent,
  IntentError,
  type MessageMeta,
} from "../lib/connection";
import { group, item, makeSnapshot } from "../test/fixtures";
import { createRoomStore } from "./roomStore";

function setup() {
  let options: ConnectionOptions | undefined;
  const sent: { intent: Intent; reqId?: string; settle: (error?: IntentError) => void }[] = [];
  let local = 10_000;
  const store = createRoomStore({
    code: "ABC234",
    clientId: "6f1c1b1e-7a43-4c49-9f52-6c1f0f3c8f10",
    clock: createClock(() => local),
    createConnection: (o) => {
      options = o;
      return {
        connect: () => {},
        dispose: () => {},
        send: (intent, reqId) =>
          new Promise<void>((resolve, reject) => {
            sent.push({ intent, reqId, settle: (error) => (error ? reject(error) : resolve()) });
          }),
      };
    },
  });
  const deliver = (
    msg: ServerMessage,
    meta: MessageMeta = { receivedAt: local, helloSentAt: null },
  ) => options?.onMessage(msg, meta);
  const setLocal = (value: number) => {
    local = value;
  };
  return {
    store,
    sent,
    deliver,
    setLocal,
    setStatus: (s: Parameters<ConnectionOptions["onStatus"]>[0]) => options?.onStatus(s),
  };
}

const groupPhase = makeSnapshot({
  phase: "group",
  items: [item("i1", "g1", 1), item("i2", "g2", 2)],
  groups: [group("g1", ["i1"]), group("g2", ["i2"])],
});

describe("createRoomStore", () => {
  test("renders grouping ops optimistically until the server acks them", async () => {
    const { store, sent, deliver } = setup();
    deliver({ type: "snapshot", room: groupPhase });

    const result = store.mergeGroups("g1", "g2");
    expect(store.room.value?.groups.map((g) => [g.id, g.itemIds])).toEqual([["g2", ["i1", "i2"]]]);

    const rendered = () => store.room.value?.groups.map((g) => [g.id, g.itemIds]);
    for (const msg of [
      { type: "itemUpserted", item: item("i1", "g2", 1) },
      { type: "groupUpserted", group: group("g2", ["i1", "i2"]) },
      { type: "groupRemoved", groupId: "g1" },
    ] satisfies ServerMessage[]) {
      deliver(msg);
      expect(rendered()).toEqual([["g2", ["i1", "i2"]]]);
    }
    sent[0]?.settle();
    expect(await result).toEqual({ ok: true });
    expect(store.room.value?.groups.map((g) => [g.id, g.itemIds])).toEqual([["g2", ["i1", "i2"]]]);
  });

  test("drops an optimistic op silently when the server reports not_found", async () => {
    const { store, sent, deliver } = setup();
    deliver({ type: "snapshot", room: groupPhase });
    const result = store.moveItemToGroup("i1", "g2");
    expect(store.room.value?.groups).toHaveLength(1);

    sent[0]?.settle(new IntentError("not_found", "gone"));
    expect(await result).toMatchObject({ ok: false, error: { code: "not_found" } });
    expect(store.room.value?.groups).toHaveLength(2);
    expect(store.lastError.value).toBeNull();
  });

  test("vote limit changes apply optimistically so rapid steps build on each other", async () => {
    const { store, sent, deliver } = setup();
    deliver({ type: "snapshot", room: makeSnapshot({ isOwner: true, voteLimit: 5 }) });

    const first = store.setVoteLimit(4);
    expect(store.room.value?.voteLimit).toBe(4);
    const second = store.setVoteLimit(3);
    expect(store.room.value?.voteLimit).toBe(3);

    deliver({ type: "voteLimit", limit: 4 });
    sent[0]?.settle();
    await first;
    expect(store.room.value?.voteLimit).toBe(3);

    sent[1]?.settle(new IntentError("rate_limited", "slow down"));
    expect(await second).toMatchObject({ ok: false });
    expect(store.room.value?.voteLimit).toBe(4);
    expect(store.lastError.value).toMatchObject({ code: "rate_limited" });
  });

  test("a snapshot discards pending ops", () => {
    const { store, deliver } = setup();
    deliver({ type: "snapshot", room: groupPhase });
    void store.ungroupItem("i1");
    void store.mergeGroups("g1", "g2");
    deliver({ type: "snapshot", room: groupPhase });
    expect(store.room.value?.groups.map((g) => g.id)).toEqual(["g1", "g2"]);
  });

  test("reports rejected intents except stale ones", async () => {
    const { store, sent, deliver } = setup();
    deliver({ type: "snapshot", room: makeSnapshot({ isOwner: true }) });

    const advance = store.advance("write");
    sent[0]?.settle(new IntentError("stale", "already advanced"));
    expect(await advance).toMatchObject({ ok: false });
    expect(store.lastError.value).toBeNull();

    const add = store.addItem("well", "hello");
    sent[1]?.settle(new IntentError("item_limit", "too many"));
    await add;
    expect(store.lastError.value).toMatchObject({ code: "item_limit" });

    deliver({ type: "error", code: "rate_limited", message: "slow down" });
    expect(store.lastError.value).toMatchObject({ code: "rate_limited" });
    store.dismissError();
    expect(store.lastError.value).toBeNull();
  });

  test("syncs the clock from the hello round trip and from timer messages", () => {
    const { store, deliver, setLocal } = setup();
    deliver(
      { type: "snapshot", room: makeSnapshot({ serverNow: 50_000 }) },
      { receivedAt: 10_000, helloSentAt: 9_800 },
    );
    expect(store.serverNow()).toBe(50_100);

    setLocal(20_000);
    deliver({ type: "timer", timer: { kind: "none" }, serverNow: 70_000 });
    setLocal(21_000);
    expect(store.serverNow()).toBe(71_000);
  });

  test("is live only once connected and holding a snapshot", () => {
    const { store, deliver, setStatus } = setup();
    setStatus("open");
    expect(store.isLive.value).toBe(false);
    deliver({ type: "snapshot", room: groupPhase });
    expect(store.isLive.value).toBe(true);
    setStatus("reconnecting");
    expect(store.isLive.value).toBe(false);
  });
});
