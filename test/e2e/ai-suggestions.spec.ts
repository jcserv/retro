import type { BrowserContextOptions, Page } from "@playwright/test";
import { addItem, card, createRoom, expect, test } from "./fixtures";

const VIEWPORTS: Array<[string, BrowserContextOptions]> = [
  ["desktop", { viewport: { width: 1280, height: 900 } }],
  ["phone", { viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true }],
];

const suggestion = (page: Page, title: string) =>
  page
    .getByRole("region", { name: "Suggested groups" })
    .getByRole("listitem")
    .filter({ has: page.getByRole("heading", { name: title }) });

for (const [name, options] of VIEWPORTS) {
  test(`${name}: the owner reviews AI suggestions and only accepted ones change the board`, async ({
    newUser,
  }) => {
    const owner = await newUser(options);
    const guest = await newUser(options);
    const code = await createRoom(owner);
    await guest.goto(`/r/${code}`);

    await addItem(owner, "What went well?", "Deploys were fast");
    await addItem(guest, "What went well?", "Deploys never broke");
    await addItem(owner, "What went less well?", "Standup ran long");
    await addItem(guest, "What went less well?", "Standup started late");
    await addItem(owner, "What puzzles us?", "Flaky login test");
    await addItem(guest, "What puzzles us?", "Flaky tests in CI");
    await owner.getByRole("button", { name: "Start grouping" }).click();
    await expect(guest.getByRole("heading", { name: "Group similar items" })).toBeVisible();

    await owner.getByRole("button", { name: "Suggest groups" }).click();
    await expect(suggestion(owner, "Deploys")).toContainText("New group");
    await expect(owner.getByRole("button", { name: /Suggest again in \d+s/ })).toBeDisabled();
    const overflow = await owner.evaluate<number>(
      "document.documentElement.scrollWidth - document.documentElement.clientWidth",
    );
    expect(overflow).toBeLessThanOrEqual(0);

    await suggestion(owner, "Deploys").getByRole("button", { name: "Accept" }).click();
    await expect(suggestion(owner, "Deploys")).toHaveCount(0);
    await suggestion(owner, "Standup").getByRole("button", { name: "Dismiss" }).click();
    await expect(suggestion(owner, "Standup")).toHaveCount(0);
    await owner.getByRole("button", { name: "Accept all" }).click();
    await expect(owner.getByRole("region", { name: "Suggested groups" })).toHaveCount(0);

    for (const page of [owner, guest]) {
      await expect(card(page, "Deploys were fast")).toContainText("Deploys never broke");
      await expect(card(page, "Deploys were fast").getByRole("heading").first()).toContainText(
        "Deploys",
      );
      await expect(card(page, "Flaky login test")).toContainText("Flaky tests in CI");
      await expect(card(page, "Standup ran long")).not.toContainText("Standup started late");
    }
    await expect(guest.getByRole("button", { name: /Suggest/ })).toHaveCount(0);
    await expect(guest.getByRole("region", { name: "Suggested groups" })).toHaveCount(0);
  });
}
