import { describe, expect, test } from "vitest";
import { PHASES, type Phase, type ServerMessage } from "../../../src/shared/protocol";
import { type Actor, type Change, joinRoom } from "../../../src/worker/room/commands";
import { project, snapshot, type ViewContext } from "../../../src/worker/room/views";
import { ALICE, ALL_CLIENTS, alice, bob, OWNER, owner, type Room, withRoom } from "./harness";

const ctxFor = (room: Room, connected: readonly string[] = ALL_CLIENTS): ViewContext => ({
  now: room.now,
  connectedClientIds: new Set(connected),
});

function seed(room: Room) {
  for (const clientId of ALL_CLIENTS) joinRoom(room.store, clientId, room.now);
  const a = room.addItem(alice, "well", "alice secret");
  const b = room.addItem(bob, "well", "bob secret");
  const c = room.addItem(bob, "puzzles", "bob puzzle");
  return { a, b, c };
}

function projectAll(room: Room, changes: Change[], viewer: Actor): ServerMessage[] {
  return changes
    .map((change) => project(room.store, change, viewer, ctxFor(room)))
    .filter((message): message is ServerMessage => message !== null);
}

describe("snapshot", () => {
  test("write: only own items with mine, counts for everyone's items, nothing else revealed", async () => {
    await withRoom((room) => {
      const { a } = seed(room);
      const view = snapshot(room.store, alice, ctxFor(room));
      expect(view.items).toEqual([
        {
          id: a,
          categoryId: "well",
          groupId: null,
          text: "alice secret",
          mine: true,
          reactions: [],
          createdAt: expect.any(Number),
        },
      ]);
      expect(view.categoryCounts).toEqual({
        well: 2,
        "less-well": 0,
        "try-next": 0,
        puzzles: 1,
        shoutouts: 0,
      });
      expect(view).toMatchObject({
        phase: "write",
        isOwner: false,
        groups: [],
        myVotes: {},
        voteTotals: null,
        discuss: null,
        comments: [],
        actions: [],
      });
      expect(JSON.stringify(view)).not.toContain("bob secret");
      expect(snapshot(room.store, owner, ctxFor(room)).items).toEqual([]);
      expect(snapshot(room.store, owner, ctxFor(room)).isOwner).toBe(true);
    });
  });

  test("group: every item revealed without mine, groups list item ids in creation order", async () => {
    await withRoom((room) => {
      const { a, b, c } = seed(room);
      room.advanceTo("group");
      room.ok(alice, { type: "moveItemToGroup", itemId: a, groupId: room.groupOf(c) });

      const view = snapshot(room.store, alice, ctxFor(room));
      expect(view.items.map((item) => item.id)).toEqual([a, b, c]);
      for (const item of view.items) expect(item).not.toHaveProperty("mine");
      expect(view.groups.find((g) => g.id === room.groupOf(c))?.itemIds).toEqual([a, c]);
      expect(view.groups).toHaveLength(2);
      expect(view).toMatchObject({ myVotes: {}, voteTotals: null, discuss: null });
    });
  });

  test("vote: own votes only, no totals", async () => {
    await withRoom((room) => {
      const { a, b } = seed(room);
      room.advanceTo("vote");
      room.ok(alice, { type: "vote", groupId: room.groupOf(a) });
      room.ok(bob, { type: "vote", groupId: room.groupOf(b) });
      room.ok(bob, { type: "vote", groupId: room.groupOf(a) });

      const view = snapshot(room.store, alice, ctxFor(room));
      expect(view.myVotes).toEqual({ [room.groupOf(a)]: 1 });
      expect(view.voteTotals).toBeNull();
      expect(view.discuss).toBeNull();
    });
  });

  test.each(["discuss", "done"] as const)(
    "%s: totals, discuss state and per-viewer mine flags",
    async (phase) => {
      await withRoom((room) => {
        const { a, b, c } = seed(room);
        room.advanceTo("vote");
        room.ok(alice, { type: "vote", groupId: room.groupOf(c) });
        room.ok(bob, { type: "vote", groupId: room.groupOf(c) });
        room.ok(bob, { type: "vote", groupId: room.groupOf(b) });
        room.advanceTo("discuss");
        const groupId = room.discussOrder()[0] ?? "";
        room.ok(alice, { type: "addComment", groupId, text: "alice comment" });
        room.ok(bob, { type: "addAction", groupId, text: "bob action", assignee: "Sam" });
        room.advanceTo(phase);

        const view = snapshot(room.store, alice, ctxFor(room));
        expect(view.voteTotals).toEqual({
          [room.groupOf(a)]: 0,
          [room.groupOf(b)]: 1,
          [room.groupOf(c)]: 2,
        });
        expect(view.myVotes).toEqual({ [room.groupOf(c)]: 1 });
        expect(view.discuss).toEqual({
          order: [room.groupOf(c), room.groupOf(b), room.groupOf(a)],
          currentIndex: 0,
          status: {
            [room.groupOf(c)]: "discussed",
            [room.groupOf(b)]: "pending",
            [room.groupOf(a)]: "pending",
          },
        });
        expect(view.comments.map((x) => [x.text, x.mine])).toEqual([["alice comment", true]]);
        expect(view.actions.map((x) => [x.text, x.assignee, x.mine])).toEqual([
          ["bob action", "Sam", false],
        ]);
        expect(snapshot(room.store, bob, ctxFor(room)).actions[0]?.mine).toBe(true);
      });
    },
  );

  test("presence counts ready flags only for connected participants", async () => {
    await withRoom((room) => {
      seed(room);
      room.ok(alice, { type: "setReady", ready: true });
      room.ok(bob, { type: "setReady", ready: true });
      const view = snapshot(room.store, alice, ctxFor(room, [OWNER, ALICE]));
      expect(view.presence).toEqual({ participantCount: 3, connectedCount: 2, readyCount: 1 });
      expect(view.youReady).toBe(true);
    });
  });

  test.each(PHASES)("never contains any client id in %s", async (phase) => {
    await withRoom((room) => {
      seed(room);
      room.advanceTo(phase);
      for (const viewer of [owner, alice, bob]) {
        const json = JSON.stringify(snapshot(room.store, viewer, ctxFor(room)));
        for (const clientId of ALL_CLIENTS) expect(json).not.toContain(clientId);
      }
    });
  });
});

