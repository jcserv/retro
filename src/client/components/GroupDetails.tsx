import type { Category } from "../../shared/protocol";
import { type BoardGroup, hasGroupHeading } from "../lib/board";
import { CategoryBadge } from "./CategoryBadge";
import { categoryColorStyle } from "./CategoryColumn";
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
  const categoryIndex = (categoryId: string) => {
    const index = categories.findIndex((category) => category.id === categoryId);
    return index === -1 ? group.categoryIndex : index;
  };
  const itemCategories = [...new Set(group.items.map((entry) => categoryIndex(entry.categoryId)))];
  const shownCategories = itemCategories.length > 0 ? itemCategories : [group.categoryIndex];
  const mixed = shownCategories.length > 1;

  return (
    <div class={styles.details}>
      <div class={styles.meta}>
        {eyebrow && <span class={styles.eyebrow}>{eyebrow}</span>}
        {shownCategories.map((index) => (
          <CategoryBadge key={index} category={categories[index]} index={index} />
        ))}
        <span class="badge badge-accent">
          {votes} {votes === 1 ? "vote" : "votes"}
        </span>
      </div>
      <Heading id={headingId} class={`user-text ${styles.title}`}>
        {group.label}
      </Heading>
      {hasGroupHeading(group) && (
        <ul class={`${styles.items} ${mixed ? styles.mixed : ""}`} aria-label="Items">
          {group.items.map((entry) => {
            const index = categoryIndex(entry.categoryId);
            return (
              <li key={entry.id} class={styles.item} style={categoryColorStyle(index)}>
                {mixed && (
                  <span class={styles.dot} title={categories[index]?.title}>
                    <span class="visually-hidden">
                      {categories[index]?.title ?? "Uncategorized"}:{" "}
                    </span>
                  </span>
                )}
                <span class="user-text">{entry.text}</span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
