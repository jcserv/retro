import { useEffect, useId, useMemo, useState } from "preact/hooks";
import { copy } from "../copy";
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

  const copyMarkdown = async () => {
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
            {copy.exportPanel.heading}
          </h2>
          <p class={styles.description}>{copy.exportPanel.description}</p>
        </div>
        <div class="cluster">
          <button type="button" class="btn btn-sm" onClick={copyMarkdown}>
            {copyState === "copied" ? copy.exportPanel.copied : copy.exportPanel.copy}
          </button>
          <button type="button" class="btn btn-primary btn-sm" onClick={download}>
            {copy.exportPanel.download}
          </button>
        </div>
      </div>
      <p class={styles.feedback} role="status" aria-live="polite" data-state={copyState}>
        {copyState === "copied" && copy.exportPanel.copiedFeedback}
        {copyState === "failed" && copy.exportPanel.copyFailed}
      </p>
      <details class={styles.preview}>
        <summary>{copy.exportPanel.preview}</summary>
        <pre class={styles.markdown}>{markdown}</pre>
      </details>
    </section>
  );
}
