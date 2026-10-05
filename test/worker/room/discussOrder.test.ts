import { describe, expect, test } from "vitest";
import { type DiscussCandidate, discussOrder } from "../../../src/worker/room/discussOrder";

const candidate = (
  groupId: string,
  overrides: Partial<DiscussCandidate> = {},
): DiscussCandidate => ({
  groupId,
  votes: 0,
  categoryPosition: 0,
  earliestItemAt: 0,
  ...overrides,
});

describe("discussOrder", () => {
  test("sorts by votes descending first", () => {
    expect(
      discussOrder([
        candidate("a", { votes: 1, categoryPosition: 0 }),
        candidate("b", { votes: 5, categoryPosition: 4 }),
        candidate("c", { votes: 3 }),
      ]),
    ).toEqual(["b", "c", "a"]);
  });

  test("breaks vote ties by category position, then earliest item, then group id", () => {
    expect(
      discussOrder([
        candidate("z", { votes: 2, categoryPosition: 1, earliestItemAt: 10 }),
        candidate("y", { votes: 2, categoryPosition: 1, earliestItemAt: 5 }),
        candidate("x", { votes: 2, categoryPosition: 0, earliestItemAt: 99 }),
        candidate("b", { votes: 2, categoryPosition: 1, earliestItemAt: 5 }),
      ]),
    ).toEqual(["x", "b", "y", "z"]);
  });

  test("includes groups with zero votes after voted ones", () => {
    expect(
      discussOrder([candidate("none"), candidate("some", { votes: 1, categoryPosition: 3 })]),
    ).toEqual(["some", "none"]);
  });

  test("does not mutate its input", () => {
    const input = [candidate("a"), candidate("b", { votes: 1 })];
    discussOrder(input);
    expect(input.map((c) => c.groupId)).toEqual(["a", "b"]);
  });
});
