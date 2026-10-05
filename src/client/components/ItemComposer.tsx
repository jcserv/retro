import type { ComponentChildren } from "preact";
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
  extraInvalid?: boolean;
  children?: ComponentChildren;
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
  extraInvalid = false,
  children,
}: ItemComposerProps) {
  const [text, setText] = useState(initialText);
  const [saving, setSaving] = useState(false);
  const id = useId();
  const length = textLength(text);
  const over = length > max;
  const canSubmit = !disabled && !saving && length > 0 && !over && !extraInvalid;

  async function submit() {
    if (!canSubmit) return;
    const sent = text;
    if (onCancel) {
      setSaving(true);
      const result = await onSubmit(sent.trim());
      setSaving(false);
      if (result.ok) onCancel();
      return;
    }
    setText("");
    const result = await onSubmit(sent.trim());
    if (!result.ok) setText((current) => current || sent);
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
      {children}
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
