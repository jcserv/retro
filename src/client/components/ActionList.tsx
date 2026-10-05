import { useState } from "preact/hooks";
import { LIMITS } from "../../shared/constants";
import type { ActionView } from "../../shared/protocol";
import { useRoomStore } from "../state/roomContext";
import { CharCount, fitsLimit } from "./CharCount";
import { EntryMeta } from "./CommentList";
import styles from "./Discussion.module.css";
import { useEntryEditor } from "./useEntryEditor";

const TEXT_MAX = LIMITS.actionTextMax;
const ASSIGNEE_MAX = LIMITS.assigneeMax;

type ActionDraft = { text: string; assignee: string };

function isValid(draft: ActionDraft): boolean {
  return (
    fitsLimit(draft.text, TEXT_MAX) &&
    (draft.assignee.trim() === "" || fitsLimit(draft.assignee, ASSIGNEE_MAX))
  );
}

type ActionListProps = {
  groupId: string;
  actions: readonly ActionView[];
  editable: boolean;
};

export function ActionList({ groupId, actions, editable }: ActionListProps) {
  const headingId = `actions-${groupId}`;
  const sorted = [...actions].sort((a, b) => a.createdAt - b.createdAt);
  return (
    <section class={styles.section} aria-labelledby={headingId}>
      <h3 id={headingId} class={styles.heading}>
        Action items <span class="badge">{sorted.length}</span>
      </h3>
      {sorted.length === 0 ? (
        <p class={styles.empty}>No action items yet.</p>
      ) : (
        <ul class={styles.list}>
          {sorted.map((action) => (
            <ActionRow key={action.id} action={action} editable={editable} />
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

function ActionRow({ action, editable }: { action: ActionView; editable: boolean }) {
  const store = useRoomStore();
  const editor = useEntryEditor<ActionDraft>();
  const live = store.isLive.value;

  if (editor.draft !== null) {
    const draft = editor.draft;
    return (
      <li class={styles.entry}>
        <ActionFields
          idPrefix={`action-edit-${action.id}`}
          labelPrefix="Edit"
          draft={draft}
          onChange={editor.update}
          onCancel={editor.cancel}
          onSubmit={() =>
            editor.save(() => store.editAction(action.id, draft.text.trim(), draft.assignee.trim()))
          }
          submitLabel="Save"
          disabled={!live || editor.busy}
          autoFocus
        />
      </li>
    );
  }

  return (
    <li class={styles.entry}>
      <span class={styles.checkbox} aria-hidden="true" />
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
            onClick={() => editor.start({ text: action.text, assignee: action.assignee ?? "" })}
          >
            Edit
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            aria-label="Delete action item"
            disabled={!live || editor.busy}
            onClick={() => editor.remove(() => store.deleteAction(action.id))}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

function ActionComposer({ groupId }: { groupId: string }) {
  const store = useRoomStore();
  const [draft, setDraft] = useState<ActionDraft>({ text: "", assignee: "" });
  const live = store.isLive.value;

  async function submit() {
    const value = { text: draft.text.trim(), assignee: draft.assignee.trim() };
    setDraft({ text: "", assignee: "" });
    const result = await store.addAction(groupId, value.text, value.assignee);
    if (!result.ok) {
      setDraft((current) => (current.text || current.assignee ? current : value));
    }
  }

  return (
    <ActionFields
      idPrefix={`action-new-${groupId}`}
      labelPrefix="New"
      draft={draft}
      onChange={setDraft}
      onSubmit={submit}
      submitLabel="Add action"
      disabled={!live}
    />
  );
}

type ActionFieldsProps = {
  idPrefix: string;
  labelPrefix: "New" | "Edit";
  draft: ActionDraft;
  onChange: (draft: ActionDraft) => void;
  onSubmit: () => void;
  onCancel?: () => void;
  submitLabel: string;
  disabled: boolean;
  autoFocus?: boolean;
};

function ActionFields({
  idPrefix,
  labelPrefix,
  draft,
  onChange,
  onSubmit,
  onCancel,
  submitLabel,
  disabled,
  autoFocus,
}: ActionFieldsProps) {
  const textId = `${idPrefix}-text`;
  const assigneeId = `${idPrefix}-assignee`;
  const valid = isValid(draft);
  const onKeyDown = (event: KeyboardEvent) => {
    if (event.key === "Escape" && onCancel) onCancel();
  };

  return (
    <form
      class={styles.form}
      onSubmit={(event) => {
        event.preventDefault();
        if (!disabled && valid) onSubmit();
      }}
    >
      <div class={styles.actionFields}>
        <div class={styles.field}>
          <label class="visually-hidden" for={textId}>
            {labelPrefix} action item
          </label>
          <input
            id={textId}
            class="input"
            placeholder={labelPrefix === "New" ? "Add an action item…" : undefined}
            value={draft.text}
            disabled={labelPrefix === "New" && disabled}
            // biome-ignore lint/a11y/noAutofocus: focus moves into the editor the user just opened
            autoFocus={autoFocus}
            onInput={(event) => onChange({ ...draft, text: event.currentTarget.value })}
            onKeyDown={onKeyDown}
          />
          <CharCount text={draft.text} max={TEXT_MAX} />
        </div>
        <div class={styles.field}>
          <label class="visually-hidden" for={assigneeId}>
            {labelPrefix === "New" ? "Assignee" : "Edit assignee"}
          </label>
          <input
            id={assigneeId}
            class="input"
            placeholder="Assignee (optional)"
            value={draft.assignee}
            disabled={labelPrefix === "New" && disabled}
            onInput={(event) => onChange({ ...draft, assignee: event.currentTarget.value })}
            onKeyDown={onKeyDown}
          />
          {draft.assignee.trim() !== "" && <CharCount text={draft.assignee} max={ASSIGNEE_MAX} />}
        </div>
      </div>
      <div class={styles.formFooter}>
        {onCancel && (
          <button type="button" class="btn btn-ghost btn-sm" onClick={onCancel}>
            Cancel
          </button>
        )}
        <button type="submit" class="btn btn-primary btn-sm" disabled={disabled || !valid}>
          {submitLabel}
        </button>
      </div>
    </form>
  );
}
