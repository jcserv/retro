import { LIMITS } from "../../shared/constants";
import type { CommentView } from "../../shared/protocol";
import { useRoomStore } from "../state/roomContext";
import type { IntentResult } from "../state/roomStore";
import styles from "./Discussion.module.css";
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
        Comments <span class="badge">{sorted.length}</span>
      </h3>
      {sorted.length === 0 ? (
        <p class={styles.empty}>{editable ? "No comments yet." : "No comments."}</p>
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

  if (editor.draft !== null) {
    return (
      <li class={styles.entry}>
        <div class={styles.form}>
          <ItemComposer
            label="Edit comment"
            max={MAX}
            initialText={comment.text}
            submitLabel="Save"
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
        <p class="user-text">{comment.text}</p>
        <EntryMeta mine={comment.mine} edited={comment.updatedAt > comment.createdAt} />
      </div>
      {editable && comment.mine && (
        <div class={styles.entryActions}>
          <button
            ref={editor.editButton}
            type="button"
            class="btn btn-ghost btn-sm"
            aria-label="Edit comment"
            disabled={!live}
            onClick={() => editor.start(true)}
          >
            Edit
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            aria-label="Delete comment"
            disabled={!live || editor.busy}
            onClick={() => editor.remove(() => store.deleteComment(comment.id), onDeleted)}
          >
            Delete
          </button>
        </div>
      )}
    </li>
  );
}

export function EntryMeta({ mine, edited }: { mine: boolean; edited: boolean }) {
  if (!mine && !edited) return null;
  return (
    <span class={styles.meta}>
      {mine && <span>You</span>}
      {mine && edited && <span aria-hidden="true">·</span>}
      {edited && <span>edited</span>}
    </span>
  );
}

function CommentComposer({ groupId }: { groupId: string }) {
  const store = useRoomStore();
  return (
    <ItemComposer
      label="Add a comment"
      max={MAX}
      placeholder="Add a comment…"
      submitLabel="Comment"
      disabled={!store.isLive.value}
      onSubmit={(text) => store.addComment(groupId, text)}
    />
  );
}
