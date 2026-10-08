import type { Page } from "@playwright/test";
import { addItem, card, createRoom, expect, test } from "./fixtures";

async function pickReaction(page: Page, itemText: string, search: string, name: RegExp) {
  await card(page, itemText).getByRole("button", { name: "Add reaction" }).click();
  const dialog = page.getByRole("dialog", { name: `React to “${itemText}”` });
  await dialog.getByRole("combobox").fill(search);
  await dialog.getByRole("option", { name }).first().click();
  await expect(dialog).toBeHidden();
}

const pill = (page: Page, itemText: string, label: string) =>
  card(page, itemText).getByRole("button", { name: label, exact: true });

test("live: reactions are shared anonymously and toggle per person", async ({ newUser }) => {
  const ownerPage = await newUser();
  const peerPage = await newUser();
  const code = await createRoom(ownerPage);
  await peerPage.goto(`/r/${code}`);

  await addItem(ownerPage, "What went well?", "Pairing sessions");
  await addItem(peerPage, "What puzzles us?", "Flaky CI");
  await expect(ownerPage.getByRole("button", { name: "Add reaction" })).toHaveCount(0);

  await ownerPage.getByRole("button", { name: "Start grouping" }).click();
  await pickReaction(ownerPage, "Pairing sessions", "party", /party popper/i);

  await expect(pill(ownerPage, "Pairing sessions", "🎉 1")).toHaveAttribute("aria-pressed", "true");
  await expect(pill(peerPage, "Pairing sessions", "🎉 1")).toHaveAttribute("aria-pressed", "false");

  await pill(peerPage, "Pairing sessions", "🎉 1").click();
  await expect(pill(peerPage, "Pairing sessions", "🎉 2")).toHaveAttribute("aria-pressed", "true");
  await expect(pill(ownerPage, "Pairing sessions", "🎉 2")).toHaveAttribute("aria-pressed", "true");

  await pill(ownerPage, "Pairing sessions", "🎉 2").click();
  await expect(pill(peerPage, "Pairing sessions", "🎉 1")).toHaveAttribute("aria-pressed", "true");

  await ownerPage.getByRole("button", { name: "Start voting" }).click();
  await expect(peerPage.getByRole("heading", { name: "Vote on what to discuss" })).toBeVisible();
  await pickReaction(peerPage, "Flaky CI", "thinking", /thinking face/i);
  await expect(pill(ownerPage, "Flaky CI", "🤔 1")).toBeVisible();

  await ownerPage.getByRole("button", { name: "Start discussion" }).click();
  const panel = ownerPage.getByRole("region", { name: /Pairing sessions|Flaky CI/ });
  await expect(panel.getByRole("button", { name: /^(🎉|🤔) 1$/ })).toBeVisible();

  await ownerPage.getByRole("button", { name: "Finish retro" }).click();
  await expect(ownerPage.getByText("🎉").first()).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Add reaction" })).toHaveCount(0);
  await expect(ownerPage.getByRole("button", { name: /^🎉 1$/ })).toHaveCount(0);
});
