import { parse as parsePartialJson } from "partial-json";
import { z } from "zod";
import { AI } from "../../shared/constants";
import type { ErrorCode, SuggestionsView } from "../../shared/protocol";
import { type Actor, type Change, removeGroupIfEmpty } from "./commands";
import type { AiUsage, Item, Room, RoomStore, SuggestionEntry } from "./store";

export type SuggestInput = {
  categories: Array<{ id: string; title: string }>;
  ungroupedItems: Array<{ id: number; category: string; text: string }>;
  groups: Array<{ id: string; category: string; title: string | null; items: string[] }>;
};

export type IdMap = {
  items: ReadonlyMap<number, string>;
  groups: ReadonlyMap<string, { id: string; titled: boolean }>;
};

export type ParsedSuggestion = Omit<SuggestionEntry, "status" | "index">;

export type BuildResult =
  | { ok: true; input: SuggestInput; idMap: IdMap }
  | { ok: false; code: "suggest_ineligible" | "suggest_too_large" };

const EntrySchema = z.object({
  target: z.string().nullable(),
  itemIds: z.array(z.union([z.number(), z.string()])),
  title: z.string().nullable(),
});

export const SuggestionResponseSchema = z.object({ groups: z.array(z.unknown()) });

export const SUGGESTION_JSON_SCHEMA = {
  type: "object",
  properties: {
    groups: {
      type: "array",
      items: {
        type: "object",
        properties: {
          target: { type: ["string", "null"] },
          itemIds: { type: "array", items: { type: "integer" } },
          title: { type: ["string", "null"] },
        },
        required: ["target", "itemIds", "title"],
      },
    },
  },
  required: ["groups"],
} as const;

export type PrepareResult =
  | { ok: true; input: SuggestInput; idMap: IdMap }
  | { ok: false; code: ErrorCode };

export type ModelOutput = { ok: true; value: unknown } | { ok: false };

export type CompleteResult = { ok: true } | { ok: false; code: "suggest_failed" };

export function pendingUntil(ai: AiUsage, now: number): number | null {
  if (ai.pendingSince === null) return null;
  const until = ai.pendingSince + AI.timeoutMs;
  return until > now ? until : null;
}

export function cooldownEndsAt(ai: AiUsage, now: number): number | null {
  if (ai.lastRunAt === null) return null;
  const endsAt = ai.lastRunAt + AI.cooldownMs;
  return endsAt > now ? endsAt : null;
}

export function suggestionsView(
  store: RoomStore,
  room: Room,
  now: number,
  enabled: boolean,
): SuggestionsView {
  return {
    enabled,
    pendingUntil: pendingUntil(room.ai, now),
    runsLeft: Math.max(0, AI.requestsPerRoom - room.ai.runs),
    cooldownEndsAt: cooldownEndsAt(room.ai, now),
    set:
      room.suggestionSetId === null
        ? null
        : { id: room.suggestionSetId, entries: store.listSuggestions() },
  };
}

export function prepareSuggestion(
  store: RoomStore,
  actor: Actor,
  now: number,
  enabled: boolean,
): PrepareResult {
  return store.transaction((): PrepareResult => {
    const room = store.getRoom();
    if (!room) return { ok: false, code: "not_found" };
    if (!actor.isOwner) return { ok: false, code: "forbidden" };
    if (room.phase !== "group") return { ok: false, code: "wrong_phase" };
    if (!enabled) return { ok: false, code: "suggest_unavailable" };
    if (pendingUntil(room.ai, now) !== null || cooldownEndsAt(room.ai, now) !== null) {
      return { ok: false, code: "suggest_busy" };
    }
    if (room.ai.runs >= AI.requestsPerRoom) return { ok: false, code: "suggest_room_limit" };
    const built = buildSuggestInput(store);
    if (!built.ok) return built;
    store.setAiPending(now);
    return built;
  });
}