describe("project", () => {
  test("write: item changes reach only their author, counts reach everyone", async () => {
    await withRoom((room) => {
      seed(room);
      const added = room.ok(alice, { type: "addItem", categoryId: "shoutouts", text: "thanks" });
      const toAlice = projectAll(room, added, alice);
      expect(toAlice[0]).toMatchObject({
        type: "itemUpserted",
        item: { text: "thanks", mine: true, groupId: null },
      });
      expect(toAlice[1]).toMatchObject({ type: "categoryCounts", counts: { shoutouts: 1 } });
      expect(projectAll(room, added, bob)).toEqual([toAlice[1]]);

      const itemId = toAlice[0]?.type === "itemUpserted" ? toAlice[0].item.id : "";
      const removed = room.ok(alice, { type: "deleteItem", itemId });
      expect(projectAll(room, removed, alice)[0]).toEqual({ type: "itemRemoved", itemId });
      expect(projectAll(room, removed, bob).map((m) => m.type)).toEqual(["categoryCounts"]);
    });
  });

  test("group: grouping changes reach everyone without author info", async () => {
    await withRoom((room) => {
      const { a, c } = seed(room);
      room.advanceTo("group");
      const source = room.groupOf(a);
      const target = room.groupOf(c);
      const changes = room.ok(bob, { type: "moveItemToGroup", itemId: a, groupId: target });
      for (const viewer of [owner, alice, bob]) {
        expect(projectAll(room, changes, viewer)).toEqual([
          {
            type: "itemUpserted",
            item: {
              id: a,
              categoryId: "well",
              groupId: target,
              text: "alice secret",
              reactions: [],
              createdAt: expect.any(Number),
            },
          },
          {
            type: "groupUpserted",
            group: {
              id: target,
              categoryId: "puzzles",
              title: null,
              itemIds: [a, c],
              createdAt: expect.any(Number),
            },
          },
          { type: "groupRemoved", groupId: source },
        ]);
      }
    });
  });

  test("group changes are hidden while still in write", async () => {
    await withRoom((room) => {
      seed(room);
      const ctx = ctxFor(room);
      expect(project(room.store, { kind: "groupUpserted", groupId: "g" }, alice, ctx)).toBeNull();
      expect(project(room.store, { kind: "groupRemoved", groupId: "g" }, alice, ctx)).toBeNull();
    });
  });

  test("ready and vote changes reach only the actor; presence reaches everyone", async () => {
    await withRoom((room) => {
      const { a } = seed(room);
      const ready = room.ok(alice, { type: "setReady", ready: true });
      expect(projectAll(room, ready, alice)).toEqual([
        { type: "youReady", ready: true },
        { type: "presence", presence: { participantCount: 3, connectedCount: 3, readyCount: 1 } },
      ]);
      expect(projectAll(room, ready, bob).map((m) => m.type)).toEqual(["presence"]);

      room.advanceTo("vote");
      const voted = room.ok(alice, { type: "vote", groupId: room.groupOf(a) });
      expect(projectAll(room, voted, alice)).toEqual([
        { type: "myVotes", votes: { [room.groupOf(a)]: 1 } },
      ]);
      expect(projectAll(room, voted, bob)).toEqual([]);
      expect(projectAll(room, voted, owner)).toEqual([]);
    });
  });

  test("room-wide settings reach everyone", async () => {
    await withRoom((room) => {
      seed(room);
      const limit = room.ok(owner, { type: "setVoteLimit", limit: 7 });
      expect(projectAll(room, limit, bob)).toEqual([{ type: "voteLimit", limit: 7 }]);
      const timer = room.ok(owner, { type: "setTimer", durationMs: 60_000 });
      expect(projectAll(room, timer, bob)).toEqual([
        {
          type: "timer",
          timer: { kind: "running", endsAt: room.now + 60_000 },
          serverNow: room.now,
        },
      ]);
    });
  });

  test("phase changes become a full per-viewer snapshot", async () => {
    await withRoom((room) => {
      seed(room);
      const changes = room.ok(owner, { type: "advance", from: "write" });
      const [toOwner] = projectAll(room, changes, owner);
      const [toAlice] = projectAll(room, changes, alice);
      expect(toOwner).toEqual({
        type: "snapshot",
        room: snapshot(room.store, owner, ctxFor(room)),
      });
      expect(toOwner?.type === "snapshot" && toOwner.room.isOwner).toBe(true);
      expect(toAlice?.type === "snapshot" && toAlice.room.isOwner).toBe(false);
    });
  });

  test("discuss: cursor, comments and actions with per-viewer mine", async () => {
    await withRoom((room) => {
      seed(room);
      room.advanceTo("discuss");
      const [first, second] = room.discussOrder();
      const comment = room.ok(alice, { type: "addComment", groupId: first ?? "", text: "c" });
      expect(projectAll(room, comment, alice)[0]).toMatchObject({ comment: { mine: true } });
      expect(projectAll(room, comment, bob)[0]).toMatchObject({ comment: { mine: false } });

      const action = room.ok(bob, { type: "addAction", groupId: first ?? "", text: "a" });
      expect(projectAll(room, action, bob)[0]).toMatchObject({ action: { mine: true } });
      expect(projectAll(room, action, owner)[0]).toMatchObject({ action: { mine: false } });

      const moved = room.ok(owner, { type: "next", fromIndex: 0 });
      expect(projectAll(room, moved, alice)).toEqual([
        {
          type: "discussCursor",
          currentIndex: 1,
          status: expect.objectContaining({
            [first ?? ""]: "discussed",
            [second ?? ""]: "discussed",
          }),
        },
      ]);
    });
  });

  test("changes about rows that no longer exist project to nothing", async () => {
    await withRoom((room) => {
      seed(room);
      room.advanceTo("discuss");
      const ctx = ctxFor(room);
      for (const change of [
        { kind: "itemUpserted", itemId: "gone", authorId: ALICE },
        { kind: "groupUpserted", groupId: "gone" },
        { kind: "commentUpserted", commentId: "gone" },
        { kind: "actionUpserted", actionId: "gone" },
      ] satisfies Change[]) {
        expect(project(room.store, change, alice, ctx)).toBeNull();
      }
    });
  });
});

