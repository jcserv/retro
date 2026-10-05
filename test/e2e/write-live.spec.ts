import { expect, test } from "@playwright/test";

test("live: create, join by code, write privately, ready up, and advance", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();

  await owner.goto("/");
  await owner.getByRole("button", { name: "Create room" }).click();
  await expect(owner).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
  const code = new URL(owner.url()).pathname.split("/").at(-1) ?? "";

  await guest.goto("/");
  await guest.getByLabel("Room code").fill(code.toLowerCase());
  await guest.getByRole("button", { name: "Join" }).click();
  await expect(guest).toHaveURL(`/r/${code}`);
  await expect(guest.getByRole("button", { name: "I'm ready" })).toBeEnabled();
  await expect(guest.getByRole("button", { name: "Start grouping" })).toHaveCount(0);
  await expect(owner.getByText("0/2 ready")).toBeVisible();

  const ownerWell = owner.getByRole("region", { name: "What went well?" });
  const guestWell = guest.getByRole("region", { name: "What went well?" });
  await ownerWell.getByRole("textbox").fill("Shipped on time");
  await ownerWell.getByRole("textbox").press("Enter");
  await guestWell.getByRole("textbox").fill("Great pairing");
  await guestWell.getByRole("textbox").press("Enter");

  await expect(ownerWell.getByText("2 items")).toBeVisible();
  await expect(guestWell.getByText("2 items")).toBeVisible();
  await expect(ownerWell.getByRole("listitem")).toHaveText(["Shipped on time"]);
  await expect(guestWell.getByRole("listitem")).toHaveText(["Great pairing"]);

  await guest.getByRole("button", { name: "I'm ready" }).click();
  await expect(owner.getByText("1/2 ready")).toBeVisible();

  await owner.getByRole("button", { name: "Start grouping" }).click();
  await expect(guest.locator('[aria-current="step"]')).toHaveText(/Group/);
  await expect(owner.getByRole("button", { name: "Start voting" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "I'm ready" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );

  await ownerContext.close();
  await guestContext.close();
});
