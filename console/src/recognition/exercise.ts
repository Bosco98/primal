import type { ExerciseId, RepFlag } from '@bosco98/primal-sdk';
import type { Baseline } from './calibration.js';
import type { FrameFeatures } from './features.js';
import {
  personalizedFormThresholds,
  personalizedProgress,
  type ExerciseProfile,
} from './exercise-profile.js';
import {
  clamp01,
  normaliseRange,
  NO_OUTPUT,
  type DetectedRep,
  type RecognizerOutput,
  type RepRecognizer,
} from './recognizer.js';

/**
 * The shared skeleton for every rep-counted exercise.
 *
 * Adding an exercise means writing an `ExerciseDefinition` — a function that
 * says how far through the movement the player currently is, plus a few
 * thresholds — and nothing else. The state machine, hysteresis, dwell
 * requirements, abandon timeout, form scoring, and flag logic are shared, so an
 * accuracy fix made once applies to every exercise at once.
 *
 * The single idea that makes this work is **normalised progress**: every
 * exercise reduces to one number where `0` is the resting pose and `1.0` is the
 * shallowest movement that may be counted as a rep. A squat measures it from
 * hip drop and knee bend, a jumping jack from arms and stance, a push-up from
 * elbow bend. Downstream, none of them are special cases.
 */

export interface Tempo {
  /** Below this, the movement was not controlled. */
  tooFastMs: number;
  idealMinMs: number;
  idealMaxMs: number;
  /** Above this, the player is resting mid-rep rather than repping. */
  tooSlowMs: number;
}

export const DEFAULT_TEMPO: Tempo = {
  tooFastMs: 700,
  idealMinMs: 1100,
  idealMaxMs: 3200,
  tooSlowMs: 6000,
};

/** Horizontal reference lines the UI draws over the camera preview. */
export interface GuideLines {
  /** Image-space y of the resting position. */
  restY: number;
  /** Image-space y the player must reach. */
  targetY: number;
  /** Which landmark the moving marker tracks. */
  track: 'hip' | 'wrist';
  label: string;
}

export interface ExerciseDefinition {
  id: ExerciseId;
  label: string;
  /** Shown to the player before a set. */
  cue: string;
  /**
   * Recognition quality. `beta` exercises are real but unreliable enough that
   * the UI should say so rather than let a player think they are broken.
   */
  beta?: boolean;
  /** Which half of the body must be visible for this to be judged at all. */
  requires: 'lower' | 'lower_any' | 'upper' | 'upper_any' | 'full';

  /**
   * How far through the movement the player is right now.
   * `0` is resting, `1.0` is the shallowest rep that counts. Values above 1 are
   * meaningful and are what depth scoring is built from — do not clamp.
   */
  progress(features: FrameFeatures, baseline: Baseline): number;

  /** Progress that counts as good form. Below it the rep is flagged shallow. */
  goodProgress: number;
  /** Progress beyond which no further credit is given. */
  excellentProgress: number;

  tempo?: Partial<Tempo>;

  /**
   * Left/right imbalance as 0..1 badness; above 0.5 flags the rep. Omit for
   * movements that are asymmetric by design, such as lunges.
   */
  asymmetry?(features: FrameFeatures): number;

  /**
   * Extra per-exercise flags, for problems that are not depth or tempo.
   */
  extraFlags?(peak: FrameFeatures, baseline: Baseline): RepFlag[];

  guide?(baseline: Baseline): GuideLines | null;
}

/* -------------------------------------------------------------------------- */
/* Shared thresholds                                                           */
/* -------------------------------------------------------------------------- */

/**
 * Enter and leave on different values, always. A signal resting on a single
 * boundary chatters, and chatter counted as reps is the fastest way to lose a
 * player's trust in the counter.
 */
const ENTER_PROGRESS = 0.38;
const EXIT_PROGRESS = 0.2;

/** Frames a transition must persist before it is believed (~65ms at 30fps). */
const MIN_PHASE_FRAMES = 2;

/**
 * A rep in flight longer than this is abandoned. Without it the machine can
 * wait forever for a return that never comes — which is exactly how squat
 * counting used to die after a single rep.
 */
const MAX_REP_MS = 9000;
/** Brief pose dropouts are common when a wrist crosses the torso. */
const OCCLUSION_GRACE_MS = 250;

const ASYMMETRY_FLAG_AT = 0.5;

export type RepPhase4 = 'rest' | 'entering' | 'peak' | 'leaving';

