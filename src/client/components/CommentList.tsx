import { useState } from "preact/hooks";
import { LIMITS } from "../../shared/constants";
import type { CommentView } from "../../shared/protocol";
import { submitOnEnter } from "../lib/keys";
import { useRoomStore } from "../state/roomContext";
import { CharCount, fitsLimit } from "./CharCount";
import styles from "./Discussion.module.css";
import { useEntryEditor } from "./useEntryEditor";

const MAX = LIMITS.commentTextMax;

type CommentListProps = {
  groupId: string;
  comments: readonly CommentView[];
  editable: boolean;
};

export function CommentList({ groupId, comments, editable }: CommentListProps) {
  const headingId = `comments-${groupId}`;
  const sorted = [...comments].sort((a, b) => a.createdAt - b.createdAt);
  return (
    <section class={styles.section} aria-labelledby={headingId}>
      <h3 id={headingId} class={styles.heading}>
        Comments <span class="badge">{sorted.length}</span>
      </h3>
      {sorted.length === 0 ? (
        <p class={styles.empty}>No comments yet.</p>
      ) : (
        <ul class={styles.list}>
          {sorted.map((comment) => (
            <CommentRow key={comment.id} comment={comment} editable={editable} />
          ))}
        </ul>
      )}
      {editable && <CommentComposer groupId={groupId} />}
    </section>
  );
}

function CommentRow({ comment, editable }: { comment: CommentView; editable: boolean }) {
  const store = useRoomStore();
  const editor = useEntryEditor<string>();
  const live = store.isLive.value;
  const fieldId = `comment-edit-${comment.id}`;

  if (editor.draft !== null) {
    const draft = editor.draft;
    const unchanged = draft.trim() === comment.text;
    return (
      <li class={styles.entry}>
        <form
          class={styles.form}
          onSubmit={(event) => {
            event.preventDefault();
            if (unchanged) return editor.cancel();
            if (!fitsLimit(draft, MAX)) return;
            void editor.save(() => store.editComment(comment.id, draft.trim()));
          }}
        >
          <label class="visually-hidden" for={fieldId}>
            Edit comment
          </label>
          <textarea
            id={fieldId}
            class="textarea"
            rows={2}
            value={draft}
            // biome-ignore lint/a11y/noAutofocus: focus moves into the editor the user just opened
            autoFocus
            onInput={(event) => editor.update(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") editor.cancel();
              else submitOnEnter(event);
            }}
          />
          <div class={styles.formFooter}>
            <CharCount text={draft} max={MAX} />
            <button type="button" class="btn btn-ghost btn-sm" onClick={editor.cancel}>
              Cancel
            </button>
            <button
              type="submit"
              class="btn btn-primary btn-sm"
              disabled={!live || editor.busy || !fitsLimit(draft, MAX)}
            >
              Save
            </button>
          </div>
        </form>
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
            onClick={() => editor.start(comment.text)}
          >
            Edit
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            aria-label="Delete comment"
            disabled={!live || editor.busy}
            onClick={() => editor.remove(() => store.deleteComment(comment.id))}
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
  const [text, setText] = useState("");
  const live = store.isLive.value;
  const fieldId = `comment-new-${groupId}`;
  const counterId = `${fieldId}-count`;

  async function submit(event: Event) {
    event.preventDefault();
    if (!live || !fitsLimit(text, MAX)) return;
    const value = text.trim();
    setText("");
    const result = await store.addComment(groupId, value);
    if (!result.ok) setText((current) => current || value);
  }

  return (
    <form class={styles.form} onSubmit={submit}>
      <label class="visually-hidden" for={fieldId}>
        Add a comment
      </label>
      <textarea
        id={fieldId}
        class="textarea"
        rows={2}
        placeholder="Add a comment…"
        value={text}
        disabled={!live}
        aria-describedby={counterId}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={submitOnEnter}
      />
      <div class={styles.formFooter}>
        <CharCount id={counterId} text={text} max={MAX} />
        <button
          type="submit"
          class="btn btn-primary btn-sm"
          disabled={!live || !fitsLimit(text, MAX)}
        >
          Comment
        </button>
      </div>
    </form>
  );
}
