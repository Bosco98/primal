import type { ExerciseId } from '@bosco98/primal-sdk';
import type { Baseline } from './calibration.js';
import type { FrameFeatures } from './features.js';

export type ExerciseSignalId =
  | 'hip_drop'
  | 'knee_bend'
  | 'arm_raise'
  | 'stance_width'
  | 'foot_split'
  | 'elbow_bend';

export type ExerciseSignalValues = Record<ExerciseSignalId, number>;

export interface ExerciseProfileSignal {
  id: ExerciseSignalId;
  ready: number;
  /** 1 when the signal rises through a rep, -1 when it falls. */
  direction: 1 | -1;
  /** Median excursion at the peak of the accepted calibration reps. */
  range: number;
  /** Median absolute deviation measured during the ready hold. */
  noise: number;
}

export interface ExerciseProfile {
  version: 2;
  exercise: ExerciseId;
  bodyBaselineId: string;
  signals: ExerciseProfileSignal[];
  /** Top-plank orientation used to reject upright arm bends. */
  topTorsoTiltDeg?: number;
  acceptedReps: number;
  capturedAt: number;
}

export interface ExerciseCalibrationSample {
  t: number;
  signals: ExerciseSignalValues;
  torsoTiltDeg: number;
  visible: boolean;
}

export type ExerciseCalibrationStage =
  | 'idle'
  | 'countdown'
  | 'ready_hold'
  | 'recording'
  | 'complete'
  | 'failed';

export interface ExerciseCalibrationState {
  stage: ExerciseCalibrationStage;
  message: string;
  countdown: number;
  validReps: number;
  canFinish: boolean;
  elapsedSeconds: number;
  profile: ExerciseProfile | null;
}

interface SignalStats extends ExerciseProfileSignal {
  provisionalRange: number;
}

interface CalibrationCycle {
  startedAt: number;
  endedAt: number;
  peakProgress: number;
  peakBySignal: Partial<Record<ExerciseSignalId, number>>;
  visibleFrames: number;
  totalFrames: number;
}

export interface ExerciseCalibrationAnalysis {
  reliableSignals: ExerciseSignalId[];
  candidateCycles: number;
  acceptedCycles: number;
  profile: ExerciseProfile | null;
  issue: string | null;
}

const SIGNALS: Record<ExerciseId, ExerciseSignalId[]> = {
  squat: ['hip_drop', 'knee_bend'],
  jumping_jack: ['arm_raise', 'stance_width'],
  lunge: ['hip_drop', 'knee_bend', 'stance_width', 'foot_split'],
  pushup: ['elbow_bend'],
};

/** Minimum useful excursion in each signal's native units. */
const MIN_CHANGE: Record<ExerciseSignalId, number> = {
  hip_drop: 0.08,
  knee_bend: 14,
  arm_raise: 0.45,
  stance_width: 0.12,
  foot_split: 0.18,
  elbow_bend: 18,
};

const COUNT_RANGE = 0.75;
const GOOD_RANGE = 0.85;
const EXCELLENT_RANGE = 1.05;
const OCCLUSION_GRACE_MS = 250;
const MAX_CAPTURE_MS = 45_000;

const EMPTY_STATE: ExerciseCalibrationState = {
  stage: 'idle',
  message: '',
  countdown: 0,
  validReps: 0,
  canFinish: false,
  elapsedSeconds: 0,
  profile: null,
};

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export function medianAbsoluteDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0;
  const center = median(values);
  return median(values.map((value) => Math.abs(value - center)));
}

export function percentile(values: readonly number[], fraction: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const position = Math.max(0, Math.min(1, fraction)) * (sorted.length - 1);
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  const blend = position - lower;
  return sorted[lower]! * (1 - blend) + sorted[upper]! * blend;
}

export function robustMovementStats(
  readyValues: readonly number[],
  movementValues: readonly number[],
): { ready: number; noise: number; direction: 1 | -1; range: number } {
  const ready = median(readyValues);
  const noise = medianAbsoluteDeviation(readyValues);
  const upward = percentile(movementValues, 0.9) - ready;
  const downward = ready - percentile(movementValues, 0.1);
  const direction: 1 | -1 = upward >= downward ? 1 : -1;
  return { ready, noise, direction, range: Math.max(upward, downward) };
}

