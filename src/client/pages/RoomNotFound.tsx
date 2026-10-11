import { copy } from "../copy";
import styles from "./Centered.module.css";

type Reason = "not_found" | "full";

export function RoomNotFound({ reason = "not_found" }: { reason?: Reason }) {
  const content = copy.roomUnavailable[reason];
  return (
    <main class={styles.page}>
      <div class={styles.content}>
        <h1 class={styles.heading}>{content.title}</h1>
        <p class={styles.lead}>{content.body}</p>
        <a class="btn btn-primary btn-lg" href="/">
          {copy.roomUnavailable.backHome}
        </a>
      </div>
    </main>
  );
}
