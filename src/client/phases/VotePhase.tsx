import { Board } from "../components/Board";
import { GroupCard } from "../components/GroupCard";
import { VoteBudget } from "../components/VoteBudget";
import { copy } from "../copy";
import { buildBoard } from "../lib/board";
import { votesUsed } from "../lib/groups";
import { useRoomStore } from "../state/roomContext";
import styles from "./VotePhase.module.css";

export function VotePhase() {
  const store = useRoomStore();
  const room = store.room.value;
  if (!room) return null;
  const used = votesUsed(room.myVotes);
  const canAdd = store.isLive.value && used < room.voteLimit;

  return (
    <section class={styles.phase} aria-labelledby="vote-heading">
      <div class={`card ${styles.intro}`}>
        <div class={styles.introText}>
          <h1 id="vote-heading" class={styles.heading}>
            {copy.vote.heading}
          </h1>
          <p class={styles.hint}>{copy.vote.hint}</p>
        </div>
        <VoteBudget used={used} limit={room.voteLimit} />
      </div>
      {room.groups.length === 0 ? (
        <p class={`card ${styles.empty}`}>{copy.board.noItemsWritten}</p>
      ) : (
        <Board
          columns={buildBoard(room)}
          renderGroup={(entry) => (
            <GroupCard
              group={entry}
              actions={
                <VoteControls
                  groupId={entry.group.id}
                  title={entry.label}
                  count={room.myVotes[entry.group.id] ?? 0}
                  canAdd={canAdd}
                  canRemove={store.isLive.value}
                />
              }
            />
          )}
        />
      )}
    </section>
  );
}

type VoteControlsProps = {
  groupId: string;
  title: string;
  count: number;
  canAdd: boolean;
  canRemove: boolean;
};

function VoteControls({ groupId, title, count, canAdd, canRemove }: VoteControlsProps) {
  const store = useRoomStore();
  return (
    <div class={styles.controls} data-voted={count > 0 ? "true" : undefined}>
      <button
        type="button"
        class="btn btn-ghost btn-sm btn-icon"
        aria-label={copy.vote.remove(title)}
        disabled={!canRemove || count === 0}
        onClick={() => store.unvote(groupId)}
      >
        <span aria-hidden="true">−</span>
      </button>
      <span class={styles.count}>
        <span class="visually-hidden">{copy.vote.yourVotes(title)}</span>
        {count}
      </span>
      <button
        type="button"
        class="btn btn-subtle btn-sm btn-icon"
        aria-label={copy.vote.add(title)}
        disabled={!canAdd}
        onClick={() => store.vote(groupId)}
      >
        <span aria-hidden="true">+</span>
      </button>
    </div>
  );
}