export function madInlierMask(
  values: readonly number[],
  multiplier = 2.5,
  minimumTolerance = 0,
): boolean[] {
  const center = median(values);
  const tolerance = Math.max(
    multiplier * medianAbsoluteDeviation(values),
    minimumTolerance,
  );
  return values.map((value) => Math.abs(value - center) <= tolerance);
}

/** Values are relative to body calibration, so camera scale and body size cancel out. */
export function exerciseSignals(
  features: FrameFeatures,
  baseline: Baseline,
): ExerciseSignalValues {
  return {
    hip_drop: (features.hipY - baseline.standingHipY) / baseline.torsoLength,
    knee_bend: baseline.standingKneeAngle - features.kneeAngleMean,
    arm_raise: features.wristRiseMean - baseline.standingWristRise,
    stance_width: features.ankleSpread - baseline.standingAnkleSpread,
    foot_split: features.ankleSplitZ,
    elbow_bend: visibleElbowBend(features),
  };
}

export function bodyBaselineIdentifier(baseline: Baseline): string {
  return [
    'body-v3',
    Math.round(baseline.capturedAt),
    baseline.torsoLength.toFixed(4),
    baseline.shoulderWidth.toFixed(4),
  ].join(':');
}

export function visibleForExerciseCalibration(
  exercise: ExerciseId,
  features: FrameFeatures,
): boolean {
  if (!features.present) return false;
  if (exercise === 'pushup') {
    return features.leftUpperBodyVisible || features.rightUpperBodyVisible;
  }
  if (exercise === 'jumping_jack') return features.lowerBodyVisible && features.upperBodyVisible;
  if (exercise === 'lunge') {
    return features.leftLowerBodyVisible || features.rightLowerBodyVisible;
  }
  return features.lowerBodyVisible;
}

/** A side-on push-up often hides the far arm; use whichever complete arm chain is visible. */
export function visibleElbowBend(features: FrameFeatures): number {
  if (features.leftUpperBodyVisible && !features.rightUpperBodyVisible) {
    return 180 - features.elbowAngleLeft;
  }
  if (features.rightUpperBodyVisible && !features.leftUpperBodyVisible) {
    return 180 - features.elbowAngleRight;
  }
  return 180 - (features.elbowAngleLeft + features.elbowAngleRight) / 2;
}

export function exerciseCalibrationSample(
  exercise: ExerciseId,
  features: FrameFeatures,
  baseline: Baseline,
): ExerciseCalibrationSample {
  return {
    t: features.t,
    signals: exerciseSignals(features, baseline),
    torsoTiltDeg: features.torsoTiltDeg,
    visible: visibleForExerciseCalibration(exercise, features),
  };
}

/**
 * Hands-free exercise calibration. The class only owns timing and samples; the
 * robust batch analyzer below owns all threshold decisions.
 */
export class ExerciseProfileCalibrator {
  private exercise: ExerciseId | null = null;
  private baseline: Baseline | null = null;
  private startedAt: number | null = null;
  private readyStartedAt: number | null = null;
  private movementStartedAt: number | null = null;
  private readySamples: ExerciseCalibrationSample[] = [];
  private movementSamples: ExerciseCalibrationSample[] = [];
  private currentState: ExerciseCalibrationState = EMPTY_STATE;

  get state(): ExerciseCalibrationState {
    return this.currentState;
  }

  start(exercise: ExerciseId, baseline: Baseline): ExerciseCalibrationState {
    this.exercise = exercise;
    this.baseline = baseline;
    this.startedAt = null;
    this.readyStartedAt = null;
    this.movementStartedAt = null;
    this.readySamples = [];
    this.movementSamples = [];
    return this.setState({
      stage: 'countdown',
      message: 'Get into the ready position.',
      countdown: 3,
    });
  }

