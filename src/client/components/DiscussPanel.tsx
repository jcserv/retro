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
      <section class={`card ${styles.panel} ${styles.empty}`} aria-label="Current topic">
        <h2>Nothing to discuss</h2>
        <p>No items were written in this retro.</p>
      </section>
    );
  }

  const { group } = current;
  const total = discuss.order.length;
  const position = `Topic ${current.index + 1} of ${total}`;
  const isLast = current.index >= total - 1;
  const live = store.isLive.value;

  return (
    <section class={`card ${styles.panel}`} aria-labelledby="discuss-current">
      <p class="visually-hidden" aria-live="polite">
        Now discussing {position.toLowerCase()}: {current.label}
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
            Previous
          </button>
          <button
            type="button"
            class="btn btn-ghost"
            disabled={!live}
            onClick={() => store.skip(current.index)}
          >
            Skip
          </button>
          <button
            type="button"
            class="btn btn-primary"
            disabled={!live || isLast}
            onClick={() => store.next(current.index)}
          >
            Next topic
          </button>
          {isLast && <p class={styles.navHint}>Last topic. Finish the retro when you're ready.</p>}
        </div>
      ) : (
        <p class={styles.follow}>The facilitator moves everyone to the next topic.</p>
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