export function completeSuggestion(
  store: RoomStore,
  idMap: IdMap,
  output: ModelOutput,
  setId: string,
  startedAt: number,
): CompleteResult {
  return store.transaction((): CompleteResult => {
    if (!store.clearAiPending(startedAt)) return { ok: true };
    if (store.getRoom()?.phase !== "group") return { ok: true };
    const parsed = output.ok ? parseSuggestions(output.value, idMap) : null;
    if (parsed === null) return { ok: false, code: "suggest_failed" };
    store.replaceSuggestions(
      setId,
      parsed.map((entry, index) => ({ ...entry, index })),
    );
    return { ok: true };
  });
}

export function buildSuggestInput(store: RoomStore): BuildResult {
  const items = store.listItems();
  if (items.length > AI.maxItems) return { ok: false, code: "suggest_too_large" };
  const chars = items.reduce((sum, item) => sum + clipText(item.text).length, 0);
  if (chars > AI.maxInputChars) return { ok: false, code: "suggest_too_large" };

  const categoryIds = new Map<string, string>();
  const categories = store.listCategories().map((category, index) => {
    const shortId = `c${index + 1}`;
    categoryIds.set(category.id, shortId);
    return { id: shortId, title: category.title };
  });
  const categoryOf = (categoryId: string) => categoryIds.get(categoryId) ?? "c0";

  const membersByGroup = groupMembers(items);
  const itemIds = new Map<number, string>();
  const groupIds = new Map<string, { id: string; titled: boolean }>();
  const input: SuggestInput = { categories, ungroupedItems: [], groups: [] };
  let untitledGroups = 0;

  for (const group of store.listGroups()) {
    const members = membersByGroup.get(group.id) ?? [];
    if (members.length === 0) continue;
    if (isUngrouped(group.title, members.length)) {
      const item = members[0] as Item;
      const shortId = itemIds.size + 1;
      itemIds.set(shortId, item.id);
      input.ungroupedItems.push({
        id: shortId,
        category: categoryOf(item.categoryId),
        text: clipText(item.text),
      });
      continue;
    }
    const shortId = `g${groupIds.size + 1}`;
    groupIds.set(shortId, { id: group.id, titled: group.title !== null });
    if (group.title === null) untitledGroups += 1;
    input.groups.push({
      id: shortId,
      category: categoryOf(group.categoryId),
      title: group.title,
      items: members.map((item) => clipText(item.text)),
    });
  }

  if (input.ungroupedItems.length < 2 && untitledGroups === 0) {
    return { ok: false, code: "suggest_ineligible" };
  }
  return { ok: true, input, idMap: { items: itemIds, groups: groupIds } };
}

export function parseSuggestions(raw: unknown, idMap: IdMap): ParsedSuggestion[] | null {
  const response = SuggestionResponseSchema.safeParse(
    typeof raw === "string" ? parseJson(raw) : raw,
  );
  if (!response.success) return null;

  const used = new Set<string>();
  const suggestions: ParsedSuggestion[] = [];
  for (const candidate of response.data.groups) {
    const entry = EntrySchema.safeParse(candidate);
    if (!entry.success) continue;
    const target = entry.data.target === null ? null : idMap.groups.get(entry.data.target);
    if (target === undefined) continue;

    const itemIds = [
      ...new Set(
        entry.data.itemIds
          .map((shortId) => idMap.items.get(Number(shortId)))
          .filter((id): id is string => id !== undefined && !used.has(id)),
      ),
    ];
    const title = target?.titled ? null : sanitizeTitle(entry.data.title);
    if (target === null && itemIds.length < 2) continue;
    if (target !== null && itemIds.length === 0 && title === null) continue;

    for (const id of itemIds) used.add(id);
    suggestions.push({ targetGroupId: target?.id ?? null, itemIds, title });
  }
  return suggestions;
}

export function clipText(text: string): string {
  return text.length > AI.maxItemChars ? text.slice(0, AI.maxItemChars).trimEnd() : text;
}

export function sanitizeTitle(title: string | null): string | null {
  if (title === null) return null;
  const clean = title.replace(/\s+/g, " ").trim().slice(0, AI.titleMax).trim();
  return clean === "" ? null : clean;
}

