import { randomInt } from "node:crypto";
import {
  type BrowserContext,
  type BrowserContextOptions,
  test as base,
  expect,
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
  const source = await card(page, sourceText).locator("p, li").first().boundingBox();
  const target = await card(page, targetText).boundingBox();
  if (!source || !target) throw new Error("missing card");
  await page.mouse.move(source.x + 10, source.y + 5);
  await page.mouse.down();
  await page.mouse.move(source.x + 30, source.y + 20, { steps: 4 });
  await page.mouse.move(target.x + target.width / 2, target.y + target.height / 2, { steps: 10 });
  await page.mouse.up();
}
