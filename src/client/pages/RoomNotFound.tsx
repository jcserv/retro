import styles from "./Centered.module.css";

const COPY = {
  not_found: {
    title: "Room not found",
    body: "This room doesn't exist or has expired. Rooms last 7 days.",
  },
  full: {
    title: "Room is full",
    body: "This room has reached its participant limit.",
  },
} as const;

export function RoomNotFound({ reason = "not_found" }: { reason?: keyof typeof COPY }) {
  const copy = COPY[reason];
  return (
    <main class={styles.page}>
      <div class={styles.content}>
        <h1 class={styles.heading}>{copy.title}</h1>
        <p class={styles.lead}>{copy.body}</p>
        <a class="btn btn-primary btn-lg" href="/">
          Back to home
        </a>
      </div>
    </main>
  );
}
