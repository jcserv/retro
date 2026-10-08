import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { LIMITS } from "../../../src/shared/constants";
import { PHASES, type Phase } from "../../../src/shared/protocol";
import {
  actorFor,
  type ClientIntent,
  createRoom,
  joinRoom,
} from "../../../src/worker/room/commands";
import { migrate } from "../../../src/worker/room/schema";
import { RoomStore } from "../../../src/worker/room/store";
import {
  ALICE,
  alice,
  BOB,
  bob,
  expectGroupingInvariant,
  OWNER,
  owner,
  type Room,
  withRoom,
} from "./harness";

const ID = "00000000-0000-4000-8000-0000000000ff";

const SAMPLE_INTENTS: Record<ClientIntent["type"], ClientIntent> = {
  addItem: { type: "addItem", categoryId: "well", text: "x" },
  editItem: { type: "editItem", itemId: ID, text: "x" },
  deleteItem: { type: "deleteItem", itemId: ID },
  setReady: { type: "setReady", ready: true },
  moveItemToGroup: { type: "moveItemToGroup", itemId: ID, groupId: ID },
  mergeGroups: { type: "mergeGroups", sourceGroupId: ID, targetGroupId: ID },
  ungroupItem: { type: "ungroupItem", itemId: ID },
  renameGroup: { type: "renameGroup", groupId: ID, title: "x" },
  vote: { type: "vote", groupId: ID },
  unvote: { type: "unvote", groupId: ID },
  addComment: { type: "addComment", groupId: ID, text: "x" },
  editComment: { type: "editComment", commentId: ID, text: "x" },
  deleteComment: { type: "deleteComment", commentId: ID },
  convertComment: { type: "convertComment", commentId: ID },
  addAction: { type: "addAction", groupId: ID, text: "x" },
  editAction: { type: "editAction", actionId: ID, text: "x" },
  deleteAction: { type: "deleteAction", actionId: ID },
  advance: { type: "advance", from: "write" },
  setVoteLimit: { type: "setVoteLimit", limit: 3 },
  setTimer: { type: "setTimer", durationMs: 60_000 },
  pauseTimer: { type: "pauseTimer" },
  resumeTimer: { type: "resumeTimer" },
  addTimerMinute: { type: "addTimerMinute" },
  clearTimer: { type: "clearTimer" },
  next: { type: "next", fromIndex: 0 },
  prev: { type: "prev", fromIndex: 0 },
  skip: { type: "skip", fromIndex: 0 },
};

const ACTIVE: Phase[] = ["write", "group", "vote", "discuss"];
const ALLOWED_PHASES: Record<ClientIntent["type"], Phase[]> = {
  addItem: ["write"],
  editItem: ["write"],
  deleteItem: ["write"],
  setReady: ["write", "group"],
  moveItemToGroup: ["group"],
  mergeGroups: ["group"],
  ungroupItem: ["group"],
  renameGroup: ["group"],
  vote: ["vote"],
  unvote: ["vote"],
  addComment: ["discuss"],
  editComment: ["discuss"],
  deleteComment: ["discuss"],
  convertComment: ["discuss"],
  addAction: ["discuss"],
  editAction: ["discuss"],
  deleteAction: ["discuss"],
  advance: [...PHASES],
  setVoteLimit: ["write", "group", "vote"],
  setTimer: ACTIVE,
  pauseTimer: ACTIVE,
  resumeTimer: ACTIVE,
  addTimerMinute: ACTIVE,
  clearTimer: ACTIVE,
  next: ["discuss"],
  prev: ["discuss"],
  skip: ["discuss"],
};

const OWNER_ONLY = new Set<ClientIntent["type"]>([
  "advance",
  "setVoteLimit",
  "setTimer",
  "pauseTimer",
  "resumeTimer",
  "addTimerMinute",
  "clearTimer",
  "next",
  "prev",
  "skip",
]);

const intentTypes = Object.keys(SAMPLE_INTENTS) as ClientIntent["type"][];

