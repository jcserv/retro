import { useEffect, useId, useMemo, useState } from "preact/hooks";
import { exportFileName, toMarkdown } from "../lib/markdown";
import { useRoomStore } from "../state/roomContext";
import styles from "./ExportPanel.module.css";

const FEEDBACK_MS = 2_500;

type CopyState = "idle" | "copied" | "failed";

export function ExportPanel() {
  const store = useRoomStore();
  const room = store.room.value;
  const markdown = useMemo(() => (room ? toMarkdown(room) : ""), [room]);
  const [copyState, setCopyState] = useState<CopyState>("idle");
  const headingId = useId();

  useEffect(() => {
    if (copyState === "idle") return;
    const id = setTimeout(() => setCopyState("idle"), FEEDBACK_MS);
    return () => clearTimeout(id);
  }, [copyState]);

  if (!room) return null;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(markdown);
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const download = () => {
    const url = URL.createObjectURL(new Blob([markdown], { type: "text/markdown;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = exportFileName(room);
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 0);
  };

  return (
    <section class={`card ${styles.panel}`} aria-labelledby={headingId}>
      <div class={styles.header}>
        <div class={styles.titles}>
          <h2 id={headingId} class={styles.title}>
            Export
          </h2>
          <p class={styles.description}>Markdown summary of this retro.</p>
        </div>
        <div class="cluster">
          <button type="button" class="btn btn-sm" onClick={copy}>
            {copyState === "copied" ? "Copied" : "Copy"}
          </button>
          <button type="button" class="btn btn-primary btn-sm" onClick={download}>
            Download .md
          </button>
        </div>
      </div>
      <p class={styles.feedback} role="status" aria-live="polite" data-state={copyState}>
        {copyState === "copied" && "Copied to clipboard."}
        {copyState === "failed" && "Couldn't copy. Open the preview to copy it manually."}
      </p>
      <details class={styles.preview}>
        <summary>Preview</summary>
        <pre class={styles.markdown}>{markdown}</pre>
      </details>
    </section>
  );
}
