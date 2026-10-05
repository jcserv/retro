import type { ComponentType } from "preact";
import { useEffect, useLayoutEffect, useMemo } from "preact/hooks";
import { useLocation } from "preact-iso";
import type { Phase } from "../../shared/protocol";
import { isValidRoomCode } from "../../shared/roomCode";
import { Header } from "../components/Header";
import { OwnerControls } from "../components/OwnerControls";
import { PhaseBar } from "../components/PhaseBar";
import { READY_PHASES, ReadyToggle } from "../components/ReadyToggle";
import { RoomLayout } from "../components/RoomLayout";
import { Timer } from "../components/Timer";
import { getClientId } from "../lib/clientId";
import { DiscussPhase } from "../phases/DiscussPhase";
import { DonePhase } from "../phases/DonePhase";
import { GroupPhase } from "../phases/GroupPhase";
import { VotePhase } from "../phases/VotePhase";
import { WritePhase } from "../phases/WritePhase";
import { RoomStoreContext } from "../state/roomContext";
import { createRoomStore } from "../state/roomStore";
import styles from "./Room.module.css";
import { RoomNotFound } from "./RoomNotFound";

const PHASE_VIEWS: Record<Phase, ComponentType> = {
  write: WritePhase,
  group: GroupPhase,
  vote: VotePhase,
  discuss: DiscussPhase,
  done: DonePhase,
};

export function Room({ code }: { code: string }) {
  const { route } = useLocation();
  const normalized = code.toUpperCase();
  const needsRedirect = normalized !== code && isValidRoomCode(normalized);

  useLayoutEffect(() => {
    if (needsRedirect) route(`/r/${normalized}`, true);
  }, [needsRedirect, normalized, route]);

  if (needsRedirect) return null;
  if (!isValidRoomCode(code)) return <RoomNotFound />;
  return <RoomSession key={code} code={code} />;
}

function RoomSession({ code }: { code: string }) {
  const store = useMemo(() => createRoomStore({ code, clientId: getClientId() }), [code]);

  useEffect(() => {
    store.connect();
    return () => store.dispose();
  }, [store]);

  useEffect(() => {
    const previous = document.title;
    document.title = `Retro · ${code}`;
    return () => {
      document.title = previous;
    };
  }, [code]);

  const status = store.status.value;
  if (status === "not_found" || status === "full") return <RoomNotFound reason={status} />;

  const room = store.room.value;
  const PhaseView = room ? PHASE_VIEWS[room.phase] : null;

  return (
    <RoomStoreContext.Provider value={store}>
      <RoomLayout
        header={<Header />}
        toolbar={
          room && (
            <>
              <PhaseBar phase={room.phase} />
              <div class={styles.toolbarEnd}>
                <Timer />
                {READY_PHASES.includes(room.phase) && <ReadyToggle />}
                <OwnerControls />
              </div>
            </>
          )
        }
      >
        {PhaseView ? (
          <PhaseView />
        ) : (
          <div class={styles.joining}>
            <div class="spinner" aria-hidden="true" />
            <p>Joining room…</p>
          </div>
        )}
      </RoomLayout>
    </RoomStoreContext.Provider>
  );
}