  cancel(): ExerciseCalibrationState {
    this.exercise = null;
    this.baseline = null;
    this.currentState = EMPTY_STATE;
    return this.currentState;
  }

  update(features: FrameFeatures): ExerciseCalibrationState {
    if (!this.exercise || !this.baseline) return this.currentState;
    const sample = exerciseCalibrationSample(this.exercise, features, this.baseline);
    if (this.startedAt === null) this.startedAt = features.t;

    const sinceStart = features.t - this.startedAt;
    if (sinceStart < 3000) {
      return this.setState({
        stage: 'countdown',
        message: 'Get into the ready position.',
        countdown: Math.max(1, Math.ceil((3000 - sinceStart) / 1000)),
      });
    }

    if (this.movementStartedAt === null) {
      if (!sample.visible) {
        this.readyStartedAt = null;
        this.readySamples = [];
        return this.setState({
          stage: 'ready_hold',
          message: this.exercise === 'pushup'
            ? 'Set up side-on in your top plank so your arms and torso are visible.'
            : 'Move until the required joints are visible, then hold ready.',
          countdown: 2,
        });
      }

      if (this.readyStartedAt === null) this.readyStartedAt = features.t;
      this.readySamples.push(sample);
      const heldMs = features.t - this.readyStartedAt;
      if (heldMs < 2000 || this.readySamples.length < 10) {
        return this.setState({
          stage: 'ready_hold',
          message: 'Hold your ready position still.',
          countdown: Math.max(1, Math.ceil((2000 - heldMs) / 1000)),
        });
      }

      this.movementStartedAt = features.t;
      return this.setState({
        stage: 'recording',
        message: 'GO — perform 5 normal reps.',
        countdown: 0,
      });
    }

    if (this.currentState.stage === 'complete' || this.currentState.stage === 'failed') {
      return this.currentState;
    }

    this.movementSamples.push(sample);
    const elapsed = features.t - this.movementStartedAt;
    const analysis = analyzeExerciseCalibration(
      this.exercise,
      this.readySamples,
      this.movementSamples,
      this.baseline,
    );

    if (analysis.profile && analysis.acceptedCycles >= 5) {
      return this.setState({
        stage: 'complete',
        message: 'Personal movement range saved and active.',
        validReps: analysis.acceptedCycles,
        canFinish: false,
        elapsedSeconds: Math.floor(elapsed / 1000),
        profile: analysis.profile,
      });
    }

    if (elapsed >= MAX_CAPTURE_MS) {
      return this.setState({
        stage: 'failed',
        message:
          analysis.issue ??
          'I could not find 3 consistent full reps. Check your framing and try again.',
        validReps: analysis.acceptedCycles,
        canFinish: false,
        elapsedSeconds: 45,
      });
    }

    return this.setState({
      stage: 'recording',
      message:
        analysis.issue && analysis.candidateCycles > 0
          ? analysis.issue
          : `${analysis.acceptedCycles} of 5 consistent reps captured.`,
      validReps: analysis.acceptedCycles,
      canFinish: analysis.profile !== null && analysis.acceptedCycles >= 3,
      elapsedSeconds: Math.floor(elapsed / 1000),
    });
  }

  finish(): ExerciseCalibrationState {
    if (!this.exercise || !this.baseline || this.currentState.stage !== 'recording') {
      return this.currentState;
    }
    const analysis = analyzeExerciseCalibration(
      this.exercise,
      this.readySamples,
      this.movementSamples,
      this.baseline,
    );
    if (!analysis.profile || analysis.acceptedCycles < 3) {
      return this.setState({
        stage: 'failed',
        message:
          analysis.issue ?? 'Perform at least 3 complete, consistent reps before finishing.',
        validReps: analysis.acceptedCycles,
      });
    }
    return this.setState({
      stage: 'complete',
      message: 'Personal movement range saved and active.',
      validReps: analysis.acceptedCycles,
      canFinish: false,
      profile: analysis.profile,
    });
  }

  private setState(next: Partial<ExerciseCalibrationState>): ExerciseCalibrationState {
    this.currentState = { ...this.currentState, ...next };
    return this.currentState;
  }
}

