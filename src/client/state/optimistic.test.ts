import { describe, expect, test } from "vitest";
import { group, item, makeRoomState } from "../test/fixtures";
import {
  applyPendingOps,
  type GroupingIntent,
  type OptimisticIntent,
  PENDING_GROUP_ID_PREFIX,
  type PendingOp,
} from "./optimistic";
import type { RoomState } from "./roomState";

const state = makeRoomState({
  phase: "group",
  items: [
    item("i1", "g1", 1, "well"),
    item("i2", "g1", 2, "well"),
    item("i3", "g3", 3, "puzzles"),
    item("i4", "g4", 0, "less-well"),
  ],
  groups: [
    { ...group("g1", ["i1", "i2"], "well", 10), title: "Pairing" },
    group("g3", ["i3"], "puzzles", 30),
    group("g4", ["i4"], "less-well", 40),
  ],
});

const op = (reqId: string, intent: GroupingIntent): PendingOp => ({ reqId, intent, issuedAt: 99 });

const shape = (s: RoomState) => ({
  groups: Object.fromEntries(s.groups.map((g) => [g.id, g.itemIds])),
  itemGroups: Object.fromEntries(s.items.map((i) => [i.id, i.groupId])),
});

describe("applyPendingOps", () => {
  test("returns the server state when nothing is pending", () => {
    expect(applyPendingOps(state, [])).toBe(state);
  });

  test("moving an item keeps the target ordered by item creation and drops an emptied source", () => {
    const next = applyPendingOps(state, [
      op("r1", { type: "moveItemToGroup", itemId: "i4", groupId: "g1" }),
    ]);
    expect(shape(next)).toEqual({
      groups: { g1: ["i4", "i1", "i2"], g3: ["i3"] },
      itemGroups: { i1: "g1", i2: "g1", i3: "g3", i4: "g1" },
    });
    expect(next.items.find((i) => i.id === "i4")?.categoryId).toBe("less-well");
  });

  test("moving an item out of a multi-item group keeps the source", () => {
    const next = applyPendingOps(state, [
      op("r1", { type: "moveItemToGroup", itemId: "i2", groupId: "g3" }),
    ]);
    expect(shape(next).groups).toEqual({ g1: ["i1"], g3: ["i2", "i3"], g4: ["i4"] });
  });

  test("merging moves every source item into the target, which keeps its title and category", () => {
    const next = applyPendingOps(state, [
      op("r1", { type: "mergeGroups", sourceGroupId: "g1", targetGroupId: "g3" }),
    ]);
    expect(shape(next).groups).toEqual({ g3: ["i1", "i2", "i3"], g4: ["i4"] });
    expect(next.groups.find((g) => g.id === "g3")).toMatchObject({
      categoryId: "puzzles",
      title: null,
    });
  });

  test("ungrouping creates a placeholder group in the item's original category", () => {
    const moved = applyPendingOps(state, [
      op("r1", { type: "mergeGroups", sourceGroupId: "g1", targetGroupId: "g3" }),
      op("r2", { type: "ungroupItem", itemId: "i1" }),
    ]);
    const created = moved.groups.find((g) => g.id === `${PENDING_GROUP_ID_PREFIX}r2`);
    expect(created).toEqual({
      id: `${PENDING_GROUP_ID_PREFIX}r2`,
      categoryId: "well",
      title: null,
      itemIds: ["i1"],
      createdAt: 99,
    });
    expect(shape(moved).groups.g3).toEqual(["i2", "i3"]);
  });

  test.each<[string, GroupingIntent]>([
    ["move into the item's own group", { type: "moveItemToGroup", itemId: "i1", groupId: "g1" }],
    ["move to a vanished group", { type: "moveItemToGroup", itemId: "i1", groupId: "gone" }],
    ["move a vanished item", { type: "moveItemToGroup", itemId: "gone", groupId: "g3" }],
    [
      "merge a group into itself",
      { type: "mergeGroups", sourceGroupId: "g1", targetGroupId: "g1" },
    ],
    [
      "merge from a vanished group",
      { type: "mergeGroups", sourceGroupId: "gone", targetGroupId: "g3" },
    ],
    [
      "merge into a vanished group",
      { type: "mergeGroups", sourceGroupId: "g1", targetGroupId: "gone" },
    ],
    ["ungroup an item already alone", { type: "ungroupItem", itemId: "i3" }],
    ["ungroup a vanished item", { type: "ungroupItem", itemId: "gone" }],
  ])("is a no-op to %s", (_name, intent) => {
    expect(applyPendingOps(state, [op("r1", intent)])).toBe(state);
  });

  test("an op is idempotent once the server state already reflects it", () => {
    const pending = [
      op("r1", { type: "mergeGroups", sourceGroupId: "g3", targetGroupId: "g4" }),
      op("r2", { type: "moveItemToGroup", itemId: "i2", groupId: "g4" }),
      op("r3", { type: "ungroupItem", itemId: "i1" }),
    ];
    const optimistic = applyPendingOps(state, pending);
    const serverCaughtUp: RoomState = {
      ...optimistic,
      groups: optimistic.groups.map((g) =>
        g.id === `${PENDING_GROUP_ID_PREFIX}r3` ? { ...g, id: "g9" } : g,
      ),
      items: optimistic.items.map((i) => (i.id === "i1" ? { ...i, groupId: "g9" } : i)),
    };
    expect(applyPendingOps(serverCaughtUp, pending)).toBe(serverCaughtUp);
  });

  test("does not mutate the server state", () => {
    const frozen = structuredClone(state);
    applyPendingOps(state, [
      op("r1", { type: "mergeGroups", sourceGroupId: "g1", targetGroupId: "g4" }),
      op("r2", { type: "ungroupItem", itemId: "i2" }),
    ]);
    expect(state).toEqual(frozen);
  });
});

describe("pending reactions", () => {
  const reacted = makeRoomState({
    phase: "vote",
    items: [
      {
        ...item("i1", "g1", 1),
        reactions: [
          { emoji: "🎉", count: 2, mine: false },
          { emoji: "👍", count: 1, mine: true },
        ],
      },
    ],
    groups: [group("g1", ["i1"])],
  });
  const reactionsAfter = (...intents: OptimisticIntent[]) =>
    applyPendingOps(
      reacted,
      intents.map((intent, index) => ({ reqId: `r${index}`, intent, issuedAt: 0 })),
    ).items[0]?.reactions;

  test("joining, adding a new emoji, and dropping your last reaction", () => {
    expect(
      reactionsAfter(
        { type: "addReaction", itemId: "i1", emoji: "🎉" },
        { type: "addReaction", itemId: "i1", emoji: "🔥" },
        { type: "removeReaction", itemId: "i1", emoji: "👍" },
      ),
    ).toEqual([
      { emoji: "🎉", count: 3, mine: true },
      { emoji: "🔥", count: 1, mine: true },
    ]);
  });

  test("repeating what you already did changes nothing", () => {
    expect(
      reactionsAfter(
        { type: "addReaction", itemId: "i1", emoji: "👍" },
        { type: "removeReaction", itemId: "i1", emoji: "🎉" },
      ),
    ).toEqual(reacted.items[0]?.reactions);
  });
});
