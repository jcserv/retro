import { PHASES, type Phase } from "../../shared/phases";
import styles from "./PhaseBar.module.css";

export const PHASE_LABELS: Record<Phase, string> = {
  write: "Write",
  group: "Group",
  vote: "Vote",
  discuss: "Discuss",
  done: "Done",
};

export function PhaseBar({ phase }: { phase: Phase }) {
  const currentIndex = PHASES.indexOf(phase);
  return (
    <nav class={styles.nav} aria-label="Retro phases">
      <ol class={styles.bar}>
        {PHASES.map((entry, index) => (
          <li
            key={entry}
            class={styles.step}
            data-state={
              index < currentIndex ? "past" : index === currentIndex ? "current" : "future"
            }
            aria-current={index === currentIndex ? "step" : undefined}
          >
            <span class={styles.marker} aria-hidden="true">
              {index < currentIndex ? "✓" : index + 1}
            </span>
            <span class={styles.label}>{PHASE_LABELS[entry]}</span>
          </li>
        ))}
      </ol>
    </nav>
  );
}
