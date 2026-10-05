import { useEffect, useRef, useState } from "preact/hooks";
import type { TimerState } from "../../shared/protocol";
import { beep } from "../lib/beep";
import { useRoomStore } from "../state/roomContext";
import styles from "./Timer.module.css";
import { ClockIcon, TimerControls } from "./TimerControls";

const TICK_MS = 250;

export type TimerReading = { remainingMs: number; paused: boolean; up: boolean };

export function readTimer(timer: TimerState, now: number): TimerReading | null {
  if (timer.kind === "none") return null;
  const remainingMs =
    timer.kind === "running" ? Math.max(0, timer.endsAt - now) : Math.max(0, timer.remainingMs);
  return { remainingMs, paused: timer.kind === "paused", up: remainingMs === 0 };
}

export function formatClock(remainingMs: number): string {
  const totalSeconds = Math.ceil(remainingMs / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}

function useTicker(active: boolean): void {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    const id = setInterval(() => setTick((tick) => tick + 1), TICK_MS);
    return () => clearInterval(id);
  }, [active]);
}

function useBeepOnExpiry(timer: TimerState, up: boolean): void {
  const armedFor = useRef<number | null>(null);
  const endsAt = timer.kind === "running" ? timer.endsAt : null;
  useEffect(() => {
    if (endsAt === null) {
      armedFor.current = null;
    } else if (!up) {
      armedFor.current = endsAt;
    } else if (armedFor.current === endsAt) {
      armedFor.current = null;
      beep();
    }
  }, [endsAt, up]);
}

export function Timer() {
  const store = useRoomStore();
  const room = store.room.value;
  const timer: TimerState = room?.timer ?? { kind: "none" };
  const active = room !== null && room.phase !== "done";

  useTicker(active && timer.kind === "running");
  const reading = active ? readTimer(timer, store.serverNow()) : null;
  useBeepOnExpiry(timer, reading?.up ?? false);

  if (!room || !active) return null;
  if (!reading) return room.isOwner ? <TimerControls timer={timer} up={false} /> : null;

  const state = reading.up ? "up" : reading.paused ? "paused" : "running";
  return (
    <div class={styles.timer} data-state={state}>
      <span class={styles.readout}>
        <ClockIcon class={styles.icon} />
        <span role="timer" class={styles.clock}>
          {formatClock(reading.remainingMs)}
        </span>
        {reading.up ? (
          <span class={styles.label}>Time's up</span>
        ) : (
          reading.paused && <span class={styles.label}>Paused</span>
        )}
      </span>
      <span class="visually-hidden" role="status" aria-live="polite">
        {reading.up ? "Time's up" : ""}
      </span>
      {room.isOwner && <TimerControls timer={timer} up={reading.up} />}
    </div>
  );
}
