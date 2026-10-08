import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { addItem, createRoom, dragOnto, expect, test } from "./fixtures";

test("live: voting budget, discuss skip and navigation, and done", async ({ newUser }) => {
  const ownerPage = await newUser();
  const peerPage = await newUser();
  const code = await createRoom(ownerPage);
  await peerPage.goto(`/r/${code}`);

  await addItem(ownerPage, "What went less well?", "Deploys were slow");
  await addItem(ownerPage, "What went less well?", "Rollbacks hurt");
  await addItem(ownerPage, "What went well?", "Pairing sessions");
  await addItem(ownerPage, "What puzzles us?", "Flaky CI");

  await ownerPage.getByRole("button", { name: "Start grouping" }).click();
  await expect(ownerPage.getByRole("button", { name: "Start voting" })).toBeVisible();
  await dragOnto(ownerPage, "Rollbacks hurt", "Deploys were slow");
  await expect(ownerPage.getByRole("article", { name: "Deploys were slow" })).toContainText(
    "Rollbacks hurt",
  );
  await ownerPage.getByRole("button", { name: "Fewer votes per person" }).click();
  await expect(ownerPage.getByText("Votes per person: 4")).toBeVisible();
  await ownerPage.getByRole("button", { name: "Fewer votes per person" }).click();
  await expect(ownerPage.getByText("Votes per person: 3")).toBeVisible();
  await ownerPage.getByRole("button", { name: "Start voting" }).click();
  const vote = (page: Page, title: string) =>
    page.getByRole("button", { name: `Add a vote to ${title}` }).click();

  await expect(ownerPage.getByRole("heading", { name: "Vote on what to discuss" })).toBeVisible();
  await expect(ownerPage.getByText("Rollbacks hurt")).toBeVisible();
  await expect(ownerPage.getByRole("status").filter({ hasText: "votes left" })).toHaveText(
    "3 of 3 votes left",
  );

  await vote(ownerPage, "Deploys were slow");
  await vote(ownerPage, "Deploys were slow");
  await expect(ownerPage.getByText("1 of 3 votes left")).toBeVisible();
  await vote(ownerPage, "Pairing sessions");
  await expect(ownerPage.getByText("0 of 3 votes left")).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Add a vote to Flaky CI" })).toBeDisabled();
  await ownerPage.getByRole("button", { name: "Remove a vote from Pairing sessions" }).click();
  await expect(ownerPage.getByRole("button", { name: "Add a vote to Flaky CI" })).toBeEnabled();
  await vote(ownerPage, "Pairing sessions");

  await vote(peerPage, "Deploys were slow");
  await vote(peerPage, "Flaky CI");
  await expect(peerPage.getByText("1 of 3 votes left")).toBeVisible();
  await expect(ownerPage.getByText("0 of 3 votes left")).toBeVisible();

  await ownerPage.getByRole("button", { name: "Start discussion" }).click();

  for (const page of [ownerPage, peerPage]) {
    await expect(page.getByRole("heading", { level: 2, name: "Deploys were slow" })).toBeVisible();
    await expect(page.getByText("Topic 1 of 3", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Items").getByText("Rollbacks hurt")).toBeVisible();
  }
  await expect(peerPage.getByRole("button", { name: "Next topic" })).toHaveCount(0);
  await expect(peerPage.getByRole("button", { name: "Download .md" })).toHaveCount(0);

  const peerComment = peerPage.getByRole("textbox", { name: "Add a comment" });
  await peerComment.fill("Need faster pipelines");
  await peerComment.press("Enter");
  await expect(peerComment).toHaveValue("");
  await expect(ownerPage.getByText("Need faster pipelines", { exact: true })).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Edit comment" })).toHaveCount(0);

  await peerPage.getByRole("button", { name: "Delete comment" }).click();
  await expect(ownerPage.getByText("Need faster pipelines", { exact: true })).toHaveCount(0);
  await expect(peerComment).toBeFocused();

  await ownerPage.getByRole("textbox", { name: "New action item" }).fill("Cache docker layers");
  await ownerPage.getByRole("textbox", { name: "Assignee" }).fill("Sam");
  await ownerPage.getByRole("button", { name: "Add action" }).click();
  await expect(peerPage.getByText("Cache docker layers", { exact: true })).toBeVisible();
  await expect(peerPage.getByText("Assigned to Sam", { exact: true })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Next topic" }).click();
  await expect(peerPage.getByText("Topic 2 of 3", { exact: true })).toBeVisible();
  await expect(peerPage.getByRole("heading", { level: 2, name: "Pairing sessions" })).toBeVisible();
  await ownerPage.getByRole("button", { name: "Skip" }).click();
  await expect(peerPage.getByRole("heading", { level: 2, name: "Flaky CI" })).toBeVisible();
  await expect(
    peerPage.getByRole("listitem").filter({ hasText: "Pairing sessions" }),
  ).toContainText("Skipped");
  await expect(ownerPage.getByRole("button", { name: "Next topic" })).toBeDisabled();
  await ownerPage.getByRole("button", { name: "Previous" }).click();
  await expect(peerPage.getByRole("heading", { level: 2, name: "Pairing sessions" })).toBeVisible();

  const agenda = (page: Page) => page.getByRole("complementary", { name: "Agenda" });
  await expect(agenda(peerPage).getByRole("button")).toHaveCount(0);
  await expect(agenda(ownerPage).getByRole("button", { name: /Pairing sessions/ })).toHaveCount(0);
  await agenda(ownerPage)
    .getByRole("button", { name: /Deploys were slow/ })
    .click();
  await expect(peerPage.getByText("Topic 1 of 3", { exact: true })).toBeVisible();
  await expect(
    peerPage.getByRole("heading", { level: 2, name: "Deploys were slow" }),
  ).toBeVisible();
  await agenda(ownerPage)
    .getByRole("button", { name: /Flaky CI/ })
    .click();
  await expect(peerPage.getByRole("heading", { level: 2, name: "Flaky CI" })).toBeVisible();

  await ownerPage.getByRole("button", { name: "Finish retro" }).click();

  for (const page of [ownerPage, peerPage]) {
    await expect(page.getByRole("heading", { name: "Retro complete" })).toBeVisible();
    await expect(page.getByText("3 of 3 topics discussed · 1 action item")).toBeVisible();
    const actions = page.getByRole("region", { name: "Action items" }).first();
    await expect(actions).toContainText("Cache docker layers");
    await expect(page.getByRole("button", { name: "Edit action item" })).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
  }

  const [download] = await Promise.all([
    peerPage.waitForEvent("download"),
    peerPage.getByRole("button", { name: "Download .md" }).click(),
  ]);
  const markdown = await readFile(await download.path(), "utf8");
  expect(markdown).toContain("### 1. Deploys were slow (3 votes) [What went less well?]");
  expect(markdown).toContain("  - [ ] Cache docker layers (Sam)");
});
