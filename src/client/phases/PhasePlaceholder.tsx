import type { Phase } from "../../shared/protocol";
import { PHASE_LABELS } from "../components/PhaseBar";
import styles from "./PhasePlaceholder.module.css";

export function PhasePlaceholder({ phase }: { phase: Phase }) {
  return (
    <section class={`card ${styles.placeholder}`} aria-label={`${PHASE_LABELS[phase]} phase`}>
      <h2>{PHASE_LABELS[phase]} phase</h2>
      <p>This phase is not built yet.</p>
    </section>
  );
}
