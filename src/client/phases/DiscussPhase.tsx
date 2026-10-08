import { DiscussAgenda } from "../components/DiscussAgenda";
import { DiscussPanel } from "../components/DiscussPanel";
import { discussEntries } from "../lib/groups";
import { useRoomStore } from "../state/roomContext";
import styles from "./DiscussPhase.module.css";

export function DiscussPhase() {
  const store = useRoomStore();
  const room = store.room.value;
  if (!room) return null;
  const entries = discussEntries(room);
  const currentIndex = room.discuss?.currentIndex ?? 0;
  return (
    <div class={styles.layout}>
      <DiscussPanel room={room} />
      <div class={styles.side}>
        {entries.length > 0 && (
          <DiscussAgenda
            entries={entries}
            currentIndex={currentIndex}
            onSelect={room.isOwner ? (index) => void store.goTo(currentIndex, index) : undefined}
            disabled={!store.isLive.value}
          />
        )}
      </div>
    </div>
  );
}
