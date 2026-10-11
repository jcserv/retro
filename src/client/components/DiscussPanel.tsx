import { copy } from "../copy";
import { discussEntries } from "../lib/groups";
import { useRoomStore } from "../state/roomContext";
import type { RoomState } from "../state/roomState";
import { ActionList } from "./ActionList";
import { CommentList } from "./CommentList";
import styles from "./DiscussPanel.module.css";
import { GroupDetails } from "./GroupDetails";

export function DiscussPanel({ room }: { room: RoomState }) {
  const store = useRoomStore();
  const discuss = room.discuss;
  const current = discussEntries(room).find((entry) => entry.index === discuss?.currentIndex);

  if (!discuss || !current) {
    return (
      <section
        class={`card ${styles.panel} ${styles.empty}`}
        aria-label={copy.discuss.currentTopic}
      >
        <h2>{copy.discuss.nothingHeading}</h2>
        <p>{copy.board.noItemsWritten}</p>
      </section>
    );
  }

  const { group } = current;
  const total = discuss.order.length;
  const position = copy.discuss.position(current.index + 1, total);
  const isLast = current.index >= total - 1;
  const live = store.isLive.value;

  return (
    <section class={`card ${styles.panel}`} aria-labelledby="discuss-current">
      <p class="visually-hidden" aria-live="polite">
        {copy.discuss.nowDiscussing(position.toLowerCase(), current.label)}
      </p>
      <GroupDetails
        group={current}
        categories={room.categories}
        votes={current.votes}
        headingLevel="h2"
        headingId="discuss-current"
        eyebrow={position}
      />
      {room.isOwner ? (
        <div class={styles.nav}>
          <button
            type="button"
            class="btn"
            disabled={!live || current.index === 0}
            onClick={() => store.prev(current.index)}
          >
            {copy.discuss.previous}
          </button>
          <button
            type="button"
            class="btn btn-ghost"
            disabled={!live}
            onClick={() => store.skip(current.index)}
          >
            {copy.discuss.skip}
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!live || isLast}
            onClick={() => store.next(current.index)}
          >
            {copy.discuss.next}
          </button>
          {isLast && <p class={styles.navHint}>{copy.discuss.lastTopic}</p>}
        </div>
      ) : (
        <p class={styles.follow}>{copy.discuss.follow}</p>
      )}
      <div class={styles.lists} key={group.id}>
        <CommentList
          groupId={group.id}
          comments={room.comments.filter((entry) => entry.groupId === group.id)}
          editable
        />
        <ActionList
          groupId={group.id}
          actions={room.actions.filter((entry) => entry.groupId === group.id)}
          editable
        />
      </div>
    </section>
  );
}
