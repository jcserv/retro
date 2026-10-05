import type { ComponentChildren } from "preact";
import type { BoardColumn } from "../lib/board";
import { DROP_ATTRIBUTE } from "../lib/pointerDrag";
import styles from "./CategoryColumn.module.css";

type CategoryColumnProps = {
  column: BoardColumn;
  dropKey?: string;
  children: ComponentChildren;
};

export function categoryColorStyle(index: number) {
  const slot = index % 5;
  return {
    "--category-color": `var(--category-${slot})`,
    "--category-color-subtle": `var(--category-${slot}-subtle)`,
  };
}

export function CategoryColumn({ column, dropKey, children }: CategoryColumnProps) {
  const headingId = `category-${column.category.id}`;
  const { itemCount, groups } = column;
  return (
    <section
      class={styles.column}
      style={categoryColorStyle(column.index)}
      aria-labelledby={headingId}
      {...{ [DROP_ATTRIBUTE]: dropKey }}
    >
      <header class={styles.header}>
        <h2 id={headingId} class={styles.title}>
          {column.category.title}
        </h2>
        <span class={styles.count}>
          {itemCount} {itemCount === 1 ? "item" : "items"}
          <span class="visually-hidden">
            {` in ${groups.length} ${groups.length === 1 ? "group" : "groups"}`}
          </span>
        </span>
      </header>
      {groups.length > 0 ? (
        <ul class={styles.list}>{children}</ul>
      ) : (
        <p class={styles.empty}>No items</p>
      )}
      {dropKey && (
        <p class={styles.dropHint} aria-hidden="true">
          Drop here to ungroup
        </p>
      )}
    </section>
  );
}
