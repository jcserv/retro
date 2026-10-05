import type { Page, TestInfo } from "@playwright/test";
import { addItem, card, createRoom, expect, test } from "./fixtures";

const PHONE = { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true };

async function checkLayout(pages: Page[], phase: string, testInfo: TestInfo) {
  for (const [index, page] of pages.entries()) {
    const overflow = await page.evaluate<number>(
      "document.documentElement.scrollWidth - document.documentElement.clientWidth",
    );
    expect(overflow, `${phase} overflows horizontally`).toBeLessThanOrEqual(0);
    await testInfo.attach(`${phase}-${index === 0 ? "owner" : "participant"}`, {
      body: await page.screenshot({ fullPage: true }),
      contentType: "image/png",
    });
  }
}

test("live: every phase fits a phone and grouping works by tapping the menu", async ({
  newUser,
}, testInfo) => {
  const owner = await newUser(PHONE);
  const guest = await newUser(PHONE);
  const pages = [owner, guest];
  const code = await createRoom(owner);
  await guest.goto(`/r/${code}`);

  await addItem(owner, "What went less well?", "Deploys were slow");
  await addItem(guest, "What went less well?", "Rollbacks hurt");
  await addItem(guest, "What went well?", "Pairing sessions");
  await expect(owner.getByText("0/2 ready")).toBeVisible();
  await checkLayout(pages, "write", testInfo);

  await owner.getByRole("button", { name: "Start grouping" }).tap();
  await expect(guest.getByRole("heading", { name: "Group similar items" })).toBeVisible();
  await card(guest, "Rollbacks hurt").getByRole("button", { name: "Group with…" }).tap();
  await guest.getByRole("dialog").getByRole("button", { name: "Deploys were slow" }).tap();
  for (const page of pages) {
    await expect(card(page, "Deploys were slow")).toContainText("Rollbacks hurt");
  }
  await checkLayout(pages, "group", testInfo);

  await owner.getByRole("button", { name: "Start voting" }).tap();
  await guest.getByRole("button", { name: "Add a vote to Deploys were slow" }).tap();
  await expect(guest.getByText("4 of 5 votes left")).toBeVisible();
  await checkLayout(pages, "vote", testInfo);

  await owner.getByRole("button", { name: "Start discussion" }).tap();
  for (const page of pages) {
    await expect(page.getByRole("heading", { level: 2, name: "Deploys were slow" })).toBeVisible();
  }
  const comment = guest.getByRole("textbox", { name: "Add a comment" });
  await comment.fill("Cache the build");
  await comment.press("Enter");
  await expect(owner.getByText("Cache the build", { exact: true })).toBeVisible();
  await checkLayout(pages, "discuss", testInfo);

  await owner.getByRole("button", { name: "Next topic" }).tap();
  await owner.getByRole("button", { name: "Finish retro" }).tap();
  for (const page of pages) {
    await expect(page.getByRole("heading", { name: "Retro complete" })).toBeVisible();
  }
  await checkLayout(pages, "done", testInfo);
});
