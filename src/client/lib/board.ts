import type { Category, GroupView, ItemView } from "../../shared/protocol";
import { type GroupingIntent, PENDING_GROUP_ID_PREFIX } from "../state/optimistic";
import type { RoomState } from "../state/roomState";

export type BoardGroup = {
  group: GroupView;
  items: ItemView[];
  label: string;
  categoryIndex: number;
  pending: boolean;
};

export type BoardColumn = {
  category: Category;
  index: number;
  groups: BoardGroup[];
  itemCount: number;
};

export type DragSource = { kind: "group"; groupId: string } | { kind: "item"; itemId: string };

export type DropTarget =
  | { kind: "group"; groupId: string }
  | { kind: "column"; categoryId: string };

export function isPendingGroupId(groupId: string): boolean {
  return groupId.startsWith(PENDING_GROUP_ID_PREFIX);
}

export function groupLabel(group: GroupView, items: readonly ItemView[]): string {
  return group.title ?? items[0]?.text ?? "";
}

export function buildBoard(
  room: Pick<RoomState, "categories" | "groups" | "items">,
): BoardColumn[] {
  const itemsById = new Map(room.items.map((entry) => [entry.id, entry]));
  const categoryIndex = new Map(room.categories.map((category, index) => [category.id, index]));
  const byCategory = new Map<string, BoardGroup[]>();

  for (const group of room.groups) {
    const index = categoryIndex.get(group.categoryId);
    if (index === undefined) continue;
    const items = group.itemIds.flatMap((id) => itemsById.get(id) ?? []);
    if (items.length === 0) continue;
    const entry: BoardGroup = {
      group,
      items,
      label: groupLabel(group, items),
      categoryIndex: index,
      pending: isPendingGroupId(group.id),
    };
    byCategory.set(group.categoryId, [...(byCategory.get(group.categoryId) ?? []), entry]);
  }

  return room.categories.map((category, index) => {
    const groups = (byCategory.get(category.id) ?? []).sort(compareGroups);
    return {
      category,
      index,
      groups,
      itemCount: groups.reduce((sum, entry) => sum + entry.items.length, 0),
    };
  });
}

function compareGroups(a: BoardGroup, b: BoardGroup): number {
  return (
    a.group.createdAt - b.group.createdAt ||
    (a.items[0]?.createdAt ?? 0) - (b.items[0]?.createdAt ?? 0) ||
    a.group.id.localeCompare(b.group.id)
  );
}

export function dropIntent(
  room: Pick<RoomState, "groups" | "items">,
  source: DragSource,
  target: DropTarget,
): GroupingIntent | null {
  if (target.kind === "group") {
    if (isPendingGroupId(target.groupId)) return null;
    if (!room.groups.some((entry) => entry.id === target.groupId)) return null;
  }

  if (source.kind === "group") {
    if (target.kind !== "group" || isPendingGroupId(source.groupId)) return null;
    if (source.groupId === target.groupId) return null;
    if (!room.groups.some((entry) => entry.id === source.groupId)) return null;
    return { type: "mergeGroups", sourceGroupId: source.groupId, targetGroupId: target.groupId };
  }

  const moving = room.items.find((entry) => entry.id === source.itemId);
  if (!moving) return null;
  if (target.kind === "group") {
    if (moving.groupId === target.groupId) return null;
    return { type: "moveItemToGroup", itemId: moving.id, groupId: target.groupId };
  }
  const current = room.groups.find((entry) => entry.id === moving.groupId);
  if (target.categoryId !== moving.categoryId || !current || current.itemIds.length < 2) {
    return null;
  }
  return { type: "ungroupItem", itemId: moving.id };
}

export function encodeDropTarget(target: DropTarget): string {
  return target.kind === "group" ? `group:${target.groupId}` : `column:${target.categoryId}`;
}

export function decodeDropTarget(key: string): DropTarget | null {
  const separator = key.indexOf(":");
  const kind = key.slice(0, separator);
  const id = key.slice(separator + 1);
  if (separator === -1 || id === "") return null;
  if (kind === "group") return { kind, groupId: id };
  if (kind === "column") return { kind, categoryId: id };
  return null;
}
