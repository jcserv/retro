import {
  type Browser,
  type BrowserContextOptions,
  expect,
  type Page,
  test,
} from "@playwright/test";

const ITEMS: Record<string, string[]> = {
  "What went well?": ["Shipped on time", "Great pairing"],
  "What went less well?": ["Flaky CI", "Too many meetings"],
  "What do we want to try next?": ["Quarantine flaky tests", "No-meeting Wednesdays"],
};

async function openGroupPhase(browser: Browser, guestOptions: BrowserContextOptions = {}) {
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext(guestOptions);
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();

  await owner.goto("/");
  await owner.getByRole("button", { name: "Create room" }).click();
  await expect(owner).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
  for (const [category, texts] of Object.entries(ITEMS)) {
    const region = owner.getByRole("region", { name: category });
    for (const text of texts) {
      await region.getByRole("textbox").fill(text);
      await region.getByRole("textbox").press("Enter");
      await expect(region.getByRole("listitem").filter({ hasText: text })).toBeVisible();
    }
  }
  await owner.getByRole("button", { name: "Start grouping" }).click();
  await expect(owner.getByRole("heading", { name: "Group similar items" })).toBeVisible();

  await guest.goto(owner.url());
  await expect(guest.getByRole("heading", { name: "Group similar items" })).toBeVisible();
  const close = async () => {
    await ownerContext.close();
    await guestContext.close();
  };
  return { owner, guest, close };
}

const card = (page: Page, text: string) =>
  page.locator("[data-group-card]").filter({ hasText: text });

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

async function dragOnto(page: Page, sourceText: string, targetText: string) {
  const source = await card(page, sourceText).locator("p, li").first().boundingBox();
  const target = await card(page, targetText).boundingBox();
  if (!source || !target) throw new Error("missing card");
  await page.mouse.move(source.x + 10, source.y + 5);
  await page.mouse.down();
  await page.mouse.move(source.x + 30, source.y + 20, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
}

test("live: two windows grouping concurrently converge", async ({ browser }) => {
  const { owner, guest, close } = await openGroupPhase(browser);

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

  await close();
});

test("live: keyboard-only grouping, rename, and ungroup", async ({ browser }) => {
  const { owner, guest, close } = await openGroupPhase(browser);

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

  await close();
});

test("live: touch long-press drag groups cards", async ({ browser }) => {
  const { owner, guest, close } = await openGroupPhase(browser, {
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

  await close();
});
