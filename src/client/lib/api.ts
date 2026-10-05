export type CreateRoomResult =
  | { ok: true; code: string }
  | { ok: false; reason: "rate_limited" | "failed" };

export async function createRoom(clientId: string): Promise<CreateRoomResult> {
  try {
    const response = await fetch("/api/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ clientId }),
    });
    if (response.status === 429) return { ok: false, reason: "rate_limited" };
    if (!response.ok) return { ok: false, reason: "failed" };
    const body = (await response.json()) as { code: string };
    return { ok: true, code: body.code };
  } catch {
    return { ok: false, reason: "failed" };
  }
}

export type RoomExistsResult = "exists" | "not_found" | "failed";

export async function roomExists(code: string): Promise<RoomExistsResult> {
  try {
    const response = await fetch(`/api/rooms/${encodeURIComponent(code)}`);
    if (response.ok) return "exists";
    if (response.status === 404) return "not_found";
    return "failed";
  } catch {
    return "failed";
  }
}
