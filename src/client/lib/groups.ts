import type { Category, DiscussStatus, GroupView, ItemView } from "../../shared/protocol";
import type { RoomState } from "../state/roomState";

const CATEGORY_TONES = 5;

export type ItemsById = ReadonlyMap<string, ItemView>;

export function itemsById(items: readonly ItemView[]): ItemsById {
  return new Map(items.map((entry) => [entry.id, entry]));
}

export function groupTitle(group: GroupView, items: ItemsById): string {
  if (group.title) return group.title;
  const first = group.itemIds[0];
  return (first && items.get(first)?.text) || "Untitled group";
}

export function listsItems(group: GroupView, items: ItemsById): boolean {
  if (group.itemIds.length > 1) return true;
  if (!group.title) return false;
  const only = group.itemIds[0];
  return only === undefined || items.get(only)?.text !== group.title;
}

export function groupItems(group: GroupView, items: ItemsById): ItemView[] {
  return group.itemIds.flatMap((id) => items.get(id) ?? []);
}

export function categoryTone(categories: readonly Category[], categoryId: string): number {
  return (
    Math.max(
      0,
      categories.findIndex((entry) => entry.id === categoryId),
    ) % CATEGORY_TONES
  );
}

export function votesUsed(myVotes: Readonly<Record<string, number>>): number {
  return Object.values(myVotes).reduce((sum, count) => sum + count, 0);
}

export type DiscussEntry = {
  group: GroupView;
  index: number;
  status: DiscussStatus;
  votes: number;
  title: string;
};

export function discussEntries(state: RoomState): DiscussEntry[] {
  if (!state.discuss) return [];
  const groups = new Map(state.groups.map((entry) => [entry.id, entry]));
  const items = itemsById(state.items);
  const { order, status } = state.discuss;
  return order.flatMap((groupId, index) => {
    const group = groups.get(groupId);
    if (!group) return [];
    return {
      group,
      index,
      status: status[groupId] ?? "pending",
      votes: state.voteTotals?.[groupId] ?? 0,
      title: groupTitle(group, items),
    };
  });
}
