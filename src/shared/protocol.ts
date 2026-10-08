import { z } from "zod";
import { LIMITS } from "./constants";
import { isEmoji, normalizeEmoji } from "./emoji";
import { PHASES, type Phase } from "./phases";

export { PHASES, type Phase };
export const PhaseSchema = z.enum(PHASES);

export type Category = { id: string; title: string };
export type DiscussStatus = "pending" | "discussed" | "skipped";

export type TimerState =
  | { kind: "none" }
  | { kind: "running"; endsAt: number }
  | { kind: "paused"; remainingMs: number };

export type ReactionView = { emoji: string; count: number; mine: boolean };

export type ItemView = {
  id: string;
  categoryId: string;
  groupId: string | null;
  text: string;
  mine?: true;
  reactions: ReactionView[];
  createdAt: number;
};

export type GroupView = {
  id: string;
  categoryId: string;
  title: string | null;
  itemIds: string[];
  createdAt: number;
};

export type CommentView = {
  id: string;
  groupId: string;
  text: string;
  mine: boolean;
  createdAt: number;
  updatedAt: number;
};

export type ActionView = {
  id: string;
  groupId: string;
  text: string;
  assignee: string | null;
  dueDate: string | null;
  mine: boolean;
  createdAt: number;
  updatedAt: number;
};

export type Presence = { participantCount: number; connectedCount: number; readyCount: number };

export type DiscussState = {
  order: string[];
  currentIndex: number;
  status: Record<string, DiscussStatus>;
};

export type RoomSnapshot = {
  code: string;
  createdAt: number;
  expiresAt: number;
  serverNow: number;
  phase: Phase;
  categories: Category[];
  isOwner: boolean;
  presence: Presence;
  youReady: boolean;
  timer: TimerState;
  voteLimit: number;
  items: ItemView[];
  groups: GroupView[];
  categoryCounts: Record<string, number>;
  myVotes: Record<string, number>;
  voteTotals: Record<string, number> | null;
  discuss: DiscussState | null;
  comments: CommentView[];
  actions: ActionView[];
};

const REQ_ID_MAX = 36;
const ID_MAX = 36;

const reqId = z.string().min(1).max(REQ_ID_MAX).optional();
const id = z.string().min(1).max(ID_MAX);
const index = z.int().min(0);

const EMPTY = "empty";
const TOO_LONG = "too_long";
type FieldErrorCode = typeof EMPTY | typeof TOO_LONG;
const isFieldErrorCode = (message: string): message is FieldErrorCode =>
  message === EMPTY || message === TOO_LONG;
const text = (max: number) =>
  z.string().trim().min(1, { error: EMPTY }).max(max, { error: TOO_LONG });
const emoji = z.string().max(LIMITS.reactionEmojiMax).overwrite(normalizeEmoji).refine(isEmoji);
const optionalText = (max: number) => z.string().trim().max(max, { error: TOO_LONG });
const optionalDate = z.union([z.iso.date(), z.literal("")]);

const intent = <T extends string, S extends z.ZodRawShape>(type: T, shape: S) =>
  z.strictObject({ type: z.literal(type), reqId, ...shape });

