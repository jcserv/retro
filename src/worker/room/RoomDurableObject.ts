import { DurableObject } from "cloudflare:workers";

export class RoomDurableObject extends DurableObject<Env> {}
