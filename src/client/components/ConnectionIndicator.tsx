import type { ConnectionStatus } from "../lib/connection";
import { useRoomStore } from "../state/roomContext";
import styles from "./ConnectionIndicator.module.css";

const LABELS: Record<ConnectionStatus, string> = {
  connecting: "Connecting…",
  open: "Live",
  reconnecting: "Reconnecting…",
  not_found: "Room closed",
  full: "Room full",
};

export function ConnectionIndicator() {
  const store = useRoomStore();
  const status = store.isLive.value ? "open" : store.status.value;
  return (
    <output class={styles.indicator} data-status={status} aria-live="polite">
      <span class={styles.dot} aria-hidden="true" />
      <span class={status === "open" ? styles.liveLabel : undefined}>{LABELS[status]}</span>
    </output>
  );
}