/** Live state for the UI, so a rep that does not count can be explained. */
export interface RepDebug {
  exercise: ExerciseId;
  label: string;
  phase: RepPhase4;
  /** 0..1+ where 1 is the threshold to count. */
  progress: number;
  deepEnough: boolean;
  beta: boolean;
}

/**
 * The state machine, shared by every exercise.
 *
 * rest -> entering -> peak -> leaving -> rep
 */
export class ExerciseRecognizer implements RepRecognizer {
  readonly exercise: ExerciseId;

  private readonly def: ExerciseDefinition;
  private readonly tempo: Tempo;

  private phase: RepPhase4 = 'rest';
  private phaseFrames = 0;
  private repStartedAt = 0;
  private peakProgress = 0;
  private peakFeatures: FrameFeatures | null = null;
  private worstAsymmetry = 0;
  private lastDebug: RepDebug | null = null;
  private lastBaseline: Baseline | null = null;
  private profile: ExerciseProfile | null = null;
  private occludedAt: number | null = null;

  constructor(definition: ExerciseDefinition) {
    this.def = definition;
    this.exercise = definition.id;
    this.tempo = { ...DEFAULT_TEMPO, ...definition.tempo };
  }

  get definition(): ExerciseDefinition {
    return this.def;
  }

  get debug(): RepDebug | null {
    return this.lastDebug;
  }

  setProfile(profile: ExerciseProfile | null): void {
    this.profile = profile?.exercise === this.exercise ? profile : null;
    this.reset();
  }

  reset(): void {
    this.phase = 'rest';
    this.phaseFrames = 0;
    this.repStartedAt = 0;
    this.peakProgress = 0;
    this.peakFeatures = null;
    this.worstAsymmetry = 0;
    this.occludedAt = null;
  }

  update(features: FrameFeatures, baseline: Baseline): RecognizerOutput {
    if (!features.present || !this.visible(features)) {
      if (this.occludedAt === null) this.occludedAt = features.t;
      if (features.t - this.occludedAt <= OCCLUSION_GRACE_MS) return NO_OUTPUT;
      if (this.phase !== 'rest') this.reset();
      this.lastDebug = null;
      return NO_OUTPUT;
    }
    this.occludedAt = null;

    this.lastBaseline = baseline;
    const progress = this.profile
      ? personalizedProgress(this.profile, features, baseline)
      : this.def.progress(features, baseline);
    const deepEnough = progress >= 1;

    if (this.phase !== 'rest') {
      if (progress > this.peakProgress) {
        this.peakProgress = progress;
        this.peakFeatures = features;
      }
      if (this.def.asymmetry) {
        this.worstAsymmetry = Math.max(this.worstAsymmetry, this.def.asymmetry(features));
      }
      if (features.t - this.repStartedAt > MAX_REP_MS) {
        this.reset();
        this.lastDebug = this.buildDebug(progress, deepEnough);
        return { progress: this.emitProgress('rest', 0) };
      }
    }

    this.lastDebug = this.buildDebug(progress, deepEnough);

    switch (this.phase) {
      case 'rest':
        return this.whileResting(features, progress);
      case 'entering':
        return this.whileEntering(progress, deepEnough);
      case 'peak':
        return this.whileAtPeak(progress, deepEnough);
      case 'leaving':
        return this.whileLeaving(features, progress, deepEnough);
    }
  }

  private visible(features: FrameFeatures): boolean {
    switch (this.def.requires) {
      case 'lower':
        return features.lowerBodyVisible;
      case 'lower_any':
        return features.leftLowerBodyVisible || features.rightLowerBodyVisible;
      case 'upper':
        return features.upperBodyVisible;
      case 'upper_any':
        return features.leftUpperBodyVisible || features.rightUpperBodyVisible;
      case 'full':
        return features.lowerBodyVisible && features.upperBodyVisible;
    }
  }

  private whileResting(features: FrameFeatures, progress: number): RecognizerOutput {
    if (progress < ENTER_PROGRESS) {
      this.phaseFrames = 0;
      return NO_OUTPUT;
    }

    this.phaseFrames++;
    if (this.phaseFrames < MIN_PHASE_FRAMES) return NO_OUTPUT;

    this.phase = 'entering';
    this.phaseFrames = 0;
    this.repStartedAt = features.t;
    this.peakProgress = progress;
    this.peakFeatures = features;
    this.worstAsymmetry = this.def.asymmetry?.(features) ?? 0;

    return { progress: this.emitProgress('down', progress) };
  }

