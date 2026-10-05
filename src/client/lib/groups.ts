import type { DiscussStatus } from "../../shared/protocol";
import type { RoomState } from "../state/roomState";
import { type BoardGroup, boardGroupResolver } from "./board";

export function votesUsed(myVotes: Readonly<Record<string, number>>): number {
  return Object.values(myVotes).reduce((sum, count) => sum + count, 0);
}

export type DiscussEntry = BoardGroup & {
  index: number;
  status: DiscussStatus;
  votes: number;
};

export function discussEntries(state: RoomState): DiscussEntry[] {
  if (!state.discuss) return [];
  const groups = new Map(state.groups.map((entry) => [entry.id, entry]));
  const resolve = boardGroupResolver(state);
  const { order, status } = state.discuss;
  return order.flatMap((groupId, index) => {
    const group = groups.get(groupId);
    if (!group) return [];
    return {
      ...resolve(group),
      index,
      status: status[groupId] ?? "pending",
      votes: state.voteTotals?.[groupId] ?? 0,
    };
  });
}