describe("reactions", () => {
  test("aggregate per emoji in first-reacted order with a per-viewer mine flag", async () => {
    await withRoom((room) => {
      const { a, b } = seed(room);
      room.advanceTo("group");
      room.ok(bob, { type: "addReaction", itemId: a, emoji: "🎉" });
      room.ok(alice, { type: "addReaction", itemId: a, emoji: "👍🏽" });
      room.ok(alice, { type: "addReaction", itemId: a, emoji: "🎉" });

      const reactionsOn = (viewer: Actor, itemId: string) =>
        snapshot(room.store, viewer, ctxFor(room)).items.find((item) => item.id === itemId)
          ?.reactions;
      expect(reactionsOn(alice, a)).toEqual([
        { emoji: "🎉", count: 2, mine: true },
        { emoji: "👍🏽", count: 1, mine: true },
      ]);
      expect(reactionsOn(owner, a)).toEqual([
        { emoji: "🎉", count: 2, mine: false },
        { emoji: "👍🏽", count: 1, mine: false },
      ]);
      expect(reactionsOn(alice, b)).toEqual([]);
    });
  });

  test("a reaction change reaches everyone as that item with their own mine flag", async () => {
    await withRoom((room) => {
      const { a } = seed(room);
      room.advanceTo("vote");
      const changes = room.ok(bob, { type: "addReaction", itemId: a, emoji: "🔥" });
      expect(projectAll(room, changes, bob)).toEqual([
        expect.objectContaining({
          type: "itemUpserted",
          item: expect.objectContaining({
            id: a,
            reactions: [{ emoji: "🔥", count: 1, mine: true }],
          }),
        }),
      ]);
      expect(projectAll(room, changes, alice)).toEqual([
        expect.objectContaining({
          item: expect.objectContaining({ reactions: [{ emoji: "🔥", count: 1, mine: false }] }),
        }),
      ]);
    });
  });
});

