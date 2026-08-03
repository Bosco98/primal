import type { ExerciseId } from '@bosco98/primal-sdk';
import type { Baseline } from './calibration.js';
import type { FrameFeatures } from './features.js';
import { visibleElbowBend } from './exercise-profile.js';
import { ExerciseRecognizer, type ExerciseDefinition, type GuideLines } from './exercise.js';

/**
 * Every exercise the console can count.
 *
 * Each definition answers one question — "how far through this movement is the
 * player right now?" — normalised so `1.0` is the shallowest rep that counts.
 * Everything else (the state machine, hysteresis, dwell, timeouts, form
 * scoring) lives in `exercise.ts` and is shared.
 *
 * ## Adding a new exercise
 *
 * 1. Pick signals from `FrameFeatures` that move monotonically through the
 *    movement, and prefer **two independent ones**. A single signal that the
 *    camera cannot see means a rep that never counts. Squats combine hip drop
 *    (reliable from the front) with knee bend (precise but depth-inferred).
 * 2. Normalise each against the player's calibrated `Baseline`, never against
 *    absolute image or angle values. Bodies and camera distances differ, and an
 *    absolute threshold is what broke squat counting for anyone whose standing
 *    legs measured under 158 degrees.
 * 3. Combine with `Math.max` when either signal alone should be able to carry a
 *    rep, or `mean` when the movement genuinely requires both.
 * 4. Add a fixture generator in `test/synthetic.ts` and assert the count.
 */

/** Travel required to count one rep, expressed in the units of each signal. */
const SQUAT = {
  /** Hip descent, in torso lengths. */
  HIP_TRAVEL: 0.28,
  /** Knee bend below the calibrated standing angle, in degrees. */
  KNEE_TRAVEL: 38,
  /** Beyond this front-to-back stance, it is a lunge and not a squat. */
  LUNGE_REJECT_SPLIT: 0.34,
} as const;

const JACK = {
  /** Wrist rise from the resting position, in torso lengths. */
  ARM_TRAVEL: 1.5,
  /** Extra stance width beyond resting, in torso lengths. */
  LEG_TRAVEL: 0.55,
} as const;

const LUNGE = {
  HIP_TRAVEL: 0.26,
  /** Front-to-back ankle separation, in world torso lengths. */
  SPLIT_TRAVEL: 1.0,
} as const;

const PUSHUP = {
  /** Torso must be at least this far from vertical to be a push-up at all. */
  MIN_TILT_DEG: 45,
  /** Elbow angle when resting at the top. */
  TOP_ANGLE: 168,
  /** Bend below the top, in degrees, to count one rep. */
  ELBOW_TRAVEL: 62,
} as const;

/** Calibration can land on a bad frame; keep the reference physically sane. */
function standingKnee(baseline: Baseline): number {
  return Math.min(179, Math.max(140, baseline.standingKneeAngle));
}

function hipDrop(features: FrameFeatures, baseline: Baseline): number {
  return (features.hipY - baseline.standingHipY) / baseline.torsoLength;
}

export const SQUAT_DEFINITION: ExerciseDefinition = {
  id: 'squat',
  label: 'Squat',
  cue: 'Feet shoulder-width apart. Sit back and down until your thighs are parallel.',
  requires: 'lower',

  progress(features, baseline) {
    // A lunge also drops the hips and bends the knees. Rejecting a split stance
    // stops one movement being counted twice when both are subscribed.
    if (features.ankleSplitZ > SQUAT.LUNGE_REJECT_SPLIT) return 0;

    const byHip = hipDrop(features, baseline) / SQUAT.HIP_TRAVEL;
    const byKnee = (standingKnee(baseline) - features.kneeAngleMean) / SQUAT.KNEE_TRAVEL;
    // Either signal alone can carry the rep; both read zero when standing,
    // because both are measured against this player's own calibrated pose.
    return Math.max(byHip, byKnee);
  },

  goodProgress: 1.6,
  excellentProgress: 2.2,

  asymmetry: (features) => Math.abs(features.kneeAngleLeft - features.kneeAngleRight) / 36,

  extraFlags(peak, baseline) {
    // Knees bent but the hips never moved: a partial, or a tracking artefact.
    return hipDrop(peak, baseline) < 0.14 ? ['partial'] : [];
  },

  guide: (baseline): GuideLines => ({
    restY: baseline.standingHipY,
    targetY: baseline.standingHipY + SQUAT.HIP_TRAVEL * baseline.torsoLength,
    track: 'hip',
    label: 'SQUAT TO HERE',
  }),
};

