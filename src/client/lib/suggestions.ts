import type { SuggestionEntryView } from "../../shared/protocol";
import type { RoomState } from "../state/roomState";

export type ResolvedSuggestion = {
  entry: SuggestionEntryView;
  items: Array<{ id: string; text: string; available: boolean }>;
  target: { kind: "new" } | { kind: "existing"; groupId: string } | { kind: "missing" };
  stale: boolean;
};

export function resolveSuggestion(
  room: Pick<RoomState, "groups" | "items">,
  entry: SuggestionEntryView,
): ResolvedSuggestion {
  const groups = new Map(room.groups.map((group) => [group.id, group]));
  const items = entry.itemIds.flatMap((id) => {
    const item = room.items.find((candidate) => candidate.id === id);
    if (!item) return [];
    const group = item.groupId === null ? undefined : groups.get(item.groupId);
    const available = group !== undefined && group.title === null && group.itemIds.length === 1;
    return [{ id, text: item.text, available }];
  });
  const availableCount = items.filter((item) => item.available).length;

  if (entry.targetGroupId === null) {
    return { entry, items, target: { kind: "new" }, stale: availableCount < 2 };
  }
  const target = groups.get(entry.targetGroupId);
  if (!target) return { entry, items, target: { kind: "missing" }, stale: true };
  const titleApplies = entry.title !== null && target.title === null;
  return {
    entry,
    items,
    target: { kind: "existing", groupId: target.id },
    stale: availableCount === 0 && !titleApplies,
  };
}
