import type { ComponentChildren } from "preact";
import { useEffect, useId, useRef, useState } from "preact/hooks";
import { LIMITS } from "../../shared/constants";
import type { TimerState } from "../../shared/protocol";
import { useRoomStore } from "../state/roomContext";
import styles from "./Timer.module.css";

const MINUTE_MS = 60_000;
const PRESET_MINUTES = [1, 3, 5, 10, 15];
const MIN_MINUTES = LIMITS.timerMinMs / MINUTE_MS;
const MAX_MINUTES = LIMITS.timerMaxMs / MINUTE_MS;

type TimerControlsProps = { timer: TimerState; up: boolean };

export function TimerControls({ timer, up }: TimerControlsProps) {
  const store = useRoomStore();
  const disabled = !store.isLive.value;

  if (timer.kind === "none") return <SetTimerMenu disabled={disabled} />;

  return (
    <span class={styles.controls}>
      {timer.kind === "paused" ? (
        <IconButton label="Resume timer" disabled={disabled} onClick={store.resumeTimer}>
          <path d="M5 3.5v9l7-4.5z" fill="currentColor" />
        </IconButton>
      ) : (
        !up && (
          <IconButton label="Pause timer" disabled={disabled} onClick={store.pauseTimer}>
            <path d="M5.5 3.5v9M10.5 3.5v9" stroke="currentColor" stroke-width="2" />
          </IconButton>
        )
      )}
      <button
        type="button"
        class="btn btn-ghost btn-sm"
        disabled={disabled}
        onClick={store.addTimerMinute}
        aria-label="Add one minute"
      >
        +1 min
      </button>
      <IconButton label="Clear timer" disabled={disabled} onClick={store.clearTimer}>
        <path
          d="M4.5 4.5l7 7M11.5 4.5l-7 7"
          stroke="currentColor"
          stroke-width="1.75"
          stroke-linecap="round"
        />
      </IconButton>
    </span>
  );
}

type IconButtonProps = {
  label: string;
  disabled: boolean;
  onClick: () => unknown;
  children: ComponentChildren;
};

function IconButton({ label, disabled, onClick, children }: IconButtonProps) {
  return (
    <button
      type="button"
      class="btn btn-ghost btn-sm btn-icon"
      disabled={disabled}
      onClick={onClick}
      aria-label={label}
      title={label}
    >
      <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
        {children}
      </svg>
    </button>
  );
}

function SetTimerMenu({ disabled }: { disabled: boolean }) {
  const store = useRoomStore();
  const [open, setOpen] = useState(false);
  const [minutes, setMinutes] = useState("");
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const inputId = useId();

  useEffect(() => {
    if (!open) return;
    rootRef.current?.querySelector<HTMLButtonElement>("[data-preset]")?.focus();
    const onPointerDown = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setOpen(false);
      triggerRef.current?.focus();
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const start = (value: number) => {
    setOpen(false);
    setMinutes("");
    triggerRef.current?.focus();
    void store.setTimer(value * MINUTE_MS);
  };

  const custom = Number(minutes);
  const customValid = Number.isInteger(custom) && custom >= MIN_MINUTES && custom <= MAX_MINUTES;

  return (
    <div class={styles.menuRoot} ref={rootRef}>
      <button
        type="button"
        class="btn btn-sm"
        ref={triggerRef}
        disabled={disabled}
        aria-expanded={open}
        aria-controls={menuId}
        onClick={() => setOpen((value) => !value)}
      >
        <ClockIcon />
        Timer
      </button>
      {open && (
        <div class={`card ${styles.menu}`} id={menuId}>
          <div class={styles.presets}>
            {PRESET_MINUTES.map((value) => (
              <button
                key={value}
                type="button"
                class="btn btn-subtle btn-sm"
                data-preset
                disabled={disabled}
                onClick={() => start(value)}
              >
                {value} min
              </button>
            ))}
          </div>
          <form
            class={styles.custom}
            onSubmit={(event) => {
              event.preventDefault();
              if (customValid) start(custom);
            }}
          >
            <label class={styles.customLabel} for={inputId}>
              Custom minutes
            </label>
            <div class={styles.customRow}>
              <input
                id={inputId}
                class={`input ${styles.customInput}`}
                type="number"
                inputMode="numeric"
                min={MIN_MINUTES}
                max={MAX_MINUTES}
                step={1}
                placeholder={`${MIN_MINUTES}–${MAX_MINUTES}`}
                value={minutes}
                onInput={(event) => setMinutes(event.currentTarget.value)}
              />
              <button
                type="submit"
                class="btn btn-primary btn-sm"
                disabled={disabled || !customValid}
              >
                Start
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}

export function ClockIcon({ class: className }: { class?: string }) {
  return (
    <svg class={className} viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
      <circle cx="8" cy="8" r="6.25" fill="none" stroke="currentColor" stroke-width="1.5" />
      <path
        d="M8 4.75V8l2.25 1.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
        stroke-linecap="round"
        stroke-linejoin="round"
      />
    </svg>
  );
}
