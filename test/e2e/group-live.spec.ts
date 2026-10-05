import type { BrowserContextOptions, Page } from "@playwright/test";
import { addItem, card, createRoom, dragOnto, expect, type NewUser, test } from "./fixtures";

const ITEMS: Record<string, string[]> = {
  "What went well?": ["Shipped on time", "Great pairing"],
  "What went less well?": ["Flaky CI", "Too many meetings"],
  "What do we want to try next?": ["Quarantine flaky tests", "No-meeting Wednesdays"],
};

async function openGroupPhase(newUser: NewUser, guestOptions: BrowserContextOptions = {}) {
  const owner = await newUser();
  const guest = await newUser(guestOptions);
  const code = await createRoom(owner);
  for (const [category, texts] of Object.entries(ITEMS)) {
    for (const text of texts) await addItem(owner, category, text);
  }
  await owner.getByRole("button", { name: "Start grouping" }).click();
  await expect(owner.getByRole("heading", { name: "Group similar items" })).toBeVisible();

  await guest.goto(`/r/${code}`);
  await expect(guest.getByRole("heading", { name: "Group similar items" })).toBeVisible();
  return { owner, guest };
}

function boardSnapshot(page: Page) {
  return page.locator("section[aria-labelledby]").evaluateAll((columns) =>
    columns.map((column) => ({
      title: column.querySelector("h2")?.textContent,
      cards: [...column.querySelectorAll("[data-group-card]")].map((article) =>
        article.textContent?.replace(/\s+/g, " ").trim(),
      ),
    })),
  );
}

test("live: two windows grouping concurrently converge", async ({ newUser }) => {
  const { owner, guest } = await openGroupPhase(newUser);

  const ownerDrag = dragOnto(owner, "Flaky CI", "Quarantine flaky tests");
  const guestMenu = (async () => {
    await card(guest, "Great pairing").getByRole("button", { name: "Group with…" }).click();
    await guest.getByRole("dialog").getByRole("button", { name: "Shipped on time" }).click();
  })();
  await Promise.all([ownerDrag, guestMenu]);

  for (const page of [owner, guest]) {
    await expect(card(page, "Flaky CI")).toContainText("Quarantine flaky tests");
    await expect(card(page, "Great pairing")).toContainText("Shipped on time");
  }
  await expect.poll(() => boardSnapshot(guest)).toEqual(await boardSnapshot(owner));
});

test("live: keyboard-only grouping, rename, and ungroup", async ({ newUser }) => {
  const { owner, guest } = await openGroupPhase(newUser);

  await card(owner, "Too many meetings").getByRole("button", { name: "Group with…" }).focus();
  await owner.keyboard.press("Enter");
  const dialog = owner.getByRole("dialog");
  await expect(dialog.getByRole("searchbox", { name: "Search groups" })).toBeFocused();
  await owner.keyboard.type("wednes");
  await owner.keyboard.press("Enter");
  await expect(dialog).toBeHidden();

  const merged = card(owner, "No-meeting Wednesdays");
  await expect(merged).toContainText("Too many meetings");
  await expect(merged).toContainText("2 items");
  await expect(merged).toBeFocused();

  await merged.getByRole("button", { name: /rename group/ }).focus();
  await owner.keyboard.press("Enter");
  await owner.keyboard.type("Meetings");
  await owner.keyboard.press("Enter");
  await expect(merged.getByRole("button", { name: /rename group/ })).toBeFocused();
  await expect(card(guest, "No-meeting Wednesdays").getByRole("heading")).toHaveText(/Meetings/);

  await merged.getByRole("button", { name: "Ungroup “Too many meetings”" }).focus();
  await owner.keyboard.press("Enter");
  const lessWell = guest.getByRole("region", { name: "What went less well?" });
  await expect(
    lessWell.locator("[data-group-card]").filter({ hasText: "Too many meetings" }),
  ).toBeVisible();
  await expect(card(guest, "No-meeting Wednesdays")).not.toContainText("Too many meetings");
});

test("live: touch long-press drag groups cards", async ({ newUser }) => {
  const { owner, guest } = await openGroupPhase(newUser, {
    viewport: { width: 375, height: 812 },
    hasTouch: true,
    isMobile: true,
  });

  const source = await card(guest, "Great pairing").locator("p").boundingBox();
  const target = await card(guest, "Shipped on time").boundingBox();
  if (!source || !target) throw new Error("missing card");
  const cdp = await guest.context().newCDPSession(guest);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  const start = { x: source.x + 10, y: source.y + 5 };
  const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  await touch("touchStart", start.x, start.y);
  await guest.waitForTimeout(400);
  for (let step = 1; step <= 10; step += 1) {
    await touch(
      "touchMove",
      start.x + ((end.x - start.x) * step) / 10,
      start.y + ((end.y - start.y) * step) / 10,
    );
  }
  await touch("touchEnd", end.x, end.y);

  await expect(card(guest, "Shipped on time")).toContainText("Great pairing");
  await expect(card(owner, "Shipped on time")).toContainText("Great pairing");
});
