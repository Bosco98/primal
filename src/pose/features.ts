import { FULL_BODY_REQUIRED, LM } from '../pose/landmarks.js';
import type { Landmark, PoseFrame } from '../pose/types.js';

/**
 * Per-frame geometry derived from raw landmarks.
 *
 * Which coordinate system each quantity comes from is deliberate:
 *
 *  - Joint *angles* come from world landmarks. They are metric and roughly
 *    perspective-corrected, so a knee angle means the same thing whether the
 *    player stands 1.5m or 3m from the camera.
 *  - *Heights and positions* come from image landmarks, because world
 *    landmarks are hip-centred: the hip sits at the origin by definition, so
 *    squat depth and jump height are simply invisible there.
 *
 * Everything positional is expressed in torso lengths rather than pixels or
 * normalised units, which is what makes a single threshold work for a tall
 * player far away and a short player up close.
 */
export interface FrameFeatures {
  t: number;
  present: boolean;

  /** Degrees. 180 is a straight limb. */
  kneeAngleLeft: number;
  kneeAngleRight: number;
  kneeAngleMean: number;
  /** Torso-to-thigh angle. Degrees; 180 is standing upright. */
  hipAngleLeft: number;
  hipAngleRight: number;
  hipAngleMean: number;
  elbowAngleLeft: number;
  elbowAngleRight: number;

  /** Image space, 0..1, y down. */
  hipY: number;
  shoulderY: number;
  ankleY: number;
  shoulderCenterX: number;
  hipCenterX: number;
  headY: number;

  /** Image-space scale references. */
  torsoLength: number;
  shoulderWidth: number;

  wristLeft: Landmark;
  wristRight: Landmark;
  /** Wrist height relative to the shoulder line, in torso lengths. Positive is above. */
  wristRiseLeft: number;
  wristRiseRight: number;
  /** Horizontal ankle separation in torso lengths; drives jumping jacks. */
  ankleSpread: number;
  /**
   * Front-to-back ankle separation, in world torso lengths. Near zero for
   * squats and jacks; large for lunges. This is what tells a lunge from a
   * squat, since both bend the knees and drop the hips.
   */
  ankleSplitZ: number;
  /**
   * Torso angle from vertical, in degrees. ~0 standing, ~90 lying flat. Gates
   * push-ups, which are otherwise indistinguishable from arm movement.
   */
  torsoTiltDeg: number;
  /** Mean of the two wrist heights relative to the shoulders. */
  wristRiseMean: number;

  /** Speeds in torso lengths per second. */
  wristSpeedLeft: number;
  wristSpeedRight: number;
  hipSpeedY: number;
  /** Mean landmark speed, the basis of the effort signal. */
  overallSpeed: number;

  /** Mean visibility across landmarks that matter, 0..1. */
  visibility: number;
  lowerBodyVisible: boolean;
  leftLowerBodyVisible: boolean;
  rightLowerBodyVisible: boolean;
  leftUpperBodyVisible: boolean;
  rightUpperBodyVisible: boolean;
  upperBodyVisible: boolean;
}

const ZERO_LANDMARK: Landmark = { x: 0, y: 0, z: 0, visibility: 0 };

export const EMPTY_FEATURES: FrameFeatures = {
  t: 0,
  present: false,
  kneeAngleLeft: 180,
  kneeAngleRight: 180,
  kneeAngleMean: 180,
  hipAngleLeft: 180,
  hipAngleRight: 180,
  hipAngleMean: 180,
  elbowAngleLeft: 180,
  elbowAngleRight: 180,
  hipY: 0.5,
  shoulderY: 0.3,
  ankleY: 0.9,
  shoulderCenterX: 0.5,
  hipCenterX: 0.5,
  headY: 0.2,
  torsoLength: 0.25,
  shoulderWidth: 0.2,
  wristLeft: ZERO_LANDMARK,
  wristRight: ZERO_LANDMARK,
  wristRiseLeft: 0,
  wristRiseRight: 0,
  ankleSpread: 0,
  ankleSplitZ: 0,
  torsoTiltDeg: 0,
  wristRiseMean: 0,
  wristSpeedLeft: 0,
  wristSpeedRight: 0,
  hipSpeedY: 0,
  overallSpeed: 0,
  visibility: 0,
  lowerBodyVisible: false,
  leftLowerBodyVisible: false,
  rightLowerBodyVisible: false,
  leftUpperBodyVisible: false,
  rightUpperBodyVisible: false,
  upperBodyVisible: false,
};

