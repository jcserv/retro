import { randomInt } from "node:crypto";
import {
  type BrowserContext,
  type BrowserContextOptions,
  test as base,
  expect,
  type Locator,
  type Page,
} from "@playwright/test";

export type NewUser = (options?: BrowserContextOptions) => Promise<Page>;

export const test = base.extend<{ newUser: NewUser }>({
  newUser: async ({ browser }, use) => {
    const ip = `10.${randomInt(256)}.${randomInt(256)}.${randomInt(256)}`;
    const contexts: BrowserContext[] = [];
    await use(async (options = {}) => {
      const context = await browser.newContext({
        ...options,
        extraHTTPHeaders: { "CF-Connecting-IP": ip },
      });
      contexts.push(context);
      return context.newPage();
    });
    await Promise.all(contexts.map((context) => context.close()));
  },
});

export { expect };

export async function createRoom(page: Page): Promise<string> {
  await page.goto("/");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
  return new URL(page.url()).pathname.split("/").at(-1) ?? "";
}

export const column = (page: Page, title: string) => page.getByRole("region", { name: title });

export async function addItem(page: Page, category: string, text: string) {
  const region = column(page, category);
  await region.getByRole("textbox").fill(text);
  await region.getByRole("textbox").press("Enter");
  await expect(region.getByRole("listitem").filter({ hasText: text })).toBeVisible();
  await expect(region.getByRole("textbox")).toHaveValue("");
}

export const card = (page: Page, text: string) =>
  page.locator("[data-group-card]").filter({ hasText: text });

export async function dragOnto(page: Page, sourceText: string, targetText: string) {
  await dragTo(page, card(page, sourceText).locator("p, li").first(), card(page, targetText));
}

export async function dragTo(page: Page, sourceLocator: Locator, targetLocator: Locator) {
  const source = await sourceLocator.boundingBox();
  const target = await targetLocator.boundingBox();
  if (!source || !target) throw new Error("missing drag source or target");
  await page.mouse.move(source.x + 10, source.y + 5);
  await page.mouse.down();
  await page.mouse.move(source.x + 30, source.y + 20, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
}

export async function touchDragOnto(page: Page, sourceText: string, targetText: string) {
  const source = await card(page, sourceText).locator("p, li").first().boundingBox();
  const target = await card(page, targetText).boundingBox();
  if (!source || !target) throw new Error("missing card");
  const cdp = await page.context().newCDPSession(page);
  const touch = (type: "touchStart" | "touchMove" | "touchEnd", x: number, y: number) =>
    cdp.send("Input.dispatchTouchEvent", {
      type,
      touchPoints: type === "touchEnd" ? [] : [{ x, y }],
    });
  const start = { x: source.x + 10, y: source.y + 5 };
  const end = { x: target.x + target.width / 2, y: target.y + target.height / 2 };
  await touch("touchStart", start.x, start.y);
  await page.waitForTimeout(400);
  for (let step = 1; step <= 10; step += 1) {
    await touch(
      "touchMove",
      start.x + ((end.x - start.x) * step) / 10,
      start.y + ((end.y - start.y) * step) / 10,
    );
  }
  await touch("touchEnd", end.x, end.y);
}
