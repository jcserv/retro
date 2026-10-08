import { expect, test } from "vitest";
import { LIMITS } from "./constants";
import { parseClientMessage } from "./protocol";

const json = (value: unknown) => JSON.stringify(value);

test("accepts a valid intent and trims string fields", () => {
  expect(
    parseClientMessage(json({ type: "addItem", categoryId: "well", text: "  hi  ", reqId: "r1" })),
  ).toEqual({
    ok: true,
    message: { type: "addItem", categoryId: "well", text: "hi", reqId: "r1" },
  });
});

test("measures length after trimming", () => {
  const text = ` ${"a".repeat(LIMITS.itemTextMax)} `;
  expect(parseClientMessage(json({ type: "addItem", categoryId: "well", text })).ok).toBe(true);
});

test.each([
  ["item text", { type: "addItem", categoryId: "well", text: "a".repeat(LIMITS.itemTextMax + 1) }],
  [
    "group title",
    { type: "renameGroup", groupId: "g", title: "a".repeat(LIMITS.groupTitleMax + 1) },
  ],
  ["comment", { type: "addComment", groupId: "g", text: "a".repeat(LIMITS.commentTextMax + 1) }],
  ["action", { type: "addAction", groupId: "g", text: "a".repeat(LIMITS.actionTextMax + 1) }],
  [
    "assignee",
    { type: "addAction", groupId: "g", text: "x", assignee: "a".repeat(LIMITS.assigneeMax + 1) },
  ],
])("rejects over-length %s as too_long and echoes reqId", (_, message) => {
  expect(parseClientMessage(json({ ...message, reqId: "r9" }))).toEqual({
    ok: false,
    code: "too_long",
    reqId: "r9",
  });
});

test.each(["2026-02-30", "2026-1-5", "next week"])("rejects malformed due date %s", (dueDate) => {
  const message = { type: "addAction", groupId: "g", text: "x", dueDate };
  expect(parseClientMessage(json(message)).ok).toBe(false);
});

test("accepts an ISO due date or an empty one", () => {
  for (const dueDate of ["2026-10-15", ""]) {
    const message = { type: "addAction", groupId: "g", text: "x", dueDate };
    expect(parseClientMessage(json(message)).ok).toBe(true);
  }
});

test("rejects whitespace-only text as empty", () => {
  expect(parseClientMessage(json({ type: "addComment", groupId: "g", text: "   " }))).toEqual({
    ok: false,
    code: "empty",
  });
});

test("allows an empty group title, which clears it", () => {
  expect(parseClientMessage(json({ type: "renameGroup", groupId: "g", title: "  " }))).toEqual({
    ok: true,
    message: { type: "renameGroup", groupId: "g", title: "" },
  });
});

test.each([
  ["non-JSON", "not json"],
  ["non-object", json(42)],
  ["missing type", json({ text: "x" })],
  ["unknown type", json({ type: "dropTables" })],
  ["unknown field", json({ type: "pauseTimer", extra: 1 })],
  ["wrong field type", json({ type: "setReady", ready: "yes" })],
  ["non-UUID clientId", json({ type: "hello", clientId: "owner" })],
  ["unknown phase", json({ type: "advance", from: "lobby" })],
  ["vote limit out of range", json({ type: "setVoteLimit", limit: LIMITS.voteLimitMax + 1 })],
  ["timer below minimum", json({ type: "setTimer", durationMs: LIMITS.timerMinMs - 1 })],
  ["fractional index", json({ type: "next", fromIndex: 1.5 })],
  ["over-length reqId", json({ type: "pauseTimer", reqId: "r".repeat(37) })],
])("rejects %s as invalid_message", (_, raw) => {
  expect(parseClientMessage(raw)).toEqual({ ok: false, code: "invalid_message" });
});

test.each(["👍", "👍🏽", "👩‍👩‍👧‍👦", "🇨🇦", "❤️", "1️⃣"])("accepts %s as a reaction", (emoji) => {
  expect(parseClientMessage(json({ type: "addReaction", itemId: "i", emoji })).ok).toBe(true);
});

test("normalizes a redundant variation selector to the RGI form", () => {
  expect(parseClientMessage(json({ type: "addReaction", itemId: "i", emoji: "👍\uFE0F" }))).toEqual(
    {
      ok: true,
      message: { type: "addReaction", itemId: "i", emoji: "👍" },
    },
  );
});

test.each(["", "a", "1", "👍👍", "👍 ", ":+1:"])("rejects %j as a reaction", (emoji) => {
  expect(parseClientMessage(json({ type: "addReaction", itemId: "i", emoji }))).toEqual({
    ok: false,
    code: "invalid_message",
  });
});

test("echoes a well-formed reqId from an invalid message", () => {
  expect(parseClientMessage(json({ type: "dropTables", reqId: "r2" }))).toEqual({
    ok: false,
    code: "invalid_message",
    reqId: "r2",
  });
});
