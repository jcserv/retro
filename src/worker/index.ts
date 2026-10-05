import { z } from "zod";
import { CloseCode } from "../shared/constants";
import { generateRoomCode, isValidRoomCode } from "../shared/roomCode";

export { RoomDurableObject } from "./room/RoomDurableObject";

const CREATE_ATTEMPTS = 5;
const CreateRoomBody = z.object({ clientId: z.uuid() });

const json = (body: unknown, status = 200): Response => Response.json(body, { status });
const notFound = (): Response => json({ error: "not_found" }, 404);

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    const [, area, resource, code, ...rest] = pathname.split("/");

    if (area === "api" && resource === "rooms" && rest.length === 0) {
      if (code === undefined && request.method === "POST") return createRoom(request, env);
      if (code !== undefined && request.method === "GET") return roomExists(code, env);
    }
    if (area === "ws" && resource !== undefined && code === undefined) {
      return connect(request, resource, env);
    }
    return notFound();
  },
} satisfies ExportedHandler<Env>;

async function createRoom(request: Request, env: Env): Promise<Response> {
  const body = CreateRoomBody.safeParse(await request.json().catch(() => null));
  if (!body.success) return json({ error: "invalid_request" }, 400);

  const ip = request.headers.get("CF-Connecting-IP") ?? "unknown";
  const { success } = await env.CREATE_ROOM_LIMITER.limit({ key: ip });
  if (!success) return json({ error: "rate_limited" }, 429);

  for (let attempt = 0; attempt < CREATE_ATTEMPTS; attempt++) {
    const code = generateRoomCode();
    const result = await env.ROOMS.getByName(code).init({
      code,
      ownerClientId: body.data.clientId,
      now: Date.now(),
    });
    if (result === "created") return json({ code }, 201);
  }
  return json({ error: "unavailable" }, 503);
}

async function roomExists(code: string, env: Env): Promise<Response> {
  if (!isValidRoomCode(code)) return notFound();
  const exists = await env.ROOMS.getByName(code).exists();
  return exists ? json({ exists: true }) : notFound();
}

function connect(request: Request, code: string, env: Env): Response | Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") {
    return json({ error: "upgrade_required" }, 426);
  }
  if (isValidRoomCode(code)) return env.ROOMS.getByName(code).fetch(request);
  const { 0: client, 1: server } = new WebSocketPair();
  server.accept();
  server.close(CloseCode.NotFound, "Room not found");
  return new Response(null, { status: 101, webSocket: client });
}
