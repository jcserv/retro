import {
  type BrowserContext,
  expect,
  type Page,
  test,
  type WebSocketRoute,
} from "@playwright/test";

const CODE = "ABC234";
const SKEW_MS = 10 * 60_000;

type TimerState =
  | { kind: "none" }
  | { kind: "running"; endsAt: number }
  | { kind: "paused"; remainingMs: number };

function createMockRoom() {
  const sockets: WebSocketRoute[] = [];
  const intents: { type: string; [key: string]: unknown }[] = [];
  const room = { phase: "write", timer: { kind: "none" } as TimerState };

  const snapshot = (isOwner: boolean) => {
    const now = Date.now();
    return {
      type: "snapshot",
      room: {
        code: CODE,
        createdAt: now,
        expiresAt: now + 86_400_000,
        serverNow: now,
        phase: room.phase,
        categories: [{ id: "well", title: "What went well?" }],
        isOwner,
        presence: { participantCount: 2, connectedCount: 2, readyCount: 0 },
        youReady: false,
        timer: room.timer,
        voteLimit: 5,
        items: [],
        groups: [],
        categoryCounts: {},
        myVotes: {},
        voteTotals: null,
        discuss: null,
        comments: [],
        actions: [],
      },
    };
  };

  const broadcastTimer = (timer: TimerState) => {
    room.timer = timer;
    const msg = JSON.stringify({ type: "timer", timer, serverNow: Date.now() });
    for (const ws of sockets) ws.send(msg);
  };

  const applyIntent = (msg: { type: string; durationMs?: number }) => {
    const now = Date.now();
    const { timer } = room;
    switch (msg.type) {
      case "setTimer":
        return broadcastTimer({ kind: "running", endsAt: now + (msg.durationMs ?? 0) });
      case "pauseTimer":
        if (timer.kind === "running")
          broadcastTimer({ kind: "paused", remainingMs: Math.max(0, timer.endsAt - now) });
        return;
      case "resumeTimer":
        if (timer.kind === "paused")
          broadcastTimer({ kind: "running", endsAt: now + timer.remainingMs });
        return;
      case "addTimerMinute":
        if (timer.kind === "running")
          broadcastTimer({ ...timer, endsAt: Math.max(timer.endsAt, now) + 60_000 });
        if (timer.kind === "paused")
          broadcastTimer({ ...timer, remainingMs: timer.remainingMs + 60_000 });
        return;
      case "clearTimer":
        return broadcastTimer({ kind: "none" });
    }
  };

  const attach = async (page: Page, isOwner: boolean) => {
    await page.routeWebSocket(`**/ws/${CODE}`, (ws) => {
      sockets.push(ws);
      ws.onMessage((raw) => {
        const msg = JSON.parse(String(raw));
        if (msg.type === "hello") return ws.send(JSON.stringify(snapshot(isOwner)));
        intents.push(msg);
        applyIntent(msg);
        ws.send(JSON.stringify({ type: "ack", reqId: msg.reqId }));
      });
    });
  };

  const setPhase = (phase: string) => {
    room.phase = phase;
    room.timer = { kind: "none" };
    sockets.forEach((ws, index) => {
      ws.send(JSON.stringify(snapshot(index === 0)));
    });
  };

  return { attach, intents, broadcastTimer, setPhase };
}

async function openRoom(
  context: BrowserContext,
  mock: ReturnType<typeof createMockRoom>,
  isOwner: boolean,
) {
  const page = await context.newPage();
  await mock.attach(page, isOwner);
  await page.goto(`/r/${CODE}`);
  await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible();
  return page;
}

const clock = (page: Page) => page.getByRole("timer");

