import type { GestureId } from '@bosco98/primal-sdk';
import type { Baseline } from './calibration.js';
import type { FrameFeatures } from './features.js';
import { clamp01 } from './recognizer.js';

export interface GestureEvent {
  gesture: GestureId;
  state: 'start' | 'end';
  confidence: number;
}

/**
 * Mirroring, defined once.
 *
 * MediaPipe reports image coordinates as the camera sees them, so the player's
 * left side sits at a *higher* x. The console preview is mirrored, like a
 * bathroom mirror, so a player leaning to their own left sees themselves move
 * to screen-left, and the game must agree. Every sign convention below follows
 * from that: `lean` is negative for the player's left.
 */
export function signedLean(features: FrameFeatures, baseline: Baseline): number {
  const range = Math.max(1e-3, baseline.shoulderWidth * 1.15);
  return Math.max(-1, Math.min(1, (baseline.centerX - features.shoulderCenterX) / range));
}

/** How far the hips have dropped, in torso lengths. */
export function crouchDepth(features: FrameFeatures, baseline: Baseline): number {
  return (features.hipY - baseline.standingHipY) / baseline.torsoLength;
}

/**
 * Enter and exit thresholds differ everywhere: a signal sitting on a single
 * boundary would otherwise chatter start/end events every frame.
 */
const T = {
  LEAN_ENTER: 0.42,
  LEAN_EXIT: 0.26,
  CROUCH_ENTER: 0.20,
  CROUCH_EXIT: 0.11,
  /** Ankles rising above their standing height, in torso lengths. */
  JUMP_ENTER: 0.07,
  JUMP_EXIT: 0.03,
  /** Wrist speed in torso lengths per second. */
  PUNCH_SPEED: 3.2,
  PUNCH_RELEASE_SPEED: 1.6,
  /** Elbow must be extending, not tucked. */
  PUNCH_ELBOW: 132,
  /** Wrists above the shoulder line, in torso lengths. */
  BLOCK_ENTER: 0.16,
  BLOCK_EXIT: 0.06,
} as const;

/** A gesture must persist this long before `end` fires, so a blip is not a punch. */
const MIN_HOLD_MS = 60;

interface HeldState {
  active: boolean;
  since: number;
}

/**
 * Detects the low-latency, edge-triggered part of the vocabulary.
 *
 * Unlike rep counting, this path is latency-critical: a block that registers
 * 200ms late is a block that failed. So every gesture here is decided from the
 * current frame plus hysteresis, never from a multi-frame window.
 */
export class GestureRecognizer {
  private readonly held = new Map<GestureId, HeldState>();

  reset(): void {
    this.held.clear();
  }

  /** Which gestures are currently held down. */
  isActive(gesture: GestureId): boolean {
    return this.held.get(gesture)?.active ?? false;
  }

  update(features: FrameFeatures, baseline: Baseline): GestureEvent[] {
    const events: GestureEvent[] = [];

    if (!features.present) {
      // Release everything: a player who vanished is not still blocking.
      for (const [gesture, state] of this.held) {
        if (state.active) {
          state.active = false;
          events.push({ gesture, state: 'end', confidence: 1 });
        }
      }
      return events;
    }

    const lean = signedLean(features, baseline);
    const crouch = crouchDepth(features, baseline);
    const ankleRise = (baseline.ankleY - features.ankleY) / baseline.torsoLength;

    this.evaluate(
      events,
      'lean_left',
      -lean > T.LEAN_ENTER,
      -lean > T.LEAN_EXIT,
      features.t,
      clamp01(-lean),
    );
    this.evaluate(
      events,
      'lean_right',
      lean > T.LEAN_ENTER,
      lean > T.LEAN_EXIT,
      features.t,
      clamp01(lean),
    );

    // A jump lifts the ankles; a crouch drops the hips. Requiring the legs to
    // be visible keeps a seated player from triggering either.
    if (features.lowerBodyVisible) {
      this.evaluate(
        events,
        'crouch',
        crouch > T.CROUCH_ENTER && ankleRise < T.JUMP_ENTER,
        crouch > T.CROUCH_EXIT,
        features.t,
        clamp01(crouch / 0.5),
      );
      this.evaluate(
        events,
        'jump',
        ankleRise > T.JUMP_ENTER,
        ankleRise > T.JUMP_EXIT,
        features.t,
        clamp01(ankleRise / 0.2),
      );
    }

    if (features.upperBodyVisible) {
      const blocking =
        features.wristRiseLeft > T.BLOCK_ENTER && features.wristRiseRight > T.BLOCK_ENTER;
      const stillBlocking =
        features.wristRiseLeft > T.BLOCK_EXIT && features.wristRiseRight > T.BLOCK_EXIT;
      this.evaluate(events, 'block', blocking, stillBlocking, features.t, 0.9);

      // Blocking and punching are mutually exclusive; hands up is a guard.
      if (!this.isActive('block')) {
        this.evaluatePunch(events, features, 'punch_left');
        this.evaluatePunch(events, features, 'punch_right');
      }
    }

    return events;
  }

  private evaluatePunch(
    events: GestureEvent[],
    features: FrameFeatures,
    gesture: 'punch_left' | 'punch_right',
  ): void {
    // The player's left hand throws punch_left.
    const speed = gesture === 'punch_left' ? features.wristSpeedLeft : features.wristSpeedRight;
    const elbow = gesture === 'punch_left' ? features.elbowAngleLeft : features.elbowAngleRight;

    const thrown = speed > T.PUNCH_SPEED && elbow > T.PUNCH_ELBOW;
    const stillOut = speed > T.PUNCH_RELEASE_SPEED;
    this.evaluate(events, gesture, thrown, stillOut, features.t, clamp01(speed / (T.PUNCH_SPEED * 2)));
  }

  private evaluate(
    events: GestureEvent[],
    gesture: GestureId,
    enterCondition: boolean,
    stayCondition: boolean,
    now: number,
    confidence: number,
  ): void {
    let state = this.held.get(gesture);
    if (!state) {
      state = { active: false, since: 0 };
      this.held.set(gesture, state);
    }

    if (!state.active && enterCondition) {
      state.active = true;
      state.since = now;
      events.push({ gesture, state: 'start', confidence });
      return;
    }

    if (state.active && !stayCondition && now - state.since >= MIN_HOLD_MS) {
      state.active = false;
      events.push({ gesture, state: 'end', confidence });
    }
  }
}
