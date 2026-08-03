/**
 * Every tuned number in the game, in one file.
 *
 * The constants at the top are not preferences — they are consequences of the
 * measured input pipeline (camera -> MediaPipe -> zones -> game logic ->
 * render), which runs 140-200ms end to end. A player also needs
 * ~250ms to read a symbol and ~350ms to start and finish a jump. Violate these
 * and obstacles become undodgeable before they become unreadable.
 */

/** Track depth in world units, horizon to commit line. */
export const TRACK_DEPTH = 100;

/** Hard floor on how long an obstacle is visible before it must be cleared. */
export const MIN_TELEGRAPH_S = 1.1;

/**
 * Past this, spawn distance can no longer buy the telegraph floor inside a
 * 100-unit track. Nothing may raise scroll speed above it.
 */
export const MAX_SCROLL_SPEED = 85;

/** Timing forgiveness, deliberately front-loaded: humans anticipate. */
export const PRE_BUFFER_MS = 250; // action accepted this early
export const COMMIT_WINDOW_MS = 180; // +/- around contact
export const COYOTE_MS = 120; // accepted this late

/* -------------------------------------------------------------------------- */
/* Run shape                                                                   */
/* -------------------------------------------------------------------------- */

export const RUN_SECONDS = 180;

/**
 * Five phases. A run is finite on purpose: the resource here is the player's
 * legs, and past three minutes of continuous jumping form degrades and they
 * quit for the day instead of doing another run.
 */
export interface Phase {
  id: string;
  until: number;
  scroll: number;
  interval: number;
  drain: number;
  types: string[];
}

export const PHASES: Phase[] = [
  { id: 'onboard', until: 20, scroll: 40, interval: 3.4, drain: 0.0, types: ['hurdle', 'beam', 'wall'] },
  { id: 'build', until: 60, scroll: 48, interval: 2.6, drain: 1.5, types: ['hurdle', 'beam', 'wall', 'double'] },
  { id: 'press', until: 105, scroll: 56, interval: 2.1, drain: 2.8, types: ['hurdle', 'beam', 'wall', 'double'] },
  { id: 'squeeze', until: 150, scroll: 64, interval: 1.7, drain: 4.0, types: ['hurdle', 'beam', 'wall', 'double', 'gauntlet'] },
  { id: 'finale', until: 180, scroll: 72, interval: 1.4, drain: 5.0, types: ['hurdle', 'beam', 'wall', 'double', 'gauntlet'] },
];

/* -------------------------------------------------------------------------- */
/* The pack                                                                    */
/* -------------------------------------------------------------------------- */

export const PACK = {
  START_GAP: 60,
  MAX_GAP: 100,
  CLEAR_BONUS: 4,
  COIN_SWEEP_BONUS: 2,
  HIT_COST: 18,
  /**
   * The effort term. At avg10s 0.85 you gain 2.1 m/s for free; at 0.30 you lose
   * 1.2 m/s even while clearing everything.
   *
   * This is the whole design in one line. They pace you: a predator does not
   * sprint, it waits for you to flag. Subway Surfers chases you for failing —
   * the pack chases you for coasting, which is the thing a fitness game should
   * actually be punishing.
   */
  EFFORT_PIVOT: 0.5,
  EFFORT_GAIN: 6,
  /**
   * The Commit, at 2:00. They stop pacing and come for you: drain doubles for
   * eight seconds behind a loud telegraph. Scripted tension, but still
   * out-runnable by clearing, so it reads as terrifying rather than unfair.
   */
  COMMIT_AT: 120,
  COMMIT_SECONDS: 8,
};

/* -------------------------------------------------------------------------- */
/* Surge — the powerup that is also the rest interval                          */
/* -------------------------------------------------------------------------- */

export const SURGE = {
  /** Burn must sit above this to fill the meter. */
  ENTER_INTENSITY: 0.65,
  FILL_SECONDS: 10,
  DURATION: 12,
  SCORE_MULTIPLIER: 3,
  GAP_GAIN: 1.5,
  /** No obstacle may land for this long after touchdown. */
  LANDING_GRACE: 1.2,
};

/** Earned by sustained effort, spent automatically. Never bought. */
export const SECOND_WIND = {
  INTENSITY: 0.7,
  HOLD_SECONDS: 20,
  RESTORE_GAP: 35,
  INVULN_SECONDS: 2,
};

/* -------------------------------------------------------------------------- */
/* Scoring                                                                     */
/* -------------------------------------------------------------------------- */

export const SCORE = {
  COIN: 10,
  SWEEP_FLOURISH: 50,
  NEAR_MISS: 25,
  COMBO_STEP: 5,
  COMBO_CAP: 20,
  FINISH_BONUS: 500,
};

/** Hand cursor mapping. Reaching is the exercise; pixel precision is not. */
export const HAND = {
  GAIN_X: 2.2,
  GAIN_Y: 2.0,
  RADIUS: 64,
  COIN_RADIUS: 40,
  /** One-euro filter: jitter looks worse than lag when the hitbox is this big. */
  MIN_CUTOFF: 1.2,
  BETA: 0.02,
};

export const SIM_HZ = 60;
export const SIM_STEP_MS = 1000 / SIM_HZ;
/** Cap catch-up so a long MediaPipe inference can't spiral the simulation. */
export const MAX_CATCHUP_STEPS = 3;

export function phaseAt(elapsedSeconds: number): Phase {
  for (const phase of PHASES) {
    if (elapsedSeconds < phase.until) return phase;
  }
  return PHASES[PHASES.length - 1]!;
}
