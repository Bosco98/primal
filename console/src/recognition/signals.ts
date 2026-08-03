import type { BodyPayload, IntensityPayload, TrackingIssue, TrackingStatusPayload } from '@bosco98/primal-sdk';
import type { Baseline } from './calibration.js';
import type { FrameFeatures } from './features.js';
import { crouchDepth, signedLean } from './gestures.js';
import { clamp01 } from './recognizer.js';

/**
 * Builds the continuous `input/body` payload.
 *
 * This is the single place image coordinates become screen coordinates, and the
 * single place the mirror is applied. Games receive a world where the player's
 * left hand is on the left of the screen, matching the preview they can see.
 */
export function buildBody(features: FrameFeatures, baseline: Baseline): BodyPayload {
  const mirror = (x: number): number => 1 - x;

  return {
    hands: {
      left: {
        x: mirror(features.wristLeft.x),
        y: features.wristLeft.y,
        visible: features.wristLeft.visibility > 0.5,
      },
      right: {
        x: mirror(features.wristRight.x),
        y: features.wristRight.y,
        visible: features.wristRight.visibility > 0.5,
      },
    },
    bodyCenter: { x: mirror(features.hipCenterX), y: features.hipY },
    head: { x: mirror(features.shoulderCenterX), y: features.headY },
    lean: signedLean(features, baseline),
    crouch: clamp01(crouchDepth(features, baseline) / 0.45),
  };
}

/**
 * Turns raw movement speed into the effort signal games spend as a resource.
 *
 * Deliberately crude: mean landmark speed says nothing about whether a movement
 * was hard, only that it happened. It is honest as a pacing hint and dishonest
 * as a calorie count, so nothing should treat it as the latter. Heart rate from
 * a wearable is the real fix, and is on the roadmap.
 */
export class IntensityTracker {
  private instant = 0;
  private readonly window: Array<{ t: number; value: number }> = [];

  /** Movement speed, in torso lengths per second, that reads as all-out effort. */
  private static readonly FULL_EFFORT_SPEED = 2.6;
  private static readonly WINDOW_MS = 10_000;

  reset(): void {
    this.instant = 0;
    this.window.length = 0;
  }

  update(features: FrameFeatures): IntensityPayload {
    const raw = features.present
      ? clamp01(features.overallSpeed / IntensityTracker.FULL_EFFORT_SPEED)
      : 0;

    // Smooth hard: single-frame speed is far too noisy to show a player.
    this.instant = this.instant * 0.88 + raw * 0.12;

    this.window.push({ t: features.t, value: this.instant });
    const cutoff = features.t - IntensityTracker.WINDOW_MS;
    while (this.window.length > 0 && this.window[0]!.t < cutoff) {
      this.window.shift();
    }

    const avg10s =
      this.window.reduce((sum, entry) => sum + entry.value, 0) / Math.max(1, this.window.length);

    return { instant: this.instant, avg10s };
  }
}

const TORSO_MIN = 0.09;
const TORSO_MAX = 0.34;

/**
 * Judges whether input can currently be trusted.
 *
 * Games use this to degrade gracefully rather than punishing a player for the
 * camera's problems: a run should pause when tracking drops, never end.
 */
export function buildTrackingStatus(
  features: FrameFeatures,
  baseline: Baseline | null,
): TrackingStatusPayload {
  if (!features.present) {
    return { personDetected: false, quality: 0, issues: ['not_in_frame'] };
  }

  const issues: TrackingIssue[] = [];
  if (features.torsoLength > TORSO_MAX) issues.push('too_close');
  if (features.torsoLength < TORSO_MIN) issues.push('too_far');
  if (features.headY < 0.02 || features.ankleY > 0.99) issues.push('not_in_frame');
  if (!features.lowerBodyVisible && !features.upperBodyVisible) issues.push('not_in_frame');

  // Landmark visibility collapses in the dark long before the image looks black
  // to a human, which makes it a decent proxy for "turn a light on".
  if (features.visibility < 0.35) issues.push('low_light');

  let quality = features.visibility;
  if (baseline) {
    const drift = Math.abs(features.torsoLength - baseline.torsoLength) / baseline.torsoLength;
    quality *= clamp01(1 - drift);
  }
  if (issues.length > 0) quality *= 0.5;

  return { personDetected: true, quality: clamp01(quality), issues };
}
