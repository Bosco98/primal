import type { FrameFeatures } from '../pose/features.js';
import type { Action, Band, Body } from '../types.js';

/**
 * Zone controls — the calibration-free input scheme.
 *
 * The player sees themselves inside a grid and moves to the marks:
 *
 *        LEFT       CENTRE      RIGHT
 *      ┌──────────┬──────────┬──────────┐
 *      │          │          │          │
 *      │ ─────────────────────────────  │  ── JUMP   hips above this
 *      │    ●     │    ●     │    ●     │  ·· STAND  where your hips live
 *      │ ─────────────────────────────  │  ── SQUAT  hips below this
 *      │          │  (knees) │          │
 *      └──────────┴──────────┴──────────┘
 *
 * Horizontal bands are absolute screen regions — nothing to learn, you simply
 * stand left, centre or right of frame and hop between them.
 *
 * The two vertical lines both hang off a single tracked point, **the hips**,
 * and a single reference, the standing baseline. That is the important property
 * and it is deliberate. An earlier version measured the jump from the *ankles*
 * against a ground reference and the squat from the *hips* against a standing
 * reference: two different body parts, two independent references, drawn as two
 * lines on one picture. Nothing stopped them meeting, and when the player's
 * feet left the frame they did exactly that — the ground reference collapsed to
 * the bottom edge and both lines piled up in the middle of the screen.
 *
 * Now:
 *
 *      jumpLine  = stand − JUMP_RISE · torso
 *      squatLine = stand + SQUAT_DEPTH · (knee − stand)
 *
 * with `knee − stand` floored below. So `jumpLine < stand < squatLine` holds by
 * construction, for every body, at every distance from the camera. The two
 * lines cannot converge because there is no arithmetic that brings them
 * together.
 *
 * It also makes the moves mutually exclusive for free: a rise and a drop are
 * the same subtraction with opposite signs, so no frame can be both.
 *
 * And it drops the requirement to see feet. Hips and knees carry both controls,
 * and they are the landmarks least likely to be cropped or occluded — the two
 * things a webcam always has a clear view of when someone stands up to play.
 */

/** How the play area is divided. Screen space (already mirrored), 0..1. */
export const ZONES = {
  /** A band edge. Enter decisively, leave reluctantly, so a wobble is not a hop. */
  BAND_ENTER: 0.20,
  BAND_EXIT: 0.12,
  /**
   * Hips must rise this far above the standing baseline, in torso lengths.
   * ~0.12 torso is about 6cm on an adult: unmistakably a hop, and well clear of
   * the couple of centimetres you gain rolling onto your toes.
   */
  JUMP_RISE: 0.12,
  JUMP_RELEASE: 0.05,
  /**
   * Hips must drop this fraction of the way from standing to knee height.
   * 1.0 would be a parallel squat; 0.62 is roughly a half squat — real work for
   * the legs, but repeatable at the pace a runner asks for.
   */
  SQUAT_DEPTH: 0.62,
  SQUAT_RELEASE: 0.34,
  /**
   * Hip-to-knee distance sits near 0.7 torso lengths standing. Clamping it
   * stops one bad knee frame from throwing the squat line onto the baseline or
   * off the bottom of the picture.
   */
  SPAN_MIN: 0.45,
  SPAN_MAX: 1.1,
  /** Frames of history behind the baseline (~2s at 30Hz). */
  HISTORY: 60,
} as const;

/** Everything the controller overlay needs to draw itself. */
export interface ZoneState {
  /** True once there is enough history for the baseline to mean anything. */
  ready: boolean;
  present: boolean;
  /** Player position in screen space, 0..1, mirrored. */
  playerX: number;
  playerY: number;
  band: Band;
  /** Screen-space y of the live thresholds, for drawing. */
  jumpLineY: number;
  squatLineY: number;
  /** The baseline itself, and where the knees are, both drawn as references. */
  standY: number;
  kneeY: number;
  jumping: boolean;
  ducking: boolean;
  /** 0..1 how far through a squat the player currently is. 1 is the line. */
  duckProgress: number;
  /** 0..1 how far through a jump. 1 is the line. */
  jumpProgress: number;
}

const EMPTY: ZoneState = {
  ready: false,
  present: false,
  playerX: 0.5,
  playerY: 0.5,
  band: 0,
  jumpLineY: 0.42,
  squatLineY: 0.66,
  standY: 0.55,
  kneeY: 0.72,
  jumping: false,
  ducking: false,
  duckProgress: 0,
  jumpProgress: 0,
};

export class ZoneRecognizer {
  private hipHistory: number[] = [];
  private kneeHistory: number[] = [];
  private band: Band = 0;
  private jumping = false;
  private ducking = false;
  private state: ZoneState = { ...EMPTY };

  reset(): void {
    this.hipHistory = [];
    this.kneeHistory = [];
    this.band = 0;
    this.jumping = false;
    this.ducking = false;
    this.state = { ...EMPTY };
  }

  get current(): ZoneState {
    return this.state;
  }

