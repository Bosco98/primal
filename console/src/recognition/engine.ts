import type {
  BodyPayload,
  ExerciseId,
  GesturePayload,
  IntensityPayload,
  RepPayload,
  RepProgressPayload,
  SubscribePayload,
  TrackingStatusPayload,
} from '@bosco98/primal-sdk';
import type { PoseFrame } from '../pose/types.js';
import { Calibrator, type Baseline, type CalibrationState } from './calibration.js';
import { FeatureExtractor, type FrameFeatures } from './features.js';
import { GestureRecognizer } from './gestures.js';
import { buildBody, buildTrackingStatus, IntensityTracker } from './signals.js';
import { ExerciseRecognizer, type RepDebug } from './exercise.js';
import type { ExerciseProfile } from './exercise-profile.js';
import { AVAILABLE_EXERCISES, createRecognizer } from './exercises.js';

export { AVAILABLE_EXERCISES, STABLE_EXERCISES } from './exercises.js';

/** Image-space reference lines for the on-screen movement guide. */
export interface DepthGuide {
  restY: number;
  targetY: number;
  currentY: number;
  label: string;
}

export interface RecognitionOutput {
  features: FrameFeatures;
  calibration: CalibrationState;
  tracking: TrackingStatusPayload;
  intensity: IntensityPayload;
  /** Null until calibration completes. */
  body: BodyPayload | null;
  reps: RepPayload[];
  progress: RepProgressPayload[];
  gestures: GesturePayload[];
  /** Live state of the tracked exercise, so the UI can explain a missed rep. */
  rep: RepDebug | null;
  guide: DepthGuide | null;
}

export interface SessionTotals {
  reps: Partial<Record<ExerciseId, number>>;
  /** Seconds during which the player was actually moving. */
  activeSeconds: number;
  avgIntensity: number;
}

/**
 * Owns the whole path from pose frames to protocol payloads.
 *
 * Both the dev dashboard and `GameHost` drive this same object, so what a
 * developer sees on the debug overlay is exactly what a game receives.
 */
export class RecognitionEngine {
  private readonly extractor = new FeatureExtractor();
  private readonly calibrator = new Calibrator();
  private readonly gestures = new GestureRecognizer();
  private readonly intensity = new IntensityTracker();
  private readonly recognizers = new Map<ExerciseId, ExerciseRecognizer>();
  private readonly exerciseProfiles = new Map<ExerciseId, ExerciseProfile>();

  private repCounts = new Map<ExerciseId, number>();
  private nextRepId = 1;
  private subscription: SubscribePayload = { channels: [] };

  private activeMs = 0;
  private intensitySum = 0;
  private intensitySamples = 0;
  private lastFrameT: number | null = null;

  constructor() {
    this.setSubscription({ channels: ['rep', 'gesture', 'body', 'intensity'], exercises: ['squat'] });
  }

  get baseline(): Baseline | null {
    return this.calibrator.current;
  }

  get isCalibrated(): boolean {
    return this.calibrator.current !== null;
  }

  startCalibration(): void {
    this.calibrator.start();
  }

  restoreBaseline(baseline: Baseline): void {
    this.calibrator.restore(baseline);
  }

  setExerciseProfiles(profiles: Partial<Record<ExerciseId, ExerciseProfile>>): void {
    for (const profile of Object.values(profiles)) {
      if (profile) this.setExerciseProfile(profile);
    }
  }

  setExerciseProfile(profile: ExerciseProfile): void {
    this.exerciseProfiles.set(profile.exercise, profile);
    this.recognizers.get(profile.exercise)?.setProfile(profile);
  }

  clearExerciseProfiles(): void {
    this.exerciseProfiles.clear();
    this.recognizers.forEach((recognizer) => recognizer.setProfile(null));
  }

  hasExerciseProfile(exercise: ExerciseId): boolean {
    return this.exerciseProfiles.has(exercise);
  }