export type ApplyResult = { changes: Change[]; stale: number[] };

export function applySuggestionEntries(
  store: RoomStore,
  entries: readonly SuggestionEntry[],
): ApplyResult {
  const changes: Change[] = [];
  const stale: number[] = [];
  for (const entry of entries) {
    const applied =
      entry.targetGroupId === null
        ? applyNewGroup(store, entry.itemIds, entry.title)
        : applyToGroup(store, entry.targetGroupId, entry.itemIds, entry.title);
    if (applied === null) {
      stale.push(entry.index);
      continue;
    }
    store.markSuggestionApplied(entry.index);
    changes.push(...applied);
  }
  changes.push({ kind: "suggestionsChanged" });
  return { changes, stale };
}

function applyNewGroup(store: RoomStore, itemIds: readonly string[], title: string | null) {
  const items = qualifyingItems(store, itemIds);
  const host = items[0];
  if (!host?.groupId || items.length < 2) return null;
  const hostGroupId = host.groupId;
  const changes = moveInto(store, items.slice(1), hostGroupId);
  store.setGroupCategory(hostGroupId, pluralityCategory(store, items));
  if (title !== null) store.setGroupTitle(hostGroupId, title);
  return [...changes, { kind: "groupUpserted", groupId: hostGroupId } satisfies Change];
}

function applyToGroup(
  store: RoomStore,
  groupId: string,
  itemIds: readonly string[],
  title: string | null,
) {
  const group = store.getGroup(groupId);
  if (!group) return null;
  const items = qualifyingItems(store, itemIds).filter((item) => item.groupId !== groupId);
  const applyTitle = title !== null && group.title === null;
  if (items.length === 0 && !applyTitle) return null;
  const changes = moveInto(store, items, groupId);
  if (applyTitle) store.setGroupTitle(groupId, title);
  return [...changes, { kind: "groupUpserted", groupId } satisfies Change];
}

function moveInto(store: RoomStore, items: readonly Item[], groupId: string): Change[] {
  const changes: Change[] = [];
  for (const item of items) {
    const sourceId = item.groupId as string;
    store.moveItem(item.id, groupId);
    changes.push(
      { kind: "itemUpserted", itemId: item.id, authorId: item.clientId },
      removeGroupIfEmpty(store, sourceId),
    );
  }
  return changes;
}

function qualifyingItems(store: RoomStore, itemIds: readonly string[]): Item[] {
  return itemIds
    .map((id) => store.getItem(id))
    .filter((item): item is Item => {
      if (!item?.groupId) return false;
      const group = store.getGroup(item.groupId);
      return group !== null && isUngrouped(group.title, store.countItemsInGroup(group.id));
    });
}

function pluralityCategory(store: RoomStore, items: readonly Item[]): string {
  const counts = new Map<string, number>();
  for (const item of items) counts.set(item.categoryId, (counts.get(item.categoryId) ?? 0) + 1);
  let best = (items[0] as Item).categoryId;
  let bestCount = 0;
  for (const category of store.listCategories()) {
    const count = counts.get(category.id) ?? 0;
    if (count > bestCount) {
      best = category.id;
      bestCount = count;
    }
  }
  return best;
}

function isUngrouped(title: string | null, size: number): boolean {
  return title === null && size === 1;
}

function groupMembers(items: readonly Item[]): Map<string, Item[]> {
  const byGroup = new Map<string, Item[]>();
  for (const item of items) {
    if (item.groupId === null) continue;
    byGroup.set(item.groupId, [...(byGroup.get(item.groupId) ?? []), item]);
  }
  return byGroup;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return parseTruncated(raw);
  }
}

function parseTruncated(raw: string): unknown {
  try {
    const partial = parsePartialJson(raw) as { groups?: unknown };
    if (!Array.isArray(partial?.groups)) return null;
    return { groups: partial.groups.slice(0, -1) };
  } catch {
    return null;
  }
}
