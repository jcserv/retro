import type { ArticleHTMLAttributes, ComponentChildren, HTMLAttributes } from "preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { LIMITS } from "../../shared/constants";
import type { ItemView } from "../../shared/protocol";
import { type BoardGroup, hasGroupHeading } from "../lib/board";
import styles from "./GroupCard.module.css";
import { Icon } from "./Icon";

type GroupCardProps = Omit<ArticleHTMLAttributes<HTMLElement>, "title" | "children"> & {
  group: BoardGroup;
  heading?: ComponentChildren;
  actions?: ComponentChildren;
  itemActions?: (item: ItemView) => ComponentChildren;
  itemProps?: (item: ItemView) => HTMLAttributes<HTMLLIElement>;
};

export function GroupCard({
  group,
  heading,
  actions,
  itemActions,
  itemProps,
  class: className,
  ...rest
}: GroupCardProps) {
  const { items } = group;
  const showHeading = hasGroupHeading(group);
  const only = items.length === 1 ? items[0] : undefined;

  return (
    <article
      {...rest}
      class={`${styles.card} ${className ?? ""}`}
      data-group-card={group.group.id}
      aria-label={group.label}
    >
      {showHeading && (
        <div class={styles.heading}>
          {heading ?? <h3 class={`${styles.title} user-text`}>{group.label}</h3>}
          {items.length > 1 && <span class="badge">{items.length} items</span>}
        </div>
      )}
      {only && !showHeading ? (
        <p class={`${styles.text} user-text`}>{only.text}</p>
      ) : (
        <ul class={styles.items}>
          {items.map((entry) => (
            <li key={entry.id} {...itemProps?.(entry)} class={styles.item}>
              <span class={`${styles.itemText} user-text`}>{entry.text}</span>
              {itemActions && <span class={styles.itemActions}>{itemActions(entry)}</span>}
            </li>
          ))}
        </ul>
      )}
      {actions && <div class={styles.actions}>{actions}</div>}
    </article>
  );
}

type GroupTitleProps = {
  group: BoardGroup;
  disabled: boolean;
  onRename: (title: string) => void;
};

export function GroupTitle({ group, disabled, onRename }: GroupTitleProps) {
  const [draft, setDraft] = useState<string | null>(null);
  const editing = draft !== null;
  const open = useRef(false);
  const refocus = useRef(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const title = group.group.title;

  useLayoutEffect(() => {
    if (editing) {
      inputRef.current?.select();
    } else if (refocus.current) {
      refocus.current = false;
      buttonRef.current?.focus();
    }
  }, [editing]);

  const placeholder = group.items[0]?.text ?? "";

  if (draft === null) {
    return (
      <h3 class={styles.title}>
        <button
          ref={buttonRef}
          type="button"
          class={styles.titleButton}
          data-untitled={title === null ? "true" : undefined}
          disabled={disabled}
          onClick={() => {
            open.current = true;
            setDraft(title ?? "");
          }}
        >
          <span class="user-text">{group.label}</span>
          <span class="visually-hidden">, rename group</span>
          <span class={styles.pencil}>
            <Icon name="pencil" size={12} />
          </span>
        </button>
      </h3>
    );
  }

  const commit = () => {
    if (!open.current) return;
    open.current = false;
    const next = draft.trim();
    setDraft(null);
    if (next !== (title ?? "")) onRename(next);
  };

  return (
    <input
      ref={inputRef}
      class={`input ${styles.titleInput}`}
      aria-label="Group title"
      placeholder={placeholder}
      maxLength={LIMITS.groupTitleMax}
      value={draft}
      onInput={(event) => setDraft(event.currentTarget.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === "Enter") {
          event.preventDefault();
          refocus.current = true;
          commit();
        } else if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          open.current = false;
          refocus.current = true;
          setDraft(null);
        }
      }}
    />
  );
}
