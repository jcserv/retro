import { expect, test } from "vitest";
import type { Phase, ServerMessage } from "../../../src/shared/protocol";
import { connect, createRoom, type TestSocket } from "../ws";
import { ALICE, ALL_CLIENTS, BOB, OWNER } from "./harness";

const NAMES: Record<string, string> = { [OWNER]: "owner", [ALICE]: "alice", [BOB]: "bob" };

type Received = { phase: Phase; raw: string; message: ServerMessage };

function phased(socket: TestSocket): Received[] {
  let phase: Phase = "write";
  return socket.received.map((message) => {
    if (message.type === "snapshot") phase = message.room.phase;
    return { phase, raw: JSON.stringify(message), message };
  });
}

function itemsIn(message: ServerMessage) {
  if (message.type === "snapshot") return message.room.items;
  if (message.type === "itemUpserted") return [message.item];
  return [];
}

function authoredIn(message: ServerMessage) {
  if (message.type === "snapshot") return [...message.room.comments, ...message.room.actions];
  if (message.type === "commentUpserted") return [message.comment];
  if (message.type === "actionUpserted") return [message.action];
  return [];
}

test("no client learns anything it should not across a full session", async () => {
  const code = await createRoom(OWNER);
  const { socket: owner } = await connect(code, OWNER);
  const { socket: alice } = await connect(code, ALICE);
  const { socket: bob } = await connect(code, BOB);
  const sockets = { [OWNER]: owner, [ALICE]: alice, [BOB]: bob };
  const syncAll = () => Promise.all(Object.values(sockets).map((socket) => socket.sync()));

  const written: Record<string, { ids: string[]; texts: string[] }> = {};
  for (const [clientId, socket] of Object.entries(sockets)) {
    const entry = { ids: [] as string[], texts: [] as string[] };
    for (const categoryId of ["well", "less-well"]) {
      const text = `secret ${NAMES[clientId]} ${categoryId}`;
      await socket.ok({ type: "addItem", categoryId, text });
      const item = socket.latest("itemUpserted")?.item;
      if (!item) throw new Error("own item not echoed");
      entry.ids.push(item.id);
      entry.texts.push(text);
    }
    written[clientId] = entry;
  }
  const aliceIds = written[ALICE]?.ids ?? [];
  await alice.ok({ type: "editItem", itemId: aliceIds[0], text: "secret alice edited" });
  written[ALICE]?.texts.push("secret alice edited");
  await alice.ok({ type: "deleteItem", itemId: aliceIds[1] });
  await alice.ok({ type: "setReady", ready: true });
  await owner.ok({ type: "setTimer", durationMs: 60_000 });
  await syncAll();

  await owner.ok({ type: "advance", from: "write" });
  await syncAll();
  const groups = owner.latest("snapshot")?.room.groups ?? [];
  const [g1, g2, g3] = groups.map((group) => group.id);
  await alice.ok({ type: "mergeGroups", sourceGroupId: g1, targetGroupId: g2 });
  await bob.ok({ type: "renameGroup", groupId: g2, title: "merged" });
  await bob.ok({ type: "setReady", ready: true });

  await owner.ok({ type: "advance", from: "group" });
  await alice.ok({ type: "vote", groupId: g2 });
  await alice.ok({ type: "vote", groupId: g2 });
  await bob.ok({ type: "vote", groupId: g3 });
  await bob.ok({ type: "unvote", groupId: g3 });
  await bob.ok({ type: "vote", groupId: g3 });
  await owner.ok({ type: "vote", groupId: g3 });
  await syncAll();

  await owner.ok({ type: "advance", from: "vote" });
  await syncAll();
  const current = owner.latest("snapshot")?.room.discuss?.order[0];
  await alice.ok({ type: "addComment", groupId: current, text: "alice comment" });
  await bob.ok({ type: "addAction", groupId: current, text: "bob action", assignee: "Bob" });
  const commentId = alice.latest("commentUpserted")?.comment.id;
  const actionId = bob.latest("actionUpserted")?.action.id;
  await alice.ok({ type: "editComment", commentId, text: "alice comment edited" });
  await bob.ok({ type: "editAction", actionId, text: "bob action edited", assignee: "" });
  await owner.ok({ type: "addComment", groupId: current, text: "owner comment" });
  await owner.ok({ type: "next", fromIndex: 0 });
  await owner.ok({ type: "skip", fromIndex: 1 });
  await owner.ok({ type: "advance", from: "discuss" });
  await syncAll();

  const ownVotes: Record<string, Record<string, number>> = {
    [OWNER]: { [g3 as string]: 1 },
    [ALICE]: { [g2 as string]: 2 },
    [BOB]: { [g3 as string]: 1 },
  };

  for (const [clientId, socket] of Object.entries(sockets)) {
    const log = phased(socket);
    expect(log.map(({ phase }) => phase)).toContain("done");

    for (const { raw } of log) {
      for (const secretId of ALL_CLIENTS) expect(raw).not.toContain(secretId);
    }

    for (const { phase, raw, message } of log) {
      if (phase === "write") {
        for (const [author, { ids, texts }] of Object.entries(written)) {
          if (author === clientId) continue;
          for (const value of [...ids, ...texts]) expect(raw).not.toContain(value);
        }
      } else {
        for (const item of itemsIn(message)) expect(item).not.toHaveProperty("mine");
      }

      if (phase === "write" || phase === "group" || phase === "vote") {
        if (message.type === "snapshot") expect(message.room.voteTotals).toBeNull();
      }
      if (phase === "vote") {
        const votes =
          message.type === "myVotes"
            ? message.votes
            : message.type === "snapshot"
              ? message.room.myVotes
              : null;
        for (const [groupId, count] of Object.entries(votes ?? {})) {
          expect(count).toBeLessThanOrEqual(ownVotes[clientId]?.[groupId] ?? 0);
        }
      }

      for (const entry of authoredIn(message)) {
        const author = entry.text.startsWith("alice")
          ? ALICE
          : entry.text.startsWith("bob")
            ? BOB
            : OWNER;
        expect(entry.mine).toBe(author === clientId);
      }
    }

    const finalSnapshot = socket.latest("snapshot")?.room;
    expect(finalSnapshot?.myVotes).toMatchObject(ownVotes[clientId] ?? {});
    expect(finalSnapshot?.voteTotals).toMatchObject({ [g2 as string]: 2, [g3 as string]: 2 });
  }
});