function seedThreeItems(room: Room) {
  const a = room.addItem(alice, "well", "alice well");
  const b = room.addItem(bob, "less-well", "bob less");
  const c = room.addItem(owner, "puzzles", "owner puzzle");
  return { a, b, c };
}

test("migrate is idempotent and keeps existing data", async () => {
  const stub = env.ROOMS.getByName(crypto.randomUUID());
  await runInDurableObject(stub, (_instance, state) => {
    migrate(state.storage.sql);
    const store = new RoomStore(state.storage);
    createRoom(store, { code: "ABC234", ownerClientId: OWNER, now: 1 });
    migrate(state.storage.sql);
    expect(store.getRoom()?.code).toBe("ABC234");
  });
});

describe("permissions and phases", () => {
  test.each(intentTypes.filter((type) => OWNER_ONLY.has(type)))(
    "%s is forbidden for non-owners in every phase",
    async (type) => {
      await withRoom((room) => {
        for (const phase of PHASES) {
          room.advanceTo(phase);
          expect(room.rejects(alice, SAMPLE_INTENTS[type])).toBe("forbidden");
        }
      });
    },
  );

  test.each(PHASES)("intents outside their phases are rejected in %s", async (phase) => {
    await withRoom((room) => {
      room.advanceTo(phase);
      for (const type of intentTypes) {
        if (ALLOWED_PHASES[type].includes(phase)) continue;
        expect(room.rejects(owner, SAMPLE_INTENTS[type]), type).toBe("wrong_phase");
      }
    });
  });
});

describe("participants", () => {
  test("caps distinct participants but lets known ones rejoin", async () => {
    await withRoom(({ store }) => {
      for (let i = 0; i < LIMITS.participantsPerRoom; i++) {
        expect(joinRoom(store, `client-${i}`, 1).ok).toBe(true);
      }
      expect(joinRoom(store, "one-too-many", 2)).toEqual({ ok: false, reason: "room_full" });
      expect(joinRoom(store, "client-0", 3)).toEqual({
        ok: true,
        changes: [{ kind: "presenceChanged" }],
      });
      expect(store.countParticipants()).toBe(LIMITS.participantsPerRoom);
    });
  });
});

describe("write phase", () => {
  test("addItem rejects unknown categories and the 31st item per client", async () => {
    await withRoom((room) => {
      expect(room.rejects(alice, { type: "addItem", categoryId: "nope", text: "x" })).toBe(
        "not_found",
      );
      for (let i = 0; i < LIMITS.itemsPerClient; i++) room.addItem(alice, "well", `item ${i}`);
      expect(room.rejects(alice, { type: "addItem", categoryId: "well", text: "x" })).toBe(
        "item_limit",
      );
      expect(room.addItem(bob, "well", "bob still can")).toBeTruthy();
    });
  });

  test("addItem stores the item ungrouped and reports author and counts", async () => {
    await withRoom((room) => {
      const changes = room.ok(alice, { type: "addItem", categoryId: "well", text: "hi" });
      const itemId = changes[0]?.kind === "itemUpserted" ? changes[0].itemId : "";
      expect(changes).toEqual([
        { kind: "itemUpserted", itemId, authorId: ALICE },
        { kind: "categoryCountsChanged" },
      ]);
      expect(room.store.getItem(itemId)).toMatchObject({ clientId: ALICE, groupId: null });
    });
  });

  test("only the author can edit or delete an item", async () => {
    await withRoom((room) => {
      const itemId = room.addItem(alice, "well", "original");
      expect(room.rejects(bob, { type: "editItem", itemId, text: "hijack" })).toBe("forbidden");
      expect(room.rejects(owner, { type: "deleteItem", itemId })).toBe("forbidden");
      expect(room.rejects(alice, { type: "editItem", itemId: ID, text: "x" })).toBe("not_found");

      expect(room.ok(alice, { type: "editItem", itemId, text: "edited" })).toEqual([
        { kind: "itemUpserted", itemId, authorId: ALICE },
      ]);
      expect(room.store.getItem(itemId)?.text).toBe("edited");
      expect(room.ok(alice, { type: "deleteItem", itemId })).toEqual([
        { kind: "itemRemoved", itemId, authorId: ALICE },
        { kind: "categoryCountsChanged" },
      ]);
      expect(room.store.getItem(itemId)).toBeNull();
    });
  });

  test("setReady toggles the actor's flag", async () => {
    await withRoom((room) => {
      joinRoom(room.store, ALICE, room.now);
      expect(room.ok(alice, { type: "setReady", ready: true })).toEqual([
        { kind: "readyChanged", clientId: ALICE },
        { kind: "presenceChanged" },
      ]);
      expect(room.store.isReady(ALICE)).toBe(true);
      room.ok(alice, { type: "setReady", ready: false });
      expect(room.store.isReady(ALICE)).toBe(false);
    });
  });
});

