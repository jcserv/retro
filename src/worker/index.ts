export { RoomDurableObject } from "./room/RoomDurableObject";

export default {
  async fetch() {
    return Response.json({ error: "not_found" }, { status: 404 });
  },
} satisfies ExportedHandler<Env>;
