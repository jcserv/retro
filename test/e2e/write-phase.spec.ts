import { expect, type Page, test } from "@playwright/test";
import { LIMITS } from "../../src/shared/constants";
import { FakeRoom } from "./fakeRoom";

function column(page: Page, title: string) {
  return page.getByRole("region", { name: title });
}

test("two participants write privately, see live counts, ready up, and the owner advances", async ({
  browser,
}) => {
  const room = new FakeRoom();
  const ownerContext = await browser.newContext();
  const guestContext = await browser.newContext();
  await room.attach(ownerContext);
  await room.attach(guestContext);
  const owner = await ownerContext.newPage();
  const guest = await guestContext.newPage();

  await owner.goto(`/r/${room.code}`);
  await expect(owner.getByRole("button", { name: "Start grouping" })).toBeVisible();
  await guest.goto(`/r/${room.code}`);
  await expect(guest.getByRole("heading", { name: "Write phase" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "Start grouping" })).toHaveCount(0);
  await expect(owner.getByText("0/2 ready")).toBeVisible();

  const ownerWell = column(owner, "What went well?");
  await ownerWell.getByRole("textbox").fill("Shipped on time");
  await ownerWell.getByRole("textbox").press("Enter");
  await expect(ownerWell.getByRole("listitem")).toHaveText("Shipped on time");
  await expect(ownerWell.getByRole("textbox")).toHaveValue("");

  const guestWell = column(guest, "What went well?");
  await expect(guestWell.getByText("1 item", { exact: true })).toBeVisible();
  await expect(guestWell.getByRole("listitem")).toHaveCount(0);

  await guestWell.getByRole("textbox").fill("Great pairing");
  await guestWell.getByRole("button", { name: "Add" }).click();
  await expect(ownerWell.getByText("2 items")).toBeVisible();
  await expect(ownerWell.getByText("Great pairing")).toHaveCount(0);

  await guest.getByRole("button", { name: "I'm ready" }).click();
  await expect(guest.getByRole("button", { name: "I'm ready" })).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(owner.getByText("1/2 ready")).toBeVisible();

  await owner.getByRole("button", { name: "Start grouping" }).click();
  await expect(owner.getByRole("heading", { name: "Group similar items" })).toBeVisible();
  await expect(guest.getByRole("heading", { name: "Group similar items" })).toBeVisible();
  await expect(guest.getByRole("button", { name: "I'm ready" })).toHaveAttribute(
    "aria-pressed",
    "false",
  );
  await expect(owner.getByRole("button", { name: "Start voting" })).toBeVisible();
  expect(room.received).toContainEqual(expect.objectContaining({ type: "advance", from: "write" }));

  await ownerContext.close();
  await guestContext.close();
});

test("own items can be edited and deleted", async ({ page, context }) => {
  const room = new FakeRoom();
  await room.attach(context);
  await page.goto(`/r/${room.code}`);

  const puzzles = column(page, "What puzzles us?");
  await puzzles.getByRole("textbox").fill("  Why is CI slow?  ");
  await puzzles.getByRole("textbox").press("Enter");
  const item = puzzles.getByRole("listitem");
  await expect(item).toHaveText("Why is CI slow?");

  await item.getByRole("button", { name: "Edit item" }).click();
  const editor = item.getByRole("textbox", { name: "Edit item" });
  await expect(editor).toBeFocused();
  await editor.fill("Why is CI so slow?");
  await editor.press("Enter");
  await expect(item).toHaveText("Why is CI so slow?");

  await item.getByRole("button", { name: "Edit item" }).click();
  await item.getByRole("textbox", { name: "Edit item" }).fill("discarded");
  await item.getByRole("textbox", { name: "Edit item" }).press("Escape");
  await expect(item).toHaveText("Why is CI so slow?");

  await item.getByRole("button", { name: "Delete item" }).click();
  await expect(puzzles.getByRole("listitem")).toHaveCount(0);
  await expect(puzzles.getByText("0 items")).toBeVisible();
});

test("the composer counts code points and blocks over-length text", async ({ page, context }) => {
  const room = new FakeRoom();
  await room.attach(context);
  await page.goto(`/r/${room.code}`);

  const well = column(page, "What went well?");
  await well.getByRole("textbox").fill("😀".repeat(LIMITS.itemTextMax));
  await expect(well.getByText(`${LIMITS.itemTextMax}/${LIMITS.itemTextMax}`)).toBeVisible();
  await expect(well.getByRole("button", { name: "Add" })).toBeEnabled();

  await well.getByRole("textbox").fill("a".repeat(LIMITS.itemTextMax + 1));
  await expect(well.getByRole("textbox")).toHaveAttribute("aria-invalid", "true");
  await expect(well.getByRole("button", { name: "Add" })).toBeDisabled();
});

test("the owner adjusts the vote limit within bounds", async ({ page, context }) => {
  const room = new FakeRoom();
  room.voteLimit = LIMITS.voteLimitMin + 1;
  await room.attach(context);
  await page.goto(`/r/${room.code}`);

  const fewer = page.getByRole("button", { name: "Fewer votes per person" });
  await fewer.click();
  await expect(page.getByRole("status").filter({ hasText: "Votes per person" })).toHaveText(
    `Votes per person: ${LIMITS.voteLimitMin}`,
  );
  await expect(fewer).toBeDisabled();
  await page.getByRole("button", { name: "More votes per person" }).click();
  await expect(fewer).toBeEnabled();
  expect(room.received.filter((msg) => msg.type === "setVoteLimit")).toEqual([
    expect.objectContaining({ limit: LIMITS.voteLimitMin }),
    expect.objectContaining({ limit: LIMITS.voteLimitMin + 1 }),
  ]);
});

test("the header shows people here, expiry, and copies the room link", async ({
  page,
  context,
}) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  const room = new FakeRoom();
  await room.attach(context);
  await page.goto(`/r/${room.code}`);

  await expect(page.getByText("People here: 1")).toBeAttached();
  await expect(page.getByText(/Expires in 2[34]h \d+m/)).toBeVisible();
  await page.getByRole("button", { name: "Copy link" }).click();
  await expect(page.getByRole("button", { name: "Copied" })).toBeVisible();
  expect(await page.evaluate<string>("navigator.clipboard.readText()")).toBe(
    `${new URL(page.url()).origin}/r/${room.code}`,
  );
});
