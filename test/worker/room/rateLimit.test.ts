import { describe, expect, test } from "vitest";
import { LIMITS } from "../../../src/shared/constants";
import { SocketRateLimiter } from "../../../src/worker/room/rateLimit";

const T = 10_000;

function drain(limiter: SocketRateLimiter, now: number, count: number) {
  return Array.from({ length: count }, () => limiter.consume(now));
}

describe("SocketRateLimiter", () => {
  test("allows a full burst, then rejects", () => {
    const limiter = new SocketRateLimiter(T);
    expect(drain(limiter, T, LIMITS.socketBurst).every((d) => d === "allow")).toBe(true);
    expect(limiter.consume(T)).toBe("reject");
  });

  test("refills at the configured rate, capped at the burst size", () => {
    const limiter = new SocketRateLimiter(T);
    drain(limiter, T, LIMITS.socketBurst);
    expect(drain(limiter, T + 500, 5).every((d) => d === "allow")).toBe(true);
    expect(limiter.consume(T + 500)).toBe("reject");

    const idle = new SocketRateLimiter(T);
    expect(drain(idle, T + 60_000, LIMITS.socketBurst + 1).at(-1)).toBe("reject");
  });

  test("closes after overflowing in three consecutive one-second windows", () => {
    const limiter = new SocketRateLimiter(T);
    drain(limiter, T, LIMITS.socketBurst);
    expect(drain(limiter, T, 50).at(-1)).toBe("reject");
    expect(drain(limiter, T + 1000, 50).at(-1)).toBe("reject");
    expect(drain(limiter, T + 2000, 50).at(-1)).toBe("close");
  });

  test("a quiet window resets the overflow streak", () => {
    const limiter = new SocketRateLimiter(T);
    drain(limiter, T, LIMITS.socketBurst);
    expect(drain(limiter, T, 50).at(-1)).toBe("reject");
    expect(drain(limiter, T + 1000, 50).at(-1)).toBe("reject");
    expect(drain(limiter, T + 3000, 50).at(-1)).toBe("reject");
    expect(drain(limiter, T + 4000, 50).at(-1)).toBe("reject");
    expect(drain(limiter, T + 5000, 50).at(-1)).toBe("close");
  });
});
