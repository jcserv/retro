import type { IntentErrorCode } from "./connection";

export const ERROR_MESSAGES: Record<IntentErrorCode, string> = {
  invalid_message: "Something went wrong sending that. Try again.",
  forbidden: "Only the room owner can do that.",
  wrong_phase: "That isn't available in this phase anymore.",
  not_found: "That no longer exists.",
  too_long: "That's too long.",
  empty: "That can't be empty.",
  item_limit: "You've reached the item limit for this room.",
  vote_limit: "You're out of votes.",
  stale: "Someone already did that.",
  rate_limited: "Slow down a little and try again.",
  disconnected: "You're offline. Reconnecting…",
  timeout: "The room didn't respond. Try again.",
};