  /**
   * Apply a game's channel subscription. Recognisers for exercises nobody
   * subscribed to are dropped, which is real CPU back in the frame budget.
   */
  setSubscription(subscription: SubscribePayload): void {
    this.subscription = subscription;

    const wanted = subscription.channels.includes('rep')
      ? (subscription.exercises ?? []).filter((exercise) => AVAILABLE_EXERCISES.includes(exercise))
      : [];

    for (const exercise of wanted) {
      if (!this.recognizers.has(exercise)) {
        const recognizer = createRecognizer(exercise);
        if (recognizer) {
          recognizer.setProfile(this.exerciseProfiles.get(exercise) ?? null);
          this.recognizers.set(exercise, recognizer);
        }
      }
    }
    for (const exercise of [...this.recognizers.keys()]) {
      if (!wanted.includes(exercise)) this.recognizers.delete(exercise);
    }
  }

  /** Exercises a game asked for that this console cannot yet detect. */
  unsupportedExercises(subscription: SubscribePayload): ExerciseId[] {
    return (subscription.exercises ?? []).filter(
      (exercise) => !AVAILABLE_EXERCISES.includes(exercise),
    );
  }

  resetSession(): void {
    this.extractor.reset();
    this.gestures.reset();
    this.intensity.reset();
    this.recognizers.forEach((recognizer) => recognizer.reset());
    this.repCounts = new Map();
    this.nextRepId = 1;
    this.activeMs = 0;
    this.intensitySum = 0;
    this.intensitySamples = 0;
    this.lastFrameT = null;
  }

  get totals(): SessionTotals {
    const reps: Partial<Record<ExerciseId, number>> = {};
    for (const [exercise, count] of this.repCounts) reps[exercise] = count;
    return {
      reps,
      activeSeconds: Math.round(this.activeMs / 1000),
      avgIntensity: this.intensitySamples === 0 ? 0 : this.intensitySum / this.intensitySamples,
    };
  }

  process(frame: PoseFrame): RecognitionOutput {
    const features = this.extractor.extract(frame);
    const calibration = this.calibrator.update(features);
    const intensity = this.intensity.update(features);
    const tracking = buildTrackingStatus(features, this.calibrator.current);

    this.accumulate(features, intensity);

    const baseline = this.calibrator.current;
    if (!baseline) {
      return {
        features,
        calibration,
        tracking,
        intensity,
        body: null,
        reps: [],
        progress: [],
        gestures: [],
        rep: null,
        guide: null,
      };
    }

    const reps: RepPayload[] = [];
    const progress: RepProgressPayload[] = [];

    for (const [exercise, recognizer] of this.recognizers) {
      const output = recognizer.update(features, baseline);
      if (output.progress) progress.push(output.progress);
      if (output.rep) {
        const count = (this.repCounts.get(exercise) ?? 0) + 1;
        this.repCounts.set(exercise, count);
        reps.push({
          exercise: output.rep.exercise,
          repId: this.nextRepId++,
          count,
          formScore: output.rep.formScore,
          flags: output.rep.flags,
          durationMs: output.rep.durationMs,
        });
      }
    }

    const gestures = this.subscription.channels.includes('gesture')
      ? this.gestures.update(features, baseline).map(
          (event): GesturePayload => ({
            gesture: event.gesture,
            state: event.state,
            confidence: event.confidence,
          }),
        )
      : [];

    // The dashboard shows one exercise at a time; when a game subscribes to
    // several, the first is the one whose guide and live state are displayed.
    const primary = this.recognizers.values().next().value ?? null;
    const lines = primary?.definition.guide?.(baseline) ?? null;

    return {
      features,
      calibration,
      tracking,
      intensity,
      body: buildBody(features, baseline),
      reps,
      progress,
      gestures,
      rep: primary?.debug ?? null,
      guide: lines
        ? {
            restY: lines.restY,
            targetY: lines.targetY,
            label: lines.label,
            currentY: lines.track === 'hip' ? features.hipY : lowestWrist(features),
          }
        : null,
    };
  }

  private accumulate(features: FrameFeatures, intensity: IntensityPayload): void {
    if (this.lastFrameT !== null && features.present) {
      const dt = features.t - this.lastFrameT;
      // Ignore absurd gaps: a backgrounded tab must not bank an hour of "active".
      if (dt > 0 && dt < 500 && intensity.instant > 0.12) {
        this.activeMs += dt;
      }
    }
    this.lastFrameT = features.t;

    if (features.present) {
      this.intensitySum += intensity.avg10s;
      this.intensitySamples++;
    }
  }
}

/** The higher of the two wrists in image space, for arm-tracking guides. */
function lowestWrist(features: FrameFeatures): number {
  return Math.min(features.wristLeft.y, features.wristRight.y);
}
