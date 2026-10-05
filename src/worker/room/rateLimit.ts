import { LIMITS } from "../../shared/constants";

export type RateDecision = "allow" | "reject" | "close";

const WINDOW_MS = 1000;
const OVERFLOW_WINDOWS_BEFORE_CLOSE = 3;

export class SocketRateLimiter {
  #tokens: number;
  #refilledAt: number;
  #lastOverflowWindow = Number.NEGATIVE_INFINITY;
  #overflowStreak = 0;

  constructor(
    now: number,
    readonly burst: number = LIMITS.socketBurst,
    readonly refillPerSec: number = LIMITS.socketRefillPerSec,
  ) {
    this.#tokens = burst;
    this.#refilledAt = now;
  }

  consume(now: number): RateDecision {
    const elapsed = Math.max(0, now - this.#refilledAt);
    this.#tokens = Math.min(this.burst, this.#tokens + (elapsed / 1000) * this.refillPerSec);
    this.#refilledAt = now;
    if (this.#tokens >= 1) {
      this.#tokens -= 1;
      return "allow";
    }
    const window = Math.floor(now / WINDOW_MS);
    if (window !== this.#lastOverflowWindow) {
      this.#overflowStreak = window === this.#lastOverflowWindow + 1 ? this.#overflowStreak + 1 : 1;
      this.#lastOverflowWindow = window;
    }
    return this.#overflowStreak >= OVERFLOW_WINDOWS_BEFORE_CLOSE ? "close" : "reject";
  }
}
