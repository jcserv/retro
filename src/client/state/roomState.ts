import type { RoomSnapshot, ServerMessage } from "../../shared/protocol";

export type RoomState = Omit<RoomSnapshot, "serverNow">;

function upsert<T extends { id: string }>(list: T[], next: T): T[] {
  const index = list.findIndex((entry) => entry.id === next.id);
  if (index === -1) return [...list, next];
  return list.with(index, next);
}

function remove<T extends { id: string }>(list: T[], id: string): T[] {
  return list.filter((entry) => entry.id !== id);
}

export function applyServerMessage(state: RoomState | null, msg: ServerMessage): RoomState | null {
  if (msg.type === "snapshot") {
    const { serverNow: _, ...room } = msg.room;
    return room;
  }
  if (!state) return state;
  switch (msg.type) {
    case "ack":
    case "error":
      return state;
    case "itemUpserted":
      return { ...state, items: upsert(state.items, msg.item) };
    case "itemRemoved":
      return { ...state, items: remove(state.items, msg.itemId) };
    case "groupUpserted":
      return { ...state, groups: upsert(state.groups, msg.group) };
    case "groupRemoved":
      return { ...state, groups: remove(state.groups, msg.groupId) };
    case "categoryCounts":
      return { ...state, categoryCounts: msg.counts };
    case "presence":
      return { ...state, presence: msg.presence };
    case "youReady":
      return { ...state, youReady: msg.ready };
    case "myVotes":
      return { ...state, myVotes: msg.votes };
    case "voteLimit":
      return { ...state, voteLimit: msg.limit };
    case "timer":
      return { ...state, timer: msg.timer };
    case "discussCursor":
      if (!state.discuss) return state;
      return {
        ...state,
        discuss: { ...state.discuss, currentIndex: msg.currentIndex, status: msg.status },
      };
    case "commentUpserted":
      return { ...state, comments: upsert(state.comments, msg.comment) };
    case "commentRemoved":
      return { ...state, comments: remove(state.comments, msg.commentId) };
    case "actionUpserted":
      return { ...state, actions: upsert(state.actions, msg.action) };
    case "actionRemoved":
      return { ...state, actions: remove(state.actions, msg.actionId) };
  }
}
