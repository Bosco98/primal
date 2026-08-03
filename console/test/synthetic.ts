import { LANDMARK_COUNT, LM } from '../src/pose/landmarks.js';
import type { Landmark, PoseFixture, PoseFrame } from '../src/pose/types.js';

/**
 * A synthetic body, posed by inverse kinematics.
 *
 * Real recorded fixtures are the ground truth for accuracy work, but they can
 * only be produced by a human in front of a camera. Synthetic poses cover what
 * recordings cannot: exact depths, exact tempos, and deliberately pathological
 * input (a 40-degree-deep bounce, a rep at 4x speed, one leg lagging the
 * other). Both feed the same recognisers through the same `PoseFrame` shape.
 *
 * Geometry: the legs are a two-link chain in the sagittal (y/z) plane. Given a
 * knee angle, the hip-to-ankle distance follows from the law of cosines, the
 * ankle stays planted, and the hip descends — which is exactly how a squat
 * presents to a front-facing camera, and why knee angle is recoverable from
 * MediaPipe's world landmarks despite the legs looking vertical in the image.
 */

const THIGH = 0.42;
const SHIN = 0.42;
const TORSO = 0.50;
const UPPER_ARM = 0.30;
const FOREARM = 0.27;
const SHOULDER_HALF_WIDTH = 0.19;
const HIP_HALF_WIDTH = 0.11;

/** Metres to image units, for a player framed full-body at a sensible distance. */
const IMAGE_SCALE = 0.476;
const ANKLE_IMAGE_Y = 0.92;
const CENTER_X = 0.5;

export interface PoseOptions {
  /** Mean knee angle in degrees. 175 is standing, 90 is thighs-parallel. */
  kneeAngle?: number;
  /** Degrees of difference between the left and right knee. */
  kneeAsymmetry?: number;
  /** Sideways shift of the whole body in image units. */
  leanX?: number;
  /** Raise both wrists this fraction of the way overhead (0..1). */
  armsOverhead?: number;
  /** Horizontal ankle separation in metres. Standing is ~0.20. */
  ankleSpread?: number;
  /** Lift the whole body off the floor, in metres. */
  airborne?: number;
  /**
   * Front-to-back foot separation in metres: the left foot steps forward and
   * the right steps back. This is what distinguishes a lunge from a squat.
   */
  splitZ?: number;
  /** Applied to every landmark's visibility. */
  visibility?: number;
}

/** Hip-to-ankle distance and knee offset for a given knee angle. */
function legChain(kneeAngleDeg: number): { reach: number; kneeY: number; kneeZ: number } {
  const theta = (kneeAngleDeg * Math.PI) / 180;
  const reach = Math.sqrt(
    THIGH * THIGH + SHIN * SHIN - 2 * THIGH * SHIN * Math.cos(theta),
  );
  // Two-link IK with the ankle directly below the hip.
  const kneeY = (reach * reach + THIGH * THIGH - SHIN * SHIN) / (2 * Math.max(reach, 1e-6));
  const kneeZ = Math.sqrt(Math.max(0, THIGH * THIGH - kneeY * kneeY));
  return { reach, kneeY, kneeZ };
}

function landmark(x: number, y: number, z: number, visibility: number): Landmark {
  return { x, y, z, visibility };
}

/**
 * Build one pose. Returns both coordinate systems the pipeline consumes:
 * world landmarks in metres about the hip midpoint, and image landmarks
 * normalised to 0..1 with y down.
 */