describe("advance", () => {
  test("rejects a stale from and advances once on a double click", async () => {
    await withRoom((room) => {
      expect(room.rejects(owner, { type: "advance", from: "group" })).toBe("stale");
      room.ok(owner, { type: "advance", from: "write" });
      expect(room.rejects(owner, { type: "advance", from: "write" })).toBe("stale");
      expect(room.phase).toBe("group");
    });
  });

  test("write to group gives every item its own group in its category and resets state", async () => {
    await withRoom((room) => {
      joinRoom(room.store, ALICE, room.now);
      const { a, b, c } = seedThreeItems(room);
      room.ok(alice, { type: "setReady", ready: true });
      room.ok(owner, { type: "setTimer", durationMs: 60_000 });

      expect(room.ok(owner, { type: "advance", from: "write" })).toEqual([
        { kind: "phaseChanged" },
      ]);

      const groups = room.store.listGroups();
      expect(groups).toHaveLength(3);
      for (const itemId of [a, b, c]) {
        const item = room.store.getItem(itemId);
        const group = room.store.getGroup(room.groupOf(itemId));
        expect(group).toMatchObject({ categoryId: item?.categoryId, title: null });
      }
      expectGroupingInvariant(room.store);
      expect(room.store.isReady(ALICE)).toBe(false);
      expect(room.store.getRoom()?.timer).toEqual({ kind: "none" });
    });
  });

  test("group to vote clears the timer and ready flags", async () => {
    await withRoom((room) => {
      joinRoom(room.store, ALICE, room.now);
      room.advanceTo("group");
      room.ok(alice, { type: "setReady", ready: true });
      room.ok(owner, { type: "setTimer", durationMs: 60_000 });
      room.advanceTo("vote");
      expect(room.store.isReady(ALICE)).toBe(false);
      expect(room.store.getRoom()?.timer).toEqual({ kind: "none" });
    });
  });

  test("vote to discuss orders groups and marks the first discussed", async () => {
    await withRoom((room) => {
      const { a, b, c } = seedThreeItems(room);
      room.advanceTo("vote");
      room.ok(alice, { type: "vote", groupId: room.groupOf(c) });
      room.ok(bob, { type: "vote", groupId: room.groupOf(c) });
      room.ok(bob, { type: "vote", groupId: room.groupOf(b) });
      room.ok(owner, { type: "setTimer", durationMs: 60_000 });
      room.advanceTo("discuss");

      expect(room.discussOrder()).toEqual([room.groupOf(c), room.groupOf(b), room.groupOf(a)]);
      expect(room.store.listDiscussOrder().map((e) => e.status)).toEqual([
        "discussed",
        "pending",
        "pending",
      ]);
      expect(room.store.getRoom()).toMatchObject({ discussIndex: 0, timer: { kind: "none" } });
    });
  });

  test("discuss with no groups starts with an empty order", async () => {
    await withRoom((room) => {
      room.advanceTo("discuss");
      expect(room.discussOrder()).toEqual([]);
      expect(room.ok(owner, { type: "next", fromIndex: 0 })).toEqual([]);
      expect(room.ok(owner, { type: "skip", fromIndex: 0 })).toEqual([]);
      room.advanceTo("done");
    });
  });

  test("done cannot be advanced", async () => {
    await withRoom((room) => {
      room.advanceTo("done");
      expect(room.rejects(owner, { type: "advance", from: "done" })).toBe("wrong_phase");
      expect(room.rejects(owner, { type: "advance", from: "discuss" })).toBe("stale");
    });
  });
});

