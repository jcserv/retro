import { DiscussAgenda } from "../components/DiscussAgenda";
import { DiscussPanel } from "../components/DiscussPanel";
import { discussEntries } from "../lib/groups";
import { useRoomStore } from "../state/roomContext";
import styles from "./DiscussPhase.module.css";

export function DiscussPhase() {
  const room = useRoomStore().room.value;
  if (!room) return null;
  const entries = discussEntries(room);
  return (
    <div class={styles.layout}>
      <DiscussPanel room={room} />
      {entries.length > 0 && (
        <DiscussAgenda entries={entries} currentIndex={room.discuss?.currentIndex ?? 0} />
      )}
    </div>
  );
}
