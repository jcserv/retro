import { copy } from "../copy";
import styles from "./VoteBudget.module.css";

export function VoteBudget({ used, limit }: { used: number; limit: number }) {
  const left = Math.max(0, limit - used);
  return (
    <div class={styles.budget}>
      <p class={styles.label} role="status" aria-live="polite">
        <strong>{left}</strong>
        {copy.vote.budget(limit)}
      </p>
      <span class={styles.pips} aria-hidden="true">
        {Array.from({ length: limit }, (_, index) => (
          <span key={index} class={styles.pip} data-used={index >= left ? "true" : undefined} />
        ))}
      </span>
    </div>
  );
}
