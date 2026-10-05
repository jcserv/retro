import { DEFAULT_CATEGORIES, LIMITS, ROOM_TTL_MS } from "../../shared/constants";
import { type ClientMessage, type ErrorCode, PHASES, type Phase } from "../../shared/protocol";
import { discussOrder } from "./discussOrder";
import type { Item, Room, RoomStore } from "./store";

export type ClientIntent = Exclude<ClientMessage, { type: "hello" }>;
type IntentType = ClientIntent["type"];
type IntentOf<K extends IntentType> = Extract<ClientIntent, { type: K }>;

export type Actor = { clientId: string; isOwner: boolean };

export type Change =
  | { kind: "phaseChanged" }
  | { kind: "itemUpserted"; itemId: string; authorId: string }
  | { kind: "itemRemoved"; itemId: string; authorId: string }
  | { kind: "groupUpserted"; groupId: string }
  | { kind: "groupRemoved"; groupId: string }
  | { kind: "categoryCountsChanged" }
  | { kind: "presenceChanged" }
  | { kind: "readyChanged"; clientId: string }
  | { kind: "votesChanged"; clientId: string }
  | { kind: "voteLimitChanged" }
  | { kind: "timerChanged" }
  | { kind: "discussCursorChanged" }
  | { kind: "commentUpserted"; commentId: string }
  | { kind: "commentRemoved"; commentId: string }
  | { kind: "actionUpserted"; actionId: string }
  | { kind: "actionRemoved"; actionId: string };

export type CommandResult =
  | { ok: true; changes: Change[] }
  | { ok: false; code: ErrorCode; message: string };

export type JoinResult = { ok: true; changes: Change[] } | { ok: false; reason: "room_full" };

type Context = { store: RoomStore; actor: Actor; room: Room; now: number };
type Rule = { ownerOnly: boolean; phases: readonly Phase[] };
type Handler<K extends IntentType> = (ctx: Context, intent: IntentOf<K>) => CommandResult;

const TIMER_MINUTE_MS = 60_000;
const ACTIVE_PHASES: readonly Phase[] = ["write", "group", "vote", "discuss"];

const RULES: { [K in IntentType]: Rule } = {
  addItem: { ownerOnly: false, phases: ["write"] },
  editItem: { ownerOnly: false, phases: ["write"] },
  deleteItem: { ownerOnly: false, phases: ["write"] },
  setReady: { ownerOnly: false, phases: ["write", "group"] },
  moveItemToGroup: { ownerOnly: false, phases: ["group"] },
  mergeGroups: { ownerOnly: false, phases: ["group"] },
  ungroupItem: { ownerOnly: false, phases: ["group"] },
  renameGroup: { ownerOnly: false, phases: ["group"] },
  vote: { ownerOnly: false, phases: ["vote"] },
  unvote: { ownerOnly: false, phases: ["vote"] },
  addComment: { ownerOnly: false, phases: ["discuss"] },
  editComment: { ownerOnly: false, phases: ["discuss"] },
  deleteComment: { ownerOnly: false, phases: ["discuss"] },
  addAction: { ownerOnly: false, phases: ["discuss"] },
  editAction: { ownerOnly: false, phases: ["discuss"] },
  deleteAction: { ownerOnly: false, phases: ["discuss"] },
  advance: { ownerOnly: true, phases: PHASES },
  setVoteLimit: { ownerOnly: true, phases: ["write", "group", "vote"] },
  setTimer: { ownerOnly: true, phases: ACTIVE_PHASES },
  pauseTimer: { ownerOnly: true, phases: ACTIVE_PHASES },
  resumeTimer: { ownerOnly: true, phases: ACTIVE_PHASES },
  addTimerMinute: { ownerOnly: true, phases: ACTIVE_PHASES },
  clearTimer: { ownerOnly: true, phases: ACTIVE_PHASES },
  next: { ownerOnly: true, phases: ["discuss"] },
  prev: { ownerOnly: true, phases: ["discuss"] },
  skip: { ownerOnly: true, phases: ["discuss"] },
};

const ok = (...changes: Change[]): CommandResult => ({ ok: true, changes });
const fail = (code: ErrorCode, message: string): CommandResult => ({ ok: false, code, message });

const itemUpserted = (item: Item): Change => ({
  kind: "itemUpserted",
  itemId: item.id,
  authorId: item.clientId,
});