export function makePose(options: PoseOptions = {}): { world: Landmark[]; image: Landmark[] } {
  const {
    kneeAngle = 175,
    kneeAsymmetry = 0,
    leanX = 0,
    armsOverhead = 0,
    ankleSpread = 0.20,
    airborne = 0,
    splitZ = 0,
    visibility = 0.95,
  } = options;

  const leftAngle = kneeAngle - kneeAsymmetry / 2;
  const rightAngle = kneeAngle + kneeAsymmetry / 2;
  const left = legChain(leftAngle);
  const right = legChain(rightAngle);
  const meanReach = (left.reach + right.reach) / 2;

  const world: Landmark[] = new Array(LANDMARK_COUNT).fill(null).map(() => landmark(0, 0, 0, visibility));
  const image: Landmark[] = new Array(LANDMARK_COUNT).fill(null).map(() => landmark(0, 0, 0, visibility));

  // World space: hip midpoint is the origin, y grows downward.
  const setWorld = (i: number, x: number, y: number, z: number) => {
    world[i] = landmark(x, y, z, visibility);
  };
  // Image space: the ankle is planted, so the hip rises and falls against it.
  const hipImageY = ANKLE_IMAGE_Y - meanReach * IMAGE_SCALE - airborne * IMAGE_SCALE;
  const setImage = (i: number, worldX: number, worldY: number) => {
    image[i] = landmark(
      CENTER_X + leanX + worldX * IMAGE_SCALE,
      hipImageY + worldY * IMAGE_SCALE,
      0,
      visibility,
    );
  };
  const place = (i: number, x: number, y: number, z: number) => {
    setWorld(i, x, y, z);
    setImage(i, x, y);
  };

  const halfSpread = ankleSpread / 2;

  // Hips and shoulders.
  place(LM.LEFT_HIP, HIP_HALF_WIDTH, 0, 0);
  place(LM.RIGHT_HIP, -HIP_HALF_WIDTH, 0, 0);
  place(LM.LEFT_SHOULDER, SHOULDER_HALF_WIDTH, -TORSO, 0);
  place(LM.RIGHT_SHOULDER, -SHOULDER_HALF_WIDTH, -TORSO, 0);

  // Head.
  place(LM.NOSE, 0, -TORSO - 0.24, 0.05);
  place(LM.LEFT_EYE, 0.03, -TORSO - 0.26, 0.04);
  place(LM.RIGHT_EYE, -0.03, -TORSO - 0.26, 0.04);
  place(LM.LEFT_EAR, 0.07, -TORSO - 0.25, 0);
  place(LM.RIGHT_EAR, -0.07, -TORSO - 0.25, 0);
  place(LM.MOUTH_LEFT, 0.02, -TORSO - 0.20, 0.04);
  place(LM.MOUTH_RIGHT, -0.02, -TORSO - 0.20, 0.04);
  place(LM.LEFT_EYE_INNER, 0.02, -TORSO - 0.26, 0.04);
  place(LM.LEFT_EYE_OUTER, 0.05, -TORSO - 0.26, 0.04);
  place(LM.RIGHT_EYE_INNER, -0.02, -TORSO - 0.26, 0.04);
  place(LM.RIGHT_EYE_OUTER, -0.05, -TORSO - 0.26, 0.04);

  // Legs. The hip half-width carries down so the chain stays plausible.
  place(LM.LEFT_KNEE, halfSpread, left.kneeY, left.kneeZ);
  place(LM.RIGHT_KNEE, -halfSpread, right.kneeY, right.kneeZ);
  place(LM.LEFT_ANKLE, halfSpread, left.reach, splitZ / 2);
  place(LM.RIGHT_ANKLE, -halfSpread, right.reach, -splitZ / 2);
  place(LM.LEFT_HEEL, halfSpread, left.reach + 0.03, -0.04);
  place(LM.RIGHT_HEEL, -halfSpread, right.reach + 0.03, -0.04);
  place(LM.LEFT_FOOT_INDEX, halfSpread, left.reach + 0.04, 0.12);
  place(LM.RIGHT_FOOT_INDEX, -halfSpread, right.reach + 0.04, 0.12);

  // Arms: interpolate from hanging at the sides to straight overhead.
  const armAngle = (Math.PI / 2) * armsOverhead; // 0 = down, PI/2 = up
  const elbowY = -TORSO + UPPER_ARM * Math.cos(armAngle);
  const elbowX = SHOULDER_HALF_WIDTH + UPPER_ARM * Math.sin(armAngle) * 0.35;
  const wristY = elbowY - FOREARM * Math.sin(armAngle) - FOREARM * (1 - armsOverhead) * -1 * 0;
  const wristYFinal = armsOverhead > 0 ? elbowY - FOREARM * armsOverhead : elbowY + FOREARM;
  const wristX = elbowX + UPPER_ARM * Math.sin(armAngle) * 0.35;
  void wristY;

  place(LM.LEFT_ELBOW, elbowX, elbowY, 0);
  place(LM.RIGHT_ELBOW, -elbowX, elbowY, 0);
  place(LM.LEFT_WRIST, wristX, wristYFinal, 0);
  place(LM.RIGHT_WRIST, -wristX, wristYFinal, 0);
  place(LM.LEFT_PINKY, wristX + 0.02, wristYFinal - 0.05, 0);
  place(LM.RIGHT_PINKY, -wristX - 0.02, wristYFinal - 0.05, 0);
  place(LM.LEFT_INDEX, wristX, wristYFinal - 0.06, 0);
  place(LM.RIGHT_INDEX, -wristX, wristYFinal - 0.06, 0);
  place(LM.LEFT_THUMB, wristX - 0.02, wristYFinal - 0.04, 0);
  place(LM.RIGHT_THUMB, -wristX + 0.02, wristYFinal - 0.04, 0);

  return { world, image };
}