describe("grouping", () => {
  test("moveItemToGroup moves the item, keeps its category and deletes the emptied group", async () => {
    await withRoom((room) => {
      const { a, b } = seedThreeItems(room);
      room.advanceTo("group");
      const source = room.groupOf(a);
      const target = room.groupOf(b);

      expect(room.ok(alice, { type: "moveItemToGroup", itemId: a, groupId: target })).toEqual([
        { kind: "itemUpserted", itemId: a, authorId: ALICE },
        { kind: "groupUpserted", groupId: target },
        { kind: "groupRemoved", groupId: source },
      ]);
      expect(room.store.getItem(a)).toMatchObject({ groupId: target, categoryId: "well" });
      expect(room.store.getGroup(target)?.categoryId).toBe("less-well");
      expect(room.store.getGroup(source)).toBeNull();
      expect(room.ok(bob, { type: "moveItemToGroup", itemId: a, groupId: target })).toEqual([]);
      expectGroupingInvariant(room.store);
    });
  });

  test("moving one item out of a multi-item group keeps the source group", async () => {
    await withRoom((room) => {
      const { a, b, c } = seedThreeItems(room);
      room.advanceTo("group");
      const target = room.groupOf(b);
      room.ok(alice, { type: "moveItemToGroup", itemId: a, groupId: target });
      expect(
        room.ok(alice, { type: "moveItemToGroup", itemId: a, groupId: room.groupOf(c) }),
      ).toContainEqual({ kind: "groupUpserted", groupId: target });
      expect(room.store.listItemsInGroup(target).map((i) => i.id)).toEqual([b]);
      expectGroupingInvariant(room.store);
    });
  });

  test("mergeGroups moves every item into the target, which keeps its title and category", async () => {
    await withRoom((room) => {
      const { a, b, c } = seedThreeItems(room);
      room.advanceTo("group");
      room.ok(bob, { type: "moveItemToGroup", itemId: b, groupId: room.groupOf(a) });
      const source = room.groupOf(a);
      const target = room.groupOf(c);
      room.ok(bob, { type: "renameGroup", groupId: target, title: "Puzzles" });

      const changes = room.ok(alice, {
        type: "mergeGroups",
        sourceGroupId: source,
        targetGroupId: target,
      });
      expect(changes).toEqual([
        { kind: "itemUpserted", itemId: a, authorId: ALICE },
        { kind: "itemUpserted", itemId: b, authorId: BOB },
        { kind: "groupUpserted", groupId: target },
        { kind: "groupRemoved", groupId: source },
      ]);
      expect(room.store.getGroup(target)).toMatchObject({
        title: "Puzzles",
        categoryId: "puzzles",
      });
      expect(room.store.listItemsInGroup(target).map((i) => i.id)).toEqual([a, b, c]);
      expect(
        room.ok(alice, { type: "mergeGroups", sourceGroupId: target, targetGroupId: target }),
      ).toEqual([]);
      expectGroupingInvariant(room.store);
    });
  });

  test("ungroupItem restores the item's original category and is a no-op when alone", async () => {
    await withRoom((room) => {
      const { a, c } = seedThreeItems(room);
      room.advanceTo("group");
      expect(room.ok(alice, { type: "ungroupItem", itemId: a })).toEqual([]);
      const target = room.groupOf(c);
      room.ok(alice, { type: "moveItemToGroup", itemId: a, groupId: target });

      const changes = room.ok(bob, { type: "ungroupItem", itemId: a });
      const fresh = room.groupOf(a);
      expect(changes).toEqual([
        { kind: "groupUpserted", groupId: fresh },
        { kind: "itemUpserted", itemId: a, authorId: ALICE },
        { kind: "groupUpserted", groupId: target },
      ]);
      expect(room.store.getGroup(fresh)).toMatchObject({ categoryId: "well", title: null });
      expectGroupingInvariant(room.store);
    });
  });

  test("renameGroup with an empty title clears it", async () => {
    await withRoom((room) => {
      const { a } = seedThreeItems(room);
      room.advanceTo("group");
      const groupId = room.groupOf(a);
      room.ok(bob, { type: "renameGroup", groupId, title: "Named" });
      expect(room.store.getGroup(groupId)?.title).toBe("Named");
      room.ok(bob, { type: "renameGroup", groupId, title: "" });
      expect(room.store.getGroup(groupId)?.title).toBeNull();
    });
  });

  test("ops against a group deleted by a concurrent op return not_found", async () => {
    await withRoom((room) => {
      const { a, b, c } = seedThreeItems(room);
      room.advanceTo("group");
      const gone = room.groupOf(a);
      room.ok(alice, { type: "mergeGroups", sourceGroupId: gone, targetGroupId: room.groupOf(b) });

      expect(room.rejects(bob, { type: "moveItemToGroup", itemId: c, groupId: gone })).toBe(
        "not_found",
      );
      expect(
        room.rejects(bob, {
          type: "mergeGroups",
          sourceGroupId: gone,
          targetGroupId: room.groupOf(c),
        }),
      ).toBe("not_found");
      expect(room.rejects(bob, { type: "renameGroup", groupId: gone, title: "x" })).toBe(
        "not_found",
      );
      expect(room.rejects(bob, { type: "ungroupItem", itemId: ID })).toBe("not_found");
      expectGroupingInvariant(room.store);
    });
  });

  test("the grouping invariant holds after every op in a long random sequence", async () => {
    await withRoom((room) => {
      const itemIds: string[] = [];
      const categories = room.store.listCategories().map((c) => c.id);
      for (let i = 0; i < 12; i++) {
        itemIds.push(
          room.addItem(i % 2 ? alice : bob, categories[i % categories.length] ?? "", `${i}`),
        );
      }
      room.advanceTo("group");
      expectGroupingInvariant(room.store);

      let seed = 42;
      const random = (n: number) => {
        seed = (seed * 1_103_515_245 + 12_345) % 2 ** 31;
        return seed % n;
      };
      const pick = <T>(list: readonly T[]): T => list[random(list.length)] as T;

      for (let step = 0; step < 300; step++) {
        const groupIds = room.store.listGroups().map((g) => g.id);
        const op = random(3);
        if (op === 0) {
          room.ok(alice, {
            type: "moveItemToGroup",
            itemId: pick(itemIds),
            groupId: pick(groupIds),
          });
        } else if (op === 1) {
          room.ok(bob, {
            type: "mergeGroups",
            sourceGroupId: pick(groupIds),
            targetGroupId: pick(groupIds),
          });
        } else {
          room.ok(owner, { type: "ungroupItem", itemId: pick(itemIds) });
        }
        expectGroupingInvariant(room.store);
      }
      expect(room.store.listItems()).toHaveLength(itemIds.length);
    });
  });
});

