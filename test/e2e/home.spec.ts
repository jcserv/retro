import { expect, test } from "@playwright/test";
import { FakeRoom } from "./fakeRoom";

test("create room posts the client id and opens the new room", async ({ page, context }) => {
  const room = new FakeRoom("XYZ789");
  await room.attach(context);
  let body: unknown;
  await page.route("**/api/rooms", async (route) => {
    body = route.request().postDataJSON();
    await route.fulfill({ status: 201, json: { code: room.code } });
  });

  await page.goto("/");
  await page.getByRole("button", { name: "Create room" }).click();

  await expect(page).toHaveURL(`/r/${room.code}`);
  await expect(page.getByRole("button", { name: "Start grouping" })).toBeVisible();
  expect(body).toEqual({ clientId: expect.stringMatching(/^[0-9a-f-]{36}$/) });
});

test("create room explains the rate limit", async ({ page }) => {
  await page.route("**/api/rooms", (route) => route.fulfill({ status: 429 }));
  await page.goto("/");
  await page.getByRole("button", { name: "Create room" }).click();
  await expect(page.getByRole("alert")).toHaveText(
    "Too many rooms created, try again in a minute.",
  );
  await expect(page.getByRole("button", { name: "Create room" })).toBeEnabled();
});

test("join upper-cases the code and opens an existing room", async ({ page, context }) => {
  const room = new FakeRoom("QRS234");
  await room.attach(context);
  await page.route("**/api/rooms/QRS234", (route) => route.fulfill({ json: { exists: true } }));

  await page.goto("/");
  await page.getByLabel("Room code").fill("qrs234");
  await expect(page.getByLabel("Room code")).toHaveValue("QRS234");
  await page.getByRole("button", { name: "Join" }).click();

  await expect(page).toHaveURL("/r/QRS234");
});

test("join shows room not found inline", async ({ page }) => {
  await page.route("**/api/rooms/ABC234", (route) => route.fulfill({ status: 404 }));
  await page.goto("/");
  await page.getByLabel("Room code").fill("ABC234");
  await page.getByLabel("Room code").press("Enter");

  await expect(page.getByRole("alert")).toHaveText("Room not found. It may have expired.");
  await expect(page).toHaveURL("/");
});

test("join rejects a malformed code without a request", async ({ page }) => {
  let requested = false;
  await page.route("**/api/rooms/**", (route) => {
    requested = true;
    return route.fulfill({ status: 404 });
  });
  await page.goto("/");
  await page.getByLabel("Room code").fill("AB1");
  await page.getByRole("button", { name: "Join" }).click();

  await expect(page.getByRole("alert")).toHaveText("Room codes are 6 letters and numbers.");
  expect(requested).toBe(false);
});