export function makeFrame(t: number, options: PoseOptions = {}): PoseFrame {
  const { world, image } = makePose(options);
  return { t, present: true, landmarks: image, world };
}

export function makeAbsentFrame(t: number): PoseFrame {
  return { t, present: false, landmarks: [], world: [] };
}

export interface SquatSetOptions {
  reps: number;
  /** Deepest mean knee angle reached. 90 is thighs-parallel; 140 is a token dip. */
  minKneeAngle?: number;
  /** Time for one full down-and-up. */
  repDurationMs?: number;
  /** Standing pause between reps. */
  restMs?: number;
  fps?: number;
  kneeAsymmetry?: number;
  /** Seconds of standing still before the first rep, for calibration. */
  leadInMs?: number;
  /**
   * Knee angle the player reads at rest. Real front-facing MediaPipe output
   * often puts a straight standing leg near 150 rather than 175, so this is the
   * knob for reproducing that.
   */
  standingKneeAngle?: number;
}

/**
 * A full set of squats as a replayable fixture.
 *
 * The knee-angle profile is a raised cosine: smooth, with real dwell at the top
 * and bottom rather than a triangle wave that would never sit at a threshold
 * long enough to test dwell requirements.
 */
export function makeSquatSet(options: SquatSetOptions): PoseFixture {
  const {
    reps,
    minKneeAngle = 92,
    repDurationMs = 2000,
    restMs = 600,
    fps = 30,
    kneeAsymmetry = 0,
    leadInMs = 2500,
    standingKneeAngle = 175,
  } = options;

  const frameMs = 1000 / fps;
  const frames: PoseFrame[] = [];
  const standing = standingKneeAngle;
  let t = 0;

  for (; t < leadInMs; t += frameMs) {
    frames.push(makeFrame(t, { kneeAngle: standing }));
  }

  for (let rep = 0; rep < reps; rep++) {
    const repStart = t;
    for (; t < repStart + repDurationMs; t += frameMs) {
      const phase = (t - repStart) / repDurationMs; // 0..1
      // Raised cosine: 175 at the ends, minKneeAngle at the midpoint.
      const eased = (1 - Math.cos(phase * 2 * Math.PI)) / 2;
      frames.push(
        makeFrame(t, {
          kneeAngle: standing - (standing - minKneeAngle) * eased,
          kneeAsymmetry: kneeAsymmetry * eased,
        }),
      );
    }
    const restStart = t;
    for (; t < restStart + restMs; t += frameMs) {
      frames.push(makeFrame(t, { kneeAngle: standing }));
    }
  }

  return {
    name: `synthetic-squat-${reps}x-${minKneeAngle}deg`,
    notes: `${reps} synthetic squats to ${minKneeAngle}° at ${repDurationMs}ms each`,
    expected: { exercise: 'squat', reps },
    recordedAt: '1970-01-01T00:00:00.000Z',
    frames,
  };
}

export interface CycleSetOptions {
  reps: number;
  repDurationMs?: number;
  restMs?: number;
  fps?: number;
  leadInMs?: number;
}

/** Raised cosine: 0 at both ends, 1 at the midpoint, with real dwell at each. */
function eased(phase: number): number {
  return (1 - Math.cos(phase * 2 * Math.PI)) / 2;
}

/** Generic builder: a lead-in of rest, then N cycles of a posed movement. */
function makeCycleSet(
  name: string,
  options: CycleSetOptions,
  poseAt: (amount: number) => PoseOptions,
): PoseFixture {
  const { reps, repDurationMs = 1200, restMs = 400, fps = 30, leadInMs = 2500 } = options;
  const frameMs = 1000 / fps;
  const frames: PoseFrame[] = [];
  let t = 0;

  for (; t < leadInMs; t += frameMs) frames.push(makeFrame(t, poseAt(0)));

  for (let rep = 0; rep < reps; rep++) {
    const start = t;
    for (; t < start + repDurationMs; t += frameMs) {
      frames.push(makeFrame(t, poseAt(eased((t - start) / repDurationMs))));
    }
    const restStart = t;
    for (; t < restStart + restMs; t += frameMs) frames.push(makeFrame(t, poseAt(0)));
  }

  return {
    name,
    expected: { reps },
    recordedAt: '1970-01-01T00:00:00.000Z',
    frames,
  };
}

