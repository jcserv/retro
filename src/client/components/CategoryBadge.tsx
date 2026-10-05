import type { Category } from "../../shared/protocol";
import styles from "./CategoryBadge.module.css";
import { categoryColorStyle } from "./CategoryColumn";

export function CategoryBadge({ category, index }: { category?: Category; index: number }) {
  return (
    <span class={styles.badge} style={categoryColorStyle(index)}>
      <span class={styles.dot} aria-hidden="true" />
      {category?.title ?? "Uncategorized"}
    </span>
  );
}