describe("leak test", () => {
  test("a full scripted session leaks no ids, authorship, hidden items or vote totals", async () => {
    await withRoom((room) => {
      const cast = [
        { actor: owner, name: "owner" },
        { actor: alice, name: "alice" },
        { actor: bob, name: "bob" },
      ];
      const log = new Map<Actor, { phase: Phase; message: ServerMessage }[]>(
        cast.map(({ actor }) => [actor, []]),
      );
      const deliver = (changes: Change[]) => {
        for (const { actor } of cast) {
          for (const message of projectAll(room, changes, actor)) {
            log.get(actor)?.push({ phase: room.phase, message });
          }
        }
      };
      const act = (actor: Actor, intent: Parameters<Room["ok"]>[1]) => {
        const changes = room.ok(actor, intent);
        deliver(changes);
        return changes;
      };

      const written = new Map<Actor, { id: string; text: string }[]>();
      for (const { actor, name } of cast) {
        const joined = joinRoom(room.store, actor.clientId, room.now);
        if (joined.ok) deliver(joined.changes);
        written.set(actor, []);
        for (const categoryId of ["well", "less-well"]) {
          const text = `${name} wrote in ${categoryId}`;
          const id = room.addItem(actor, categoryId, text);
          deliver([{ kind: "itemUpserted", itemId: id, authorId: actor.clientId }]);
          written.get(actor)?.push({ id, text });
        }
      }
      const [aliceFirst] = written.get(alice) ?? [];
      const [bobFirst, bobSecond] = written.get(bob) ?? [];
      if (!aliceFirst || !bobFirst || !bobSecond) throw new Error("seed failed");

      act(alice, { type: "editItem", itemId: aliceFirst.id, text: aliceFirst.text });
      act(alice, { type: "setReady", ready: true });
      act(owner, { type: "setTimer", durationMs: 60_000 });
      act(owner, { type: "advance", from: "write" });

      act(bob, {
        type: "moveItemToGroup",
        itemId: aliceFirst.id,
        groupId: room.groupOf(bobFirst.id),
      });
      act(owner, {
        type: "mergeGroups",
        sourceGroupId: room.groupOf(bobSecond.id),
        targetGroupId: room.groupOf(bobFirst.id),
      });
      act(alice, { type: "ungroupItem", itemId: bobSecond.id });
      act(alice, { type: "renameGroup", groupId: room.groupOf(bobFirst.id), title: "Theme" });
      act(bob, { type: "addReaction", itemId: aliceFirst.id, emoji: "🎉" });
      act(alice, { type: "addReaction", itemId: aliceFirst.id, emoji: "🎉" });
      act(alice, { type: "removeReaction", itemId: aliceFirst.id, emoji: "🎉" });
      act(owner, { type: "advance", from: "group" });

      act(alice, { type: "vote", groupId: room.groupOf(bobFirst.id) });
      act(bob, { type: "vote", groupId: room.groupOf(bobFirst.id) });
      act(bob, { type: "unvote", groupId: room.groupOf(bobFirst.id) });
      act(owner, { type: "vote", groupId: room.groupOf(bobSecond.id) });
      act(owner, { type: "advance", from: "vote" });

      const current = room.discussOrder()[0] ?? "";
      const [added] = act(alice, { type: "addComment", groupId: current, text: "alice says" });
      const commentId = added?.kind === "commentUpserted" ? added.commentId : "";
      act(alice, { type: "editComment", commentId, text: "alice says more" });
      act(bob, { type: "addAction", groupId: current, text: "bob does", assignee: "Bob" });
      act(owner, { type: "skip", fromIndex: 0 });
      act(alice, { type: "deleteComment", commentId });
      act(owner, { type: "advance", from: "discuss" });

      for (const { actor } of cast) {
        const entries = log.get(actor) ?? [];
        const json = JSON.stringify(entries.map((entry) => entry.message));
        for (const clientId of ALL_CLIENTS) expect(json).not.toContain(clientId);

        const othersWritten = cast
          .filter((member) => member.actor !== actor)
          .flatMap((member) => written.get(member.actor) ?? []);
        for (const { phase, message } of entries) {
          const text = JSON.stringify(message);
          const viewPhase = message.type === "snapshot" ? message.room.phase : phase;
          if (viewPhase === "write") {
            for (const item of othersWritten) {
              expect(text).not.toContain(item.id);
              expect(text).not.toContain(item.text);
            }
          } else {
            const items =
              message.type === "snapshot"
                ? message.room.items
                : message.type === "itemUpserted"
                  ? [message.item]
                  : [];
            for (const item of items) expect(item).not.toHaveProperty("mine");
          }
          if (viewPhase !== "discuss" && viewPhase !== "done") {
            if (message.type === "snapshot") expect(message.room.voteTotals).toBeNull();
            expect(message.type).not.toBe("discussCursor");
          }
          if (message.type === "commentUpserted")
            expect(message.comment.mine).toBe(actor === alice);
          if (message.type === "actionUpserted") expect(message.action.mine).toBe(actor === bob);
        }
      }

      const myVotes = (actor: Actor) =>
        (log.get(actor) ?? []).flatMap(({ message }) =>
          message.type === "myVotes" ? [message.votes] : [],
        );
      const theme = room.groupOf(bobFirst.id);
      expect(myVotes(alice)).toEqual([{ [theme]: 1 }]);
      expect(myVotes(bob)).toEqual([{ [theme]: 1 }, {}]);
      expect(myVotes(owner)).toEqual([{ [room.groupOf(bobSecond.id)]: 1 }]);
    });
  });
});
