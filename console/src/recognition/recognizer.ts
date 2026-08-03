import type { ExerciseId, RepFlag, RepPhase } from '@bosco98/primal-sdk';
import type { Baseline } from './calibration.js';
import type { FrameFeatures } from './features.js';

/** A completed rep, before the engine assigns it a session-wide id and count. */
export interface DetectedRep {
  exercise: ExerciseId;
  formScore: number;
  flags: RepFlag[];
  durationMs: number;
}

export interface DetectedProgress {
  exercise: ExerciseId;
  phase: RepPhase;
  progress: number;
  depth: number;
}

export interface RecognizerOutput {
  rep?: DetectedRep;
  progress?: DetectedProgress;
}

const NOTHING: RecognizerOutput = {};
export const NO_OUTPUT = NOTHING;

/**
 * A rep recogniser is a state machine fed one frame at a time.
 *
 * Two properties are load-bearing and every implementation must keep them:
 *
 *  1. **Pure with respect to time.** All timing comes from `features.t`, never
 *     from `Date.now()` or `performance.now()`. That is what lets a recorded
 *     fixture replay at any speed and still produce identical output, which is
 *     the entire basis of the test suite.
 *  2. **Hysteresis and dwell.** Entering and leaving a phase use different
 *     thresholds, and phases have minimum frame counts. Landmark jitter around
 *     a single threshold would otherwise emit a burst of phantom reps, and a
 *     counter the player does not trust is worse than no counter.
 */
export interface RepRecognizer {
  readonly exercise: ExerciseId;
  reset(): void;
  update(features: FrameFeatures, baseline: Baseline): RecognizerOutput;
}

/** Map a value from one range to 0..1, clamped. */
export function normaliseRange(value: number, worst: number, best: number): number {
  if (worst === best) return 0;
  const t = (value - worst) / (best - worst);
  return Math.min(1, Math.max(0, t));
}

export function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}
