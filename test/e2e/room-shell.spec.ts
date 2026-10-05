import { expect, test } from "@playwright/test";

const CODE = "ABC234";

function snapshot(phase: string) {
  const now = Date.now();
  return {
    type: "snapshot",
    room: {
      code: CODE,
      createdAt: now,
      expiresAt: now + 86_400_000,
      serverNow: now,
      phase,
      categories: [{ id: "well", title: "What went well?" }],
      isOwner: true,
      presence: { participantCount: 1, connectedCount: 1, readyCount: 0 },
      youReady: false,
      timer: { kind: "none" },
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
}

test("room page says hello, renders the snapshot phase, and follows phase changes", async ({
  page,
}) => {
  const hellos: unknown[] = [];
  let push: (msg: unknown) => void = () => {};
  await page.routeWebSocket(`**/ws/${CODE}`, (ws) => {
    push = (msg) => ws.send(JSON.stringify(msg));
    ws.onMessage((raw) => {
      const msg = JSON.parse(String(raw));
      if (msg.type === "hello") {
        hellos.push(msg);
        push(snapshot("write"));
      }
    });
  });

  await page.goto(`/r/${CODE.toLowerCase()}`);
  await expect(page).toHaveURL(`/r/${CODE}`);
  await expect(page.getByRole("heading", { name: "Write phase" })).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Live" })).toBeVisible();
  expect(hellos).toEqual([{ type: "hello", clientId: expect.stringMatching(/^[0-9a-f-]{36}$/) }]);

  push(snapshot("vote"));
  await expect(page.getByRole("heading", { name: "Vote phase" })).toBeVisible();
  await expect(page.getByRole("listitem").filter({ hasText: "Vote" })).toHaveAttribute(
    "aria-current",
    "step",
  );
});

test("a not-found close code shows room not found", async ({ page }) => {
  await page.routeWebSocket(`**/ws/${CODE}`, (ws) => {
    ws.onMessage(() => ws.close({ code: 4004, reason: "not found" }));
  });
  await page.goto(`/r/${CODE}`);
  await expect(page.getByRole("heading", { name: "Room not found" })).toBeVisible();
});

test("an invalid room code shows room not found without connecting", async ({ page }) => {
  await page.goto("/r/NOPE");
  await expect(page.getByRole("heading", { name: "Room not found" })).toBeVisible();
});