export function analyzeExerciseCalibration(
  exercise: ExerciseId,
  readySamples: readonly ExerciseCalibrationSample[],
  movementSamples: readonly ExerciseCalibrationSample[],
  baseline: Baseline,
  now = Date.now(),
): ExerciseCalibrationAnalysis {
  const stats = buildSignalStats(exercise, readySamples, movementSamples);
  const reliableSignals = stats.map((signal) => signal.id);
  const missing = missingSignalGroup(exercise, reliableSignals);
  if (missing) {
    return {
      reliableSignals,
      candidateCycles: 0,
      acceptedCycles: 0,
      profile: null,
      issue: missing,
    };
  }

  const readyTorsoTiltDeg = median(readySamples.map((sample) => sample.torsoTiltDeg));
  const cycles = segmentCycles(exercise, movementSamples, stats, readyTorsoTiltDeg);
  const accepted = rejectOutliers(cycles, stats);
  if (accepted.length < 3) {
    return {
      reliableSignals,
      candidateCycles: cycles.length,
      acceptedCycles: accepted.length,
      profile: null,
      issue:
        cycles.length >= 3
          ? 'Your reps varied too much. Use the same comfortable range each time.'
          : null,
    };
  }

  const signals = stats
    .map((signal): ExerciseProfileSignal | null => {
      const peaks = accepted
        .map((cycle) => cycle.peakBySignal[signal.id])
        .filter((value): value is number => value !== undefined);
      const range = median(peaks);
      if (range < MIN_CHANGE[signal.id] || range < signal.noise * 6) return null;
      return {
        id: signal.id,
        ready: signal.ready,
        direction: signal.direction,
        range,
        noise: signal.noise,
      };
    })
    .filter((signal): signal is ExerciseProfileSignal => signal !== null);

  const persistedMissing = missingSignalGroup(
    exercise,
    signals.map((signal) => signal.id),
  );
  if (persistedMissing) {
    return {
      reliableSignals,
      candidateCycles: cycles.length,
      acceptedCycles: accepted.length,
      profile: null,
      issue: persistedMissing,
    };
  }

  return {
    reliableSignals,
    candidateCycles: cycles.length,
    acceptedCycles: accepted.length,
    issue: null,
    profile: {
      version: 2,
      exercise,
      bodyBaselineId: bodyBaselineIdentifier(baseline),
      signals,
      topTorsoTiltDeg:
        exercise === 'pushup' ? readyTorsoTiltDeg : undefined,
      acceptedReps: accepted.length,
      capturedAt: now,
    },
  };
}

function buildSignalStats(
  exercise: ExerciseId,
  readySamples: readonly ExerciseCalibrationSample[],
  movementSamples: readonly ExerciseCalibrationSample[],
): SignalStats[] {
  const visibleMovement = movementSamples.filter((sample) => sample.visible);
  const stats: SignalStats[] = [];

  for (const id of SIGNALS[exercise]) {
    const readyValues = readySamples.map((sample) => sample.signals[id]);
    const movementValues = visibleMovement.map((sample) => sample.signals[id]);
    if (readyValues.length < 5 || movementValues.length < 5) continue;

    const movement = robustMovementStats(readyValues, movementValues);
    const { ready, noise, direction } = movement;
    const provisionalRange = movement.range;
    if (provisionalRange < MIN_CHANGE[id] || provisionalRange < noise * 6) continue;

    stats.push({ id, ready, noise, direction, range: provisionalRange, provisionalRange });
  }
  return stats;
}