describe("voting", () => {
  test("enforces the vote limit across groups and allows stacking on one group", async () => {
    await withRoom((room) => {
      const { a, b } = seedThreeItems(room);
      room.ok(owner, { type: "setVoteLimit", limit: 3 });
      room.advanceTo("vote");
      room.ok(alice, { type: "vote", groupId: room.groupOf(a) });
      room.ok(alice, { type: "vote", groupId: room.groupOf(a) });
      expect(room.ok(alice, { type: "vote", groupId: room.groupOf(b) })).toEqual([
        { kind: "votesChanged", clientId: ALICE },
      ]);
      expect(room.rejects(alice, { type: "vote", groupId: room.groupOf(b) })).toBe("vote_limit");
      expect(room.store.votesBy(ALICE)).toEqual({ [room.groupOf(a)]: 2, [room.groupOf(b)]: 1 });
      expect(room.rejects(alice, { type: "vote", groupId: ID })).toBe("not_found");
    });
  });

  test("lowering the limit keeps existing votes and blocks new ones", async () => {
    await withRoom((room) => {
      const { a } = seedThreeItems(room);
      room.advanceTo("vote");
      const groupId = room.groupOf(a);
      for (let i = 0; i < 4; i++) room.ok(alice, { type: "vote", groupId });
      room.ok(owner, { type: "setVoteLimit", limit: 2 });
      expect(room.store.votesUsedBy(ALICE)).toBe(4);
      expect(room.rejects(alice, { type: "vote", groupId })).toBe("vote_limit");
      room.ok(alice, { type: "unvote", groupId });
      room.ok(alice, { type: "unvote", groupId });
      expect(room.rejects(alice, { type: "vote", groupId })).toBe("vote_limit");
      room.ok(alice, { type: "unvote", groupId });
      room.ok(alice, { type: "vote", groupId });
    });
  });

  test("unvote decrements to zero and then is a no-op", async () => {
    await withRoom((room) => {
      const { a } = seedThreeItems(room);
      room.advanceTo("vote");
      const groupId = room.groupOf(a);
      room.ok(alice, { type: "vote", groupId });
      room.ok(alice, { type: "unvote", groupId });
      expect(room.store.votesBy(ALICE)).toEqual({});
      expect(room.ok(alice, { type: "unvote", groupId })).toEqual([]);
    });
  });
});