test("timer stays in sync across windows with a skewed local clock and never advances", async ({
  browser,
}) => {
  const mock = createMockRoom();
  const ownerContext = await browser.newContext();
  const skewedContext = await browser.newContext();
  await skewedContext.addInitScript((skew) => {
    const realNow = Date.now;
    Date.now = () => realNow() + skew;
  }, SKEW_MS);

  const owner = await openRoom(ownerContext, mock, true);
  const participant = await openRoom(skewedContext, mock, false);
  expect(await participant.evaluate(() => Date.now() - performance.timeOrigin)).toBeGreaterThan(
    SKEW_MS - 60_000,
  );

  await expect(participant.getByRole("button", { name: "Timer", exact: true })).toHaveCount(0);
  await expect(clock(participant)).toHaveCount(0);

  await owner.getByRole("button", { name: "Timer", exact: true }).click();
  await owner.getByRole("button", { name: "5 min", exact: true }).click();
  await expect
    .poll(() => mock.intents.at(-1))
    .toMatchObject({ type: "setTimer", durationMs: 300_000 });

  for (const page of [owner, participant]) {
    await expect(clock(page)).toHaveText(/^0(5:00|4:5\d)$/);
  }

  await owner.getByRole("button", { name: "Pause timer" }).click();
  for (const page of [owner, participant]) {
    await expect(page.getByText("Paused")).toBeVisible();
  }
  const pausedAt = await clock(owner).textContent();
  await expect(clock(participant)).toHaveText(pausedAt ?? "");

  await owner.getByRole("button", { name: "Add one minute" }).click();
  await expect(clock(owner)).not.toHaveText(pausedAt ?? "");
  const extended = await clock(owner).textContent();
  expect(extended).toMatch(/^0(6:00|5:5\d)$/);
  await expect(clock(participant)).toHaveText(extended ?? "");

  await owner.getByRole("button", { name: "Resume timer" }).click();
  await expect(owner.getByRole("button", { name: "Pause timer" })).toBeVisible();
  await expect(participant.getByText("Paused")).toHaveCount(0);

  mock.broadcastTimer({ kind: "running", endsAt: Date.now() + 1_500 });
  for (const page of [owner, participant]) {
    await expect(page.getByText("Time's up", { exact: true }).first()).toBeVisible();
    await expect(clock(page)).toHaveText("00:00");
    await expect(page.getByRole("listitem").filter({ hasText: "Write" })).toHaveAttribute(
      "aria-current",
      "step",
    );
  }
  expect(mock.intents.map((intent) => intent.type)).not.toContain("advance");

  await expect(owner.getByRole("button", { name: "Pause timer" })).toHaveCount(0);
  await owner.getByRole("button", { name: "Add one minute" }).click();
  await expect.poll(() => mock.intents.at(-1)).toMatchObject({ type: "addTimerMinute" });
  await expect(clock(participant)).toHaveText(/^0(1:00|0:5\d)$/);

  await owner.getByRole("button", { name: "Clear timer" }).click();
  for (const page of [owner, participant]) await expect(clock(page)).toHaveCount(0);
  await expect(owner.getByRole("button", { name: "Timer", exact: true })).toBeVisible();

  await ownerContext.close();
  await skewedContext.close();
});

test("owner sets a custom duration from the keyboard and the timer is hidden in done", async ({
  page,
}) => {
  const mock = createMockRoom();
  await mock.attach(page, true);
  await page.goto(`/r/${CODE}`);

  const trigger = page.getByRole("button", { name: "Timer", exact: true });
  await trigger.click();
  await expect(page.getByRole("button", { name: "1 min", exact: true })).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("button", { name: "1 min", exact: true })).toHaveCount(0);
  await expect(trigger).toBeFocused();

  await page.keyboard.press("Enter");
  const minutes = page.getByLabel("Custom minutes");
  await minutes.fill("61");
  await expect(page.getByRole("button", { name: "Start", exact: true })).toBeDisabled();
  await minutes.fill("12");
  await minutes.press("Enter");
  await expect
    .poll(() => mock.intents.at(-1))
    .toMatchObject({ type: "setTimer", durationMs: 12 * 60_000 });
  await expect(page.getByRole("timer")).toHaveText(/^1(2:00|1:5\d)$/);

  mock.setPhase("done");
  await expect(page.getByRole("listitem").filter({ hasText: "Done" })).toHaveAttribute(
    "aria-current",
    "step",
  );
  await expect(page.getByRole("button", { name: "Timer", exact: true })).toHaveCount(0);
  await expect(page.getByRole("timer")).toHaveCount(0);
});
