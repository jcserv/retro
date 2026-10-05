import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { ItemView } from "../../shared/protocol";
import type { BoardColumn, BoardGroup } from "../lib/board";
import styles from "./GroupWithMenu.module.css";
import { Icon } from "./Icon";

export type GroupWithSubject =
  | { kind: "group"; group: BoardGroup }
  | { kind: "item"; item: ItemView };

type GroupWithMenuProps = {
  subject: GroupWithSubject | null;
  columns: readonly BoardColumn[];
  onPick: (targetGroupId: string) => void;
  onClose: () => void;
};

function matches(entry: BoardGroup, query: string): boolean {
  if (query === "") return true;
  const needle = query.toLocaleLowerCase();
  return [entry.label, ...entry.items.map((item) => item.text)].some((text) =>
    text.toLocaleLowerCase().includes(needle),
  );
}

export function GroupWithMenu({ subject, columns, onPick, onClose }: GroupWithMenuProps) {
  const dialogRef = useRef<HTMLDialogElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const open = subject !== null;
  const sourceGroupId = subject?.kind === "group" ? subject.group.group.id : subject?.item.groupId;

  useEffect(() => {
    const dialog = dialogRef.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      setQuery("");
      dialog.showModal();
      searchRef.current?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  const sections = useMemo(
    () =>
      columns
        .map((column) => ({
          column,
          groups: column.groups.filter(
            (entry) => !entry.pending && entry.group.id !== sourceGroupId && matches(entry, query),
          ),
        }))
        .filter((section) => section.groups.length > 0),
    [columns, sourceGroupId, query],
  );
  const first = sections[0]?.groups[0];
  const pick = (targetGroupId: string) => {
    dialogRef.current?.close();
    onPick(targetGroupId);
  };

  const heading =
    subject?.kind === "group"
      ? `Group “${subject.group.label}” with…`
      : subject
        ? `Move “${subject.item.text}” to…`
        : "";

  return (
    <dialog
      ref={dialogRef}
      class={styles.dialog}
      aria-labelledby="group-with-heading"
      closedby="any"
      onClose={onClose}
    >
      {open && (
        <div class={styles.panel}>
          <div class={styles.top}>
            <h2 id="group-with-heading" class={`${styles.heading} user-text`}>
              {heading}
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
          <input
            ref={searchRef}
            class="input"
            type="search"
            aria-label="Search groups"
            placeholder="Search groups"
            value={query}
            onInput={(event) => setQuery(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && first) {
                event.preventDefault();
                pick(first.group.id);
              }
            }}
          />
          <div class={styles.results}>
            {sections.length === 0 ? (
              <p class={styles.empty}>
                {query === "" ? "There are no other groups yet." : "No groups match your search."}
              </p>
            ) : (
              sections.map(({ column, groups }) => (
                <section
                  key={column.category.id}
                  class={styles.section}
                  aria-label={column.category.title}
                >
                  <h3 class={styles.sectionTitle}>{column.category.title}</h3>
                  <ul class={styles.options}>
                    {groups.map((entry) => (
                      <li key={entry.group.id}>
                        <button
                          type="button"
                          class={styles.option}
                          onClick={() => pick(entry.group.id)}
                        >
                          <span class={`${styles.optionLabel} user-text`}>{entry.label}</span>
                          {entry.items.length > 1 && (
                            <span class="badge">{entry.items.length} items</span>
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              ))
            )}
          </div>
        </div>
      )}
    </dialog>
  );
}
