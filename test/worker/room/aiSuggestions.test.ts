import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { AI } from "../../../src/shared/constants";
import type { SuggestionsView } from "../../../src/shared/protocol";
import { utcDay } from "../../../src/worker/ai/AiBudget";
import { runWithTimeout, type Suggester, suggesterFor } from "../../../src/worker/ai/suggester";
import { connect, createRoom, type TestSocket } from "../ws";
import { ALICE, OWNER } from "./harness";

vi.mock("../../../src/worker/ai/suggester", { spy: true });

let ipCounter = 0;
const nextIp = () => `198.51.100.${++ipCounter}`;

beforeAll(async () => {
  await createRoom(OWNER);
}, 30_000);

beforeEach(() => {
  vi.mocked(suggesterFor).mockRestore();
});

function useSuggester(suggester: Suggester): void {
  vi.mocked(suggesterFor).mockReturnValue(suggester);
}

async function groupRoom(
  ownerIp = nextIp(),
): Promise<{ code: string; owner: TestSocket; alice: TestSocket }> {
  const code = await createRoom(OWNER);
  const { socket: owner } = await connect(code, OWNER, ownerIp);
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

type AiRow = { ai_runs: number; ai_pending_since: number | null; suggestion_set_id: string | null };

function aiRow(code: string): Promise<AiRow> {
  return runInDurableObject(env.ROOMS.getByName(code), (_instance, state) =>
    state.storage.sql
      .exec<AiRow>("SELECT ai_runs, ai_pending_since, suggestion_set_id FROM room")
      .one(),
  );
}

describe("suggestGroups", () => {
  test("acks, reports pending, then delivers a set only to the owner", async () => {
    const { owner, alice } = await groupRoom();
    await owner.ok({ type: "suggestGroups" });

    const pending = await nextSuggestions(owner, (view) => view.pendingUntil !== null);
    expect(pending).toMatchObject({ runsLeft: AI.requestsPerRoom - 1, set: null });
    const done = await nextSuggestions(owner, (view) => view.set !== null);
    expect(done.pendingUntil).toBeNull();
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

  test.each([
    ["throws", () => Promise.reject(new Error("model down"))],
    ["returns unusable output", () => Promise.resolve("not json")],
  ])("a model that %s reports suggest_failed to the owner and frees the room", async (_, model) => {
    useSuggester(model);
    const { code, owner } = await groupRoom();
    await owner.ok({ type: "suggestGroups" });

    expect((await owner.next("error")).code).toBe("suggest_failed");
    expect(owner.latest("suggestions")?.suggestions).toMatchObject({
      pendingUntil: null,
      runsLeft: AI.requestsPerRoom - 1,
      set: null,
    });
    expect(await aiRow(code)).toEqual({
      ai_runs: 1,
      ai_pending_since: null,
      suggestion_set_id: null,
    });
  });

  test("leaving group while the model runs stores no set", async () => {
    let released = false;
    useSuggester(async () => {
      while (!released) await new Promise((resolve) => setTimeout(resolve, 5));
      return { groups: [{ target: null, itemIds: [1, 2], title: "Deploys" }] };
    });
    const { code, owner } = await groupRoom();
    await owner.ok({ type: "suggestGroups" });
    await owner.ok({ type: "advance", from: "group" });

    released = true;
    while ((await aiRow(code)).ai_pending_since !== null) await owner.sync();

    expect((await aiRow(code)).suggestion_set_id).toBeNull();
    expect(
      owner.received.some((message) => message.type === "error" && message.reqId === undefined),
    ).toBe(false);
  });

  test("the per-IP limit refuses without spending a room run", async () => {
    const ip = nextIp();
    for (let run = 0; run < 5; run++) {
      const { owner } = await groupRoom(ip);
      await owner.ok({ type: "suggestGroups" });
    }
    const { code, owner } = await groupRoom(ip);
    expect(await owner.rejects({ type: "suggestGroups" })).toBe("suggest_rate_limited");
    expect(await aiRow(code)).toMatchObject({ ai_runs: 0, ai_pending_since: null });
  });
});

describe("runWithTimeout", () => {
  test("aborts a model call that outlives the timeout", async () => {
    let signal: AbortSignal | undefined;
    const hanging: Suggester = (_input, abort) => {
      signal = abort;
      return new Promise(() => {});
    };
    const input = { categories: [], ungroupedItems: [], groups: [] };
    expect(await runWithTimeout(hanging, input, 10)).toEqual({ ok: false });
    expect(signal?.aborted).toBe(true);
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
