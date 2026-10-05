import { expect, test } from "vitest";
import { codePointLength } from "./text";

test("codePointLength counts astral characters once, matching the server limit", () => {
  expect(codePointLength("abc")).toBe(3);
  expect(codePointLength("👍🏽!")).toBe(3);
});
