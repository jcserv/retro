import { readFile } from "node:fs/promises";
import type { Page } from "@playwright/test";
import { LIMITS } from "../../src/shared/constants";
import { addItem, card, column, createRoom, dragOnto, expect, test } from "./fixtures";

const WELL = "What went well?";
const LESS_WELL = "What went less well?";
const TRY_NEXT = "What do we want to try next?";

const heading = (page: Page, name: string) => page.getByRole("heading", { level: 2, name });

test("live: full retro with an owner and two participants", async ({ newUser }) => {
  const owner = await newUser({ permissions: ["clipboard-read", "clipboard-write"] });
  const alice = await newUser();
  const bob = await newUser();
  const everyone = [owner, alice, bob];

  const code = await createRoom(owner);

  await alice.goto("/");
  await alice.getByLabel("Room code").fill(code.toLowerCase());
  await alice.getByRole("button", { name: "Join" }).click();
  await expect(alice).toHaveURL(`/r/${code}`);

  await owner.getByRole("button", { name: "Copy link" }).click();
  await expect(owner.getByRole("button", { name: "Copied" })).toBeVisible();
  await bob.goto(await owner.evaluate<string>("navigator.clipboard.readText()"));
  await expect(bob).toHaveURL(`/r/${code}`);

  for (const page of [alice, bob]) {
    await expect(page.getByRole("heading", { name: "Write phase" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start grouping" })).toHaveCount(0);
  }
  await expect(owner.getByText("0/3 ready")).toBeVisible();

  await addItem(owner, WELL, "Shipped on time");
  await addItem(owner, LESS_WELL, "Too many meetings");
  await addItem(alice, LESS_WELL, "Flaky CI");
  await addItem(bob, TRY_NEXT, "Quarantine flaky tests");

  for (const page of everyone) {
    await expect(column(page, WELL).getByText("1 item", { exact: true })).toBeVisible();
    await expect(column(page, LESS_WELL).getByText("2 items", { exact: true })).toBeVisible();
    await expect(column(page, TRY_NEXT).getByText("1 item", { exact: true })).toBeVisible();
  }
  await expect(column(owner, LESS_WELL).getByRole("listitem")).toHaveText(["Too many meetings"]);
  await expect(column(alice, LESS_WELL).getByRole("listitem")).toHaveText(["Flaky CI"]);
  await expect(column(bob, LESS_WELL).getByRole("listitem")).toHaveCount(0);
  await expect(owner.getByText("Flaky CI")).toHaveCount(0);
  await expect(owner.getByText("Quarantine flaky tests")).toHaveCount(0);
  await expect(alice.getByText("Shipped on time")).toHaveCount(0);
  await expect(bob.getByText("Flaky CI")).toHaveCount(0);

  await alice.getByRole("button", { name: "I'm ready" }).click();
  await expect(owner.getByText("1/3 ready")).toBeVisible();
  await bob.getByRole("button", { name: "I'm ready" }).click();
  await expect(owner.getByText("2/3 ready")).toBeVisible();

  await owner.getByRole("button", { name: "Start grouping" }).click();
  for (const page of everyone) {
    await expect(page.getByRole("heading", { name: "Group similar items" })).toBeVisible();
    await expect(card(page, "Flaky CI")).toBeVisible();
  }

  await dragOnto(owner, "Flaky CI", "Quarantine flaky tests");
  for (const page of everyone) {
    const merged = column(page, TRY_NEXT).locator("[data-group-card]");
    await expect(merged).toHaveCount(1);
    await expect(merged).toContainText("Flaky CI");
    await expect(merged).toContainText("Quarantine flaky tests");
    await expect(column(page, LESS_WELL).locator("[data-group-card]")).toHaveText([
      /Too many meetings/,
    ]);
  }

  const merged = card(alice, "Quarantine flaky tests");
  await merged.getByRole("button", { name: /rename group/ }).click();
  await alice.keyboard.type("CI health");
  await alice.keyboard.press("Enter");
  for (const page of everyone) {
    await expect(card(page, "Quarantine flaky tests").getByRole("heading")).toHaveText(/CI health/);
  }

  const fewer = owner.getByRole("button", { name: "Fewer votes per person" });
  for (let limit = LIMITS.voteLimitDefault - 1; limit >= 2; limit -= 1) {
    await fewer.click();
    await expect(owner.getByText(`Votes per person: ${limit}`)).toBeVisible();
  }

  await owner.getByRole("button", { name: "Start voting" }).click();
  for (const page of everyone) {
    await expect(page.getByRole("heading", { name: "Vote on what to discuss" })).toBeVisible();
    await expect(page.getByText("2 of 2 votes left")).toBeVisible();
  }

  const vote = (page: Page, title: string) =>
    page.getByRole("button", { name: `Add a vote to ${title}` }).click();
  await vote(alice, "CI health");
  await expect(alice.getByText("1 of 2 votes left")).toBeVisible();
  await vote(alice, "CI health");
  await expect(alice.getByText("0 of 2 votes left")).toBeVisible();
  await expect(alice.getByRole("button", { name: "Add a vote to Shipped on time" })).toBeDisabled();
  await expect(alice.getByRole("button", { name: "Add a vote to CI health" })).toBeDisabled();
  await vote(bob, "CI health");
  await expect(bob.getByText("1 of 2 votes left")).toBeVisible();
  await vote(bob, "Shipped on time");
  await expect(bob.getByText("0 of 2 votes left")).toBeVisible();
  await vote(owner, "Shipped on time");
  await expect(owner.getByText("1 of 2 votes left")).toBeVisible();

  await owner.getByRole("button", { name: "Start discussion" }).click();
  for (const page of everyone) {
    await expect(heading(page, "CI health")).toBeVisible();
    await expect(page.getByText("Topic 1 of 3", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Items").getByText("Flaky CI")).toBeVisible();
  }
  await expect(alice.getByRole("button", { name: "Next topic" })).toHaveCount(0);

  await owner.getByRole("button", { name: "Timer", exact: true }).click();
  await owner.getByRole("button", { name: "5 min", exact: true }).click();
  for (const page of everyone) await expect(page.getByRole("timer")).toBeVisible();

  await owner.getByRole("button", { name: "Next topic" }).click();
  for (const page of everyone) {
    await expect(heading(page, "Shipped on time")).toBeVisible();
    await expect(page.getByText("Topic 2 of 3", { exact: true })).toBeVisible();
  }
  await owner.getByRole("button", { name: "Previous" }).click();
  for (const page of everyone) {
    await expect(heading(page, "CI health")).toBeVisible();
    await expect(page.getByRole("timer")).toHaveText(/^0[45]:\d\d$/);
    await expect(page.getByText("Paused")).toHaveCount(0);
  }
  await expect(owner.getByRole("button", { name: "Pause timer" })).toBeVisible();

  const carol = await newUser();
  await carol.goto(`/r/${code}`);
  await expect(heading(carol, "CI health")).toBeVisible();
  await expect(carol.getByText("Topic 1 of 3", { exact: true })).toBeVisible();
  await expect(carol.getByRole("timer")).toBeVisible();

  const comment = alice.getByRole("textbox", { name: "Add a comment" });
  await comment.fill("Retry storms hide real failures");
  await comment.press("Enter");
  await expect(comment).toHaveValue("");
  await expect(bob.getByText("Retry storms hide real failures", { exact: true })).toBeVisible();
  await expect(bob.getByRole("button", { name: "Edit comment" })).toHaveCount(0);
  await alice.getByRole("button", { name: "Edit comment" }).click();
  await alice.getByRole("textbox", { name: "Edit comment" }).fill("Retries hide real failures");
  await alice.getByRole("button", { name: "Save" }).click();
  await expect(bob.getByText("Retries hide real failures", { exact: true })).toBeVisible();
  await expect(bob.getByText("edited")).toBeVisible();
  await alice.getByRole("button", { name: "Delete comment" }).click();
  await expect(bob.getByText("No comments yet.")).toBeVisible();
  await comment.fill("Track flake rate weekly");
  await comment.press("Enter");
  await expect(owner.getByText("Track flake rate weekly", { exact: true })).toBeVisible();

  const comments = (page: Page) => page.getByRole("region", { name: /^Comments/ });
  const actionItems = (page: Page) => page.getByRole("region", { name: /^Action items/ });
  await comment.fill("Rotate the flake triage owner");
  await comment.press("Enter");
  await expect(comments(bob).getByText("Rotate the flake triage owner")).toBeVisible();
  await expect(bob.getByRole("button", { name: "Convert comment to action item" })).toHaveCount(0);
  await comments(alice)
    .getByRole("listitem")
    .filter({ hasText: "Rotate the flake triage owner" })
    .getByRole("button", { name: "Convert comment to action item" })
    .click();
  await expect(actionItems(bob).getByText("Rotate the flake triage owner")).toBeVisible();
  await expect(comments(bob).getByText("Rotate the flake triage owner")).toHaveCount(0);
  await expect(comments(bob).getByText("Track flake rate weekly")).toBeVisible();

  await bob.getByRole("textbox", { name: "New action item" }).fill("Tag flaky tests");
  await bob.getByRole("textbox", { name: "Assignee" }).fill("Sam");
  await bob.getByRole("button", { name: "Add action" }).click();
  await expect(owner.getByText("Tag flaky tests", { exact: true })).toBeVisible();
  await expect(owner.getByText("Assigned to Sam", { exact: true })).toBeVisible();
  await expect(owner.getByRole("button", { name: "Edit action item" })).toHaveCount(0);
  await bob.getByRole("button", { name: "Edit action item" }).click();
  await bob.getByRole("textbox", { name: "Edit action item" }).fill("Quarantine flaky tests in CI");
  await bob.getByRole("textbox", { name: "Edit assignee" }).fill("Alex");
  await bob.getByRole("button", { name: "Save" }).click();
  await expect(owner.getByText("Quarantine flaky tests in CI", { exact: true })).toBeVisible();
  await expect(owner.getByText("Assigned to Alex", { exact: true })).toBeVisible();
  await bob.getByRole("button", { name: "Delete action item" }).click();
  await expect(owner.getByText("Quarantine flaky tests in CI", { exact: true })).toHaveCount(0);

  await owner.getByRole("textbox", { name: "New action item" }).fill("Add a flake dashboard");
  await owner.getByRole("textbox", { name: "Assignee" }).fill("Priya");
  await owner.getByLabel("Due date").fill("2026-11-02");
  await owner.getByRole("button", { name: "Add action" }).click();
  await expect(alice.getByText("Add a flake dashboard", { exact: true })).toBeVisible();
  await expect(alice.locator('time[datetime="2026-11-02"]')).toBeVisible();
  await expect(owner.getByLabel("Due date")).toHaveValue("");

  await owner.getByRole("button", { name: "Next topic" }).click();
  await expect(heading(alice, "Shipped on time")).toBeVisible();
  await owner.getByRole("button", { name: "Finish retro" }).click();

  for (const page of [...everyone, carol]) {
    await expect(page.getByRole("heading", { name: "Retro complete" })).toBeVisible();
    await expect(
      page.getByText("2 of 3 topics discussed · 2 action items · 4 participants"),
    ).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
    await expect(page.getByRole("timer")).toHaveCount(0);
  }

  await owner.getByRole("button", { name: "Copy", exact: true }).click();
  await expect(owner.getByText("Copied to clipboard.")).toBeVisible();
  const copied = await owner.evaluate<string>("navigator.clipboard.readText()");

  const [download] = await Promise.all([
    alice.waitForEvent("download"),
    alice.getByRole("button", { name: "Download .md" }).click(),
  ]);
  expect(download.suggestedFilename()).toMatch(
    new RegExp(`^retro-${code}-\\d{4}-\\d{2}-\\d{2}\\.md$`),
  );
  const downloaded = await readFile(await download.path(), "utf8");

  expect(downloaded).toBe(copied);
  expect(downloaded).toMatch(
    new RegExp(`^# Retro: \\d{4}-\\d{2}-\\d{2}\nRoom ${code} · 4 participants\n`),
  );
  expect(downloaded).toContain(
    `## Discussed\n\n### 1. CI health (3 votes) [${TRY_NEXT}]\n- Items:\n`,
  );
  expect(downloaded).toContain("  - Flaky CI\n");
  expect(downloaded).toContain("  - Quarantine flaky tests\n");
  expect(downloaded).toContain(
    [
      "- Comments:",
      "  - Track flake rate weekly",
      "- Action items:",
      "  - [ ] Rotate the flake triage owner",
      "  - [ ] Add a flake dashboard (Priya, due 2026-11-02)",
      "",
      "### 2. Shipped on time (2 votes) [What went well?]",
      "- Comments:",
      "  - (none)",
      "- Action items:",
      "  - (none)",
      "",
      "## Not discussed",
      "- Too many meetings (0 votes) [What went less well?]",
      "",
    ].join("\n"),
  );
});
