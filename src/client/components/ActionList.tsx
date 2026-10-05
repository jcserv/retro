import { useId, useState } from "preact/hooks";
import { LIMITS } from "../../shared/constants";
import type { ActionView } from "../../shared/protocol";
import { textLength } from "../lib/format";
import { useRoomStore } from "../state/roomContext";
import { CharCount } from "./CharCount";
import { EntryMeta } from "./CommentList";
import styles from "./Discussion.module.css";
import { Icon } from "./Icon";
import { ItemComposer } from "./ItemComposer";
import { useEntryEditor, useSectionFocus } from "./useEntryEditor";

const TEXT_MAX = LIMITS.actionTextMax;
const ASSIGNEE_MAX = LIMITS.assigneeMax;

type ActionListProps = {
  groupId: string;
  actions: readonly ActionView[];
  editable: boolean;
};

export function ActionList({ groupId, actions, editable }: ActionListProps) {
  const headingId = `actions-${groupId}`;
  const sorted = [...actions].sort((a, b) => a.createdAt - b.createdAt);
  const focus = useSectionFocus();
  return (
    <section ref={focus.section} class={styles.section} aria-labelledby={headingId}>
      <h3 ref={focus.heading} id={headingId} class={styles.heading} tabIndex={-1}>
        Action items <span class="badge">{sorted.length}</span>
      </h3>
      {sorted.length === 0 ? (
        <p class={styles.empty}>{editable ? "No action items yet." : "No action items."}</p>
      ) : (
        <ul class={styles.list}>
          {sorted.map((action) => (
            <ActionRow
              key={action.id}
              action={action}
              editable={editable}
              onDeleted={focus.focusComposer}
            />
          ))}
        </ul>
      )}
      {editable && <ActionComposer groupId={groupId} />}
    </section>
  );
}

export function AssigneeBadge({ assignee }: { assignee: string | null }) {
  if (!assignee) return null;
  return (
    <span class={`badge ${styles.assignee}`}>
      <span class="visually-hidden">Assigned to </span>
      <span class="user-text">{assignee}</span>
    </span>
  );
}

export function ActionMarker() {
  return (
    <span class={styles.marker}>
      <Icon name="arrowRight" />
    </span>
  );
}

type ActionRowProps = { action: ActionView; editable: boolean; onDeleted: () => void };

function ActionRow({ action, editable, onDeleted }: ActionRowProps) {
  const store = useRoomStore();
  const editor = useEntryEditor<string>();
  const live = store.isLive.value;

  if (editor.draft !== null) {
    const assignee = editor.draft;
    return (
      <li class={styles.entry}>
        <div class={styles.form}>
          <ItemComposer
            label="Edit action item"
            max={TEXT_MAX}
            initialText={action.text}
            submitLabel="Save"
            disabled={!live}
            autoFocus
            extraInvalid={!assigneeFits(assignee)}
            onCancel={editor.cancel}
            onSubmit={(text) => store.editAction(action.id, text, assignee.trim())}
          >
            <AssigneeField
              label="Edit assignee"
              value={assignee}
              disabled={!live}
              onChange={editor.update}
              onCancel={editor.cancel}
            />
          </ItemComposer>
        </div>
      </li>
    );
  }

  return (
    <li class={styles.entry}>
      <ActionMarker />
      <div class={styles.body}>
        <p class="user-text">{action.text}</p>
        <div class={styles.metaRow}>
          <AssigneeBadge assignee={action.assignee} />
          <EntryMeta mine={action.mine} edited={action.updatedAt > action.createdAt} />
        </div>
      </div>
      {editable && action.mine && (
        <div class={styles.entryActions}>
          <button
            ref={editor.editButton}
            type="button"
            class="btn btn-ghost btn-sm"
            aria-label="Edit action item"
            disabled={!live}
            onClick={() => editor.start(action.assignee ?? "")}
          >
            Edit
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            aria-label="Delete action item"
            disabled={!live || editor.busy}
            onClick={() => editor.remove(() => store.deleteAction(action.id), onDeleted)}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

function assigneeFits(assignee: string): boolean {
  return textLength(assignee) <= ASSIGNEE_MAX;
}

function ActionComposer({ groupId }: { groupId: string }) {
  const store = useRoomStore();
  const [assignee, setAssignee] = useState("");
  const live = store.isLive.value;

  async function submit(text: string) {
    const sent = assignee;
    setAssignee("");
    const result = await store.addAction(groupId, text, sent.trim());
    if (!result.ok) setAssignee((current) => current || sent);
    return result;
  }

  return (
    <ItemComposer
      label="New action item"
      max={TEXT_MAX}
      placeholder="Add an action item…"
      submitLabel="Add action"
      disabled={!live}
      extraInvalid={!assigneeFits(assignee)}
      onSubmit={submit}
    >
      <AssigneeField label="Assignee" value={assignee} disabled={!live} onChange={setAssignee} />
    </ItemComposer>
  );
}

type AssigneeFieldProps = {
  label: string;
  value: string;
  disabled: boolean;
  onChange: (value: string) => void;
  onCancel?: () => void;
};

function AssigneeField({ label, value, disabled, onChange, onCancel }: AssigneeFieldProps) {
  const id = useId();
  return (
    <div class={styles.assigneeField}>
      <label class="visually-hidden" for={id}>
        {label}
      </label>
      <input
        id={id}
        class="input"
        placeholder="Assignee (optional)"
        value={value}
        disabled={disabled}
        aria-invalid={assigneeFits(value) ? undefined : "true"}
        onInput={(event) => onChange(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === "Escape" && onCancel) {
            event.preventDefault();
            onCancel();
          }
        }}
      />
      {value.trim() !== "" && <CharCount text={value} max={ASSIGNEE_MAX} />}
    </div>
  );
}
