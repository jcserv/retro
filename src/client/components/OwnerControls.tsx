import { useState } from "preact/hooks";
import { LIMITS } from "../../shared/constants";
import type { Phase } from "../../shared/protocol";
import { useRoomStore } from "../state/roomContext";
import { Icon } from "./Icon";
import styles from "./OwnerControls.module.css";
import { READY_PHASES } from "./ReadyToggle";

const ADVANCE_LABELS: Record<Phase, string | null> = {
  write: "Start grouping",
  group: "Start voting",
  vote: "Start discussion",
  discuss: "Finish retro",
  done: null,
};

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
          {readyCount}/{connectedCount} ready
        </span>
      )}
      {VOTE_LIMIT_PHASES.includes(room.phase) && <VoteLimitStepper />}
      <AdvanceButton phase={room.phase} />
    </div>
  );
}

function VoteLimitStepper() {
  const store = useRoomStore();
  const limit = store.room.value?.voteLimit ?? LIMITS.voteLimitDefault;
  const disabled = !store.isLive.value;
  return (
    <fieldset class={styles.fieldset}>
      <legend class="visually-hidden">Votes per person</legend>
      <div class={styles.stepper}>
        <span class={styles.stepperLabel} aria-hidden="true">
          Votes
        </span>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-icon"
          aria-label="Fewer votes per person"
          disabled={disabled || limit <= LIMITS.voteLimitMin}
          onClick={() => store.setVoteLimit(limit - 1)}
        >
          <Icon name="minus" />
        </button>
        <output class={styles.stepperValue} aria-live="polite">
          <span class="visually-hidden">Votes per person: </span>
          {limit}
        </output>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-icon"
          aria-label="More votes per person"
          disabled={disabled || limit >= LIMITS.voteLimitMax}
          onClick={() => store.setVoteLimit(limit + 1)}
        >
          <Icon name="plus" />
        </button>
      </div>
    </fieldset>
  );
}

function AdvanceButton({ phase }: { phase: Phase }) {
  const store = useRoomStore();
  const [pending, setPending] = useState(false);
  const label = ADVANCE_LABELS[phase];
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
