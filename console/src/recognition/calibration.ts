import type { TrackingIssue } from '@bosco98/primal-sdk';
import type { FrameFeatures } from './features.js';

/**
 * The standing reference every recogniser measures against.
 *
 * Thresholds are expressed relative to these numbers rather than in absolute
 * image units, which is the whole reason one squat threshold works for a tall
 * player three metres back and a short player at a metre and a half.
 */
export interface Baseline {
  standingHipY: number;
  standingShoulderY: number;
  standingKneeAngle: number;
  torsoLength: number;
  shoulderWidth: number;
  /** Horizontal centre of the play area, used for lean. */
  centerX: number;
  ankleY: number;
  /** Resting stance width, in torso lengths. Jumping jacks measure against it. */
  standingAnkleSpread: number;
  /** Resting wrist height relative to the shoulders. Negative: arms hang down. */
  standingWristRise: number;
  capturedAt: number;
}

export type CalibrationPhase =
  | 'idle'
  | 'waiting_for_person'
  | 'framing'
  | 'hold_still'
  | 'done';

export interface CalibrationState {
  phase: CalibrationPhase;
  /** 0..1 through the hold-still capture. */
  progress: number;
  issues: TrackingIssue[];
  message: string;
  baseline: Baseline | null;
}

/** Torso length (image units) that reads as a sensible standing distance. */
const TORSO_MIN = 0.09;
const TORSO_MAX = 0.34;
/** How long the player must hold a good standing pose. */
const HOLD_MS = 2000;
/** Movement above this (torso lengths/sec) counts as not holding still. */
const STILL_SPEED = 0.55;

export class Calibrator {
  private phase: CalibrationPhase = 'idle';
  private holdStartedAt = 0;
  private samples: FrameFeatures[] = [];
  private baseline: Baseline | null = null;

  start(): void {
    this.phase = 'waiting_for_person';
    this.holdStartedAt = 0;
    this.samples = [];
    this.baseline = null;
  }

  reset(): void {
    this.phase = 'idle';
    this.holdStartedAt = 0;
    this.samples = [];
    this.baseline = null;
  }

  get current(): Baseline | null {
    return this.baseline;
  }

  /** Adopt a previously saved baseline, skipping the wizard. */
  restore(baseline: Baseline): void {
    this.baseline = baseline;
    this.phase = 'done';
  }

  update(features: FrameFeatures): CalibrationState {
    if (this.phase === 'idle' || this.phase === 'done') {
      return this.state(this.phase === 'done' ? 'Calibrated.' : '', 0, []);
    }

    if (!features.present) {
      this.phase = 'waiting_for_person';
      this.resetHold();
      return this.state('Step into view of the camera.', 0, ['not_in_frame']);
    }

    const issues = this.checkFraming(features);
    if (issues.length > 0) {
      this.phase = 'framing';
      this.resetHold();
      return this.state(this.describe(issues), 0, issues);
    }

    if (features.overallSpeed > STILL_SPEED) {
      this.phase = 'hold_still';
      this.resetHold();
      return this.state('Stand still, arms relaxed at your sides.', 0, []);
    }

    // Framing is good and the player is still: accumulate the hold.
    this.phase = 'hold_still';
    if (this.holdStartedAt === 0) this.holdStartedAt = features.t;
    this.samples.push(features);

    const held = features.t - this.holdStartedAt;
    const progress = Math.min(1, held / HOLD_MS);

    if (held >= HOLD_MS && this.samples.length >= 10) {
      this.baseline = this.buildBaseline(features.t);
      this.phase = 'done';
      return this.state('Calibrated.', 1, []);
    }

    return this.state('Hold still…', progress, []);
  }

  /**
   * Standing height drifts when a player steps closer or further mid-session.
   * Left uncorrected, every depth threshold silently changes meaning.
   */
  needsRecalibration(features: FrameFeatures): boolean {
    if (!this.baseline || !features.present) return false;
    const drift = Math.abs(features.torsoLength - this.baseline.torsoLength) / this.baseline.torsoLength;
    return drift > 0.2;
  }

  private checkFraming(features: FrameFeatures): TrackingIssue[] {
    const issues: TrackingIssue[] = [];

    if (features.visibility < 0.5 || !features.lowerBodyVisible) {
      issues.push('not_in_frame');
      return issues;
    }
    if (features.torsoLength > TORSO_MAX) issues.push('too_close');
    if (features.torsoLength < TORSO_MIN) issues.push('too_far');

    // Whole body must actually be inside the frame, not merely inferred.
    const headCut = features.headY < 0.02;
    const feetCut = features.ankleY > 0.99;
    if (headCut || feetCut) issues.push('not_in_frame');

    return issues;
  }

  private describe(issues: TrackingIssue[]): string {
    if (issues.includes('too_close')) return 'Step back — I need to see your whole body.';
    if (issues.includes('too_far')) return 'Step a little closer.';
    if (issues.includes('not_in_frame')) return 'Move so your head and feet are both in frame.';
    if (issues.includes('low_light')) return 'It is too dark — turn on a light.';
    return 'Adjusting…';
  }

  private buildBaseline(t: number): Baseline {
    // Median, not mean: one bad frame during the hold should not shift the
    // reference every later threshold is derived from.
    const median = (pick: (f: FrameFeatures) => number): number => {
      const values = this.samples.map(pick).sort((a, b) => a - b);
      const mid = Math.floor(values.length / 2);
      return values.length % 2 === 0 ? (values[mid - 1]! + values[mid]!) / 2 : values[mid]!;
    };

    return {
      standingHipY: median((f) => f.hipY),
      standingShoulderY: median((f) => f.shoulderY),
      standingKneeAngle: median((f) => f.kneeAngleMean),
      torsoLength: median((f) => f.torsoLength),
      shoulderWidth: median((f) => f.shoulderWidth),
      centerX: median((f) => f.shoulderCenterX),
      ankleY: median((f) => f.ankleY),
      standingAnkleSpread: median((f) => f.ankleSpread),
      standingWristRise: median((f) => f.wristRiseMean),
      capturedAt: t,
    };
  }

  private resetHold(): void {
    this.holdStartedAt = 0;
    this.samples = [];
  }

  private state(message: string, progress: number, issues: TrackingIssue[]): CalibrationState {
    return { phase: this.phase, progress, issues, message, baseline: this.baseline };
  }
}

/**
 * Bump this whenever the meaning of a baseline field changes. Squat thresholds
 * are now derived from `standingKneeAngle`, so a baseline captured before that
 * would silently produce wrong depth targets — better to recalibrate than to
 * trust a reference that means something different than it used to.
 */
const STORAGE_KEY = 'primal.baseline.v3';

export function saveBaseline(baseline: Baseline): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(baseline));
  } catch {
    // Private browsing or a full quota; calibration simply won't persist.
  }
}

export function loadBaseline(): Baseline | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Baseline;
    return typeof parsed?.torsoLength === 'number' ? parsed : null;
  } catch {
    return null;
  }
}
