import { evictDurableObject, runDurableObjectAlarm } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { describe, expect, test } from "vitest";
import { CloseCode, LIMITS, ROOM_TTL_MS } from "../../../src/shared/constants";
import { connect, createRoom, openSocket, type TestSocket } from "../ws";
import { ALICE, BOB, OWNER } from "./harness";

const participant = (n: number) => `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;

describe("room lifecycle", () => {
  test("the alarm closes sockets with 4010 and deletes the room", async () => {
    const code = await createRoom(OWNER);
    const stub = env.ROOMS.getByName(code);
    const { socket } = await connect(code, OWNER);

    expect(await runDurableObjectAlarm(stub)).toBe(true);
    expect((await socket.closed).code).toBe(CloseCode.Expired);
    expect(await stub.exists()).toBe(false);
    expect((await exports.default.fetch(`https://example.com/api/rooms/${code}`)).status).toBe(404);
    expect((await (await openSocket(code)).closed).code).toBe(CloseCode.NotFound);
  });

  test("init schedules the alarm at expiry and reports collisions", async () => {
    const stub = env.ROOMS.getByName("CDEF23");
    const now = Date.now();
    expect(await stub.init({ code: "CDEF23", ownerClientId: OWNER, now })).toBe("created");
    expect(await stub.init({ code: "CDEF23", ownerClientId: ALICE, now })).toBe("exists");
    expect(await stub.init({ code: "CDEF23", ownerClientId: ALICE, now: now + ROOM_TTL_MS })).toBe(
      "created",
    );
    const { room } = await connect("CDEF23", ALICE);
    expect(room.isOwner).toBe(true);
    expect(room.expiresAt).toBe(now + 2 * ROOM_TTL_MS);
  });
});

describe("handshake", () => {
  test("a message before hello closes with 4001", async () => {
    const code = await createRoom(OWNER);
    for (const first of [{ type: "setReady", ready: true }, "not json", { type: "hello" }]) {
      const socket = await openSocket(code);
      socket.send(first);
      expect((await socket.closed).code).toBe(CloseCode.Unauthenticated);
    }
  });

  test("hello returns a snapshot and acks, a second hello is rejected", async () => {
    const code = await createRoom(OWNER);
    const socket = await openSocket(code);
    socket.send({ type: "hello", clientId: OWNER, reqId: "h1" });
    const { room } = await socket.next("snapshot");
    expect(room).toMatchObject({ code, phase: "write", isOwner: true });
    expect(room.presence).toEqual({ participantCount: 1, connectedCount: 1, readyCount: 0 });
    expect(await socket.next("ack")).toEqual({ type: "ack", reqId: "h1" });
    expect(await socket.rejects({ type: "hello", clientId: OWNER })).toBe("invalid_message");
  });

  test("the 51st distinct participant closes with 4009 but a known one can rejoin", async () => {
    const code = await createRoom(OWNER);
    const sockets: TestSocket[] = [];
    for (let n = 1; n <= LIMITS.participantsPerRoom; n++) {
      sockets.push((await connect(code, participant(n))).socket);
    }
    const extra = await openSocket(code);
    extra.send({ type: "hello", clientId: participant(LIMITS.participantsPerRoom + 1) });
    expect((await extra.closed).code).toBe(CloseCode.RoomFull);

    sockets[1]?.close();
    const { room } = await connect(code, participant(2));
    expect(room.presence.participantCount).toBe(LIMITS.participantsPerRoom);
    for (const socket of sockets) socket.close();
  });

  test("presence follows connects and disconnects", async () => {
    const code = await createRoom(OWNER);
    const { socket: owner } = await connect(code, OWNER);
    const { socket: alice } = await connect(code, ALICE);
    await owner.sync();
    expect(owner.latest("presence")?.presence).toEqual({
      participantCount: 2,
      connectedCount: 2,
      readyCount: 0,
    });
    await alice.ok({ type: "setReady", ready: true });
    alice.close();
    await alice.closed;
    await owner.next("presence");
    await owner.next("presence");
    expect(owner.latest("presence")?.presence).toEqual({
      participantCount: 2,
      connectedCount: 1,
      readyCount: 0,
    });
  });
});

