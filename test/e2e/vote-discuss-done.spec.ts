import { randomUUID } from "node:crypto";
import { type Browser, expect, type Page, test } from "@playwright/test";

type Message = { type: string; reqId?: string; [key: string]: unknown };

class OwnerSocket {
  private messages: Message[] = [];
  private waiters: Array<() => void> = [];

  private constructor(private readonly ws: WebSocket) {
    ws.addEventListener("message", (event) => {
      this.messages.push(JSON.parse(String(event.data)));
      for (const wake of this.waiters.splice(0)) wake();
    });
  }

  static async open(baseURL: string, code: string, clientId: string): Promise<OwnerSocket> {
    const ws = new WebSocket(`${baseURL.replace(/^http/, "ws")}/ws/${code}`);
    await new Promise((resolve, reject) => {
      ws.addEventListener("open", resolve, { once: true });
      ws.addEventListener("error", reject, { once: true });
    });
    const socket = new OwnerSocket(ws);
    await socket.send({ type: "hello", clientId });
    return socket;
  }

  async send(intent: Omit<Message, "reqId">): Promise<Message[]> {
    const reqId = randomUUID();
    const start = this.messages.length;
    this.ws.send(JSON.stringify({ ...intent, reqId }));
    for (;;) {
      const reply = this.messages.slice(start).find((msg) => msg.reqId === reqId);
      if (reply?.type === "ack") return this.messages.slice(start);
      if (reply) throw new Error(`${intent.type} rejected: ${JSON.stringify(reply)}`);
      await new Promise<void>((resolve) => this.waiters.push(resolve));
    }
  }

  close(): void {
    this.ws.close();
  }
}

async function openAs(browser: Browser, clientId: string, code: string): Promise<Page> {
  const context = await browser.newContext();
  await context.addInitScript((id) => localStorage.setItem("retro.clientId", id), clientId);
  const page = await context.newPage();
  await page.goto(`/r/${code}`);
  return page;
}

function itemIdOf(messages: Message[]): string {
  const upserted = messages.find((msg) => msg.type === "itemUpserted");
  if (!upserted) throw new Error("addItem produced no itemUpserted");
  return (upserted.item as { id: string }).id;
}

function groupIdOf(messages: Message[], itemId: string): string {
  const snapshot = messages.find((msg) => msg.type === "snapshot");
  if (!snapshot) throw new Error("advance produced no snapshot");
  const groups = (snapshot.room as { groups: { id: string; itemIds: string[] }[] }).groups;
  const found = groups.find((entry) => entry.itemIds.includes(itemId));
  if (!found) throw new Error(`no group for ${itemId}`);
  return found.id;
}

test("vote, discuss and done stay in sync across two windows", async ({
  browser,
  request,
  baseURL,
}) => {
  const ownerId = randomUUID();
  const peerId = randomUUID();
  const created = await request.post("/api/rooms", { data: { clientId: ownerId } });
  expect(created.status()).toBe(201);
  const { code } = (await created.json()) as { code: string };

  const owner = await OwnerSocket.open(baseURL ?? "", code, ownerId);
  const add = async (categoryId: string, text: string) =>
    itemIdOf(await owner.send({ type: "addItem", categoryId, text }));
  const deploys = await add("less-well", "Deploys were slow");
  const rollbacks = await add("less-well", "Rollbacks hurt");
  await add("well", "Pairing sessions");
  await add("puzzles", "Flaky CI");
  const grouped = await owner.send({ type: "advance", from: "write" });
  await owner.send({
    type: "mergeGroups",
    sourceGroupId: groupIdOf(grouped, rollbacks),
    targetGroupId: groupIdOf(grouped, deploys),
  });
  await owner.send({ type: "setVoteLimit", limit: 3 });
  await owner.send({ type: "advance", from: "group" });

  const ownerPage = await openAs(browser, ownerId, code);
  const peerPage = await openAs(browser, peerId, code);
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

  await owner.send({ type: "advance", from: "vote" });

  for (const page of [ownerPage, peerPage]) {
    await expect(page.getByRole("heading", { level: 2, name: "Deploys were slow" })).toBeVisible();
    await expect(page.getByText("Topic 1 of 3", { exact: true })).toBeVisible();
    await expect(page.getByLabel("Items").getByText("Rollbacks hurt")).toBeVisible();
  }
  await expect(peerPage.getByRole("button", { name: "Next topic" })).toHaveCount(0);

  const peerComment = peerPage.getByRole("textbox", { name: "Add a comment" });
  await peerComment.fill("Need faster pipelines");
  await peerComment.press("Enter");
  await expect(peerComment).toHaveValue("");
  await expect(ownerPage.getByText("Need faster pipelines")).toBeVisible();
  await expect(ownerPage.getByRole("button", { name: "Edit comment" })).toHaveCount(0);

  await peerPage.getByRole("button", { name: "Edit comment" }).click();
  await peerPage.getByRole("textbox", { name: "Edit comment" }).fill("Need much faster pipelines");
  await peerPage.getByRole("button", { name: "Save" }).click();
  await expect(ownerPage.getByText("Need much faster pipelines")).toBeVisible();
  await expect(ownerPage.getByText("edited")).toBeVisible();
  await peerPage.getByRole("button", { name: "Delete comment" }).click();
  await expect(ownerPage.getByText("No comments yet.")).toBeVisible();

  await ownerPage.getByRole("textbox", { name: "New action item" }).fill("Cache docker layers");
  await ownerPage.getByRole("textbox", { name: "Assignee" }).fill("Sam");
  await ownerPage.getByRole("button", { name: "Add action" }).click();
  await expect(peerPage.getByText("Cache docker layers")).toBeVisible();
  await expect(peerPage.getByText("Assigned to Sam")).toBeVisible();
  await expect(peerPage.getByRole("button", { name: "Edit action item" })).toHaveCount(0);
  await ownerPage.getByRole("button", { name: "Edit action item" }).click();
  await ownerPage.getByRole("textbox", { name: "Edit assignee" }).fill("Alex");
  await ownerPage.getByRole("button", { name: "Save" }).click();
  await expect(peerPage.getByText("Assigned to Alex")).toBeVisible();

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

  await owner.send({ type: "advance", from: "discuss" });
  owner.close();

  for (const page of [ownerPage, peerPage]) {
    await expect(page.getByRole("heading", { name: "Retro complete" })).toBeVisible();
    await expect(page.getByText("3 of 3 topics discussed · 1 action item")).toBeVisible();
    const actions = page.getByRole("region", { name: "Action items" }).first();
    await expect(actions).toContainText("Cache docker layers");
    await expect(page.getByRole("button", { name: "Edit action item" })).toHaveCount(0);
    await expect(page.getByRole("textbox")).toHaveCount(0);
  }
});
