import { expect, test } from "vitest";
import { PHASES } from "../../shared/protocol";
import { PHASE_LABELS } from "./PhaseBar";

test("phase labels follow the canonical phase order", () => {
  expect(Object.keys(PHASE_LABELS)).toEqual(PHASES);
});
