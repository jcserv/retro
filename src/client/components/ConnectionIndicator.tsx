import { copy } from "../copy";
import { useRoomStore } from "../state/roomContext";
import styles from "./ConnectionIndicator.module.css";

export function ConnectionIndicator() {
  const store = useRoomStore();
  const status = store.isLive.value ? "open" : store.status.value;
  return (
    <output class={styles.indicator} data-status={status} aria-live="polite">
      <span class={styles.dot} aria-hidden="true" />
      <span class={status === "open" ? styles.liveLabel : undefined}>
        {copy.connection[status]}
      </span>
    </output>
  );
}
