import { expect, test } from "vitest";
import { formatClock, readTimer } from "./Timer";

test("formatClock rounds partial seconds up so zero only shows when time is up", () => {
  expect(formatClock(300_000)).toBe("05:00");
  expect(formatClock(299_001)).toBe("05:00");
  expect(formatClock(299_000)).toBe("04:59");
  expect(formatClock(1)).toBe("00:01");
  expect(formatClock(0)).toBe("00:00");
  expect(formatClock(75 * 60_000)).toBe("75:00");
});

test("readTimer measures a running timer against the given server time", () => {
  expect(readTimer({ kind: "none" }, 0)).toBeNull();
  expect(readTimer({ kind: "running", endsAt: 10_000 }, 4_000)).toEqual({
    remainingMs: 6_000,
    paused: false,
    up: false,
  });
  expect(readTimer({ kind: "running", endsAt: 10_000 }, 12_000)).toEqual({
    remainingMs: 0,
    paused: false,
    up: true,
  });
  expect(readTimer({ kind: "paused", remainingMs: 6_000 }, 99_000)).toEqual({
    remainingMs: 6_000,
    paused: true,
    up: false,
  });
});