function segmentCycles(
  exercise: ExerciseId,
  samples: readonly ExerciseCalibrationSample[],
  stats: readonly SignalStats[],
  readyTorsoTiltDeg: number,
): CalibrationCycle[] {
  const raw = samples.map((sample) =>
    combinedCalibrationProgress(exercise, sample, stats, readyTorsoTiltDeg),
  );
  const smoothed = raw.map((_, index) => median(raw.slice(Math.max(0, index - 4), index + 1)));
  const cycles: CalibrationCycle[] = [];
  let current: CalibrationCycle | null = null;
  let enterFrames = 0;
  let returnFrames = 0;
  let occludedAt: number | null = null;

  for (let index = 0; index < samples.length; index++) {
    const sample = samples[index]!;
    const progress = smoothed[index]!;

    if (!sample.visible) {
      if (!current) continue;
      current.totalFrames++;
      if (occludedAt === null) occludedAt = sample.t;
      if (sample.t - occludedAt > OCCLUSION_GRACE_MS) {
        current = null;
        enterFrames = 0;
        returnFrames = 0;
      }
      continue;
    }
    occludedAt = null;

    if (!current) {
      enterFrames = progress >= 0.45 ? enterFrames + 1 : 0;
      if (enterFrames < 2) continue;
      current = {
        startedAt: sample.t,
        endedAt: sample.t,
        peakProgress: progress,
        peakBySignal: signalExcursions(sample, stats),
        visibleFrames: 1,
        totalFrames: 1,
      };
      returnFrames = 0;
      continue;
    }

    current.endedAt = sample.t;
    current.visibleFrames++;
    current.totalFrames++;
    current.peakProgress = Math.max(current.peakProgress, progress);
    const excursions = signalExcursions(sample, stats);
    for (const signal of stats) {
      current.peakBySignal[signal.id] = Math.max(
        current.peakBySignal[signal.id] ?? 0,
        excursions[signal.id] ?? 0,
      );
    }

    returnFrames = progress <= 0.2 ? returnFrames + 1 : 0;
    if (returnFrames < 2) continue;

    const duration = current.endedAt - current.startedAt;
    const [minDuration, maxDuration] = exercise === 'jumping_jack' ? [250, 4000] : [450, 9000];
    const visibility = current.visibleFrames / Math.max(1, current.totalFrames);
    if (
      current.peakProgress >= 0.65 &&
      duration >= minDuration &&
      duration <= maxDuration &&
      visibility >= 0.85
    ) {
      cycles.push(current);
    }
    current = null;
    enterFrames = 0;
    returnFrames = 0;
  }
  return cycles;
}

function rejectOutliers(
  cycles: readonly CalibrationCycle[],
  stats: readonly SignalStats[],
): CalibrationCycle[] {
  if (cycles.length < 3) return [...cycles];
  const masks = stats.map((signal) => {
      const peaks = cycles.map((item) => item.peakBySignal[signal.id] ?? 0);
      const center = median(peaks);
      return madInlierMask(peaks, 2.5, Math.max(signal.noise * 3, center * 0.12));
  });
  return cycles.filter((_, cycleIndex) => masks.every((mask) => mask[cycleIndex]));
}

function signalExcursions(
  sample: ExerciseCalibrationSample,
  stats: readonly SignalStats[],
): Partial<Record<ExerciseSignalId, number>> {
  return Object.fromEntries(
    stats.map((signal) => [
      signal.id,
      Math.max(0, signal.direction * (sample.signals[signal.id] - signal.ready)),
    ]),
  );
}

function combinedCalibrationProgress(
  exercise: ExerciseId,
  sample: ExerciseCalibrationSample,
  stats: readonly SignalStats[],
  readyTorsoTiltDeg: number,
): number {
  if (!sample.visible) return 0;
  const byId = new Map(
    stats.map((signal) => [
      signal.id,
      Math.max(0, signal.direction * (sample.signals[signal.id] - signal.ready)) /
        signal.provisionalRange,
    ]),
  );
  if (exercise === 'pushup') {
    if (sample.torsoTiltDeg < Math.max(30, readyTorsoTiltDeg - 20)) return 0;
  }
  return combineExerciseSignals(exercise, byId);
}

