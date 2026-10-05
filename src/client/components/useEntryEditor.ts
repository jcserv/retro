import { useEffect, useRef, useState } from "preact/hooks";
import type { IntentResult } from "../state/roomStore";

export function useEntryEditor<Draft>() {
  const [draft, setDraft] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const editButton = useRef<HTMLButtonElement>(null);
  const wasEditing = useRef(false);

  useEffect(() => {
    if (draft === null && wasEditing.current) editButton.current?.focus();
    wasEditing.current = draft !== null;
  }, [draft]);

  async function run(action: () => Promise<IntentResult>, onSuccess?: () => void): Promise<void> {
    setBusy(true);
    const result = await action();
    setBusy(false);
    if (result.ok) onSuccess?.();
  }

  return {
    draft,
    busy,
    editButton,
    start: (initial: Draft) => setDraft(initial),
    update: (next: Draft) => setDraft(next),
    cancel: () => setDraft(null),
    save: (action: () => Promise<IntentResult>) => run(action, () => setDraft(null)),
    remove: (action: () => Promise<IntentResult>, onRemoved: () => void) => run(action, onRemoved),
  };
}

export function useSectionFocus() {
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  return {
    section,
    heading,
    focusComposer: () => {
      const field = section.current?.querySelector<HTMLElement>(
        ":scope > form textarea:not(:disabled)",
      );
      (field ?? heading.current)?.focus();
    },
  };
}
