import { useRoomStore } from "../state/roomContext";
import { ConnectionIndicator } from "./ConnectionIndicator";
import styles from "./Header.module.css";

export function Header() {
  const store = useRoomStore();
  return (
    <div class={styles.header}>
      <a class={styles.brand} href="/">
        Retro
      </a>
      <span class={styles.divider} aria-hidden="true" />
      <span class={styles.code}>
        <span class="visually-hidden">Room code </span>
        {store.code}
      </span>
      <div class={styles.end}>
        <ConnectionIndicator />
      </div>
    </div>
  );
}
