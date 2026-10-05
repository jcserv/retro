import { DEFAULT_CATEGORIES, LIMITS } from "../../shared/constants";
import type { GroupView, ItemView, RoomSnapshot } from "../../shared/protocol";
import type { RoomState } from "../state/roomState";

export function makeSnapshot(overrides: Partial<RoomSnapshot> = {}): RoomSnapshot {
  return {
    code: "ABC234",
    createdAt: 1_000,
    expiresAt: 1_000 + 24 * 60 * 60 * 1000,
    serverNow: 2_000,
    phase: "write",
    categories: DEFAULT_CATEGORIES.map((category) => ({ ...category })),
    isOwner: false,
    presence: { participantCount: 1, connectedCount: 1, readyCount: 0 },
    youReady: false,
    timer: { kind: "none" },
    voteLimit: LIMITS.voteLimitDefault,
    items: [],
    groups: [],
    categoryCounts: {},
    myVotes: {},
    voteTotals: null,
    discuss: null,
    comments: [],
    actions: [],
    ...overrides,
  };
}

export function makeRoomState(overrides: Partial<RoomState> = {}): RoomState {
  const { serverNow: _, ...room } = makeSnapshot(overrides);
  return room;
}

export function item(
  id: string,
  groupId: string | null,
  createdAt: number,
  categoryId = "well",
): ItemView {
  return { id, categoryId, groupId, text: `text ${id}`, createdAt };
}

export function group(
  id: string,
  itemIds: string[],
  categoryId = "well",
  createdAt = 0,
): GroupView {
  return { id, categoryId, title: null, itemIds, createdAt };
}
