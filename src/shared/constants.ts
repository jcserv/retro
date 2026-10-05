export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export const ROOM_CODE_LENGTH = 6;
export const ROOM_TTL_MS = 24 * 60 * 60 * 1000;

export const LIMITS = {
  itemTextMax: 280,
  groupTitleMax: 280,
  commentTextMax: 500,
  actionTextMax: 280,
  assigneeMax: 60,
  itemsPerClient: 30,
  participantsPerRoom: 50,
  voteLimitDefault: 5,
  voteLimitMin: 1,
  voteLimitMax: 20,
  timerMinMs: 60_000,
  timerMaxMs: 60 * 60_000,
  socketBurst: 30,
  socketRefillPerSec: 10,
  createRoomPerIpPerMinute: 10,
} as const;

export const DEFAULT_CATEGORIES = [
  { id: "well", title: "What went well?" },
  { id: "less-well", title: "What went less well?" },
  { id: "try-next", title: "What do we want to try next?" },
  { id: "puzzles", title: "What puzzles us?" },
  { id: "shoutouts", title: "Shoutouts" },
] as const;

export const CloseCode = {
  BadRequest: 4000,
  Unauthenticated: 4001,
  NotFound: 4004,
  RateLimited: 4008,
  RoomFull: 4009,
  Expired: 4010,
} as const;
