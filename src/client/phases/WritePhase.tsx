import { useState } from "preact/hooks";
import { LIMITS } from "../../shared/constants";
import type { Category, ItemView } from "../../shared/protocol";
import { EntryActions } from "../components/EntryActions";
import { ItemComposer } from "../components/ItemComposer";
import { copy } from "../copy";
import { useRoomStore } from "../state/roomContext";
import styles from "./WritePhase.module.css";

export function WritePhase() {
  const store = useRoomStore();
  const room = store.room.value;
  if (!room) return null;

  const mine = room.items.toSorted((a, b) => a.createdAt - b.createdAt);
  const atLimit = mine.length >= LIMITS.itemsPerClient;

  return (
    <section class={styles.phase} aria-labelledby="write-heading">
      <div class={styles.intro}>
        <h2 id="write-heading" class="visually-hidden">
          {copy.write.heading}
        </h2>
        <p class={styles.lead}>{copy.write.lead}</p>
        <span class={`badge ${atLimit ? "badge-warning" : ""} ${styles.myCount}`}>
          {copy.write.itemsWritten(mine.length, LIMITS.itemsPerClient)}
        </span>
      </div>
      <div class={styles.columns}>
        {room.categories.map((category, index) => (
          <WriteColumn
            key={category.id}
            category={category}
            colorIndex={index % 5}
            total={room.categoryCounts[category.id] ?? 0}
            items={mine.filter((item) => item.categoryId === category.id)}
            atLimit={atLimit}
          />
        ))}
      </div>
    </section>
  );
}

type WriteColumnProps = {
  category: Category;
  colorIndex: number;
  total: number;
  items: ItemView[];
  atLimit: boolean;
};

function WriteColumn({ category, colorIndex, total, items, atLimit }: WriteColumnProps) {
  const store = useRoomStore();
  const headingId = `column-${category.id}`;
  return (
    <section
      class={`card ${styles.column}`}
      style={{
        "--column-accent": `var(--category-${colorIndex})`,
        "--column-accent-subtle": `var(--category-${colorIndex}-subtle)`,
      }}
      aria-labelledby={headingId}
    >
      <header class={styles.columnHeader}>
        <h3 id={headingId} class={styles.columnTitle}>
          {category.title}
        </h3>
        <span class={`badge ${styles.total}`} title={copy.write.totalTitle}>
          {copy.write.total(total)}
        </span>
      </header>
      {items.length > 0 && (
        <ul class={styles.items} aria-label={copy.write.yourItems(category.title)}>
          {items.map((item) => (
            <WriteItem key={item.id} item={item} />
          ))}
        </ul>
      )}
      <ItemComposer
        label={copy.write.addItemLabel(category.title)}
        max={LIMITS.itemTextMax}
        submitLabel={copy.write.add}
        placeholder={copy.write.addPlaceholder}
        disabled={!store.isLive.value || atLimit}
        disabledHint={atLimit ? copy.write.itemLimit : undefined}
        onSubmit={(text) => store.addItem(category.id, text)}
      />
    </section>
  );
}

function WriteItem({ item }: { item: ItemView }) {
  const store = useRoomStore();
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const live = store.isLive.value;

  if (editing) {
    return (
      <li class={styles.item}>
        <ItemComposer
          label={copy.write.editItem}
          max={LIMITS.itemTextMax}
          submitLabel={copy.composer.save}
          initialText={item.text}
          disabled={!live}
          autoFocus
          onCancel={() => setEditing(false)}
          onSubmit={(text) => store.editItem(item.id, text)}
        />
      </li>
    );
  }

  async function remove() {
    setDeleting(true);
    const result = await store.deleteItem(item.id);
    if (!result.ok) setDeleting(false);
  }

  return (
    <li class={styles.item} data-deleting={deleting ? "true" : undefined}>
      <p id={`item-${item.id}`} class={`user-text ${styles.itemText}`}>
        {item.text}
      </p>
      <EntryActions
        class={styles.itemActions}
        noun={copy.write.itemNoun}
        describedBy={`item-${item.id}`}
        editDisabled={!live || deleting}
        deleteDisabled={!live || deleting}
        onEdit={() => setEditing(true)}
        onDelete={remove}
      />
    </li>
  );
}
