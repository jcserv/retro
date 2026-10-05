import { describe, expect, test } from "vitest";
import type { ServerMessage } from "../../shared/protocol";
import { applyServerMessage, type RoomState } from "../state/roomState";
import { group, item, makeRoomState } from "../test/fixtures";
import { buildBoard, decodeDropTarget, dropIntent, encodeDropTarget } from "./board";

const room = makeRoomState({
  phase: "group",
  items: [
    item("i1", "g1", 5, "well"),
    item("i2", "g1", 6, "well"),
    item("i3", "g3", 1, "well"),
    item("i4", "g4", 2, "puzzles"),
    item("i5", "pending:r1", 3, "well"),
  ],
  groups: [
    group("g1", ["i1", "i2"], "well", 10),
    group("g3", ["i3"], "well", 10),
    { ...group("g4", ["i4"], "well", 5), title: "Moved here" },
    group("pending:r1", ["i5"], "well", 20),
    group("ghost", ["missing"], "well", 0),
  ],
});

describe("buildBoard", () => {
  test("orders groups by creation, then first item, and skips groups with no known items", () => {
    const [well, ...rest] = buildBoard(room);
    expect(well?.groups.map((entry) => entry.group.id)).toEqual(["g4", "g3", "g1", "pending:r1"]);
    expect(well?.itemCount).toBe(5);
    expect(rest.every((column) => column.groups.length === 0)).toBe(true);
  });

  test("labels by title, else the first item, and flags optimistic groups", () => {
    const groups = buildBoard(room)[0]?.groups ?? [];
    expect(groups.map((entry) => [entry.label, entry.pending])).toEqual([
      ["Moved here", false],
      ["text i3", false],
      ["text i1", false],
      ["text i5", true],
    ]);
  });

  test.each<[string, RoomState, ServerMessage[]]>([
    [
      "merge",
      makeRoomState({
        items: [item("a", "g1", 1), item("b", "g2", 2)],
        groups: [group("g1", ["a"]), group("g2", ["b"])],
      }),
      [
        { type: "itemUpserted", item: item("a", "g2", 1) },
        { type: "groupUpserted", group: group("g2", ["a", "b"]) },
        { type: "groupRemoved", groupId: "g1" },
      ],
    ],
    [
      "ungroup",
      makeRoomState({
        items: [item("a", "g1", 1), item("b", "g1", 2)],
        groups: [group("g1", ["a", "b"])],
      }),
      [
        { type: "groupUpserted", group: group("g2", ["a"], "well", 5) },
        { type: "itemUpserted", item: item("a", "g2", 1) },
        { type: "groupUpserted", group: group("g1", ["b"]) },
      ],
    ],
  ])(
    "shows every item exactly once mid-way through the server changes for a %s",
    (_, start, batch) => {
      let state = start;
      for (const message of batch) {
        state = applyServerMessage(state, message) ?? state;
        const shown = buildBoard(state).flatMap((column) =>
          column.groups.flatMap((entry) => entry.items.map((entry) => entry.id)),
        );
        expect(shown.toSorted()).toEqual(["a", "b"]);
      }
    },
  );
});

describe("dropIntent", () => {
  test("a group dropped on another group merges into the target", () => {
    expect(
      dropIntent(room, { kind: "group", groupId: "g3" }, { kind: "group", groupId: "g1" }),
    ).toEqual({ type: "mergeGroups", sourceGroupId: "g3", targetGroupId: "g1" });
  });

  test("an item dropped on another group moves only that item", () => {
    expect(
      dropIntent(room, { kind: "item", itemId: "i2" }, { kind: "group", groupId: "g3" }),
    ).toEqual({ type: "moveItemToGroup", itemId: "i2", groupId: "g3" });
  });

  test("an item from a multi-item group ungroups only onto its original category column", () => {
    const source = { kind: "item", itemId: "i1" } as const;
    expect(dropIntent(room, source, { kind: "column", categoryId: "well" })).toEqual({
      type: "ungroupItem",
      itemId: "i1",
    });
    expect(dropIntent(room, source, { kind: "column", categoryId: "puzzles" })).toBeNull();
    expect(
      dropIntent(room, { kind: "item", itemId: "i3" }, { kind: "column", categoryId: "well" }),
    ).toBeNull();
  });

  test.each([
    ["onto itself", { kind: "group", groupId: "g1" }, { kind: "group", groupId: "g1" }],
    ["onto its own group", { kind: "item", itemId: "i1" }, { kind: "group", groupId: "g1" }],
    [
      "onto a pending group",
      { kind: "group", groupId: "g1" },
      { kind: "group", groupId: "pending:r1" },
    ],
    [
      "from a pending group",
      { kind: "group", groupId: "pending:r1" },
      { kind: "group", groupId: "g1" },
    ],
    ["onto a vanished group", { kind: "group", groupId: "g1" }, { kind: "group", groupId: "gone" }],
    [
      "a group onto a column",
      { kind: "group", groupId: "g1" },
      { kind: "column", categoryId: "well" },
    ],
  ] as const)("rejects dropping %s", (_, source, target) => {
    expect(dropIntent(room, source, target)).toBeNull();
  });
});

test("drop target keys round-trip, including ids containing the separator", () => {
  const target = { kind: "group", groupId: "pending:abc" } as const;
  expect(decodeDropTarget(encodeDropTarget(target))).toEqual(target);
  expect(decodeDropTarget("column:well")).toEqual({ kind: "column", categoryId: "well" });
  expect(decodeDropTarget("nonsense")).toBeNull();
});
