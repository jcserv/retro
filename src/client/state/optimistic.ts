import type { GroupView, ItemView, ReactionView } from "../../shared/protocol";
import type { Intent } from "../lib/connection";
import type { RoomState } from "./roomState";

export type GroupingIntent = Extract<
  Intent,
  { type: "moveItemToGroup" | "mergeGroups" | "ungroupItem" }
>;

export type ReactionIntent = Extract<Intent, { type: "addReaction" | "removeReaction" }>;

export type OptimisticIntent =
  | GroupingIntent
  | ReactionIntent
  | Extract<Intent, { type: "setVoteLimit" }>;

export type PendingOp = { reqId: string; intent: OptimisticIntent; issuedAt: number };

export const PENDING_GROUP_ID_PREFIX = "pending:";

function orderItemIds(itemIds: string[], items: ItemView[]): string[] {
  const byId = new Map(items.map((entry) => [entry.id, entry]));
  return [...new Set(itemIds)].sort((a, b) => {
    const left = byId.get(a);
    const right = byId.get(b);
    const diff = (left?.createdAt ?? 0) - (right?.createdAt ?? 0);
    return diff !== 0 ? diff : a.localeCompare(b);
  });
}

function moveItems(state: RoomState, itemIds: string[], target: GroupView): RoomState {
  const moving = new Set(itemIds);
  const items = state.items.map((entry) =>
    moving.has(entry.id) ? { ...entry, groupId: target.id } : entry,
  );
  const groups: GroupView[] = [];
  for (const entry of state.groups) {
    if (entry.id === target.id) {
      groups.push({ ...entry, itemIds: orderItemIds([...entry.itemIds, ...itemIds], items) });
      continue;
    }
    const remaining = entry.itemIds.filter((id) => !moving.has(id));
    if (remaining.length === 0) continue;
    groups.push(
      remaining.length === entry.itemIds.length ? entry : { ...entry, itemIds: remaining },
    );
  }
  return { ...state, items, groups };
}

function toggleReaction(reactions: ReactionView[], intent: ReactionIntent): ReactionView[] {
  const adding = intent.type === "addReaction";
  const existing = reactions.find((reaction) => reaction.emoji === intent.emoji);
  if (!existing) {
    return adding ? [...reactions, { emoji: intent.emoji, count: 1, mine: true }] : reactions;
  }
  if (existing.mine === adding) return reactions;
  const count = existing.count + (adding ? 1 : -1);
  return reactions.flatMap((reaction) =>
    reaction !== existing ? [reaction] : count > 0 ? [{ ...reaction, count, mine: adding }] : [],
  );
}

function applyOp(state: RoomState, op: PendingOp): RoomState {
  const { intent } = op;
  switch (intent.type) {
    case "moveItemToGroup": {
      const moving = state.items.find((entry) => entry.id === intent.itemId);
      const target = state.groups.find((entry) => entry.id === intent.groupId);
      if (!moving || !target || moving.groupId === target.id) return state;
      return moveItems(state, [moving.id], target);
    }
    case "mergeGroups": {
      if (intent.sourceGroupId === intent.targetGroupId) return state;
      const source = state.groups.find((entry) => entry.id === intent.sourceGroupId);
      const target = state.groups.find((entry) => entry.id === intent.targetGroupId);
      if (!source || !target) return state;
      return moveItems(state, source.itemIds, target);
    }
    case "ungroupItem": {
      const moving = state.items.find((entry) => entry.id === intent.itemId);
      const current = state.groups.find((entry) => entry.id === moving?.groupId);
      if (!moving || !current || current.itemIds.length < 2) return state;
      const created: GroupView = {
        id: `${PENDING_GROUP_ID_PREFIX}${op.reqId}`,
        categoryId: moving.categoryId,
        title: null,
        itemIds: [],
        createdAt: op.issuedAt,
      };
      return moveItems({ ...state, groups: [...state.groups, created] }, [moving.id], created);
    }
    case "addReaction":
    case "removeReaction":
      return {
        ...state,
        items: state.items.map((entry) =>
          entry.id === intent.itemId
            ? { ...entry, reactions: toggleReaction(entry.reactions, intent) }
            : entry,
        ),
      };
    case "setVoteLimit":
      return { ...state, voteLimit: intent.limit };
  }
}

export function applyPendingOps(state: RoomState, pending: readonly PendingOp[]): RoomState {
  return pending.reduce(applyOp, state);
}
