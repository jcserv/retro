import styles from "./Centered.module.css";

export function Home() {
  return (
    <main class={styles.page}>
      <div class={styles.content}>
        <h1 class={styles.title}>Retro</h1>
        <p class={styles.lead}>Quick, anonymous team retros. No accounts.</p>
      </div>
    </main>
  );
}
