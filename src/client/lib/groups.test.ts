import { describe, expect, test } from "vitest";
import { group, item, makeRoomState } from "../test/fixtures";
import { categoryTone, discussEntries, groupTitle, listsItems, votesUsed } from "./groups";

const items = new Map([
  ["a", item("a", "g1", 1)],
  ["b", item("b", "g1", 2)],
]);

describe("groupTitle", () => {
  test("uses the stored title, else the earliest item's text", () => {
    expect(groupTitle({ ...group("g1", ["a", "b"]), title: "Deploys" }, items)).toBe("Deploys");
    expect(groupTitle(group("g1", ["a", "b"]), items)).toBe("text a");
  });
});

describe("listsItems", () => {
  test("lists items unless the group is a single untitled item", () => {
    expect(listsItems(group("g1", ["a"]), items)).toBe(false);
    expect(listsItems({ ...group("g1", ["a"]), title: "text a" }, items)).toBe(false);
    expect(listsItems({ ...group("g1", ["a"]), title: "Other" }, items)).toBe(true);
    expect(listsItems(group("g1", ["a", "b"]), items)).toBe(true);
  });
});

test("categoryTone wraps category position over the five palette slots", () => {
  const categories = ["a", "b", "c", "d", "e", "f"].map((id) => ({ id, title: id }));
  expect(categoryTone(categories, "b")).toBe(1);
  expect(categoryTone(categories, "f")).toBe(0);
  expect(categoryTone(categories, "missing")).toBe(0);
});

test("votesUsed sums own votes across groups", () => {
  expect(votesUsed({ g1: 2, g2: 1 })).toBe(3);
  expect(votesUsed({})).toBe(0);
});

test("discussEntries follows discuss order and skips groups that no longer exist", () => {
  const state = makeRoomState({
    phase: "discuss",
    items: [item("a", "g1", 1), item("b", "g2", 2)],
    groups: [group("g1", ["a"]), group("g2", ["b"])],
    voteTotals: { g1: 1, g2: 4 },
    discuss: {
      order: ["g2", "gone", "g1"],
      currentIndex: 2,
      status: { g2: "skipped", gone: "discussed", g1: "discussed" },
    },
  });
  expect(
    discussEntries(state).map((entry) => [
      entry.group.id,
      entry.index,
      entry.status,
      entry.votes,
      entry.title,
    ]),
  ).toEqual([
    ["g2", 0, "skipped", 4, "text b"],
    ["g1", 2, "discussed", 1, "text a"],
  ]);
});
