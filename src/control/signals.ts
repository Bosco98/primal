import type { FrameFeatures } from '../pose/features.js';
import type { Intensity, FramingIssue, Tracking } from '../types.js';

export function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/**
 * Turns raw movement speed into the effort signal the game spends as a resource.
 *
 * Deliberately crude: mean landmark speed says nothing about whether a movement
 * was hard, only that it happened. It is honest as a pacing hint and dishonest
 * as a calorie count, so nothing should treat it as the latter. Heart rate from
 * a wearable is the real fix.
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

  update(features: FrameFeatures): Intensity {
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
 * Judges whether input can currently be trusted, and — separately — whether the
 * player is standing somewhere the controls can actually work.
 *
 * `playable` is the important one and it is a hard gate, not a hint. Both
 * controls are measured between the hips and the knees, so with the knees out
 * of frame there is no squat line at all and the controls appear broken for a
 * reason the player has no way to guess. Better to say "step back".
 *
 * Note it asks for knees and not feet. It used to ask for feet, because jumps
 * were read from the ankles; they are read from the hips now, and demanding a
 * clear view of someone's shoes to let them play was a tax on nothing.
 */
export function buildTracking(features: FrameFeatures): Tracking {
  if (!features.present) {
    return { present: false, quality: 0, issues: ['no_person'], playable: false };
  }

  const issues: FramingIssue[] = [];
  if (features.torsoLength > TORSO_MAX) issues.push('too_close');
  if (features.torsoLength < TORSO_MIN) issues.push('too_far');
  if (!features.kneesVisible || features.kneeY > 0.985) issues.push('legs_not_visible');

  // Landmark visibility collapses in the dark long before the image looks black
  // to a human, which makes it a decent proxy for "turn a light on".
  if (features.visibility < 0.35) issues.push('low_light');

  let quality = features.visibility;
  if (issues.length > 0) quality *= 0.5;

  // Low light is annoying, not disqualifying. Everything else stops the run.
  const blocking = issues.filter((i) => i !== 'low_light');

  return {
    present: true,
    quality: clamp01(quality),
    issues,
    playable: blocking.length === 0 && features.headY > 0.01,
  };
}

/** One line of plain coaching for the worst current problem. */
export function coachFor(tracking: Tracking): string {
  if (!tracking.present) return 'Step into view of the camera.';
  const [issue] = tracking.issues.filter((i) => i !== 'low_light');
  switch (issue) {
    case 'too_close':
      return "You're too close — take a few steps back.";
    case 'too_far':
      return 'Move a little closer to the camera.';
    case 'legs_not_visible':
      return 'Step back until your knees are in view — both controls are measured from them.';
    default:
      return tracking.issues.includes('low_light')
        ? 'A bit more light would help, but you can play.'
        : 'You are in frame.';
  }
}
