import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { AI } from "../../../src/shared/constants";
import type { SuggestionsView } from "../../../src/shared/protocol";
import { utcDay } from "../../../src/worker/ai/AiBudget";
import { connect, createRoom, type TestSocket } from "../ws";
import { ALICE, OWNER } from "./harness";

let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter}`;

async function groupRoom(): Promise<{ code: string; owner: TestSocket; alice: TestSocket }> {
  const code = await createRoom(OWNER);
  const { socket: owner } = await connect(code, OWNER, nextIp());
  const { socket: alice } = await connect(code, ALICE, nextIp());
  for (const text of ["deploys were slow", "deploys broke twice", "standup ran long"]) {
    await alice.ok({ type: "addItem", categoryId: "less-well", text });
  }
  await owner.ok({ type: "advance", from: "write" });
  await alice.sync();
  return { code, owner, alice };
}

async function nextSuggestions(
  socket: TestSocket,
  match: (view: SuggestionsView) => boolean,
): Promise<SuggestionsView> {
  for (;;) {
    const { suggestions } = await socket.next("suggestions");
    if (match(suggestions)) return suggestions;
  }
}

function roomSql(code: string, query: string, ...params: unknown[]): Promise<void> {
  return runInDurableObject(env.ROOMS.getByName(code), (_instance, state) => {
    state.storage.sql.exec(query, ...params);
  });
}

describe("suggestGroups", () => {
  test("acks, reports pending, then delivers a set only to the owner", async () => {
    const { owner, alice } = await groupRoom();
    await owner.ok({ type: "suggestGroups" });

    const pending = await nextSuggestions(owner, (view) => view.pending);
    expect(pending).toMatchObject({ runsLeft: AI.requestsPerRoom - 1, set: null });
    const done = await nextSuggestions(owner, (view) => view.set !== null);
    expect(done.pending).toBe(false);
    expect(done.set?.entries).toEqual([
      {
        index: 0,
        targetGroupId: null,
        itemIds: expect.any(Array),
        title: "Deploys",
        status: "pending",
      },
    ]);

    await alice.sync();
    expect(alice.received.some((message) => message.type === "suggestions")).toBe(false);
    expect(await alice.rejects({ type: "suggestGroups" })).toBe("forbidden");
  });

  test("a second request while one is in flight or cooling down is busy", async () => {
    const { owner } = await groupRoom();
    owner.send({ type: "suggestGroups", reqId: "first" });
    expect(await owner.rejects({ type: "suggestGroups" })).toBe("suggest_busy");
    while (!owner.latest("suggestions")?.suggestions.set) await owner.sync();
    expect(await owner.rejects({ type: "suggestGroups" })).toBe("suggest_busy");
  });

  test("the run after the room limit is refused", async () => {
    const { code, owner } = await groupRoom();
    await roomSql(code, "UPDATE room SET ai_runs = ?", AI.requestsPerRoom);
    expect(await owner.rejects({ type: "suggestGroups" })).toBe("suggest_room_limit");
  });

  test("an exhausted daily budget refuses without spending a room run", async () => {
    const { code, owner } = await groupRoom();
    const budget = env.AI_BUDGET.getByName("global");
    const day = utcDay(Date.now());
    const restore = await runInDurableObject(budget, (_instance, state) => {
      const row = state.storage.sql
        .exec<{ count: number }>("SELECT count FROM usage WHERE day = ?", day)
        .toArray()[0];
      state.storage.sql.exec(
        "INSERT INTO usage (day, count) VALUES (?, ?) ON CONFLICT (day) DO UPDATE SET count = excluded.count",
        day,
        AI.dailyRequestCap,
      );
      return row?.count ?? 0;
    });
    try {
      expect(await owner.rejects({ type: "suggestGroups" })).toBe("suggest_daily_limit");
      await owner.sync();
      expect(owner.received.some((message) => message.type === "suggestions")).toBe(false);
      await runInDurableObject(env.ROOMS.getByName(code), (_instance, state) => {
        const room = state.storage.sql
          .exec<{ ai_runs: number; ai_pending_since: number | null }>(
            "SELECT ai_runs, ai_pending_since FROM room",
          )
          .one();
        expect(room).toEqual({ ai_runs: 0, ai_pending_since: null });
      });
    } finally {
      await runInDurableObject(budget, (_instance, state) => {
        state.storage.sql.exec("UPDATE usage SET count = ? WHERE day = ?", restore, day);
      });
    }
  });
});

describe("AiBudget", () => {
  test("stops at the cap and starts fresh the next day", async () => {
    const budget = env.AI_BUDGET.getByName(crypto.randomUUID());
    expect(await budget.reserve("2026-01-01", 2)).toBe(true);
    expect(await budget.reserve("2026-01-01", 2)).toBe(true);
    expect(await budget.reserve("2026-01-01", 2)).toBe(false);
    expect(await budget.reserve("2026-01-02", 2)).toBe(true);
  });
});