export const ClientMessageSchema = z.discriminatedUnion("type", [
  intent("hello", { clientId: z.uuid() }),
  intent("addItem", { categoryId: id, text: text(LIMITS.itemTextMax) }),
  intent("editItem", { itemId: id, text: text(LIMITS.itemTextMax) }),
  intent("deleteItem", { itemId: id }),
  intent("setReady", { ready: z.boolean() }),
  intent("moveItemToGroup", { itemId: id, groupId: id }),
  intent("mergeGroups", { sourceGroupId: id, targetGroupId: id }),
  intent("ungroupItem", { itemId: id }),
  intent("renameGroup", { groupId: id, title: optionalText(LIMITS.groupTitleMax) }),
  intent("addReaction", { itemId: id, emoji }),
  intent("removeReaction", { itemId: id, emoji }),
  intent("vote", { groupId: id }),
  intent("unvote", { groupId: id }),
  intent("addComment", { groupId: id, text: text(LIMITS.commentTextMax) }),
  intent("editComment", { commentId: id, text: text(LIMITS.commentTextMax) }),
  intent("deleteComment", { commentId: id }),
  intent("convertComment", { commentId: id }),
  intent("addAction", {
    groupId: id,
    text: text(LIMITS.actionTextMax),
    assignee: optionalText(LIMITS.assigneeMax).optional(),
    dueDate: optionalDate.optional(),
  }),
  intent("editAction", {
    actionId: id,
    text: text(LIMITS.actionTextMax),
    assignee: optionalText(LIMITS.assigneeMax).optional(),
    dueDate: optionalDate.optional(),
  }),
  intent("deleteAction", { actionId: id }),
  intent("advance", { from: PhaseSchema }),
  intent("setVoteLimit", { limit: z.int().min(LIMITS.voteLimitMin).max(LIMITS.voteLimitMax) }),
  intent("setTimer", { durationMs: z.int().min(LIMITS.timerMinMs).max(LIMITS.timerMaxMs) }),
  intent("pauseTimer", {}),
  intent("resumeTimer", {}),
  intent("addTimerMinute", {}),
  intent("clearTimer", {}),
  intent("next", { fromIndex: index }),
  intent("prev", { fromIndex: index }),
  intent("goTo", { fromIndex: index, toIndex: index }),
  intent("skip", { fromIndex: index }),
]);

export type ClientMessage = z.infer<typeof ClientMessageSchema>;
export type ClientMessageType = ClientMessage["type"];

export type ErrorCode =
  | "invalid_message"
  | "forbidden"
  | "wrong_phase"
  | "not_found"
  | "too_long"
  | "empty"
  | "item_limit"
  | "vote_limit"
  | "reaction_limit"
  | "stale"
  | "rate_limited";

export type ServerMessage =
  | { type: "snapshot"; room: RoomSnapshot }
  | { type: "ack"; reqId: string }
  | { type: "error"; code: ErrorCode; message: string; reqId?: string }
  | { type: "itemUpserted"; item: ItemView }
  | { type: "itemRemoved"; itemId: string }
  | { type: "groupUpserted"; group: GroupView }
  | { type: "groupRemoved"; groupId: string }
  | { type: "categoryCounts"; counts: Record<string, number> }
  | { type: "presence"; presence: Presence }
  | { type: "youReady"; ready: boolean }
  | { type: "myVotes"; votes: Record<string, number> }
  | { type: "voteLimit"; limit: number }
  | { type: "timer"; timer: TimerState; serverNow: number }
  | { type: "discussCursor"; currentIndex: number; status: Record<string, DiscussStatus> }
  | { type: "commentUpserted"; comment: CommentView }
  | { type: "commentRemoved"; commentId: string }
  | { type: "actionUpserted"; action: ActionView }
  | { type: "actionRemoved"; actionId: string };

export type ServerMessageType = ServerMessage["type"];

export type ParseClientMessageResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; code: "invalid_message" | FieldErrorCode; reqId?: string };

export function parseClientMessage(raw: string): ParseClientMessageResult {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ok: false, code: "invalid_message" };
  }
  const result = ClientMessageSchema.safeParse(data);
  if (result.success) return { ok: true, message: result.data };

  const messages = result.error.issues.map((issue) => issue.message);
  const fieldCode = messages.every(isFieldErrorCode) ? messages[0] : undefined;
  const failure: ParseClientMessageResult = { ok: false, code: fieldCode ?? "invalid_message" };
  const echoedReqId = reqId.safeParse((data as { reqId?: unknown } | null)?.reqId);
  if (echoedReqId.success && echoedReqId.data !== undefined) failure.reqId = echoedReqId.data;
  return failure;
}
