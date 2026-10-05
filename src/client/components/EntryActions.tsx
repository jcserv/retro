import type { Ref } from "preact";
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
}: EntryActionsProps) {
  return (
    <div class={`${styles.actions} ${className ?? ""}`}>
      <button
        ref={editRef}
        type="button"
        class="btn btn-ghost btn-sm btn-icon"
        aria-label={`Edit ${noun}`}
        aria-describedby={describedBy}
        title="Edit"
        disabled={editDisabled}
        onClick={onEdit}
      >
        <Icon name="pencil" />
      </button>
      <button
        type="button"
        class={`btn btn-ghost btn-sm btn-icon ${styles.delete}`}
        aria-label={`Delete ${noun}`}
        aria-describedby={describedBy}
        title="Delete"
        disabled={deleteDisabled}
        onClick={onDelete}
      >
        <Icon name="trash" />
      </button>
    </div>
  );
}
