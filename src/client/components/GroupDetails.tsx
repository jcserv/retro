import type { Category, GroupView } from "../../shared/protocol";
import { groupItems, groupTitle, type ItemsById, listsItems } from "../lib/groups";
import { CategoryBadge } from "./CategoryBadge";
import styles from "./GroupDetails.module.css";

type GroupDetailsProps = {
  group: GroupView;
  items: ItemsById;
  categories: readonly Category[];
  votes: number;
  headingLevel: "h2" | "h3";
  headingId?: string;
  eyebrow?: string;
};

export function GroupDetails({
  group,
  items,
  categories,
  votes,
  headingLevel: Heading,
  headingId,
  eyebrow,
}: GroupDetailsProps) {
  return (
    <div class={styles.details}>
      <div class={styles.meta}>
        {eyebrow && <span class={styles.eyebrow}>{eyebrow}</span>}
        <CategoryBadge categories={categories} categoryId={group.categoryId} />
        <span class="badge badge-accent">
          {votes} {votes === 1 ? "vote" : "votes"}
        </span>
      </div>
      <Heading id={headingId} class={`user-text ${styles.title}`}>
        {groupTitle(group, items)}
      </Heading>
      {listsItems(group, items) && (
        <ul class={styles.items} aria-label="Items">
          {groupItems(group, items).map((entry) => (
            <li key={entry.id} class="user-text">
              {entry.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
