import { expect, test } from "vitest";
import { group, item, makeRoomState } from "../test/fixtures";
import { discussEntries, votesUsed } from "./groups";

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
      entry.label,
    ]),
  ).toEqual([
    ["g2", 0, "skipped", 4, "text b"],
    ["g1", 2, "discussed", 1, "text a"],
  ]);
});
