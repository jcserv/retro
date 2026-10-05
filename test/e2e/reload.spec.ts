import { addItem, column, createRoom, expect, test } from "./fixtures";

test("live: reloading keeps ownership and your own items", async ({ newUser }) => {
  const owner = await newUser();
  const guest = await newUser();
  const code = await createRoom(owner);
  await guest.goto(`/r/${code}`);

  await addItem(owner, "What went well?", "Owner note");
  await addItem(guest, "What puzzles us?", "Guest note");
  await expect(owner.getByText("0/2 ready")).toBeVisible();

  await owner.reload();
  await expect(owner.getByRole("button", { name: "Start grouping" })).toBeVisible();
  await expect(column(owner, "What went well?").getByRole("listitem")).toHaveText(["Owner note"]);

  await guest.reload();
  await expect(guest.getByRole("status").filter({ hasText: "Live" })).toBeVisible();
  await expect(column(guest, "What puzzles us?").getByRole("listitem")).toHaveText(["Guest note"]);
  await expect(guest.getByRole("button", { name: "Start grouping" })).toHaveCount(0);
  await expect(owner.getByText("0/2 ready")).toBeVisible();

  await owner.getByRole("button", { name: "Start grouping" }).click();
  await expect(guest.getByRole("heading", { name: "Group similar items" })).toBeVisible();
});