describe("frames", () => {
  test("ping gets an automatic pong", async () => {
    const code = await createRoom(OWNER);
    const { socket } = await connect(code, OWNER);
    socket.send("ping");
    await socket.sync();
    expect(socket.raw).toContain("pong");
  });

  test("binary and oversized frames are rejected as invalid_message", async () => {
    const code = await createRoom(OWNER);
    const { socket } = await connect(code, OWNER);
    socket.ws.send(new Uint8Array([1, 2, 3]));
    expect((await socket.next("error")).code).toBe("invalid_message");
    socket.send({ type: "addItem", categoryId: "well", text: "x".repeat(9000), reqId: "big" });
    expect(await socket.next("error")).toEqual({
      type: "error",
      code: "invalid_message",
      message: "Invalid message",
    });
  });

  test("field errors from the schema keep their codes and reqId", async () => {
    const code = await createRoom(OWNER);
    const { socket } = await connect(code, OWNER);
    const text = "x".repeat(LIMITS.itemTextMax + 1);
    expect(await socket.rejects({ type: "addItem", categoryId: "well", text })).toBe("too_long");
    expect(await socket.rejects({ type: "addItem", categoryId: "well", text: "  " })).toBe("empty");
  });

  test("sustained overflow is rejected, then closed with 4008", async () => {
    const code = await createRoom(OWNER);
    const { socket } = await connect(code, OWNER);
    const errors = () => socket.received.filter((m) => m.type === "error");
    for (let i = 0; i < LIMITS.socketBurst + 5; i++) socket.send({ type: "sync", reqId: `s${i}` });
    const rateLimited = await socket.next("error").then(async () => {
      while (!errors().some((m) => m.type === "error" && m.code === "rate_limited")) {
        await socket.next("error");
      }
      return errors().find((m) => m.type === "error" && m.code === "rate_limited");
    });
    expect(rateLimited).toMatchObject({ code: "rate_limited", reqId: expect.any(String) });

    const deadline = Date.now() + 5000;
    let closed: { code: number } | undefined;
    void socket.closed.then((event) => {
      closed = event;
    });
    while (!closed && Date.now() < deadline) {
      for (let i = 0; i < 20; i++) socket.send({ type: "sync" });
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    expect(closed?.code).toBe(CloseCode.RateLimited);
  }, 10_000);
});

describe("hibernation", () => {
  test("authenticated sockets survive eviction", async () => {
    const code = await createRoom(OWNER);
    const { socket: owner } = await connect(code, OWNER);
    const { socket: alice } = await connect(code, ALICE);
    await evictDurableObject(env.ROOMS.getByName(code));

    await owner.ok({ type: "addItem", categoryId: "well", text: "after eviction" });
    await alice.ok({ type: "setReady", ready: true });
    await owner.sync();
    expect(owner.latest("presence")?.presence).toEqual({
      participantCount: 2,
      connectedCount: 2,
      readyCount: 1,
    });
  });
});

describe("intents over the wire", () => {
  test("owner-only intents are forbidden for participants", async () => {
    const code = await createRoom(OWNER);
    await connect(code, OWNER);
    const { socket: alice } = await connect(code, ALICE);
    const ownerOnly = [
      { type: "advance", from: "write" },
      { type: "setVoteLimit", limit: 3 },
      { type: "setTimer", durationMs: LIMITS.timerMinMs },
      { type: "pauseTimer" },
      { type: "resumeTimer" },
      { type: "addTimerMinute" },
      { type: "clearTimer" },
      { type: "next", fromIndex: 0 },
      { type: "prev", fromIndex: 0 },
      { type: "skip", fromIndex: 0 },
    ];
    for (const intent of ownerOnly) expect(await alice.rejects(intent)).toBe("forbidden");
  });

  test("wrong-phase intents, item limits and vote limits are reported to the sender", async () => {
    const code = await createRoom(OWNER);
    const { socket: owner } = await connect(code, OWNER);
    expect(await owner.rejects({ type: "vote", groupId: "g" })).toBe("wrong_phase");
    for (let i = 0; i < LIMITS.itemsPerClient; i++) {
      if (i === LIMITS.itemsPerClient / 2)
        await new Promise((resolve) => setTimeout(resolve, 1500));
      await owner.ok({ type: "addItem", categoryId: "well", text: `item ${i}` });
    }
    expect(await owner.rejects({ type: "addItem", categoryId: "well", text: "one more" })).toBe(
      "item_limit",
    );
    await owner.ok({ type: "setVoteLimit", limit: 1 });
    await owner.ok({ type: "advance", from: "write" });
    await owner.ok({ type: "advance", from: "group" });
    const groupId = owner.latest("snapshot")?.room.groups[0]?.id;
    await owner.ok({ type: "vote", groupId });
    expect(await owner.rejects({ type: "vote", groupId })).toBe("vote_limit");
  });

  test("reconnecting with the owner clientId regains owner controls", async () => {
    const code = await createRoom(OWNER);
    const first = await connect(code, OWNER);
    first.socket.close();
    const { socket, room } = await connect(code, OWNER);
    expect(room.isOwner).toBe(true);
    await socket.ok({ type: "advance", from: "write" });
  });

  test("a double advance with the same from advances once", async () => {
    const code = await createRoom(OWNER);
    const { socket: owner } = await connect(code, OWNER);
    const { socket: alice } = await connect(code, ALICE);
    owner.send({ type: "advance", from: "write", reqId: "a" });
    owner.send({ type: "advance", from: "write", reqId: "b" });
    expect(await owner.next("ack")).toEqual({ type: "ack", reqId: "a" });
    expect(await owner.next("error")).toMatchObject({ code: "stale", reqId: "b" });
    await alice.sync();
    const phases = alice.received.flatMap((m) => (m.type === "snapshot" ? [m.room.phase] : []));
    expect(phases).toEqual(["write", "group"]);
  });

  test("conflicting grouping moves converge on every client", async () => {
    const code = await createRoom(OWNER);
    const { socket: owner } = await connect(code, OWNER);
    const { socket: alice } = await connect(code, ALICE);
    const { socket: bob } = await connect(code, BOB);
    await owner.ok({ type: "addItem", categoryId: "well", text: "a" });
    await alice.ok({ type: "addItem", categoryId: "less-well", text: "b" });
    await bob.ok({ type: "addItem", categoryId: "puzzles", text: "c" });
    await owner.ok({ type: "advance", from: "write" });
    await Promise.all([alice.next("snapshot"), bob.next("snapshot")]);
    const groups = owner.latest("snapshot")?.room.groups ?? [];
    const [g1, g2, g3] = groups.map((group) => group.id);

    const replies = await Promise.all([
      alice.request({ type: "mergeGroups", sourceGroupId: g1, targetGroupId: g2 }),
      bob.request({ type: "mergeGroups", sourceGroupId: g1, targetGroupId: g3 }),
    ]);
    expect(replies.map((reply) => reply.type).sort()).toEqual(["ack", "error"]);
    expect(replies.find((reply) => reply.type === "error")).toMatchObject({ code: "not_found" });
    await Promise.all([owner.sync(), alice.sync(), bob.sync()]);

    const finalGroups = [owner, alice, bob].map((socket) => replay(socket));
    expect(finalGroups[1]).toEqual(finalGroups[0]);
    expect(finalGroups[2]).toEqual(finalGroups[0]);
    expect(Object.keys(finalGroups[0] ?? {})).toHaveLength(2);
  });

  test("a grouping op against a deleted group returns not_found", async () => {
    const code = await createRoom(OWNER);
    const { socket: owner } = await connect(code, OWNER);
    await owner.ok({ type: "addItem", categoryId: "well", text: "a" });
    await owner.ok({ type: "addItem", categoryId: "well", text: "b" });
    await owner.ok({ type: "advance", from: "write" });
    const [g1, g2] = (owner.latest("snapshot")?.room.groups ?? []).map((group) => group.id);
    await owner.ok({ type: "mergeGroups", sourceGroupId: g1, targetGroupId: g2 });
    expect(await owner.rejects({ type: "renameGroup", groupId: g1, title: "gone" })).toBe(
      "not_found",
    );
  });
});

function replay(socket: TestSocket): Record<string, string[]> {
  const groups = new Map<string, string[]>();
  for (const message of socket.received) {
    if (message.type === "snapshot") {
      groups.clear();
      for (const group of message.room.groups) groups.set(group.id, group.itemIds);
    } else if (message.type === "groupUpserted") {
      groups.set(message.group.id, message.group.itemIds);
    } else if (message.type === "groupRemoved") {
      groups.delete(message.groupId);
    }
  }
  return Object.fromEntries(groups);
}