describe("discuss navigation", () => {
  async function inDiscussion(fn: (room: Room, order: string[]) => void) {
    await withRoom((room) => {
      seedThreeItems(room);
      room.advanceTo("discuss");
      fn(room, room.discussOrder());
    });
  }

  const statuses = (room: Room) => room.store.listDiscussOrder().map((e) => e.status);
  const index = (room: Room) => room.store.getRoom()?.discussIndex;

  test("next and prev move the cursor, clamp at the ends and reject stale indexes", async () => {
    await inDiscussion((room) => {
      expect(room.ok(owner, { type: "prev", fromIndex: 0 })).toEqual([]);
      expect(room.ok(owner, { type: "next", fromIndex: 0 })).toEqual([
        { kind: "discussCursorChanged" },
      ]);
      expect(room.rejects(owner, { type: "next", fromIndex: 0 })).toBe("stale");
      room.ok(owner, { type: "next", fromIndex: 1 });
      expect(room.ok(owner, { type: "next", fromIndex: 2 })).toEqual([]);
      expect(index(room)).toBe(2);
      room.ok(owner, { type: "prev", fromIndex: 2 });
      expect(index(room)).toBe(1);
      expect(statuses(room)).toEqual(["discussed", "discussed", "discussed"]);
    });
  });

  test("skip marks the current group skipped and moves on; revisiting marks it discussed", async () => {
    await inDiscussion((room) => {
      room.ok(owner, { type: "skip", fromIndex: 0 });
      expect(index(room)).toBe(1);
      expect(statuses(room)).toEqual(["skipped", "discussed", "pending"]);
      room.ok(owner, { type: "prev", fromIndex: 1 });
      expect(statuses(room)).toEqual(["discussed", "discussed", "pending"]);
    });
  });

  test("skipping the last group marks it skipped and leaves the cursor", async () => {
    await inDiscussion((room) => {
      room.ok(owner, { type: "next", fromIndex: 0 });
      room.ok(owner, { type: "next", fromIndex: 1 });
      room.ok(owner, { type: "skip", fromIndex: 2 });
      expect(index(room)).toBe(2);
      expect(statuses(room)).toEqual(["discussed", "discussed", "skipped"]);
    });
  });

  test("navigation leaves the timer running", async () => {
    await inDiscussion((room) => {
      room.ok(owner, { type: "setTimer", durationMs: 120_000 });
      const timer = room.store.getRoom()?.timer;
      room.ok(owner, { type: "next", fromIndex: 0 });
      room.ok(owner, { type: "skip", fromIndex: 1 });
      expect(room.store.getRoom()?.timer).toEqual(timer);
    });
  });
});

