import { useEffect, useState } from "preact/hooks";
import { copy } from "../copy";
import { expiryTickMs, formatTimeLeft } from "../lib/format";
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
        {copy.appName}
      </a>
      <span class={styles.divider} aria-hidden="true" />
      <span class={styles.code}>
        <span class="visually-hidden">{copy.header.roomCode}</span>
        {store.code}
      </span>
      <CopyLinkButton code={store.code} />
      <div class={styles.end}>
        {room && (
          <>
            <span class={styles.meta} title={copy.header.peopleHere(room.presence.connectedCount)}>
              <Icon name="people" />
              <span class="visually-hidden">{copy.header.peopleHereCount}</span>
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
      title={left > 0 ? copy.header.expiresInTitle(label) : copy.header.expired}
    >
      <Icon name="clock" />
      <span>
        {left > 0 && <span class={styles.expiryPrefix}>{copy.header.expiresIn}</span>}
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

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(`${location.origin}/r/${code}`);
      setState("copied");
    } catch {
      setState("failed");
    }
  }

  const label =
    state === "copied"
      ? copy.header.copied
      : state === "failed"
        ? copy.header.copyFailed
        : copy.header.copyLink;
  return (
    <button
      type="button"
      class={`btn btn-ghost btn-sm ${styles.copy}`}
      data-state={state}
      onClick={copyLink}
    >
      <Icon name={state === "copied" ? "check" : "link"} />
      <span class={styles.copyLabel} aria-live="polite">
        {label}
      </span>
    </button>
  );
}
