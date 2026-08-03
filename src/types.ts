/**
 * Shared shapes between the pose pipeline and the game.
 *
 * These used to be a wire protocol: a versioned message vocabulary sent over a
 * MessagePort to a game in a cross-origin iframe. That was the right design for
 * a console launching third-party cartridges, and pure overhead for one game in
 * one folder — so they are now just types, passed by reference on the same
 * frame, with no serialisation and no clock domains to reconcile.
 */

export interface Point2 {
  /** 0..1, left to right of the camera view, already mirrored. */
  x: number;
  /** 0..1, top to bottom. */
  y: number;
}

export interface TrackedPoint extends Point2 {
  /** False when the landmark is occluded or out of frame; x/y are then stale. */
  visible: boolean;
}

/** The movement vocabulary the game reacts to. */
export type Action = 'JUMP' | 'DUCK';

/** Which lane band the player is standing in. */
export type Band = -1 | 0 | 1;

/**
 * Continuous body state, mirrored so the player's right hand is on the right of
 * the screen. Positions are absolute within the camera view, not relative to a
 * remembered neutral pose — which is why nothing here can drift.
 */
export interface Body {
  hands: { left: TrackedPoint; right: TrackedPoint };
  center: Point2;
  head: Point2;
  /** -1 fully left, 0 centred, +1 fully right. */
  lean: number;
  /** 0 standing, 1 fully squatted. */
  crouch: number;
}

export interface Intensity {
  /** 0..1 smoothed instantaneous movement intensity. */
  instant: number;
  /** 0..1 rolling 10-second average. This is what paces the workout. */
  avg10s: number;
}

export type FramingIssue =
  | 'no_person'
  | 'too_close'
  | 'too_far'
  | 'legs_not_visible'
  | 'low_light';

export interface Tracking {
  present: boolean;
  /** 0..1 confidence that input is currently trustworthy. */
  quality: number;
  issues: FramingIssue[];
  /**
   * True when the player is positioned well enough to actually play. Both
   * controls are measured between the hips and the knees, so this gate is about
   * those being in frame — not the feet, which may be cropped without costing
   * the player anything.
   */
  playable: boolean;
}

/** What a finished run reports. */
export interface RunSummary {
  score: number;
  bestCombo: number;
  movements: { jumps: number; ducks: number; laneChanges: number; reaches: number };
  totalMovements: number;
  activeSeconds: number;
  avgIntensity: number;
  outcome: 'finished' | 'caught';
}
