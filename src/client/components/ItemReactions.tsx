import dataSource from "emoji-picker-element-data/en/emojibase/data.json?url";
import { useEffect, useRef, useState } from "preact/hooks";
import { normalizeEmoji } from "../../shared/emoji";
import type { ItemView, Phase } from "../../shared/protocol";
import { useRoomStore } from "../state/roomContext";
import { Icon } from "./Icon";
import styles from "./ItemReactions.module.css";

const REACTABLE_PHASES: readonly Phase[] = ["group", "vote", "discuss"];

export function ItemReactions({ item }: { item: ItemView }) {
  const store = useRoomStore();
  const [picking, setPicking] = useState(false);
  const phase = store.room.value?.phase;
  const reactable = phase !== undefined && REACTABLE_PHASES.includes(phase);
  const live = store.isLive.value;
  if (!reactable && item.reactions.length === 0) return null;

  const toggle = (emoji: string, mine: boolean) =>
    void (mine ? store.removeReaction(item.id, emoji) : store.addReaction(item.id, emoji));

  return (
    <div class={styles.reactions} data-no-drag>
      {item.reactions.map(({ emoji, count, mine }) =>
        reactable ? (
          <button
            key={emoji}
            type="button"
            class={styles.pill}
            aria-pressed={mine}
            aria-label={`${emoji} ${count}`}
            title={mine ? "Remove your reaction" : "React with this"}
            disabled={!live}
            onClick={() => toggle(emoji, mine)}
          >
            <span class={styles.emoji}>{emoji}</span>
            <span class={styles.count}>{count}</span>
          </button>
        ) : (
          <span key={emoji} class={styles.pill}>
            <span class={styles.emoji}>{emoji}</span>
            <span class={styles.count}>{count}</span>
          </span>
        ),
      )}
      {reactable && (
        <button
          type="button"
          class={`btn btn-ghost btn-sm btn-icon ${styles.add}`}
          aria-label="Add reaction"
          title="Add reaction"
          disabled={!live}
          onClick={() => setPicking(true)}
        >
          <Icon name="smilePlus" size={14} />
        </button>
      )}
      {picking && (
        <EmojiPickerDialog
          itemText={item.text}
          onPick={(emoji) => {
            const existing = item.reactions.find((reaction) => reaction.emoji === emoji);
            if (!existing?.mine) void store.addReaction(item.id, emoji);
          }}
          onClose={() => setPicking(false)}
        />
      )}
    </div>
  );
}

type EmojiPickerDialogProps = {
  itemText: string;
  onPick: (emoji: string) => void;
  onClose: () => void;
};

function EmojiPickerDialog({ itemText, onPick, onClose }: EmojiPickerDialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const hostRef = useRef<HTMLDivElement>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;

  useEffect(() => {
    dialogRef.current?.showModal();
    let disposed = false;
    let picker: HTMLElement | null = null;
    void import("emoji-picker-element").then(({ Picker }) => {
      if (disposed || !hostRef.current) return;
      const created = new Picker({ dataSource });
      created.addEventListener("emoji-click", (event) => {
        const unicode = event.detail.unicode;
        if (!unicode) return;
        onPickRef.current(normalizeEmoji(unicode));
        dialogRef.current?.close();
      });
      hostRef.current.append(created);
      picker = created;
      requestAnimationFrame(() => {
        created.shadowRoot?.querySelector<HTMLInputElement>("input[type=search]")?.focus();
      });
    });
    return () => {
      disposed = true;
      picker?.remove();
    };
  }, []);

  return (
    <dialog
      ref={dialogRef}
      class={styles.dialog}
      aria-labelledby="reaction-picker-heading"
      closedby="any"
      onClose={onClose}
    >
      <div class={styles.top}>
        <h2 id="reaction-picker-heading" class={`${styles.heading} user-text`}>
          React to “{itemText}”
        </h2>
        <button
          type="button"
          class="btn btn-ghost btn-sm btn-icon"
          aria-label="Close"
          onClick={() => dialogRef.current?.close()}
        >
          <Icon name="close" size={14} />
        </button>
      </div>
      <div ref={hostRef} class={styles.picker} />
    </dialog>
  );
}
