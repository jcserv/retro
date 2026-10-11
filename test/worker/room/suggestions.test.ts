import { describe, expect, test } from "vitest";
import { AI } from "../../../src/shared/constants";
import {
  applySuggestionEntries,
  buildSuggestInput,
  type IdMap,
  parseSuggestions,
  sanitizeTitle,
} from "../../../src/worker/room/suggestions";
import { ALICE, alice, expectGroupingInvariant, owner, type Room, withRoom } from "./harness";

const ID_MAP: IdMap = {
  items: new Map([
    [1, "item-1"],
    [2, "item-2"],
    [3, "item-3"],
  ]),
  groups: new Map([
    ["g1", { id: "group-untitled", titled: false }],
    ["g2", { id: "group-titled", titled: true }],
  ]),
};

describe("parseSuggestions", () => {
  test("rejects output that is not the response shape", () => {
    expect(parseSuggestions("not json", ID_MAP)).toBeNull();
    expect(parseSuggestions({ suggestions: [] }, ID_MAP)).toBeNull();
    expect(parseSuggestions(null, ID_MAP)).toBeNull();
  });

  test("accepts a JSON string and maps short ids to real ids", () => {
    const raw = JSON.stringify({
      groups: [{ target: null, itemIds: [1, 2], title: "Deploys" }],
    });
    expect(parseSuggestions(raw, ID_MAP)).toEqual([
      { targetGroupId: null, itemIds: ["item-1", "item-2"], title: "Deploys" },
    ]);
  });

  test("keeps the complete entries of a reply cut off by the token limit", () => {
    const raw =
      '{"groups": [{"itemIds": [1, 2], "target": null, "title": "Deploys"}, {"itemIds": [3], "target": "g1';
    expect(parseSuggestions(raw, ID_MAP)).toEqual([
      { targetGroupId: null, itemIds: ["item-1", "item-2"], title: "Deploys" },
    ]);
  });

  test("drops malformed entries and unknown ids without failing the whole response", () => {
    const parsed = parseSuggestions(
      {
        groups: [
          { target: "g9", itemIds: [1], title: "Unknown target" },
          { target: null, itemIds: [1, 7], title: "One known item" },
          { itemIds: [1, 2] },
          { target: null, itemIds: [1, 2, 2], title: "Valid" },
        ],
      },
      ID_MAP,
    );
    expect(parsed).toEqual([
      { targetGroupId: null, itemIds: ["item-1", "item-2"], title: "Valid" },
    ]);
  });

  test("uses each item at most once across entries", () => {
    const parsed = parseSuggestions(
      {
        groups: [
          { target: null, itemIds: [1, 2], title: "First" },
          { target: null, itemIds: [2, 3], title: "Second" },
          { target: "g1", itemIds: [1, 3], title: null },
        ],
      },
      ID_MAP,
    );
    expect(parsed).toEqual([
      { targetGroupId: null, itemIds: ["item-1", "item-2"], title: "First" },
      { targetGroupId: "group-untitled", itemIds: ["item-3"], title: null },
    ]);
  });

  test("never retitles a titled group and drops title-only entries for it", () => {
    const parsed = parseSuggestions(
      {
        groups: [
          { target: "g2", itemIds: [], title: "Renamed" },
          { target: "g2", itemIds: [1], title: "Renamed" },
          { target: "g1", itemIds: [], title: "Named" },
        ],
      },
      ID_MAP,
    );
    expect(parsed).toEqual([
      { targetGroupId: "group-titled", itemIds: ["item-1"], title: null },
      { targetGroupId: "group-untitled", itemIds: [], title: "Named" },
    ]);
  });

  test("sanitizes titles to one short line", () => {
    expect(sanitizeTitle("  Slow\n\n  deploys\t ")).toBe("Slow deploys");
    expect(sanitizeTitle(" \n ")).toBeNull();
    expect(sanitizeTitle("x".repeat(500))).toHaveLength(AI.titleMax);
  });
});

function groupBoard<const T extends ReadonlyArray<readonly [string, string]>>(
  room: Room,
  texts: T,
): { [K in keyof T]: string } {
  const ids = texts.map(([categoryId, text]) => room.addItem(alice, categoryId, text));
  room.advanceTo("group");
  return ids as { [K in keyof T]: string };
}

