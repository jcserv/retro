import { useMemo, useState } from "preact/hooks";
import { buildBoard } from "../lib/board";
import { type ResolvedSuggestion, resolveSuggestion } from "../lib/suggestions";
import { useRoomStore } from "../state/roomContext";
import { Icon } from "./Icon";
import styles from "./SuggestionsPanel.module.css";

type Dismissed = { setId: string; indexes: ReadonlySet<number> };

export function SuggestionsPanel() {
  const store = useRoomStore();
  const room = store.room.value;
  const set = room?.suggestions?.set ?? null;
  const [dismissed, setDismissed] = useState<Dismissed | null>(null);
  const [sending, setSending] = useState(false);
  const labels = useMemo(() => {
    const map = new Map<string, string>();
    if (!room) return map;
    for (const column of buildBoard(room)) {
      for (const entry of column.groups) map.set(entry.group.id, entry.label);
    }
    return map;
  }, [room]);

  if (!room || !set) return null;
  const hidden = dismissed?.setId === set.id ? dismissed.indexes : new Set<number>();
  const visible = set.entries
    .filter((entry) => entry.status === "pending" && !hidden.has(entry.index))
    .map((entry) => resolveSuggestion(room, entry));
  const acceptable = visible.filter((suggestion) => !suggestion.stale);
  if (set.entries.length > 0 && visible.length === 0) return null;

  const dismiss = (indexes: readonly number[]) =>
    setDismissed({ setId: set.id, indexes: new Set([...hidden, ...indexes]) });

  async function accept(indexes: number[]) {
    if (!set) return;
    setSending(true);
    await store.applySuggestions(set.id, indexes);
    setSending(false);
  }

  const disabled = sending || !store.isLive.value;

  return (
    <section class={`card ${styles.panel}`} aria-labelledby="suggestions-heading">
      <header class={styles.header}>
        <div class={styles.titles}>
          <h3 id="suggestions-heading" class={styles.title}>
            Suggested groups
          </h3>
          <p class={styles.description}>
            {visible.length === 0
              ? "No suggestions for this board."
              : "Review each suggestion. Nothing changes until you accept it."}
          </p>
        </div>
        <div class={styles.headerActions}>
          {acceptable.length > 0 && (
            <button
              type="button"
              class="btn btn-primary btn-sm"
              disabled={disabled}
              onClick={() => accept(acceptable.map((s) => s.entry.index))}
            >
              Accept all
            </button>
          )}
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-icon"
            aria-label="Close suggestions"
            onClick={() => dismiss(set.entries.map((entry) => entry.index))}
          >
            <Icon name="close" />
          </button>
        </div>
      </header>
      {visible.length > 0 && (
        <ul class={styles.list}>
          {visible.map((suggestion) => (
            <SuggestionCard
              key={suggestion.entry.index}
              suggestion={suggestion}
              targetLabel={
                suggestion.target.kind === "existing"
                  ? (labels.get(suggestion.target.groupId) ?? "group")
                  : null
              }
              disabled={disabled}
              onAccept={() => accept([suggestion.entry.index])}
              onDismiss={() => dismiss([suggestion.entry.index])}
            />
          ))}
        </ul>
      )}
    </section>
  );
}

function SuggestionCard({
  suggestion,
  targetLabel,
  disabled,
  onAccept,
  onDismiss,
}: {
  suggestion: ResolvedSuggestion;
  targetLabel: string | null;
  disabled: boolean;
  onAccept: () => void;
  onDismiss: () => void;
}) {
  const { entry, items, target, stale } = suggestion;
  const destination =
    target.kind === "new"
      ? "New group"
      : target.kind === "missing"
        ? "Group no longer exists"
        : `Add to “${targetLabel}”`;
  const headingId = `suggestion-${entry.index}`;

  return (
    <li class={styles.suggestion} aria-labelledby={headingId} data-stale={stale || undefined}>
      <div class={styles.suggestionHeader}>
        <h4 id={headingId} class={styles.suggestionTitle}>
          {entry.title ?? (target.kind === "new" ? "Untitled group" : targetLabel)}
        </h4>
        <span class={styles.destination}>{destination}</span>
      </div>
      {items.length > 0 && (
        <ul class={styles.items}>
          {items.map((item) => (
            <li key={item.id} class={styles.item} data-unavailable={!item.available || undefined}>
              {item.available ? (
                item.text
              ) : (
                <>
                  <s>{item.text}</s>
                  <span class="visually-hidden"> (already grouped)</span>
                </>
              )}
            </li>
          ))}
        </ul>
      )}
      <div class={styles.actions}>
        {stale && <span class="badge badge-warning">Out of date</span>}
        <button type="button" class="btn btn-ghost btn-sm" onClick={onDismiss}>
          Dismiss
        </button>
        <button
          type="button"
          class="btn btn-subtle btn-sm"
          disabled={disabled || stale}
          onClick={onAccept}
        >
          Accept
        </button>
      </div>
    </li>
  );
}