describe("comments and actions", () => {
  test("can only be added to the current group", async () => {
    await withRoom((room) => {
      seedThreeItems(room);
      room.advanceTo("discuss");
      const [current, other] = room.discussOrder();
      expect(room.rejects(alice, { type: "addComment", groupId: other ?? "", text: "x" })).toBe(
        "stale",
      );
      expect(room.rejects(alice, { type: "addAction", groupId: other ?? "", text: "x" })).toBe(
        "stale",
      );
      expect(room.rejects(alice, { type: "addComment", groupId: ID, text: "x" })).toBe("not_found");
      const changes = room.ok(alice, { type: "addComment", groupId: current ?? "", text: "x" });
      expect(changes[0]?.kind).toBe("commentUpserted");
    });
  });

  test("only the author can edit or delete a comment", async () => {
    await withRoom((room) => {
      seedThreeItems(room);
      room.advanceTo("discuss");
      const groupId = room.discussOrder()[0] ?? "";
      const change = room.ok(alice, { type: "addComment", groupId, text: "mine" })[0];
      const commentId = change?.kind === "commentUpserted" ? change.commentId : "";

      expect(room.rejects(bob, { type: "editComment", commentId, text: "x" })).toBe("forbidden");
      expect(room.rejects(owner, { type: "deleteComment", commentId })).toBe("forbidden");
      room.ok(alice, { type: "editComment", commentId, text: "edited" });
      expect(room.store.getComment(commentId)?.text).toBe("edited");
      expect(room.ok(alice, { type: "deleteComment", commentId })).toEqual([
        { kind: "commentRemoved", commentId },
      ]);
      expect(room.rejects(alice, { type: "deleteComment", commentId })).toBe("not_found");
    });
  });

  test("actions store an empty assignee as null and only the author can change them", async () => {
    await withRoom((room) => {
      seedThreeItems(room);
      room.advanceTo("discuss");
      const groupId = room.discussOrder()[0] ?? "";
      const change = room.ok(bob, { type: "addAction", groupId, text: "do it", assignee: "" })[0];
      const actionId = change?.kind === "actionUpserted" ? change.actionId : "";
      expect(room.store.getAction(actionId)?.assignee).toBeNull();

      expect(room.rejects(alice, { type: "editAction", actionId, text: "x" })).toBe("forbidden");
      expect(room.rejects(alice, { type: "deleteAction", actionId })).toBe("forbidden");
      room.ok(bob, { type: "editAction", actionId, text: "do it now", assignee: "Sam" });
      expect(room.store.getAction(actionId)).toMatchObject({ text: "do it now", assignee: "Sam" });
      room.ok(bob, { type: "deleteAction", actionId });
      expect(room.store.getAction(actionId)).toBeNull();
    });
  });

  test("actions store an empty due date as null", async () => {
    await withRoom((room) => {
      seedThreeItems(room);
      room.advanceTo("discuss");
      const groupId = room.discussOrder()[0] ?? "";
      const add = { type: "addAction", groupId, text: "ship it" } as const;
      const change = room.ok(bob, { ...add, dueDate: "2026-10-15" })[0];
      const actionId = change?.kind === "actionUpserted" ? change.actionId : "";
      expect(room.store.getAction(actionId)?.dueDate).toBe("2026-10-15");

      room.ok(bob, { type: "editAction", actionId, text: "ship it", dueDate: "" });
      expect(room.store.getAction(actionId)?.dueDate).toBeNull();
    });
  });

  test("converting a comment replaces it with an action item by the same author", async () => {
    await withRoom((room) => {
      seedThreeItems(room);
      room.advanceTo("discuss");
      const groupId = room.discussOrder()[0] ?? "";
      const added = room.ok(alice, { type: "addComment", groupId, text: "follow up" })[0];
      const commentId = added?.kind === "commentUpserted" ? added.commentId : "";

      expect(room.rejects(bob, { type: "convertComment", commentId })).toBe("forbidden");
      const changes = room.ok(alice, { type: "convertComment", commentId });
      expect(changes[0]).toEqual({ kind: "commentRemoved", commentId });
      const actionId = changes[1]?.kind === "actionUpserted" ? changes[1].actionId : "";
      expect(room.store.getComment(commentId)).toBeNull();
      expect(room.store.getAction(actionId)).toMatchObject({
        groupId,
        clientId: ALICE,
        text: "follow up",
        assignee: null,
        dueDate: null,
      });
      expect(room.rejects(alice, { type: "convertComment", commentId })).toBe("not_found");
    });
  });

  test("a comment too long for an action item cannot be converted", async () => {
    await withRoom((room) => {
      seedThreeItems(room);
      room.advanceTo("discuss");
      const groupId = room.discussOrder()[0] ?? "";
      const text = "a".repeat(LIMITS.actionTextMax + 1);
      const added = room.ok(alice, { type: "addComment", groupId, text })[0];
      const commentId = added?.kind === "commentUpserted" ? added.commentId : "";

      expect(room.rejects(alice, { type: "convertComment", commentId })).toBe("too_long");
      expect(room.store.getComment(commentId)?.text).toBe(text);
    });
  });

  test("a comment on a topic no longer being discussed cannot be converted", async () => {
    await withRoom((room) => {
      seedThreeItems(room);
      room.advanceTo("discuss");
      const groupId = room.discussOrder()[0] ?? "";
      const added = room.ok(alice, { type: "addComment", groupId, text: "later" })[0];
      const commentId = added?.kind === "commentUpserted" ? added.commentId : "";
      room.ok(owner, { type: "next", fromIndex: 0 });

      expect(room.rejects(alice, { type: "convertComment", commentId })).toBe("stale");
    });
  });
});

