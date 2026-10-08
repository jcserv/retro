import { useId, useState } from "preact/hooks";
import { LIMITS } from "../../shared/constants";
import type { ActionView } from "../../shared/protocol";
import { formatDueDate, textLength } from "../lib/format";
import { useRoomStore } from "../state/roomContext";
import type { ActionFields } from "../state/roomStore";
import { CharCount } from "./CharCount";
import { EntryMeta } from "./CommentList";
import styles from "./Discussion.module.css";
import { EntryActions } from "./EntryActions";
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

export function DueDateBadge({ dueDate }: { dueDate: string | null }) {
  if (!dueDate) return null;
  return (
    <span class="badge">
      Due <time dateTime={dueDate}>{formatDueDate(dueDate)}</time>
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
  const editor = useEntryEditor<ActionFields>();
  const live = store.isLive.value;

  if (editor.draft !== null) {
    const fields = editor.draft;
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
            extraInvalid={!assigneeFits(fields.assignee)}
            onCancel={editor.cancel}
            onSubmit={(text) => store.editAction(action.id, text, trimmed(fields))}
          >
            <ActionFieldInputs
              labelPrefix="Edit "
              value={fields}
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
        <p id={`action-${action.id}`} class="user-text">
          {action.text}
        </p>
        <div class={styles.metaRow}>
          <AssigneeBadge assignee={action.assignee} />
          <DueDateBadge dueDate={action.dueDate} />
          <EntryMeta mine={action.mine} edited={action.updatedAt > action.createdAt} />
        </div>
      </div>
      {editable && action.mine && (
        <EntryActions
          class={styles.entryActions}
          noun="action item"
          describedBy={`action-${action.id}`}
          editRef={editor.editButton}
          editDisabled={!live}
          deleteDisabled={!live || editor.busy}
          onEdit={() =>
            editor.start({ assignee: action.assignee ?? "", dueDate: action.dueDate ?? "" })
          }
          onDelete={() => editor.remove(() => store.deleteAction(action.id), onDeleted)}
        />
      )}
    </li>
  );
}

const EMPTY_FIELDS: ActionFields = { assignee: "", dueDate: "" };

function assigneeFits(assignee: string): boolean {
  return textLength(assignee) <= ASSIGNEE_MAX;
}

function trimmed(fields: ActionFields): ActionFields {
  return { ...fields, assignee: fields.assignee.trim() };
}

function ActionComposer({ groupId }: { groupId: string }) {
  const store = useRoomStore();
  const [fields, setFields] = useState(EMPTY_FIELDS);
  const live = store.isLive.value;

  async function submit(text: string) {
    const sent = fields;
    setFields(EMPTY_FIELDS);
    const result = await store.addAction(groupId, text, trimmed(sent));
    if (!result.ok) setFields((current) => (current === EMPTY_FIELDS ? sent : current));
    return result;
  }

  return (
    <ItemComposer
      label="New action item"
      max={TEXT_MAX}
      placeholder="Add an action item…"
      submitLabel="Add action"
      disabled={!live}
      extraInvalid={!assigneeFits(fields.assignee)}
      onSubmit={submit}
    >
      <ActionFieldInputs labelPrefix="" value={fields} disabled={!live} onChange={setFields} />
    </ItemComposer>
  );
}

type ActionFieldInputsProps = {
  labelPrefix: string;
  value: ActionFields;
  disabled: boolean;
  onChange: (value: ActionFields) => void;
  onCancel?: () => void;
};

function ActionFieldInputs({
  labelPrefix,
  value,
  disabled,
  onChange,
  onCancel,
}: ActionFieldInputsProps) {
  const assigneeId = useId();
  const dueDateId = useId();
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
  };
  return (
    <div class={styles.actionFields}>
      <div class={styles.assigneeField}>
        <label class="visually-hidden" for={assigneeId}>
          {labelPrefix ? `${labelPrefix}assignee` : "Assignee"}
        </label>
        <input
          id={assigneeId}
          class="input"
          placeholder="Assignee (optional)"
          value={value.assignee}
          disabled={disabled}
          aria-invalid={assigneeFits(value.assignee) ? undefined : "true"}
          onInput={(event) => onChange({ ...value, assignee: event.currentTarget.value })}
          onKeyDown={onKeyDown}
        />
        {value.assignee.trim() !== "" && <CharCount text={value.assignee} max={ASSIGNEE_MAX} />}
      </div>
      <label class={styles.dueDateField} for={dueDateId}>
        <span class={styles.dueDateLabel} aria-hidden="true">
          Due
        </span>
        <span class="visually-hidden">{labelPrefix ? `${labelPrefix}due date` : "Due date"}</span>
        <input
          id={dueDateId}
          type="date"
          class="input"
          value={value.dueDate}
          disabled={disabled}
          onInput={(event) => onChange({ ...value, dueDate: event.currentTarget.value })}
          onKeyDown={onKeyDown}
        />
      </label>
    </div>
  );
}