/** Angle at `b` formed by the segments b->a and b->c, in degrees. */
export function angleAt(a: Landmark, b: Landmark, c: Landmark): number {
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const abz = a.z - b.z;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const cbz = c.z - b.z;

  const dot = abx * cbx + aby * cby + abz * cbz;
  const magAb = Math.hypot(abx, aby, abz);
  const magCb = Math.hypot(cbx, cby, cbz);
  if (magAb === 0 || magCb === 0) return 180;

  const cos = Math.min(1, Math.max(-1, dot / (magAb * magCb)));
  return (Math.acos(cos) * 180) / Math.PI;
}

function mean(...values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/**
 * Turns a stream of pose frames into a stream of features, carrying just enough
 * history to compute velocity.
 */
export class FeatureExtractor {
  private previous: PoseFrame | null = null;
  private previousFeatures: FrameFeatures | null = null;

  reset(): void {
    this.previous = null;
    this.previousFeatures = null;
  }

  extract(frame: PoseFrame): FrameFeatures {
    if (!frame.present || frame.landmarks.length === 0 || frame.world.length === 0) {
      this.previous = null;
      this.previousFeatures = null;
      return { ...EMPTY_FEATURES, t: frame.t };
    }

    const img = frame.landmarks;
    const world = frame.world;
    const at = (i: number): Landmark => img[i] ?? ZERO_LANDMARK;
    const w = (i: number): Landmark => world[i] ?? ZERO_LANDMARK;

    const shoulderY = mean(at(LM.LEFT_SHOULDER).y, at(LM.RIGHT_SHOULDER).y);
    const hipY = mean(at(LM.LEFT_HIP).y, at(LM.RIGHT_HIP).y);
    const ankleY = mean(at(LM.LEFT_ANKLE).y, at(LM.RIGHT_ANKLE).y);
    const shoulderCenterX = mean(at(LM.LEFT_SHOULDER).x, at(LM.RIGHT_SHOULDER).x);
    const hipCenterX = mean(at(LM.LEFT_HIP).x, at(LM.RIGHT_HIP).x);

    // Guarded: a degenerate torso would turn every normalised quantity into
    // Infinity and poison every downstream threshold.
    const torsoLength = Math.max(1e-3, Math.abs(hipY - shoulderY));
    const shoulderWidth = Math.max(
      1e-3,
      Math.abs(at(LM.LEFT_SHOULDER).x - at(LM.RIGHT_SHOULDER).x),
    );

    const kneeAngleLeft = angleAt(w(LM.LEFT_HIP), w(LM.LEFT_KNEE), w(LM.LEFT_ANKLE));
    const kneeAngleRight = angleAt(w(LM.RIGHT_HIP), w(LM.RIGHT_KNEE), w(LM.RIGHT_ANKLE));
    const hipAngleLeft = angleAt(w(LM.LEFT_SHOULDER), w(LM.LEFT_HIP), w(LM.LEFT_KNEE));
    const hipAngleRight = angleAt(w(LM.RIGHT_SHOULDER), w(LM.RIGHT_HIP), w(LM.RIGHT_KNEE));
    const elbowAngleLeft = angleAt(w(LM.LEFT_SHOULDER), w(LM.LEFT_ELBOW), w(LM.LEFT_WRIST));
    const elbowAngleRight = angleAt(w(LM.RIGHT_SHOULDER), w(LM.RIGHT_ELBOW), w(LM.RIGHT_WRIST));

    const visibility =
      FULL_BODY_REQUIRED.reduce((sum, i) => sum + at(i).visibility, 0) / FULL_BODY_REQUIRED.length;

    const leftLowerBodyVisible = [LM.LEFT_KNEE, LM.LEFT_ANKLE].every(
      (i) => at(i).visibility > 0.5,
    );
    const rightLowerBodyVisible = [LM.RIGHT_KNEE, LM.RIGHT_ANKLE].every(
      (i) => at(i).visibility > 0.5,
    );
    const lowerBodyVisible = leftLowerBodyVisible && rightLowerBodyVisible;
    const leftUpperBodyVisible = [LM.LEFT_SHOULDER, LM.LEFT_ELBOW, LM.LEFT_WRIST].every(
      (i) => at(i).visibility > 0.5,
    );
    const rightUpperBodyVisible = [LM.RIGHT_SHOULDER, LM.RIGHT_ELBOW, LM.RIGHT_WRIST].every(
      (i) => at(i).visibility > 0.5,
    );
    const upperBodyVisible = leftUpperBodyVisible && rightUpperBodyVisible;

    // World torso length keeps the front-to-back split scale-free across
    // players; guarded because a collapsed torso would divide by ~zero.
    const worldTorso = Math.max(
      1e-3,
      Math.hypot(
        (w(LM.LEFT_SHOULDER).x + w(LM.RIGHT_SHOULDER).x) / 2 -
          (w(LM.LEFT_HIP).x + w(LM.RIGHT_HIP).x) / 2,
        (w(LM.LEFT_SHOULDER).y + w(LM.RIGHT_SHOULDER).y) / 2 -
          (w(LM.LEFT_HIP).y + w(LM.RIGHT_HIP).y) / 2,
      ),
    );
    const ankleSplitZ = Math.abs(w(LM.LEFT_ANKLE).z - w(LM.RIGHT_ANKLE).z) / worldTorso;

    // Image-space torso direction: horizontal offset against vertical offset.
    const torsoDx = Math.abs(hipCenterX - shoulderCenterX);
    const torsoDy = Math.abs(hipY - shoulderY);
    const torsoTiltDeg = (Math.atan2(torsoDx, Math.max(1e-4, torsoDy)) * 180) / Math.PI;

    const wristRiseLeft = (shoulderY - at(LM.LEFT_WRIST).y) / torsoLength;
    const wristRiseRight = (shoulderY - at(LM.RIGHT_WRIST).y) / torsoLength;

    const features: FrameFeatures = {
      t: frame.t,
      present: true,
      kneeAngleLeft,
      kneeAngleRight,
      kneeAngleMean: (kneeAngleLeft + kneeAngleRight) / 2,
      hipAngleLeft,
      hipAngleRight,
      hipAngleMean: (hipAngleLeft + hipAngleRight) / 2,
      elbowAngleLeft,
      elbowAngleRight,
      hipY,
      shoulderY,
      ankleY,
      shoulderCenterX,
      hipCenterX,
      headY: at(LM.NOSE).y,
      torsoLength,
      shoulderWidth,
      wristLeft: at(LM.LEFT_WRIST),
      wristRight: at(LM.RIGHT_WRIST),
      // y is down in image space, so "above the shoulders" is a negative delta.
      wristRiseLeft,
      wristRiseRight,
      wristRiseMean: (wristRiseLeft + wristRiseRight) / 2,
      ankleSpread: Math.abs(at(LM.LEFT_ANKLE).x - at(LM.RIGHT_ANKLE).x) / torsoLength,
      ankleSplitZ,
      torsoTiltDeg,
      wristSpeedLeft: 0,
      wristSpeedRight: 0,
      hipSpeedY: 0,
      overallSpeed: 0,
      visibility,
      lowerBodyVisible,
      leftLowerBodyVisible,
      rightLowerBodyVisible,
      leftUpperBodyVisible,
      rightUpperBodyVisible,
      upperBodyVisible,
    };

    this.applyVelocities(frame, features);

    this.previous = frame;
    this.previousFeatures = features;
    return features;
  }

  private applyVelocities(frame: PoseFrame, features: FrameFeatures): void {
    const prev = this.previous;
    const prevFeatures = this.previousFeatures;
    if (!prev || !prevFeatures) return;

    const dt = (frame.t - prev.t) / 1000;
    // Below ~2ms the division amplifies landmark jitter into fake velocity
    // spikes, which reads as a punch that never happened.
    if (dt < 0.002) return;

    const scale = features.torsoLength;
    const img = frame.landmarks;
    const prevImg = prev.landmarks;

    const speedOf = (index: number): number => {
      const a = img[index];
      const b = prevImg[index];
      if (!a || !b) return 0;
      return Math.hypot(a.x - b.x, a.y - b.y) / scale / dt;
    };

    features.wristSpeedLeft = speedOf(LM.LEFT_WRIST);
    features.wristSpeedRight = speedOf(LM.RIGHT_WRIST);
    features.hipSpeedY = (features.hipY - prevFeatures.hipY) / scale / dt;

    let total = 0;
    let counted = 0;
    for (const index of FULL_BODY_REQUIRED) {
      const a = img[index];
      if (!a || a.visibility < 0.5) continue;
      total += speedOf(index);
      counted++;
    }
    features.overallSpeed = counted === 0 ? 0 : total / counted;
  }
}
