import type { Phase } from "../../shared/protocol";
import { copy } from "../copy";
import styles from "./PhasePlaceholder.module.css";

export function PhasePlaceholder({ phase }: { phase: Phase }) {
  return (
    <section
      class={`card ${styles.placeholder}`}
      aria-label={copy.phasePlaceholder.heading(copy.phases[phase])}
    >
      <h2>{copy.phasePlaceholder.heading(copy.phases[phase])}</h2>
      <p>{copy.phasePlaceholder.body}</p>
    </section>
  );
}
