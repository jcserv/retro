import { useEffect } from "preact/hooks";
import { ERROR_MESSAGES } from "../lib/errorMessages";
import { useRoomStore } from "../state/roomContext";
import styles from "./ErrorToast.module.css";

const DISMISS_AFTER_MS = 6_000;

export function ErrorToast() {
  const store = useRoomStore();
  const error = store.lastError.value;

  useEffect(() => {
    if (!error) return;
    const timer = setTimeout(store.dismissError, DISMISS_AFTER_MS);
    return () => clearTimeout(timer);
  }, [error, store]);

  return (
    <div class={styles.region} role="status" aria-live="polite">
      {error && (
        <div class={styles.toast} key={error.id}>
          <span>{ERROR_MESSAGES[error.code]}</span>
          <button
            type="button"
            class="btn btn-ghost btn-sm btn-icon"
            onClick={store.dismissError}
            aria-label="Dismiss"
          >
            <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true">
              <path
                d="M4 4l8 8M12 4l-8 8"
                stroke="currentColor"
                stroke-width="1.75"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </div>
      )}
    </div>
  );
}
