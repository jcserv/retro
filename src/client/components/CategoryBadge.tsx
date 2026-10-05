import type { Category } from "../../shared/protocol";
import { categoryTone } from "../lib/groups";
import styles from "./CategoryBadge.module.css";

export function toneStyle(categories: readonly Category[], categoryId: string): string {
  const tone = categoryTone(categories, categoryId);
  return `--tone: var(--category-${tone}); --tone-subtle: var(--category-${tone}-subtle);`;
}

export function CategoryBadge({
  categories,
  categoryId,
}: {
  categories: readonly Category[];
  categoryId: string;
}) {
  const title = categories.find((entry) => entry.id === categoryId)?.title ?? "Uncategorized";
  return (
    <span class={styles.badge} style={toneStyle(categories, categoryId)}>
      <span class={styles.dot} aria-hidden="true" />
      {title}
    </span>
  );
}
