import { useState } from "preact/hooks";
import type { Phase } from "../../shared/protocol";
import { useRoomStore } from "../state/roomContext";
import { Icon } from "./Icon";
import styles from "./ReadyToggle.module.css";

export const READY_PHASES: readonly Phase[] = ["write", "group"];

export function ReadyToggle() {
  const store = useRoomStore();
  const [pending, setPending] = useState(false);
  const room = store.room.value;
  if (!room) return null;
  const ready = room.youReady;

  async function toggle() {
    setPending(true);
    await store.setReady(!ready);
    setPending(false);
  }

  return (
    <button
      type="button"
      class={`btn ${styles.toggle}`}
      aria-pressed={ready}
      onClick={toggle}
      disabled={pending || !store.isLive.value}
    >
      <span class={styles.box} aria-hidden="true">
        {ready && <Icon name="check" size={14} />}
      </span>
      I'm ready
    </button>
  );
}
