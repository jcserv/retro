import type { ComponentChildren } from "preact";
import type { GroupView } from "../../shared/protocol";
import { groupItems, groupTitle, itemsById, listsItems } from "../lib/groups";
import type { RoomState } from "../state/roomState";
import { toneStyle } from "./CategoryBadge";
import styles from "./VoteBoard.module.css";

type VoteBoardProps = {
  room: RoomState;
  renderGroupFooter?: (group: GroupView, title: string) => ComponentChildren;
};

export function VoteBoard({ room, renderGroupFooter }: VoteBoardProps) {
  const items = itemsById(room.items);
  const firstItemAt = (group: GroupView) =>
    items.get(group.itemIds[0] ?? "")?.createdAt ?? group.createdAt;
  return (
    <div class={styles.board}>
      {room.categories.map((category) => {
        const groups = room.groups
          .filter((entry) => entry.categoryId === category.id)
          .sort((a, b) => a.createdAt - b.createdAt || firstItemAt(a) - firstItemAt(b));
        const headingId = `vote-column-${category.id}`;
        return (
          <section
            key={category.id}
            class={styles.column}
            style={toneStyle(room.categories, category.id)}
            aria-labelledby={headingId}
          >
            <header class={styles.columnHeader}>
              <h2 id={headingId} class={styles.columnTitle}>
                {category.title}
              </h2>
              <span class="badge" title={`${groups.length} groups`}>
                {groups.length}
              </span>
            </header>
            {groups.length === 0 ? (
              <p class={styles.empty}>Nothing here.</p>
            ) : (
              <ul class={styles.groups}>
                {groups.map((group) => {
                  const title = groupTitle(group, items);
                  return (
                    <li key={group.id} class={`card ${styles.group}`}>
                      <p class={`user-text ${styles.title}`}>{title}</p>
                      {listsItems(group, items) && (
                        <ul class={styles.items}>
                          {groupItems(group, items).map((entry) => (
                            <li key={entry.id} class="user-text">
                              {entry.text}
                            </li>
                          ))}
                        </ul>
                      )}
                      {renderGroupFooter && (
                        <div class={styles.footer}>{renderGroupFooter(group, title)}</div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}
