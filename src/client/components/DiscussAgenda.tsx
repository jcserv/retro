import type { DiscussStatus } from "../../shared/protocol";
import type { DiscussEntry } from "../lib/groups";
import styles from "./DiscussAgenda.module.css";

const STATUS_LABELS: Record<DiscussStatus, string> = {
  pending: "Up next",
  discussed: "Discussed",
  skipped: "Skipped",
};

export function DiscussAgenda({
  entries,
  currentIndex,
  onSelect,
  disabled = false,
}: {
  entries: readonly DiscussEntry[];
  currentIndex: number;
  onSelect?: (index: number) => void;
  disabled?: boolean;
}) {
  return (
    <aside class={`card ${styles.agenda}`} aria-labelledby="discuss-agenda">
      <h2 id="discuss-agenda" class={styles.heading}>
        Agenda
      </h2>
      <ol class={styles.list}>
        {entries.map((entry) => {
          const isCurrent = entry.index === currentIndex;
          const content = (
            <>
              <span class={styles.marker} aria-hidden="true">
                {entry.index + 1}
              </span>
              <span class={`user-text ${styles.title}`}>{entry.label}</span>
              <span class={styles.votes}>
                {entry.votes}
                <span class="visually-hidden"> {entry.votes === 1 ? "vote" : "votes"}</span>
              </span>
              <span class="visually-hidden">
                , {isCurrent ? "current topic" : STATUS_LABELS[entry.status]}
              </span>
            </>
          );
          return (
            <li
              key={entry.group.id}
              class={styles.item}
              data-status={entry.status}
              data-current={isCurrent ? "true" : undefined}
              aria-current={isCurrent ? "step" : undefined}
            >
              {onSelect && !isCurrent ? (
                <button
                  type="button"
                  class={styles.entry}
                  disabled={disabled}
                  onClick={() => onSelect(entry.index)}
                >
                  {content}
                </button>
              ) : (
                <div class={styles.entry}>{content}</div>
              )}
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
