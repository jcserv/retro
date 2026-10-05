import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { type Browser, expect, type Page, test } from "@playwright/test";

async function openAs(browser: Browser, clientId: string, code: string): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript((id) => localStorage.setItem("retro.clientId", id), clientId);
  const page = await context.newPage();
  await page.goto(`/r/${code}`);
  return page;
}

test("vote, discuss and done stay in sync across two windows", async ({ browser }) => {
  const ownerContext = await browser.newContext();
  const ownerPage = await ownerContext.newPage();
  await ownerPage.goto("/");
  await ownerPage.getByRole("button", { name: "Create room" }).click();
  await expect(ownerPage).toHaveURL(/\/r\/[A-Z0-9]{6}$/);
  const code = new URL(ownerPage.url()).pathname.split("/").at(-1) ?? "";
  const peerPage = await openAs(browser, randomUUID(), code);

  const write = async (category: string, text: string) => {
    const column = ownerPage.getByRole("region", { name: category });
    await column.getByRole("textbox").fill(text);
    await expect(column.getByRole("button", { name: "Add" })).toBeEnabled();
    await column.getByRole("textbox").press("Enter");
    await expect(column.getByRole("listitem").filter({ hasText: text })).toBeVisible();
  };
  await write("What went less well?", "Deploys were slow");
  await write("What went less well?", "Rollbacks hurt");
  await write("What went well?", "Pairing sessions");
  await write("What puzzles us?", "Flaky CI");

  await ownerPage.getByRole("button", { name: "Start grouping" }).click();
  await expect(ownerPage.getByRole("button", { name: "Start voting" })).toBeVisible();
  await ownerPage
    .getByRole("article", { name: "Rollbacks hurt" })
    .getByRole("button", { name: "Group with…" })
    .click();
  await ownerPage.getByRole("dialog").getByRole("button", { name: "Deploys were slow" }).click();
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
  await expect(peerPage.getByRole("button", { name: "Download .md" })).toBeVisible();

  const peerComment = peerPage.getByRole("textbox", { name: "Add a comment" });
  await peerComment.fill("Need faster pipelines");
  await peerComment.press("Enter");
  await expect(peerComment).toHaveValue("");
  await expect(ownerPage.getByText("Need faster pipelines", { exact: true })).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Edit comment" })).toHaveCount(0);

  await peerPage.getByRole("button", { name: "Edit comment" }).click();
  await peerPage.getByRole("textbox", { name: "Edit comment" }).fill("Need much faster pipelines");
  await peerPage.getByRole("button", { name: "Save" }).click();
  await expect(ownerPage.getByText("Need much faster pipelines", { exact: true })).toBeVisible();
  await expect(ownerPage.getByText("edited")).toBeVisible();
  await peerPage.getByRole("button", { name: "Delete comment" }).click();
  await expect(ownerPage.getByText("No comments yet.")).toBeVisible();
  await expect(peerComment).toBeFocused();

  await ownerPage.getByRole("textbox", { name: "New action item" }).fill("Cache docker layers");
  await ownerPage.getByRole("textbox", { name: "Assignee" }).fill("Sam");
  await ownerPage.getByRole("button", { name: "Add action" }).click();
  await expect(peerPage.getByText("Cache docker layers", { exact: true })).toBeVisible();
  await expect(peerPage.getByText("Assigned to Sam", { exact: true })).toBeVisible();
  await expect(peerPage.getByRole("button", { name: "Edit action item" })).toHaveCount(0);
  await ownerPage.getByRole("button", { name: "Edit action item" }).click();
  await ownerPage.getByRole("textbox", { name: "Edit assignee" }).fill("Alex");
  await ownerPage.getByRole("button", { name: "Save" }).click();
  await expect(peerPage.getByText("Assigned to Alex", { exact: true })).toBeVisible();

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
  expect(markdown).toContain("  - [ ] Cache docker layers (Alex)");
});
