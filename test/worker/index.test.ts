import { exports } from "cloudflare:workers";
import { beforeEach, describe, expect, test, vi } from "vitest";
import { CloseCode, LIMITS } from "../../src/shared/constants";
import { generateRoomCode, isValidRoomCode } from "../../src/shared/roomCode";
import { createRoom, openSocket, postRoom } from "./ws";

vi.mock("../../src/shared/roomCode", { spy: true });

const OWNER = "00000000-0000-4000-8000-000000000001";

beforeEach(() => {
  vi.mocked(generateRoomCode).mockRestore();
});

const getRoom = (code: string) => exports.default.fetch(`https://example.com/api/rooms/${code}`);

describe("POST /api/rooms", () => {
  test("creates a room that then exists", async () => {
    const response = await postRoom({ clientId: OWNER }, "198.51.100.1");
    expect(response.status).toBe(201);
    const { code } = (await response.json()) as { code: string };
    expect(isValidRoomCode(code)).toBe(true);

    const exists = await getRoom(code);
    expect(exists.status).toBe(200);
    expect(await exists.json()).toEqual({ exists: true });
  });

  test("rejects bodies without a UUID clientId", async () => {
    for (const body of [{}, { clientId: "nope" }, "garbage"]) {
      expect((await postRoom(body, "198.51.100.2")).status).toBe(400);
    }
  });

  test("rate limits room creation per IP", async () => {
    const statuses: number[] = [];
    for (let i = 0; i <= LIMITS.createRoomPerIpPerMinute; i++) {
      statuses.push((await postRoom({ clientId: OWNER }, "198.51.100.3")).status);
    }
    expect(statuses.slice(0, -1).every((status) => status === 201)).toBe(true);
    expect(statuses.at(-1)).toBe(429);
    expect((await postRoom({ clientId: OWNER }, "198.51.100.4")).status).toBe(201);
  });

  test("retries on a code collision", async () => {
    const taken = await createRoom(OWNER);
    vi.mocked(generateRoomCode).mockReturnValueOnce(taken).mockReturnValueOnce("FRESH2");

    const response = await postRoom({ clientId: OWNER }, "198.51.100.5");
    expect(response.status).toBe(201);
    expect(await response.json()).toEqual({ code: "FRESH2" });
  });

  test("returns 503 after five collisions", async () => {
    const taken = await createRoom(OWNER);
    vi.mocked(generateRoomCode).mockReturnValue(taken);

    const response = await postRoom({ clientId: OWNER }, "198.51.100.6");
    expect(response.status).toBe(503);
    expect(generateRoomCode).toHaveBeenCalledTimes(6);
  });
});

describe("GET /api/rooms/:code", () => {
  test("404s for unknown and malformed codes", async () => {
    expect((await getRoom("ZZZZZZ")).status).toBe(404);
    expect((await getRoom("abc")).status).toBe(404);
    expect((await getRoom("ABC23O")).status).toBe(404);
  });
});

describe("/ws/:code", () => {
  test("requires a WebSocket upgrade", async () => {
    const response = await exports.default.fetch("https://example.com/ws/ABC234");
    expect(response.status).toBe(426);
  });

  test("closes with 4004 for malformed and unknown codes", async () => {
    for (const code of ["nope", "ZZZZZZ"]) {
      const socket = await openSocket(code);
      expect((await socket.closed).code).toBe(CloseCode.NotFound);
    }
  });
});

test("unknown API routes return 404", async () => {
  const response = await exports.default.fetch("https://example.com/api/nope");
  expect(response.status).toBe(404);
  expect(await response.json()).toEqual({ error: "not_found" });
});
