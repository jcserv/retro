import { describe, expect, test } from "vitest";
import type { ActionView, CommentView } from "../../shared/protocol";
import { group, item, makeRoomState } from "../test/fixtures";
import { escapeMarkdown, exportFileName, toMarkdown } from "./markdown";

const createdAt = new Date(2026, 9, 4, 9, 30).getTime();

function comment(id: string, groupId: string, text: string, at: number): CommentView {
  return { id, groupId, text, mine: false, createdAt: at, updatedAt: at };
}

function action(
  id: string,
  groupId: string,
  text: string,
  assignee: string | null,
  at: number,
): ActionView {
  return { id, groupId, text, assignee, dueDate: null, mine: false, createdAt: at, updatedAt: at };
}

const room = makeRoomState({
  code: "ABC234",
  createdAt,
  phase: "done",
  presence: { participantCount: 7, connectedCount: 3, readyCount: 0 },
  items: [
    { ...item("i1", "g1", 1, "less-well"), text: "Deploys were slow" },
    { ...item("i2", "g1", 2, "less-well"), text: "CI flaked" },
    { ...item("i3", "g2", 3, "well"), text: "Pairing sessions" },
    { ...item("i4", "g3", 4, "shoutouts"), text: "Thanks Sam" },
    { ...item("i5", "g4", 5, "puzzles"), text: "Why is staging down?" },
    { ...item("i6", "g5", 6, "try-next"), text: "Mob on Fridays" },
  ],
  groups: [
    { ...group("g1", ["i1", "i2"], "less-well"), title: "Slow pipeline" },
    group("g2", ["i3"], "well"),
    { ...group("g3", ["i4"], "shoutouts"), title: "Kudos" },
    group("g4", ["i5"], "puzzles"),
    group("g5", ["i6"], "try-next"),
  ],
  voteTotals: { g1: 8, g2: 1, g3: 3, g4: 2, g5: 0 },
  discuss: {
    order: ["g1", "g3", "g2", "g4", "g5"],
    currentIndex: 3,
    status: { g1: "discussed", g3: "discussed", g2: "skipped", g4: "discussed", g5: "pending" },
  },
  comments: [
    comment("c2", "g1", "Mostly the integration suite", 20),
    comment("c1", "g1", "Happened every Tuesday", 10),
  ],
  actions: [
    action("a1", "g1", "Split the test job", "Alex", 30),
    action("a2", "g1", "Cache dependencies", null, 40),
  ],
});

describe("toMarkdown", () => {
  test("renders a full room", () => {
    expect(toMarkdown(room)).toBe(`# Retro: 2026-10-04
Room ABC234 · 7 participants

## Discussed

### 1. Slow pipeline (8 votes) [What went less well?]
- Items:
  - Deploys were slow
  - CI flaked
- Comments:
  - Happened every Tuesday
  - Mostly the integration suite
- Action items:
  - [ ] Split the test job (Alex)
  - [ ] Cache dependencies

### 2. Kudos (3 votes) [Shoutouts]
- Items:
  - Thanks Sam
- Comments:
  - (none)
- Action items:
  - (none)

### 3. Why is staging down? (2 votes) [What puzzles us?]
- Comments:
  - (none)
- Action items:
  - (none)

## Not discussed
- Pairing sessions (1 vote) [What went well?]
- Mob on Fridays (0 votes) [What do we want to try next?]
`);
  });

  test("renders empty sections and a singular participant", () => {
    const empty = makeRoomState({
      createdAt,
      presence: { participantCount: 1, connectedCount: 1, readyCount: 0 },
      discuss: { order: [], currentIndex: 0, status: {} },
      voteTotals: {},
    });
    expect(toMarkdown(empty)).toBe(`# Retro: 2026-10-04
Room ABC234 · 1 participant

## Discussed
- (none)

## Not discussed
- (none)
`);
  });

  test("falls back to the shared untitled wording for an empty group", () => {
    const untitled = makeRoomState({
      createdAt,
      groups: [group("g1", [])],
      voteTotals: { g1: 0 },
      discuss: { order: ["g1"], currentIndex: 0, status: { g1: "discussed" } },
    });
    const lines = toMarkdown(untitled).split("\n");
    expect(lines).toContain("### 1. Untitled group (0 votes) [What went well?]");
    expect(lines).not.toContain("- Items:");
  });

  test("hostile user text cannot restructure the document", () => {
    const hostile = makeRoomState({
      createdAt,
      items: [
        { ...item("i1", "g1", 1), text: "# Heading" },
        { ...item("i2", "g1", 2), text: "line one\n## injected\n- list" },
        { ...item("i3", "g2", 3), text: "> quote with `code`" },
      ],
      groups: [group("g1", ["i1", "i2"]), { ...group("g2", ["i3"]), title: "1. numbered" }],
      voteTotals: { g1: 0, g2: 0 },
      discuss: { order: ["g1", "g2"], currentIndex: 0, status: { g1: "discussed" } },
      comments: [comment("c1", "g1", "* star", 1)],
      actions: [action("a1", "g1", "+ plus", "- dash", 1)],
    });
    const lines = toMarkdown(hostile).split("\n");
    expect(lines).toContain("### 1. \\# Heading (0 votes) [What went well?]");
    expect(lines).toContain("  - line one ## injected - list");
    expect(lines).toContain("  - \\* star");
    expect(lines).toContain("  - [ ] \\+ plus (\\- dash)");
    expect(lines).toContain("- 1\\. numbered (0 votes) [What went well?]");
    expect(lines.filter((line) => line.startsWith("#"))).toEqual([
      "# Retro: 2026-10-04",
      "## Discussed",
      "### 1. \\# Heading (0 votes) [What went well?]",
      "## Not discussed",
    ]);
  });
});

test("escapeMarkdown escapes backticks and backslashes anywhere", () => {
  expect(escapeMarkdown("a `b` \\c")).toBe("a \\`b\\` \\\\c");
  expect(escapeMarkdown(">")).toBe("\\>");
});

test("exportFileName uses the room code and local creation date", () => {
  expect(exportFileName(room)).toBe("retro-ABC234-2026-10-04.md");
});
