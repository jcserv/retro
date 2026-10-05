import { useEffect, useState } from "preact/hooks";
import { expiryTickMs, formatTimeLeft, plural } from "../lib/format";
import { useRoomStore } from "../state/roomContext";
import { ConnectionIndicator } from "./ConnectionIndicator";
import styles from "./Header.module.css";
import { Icon } from "./Icon";

export function Header() {
  const store = useRoomStore();
  const room = store.room.value;
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
      <CopyLinkButton code={store.code} />
      <div class={styles.end}>
        {room && (
          <>
            <span
              class={styles.meta}
              title={`${plural(room.presence.connectedCount, "person", "people")} here`}
            >
              <Icon name="people" />
              <span class="visually-hidden">People here: </span>
              {room.presence.connectedCount}
            </span>
            <Expiry expiresAt={room.expiresAt} />
          </>
        )}
        <ConnectionIndicator />
      </div>
    </div>
  );
}

function Expiry({ expiresAt }: { expiresAt: number }) {
  const store = useRoomStore();
  const [now, setNow] = useState(store.serverNow);
  const left = expiresAt - now;

  useEffect(() => {
    const timer = setInterval(() => setNow(store.serverNow()), expiryTickMs(left));
    return () => clearInterval(timer);
  }, [store, left]);

  const label = formatTimeLeft(left);
  return (
    <span
      class={styles.meta}
      data-urgent={left < 60 * 60_000 ? "true" : undefined}
      title={left > 0 ? `Room expires in ${label}` : "Room expired"}
    >
      <Icon name="clock" />
      <span>
        {left > 0 && <span class={styles.expiryPrefix}>Expires in </span>}
        {label}
      </span>
    </span>
  );
}

const COPIED_MS = 2_000;

function CopyLinkButton({ code }: { code: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  useEffect(() => {
    if (state === "idle") return;
    const timer = setTimeout(() => setState("idle"), COPIED_MS);
    return () => clearTimeout(timer);
  }, [state]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/r/${code}`);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  const label = state === "copied" ? "Copied" : state === "failed" ? "Couldn't copy" : "Copy link";
  return (
    <button
      type="button"
      class={`btn btn-ghost btn-sm ${styles.copy}`}
      data-state={state}
      onClick={copy}
    >
      <Icon name={state === "copied" ? "check" : "link"} />
      <span class={styles.copyLabel} aria-live="polite">
        {label}
      </span>
    </button>
  );
}