  private whileEntering(progress: number, deepEnough: boolean): RecognizerOutput {
    if (deepEnough) {
      this.phase = 'peak';
      this.phaseFrames = 0;
      return { progress: this.emitProgress('bottom', progress) };
    }

    // Returned to rest without ever going deep enough: not a rep, no event.
    if (progress <= EXIT_PROGRESS) {
      this.phaseFrames++;
      if (this.phaseFrames >= MIN_PHASE_FRAMES) {
        this.reset();
        return { progress: this.emitProgress('rest', 0) };
      }
      return { progress: this.emitProgress('down', progress) };
    }

    this.phaseFrames = 0;
    return { progress: this.emitProgress('down', progress) };
  }

  private whileAtPeak(progress: number, deepEnough: boolean): RecognizerOutput {
    if (deepEnough) {
      this.phaseFrames = 0;
      return { progress: this.emitProgress('bottom', progress) };
    }

    this.phaseFrames++;
    if (this.phaseFrames >= MIN_PHASE_FRAMES) {
      this.phase = 'leaving';
      this.phaseFrames = 0;
    }
    return { progress: this.emitProgress('up', progress) };
  }

  private whileLeaving(
    features: FrameFeatures,
    progress: number,
    deepEnough: boolean,
  ): RecognizerOutput {
    // Dipped back down before finishing: still the same rep.
    if (deepEnough) {
      this.phase = 'peak';
      this.phaseFrames = 0;
      return { progress: this.emitProgress('bottom', progress) };
    }

    if (progress > EXIT_PROGRESS) {
      this.phaseFrames = 0;
      return { progress: this.emitProgress('up', progress) };
    }

    this.phaseFrames++;
    if (this.phaseFrames < MIN_PHASE_FRAMES) {
      return { progress: this.emitProgress('up', progress) };
    }

    const rep = this.completeRep(features.t, this.peakFeatures ?? features);
    this.reset();
    return { rep, progress: this.emitProgress('rest', 0) };
  }

  private completeRep(now: number, peak: FrameFeatures): DetectedRep {
    const durationMs = now - this.repStartedAt;
    const flags: RepFlag[] = [];

    const personalized = this.profile ? personalizedFormThresholds(this.profile) : null;
    const goodProgress = personalized?.good ?? this.def.goodProgress;
    const excellentProgress = personalized?.excellent ?? this.def.excellentProgress;
    const depthScore = normaliseRange(this.peakProgress, 1, excellentProgress);
    if (this.peakProgress < goodProgress) flags.push('shallow');

    let tempoScore: number;
    const { tooFastMs, idealMinMs, idealMaxMs, tooSlowMs } = this.tempo;
    if (durationMs < tooFastMs) {
      tempoScore = 0;
      flags.push('fast');
    } else if (durationMs < idealMinMs) {
      tempoScore = normaliseRange(durationMs, tooFastMs, idealMinMs);
      flags.push('fast');
    } else if (durationMs <= idealMaxMs) {
      tempoScore = 1;
    } else {
      tempoScore = normaliseRange(durationMs, tooSlowMs, idealMaxMs);
    }

    let symmetryScore = 1;
    if (this.def.asymmetry) {
      symmetryScore = 1 - clamp01(this.worstAsymmetry);
      if (this.worstAsymmetry > ASYMMETRY_FLAG_AT) flags.push('asymmetric');
    }

    if (this.lastBaseline) {
      for (const flag of this.def.extraFlags?.(peak, this.lastBaseline) ?? []) {
        if (!flags.includes(flag)) flags.push(flag);
      }
    }

    const formScore = clamp01(depthScore * 0.55 + tempoScore * 0.25 + symmetryScore * 0.2);
    return { exercise: this.def.id, formScore, flags, durationMs };
  }

  private buildDebug(progress: number, deepEnough: boolean): RepDebug {
    return {
      exercise: this.def.id,
      label: this.def.label,
      phase: this.phase,
      progress,
      deepEnough,
      beta: this.def.beta === true,
    };
  }

  private emitProgress(
    phase: 'down' | 'bottom' | 'up' | 'rest',
    progress: number,
  ): RecognizerOutput['progress'] {
    const depth = clamp01(progress);
    return {
      exercise: this.def.id,
      phase,
      progress: phase === 'bottom' ? 1 : phase === 'up' ? clamp01(1 - progress) : depth,
      depth,
    };
  }
}
