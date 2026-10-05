export const PHASES = ["write", "group", "vote", "discuss", "done"] as const;
export type Phase = (typeof PHASES)[number];
