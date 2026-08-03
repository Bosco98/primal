import type { FrameFeatures } from '../pose/features.js';
import type { Action, Band, Body } from '../types.js';

/**
 * Zone controls — the calibration-free input scheme.
 *
 * The older path (`gestures.ts`) measures everything against a personal
 * baseline captured by standing still for two seconds. That is the right model
 * for rep counting, where "how deep is your squat *for you*" is the question.
 * It is the wrong model for a runner, and it costs the player a ritual before
 * they can play at all.
 *
 * Here the controls are a grid drawn on the camera preview. The player sees
 * themselves inside it and moves to the marks:
 *
 *        LEFT       CENTRE      RIGHT
 *      ┌──────────┬──────────┬──────────┐
 *      │    ·     │    ·     │    ·     │   ── JUMP line
 *      ├──────────┼──────────┼──────────┤
 *      │    ●     │    ●     │    ●     │   ← stand in a band
 *      ├──────────┼──────────┼──────────┤
 *      │    ·     │    ·     │    ·     │   ── DUCK line
 *      └──────────┴──────────┴──────────┘
 *
 * Horizontal bands are absolute screen regions — nothing to learn, you simply
 * stand left, centre or right of frame, and hop between them.
 *
 * Vertical lines cannot be absolute, because where your feet land in frame
 * depends on how far back you are standing. They track a rolling percentile of
 * your own body instead: the ground reference is where your ankles *usually*
 * are, the standing reference is where your hips *usually* are. That adapts
 * continuously with no ritual and no waiting, and — crucially — the lines are
 * drawn on screen at their live positions, so the player can always see exactly
 * where the threshold is relative to their own body.
 */

/** How the play area is divided. Screen space (already mirrored), 0..1. */
export const ZONES = {
  /** A band edge. Enter decisively, leave reluctantly, so a wobble is not a hop. */
  BAND_ENTER: 0.20,
  BAND_EXIT: 0.12,
  /** Ankles must rise this far above the ground reference, in torso lengths. */
  JUMP_RISE: 0.07,
  JUMP_RELEASE: 0.03,
  /** Hips must drop this far below the standing reference, in torso lengths. */
  DUCK_DROP: 0.18,
  DUCK_RELEASE: 0.10,
  /** Frames of history behind the rolling references (~2s at 30Hz). */
  HISTORY: 60,
} as const;

/** Everything the controller overlay needs to draw itself. */
export interface ZoneState {
  /** True once there is enough history for the vertical lines to mean anything. */
  ready: boolean;
  present: boolean;
  /** Player position in screen space, 0..1, mirrored. */
  playerX: number;
  playerY: number;
  band: Band;
  /** Screen-space y of the live thresholds, for drawing. */
  jumpLineY: number;
  duckLineY: number;
  groundY: number;
  standY: number;
  jumping: boolean;
  ducking: boolean;
  /** 0..1 how far through a duck the player currently is. */
  duckProgress: number;
}

const EMPTY: ZoneState = {
  ready: false,
  present: false,
  playerX: 0.5,
  playerY: 0.5,
  band: 0,
  jumpLineY: 0.35,
  duckLineY: 0.75,
  groundY: 0.9,
  standY: 0.55,
  jumping: false,
  ducking: false,
  duckProgress: 0,
};

export class ZoneRecognizer {
  private ankleHistory: number[] = [];
  private hipHistory: number[] = [];
  private band: Band = 0;
  private jumping = false;
  private ducking = false;
  private state: ZoneState = { ...EMPTY };

  reset(): void {
    this.ankleHistory = [];
    this.hipHistory = [];
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

    this.push(this.ankleHistory, features.ankleY);
    this.push(this.hipHistory, features.hipY);

    // Ground = where the ankles usually are. A jump makes ankleY smaller, so a
    // high percentile ignores jumps rather than being dragged down by them.
    const groundY = percentile(this.ankleHistory, 0.8);
    // Standing = where the hips usually are. A squat makes hipY larger, so a
    // low percentile ignores squats.
    const standY = percentile(this.hipHistory, 0.2);

    const rise = (groundY - features.ankleY) / torso;
    const drop = (features.hipY - standY) / torso;

    const events: Action[] = [];
    const ready = this.ankleHistory.length >= 20;

    if (ready && features.lowerBodyVisible) {
      this.edge(events, 'JUMP', rise > ZONES.JUMP_RISE, rise > ZONES.JUMP_RELEASE, 'jumping');
      // A player in the air is not squatting, whatever the hips say.
      this.edge(
        events,
        'DUCK',
        drop > ZONES.DUCK_DROP && rise < ZONES.JUMP_RISE,
        drop > ZONES.DUCK_RELEASE,
        'ducking',
      );
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
      groundY,
      standY,
      jumpLineY: groundY - ZONES.JUMP_RISE * torso,
      duckLineY: standY + ZONES.DUCK_DROP * torso,
      jumping: this.jumping,
      ducking: this.ducking,
      duckProgress: clamp01(drop / ZONES.DUCK_DROP),
    };

    return events;
  }

  /**
   * A `BodyPayload` with no baseline behind it.
   *
   * `lean` is the player's actual position across the play area rather than a
   * displacement from a remembered neutral, which means it cannot drift — the
   * problem the old path needed re-baselining to survive.
   */
  body(features: FrameFeatures): Body {
    const s = this.state;
    const torso = Math.max(1e-3, features.torsoLength);
    const drop = (features.hipY - s.standY) / torso;
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
      crouch: clamp01(drop / 0.45),
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
