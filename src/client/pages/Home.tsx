import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { ROOM_CODE_LENGTH } from "../../shared/constants";
import { isValidRoomCode } from "../../shared/roomCode";
import { createRoom, roomExists } from "../lib/api";
import { getClientId } from "../lib/clientId";
import styles from "./Home.module.css";

type Busy = "create" | "join" | null;

const CREATE_ERRORS = {
  rate_limited: "Too many rooms created, try again in a minute.",
  failed: "Couldn't create a room. Check your connection and try again.",
} as const;

export function Home() {
  const { route } = useLocation();
  const [busy, setBusy] = useState<Busy>(null);
  const [createError, setCreateError] = useState<string | null>(null);
  const [joinCode, setJoinCode] = useState("");
  const [joinError, setJoinError] = useState<string | null>(null);

  async function onCreate() {
    setBusy("create");
    setCreateError(null);
    const result = await createRoom(getClientId());
    if (result.ok) {
      route(`/r/${result.code}`);
      return;
    }
    setCreateError(CREATE_ERRORS[result.reason]);
    setBusy(null);
  }

  async function onJoin(event: SubmitEvent) {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!isValidRoomCode(code)) {
      setJoinError(`Room codes are ${ROOM_CODE_LENGTH} letters and numbers.`);
      return;
    }
    setBusy("join");
    setJoinError(null);
    const result = await roomExists(code);
    if (result === "exists") {
      route(`/r/${code}`);
      return;
    }
    setJoinError(
      result === "not_found"
        ? "Room not found. It may have expired."
        : "Couldn't reach the server. Try again.",
    );
    setBusy(null);
  }

  return (
    <main class={styles.page}>
      <div class={styles.hero}>
        <h1 class={styles.title}>Retro</h1>
        <p class={styles.lead}>Quick, anonymous team retros. No accounts, no setup.</p>
      </div>

      <div class={`card ${styles.panel}`}>
        <section class={styles.section} aria-labelledby="create-heading">
          <h2 id="create-heading" class={styles.sectionTitle}>
            Start a retro
          </h2>
          <p class={styles.hint}>You'll run the session. Share the link with your team.</p>
          <button
            type="button"
            class="btn btn-primary btn-lg"
            onClick={onCreate}
            disabled={busy !== null}
          >
            {busy === "create" ? "Creating…" : "Create room"}
          </button>
          {createError && (
            <p class={styles.error} role="alert">
              {createError}
            </p>
          )}
        </section>

        <div class={styles.divider} aria-hidden="true">
          <span>or</span>
        </div>

        <section class={styles.section} aria-labelledby="join-heading">
          <h2 id="join-heading" class={styles.sectionTitle}>
            Join a retro
          </h2>
          <form class={styles.joinForm} onSubmit={onJoin} noValidate>
            <label class="visually-hidden" for="join-code">
              Room code
            </label>
            <input
              id="join-code"
              class={`input ${styles.codeInput}`}
              value={joinCode}
              onInput={(event) => {
                setJoinCode(event.currentTarget.value.toUpperCase());
                setJoinError(null);
              }}
              placeholder="ABC234"
              maxLength={ROOM_CODE_LENGTH}
              autocomplete="off"
              autocapitalize="characters"
              spellcheck={false}
              aria-invalid={joinError ? "true" : undefined}
              aria-describedby={joinError ? "join-error" : undefined}
            />
            <button type="submit" class="btn btn-lg" disabled={busy !== null}>
              {busy === "join" ? "Joining…" : "Join"}
            </button>
          </form>
          {joinError && (
            <p id="join-error" class={styles.error} role="alert">
              {joinError}
            </p>
          )}
        </section>
      </div>
    </main>
  );
}
