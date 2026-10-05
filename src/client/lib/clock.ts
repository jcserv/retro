export function computeOffset(serverNow: number, sentAt: number, receivedAt: number): number {
  return serverNow - (sentAt + receivedAt) / 2;
}

export type Clock = {
  observe(serverNow: number, receivedAt: number, sentAt?: number): void;
  serverNowEstimate(): number;
};

export function createClock(now: () => number = Date.now): Clock {
  let offset = 0;
  return {
    observe(serverNow, receivedAt, sentAt = receivedAt) {
      offset = computeOffset(serverNow, sentAt, receivedAt);
    },
    serverNowEstimate: () => now() + offset,
  };
}