describe("timer", () => {
  test("set, pause, resume, add a minute and clear", async () => {
    await withRoom((room) => {
      const timer = () => room.store.getRoom()?.timer;
      expect(room.rejects(owner, { type: "pauseTimer" })).toBe("stale");
      expect(room.rejects(owner, { type: "addTimerMinute" })).toBe("stale");

      room.ok(owner, { type: "setTimer", durationMs: 120_000 });
      const endsAt = room.now + 120_000;
      expect(timer()).toEqual({ kind: "running", endsAt });

      room.tick(29_999);
      room.ok(owner, { type: "pauseTimer" });
      expect(timer()).toEqual({ kind: "paused", remainingMs: 90_000 });
      expect(room.rejects(owner, { type: "pauseTimer" })).toBe("stale");

      room.ok(owner, { type: "addTimerMinute" });
      expect(timer()).toEqual({ kind: "paused", remainingMs: 150_000 });

      room.ok(owner, { type: "resumeTimer" });
      const resumedEndsAt = room.now + 150_000;
      expect(timer()).toEqual({ kind: "running", endsAt: resumedEndsAt });
      expect(room.rejects(owner, { type: "resumeTimer" })).toBe("stale");

      room.ok(owner, { type: "addTimerMinute" });
      expect(timer()).toEqual({ kind: "running", endsAt: resumedEndsAt + 60_000 });

      expect(room.ok(owner, { type: "clearTimer" })).toEqual([{ kind: "timerChanged" }]);
      expect(timer()).toEqual({ kind: "none" });
    });
  });

  test("pausing an expired timer stores zero remaining", async () => {
    await withRoom((room) => {
      room.ok(owner, { type: "setTimer", durationMs: 60_000 });
      room.tick(120_000);
      room.ok(owner, { type: "pauseTimer" });
      expect(room.store.getRoom()?.timer).toEqual({ kind: "paused", remainingMs: 0 });
    });
  });

  test("adding a minute to an expired timer runs one minute from now", async () => {
    await withRoom((room) => {
      room.ok(owner, { type: "setTimer", durationMs: 60_000 });
      room.tick(600_000);
      room.ok(owner, { type: "addTimerMinute" });
      expect(room.store.getRoom()?.timer).toEqual({ kind: "running", endsAt: room.now + 60_000 });
    });
  });
});

test("owner identity comes from the stored owner client id", async () => {
  await withRoom(({ store }) => {
    expect(actorFor(store, OWNER)).toEqual({ clientId: OWNER, isOwner: true });
    expect(actorFor(store, ALICE)).toEqual({ clientId: ALICE, isOwner: false });
  });
});
