import { describe, expect, test } from "vitest";
import type { ActionView, CommentView, ServerMessage } from "../../shared/protocol";
import { group, item, makeRoomState, makeSnapshot } from "../test/fixtures";
import { applyServerMessage, type RoomState } from "./roomState";

const comment = (id: string, text = `comment ${id}`): CommentView => ({
  id,
  groupId: "g1",
  text,
  mine: true,
  createdAt: 1,
  updatedAt: 1,
});

const action = (id: string, text = `action ${id}`): ActionView => ({
  id,
  groupId: "g1",
  text,
  assignee: null,
  mine: false,
  createdAt: 1,
  updatedAt: 1,
});

const base = makeRoomState({
  phase: "discuss",
  items: [item("i1", "g1", 1), item("i2", "g2", 2)],
  groups: [group("g1", ["i1"]), group("g2", ["i2"])],
  discuss: { order: ["g1", "g2"], currentIndex: 0, status: { g1: "discussed", g2: "pending" } },
  comments: [comment("c1"), comment("c2")],
  actions: [action("a1"), action("a2")],
});

describe("applyServerMessage", () => {
  test("snapshot replaces state wholesale and drops serverNow", () => {
    const snapshot = makeSnapshot({ phase: "group", code: "XYZ789" });
    const next = applyServerMessage(base, { type: "snapshot", room: snapshot });
    const { serverNow: _, ...expected } = snapshot;
    expect(next).toEqual(expected);
    expect(next).not.toHaveProperty("serverNow");
  });

  test("patches before the first snapshot are ignored", () => {
    expect(applyServerMessage(null, { type: "youReady", ready: true })).toBeNull();
  });

  test.each<ServerMessage>([
    { type: "ack", reqId: "r1" },
    { type: "error", code: "forbidden", message: "no", reqId: "r1" },
  ])("$type leaves state untouched", (msg) => {
    expect(applyServerMessage(base, msg)).toBe(base);
  });

  test.each<[string, (s: RoomState) => unknown[], ServerMessage, string[], string]>([
    [
      "item",
      (s) => s.items,
      { type: "itemUpserted", item: { ...item("i1", "g1", 1), text: "edited" } },
      ["i1", "i2"],
      "edited",
    ],
    [
      "group",
      (s) => s.groups,
      { type: "groupUpserted", group: { ...group("g2", ["i2"]), title: "edited" } },
      ["g1", "g2"],
      "edited",
    ],
    [
      "comment",
      (s) => s.comments,
      { type: "commentUpserted", comment: comment("c1", "edited") },
      ["c1", "c2"],
      "edited",
    ],
    [
      "action",
      (s) => s.actions,
      { type: "actionUpserted", action: action("a2", "edited") },
      ["a1", "a2"],
      "edited",
    ],
  ])("%s upsert replaces an existing entry in place", (_kind, select, msg, ids, marker) => {
    const next = applyServerMessage(base, msg);
    if (!next) throw new Error("expected state");
    const list = select(next) as { id: string }[];
    expect(list.map((entry) => entry.id)).toEqual(ids);
    expect(JSON.stringify(list)).toContain(marker);
  });

  test.each<[string, (s: RoomState) => { id: string }[], ServerMessage, string[]]>([
    [
      "item",
      (s) => s.items,
      { type: "itemUpserted", item: item("i3", "g1", 3) },
      ["i1", "i2", "i3"],
    ],
    [
      "group",
      (s) => s.groups,
      { type: "groupUpserted", group: group("g3", []) },
      ["g1", "g2", "g3"],
    ],
    [
      "comment",
      (s) => s.comments,
      { type: "commentUpserted", comment: comment("c3") },
      ["c1", "c2", "c3"],
    ],
    [
      "action",
      (s) => s.actions,
      { type: "actionUpserted", action: action("a3") },
      ["a1", "a2", "a3"],
    ],
  ])("%s upsert appends a new entry", (_kind, select, msg, ids) => {
    const next = applyServerMessage(base, msg);
    if (!next) throw new Error("expected state");
    expect(select(next).map((entry) => entry.id)).toEqual(ids);
  });

  test.each<[string, (s: RoomState) => { id: string }[], ServerMessage, string[]]>([
    ["item", (s) => s.items, { type: "itemRemoved", itemId: "i1" }, ["i2"]],
    ["group", (s) => s.groups, { type: "groupRemoved", groupId: "g2" }, ["g1"]],
    ["comment", (s) => s.comments, { type: "commentRemoved", commentId: "c1" }, ["c2"]],
    ["action", (s) => s.actions, { type: "actionRemoved", actionId: "missing" }, ["a1", "a2"]],
  ])("%s removal drops the entry by id", (_kind, select, msg, ids) => {
    const next = applyServerMessage(base, msg);
    if (!next) throw new Error("expected state");
    expect(select(next).map((entry) => entry.id)).toEqual(ids);
  });

  test.each<[ServerMessage, Partial<RoomState>]>([
    [{ type: "categoryCounts", counts: { well: 3 } }, { categoryCounts: { well: 3 } }],
    [
      { type: "presence", presence: { participantCount: 4, connectedCount: 3, readyCount: 2 } },
      { presence: { participantCount: 4, connectedCount: 3, readyCount: 2 } },
    ],
    [{ type: "youReady", ready: true }, { youReady: true }],
    [{ type: "myVotes", votes: { g1: 2 } }, { myVotes: { g1: 2 } }],
    [{ type: "voteLimit", limit: 7 }, { voteLimit: 7 }],
    [
      { type: "timer", timer: { kind: "running", endsAt: 9_000 }, serverNow: 5_000 },
      { timer: { kind: "running", endsAt: 9_000 } },
    ],
  ])("$type sets its field", (msg, expected) => {
    expect(applyServerMessage(base, msg)).toEqual({ ...base, ...expected });
  });

  test("discussCursor moves the cursor and keeps the order", () => {
    const next = applyServerMessage(base, {
      type: "discussCursor",
      currentIndex: 1,
      status: { g1: "skipped", g2: "discussed" },
    });
    expect(next?.discuss).toEqual({
      order: ["g1", "g2"],
      currentIndex: 1,
      status: { g1: "skipped", g2: "discussed" },
    });
  });

  test("discussCursor outside discuss is ignored", () => {
    const writing = makeRoomState();
    const msg: ServerMessage = { type: "discussCursor", currentIndex: 1, status: {} };
    expect(applyServerMessage(writing, msg)).toBe(writing);
  });

  test("does not mutate the previous state", () => {
    const frozen = structuredClone(base);
    applyServerMessage(base, { type: "itemRemoved", itemId: "i1" });
    applyServerMessage(base, { type: "commentUpserted", comment: comment("c1", "changed") });
    expect(base).toEqual(frozen);
  });
});
