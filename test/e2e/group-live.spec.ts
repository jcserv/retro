import type { BrowserContextOptions, Page } from "@playwright/test";
import {
  addItem,
  card,
  column,
  createRoom,
  dragOnto,
  dragTo,
  expect,
  type NewUser,
  test,
  touchDragOnto,
} from "./fixtures";

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

  await Promise.all([
    dragOnto(owner, "Flaky CI", "Quarantine flaky tests"),
    dragOnto(guest, "Great pairing", "Shipped on time"),
  ]);

  for (const page of [owner, guest]) {
    await expect(card(page, "Flaky CI")).toContainText("Quarantine flaky tests");
    await expect(card(page, "Great pairing")).toContainText("Shipped on time");
  }
  await expect.poll(() => boardSnapshot(guest)).toEqual(await boardSnapshot(owner));
});

test("live: keyboard rename and drag out to ungroup", async ({ newUser }) => {
  const { owner, guest } = await openGroupPhase(newUser);

  await dragOnto(owner, "Too many meetings", "No-meeting Wednesdays");
  const merged = card(owner, "No-meeting Wednesdays");
  await expect(merged).toContainText("Too many meetings");
  await expect(merged).toContainText("2 items");

  await merged.getByRole("button", { name: /rename group/ }).focus();
  await owner.keyboard.press("Enter");
  await owner.keyboard.type("Meetings");
  await owner.keyboard.press("Enter");
  await expect(merged.getByRole("button", { name: /rename group/ })).toBeFocused();
  await expect(card(guest, "No-meeting Wednesdays").getByRole("heading")).toHaveText(/Meetings/);

  await dragTo(
    owner,
    merged.getByRole("listitem").filter({ hasText: "Too many meetings" }),
    column(owner, "What went less well?").locator("header"),
  );
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

  await touchDragOnto(guest, "Great pairing", "Shipped on time");

  await expect(card(guest, "Shipped on time")).toContainText("Great pairing");
  await expect(card(owner, "Shipped on time")).toContainText("Great pairing");
});