function missingSignalGroup(
  exercise: ExerciseId,
  available: readonly ExerciseSignalId[],
): string | null {
  const has = (id: ExerciseSignalId) => available.includes(id);
  if (exercise === 'squat' && !has('hip_drop') && !has('knee_bend')) {
    return 'I could not see enough hip drop or knee bend. Turn slightly and retry.';
  }
  if (exercise === 'jumping_jack' && (!has('arm_raise') || !has('stance_width'))) {
    return !has('arm_raise')
      ? 'Raise your arms clearly while keeping both wrists visible.'
      : 'Move your feet farther apart while keeping both ankles visible.';
  }
  if (
    exercise === 'lunge' &&
    ((!has('hip_drop') && !has('knee_bend')) || (!has('stance_width') && !has('foot_split')))
  ) {
    return 'Step into a clear split stance and lower your body on every lunge.';
  }
  if (exercise === 'pushup' && !has('elbow_bend')) {
    return 'Set up side-on and bend your elbows through a clear range.';
  }
  return null;
}

function combineExerciseSignals(
  exercise: ExerciseId,
  values: ReadonlyMap<ExerciseSignalId, number>,
): number {
  const value = (id: ExerciseSignalId): number => values.get(id) ?? 0;
  if (exercise === 'squat') return Math.max(value('hip_drop'), value('knee_bend'));
  if (exercise === 'jumping_jack') return Math.min(value('arm_raise'), value('stance_width'));
  if (exercise === 'lunge') {
    const lowering = Math.max(value('hip_drop'), value('knee_bend'));
    const stance = Math.max(value('stance_width'), value('foot_split'));
    return Math.min(lowering, stance);
  }
  return value('elbow_bend');
}

export function personalizedProgress(
  profile: ExerciseProfile,
  features: FrameFeatures,
  baseline: Baseline,
): number {
  if (profile.bodyBaselineId !== bodyBaselineIdentifier(baseline)) return 0;
  if (
    profile.topTorsoTiltDeg !== undefined &&
    features.torsoTiltDeg < Math.max(30, profile.topTorsoTiltDeg - 20)
  ) {
    return 0;
  }

  const current = exerciseSignals(features, baseline);
  const values = new Map<ExerciseSignalId, number>();
  for (const signal of profile.signals) {
    const motion = signal.direction * (current[signal.id] - signal.ready);
    const deadZone = signal.noise * 3;
    const target = Math.max(MIN_CHANGE[signal.id] * 0.25, signal.range * COUNT_RANGE - deadZone);
    values.set(signal.id, Math.max(0, motion - deadZone) / target);
  }
  return Math.max(0, combineExerciseSignals(profile.exercise, values));
}

export function personalizedFormThresholds(profile: ExerciseProfile): {
  good: number;
  excellent: number;
} {
  const progressAt = (rangeFraction: number): number => {
    const values = new Map<ExerciseSignalId, number>();
    for (const signal of profile.signals) {
      const deadZone = signal.noise * 3;
      const target = Math.max(MIN_CHANGE[signal.id] * 0.25, signal.range * COUNT_RANGE - deadZone);
      values.set(signal.id, Math.max(0, signal.range * rangeFraction - deadZone) / target);
    }
    return combineExerciseSignals(profile.exercise, values);
  };
  return { good: progressAt(GOOD_RANGE), excellent: progressAt(EXCELLENT_RANGE) };
}

const STORAGE_KEY = 'primal.exercise-profiles.v2';

export function loadExerciseProfiles(
  baseline: Baseline,
): Partial<Record<ExerciseId, ExerciseProfile>> {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<
      Record<ExerciseId, ExerciseProfile>
    >;
    const baselineId = bodyBaselineIdentifier(baseline);
    return Object.fromEntries(
      Object.entries(parsed).filter(
        ([, profile]) => profile?.version === 2 && profile.bodyBaselineId === baselineId,
      ),
    );
  } catch {
    return {};
  }
}

export function saveExerciseProfile(profile: ExerciseProfile): void {
  try {
    const raw = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? '{}') as Partial<
      Record<ExerciseId, ExerciseProfile>
    >;
    raw[profile.exercise] = profile;
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(raw));
  } catch {
    // Private browsing or a full quota: the profile still works for this session.
  }
}

export function clearExerciseProfiles(): void {
  try {
    window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage is optional; the in-memory profiles are cleared by the engine.
  }
}
