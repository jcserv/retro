import { describe, expect, test } from "vitest";
import { computeOffset, createClock } from "./clock";

describe("computeOffset", () => {
  test("assumes the server stamped the message halfway through the round trip", () => {
    expect(computeOffset(10_150, 1_000, 1_200)).toBe(9_050);
  });

  test("is negative when the local clock runs ahead of the server", () => {
    expect(computeOffset(1_000, 5_000, 5_000)).toBe(-4_000);
  });
});

describe("createClock", () => {
  test("estimates server time from the latest observation", () => {
    let local = 1_000;
    const clock = createClock(() => local);
    expect(clock.serverNowEstimate()).toBe(1_000);

    clock.observe(60_100, 1_200, 1_000);
    local = 2_000;
    expect(clock.serverNowEstimate()).toBe(61_000);

    clock.observe(70_000, 3_000);
    local = 3_500;
    expect(clock.serverNowEstimate()).toBe(70_500);
  });
});