export function createRoom(
  store: RoomStore,
  params: { code: string; ownerClientId: string; now: number },
): void {
  store.transaction(() => {
    store.insertRoom({
      code: params.code,
      ownerClientId: params.ownerClientId,
      createdAt: params.now,
      expiresAt: params.now + ROOM_TTL_MS,
      phase: "write",
      voteLimit: LIMITS.voteLimitDefault,
    });
    DEFAULT_CATEGORIES.forEach((category, position) => {
      store.insertCategory(category, position);
    });
  });
}

export function actorFor(store: RoomStore, clientId: string): Actor {
  return { clientId, isOwner: store.getRoom()?.ownerClientId === clientId };
}

export function joinRoom(store: RoomStore, clientId: string, now: number): JoinResult {
  if (!store.hasParticipant(clientId)) {
    if (store.countParticipants() >= LIMITS.participantsPerRoom) {
      return { ok: false, reason: "room_full" };
    }
    store.insertParticipant(clientId, now);
  }
  return { ok: true, changes: [{ kind: "presenceChanged" }] };
}

export function handle(
  store: RoomStore,
  actor: Actor,
  intent: ClientIntent,
  now: number,
): CommandResult {
  const room = store.getRoom();
  if (!room) return fail("not_found", "Room not found");
  const rule = RULES[intent.type];
  if (rule.ownerOnly && !actor.isOwner) return fail("forbidden", "Only the owner can do that");
  if (!rule.phases.includes(room.phase)) {
    return fail("wrong_phase", `Not allowed in the ${room.phase} phase`);
  }
  const handler = HANDLERS[intent.type] as Handler<typeof intent.type>;
  return store.transaction(() => handler({ store, actor, room, now }, intent));
}