describe("buildSuggestInput", () => {
  test("splits singletons from groups and sends no client or item ids", async () => {
    await withRoom((room) => {
      const [a, b, c] = groupBoard(room, [
        ["well", "fast deploys"],
        ["well", "deploys were smooth"],
        ["puzzles", "flaky tests"],
        ["try-next", "pair more"],
      ]);
      room.ok(owner, {
        type: "mergeGroups",
        sourceGroupId: room.groupOf(b),
        targetGroupId: room.groupOf(a),
      });
      room.ok(owner, { type: "renameGroup", groupId: room.groupOf(a), title: "Deploys" });

      const built = buildSuggestInput(room.store);
      if (!built.ok) throw new Error(built.code);
      expect(built.input.ungroupedItems).toHaveLength(2);
      expect(built.input.ungroupedItems).toEqual(
        expect.arrayContaining([
          { id: expect.any(Number), category: "c3", text: "pair more" },
          { id: expect.any(Number), category: "c4", text: "flaky tests" },
        ]),
      );
      expect(built.input.groups).toEqual([
        {
          id: "g1",
          category: "c1",
          title: "Deploys",
          items: ["fast deploys", "deploys were smooth"],
        },
      ]);
      const flaky = built.input.ungroupedItems.find((item) => item.text === "flaky tests");
      expect(built.idMap.items.get(flaky?.id ?? 0)).toBe(c);

      const payload = JSON.stringify(built.input);
      for (const secret of [ALICE, a, b, c, room.groupOf(a)]) expect(payload).not.toContain(secret);
    });
  });

  test("is ineligible with fewer than two ungrouped items and no untitled group", async () => {
    await withRoom((room) => {
      const [a, b] = groupBoard(room, [
        ["well", "one"],
        ["well", "two"],
        ["well", "three"],
      ]);
      room.ok(owner, {
        type: "mergeGroups",
        sourceGroupId: room.groupOf(b),
        targetGroupId: room.groupOf(a),
      });
      expect(buildSuggestInput(room.store).ok).toBe(true);
      room.ok(owner, { type: "renameGroup", groupId: room.groupOf(a), title: "Numbers" });
      expect(buildSuggestInput(room.store)).toEqual({ ok: false, code: "suggest_ineligible" });
    });
  });

  test("clips long card text and counts the clipped text against the character cap", async () => {
    await withRoom((room) => {
      const text = "x".repeat(250);
      const count = Math.floor(AI.maxInputChars / AI.maxItemChars);
      for (let i = 0; i < count; i++) {
        room.addItem({ clientId: crypto.randomUUID(), isOwner: false }, "well", text);
      }
      room.advanceTo("group");
      const built = buildSuggestInput(room.store);
      if (!built.ok) throw new Error(built.code);
      expect(built.input.ungroupedItems[0]?.text).toHaveLength(AI.maxItemChars);
    });
  });

  test("rejects boards over the character cap", async () => {
    await withRoom((room) => {
      const text = "x".repeat(AI.maxItemChars);
      const count = Math.ceil(AI.maxInputChars / text.length) + 1;
      for (let i = 0; i < count; i++) {
        room.addItem({ clientId: crypto.randomUUID(), isOwner: false }, "well", text);
      }
      room.advanceTo("group");
      expect(buildSuggestInput(room.store)).toEqual({ ok: false, code: "suggest_too_large" });
    });
  });
});

describe("applySuggestionEntries", () => {
  test("skips items grouped since the suggestion and applies the rest", async () => {
    await withRoom((room) => {
      const [a, b, c, d] = groupBoard(room, [
        ["well", "a"],
        ["well", "b"],
        ["well", "c"],
        ["well", "d"],
      ]);
      room.ok(owner, {
        type: "mergeGroups",
        sourceGroupId: room.groupOf(b),
        targetGroupId: room.groupOf(a),
      });

      const { stale } = applySuggestionEntries(room.store, [
        { index: 0, targetGroupId: null, itemIds: [a, b, c], title: "Too late", status: "pending" },
        {
          index: 1,
          targetGroupId: null,
          itemIds: [b, c, d],
          title: "Still fine",
          status: "pending",
        },
      ]);

      expect(stale).toEqual([0]);
      expect(room.groupOf(c)).toBe(room.groupOf(d));
      expect(room.groupOf(b)).not.toBe(room.groupOf(c));
      expect(room.store.getGroup(room.groupOf(c))?.title).toBe("Still fine");
      expectGroupingInvariant(room.store);
    });
  });

  test("new group takes the most common category, ties go to the earlier column", async () => {
    await withRoom((room) => {
      const [a, b, c, d, e] = groupBoard(room, [
        ["puzzles", "a"],
        ["less-well", "b"],
        ["puzzles", "c"],
        ["puzzles", "d"],
        ["less-well", "e"],
      ]);
      applySuggestionEntries(room.store, [
        { index: 0, targetGroupId: null, itemIds: [b, a, c], title: null, status: "pending" },
        { index: 1, targetGroupId: null, itemIds: [d, e], title: null, status: "pending" },
      ]);
      expect(room.store.getGroup(room.groupOf(a))?.categoryId).toBe("puzzles");
      expect(room.store.getGroup(room.groupOf(d))?.categoryId).toBe("less-well");
    });
  });

  test("adding to a titled group keeps its title", async () => {
    await withRoom((room) => {
      const [a, b] = groupBoard(room, [
        ["well", "a"],
        ["well", "b"],
      ]);
      const target = room.groupOf(a);
      room.ok(owner, { type: "renameGroup", groupId: target, title: "Mine" });
      applySuggestionEntries(room.store, [
        { index: 0, targetGroupId: target, itemIds: [b], title: "Theirs", status: "pending" },
      ]);
      expect(room.groupOf(b)).toBe(target);
      expect(room.store.getGroup(target)?.title).toBe("Mine");
    });
  });
});