export const JUMPING_JACK_DEFINITION: ExerciseDefinition = {
  id: 'jumping_jack',
  label: 'Jumping jack',
  cue: 'Jump your feet apart and swing your arms overhead, then back together.',
  requires: 'full',

  progress(features, baseline) {
    const arms = (features.wristRiseMean - baseline.standingWristRise) / JACK.ARM_TRAVEL;
    const legs = (features.ankleSpread - baseline.standingAnkleSpread) / JACK.LEG_TRAVEL;
    // Mean, not max: a jack is arms *and* legs. Raising only the arms should
    // not count, or the exercise quietly becomes something easier.
    return (Math.max(0, arms) + Math.max(0, legs)) / 2;
  },

  goodProgress: 1.25,
  excellentProgress: 1.6,

  // Jacks are quick; the default tempo window would flag every clean rep.
  tempo: { tooFastMs: 300, idealMinMs: 450, idealMaxMs: 1800, tooSlowMs: 3500 },

  asymmetry: (features) => Math.abs(features.wristRiseLeft - features.wristRiseRight) / 0.8,

  guide: (baseline): GuideLines => ({
    restY: baseline.standingShoulderY,
    // Wrists must clear the shoulder line by a good margin.
    targetY: baseline.standingShoulderY - 0.35 * baseline.torsoLength,
    track: 'wrist',
    label: 'HANDS ABOVE HERE',
  }),
};

/**
 * Lunges, labelled beta for an honest reason.
 *
 * What separates a lunge from a squat is the front-to-back foot split, and that
 * lives entirely in MediaPipe's `z` estimate — the axis a single frontal camera
 * infers rather than observes, and by far the noisiest number in the pipeline.
 * The thresholds here are derived from geometry, not from recordings, so they
 * are a starting point to tune against real fixtures rather than a finished
 * recogniser.
 */
export const LUNGE_DEFINITION: ExerciseDefinition = {
  id: 'lunge',
  label: 'Lunge',
  cue: 'Step one foot forward and drop your back knee toward the floor.',
  beta: true,
  requires: 'lower_any',

  progress(features, baseline) {
    const drop = hipDrop(features, baseline) / LUNGE.HIP_TRAVEL;
    const split = features.ankleSplitZ / LUNGE.SPLIT_TRAVEL;
    // Both are required: the split is what separates a lunge from a squat, and
    // the drop is what separates a lunge from simply standing in a split stance.
    return (Math.max(0, drop) + Math.max(0, split)) / 2;
  },

  goodProgress: 1.3,
  excellentProgress: 1.7,

  // Deliberately no `asymmetry`: a lunge is asymmetric by design, and flagging
  // it would punish correct form.

  guide: (baseline): GuideLines => ({
    restY: baseline.standingHipY,
    targetY: baseline.standingHipY + LUNGE.HIP_TRAVEL * baseline.torsoLength,
    track: 'hip',
    label: 'DROP TO HERE',
  }),
};

/**
 * Push-ups, honestly labelled beta.
 *
 * A console webcam sits at eye height looking at a standing player. A push-up
 * puts the body flat on the floor, usually side-on or foreshortened, often with
 * the legs out of frame — the worst case for a model that infers depth from a
 * frontal view. This definition works when the camera can see the player from
 * the side, and is unreliable otherwise. It ships flagged rather than hidden so
 * a game can choose to avoid it, and a player is told why it is struggling
 * instead of concluding the console is broken.
 */
export const PUSHUP_DEFINITION: ExerciseDefinition = {
  id: 'pushup',
  label: 'Push-up',
  cue: 'Set up side-on to the camera so it can see your body line.',
  beta: true,
  requires: 'upper_any',

  progress(features) {
    if (features.torsoTiltDeg < PUSHUP.MIN_TILT_DEG) return 0;
    return (visibleElbowBend(features) - (180 - PUSHUP.TOP_ANGLE)) / PUSHUP.ELBOW_TRAVEL;
  },

  goodProgress: 1.25,
  excellentProgress: 1.55,

  tempo: { tooFastMs: 500, idealMinMs: 800, idealMaxMs: 3000, tooSlowMs: 5500 },

  asymmetry: (features) => Math.abs(features.elbowAngleLeft - features.elbowAngleRight) / 40,

};

export const EXERCISE_DEFINITIONS: readonly ExerciseDefinition[] = [
  SQUAT_DEFINITION,
  JUMPING_JACK_DEFINITION,
  LUNGE_DEFINITION,
  PUSHUP_DEFINITION,
];

const BY_ID = new Map<ExerciseId, ExerciseDefinition>(
  EXERCISE_DEFINITIONS.map((definition) => [definition.id, definition]),
);

/** Everything the console can count, including beta-quality recognisers. */
export const AVAILABLE_EXERCISES: readonly ExerciseId[] = EXERCISE_DEFINITIONS.map((d) => d.id);

/** The subset a game can rely on without caveats. */
export const STABLE_EXERCISES: readonly ExerciseId[] = EXERCISE_DEFINITIONS.filter(
  (d) => !d.beta,
).map((d) => d.id);

export function definitionFor(exercise: ExerciseId): ExerciseDefinition | null {
  return BY_ID.get(exercise) ?? null;
}

export function createRecognizer(exercise: ExerciseId): ExerciseRecognizer | null {
  const definition = definitionFor(exercise);
  return definition ? new ExerciseRecognizer(definition) : null;
}
