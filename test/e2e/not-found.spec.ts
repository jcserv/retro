import { expect, test } from "@playwright/test";

const MISSING = "ZZZZ22";

test("live: joining a nonexistent code from home shows room not found", async ({ page }) => {
  await page.goto("/");
  await page.getByLabel("Room code").fill(MISSING);
  await page.getByRole("button", { name: "Join" }).click();

  await expect(page.getByRole("alert")).toHaveText("Room not found. It may have expired.");
  await expect(page).toHaveURL("/");
});

test("live: a direct link to a nonexistent room shows room not found", async ({ page }) => {
  await page.goto(`/r/${MISSING}`);
  await expect(page.getByRole("heading", { name: "Room not found" })).toBeVisible();
  await page.getByRole("link", { name: "Back to home" }).click();
  await expect(page.getByRole("button", { name: "Create room" })).toBeVisible();
});
