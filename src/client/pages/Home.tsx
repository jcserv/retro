import { useState } from "preact/hooks";
import { useLocation } from "preact-iso";
import { ROOM_CODE_LENGTH } from "../../shared/constants";
import { isValidRoomCode } from "../../shared/roomCode";
import { copy } from "../copy";
import { createRoom, roomExists } from "../lib/api";
import { getClientId } from "../lib/clientId";
import styles from "./Home.module.css";

type Busy = "create" | "join" | null;

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
    setCreateError(copy.home.createErrors[result.reason]);
    setBusy(null);
  }

  async function onJoin(event: SubmitEvent) {
    event.preventDefault();
    const code = joinCode.trim().toUpperCase();
    if (!isValidRoomCode(code)) {
      setJoinError(copy.home.invalidCode(ROOM_CODE_LENGTH));
      return;
    }
    setBusy("join");
    setJoinError(null);
    const result = await roomExists(code);
    if (result === "exists") {
      route(`/r/${code}`);
      return;
    }
    setJoinError(result === "not_found" ? copy.home.roomNotFound : copy.home.unreachable);
    setBusy(null);
  }

  return (
    <main class={styles.page}>
      <div class={styles.hero}>
        <h1 class={styles.title}>{copy.appName}</h1>
        <p class={styles.lead}>{copy.home.lead}</p>
      </div>

      <div class={`card ${styles.panel}`}>
        <section class={styles.section} aria-labelledby="create-heading">
          <h2 id="create-heading" class={styles.sectionTitle}>
            {copy.home.createHeading}
          </h2>
          <p class={styles.hint}>{copy.home.createHint}</p>
          <button
            type="button"
            class="btn btn-primary btn-lg"
            onClick={onCreate}
            disabled={busy !== null}
          >
            {busy === "create" ? copy.home.creating : copy.home.create}
          </button>
          {createError && (
            <p class={styles.error} role="alert">
              {createError}
            </p>
          )}
        </section>

        <div class={styles.divider} aria-hidden="true">
          <span>{copy.home.or}</span>
        </div>

        <section class={styles.section} aria-labelledby="join-heading">
          <h2 id="join-heading" class={styles.sectionTitle}>
            {copy.home.joinHeading}
          </h2>
          <form class={styles.joinForm} onSubmit={onJoin} noValidate>
            <label class="visually-hidden" for="join-code">
              {copy.home.joinCodeLabel}
            </label>
            <input
              id="join-code"
              class={`input ${styles.codeInput}`}
              value={joinCode}
              onInput={(event) => {
                setJoinCode(event.currentTarget.value.toUpperCase());
                setJoinError(null);
              }}
              placeholder={copy.home.joinCodePlaceholder}
              maxLength={ROOM_CODE_LENGTH}
              autocomplete="off"
              autocapitalize="characters"
              spellcheck={false}
              aria-invalid={joinError ? "true" : undefined}
              aria-describedby={joinError ? "join-error" : undefined}
            />
            <button type="submit" class="btn btn-lg" disabled={busy !== null}>
              {busy === "join" ? copy.home.joining : copy.home.join}
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
