import { useState } from "preact/hooks";
import { LIMITS } from "../../shared/constants";
import type { Phase } from "../../shared/protocol";
import { copy } from "../copy";
import { useRoomStore } from "../state/roomContext";
import { Icon } from "./Icon";
import styles from "./OwnerControls.module.css";
import { READY_PHASES } from "./ReadyToggle";
import { useTicker } from "./Timer";

const VOTE_LIMIT_PHASES: readonly Phase[] = ["write", "group", "vote"];

export function OwnerControls() {
  const store = useRoomStore();
  const room = store.room.value;
  if (!room?.isOwner || room.phase === "done") return null;

  const { readyCount, connectedCount } = room.presence;
  const allReady = connectedCount > 0 && readyCount >= connectedCount;

  return (
    <div class={styles.controls}>
      {READY_PHASES.includes(room.phase) && (
        <span
          class={`badge ${allReady ? "badge-success" : ""} ${styles.readyCount}`}
          aria-live="polite"
        >
          {copy.ready.count(readyCount, connectedCount)}
        </span>
      )}
      {VOTE_LIMIT_PHASES.includes(room.phase) && <VoteLimitStepper />}
      {room.phase === "group" && <SuggestButton />}
      <AdvanceButton phase={room.phase} />
    </div>
  );
}

function VoteLimitStepper() {
  const store = useRoomStore();
  const limit = store.room.value?.voteLimit ?? LIMITS.voteLimitDefault;
  const disabled = !store.isLive.value;

  function step(delta: number) {
    const current = store.room.peek()?.voteLimit ?? LIMITS.voteLimitDefault;
    const next = Math.min(LIMITS.voteLimitMax, Math.max(LIMITS.voteLimitMin, current + delta));
    if (next !== current) void store.setVoteLimit(next);
  }

  return (
    <fieldset class={styles.fieldset}>
      <legend class="visually-hidden">{copy.owner.votesPerPerson}</legend>
      <div class={styles.stepper}>
        <span class={styles.stepperLabel} aria-hidden="true">
          {copy.owner.votes}
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-icon"
          aria-label={copy.owner.fewerVotes}
          disabled={disabled || limit <= LIMITS.voteLimitMin}
          onClick={() => step(-1)}
        >
          <Icon name="minus" />
        </button>
        <output class={styles.stepperValue} aria-live="polite">
          <span class="visually-hidden">{copy.owner.votesPerPersonValue}</span>
          {limit}
        </output>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-icon"
          aria-label={copy.owner.moreVotes}
          disabled={disabled || limit >= LIMITS.voteLimitMax}
          onClick={() => step(1)}
        >
          <Icon name="plus" />
        </button>
      </div>
    </fieldset>
  );
}

function SuggestButton() {
  const store = useRoomStore();
  const [requesting, setRequesting] = useState(false);
  const suggestions = store.room.value?.suggestions ?? null;
  const now = store.serverNow();
  const pending = (suggestions?.pendingUntil ?? 0) > now;
  const cooldownMs = Math.max(0, (suggestions?.cooldownEndsAt ?? 0) - now);
  useTicker(pending || cooldownMs > 0);
  if (!suggestions?.enabled) return null;

  const reason = pending
    ? copy.suggestions.suggesting
    : suggestions.runsLeft === 0
      ? copy.suggestions.noneLeft
      : cooldownMs > 0
        ? copy.suggestions.suggestAgain(Math.ceil(cooldownMs / 1000))
        : null;

  async function suggest() {
    setRequesting(true);
    await store.suggestGroups();
    setRequesting(false);
  }

  return (
    <button
      type="button"
      class={`btn btn-subtle ${styles.suggest}`}
      title={copy.suggestions.suggestTitle}
      onClick={suggest}
      disabled={requesting || reason !== null || !store.isLive.value}
    >
      {pending && <span class={`spinner ${styles.spinner}`} aria-hidden="true" />}
      {reason ?? copy.suggestions.suggest}
    </button>
  );
}

function AdvanceButton({ phase }: { phase: Phase }) {
  const store = useRoomStore();
  const [pending, setPending] = useState(false);
  const label = copy.owner.advance[phase];
  if (!label) return null;

  async function advance() {
    setPending(true);
    await store.advance(phase);
    setPending(false);
  }

  return (
    <button
      type="button"
      class={`btn btn-primary ${styles.advance}`}
      onClick={advance}
      disabled={pending || !store.isLive.value}
    >
      {label}
    </button>
  );
}
