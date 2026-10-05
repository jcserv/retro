import type { ComponentChildren } from "preact";
import { useRoomStore } from "../state/roomContext";
import { ErrorToast } from "./ErrorToast";
import styles from "./RoomLayout.module.css";

type RoomLayoutProps = {
  header: ComponentChildren;
  toolbar?: ComponentChildren;
  children: ComponentChildren;
};

export function RoomLayout({ header, toolbar, children }: RoomLayoutProps) {
  const store = useRoomStore();
  const showOffline = store.room.value !== null && !store.isLive.value;
  return (
    <div class={styles.shell}>
      <header class={styles.header}>
        <div class="container">{header}</div>
      </header>
      {showOffline && (
        <div class={styles.offline} role="alert">
          <div class="container">Connection lost. Reconnecting, changes are paused until then.</div>
        </div>
      )}
      {toolbar && <div class={`container ${styles.toolbar}`}>{toolbar}</div>}
      <main class={`container ${styles.main}`}>{children}</main>
      <ErrorToast />
    </div>
  );
}