const HANDLERS: { [K in IntentType]: Handler<K> } = {
  addItem({ store, actor, now }, { categoryId, text }) {
    if (!store.categoryExists(categoryId)) return fail("not_found", "Category not found");
    if (store.countItemsByClient(actor.clientId) >= LIMITS.itemsPerClient) {
      return fail("item_limit", `You can add at most ${LIMITS.itemsPerClient} items`);
    }
    const item: Item = {
      id: crypto.randomUUID(),
      clientId: actor.clientId,
      categoryId,
      groupId: null,
      text,
      createdAt: now,
      updatedAt: now,
    };
    store.insertItem(item);
    return ok(itemUpserted(item), { kind: "categoryCountsChanged" });
  },

  editItem({ store, actor, now }, { itemId, text }) {
    const item = store.getItem(itemId);
    if (!item) return fail("not_found", "Item not found");
    if (item.clientId !== actor.clientId) return fail("forbidden", "Not your item");
    store.updateItemText(itemId, text, now);
    return ok(itemUpserted(item));
  },

  deleteItem({ store, actor }, { itemId }) {
    const item = store.getItem(itemId);
    if (!item) return fail("not_found", "Item not found");
    if (item.clientId !== actor.clientId) return fail("forbidden", "Not your item");
    store.deleteItem(itemId);
    return ok(
      { kind: "itemRemoved", itemId, authorId: item.clientId },
      { kind: "categoryCountsChanged" },
    );
  },

  setReady({ store, actor }, { ready }) {
    store.setReady(actor.clientId, ready);
    return ok({ kind: "readyChanged", clientId: actor.clientId }, { kind: "presenceChanged" });
  },

  moveItemToGroup({ store }, { itemId, groupId }) {
    const item = store.getItem(itemId);
    if (!item?.groupId) return fail("not_found", "Item not found");
    if (!store.getGroup(groupId)) return fail("not_found", "Group not found");
    if (item.groupId === groupId) return ok();
    const sourceId = item.groupId;
    store.moveItem(itemId, groupId);
    return ok(
      itemUpserted(item),
      { kind: "groupUpserted", groupId },
      removeGroupIfEmpty(store, sourceId),
    );
  },

  mergeGroups({ store }, { sourceGroupId, targetGroupId }) {
    if (!store.getGroup(sourceGroupId)) return fail("not_found", "Group not found");
    if (!store.getGroup(targetGroupId)) return fail("not_found", "Group not found");
    if (sourceGroupId === targetGroupId) return ok();
    const moved = store.listItemsInGroup(sourceGroupId);
    for (const item of moved) store.moveItem(item.id, targetGroupId);
    store.deleteGroup(sourceGroupId);
    return ok(
      ...moved.map(itemUpserted),
      { kind: "groupUpserted", groupId: targetGroupId },
      { kind: "groupRemoved", groupId: sourceGroupId },
    );
  },

  ungroupItem({ store, now }, { itemId }) {
    const item = store.getItem(itemId);
    if (!item?.groupId) return fail("not_found", "Item not found");
    if (store.countItemsInGroup(item.groupId) <= 1) return ok();
    const groupId = crypto.randomUUID();
    store.insertGroup({ id: groupId, categoryId: item.categoryId, title: null, createdAt: now });
    store.moveItem(itemId, groupId);
    return ok({ kind: "groupUpserted", groupId }, itemUpserted(item), {
      kind: "groupUpserted",
      groupId: item.groupId,
    });
  },

  renameGroup({ store }, { groupId, title }) {
    if (!store.getGroup(groupId)) return fail("not_found", "Group not found");
    store.setGroupTitle(groupId, title === "" ? null : title);
    return ok({ kind: "groupUpserted", groupId });
  },

  vote({ store, actor, room }, { groupId }) {
    if (!store.getGroup(groupId)) return fail("not_found", "Group not found");
    if (store.votesUsedBy(actor.clientId) >= room.voteLimit) {
      return fail("vote_limit", "No votes left");
    }
    store.setVote(actor.clientId, groupId, store.getVote(actor.clientId, groupId) + 1);
    return ok({ kind: "votesChanged", clientId: actor.clientId });
  },

  unvote({ store, actor }, { groupId }) {
    if (!store.getGroup(groupId)) return fail("not_found", "Group not found");
    const current = store.getVote(actor.clientId, groupId);
    if (current === 0) return ok();
    store.setVote(actor.clientId, groupId, current - 1);
    return ok({ kind: "votesChanged", clientId: actor.clientId });
  },

  addComment(ctx, { groupId, text }) {
    const guard = requireCurrentGroup(ctx, groupId);
    if (guard) return guard;
    const id = crypto.randomUUID();
    ctx.store.insertComment({
      id,
      groupId,
      clientId: ctx.actor.clientId,
      text,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    return ok({ kind: "commentUpserted", commentId: id });
  },

  editComment({ store, actor, now }, { commentId, text }) {
    const comment = store.getComment(commentId);
    if (!comment) return fail("not_found", "Comment not found");
    if (comment.clientId !== actor.clientId) return fail("forbidden", "Not your comment");
    store.updateCommentText(commentId, text, now);
    return ok({ kind: "commentUpserted", commentId });
  },

  deleteComment({ store, actor }, { commentId }) {
    const comment = store.getComment(commentId);
    if (!comment) return fail("not_found", "Comment not found");
    if (comment.clientId !== actor.clientId) return fail("forbidden", "Not your comment");
    store.deleteComment(commentId);
    return ok({ kind: "commentRemoved", commentId });
  },

  addAction(ctx, { groupId, text, assignee }) {
    const guard = requireCurrentGroup(ctx, groupId);
    if (guard) return guard;
    const id = crypto.randomUUID();
    ctx.store.insertAction({
      id,
      groupId,
      clientId: ctx.actor.clientId,
      text,
      assignee: assignee || null,
      createdAt: ctx.now,
      updatedAt: ctx.now,
    });
    return ok({ kind: "actionUpserted", actionId: id });
  },

  editAction({ store, actor, now }, { actionId, text, assignee }) {
    const action = store.getAction(actionId);
    if (!action) return fail("not_found", "Action item not found");
    if (action.clientId !== actor.clientId) return fail("forbidden", "Not your action item");
    store.updateAction(actionId, text, assignee || null, now);
    return ok({ kind: "actionUpserted", actionId });
  },

  deleteAction({ store, actor }, { actionId }) {
    const action = store.getAction(actionId);
    if (!action) return fail("not_found", "Action item not found");
    if (action.clientId !== actor.clientId) return fail("forbidden", "Not your action item");
    store.deleteAction(actionId);
    return ok({ kind: "actionRemoved", actionId });
  },

  advance({ store, room, now }, { from }) {
    if (from !== room.phase) return fail("stale", "The phase already changed");
    if (room.phase === "done") return fail("wrong_phase", "The retro is already done");
    store.setTimer({ kind: "none" });
    switch (room.phase) {
      case "write":
        store.resetAllReady();
        for (const item of store.listItems()) {
          const groupId = crypto.randomUUID();
          store.insertGroup({
            id: groupId,
            categoryId: item.categoryId,
            title: null,
            createdAt: now,
          });
          store.moveItem(item.id, groupId);
        }
        store.setPhase("group");
        break;
      case "group":
        store.resetAllReady();
        store.setPhase("vote");
        break;
      case "vote":
        startDiscussion(store);
        store.setPhase("discuss");
        break;
      case "discuss":
        store.setPhase("done");
        break;
    }
    return ok({ kind: "phaseChanged" });
  },

  setVoteLimit({ store }, { limit }) {
    store.setVoteLimit(limit);
    return ok({ kind: "voteLimitChanged" });
  },

  setTimer({ store, now }, { durationMs }) {
    store.setTimer({ kind: "running", endsAt: now + durationMs });
    return ok({ kind: "timerChanged" });
  },

  pauseTimer({ store, room, now }) {
    if (room.timer.kind !== "running") return fail("stale", "The timer is not running");
    store.setTimer({ kind: "paused", remainingMs: Math.max(0, room.timer.endsAt - now) });
    return ok({ kind: "timerChanged" });
  },

  resumeTimer({ store, room, now }) {
    if (room.timer.kind !== "paused") return fail("stale", "The timer is not paused");
    store.setTimer({ kind: "running", endsAt: now + room.timer.remainingMs });
    return ok({ kind: "timerChanged" });
  },

  addTimerMinute({ store, room, now }) {
    const { timer } = room;
    if (timer.kind === "none") return fail("stale", "No timer is set");
    store.setTimer(
      timer.kind === "running"
        ? { kind: "running", endsAt: Math.max(timer.endsAt, now) + TIMER_MINUTE_MS }
        : { kind: "paused", remainingMs: timer.remainingMs + TIMER_MINUTE_MS },
    );
    return ok({ kind: "timerChanged" });
  },

  clearTimer({ store }) {
    store.setTimer({ kind: "none" });
    return ok({ kind: "timerChanged" });
  },

  next(ctx, { fromIndex }) {
    return moveCursor(ctx, fromIndex, +1);
  },

  prev(ctx, { fromIndex }) {
    return moveCursor(ctx, fromIndex, -1);
  },

  skip(ctx, { fromIndex }) {
    const { store, room } = ctx;
    if (fromIndex !== room.discussIndex) return fail("stale", "The discussion already moved");
    const count = store.listDiscussOrder().length;
    if (room.discussIndex >= count) return ok();
    store.setDiscussStatus(room.discussIndex, "skipped");
    if (room.discussIndex + 1 < count) arriveAt(store, room.discussIndex + 1);
    return ok({ kind: "discussCursorChanged" });
  },
};

function removeGroupIfEmpty(store: RoomStore, groupId: string): Change {
  if (store.countItemsInGroup(groupId) > 0) return { kind: "groupUpserted", groupId };
  store.deleteGroup(groupId);
  return { kind: "groupRemoved", groupId };
}

function requireCurrentGroup({ store, room }: Context, groupId: string): CommandResult | null {
  if (!store.getGroup(groupId)) return fail("not_found", "Group not found");
  const current = store.listDiscussOrder()[room.discussIndex];
  if (current?.groupId !== groupId) return fail("stale", "That group is no longer being discussed");
  return null;
}

function startDiscussion(store: RoomStore): void {
  const categoryPosition = new Map(store.listCategories().map((c, index) => [c.id, index]));
  const totals = store.voteTotals();
  const earliestItemAt = new Map<string, number>();
  for (const item of store.listItems()) {
    if (item.groupId && !earliestItemAt.has(item.groupId)) {
      earliestItemAt.set(item.groupId, item.createdAt);
    }
  }
  const order = discussOrder(
    store.listGroups().map((group) => ({
      groupId: group.id,
      votes: totals[group.id] ?? 0,
      categoryPosition: categoryPosition.get(group.categoryId) ?? Number.MAX_SAFE_INTEGER,
      earliestItemAt: earliestItemAt.get(group.id) ?? group.createdAt,
    })),
  );
  store.replaceDiscussOrder(order);
  if (order.length > 0) arriveAt(store, 0);
  else store.setDiscussIndex(0);
}

function arriveAt(store: RoomStore, index: number): void {
  store.setDiscussIndex(index);
  store.setDiscussStatus(index, "discussed");
}

function moveCursor({ store, room }: Context, fromIndex: number, step: 1 | -1): CommandResult {
  if (fromIndex !== room.discussIndex) return fail("stale", "The discussion already moved");
  const target = room.discussIndex + step;
  if (target < 0 || target >= store.listDiscussOrder().length) return ok();
  arriveAt(store, target);
  return ok({ kind: "discussCursorChanged" });
}