export interface JackSetOptions extends CycleSetOptions {
  /** Peak stance width in metres. Resting is 0.20; a full jack is ~0.65. */
  peakSpread?: number;
  /** How far the arms travel overhead, 0..1. */
  peakArms?: number;
}

export function makeJumpingJackSet(options: JackSetOptions): PoseFixture {
  const { peakSpread = 0.65, peakArms = 1 } = options;
  return makeCycleSet(`synthetic-jack-${options.reps}x`, options, (amount) => ({
    armsOverhead: peakArms * amount,
    ankleSpread: 0.2 + (peakSpread - 0.2) * amount,
  }));
}

export interface LungeSetOptions extends CycleSetOptions {
  /** Front-to-back foot split in metres at the bottom. */
  peakSplit?: number;
  /** Deepest mean knee angle. */
  minKneeAngle?: number;
}

export function makeLungeSet(options: LungeSetOptions): PoseFixture {
  const { peakSplit = 0.8, minKneeAngle = 100 } = options;
  return makeCycleSet(`synthetic-lunge-${options.reps}x`, options, (amount) => ({
    kneeAngle: 175 - (175 - minKneeAngle) * amount,
    splitZ: peakSplit * amount,
  }));
}

export interface PushupSetOptions extends CycleSetOptions {
  /** Elbow angle at the bottom of the push-up. */
  minElbowAngle?: number;
}

function makePushupFrame(t: number, elbowAngle: number): PoseFrame {
  const frame = makeFrame(t);
  const hipX = (frame.landmarks[LM.LEFT_HIP]!.x + frame.landmarks[LM.RIGHT_HIP]!.x) / 2;
  const hipY = (frame.landmarks[LM.LEFT_HIP]!.y + frame.landmarks[LM.RIGHT_HIP]!.y) / 2;

  // Rotate the image skeleton side-on around the hips so the recognizer sees a
  // horizontal torso. World coordinates remain metric and supply joint angles.
  for (const point of frame.landmarks) {
    const dx = point.x - hipX;
    const dy = point.y - hipY;
    point.x = 0.58 + dy * 0.82;
    point.y = 0.62 - dx * 0.82;
  }

  const theta = (elbowAngle * Math.PI) / 180;
  for (const [shoulderIndex, elbowIndex, wristIndex, side] of [
    [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST, 1],
    [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST, -1],
  ] as const) {
    const shoulder = frame.world[shoulderIndex]!;
    const elbow = frame.world[elbowIndex]!;
    elbow.x = shoulder.x + side * 0.2;
    elbow.y = shoulder.y + 0.16;
    elbow.z = shoulder.z;

    const ax = shoulder.x - elbow.x;
    const ay = shoulder.y - elbow.y;
    const length = Math.hypot(ax, ay);
    const ux = ax / length;
    const uy = ay / length;
    const direction = side === 1 ? theta : -theta;
    frame.world[wristIndex] = landmark(
      elbow.x + (ux * Math.cos(direction) - uy * Math.sin(direction)) * FOREARM,
      elbow.y + (ux * Math.sin(direction) + uy * Math.cos(direction)) * FOREARM,
      elbow.z,
      0.95,
    );
  }

  return frame;
}

export function makePushupSet(options: PushupSetOptions): PoseFixture {
  const {
    reps,
    minElbowAngle = 88,
    repDurationMs = 1800,
    restMs = 500,
    fps = 30,
    leadInMs = 2500,
  } = options;
  const frameMs = 1000 / fps;
  const frames: PoseFrame[] = [];
  let t = 0;

  // Calibration always captures the neutral standing skeleton first.
  for (; t < leadInMs; t += frameMs) frames.push(makeFrame(t));

  for (let rep = 0; rep < reps; rep++) {
    const start = t;
    for (; t < start + repDurationMs; t += frameMs) {
      const amount = eased((t - start) / repDurationMs);
      frames.push(makePushupFrame(t, 175 - (175 - minElbowAngle) * amount));
    }
    const restStart = t;
    for (; t < restStart + restMs; t += frameMs) frames.push(makePushupFrame(t, 175));
  }

  return {
    name: `synthetic-pushup-${reps}x`,
    expected: { exercise: 'pushup', reps },
    recordedAt: '1970-01-01T00:00:00.000Z',
    frames,
  };
}