  update(features: FrameFeatures): Action[] {
    if (!features.present) {
      const events = this.releaseAll();
      this.state = { ...this.state, present: false };
      return events;
    }

    // MediaPipe reports image coordinates as the camera sees them, so the
    // player's left sits at a HIGHER x. The preview is mirrored like a bathroom
    // mirror, so screen space is 1 - image x. Do this once, here.
    const playerX = 1 - features.hipCenterX;
    const torso = Math.max(1e-3, features.torsoLength);

    // Only sample the baseline while the player is neither jumping nor
    // squatting. A percentile alone is not enough: hold a squat for a few
    // seconds and even a low percentile follows you down, at which point simply
    // standing back up reads as a jump. Freezing while a move is held means the
    // baseline is always "where your hips rest", never "where they have been".
    if (!this.jumping && !this.ducking) {
      this.push(this.hipHistory, features.hipY);
      this.push(this.kneeHistory, features.kneeY);
    }

    const ready = this.hipHistory.length >= 20;
    // The 20th percentile is the hips near the top of their resting range, which
    // is standing rather than mid-shift.
    const standY = percentile(this.hipHistory, 0.2);
    const kneeRef = percentile(this.kneeHistory, 0.5);
    const span = clamp(ZONES.SPAN_MIN * torso, ZONES.SPAN_MAX * torso, kneeRef - standY);

    const rise = (standY - features.hipY) / torso;
    const depth = (features.hipY - standY) / span;

    const events: Action[] = [];

    // Knees, not ankles: these are the landmarks both lines are built from.
    if (ready && features.kneesVisible) {
      this.edge(events, 'JUMP', rise > ZONES.JUMP_RISE, rise > ZONES.JUMP_RELEASE, 'jumping');
      // No exclusion guard needed. `rise` and `depth` are the same difference
      // with opposite signs, so one is negative whenever the other is positive.
      this.edge(events, 'DUCK', depth > ZONES.SQUAT_DEPTH, depth > ZONES.SQUAT_RELEASE, 'ducking');
    }

    // The band is a position, not an event: the game reads `state.band` and
    // that is the lane. Nothing to buffer, nothing to miss, nothing to drift.
    this.band = this.bandFor(playerX);

    this.state = {
      ready,
      present: true,
      playerX,
      playerY: features.hipY,
      band: this.band,
      standY,
      kneeY: kneeRef,
      jumpLineY: standY - ZONES.JUMP_RISE * torso,
      squatLineY: standY + ZONES.SQUAT_DEPTH * span,
      jumping: this.jumping,
      ducking: this.ducking,
      duckProgress: clamp01(depth / ZONES.SQUAT_DEPTH),
      jumpProgress: clamp01(rise / ZONES.JUMP_RISE),
    };

    return events;
  }

  /**
   * Continuous body state, with no baseline ritual behind it.
   *
   * `lean` is the player's actual position across the play area rather than a
   * displacement from a remembered neutral, which means it cannot drift.
   */
  body(features: FrameFeatures): Body {
    const s = this.state;
    return {
      hands: {
        left: {
          x: 1 - features.wristRight.x,
          y: features.wristRight.y,
          visible: (features.wristRight.visibility ?? 1) > 0.4,
        },
        right: {
          x: 1 - features.wristLeft.x,
          y: features.wristLeft.y,
          visible: (features.wristLeft.visibility ?? 1) > 0.4,
        },
      },
      center: { x: s.playerX, y: features.hipY },
      head: { x: 1 - features.shoulderCenterX, y: features.headY },
      lean: clamp(-1, 1, (s.playerX - 0.5) / 0.3),
      // Now a genuine squat depth: 0 standing, 1 hips level with the knees.
      crouch: clamp01((features.hipY - s.standY) / Math.max(1e-3, s.kneeY - s.standY)),
    };
  }

  private bandFor(playerX: number): Band {
    const offset = playerX - 0.5;
    if (this.band !== -1 && offset < -ZONES.BAND_ENTER) return -1;
    if (this.band !== 1 && offset > ZONES.BAND_ENTER) return 1;
    if (this.band === -1 && offset > -ZONES.BAND_EXIT) return 0;
    if (this.band === 1 && offset < ZONES.BAND_EXIT) return 0;
    return this.band;
  }

  /** Fire once on the way in; the hysteresis gap stops a wobble re-triggering. */
  private edge(
    events: Action[],
    action: Action,
    enter: boolean,
    stay: boolean,
    flag: 'jumping' | 'ducking',
  ): void {
    if (!this[flag] && enter) {
      this[flag] = true;
      events.push(action);
    } else if (this[flag] && !stay) {
      this[flag] = false;
    }
  }

  /** A player who vanished is not still holding anything. */
  private releaseAll(): Action[] {
    this.jumping = false;
    this.ducking = false;
    this.band = 0;
    return [];
  }

  private push(history: number[], value: number): void {
    history.push(value);
    if (history.length > ZONES.HISTORY) history.shift();
  }
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0.5;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * p))]!;
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(lo: number, hi: number, v: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
