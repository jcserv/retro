import { LIMITS } from "../../shared/constants";
import type { CommentView } from "../../shared/protocol";
import { copy } from "../copy";
import { useRoomStore } from "../state/roomContext";
import type { IntentResult } from "../state/roomStore";
import styles from "./Discussion.module.css";
import { EntryActions } from "./EntryActions";
import { Icon } from "./Icon";
import { ItemComposer } from "./ItemComposer";
import { useEntryEditor, useSectionFocus } from "./useEntryEditor";

const MAX = LIMITS.commentTextMax;
const OK: IntentResult = { ok: true };

type CommentListProps = {
  groupId: string;
  comments: readonly CommentView[];
  editable: boolean;
};

export function CommentList({ groupId, comments, editable }: CommentListProps) {
  const headingId = `comments-${groupId}`;
  const sorted = [...comments].sort((a, b) => a.createdAt - b.createdAt);
  const focus = useSectionFocus();
  return (
    <section ref={focus.section} class={styles.section} aria-labelledby={headingId}>
      <h3 ref={focus.heading} id={headingId} class={styles.heading} tabIndex={-1}>
        {copy.comments.heading} <span class="badge">{sorted.length}</span>
      </h3>
      {sorted.length === 0 ? (
        <p class={styles.empty}>{editable ? copy.comments.emptyEditable : copy.comments.empty}</p>
      ) : (
        <ul class={styles.list}>
          {sorted.map((comment) => (
            <CommentRow
              key={comment.id}
              comment={comment}
              editable={editable}
              onDeleted={focus.focusComposer}
            />
          ))}
        </ul>
      )}
      {editable && <CommentComposer groupId={groupId} />}
    </section>
  );
}

type CommentRowProps = { comment: CommentView; editable: boolean; onDeleted: () => void };

function CommentRow({ comment, editable, onDeleted }: CommentRowProps) {
  const store = useRoomStore();
  const editor = useEntryEditor<true>();
  const live = store.isLive.value;
  const fitsAction = comment.text.length <= LIMITS.actionTextMax;

  if (editor.draft !== null) {
    return (
      <li class={styles.entry}>
        <div class={styles.form}>
          <ItemComposer
            label={copy.comments.edit}
            max={MAX}
            initialText={comment.text}
            submitLabel={copy.composer.save}
            disabled={!live}
            autoFocus
            onCancel={editor.cancel}
            onSubmit={(text) =>
              text === comment.text ? Promise.resolve(OK) : store.editComment(comment.id, text)
            }
          />
        </div>
      </li>
    );
  }

  return (
    <li class={styles.entry}>
      <div class={styles.body}>
        <p id={`comment-${comment.id}`} class="user-text">
          {comment.text}
        </p>
        <EntryMeta mine={comment.mine} edited={comment.updatedAt > comment.createdAt} />
      </div>
      {editable && comment.mine && (
        <EntryActions
          class={styles.entryActions}
          noun={copy.comments.noun}
          describedBy={`comment-${comment.id}`}
          editRef={editor.editButton}
          editDisabled={!live}
          deleteDisabled={!live || editor.busy}
          onEdit={() => editor.start(true)}
          onDelete={() => editor.remove(() => store.deleteComment(comment.id), onDeleted)}
        >
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-icon"
            aria-label={copy.comments.convertLabel}
            aria-describedby={`comment-${comment.id}`}
            title={
              fitsAction
                ? copy.comments.convert
                : copy.comments.tooLongToConvert(LIMITS.actionTextMax)
            }
            disabled={!live || editor.busy || !fitsAction}
            onClick={() => editor.remove(() => store.convertComment(comment.id), onDeleted)}
          >
            <Icon name="arrowRight" />
          </button>
        </EntryActions>
      )}
    </li>
  );
}

export function EntryMeta({ mine, edited }: { mine: boolean; edited: boolean }) {
  if (!mine && !edited) return null;
  return (
    <span class={styles.meta}>
      {mine && <span>{copy.entry.you}</span>}
      {mine && edited && <span aria-hidden="true">·</span>}
      {edited && <span>{copy.entry.edited}</span>}
    </span>
  );
}

function CommentComposer({ groupId }: { groupId: string }) {
  const store = useRoomStore();
  return (
    <ItemComposer
      label={copy.comments.add}
      max={MAX}
      placeholder={copy.comments.addPlaceholder}
      submitLabel={copy.comments.submit}
      disabled={!store.isLive.value}
      onSubmit={(text) => store.addComment(groupId, text)}
    />
  );
}
