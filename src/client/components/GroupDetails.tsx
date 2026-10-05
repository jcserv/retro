import type { Category } from "../../shared/protocol";
import { type BoardGroup, hasGroupHeading } from "../lib/board";
import { CategoryBadge } from "./CategoryBadge";
import styles from "./GroupDetails.module.css";

type GroupDetailsProps = {
  group: BoardGroup;
  categories: readonly Category[];
  votes: number;
  headingLevel: "h2" | "h3";
  headingId?: string;
  eyebrow?: string;
};

export function GroupDetails({
  group,
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
        <CategoryBadge category={categories[group.categoryIndex]} index={group.categoryIndex} />
        <span class="badge badge-accent">
          {votes} {votes === 1 ? "vote" : "votes"}
        </span>
      </div>
      <Heading id={headingId} class={`user-text ${styles.title}`}>
        {group.label}
      </Heading>
      {hasGroupHeading(group) && (
        <ul class={styles.items} aria-label="Items">
          {group.items.map((entry) => (
            <li key={entry.id} class="user-text">
              {entry.text}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
