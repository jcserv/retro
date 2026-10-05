import { useId, useState } from "preact/hooks";
import { textLength } from "../lib/format";
import type { IntentResult } from "../state/roomStore";
import styles from "./ItemComposer.module.css";

type ItemComposerProps = {
  label: string;
  max: number;
  onSubmit: (text: string) => Promise<IntentResult>;
  submitLabel: string;
  placeholder?: string;
  initialText?: string;
  disabled?: boolean;
  disabledHint?: string;
  onCancel?: () => void;
  autoFocus?: boolean;
};

export function ItemComposer({
  label,
  max,
  onSubmit,
  submitLabel,
  placeholder,
  initialText = "",
  disabled = false,
  disabledHint,
  onCancel,
  autoFocus = false,
}: ItemComposerProps) {
  const [text, setText] = useState(initialText);
  const [pending, setPending] = useState(false);
  const id = useId();
  const length = textLength(text);
  const over = length > max;
  const canSubmit = !disabled && !pending && length > 0 && !over;

  async function submit() {
    if (!canSubmit) return;
    const sent = text;
    setPending(true);
    if (!onCancel) setText("");
    const result = await onSubmit(sent.trim());
    setPending(false);
    if (!result.ok) setText(sent);
    else onCancel?.();
  }

  function onKeyDown(event: KeyboardEvent) {
    if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      void submit();
    } else if (event.key === "Escape" && onCancel) {
      event.preventDefault();
      onCancel();
    }
  }

  return (
    <form
      class={styles.composer}
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
    >
      <label class="visually-hidden" for={id}>
        {label}
      </label>
      <textarea
        id={id}
        class={`textarea ${styles.field}`}
        rows={2}
        value={text}
        placeholder={disabled && disabledHint ? disabledHint : placeholder}
        disabled={disabled}
        aria-invalid={over ? "true" : undefined}
        aria-describedby={`${id}-count`}
        // biome-ignore lint/a11y/noAutofocus: opening the editor is an explicit user action
        autoFocus={autoFocus}
        onInput={(event) => setText(event.currentTarget.value)}
        onKeyDown={onKeyDown}
      />
      <div class={styles.footer}>
        <span id={`${id}-count`} class="field-hint" data-over={over ? "true" : undefined}>
          <span class="visually-hidden">Characters used: </span>
          {length}/{max}
        </span>
        <div class={styles.actions}>
          {onCancel && (
            <button type="button" class="btn btn-ghost btn-sm" onClick={onCancel}>
              Cancel
            </button>
          )}
          <button type="submit" class="btn btn-subtle btn-sm" disabled={!canSubmit}>
            {submitLabel}
          </button>
        </div>
      </div>
    </form>
  );
}
