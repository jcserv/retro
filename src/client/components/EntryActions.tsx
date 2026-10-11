import type { ComponentChildren, Ref } from "preact";
import { copy } from "../copy";
import styles from "./EntryActions.module.css";
import { Icon } from "./Icon";

type EntryActionsProps = {
  noun: string;
  describedBy: string;
  editRef?: Ref<HTMLButtonElement>;
  editDisabled: boolean;
  deleteDisabled: boolean;
  onEdit: () => void;
  onDelete: () => void;
  class?: string;
  children?: ComponentChildren;
};

export function EntryActions({
  noun,
  describedBy,
  editRef,
  editDisabled,
  deleteDisabled,
  onEdit,
  onDelete,
  class: className,
  children,
}: EntryActionsProps) {
  return (
    <div class={`${styles.actions} ${className ?? ""}`}>
      {children}
      <button
        ref={editRef}
        type="button"
        class="btn btn-ghost btn-sm btn-icon"
        aria-label={copy.entry.editLabel(noun)}
        aria-describedby={describedBy}
        title={copy.entry.edit}
        disabled={editDisabled}
        onClick={onEdit}
      >
        <Icon name="pencil" />
      </button>
      <button
        type="button"
        class={`btn btn-ghost btn-sm btn-icon ${styles.delete}`}
        aria-label={copy.entry.deleteLabel(noun)}
        aria-describedby={describedBy}
        title={copy.entry.delete}
        disabled={deleteDisabled}
        onClick={onDelete}
      >
        <Icon name="trash" />
      </button>
    </div>
  );
}
