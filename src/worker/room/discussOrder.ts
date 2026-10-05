export type DiscussCandidate = {
  groupId: string;
  votes: number;
  categoryPosition: number;
  earliestItemAt: number;
};

const compareIds = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

export function discussOrder(candidates: readonly DiscussCandidate[]): string[] {
  return [...candidates]
    .sort(
      (a, b) =>
        b.votes - a.votes ||
        a.categoryPosition - b.categoryPosition ||
        a.earliestItemAt - b.earliestItemAt ||
        compareIds(a.groupId, b.groupId),
    )
    .map((candidate) => candidate.groupId);
}
