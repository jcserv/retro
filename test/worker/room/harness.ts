import { runInDurableObject } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { expect } from "vitest";
import type { Phase } from "../../../src/shared/protocol";
import {
  type Actor,
  type Change,
  type ClientIntent,
  type CommandResult,
  createRoom,
  handle,
} from "../../../src/worker/room/commands";
import { migrate } from "../../../src/worker/room/schema";
import { RoomStore } from "../../../src/worker/room/store";

export const OWNER = "00000000-0000-4000-8000-000000000001";
export const ALICE = "00000000-0000-4000-8000-000000000002";
export const BOB = "00000000-0000-4000-8000-000000000003";
export const ALL_CLIENTS = [OWNER, ALICE, BOB] as const;
export const T0 = 1_000_000;

export const owner: Actor = { clientId: OWNER, isOwner: true };
export const alice: Actor = { clientId: ALICE, isOwner: false };
export const bob: Actor = { clientId: BOB, isOwner: false };

export class Room {
  #t = T0;

  constructor(readonly store: RoomStore) {}

  tick(ms = 1): number {
    this.#t += ms;
    return this.#t;
  }

  get now(): number {
    return this.#t;
  }

  run(actor: Actor, intent: ClientIntent): CommandResult {
    return handle(this.store, actor, intent, this.tick());
  }

  ok(actor: Actor, intent: ClientIntent): Change[] {
    const result = this.run(actor, intent);
    if (!result.ok) throw new Error(`${intent.type} failed: ${result.code} ${result.message}`);
    return result.changes;
  }

  rejects(actor: Actor, intent: ClientIntent): string {
    const result = this.run(actor, intent);
    if (result.ok) throw new Error(`${intent.type} unexpectedly succeeded`);
    return result.code;
  }

  addItem(actor: Actor, categoryId: string, text: string): string {
    const change = this.ok(actor, { type: "addItem", categoryId, text })[0];
    if (change?.kind !== "itemUpserted") throw new Error("addItem returned no item");
    return change.itemId;
  }

  advanceTo(phase: Phase): void {
    while (this.phase !== phase) this.ok(owner, { type: "advance", from: this.phase });
  }

  get phase(): Phase {
    const room = this.store.getRoom();
    if (!room) throw new Error("room missing");
    return room.phase;
  }

  groupOf(itemId: string): string {
    const groupId = this.store.getItem(itemId)?.groupId;
    if (!groupId) throw new Error(`item ${itemId} has no group`);
    return groupId;
  }

  discussOrder(): string[] {
    return this.store.listDiscussOrder().map((entry) => entry.groupId);
  }
}

export function withRoom<T>(fn: (room: Room) => T): Promise<T> {
  const stub = env.ROOMS.getByName(crypto.randomUUID());
  return runInDurableObject(stub, (_instance, state) => {
    migrate(state.storage.sql);
    const store = new RoomStore(state.storage);
    createRoom(store, { code: "ABC234", ownerClientId: OWNER, now: T0 });
    return fn(new Room(store));
  });
}

export function expectGroupingInvariant(store: RoomStore): void {
  const groupIds = new Set(store.listGroups().map((group) => group.id));
  for (const item of store.listItems()) {
    expect(item.groupId !== null && groupIds.has(item.groupId), `item ${item.id} grouped`).toBe(
      true,
    );
  }
  for (const groupId of groupIds) {
    expect(store.countItemsInGroup(groupId), `group ${groupId} non-empty`).toBeGreaterThan(0);
  }
}
