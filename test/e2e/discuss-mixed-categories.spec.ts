import { addItem, createRoom, dragOnto, expect, test } from "./fixtures";

test("discuss shows each item's category when a group mixes categories", async ({ newUser }) => {
  const page = await newUser();
  await createRoom(page);

  await addItem(page, "What do we want to try next?", "Trunk-based development");
  await addItem(page, "What went less well?", "Merge conflicts");
  await addItem(page, "What went well?", "Pairing sessions");

  await page.getByRole("button", { name: "Start grouping" }).click();
  await dragOnto(page, "Merge conflicts", "Trunk-based development");
  await expect(page.getByRole("article", { name: "Trunk-based development" })).toContainText(
    "Merge conflicts",
  );
  await page.getByRole("button", { name: "Start voting" }).click();
  await page.getByRole("button", { name: "Add a vote to Trunk-based development" }).click();
  await page.getByRole("button", { name: "Start discussion" }).click();

  const current = page.getByRole("region", { name: "Trunk-based development" });
  await expect(current.getByLabel("Items").getByRole("listitem")).toHaveText([
    "What do we want to try next?: Trunk-based development",
    "What went less well?: Merge conflicts",
  ]);
  await expect(current.getByText("What went less well?", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Next topic" }).click();
  await expect(
    page.getByRole("region", { name: "Pairing sessions" }).getByText("What went well?", {
      exact: true,
    }),
  ).toBeVisible();
});
