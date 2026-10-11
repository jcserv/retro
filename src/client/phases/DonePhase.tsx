import { ActionList, ActionMarker, AssigneeBadge, DueDateBadge } from "../components/ActionList";
import { CommentList } from "../components/CommentList";
import { ExportPanel } from "../components/ExportPanel";
import { GroupDetails } from "../components/GroupDetails";
import { copy } from "../copy";
import { type DiscussEntry, discussEntries } from "../lib/groups";
import { useRoomStore } from "../state/roomContext";
import type { RoomState } from "../state/roomState";
import styles from "./DonePhase.module.css";

export function DonePhase() {
  const room = useRoomStore().room.value;
  if (!room) return null;
  const entries = discussEntries(room);
  const discussed = entries.filter((entry) => entry.status === "discussed");
  const notDiscussed = entries.filter((entry) => entry.status !== "discussed");
  const titles = new Map(entries.map((entry) => [entry.group.id, entry.label]));
  const actions = entries.flatMap((entry) =>
    room.actions
      .filter((action) => action.groupId === entry.group.id)
      .sort((a, b) => a.createdAt - b.createdAt),
  );

  return (
    <div class={styles.done}>
      <section class={`card ${styles.summary}`} aria-labelledby="done-heading">
        <h1 id="done-heading" class={styles.heading}>
          {copy.done.heading}
        </h1>
        <p class={styles.stats}>
          {copy.done.stats(
            discussed.length,
            entries.length,
            actions.length,
            room.presence.participantCount,
          )}
        </p>
      </section>

      <ExportPanel />

      <section class={`card ${styles.block}`} aria-labelledby="done-actions">
        <h2 id="done-actions" class={styles.sectionHeading}>
          {copy.done.actionsHeading}
        </h2>
        {actions.length === 0 ? (
          <p class={styles.empty}>{copy.done.noActions}</p>
        ) : (
          <ul class={styles.actions}>
            {actions.map((action) => (
              <li key={action.id} class={styles.action}>
                <ActionMarker />
                <div class={styles.actionBody}>
                  <p class="user-text">{action.text}</p>
                  <div class={styles.actionMeta}>
                    <AssigneeBadge assignee={action.assignee} />
                    <DueDateBadge dueDate={action.dueDate} />
                    <span class={`user-text ${styles.from}`}>
                      <span class="visually-hidden">{copy.done.fromTopic}</span>
                      {titles.get(action.groupId)}
                    </span>
                  </div>
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      {discussed.length > 0 && (
        <TopicSection
          id="done-discussed"
          title={copy.done.discussed}
          entries={discussed}
          room={room}
          numbered
        />
      )}
      {notDiscussed.length > 0 && (
        <TopicSection
          id="done-not-discussed"
          title={copy.done.notDiscussed}
          entries={notDiscussed}
          room={room}
        />
      )}
    </div>
  );
}

type TopicSectionProps = {
  id: string;
  title: string;
  entries: readonly DiscussEntry[];
  room: RoomState;
  numbered?: boolean;
};

function TopicSection({ id, title, entries, room, numbered }: TopicSectionProps) {
  return (
    <section class={styles.topics} aria-labelledby={id}>
      <h2 id={id} class={styles.sectionHeading}>
        {title}
      </h2>
      <ol class={styles.topicList}>
        {entries.map((entry, position) => {
          const comments = room.comments.filter((c) => c.groupId === entry.group.id);
          const actions = room.actions.filter((a) => a.groupId === entry.group.id);
          return (
            <li key={entry.group.id} class={`card ${styles.topic}`}>
              <GroupDetails
                group={entry}
                categories={room.categories}
                votes={entry.votes}
                headingLevel="h3"
                eyebrow={
                  numbered
                    ? copy.done.topic(position + 1)
                    : entry.status === "skipped"
                      ? copy.done.skipped
                      : undefined
                }
              />
              {(numbered || comments.length > 0 || actions.length > 0) && (
                <div class={styles.lists}>
                  <CommentList groupId={entry.group.id} comments={comments} editable={false} />
                  <ActionList groupId={entry.group.id} actions={actions} editable={false} />
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </section>
  );
}
