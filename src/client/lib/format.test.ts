import { expect, test } from "vitest";
import { formatTimeLeft, textLength } from "./format";

test("counts trimmed text in code points, matching the server's limit", () => {
  expect(textLength("  hi  ")).toBe(2);
  expect(textLength("👍🏽")).toBe(2);
  expect(textLength("😀".repeat(280))).toBe(280);
});

test.each([
  [24 * 60 * 60_000, "24h 0m"],
  [5 * 60 * 60_000 + 12 * 60_000 + 59_000, "5h 12m"],
  [42 * 60_000 + 30_000, "42m"],
  [59_999, "less than 1m"],
  [0, "expired"],
  [-1, "expired"],
])("formats %i ms left as %s", (ms, expected) => {
  expect(formatTimeLeft(ms)).toBe(expected);
});
