import type {
  ActionView,
  CommentView,
  DiscussState,
  GroupView,
  ItemView,
  Phase,
  Presence,
  RoomSnapshot,
  ServerMessage,
} from "../../shared/protocol";
import type { Change } from "./commands";
import type { Action, Comment, Group, Item, Room, RoomStore } from "./store";

export type Viewer = { clientId: string; isOwner: boolean };

export type ViewContext = { now: number; connectedClientIds: ReadonlySet<string> };

const isRevealed = (phase: Phase): boolean => phase !== "write";
const hasVotes = (phase: Phase): boolean =>
  phase === "vote" || phase === "discuss" || phase === "done";
const isDiscussing = (phase: Phase): boolean => phase === "discuss" || phase === "done";

const ownItemView = (item: Item): ItemView => ({
  id: item.id,
  categoryId: item.categoryId,
  groupId: null,
  text: item.text,
  mine: true,
  createdAt: item.createdAt,
});

const revealedItemView = (item: Item): ItemView => ({
  id: item.id,
  categoryId: item.categoryId,
  groupId: item.groupId,
  text: item.text,
  createdAt: item.createdAt,
});

const groupView = (group: Group, items: readonly Item[]): GroupView => ({
  id: group.id,
  categoryId: group.categoryId,
  title: group.title,
  itemIds: items.map((item) => item.id),
  createdAt: group.createdAt,
});

const commentView = (comment: Comment, viewer: Viewer): CommentView => ({
  id: comment.id,
  groupId: comment.groupId,
  text: comment.text,
  mine: comment.clientId === viewer.clientId,
  createdAt: comment.createdAt,
  updatedAt: comment.updatedAt,
});

const actionView = (action: Action, viewer: Viewer): ActionView => ({
  id: action.id,
  groupId: action.groupId,
  text: action.text,
  assignee: action.assignee,
  dueDate: action.dueDate,
  mine: action.clientId === viewer.clientId,
  createdAt: action.createdAt,
  updatedAt: action.updatedAt,
});

function requireRoom(store: RoomStore): Room {
  const room = store.getRoom();
  if (!room) throw new Error("Room not initialized");
  return room;
}

function presence(store: RoomStore, ctx: ViewContext): Presence {
  const readyCount = store
    .listReadyClientIds()
    .filter((clientId) => ctx.connectedClientIds.has(clientId)).length;
  return {
    participantCount: store.countParticipants(),
    connectedCount: ctx.connectedClientIds.size,
    readyCount,
  };
}

function discussState(store: RoomStore, room: Room): DiscussState {
  const entries = store.listDiscussOrder();
  return {
    order: entries.map((entry) => entry.groupId),
    currentIndex: room.discussIndex,
    status: Object.fromEntries(entries.map((entry) => [entry.groupId, entry.status])),
  };
}

function listGroupViews(store: RoomStore, items: readonly Item[]): GroupView[] {
  const byGroup = new Map<string | null, Item[]>();
  for (const item of items) byGroup.set(item.groupId, [...(byGroup.get(item.groupId) ?? []), item]);
  return store.listGroups().map((group) => groupView(group, byGroup.get(group.id) ?? []));
}

export function snapshot(store: RoomStore, viewer: Viewer, ctx: ViewContext): RoomSnapshot {
  const room = requireRoom(store);
  const revealed = isRevealed(room.phase);
  const discussing = isDiscussing(room.phase);
  const allItems = revealed ? store.listItems() : [];
  return {
    code: room.code,
    createdAt: room.createdAt,
    expiresAt: room.expiresAt,
    serverNow: ctx.now,
    phase: room.phase,
    categories: store.listCategories(),
    isOwner: viewer.isOwner,
    presence: presence(store, ctx),
    youReady: store.isReady(viewer.clientId),
    timer: room.timer,
    voteLimit: room.voteLimit,
    items: revealed
      ? allItems.map(revealedItemView)
      : store.listItemsByClient(viewer.clientId).map(ownItemView),
    groups: revealed ? listGroupViews(store, allItems) : [],
    categoryCounts: store.countItemsByCategory(),
    myVotes: hasVotes(room.phase) ? store.votesBy(viewer.clientId) : {},
    voteTotals: discussing ? store.voteTotals() : null,
    discuss: discussing ? discussState(store, room) : null,
    comments: store.listComments().map((comment) => commentView(comment, viewer)),
    actions: store.listActions().map((action) => actionView(action, viewer)),
  };
}

export function project(
  store: RoomStore,
  change: Change,
  viewer: Viewer,
  ctx: ViewContext,
): ServerMessage | null {
  const room = requireRoom(store);
  switch (change.kind) {
    case "phaseChanged":
      return { type: "snapshot", room: snapshot(store, viewer, ctx) };
    case "itemUpserted": {
      const item = store.getItem(change.itemId);
      if (!item) return null;
      if (isRevealed(room.phase)) return { type: "itemUpserted", item: revealedItemView(item) };
      if (change.authorId !== viewer.clientId) return null;
      return { type: "itemUpserted", item: ownItemView(item) };
    }
    case "itemRemoved":
      if (!isRevealed(room.phase) && change.authorId !== viewer.clientId) return null;
      return { type: "itemRemoved", itemId: change.itemId };
    case "groupUpserted": {
      if (!isRevealed(room.phase)) return null;
      const group = store.getGroup(change.groupId);
      if (!group) return null;
      return {
        type: "groupUpserted",
        group: groupView(group, store.listItemsInGroup(group.id)),
      };
    }
    case "groupRemoved":
      if (!isRevealed(room.phase)) return null;
      return { type: "groupRemoved", groupId: change.groupId };
    case "categoryCountsChanged":
      return { type: "categoryCounts", counts: store.countItemsByCategory() };
    case "presenceChanged":
      return { type: "presence", presence: presence(store, ctx) };
    case "readyChanged":
      if (change.clientId !== viewer.clientId) return null;
      return { type: "youReady", ready: store.isReady(viewer.clientId) };
    case "votesChanged":
      if (change.clientId !== viewer.clientId) return null;
      return { type: "myVotes", votes: store.votesBy(viewer.clientId) };
    case "voteLimitChanged":
      return { type: "voteLimit", limit: room.voteLimit };
    case "timerChanged":
      return { type: "timer", timer: room.timer, serverNow: ctx.now };
    case "discussCursorChanged": {
      const { currentIndex, status } = discussState(store, room);
      return { type: "discussCursor", currentIndex, status };
    }
    case "commentUpserted": {
      const comment = store.getComment(change.commentId);
      return comment ? { type: "commentUpserted", comment: commentView(comment, viewer) } : null;
    }
    case "commentRemoved":
      return { type: "commentRemoved", commentId: change.commentId };
    case "actionUpserted": {
      const action = store.getAction(change.actionId);
      return action ? { type: "actionUpserted", action: actionView(action, viewer) } : null;
    }
    case "actionRemoved":
      return { type: "actionRemoved", actionId: change.actionId };
  }
}
