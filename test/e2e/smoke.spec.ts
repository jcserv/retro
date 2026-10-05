import { expect, test } from "@playwright/test";

test("serves the app and the stub API", async ({ page, request }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Retro", exact: true })).toBeVisible();

  const response = await request.get("/api/nope");
  expect(response.status()).toBe(404);
});
