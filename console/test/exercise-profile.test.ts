import { describe, expect, it } from 'vitest';
import type { ExerciseId } from '@bosco98/primal-sdk';
import { Calibrator, type Baseline } from '../src/recognition/calibration.js';
import {
  analyzeExerciseCalibration,
  bodyBaselineIdentifier,
  clearExerciseProfiles,
  exerciseCalibrationSample,
  ExerciseProfileCalibrator,
  median,
  medianAbsoluteDeviation,
  madInlierMask,
  loadExerciseProfiles,
  personalizedProgress,
  percentile,
  robustMovementStats,
  saveExerciseProfile,
  type ExerciseCalibrationSample,
  type ExerciseProfile,
} from '../src/recognition/exercise-profile.js';
import { FeatureExtractor, type FrameFeatures } from '../src/recognition/features.js';
import { createRecognizer } from '../src/recognition/exercises.js';
import type { PoseFixture, PoseFrame } from '../src/pose/types.js';
import {
  makeFrame,
  makeJumpingJackSet,
  makeLungeSet,
  makePushupSet,
  makeSquatSet,
} from './synthetic.js';

function standingBaseline(): Baseline {
  const extractor = new FeatureExtractor();
  const calibrator = new Calibrator();
  calibrator.start();
  for (let i = 0; i < 90; i++) calibrator.update(extractor.extract(makeFrame(i * 33.3)));
  if (!calibrator.current) throw new Error('Synthetic body did not calibrate');
  return calibrator.current;
}

function extractAll(frames: readonly PoseFrame[]): FrameFeatures[] {
  const extractor = new FeatureExtractor();
  return frames.map((frame) => extractor.extract(frame));
}

function learn(
  exercise: ExerciseId,
  fixture: PoseFixture,
  baseline: Baseline,
): ExerciseProfile {
  const features = extractAll(fixture.frames);
  const movement = features.filter((frame) => frame.t >= 2500);
  const readyFeatures =
    exercise === 'pushup'
      ? movement.filter(
          (frame) =>
            frame.torsoTiltDeg > 55 &&
            (frame.elbowAngleLeft + frame.elbowAngleRight) / 2 > 168,
        )
      : features.filter((frame) => frame.t < 2000);
  const ready = readyFeatures.map((frame) => exerciseCalibrationSample(exercise, frame, baseline));
  const samples = movement.map((frame) => exerciseCalibrationSample(exercise, frame, baseline));
  const analysis = analyzeExerciseCalibration(exercise, ready, samples, baseline, 1234);
  if (!analysis.profile) {
    throw new Error(`Calibration failed: ${analysis.issue ?? 'not enough cycles'}`);
  }
  return analysis.profile;
}

function runPersonalized(
  fixture: PoseFixture,
  exercise: ExerciseId,
  profile: ExerciseProfile,
  baseline: Baseline,
): number {
  const recognizer = createRecognizer(exercise)!;
  recognizer.setProfile(profile);
  const extractor = new FeatureExtractor();
  let reps = 0;
  for (const frame of fixture.frames) {
    if (recognizer.update(extractor.extract(frame), baseline).rep) reps++;
  }
  return reps;
}

describe('robust calibration math', () => {
  it('uses medians and MAD without being shifted by one extreme sample', () => {
    const values = [10, 10, 11, 12, 500];
    expect(median(values)).toBe(11);
    expect(medianAbsoluteDeviation(values)).toBe(1);
    expect(percentile([0, 10, 20, 30, 40], 0.9)).toBe(36);
  });

  it('selects the larger robust movement direction', () => {
    expect(robustMovementStats([10, 10, 10], [10, 8, 5, 2, 0]).direction).toBe(-1);
    expect(robustMovementStats([10, 10, 10], [10, 12, 15, 18, 20]).direction).toBe(1);
  });

  it('rejects a peak beyond 2.5 median absolute deviations', () => {
    expect(madInlierMask([1, 1.02, 0.99, 1.01, 2])).toEqual([
      true,
      true,
      true,
      true,
      false,
    ]);
  });

  it('binds a profile to the body calibration that produced it', () => {
    const baseline = standingBaseline();
    const changed = { ...baseline, capturedAt: baseline.capturedAt + 1 };
    expect(bodyBaselineIdentifier(changed)).not.toBe(bodyBaselineIdentifier(baseline));
  });

  it('loads only v2 profiles for the current body baseline', () => {
    const stored = new Map<string, string>();
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      value: {
        clear: () => stored.clear(),
        getItem: (key: string) => stored.get(key) ?? null,
        removeItem: (key: string) => stored.delete(key),
        setItem: (key: string, value: string) => stored.set(key, value),
      },
    });
    window.localStorage.clear();
    const baseline = standingBaseline();
    const profile = learn('squat', makeSquatSet({ reps: 5 }), baseline);
    window.localStorage.setItem('primal.exercise-profiles.v1', JSON.stringify({ squat: profile }));
    expect(loadExerciseProfiles(baseline)).toEqual({});

    saveExerciseProfile(profile);
    expect(loadExerciseProfiles(baseline).squat?.version).toBe(2);
    expect(loadExerciseProfiles({ ...baseline, capturedAt: baseline.capturedAt + 1 })).toEqual({});
    clearExerciseProfiles();
    expect(loadExerciseProfiles(baseline)).toEqual({});
  });
});

describe('multi-rep personalized calibration', () => {
  it('learns five reduced-depth squats and counts five fresh reps exactly', () => {
    const baseline = standingBaseline();
    const calibration = makeSquatSet({ reps: 5, minKneeAngle: 125 });
    const profile = learn('squat', calibration, baseline);
    const fresh = makeSquatSet({ reps: 5, minKneeAngle: 125 });
    expect(profile.version).toBe(2);
    expect(profile.acceptedReps).toBe(5);
    expect(runPersonalized(fresh, 'squat', profile, baseline)).toBe(5);
  });

  it('learns shallow-range jumping jacks but still requires arms and stance', () => {
    const baseline = standingBaseline();
    const calibration = makeJumpingJackSet({ reps: 5, peakSpread: 0.5, peakArms: 0.8 });
    const profile = learn('jumping_jack', calibration, baseline);
    expect(profile.signals.map((signal) => signal.id)).toEqual(
      expect.arrayContaining(['arm_raise', 'stance_width']),
    );
    expect(runPersonalized(calibration, 'jumping_jack', profile, baseline)).toBe(5);
    expect(
      runPersonalized(
        makeJumpingJackSet({ reps: 5, peakSpread: 0.2, peakArms: 0.8 }),
        'jumping_jack',
        profile,
        baseline,
      ),
    ).toBe(0);
  });

  it('learns lunges when one leg is temporarily unavailable', () => {
    const baseline = standingBaseline();
    const fixture = makeLungeSet({ reps: 5 });
    const occluded = {
      ...fixture,
      frames: fixture.frames.map((frame) => ({
        ...frame,
        landmarks: frame.landmarks.map((point, index) =>
          index === 26 || index === 28 ? { ...point, visibility: 0.15 } : { ...point },
        ),
        world: frame.world.map((point) => ({ ...point })),
      })),
    };
    const profile = learn('lunge', occluded, baseline);
    expect(runPersonalized(occluded, 'lunge', profile, baseline)).toBe(5);
  });

  it('learns the user top-plank orientation for push-ups', () => {
    const baseline = standingBaseline();
    const fixture = makePushupSet({ reps: 5, minElbowAngle: 110 });
    const profile = learn('pushup', fixture, baseline);
    expect(profile.topTorsoTiltDeg).toBeGreaterThan(55);
    expect(runPersonalized(fixture, 'pushup', profile, baseline)).toBe(5);
  });

  it('learns and counts push-ups when the far arm is hidden side-on', () => {
    const baseline = standingBaseline();
    const fixture = makePushupSet({ reps: 5, minElbowAngle: 105 });
    const sideOn = {
      ...fixture,
      frames: fixture.frames.map((frame) => ({
        ...frame,
        landmarks: frame.landmarks.map((point, index) =>
          index === 12 || index === 14 || index === 16
            ? { ...point, visibility: 0.1 }
            : { ...point },
        ),
        world: frame.world.map((point) => ({ ...point })),
      })),
    };
    const profile = learn('pushup', sideOn, baseline);
    expect(runPersonalized(sideOn, 'pushup', profile, baseline)).toBe(5);
  });

  it('refuses to save a jack calibration when only the arms move', () => {
    const baseline = standingBaseline();
    const fixture = makeJumpingJackSet({ reps: 5, peakSpread: 0.2, peakArms: 1 });
    const features = extractAll(fixture.frames);
    const ready = features
      .filter((frame) => frame.t < 2000)
      .map((frame) => exerciseCalibrationSample('jumping_jack', frame, baseline));
    const movement = features
      .filter((frame) => frame.t >= 2500)
      .map((frame) => exerciseCalibrationSample('jumping_jack', frame, baseline));
    const analysis = analyzeExerciseCalibration(
      'jumping_jack',
      ready,
      movement,
      baseline,
    );
    expect(analysis.profile).toBeNull();
    expect(analysis.issue).toMatch(/feet/i);
  });

  it('keeps ready-position jitter inside the three-MAD dead zone', () => {
    const baseline = standingBaseline();
    const profile = learn('squat', makeSquatSet({ reps: 5, minKneeAngle: 120 }), baseline);
    const frame = extractAll([makeFrame(0, { kneeAngle: 174 })])[0]!;
    expect(personalizedProgress(profile, frame, baseline)).toBeLessThan(0.1);
  });
});

describe('calibration cycle quality', () => {
  it('does not produce a profile from fewer than three cycles', () => {
    const baseline = standingBaseline();
    const fixture = makeSquatSet({ reps: 2, minKneeAngle: 110 });
    const features = extractAll(fixture.frames);
    const sample = (frame: FrameFeatures): ExerciseCalibrationSample =>
      exerciseCalibrationSample('squat', frame, baseline);
    const analysis = analyzeExerciseCalibration(
      'squat',
      features.filter((frame) => frame.t < 2000).map(sample),
      features.filter((frame) => frame.t >= 2500).map(sample),
      baseline,
    );
    expect(analysis.acceptedCycles).toBe(2);
    expect(analysis.profile).toBeNull();
  });

  it('auto-completes after five accepted cycles', () => {
    const baseline = standingBaseline();
    const calibrator = new ExerciseProfileCalibrator();
    calibrator.start('squat', baseline);
    const features = extractAll(
      makeSquatSet({ reps: 5, minKneeAngle: 118, leadInMs: 5500 }).frames,
    );
    for (const frame of features) calibrator.update(frame);
    expect(calibrator.state.stage).toBe('complete');
    expect(calibrator.state.validReps).toBe(5);
    expect(calibrator.state.profile?.version).toBe(2);
  });

  it('allows Finish now after three accepted cycles', () => {
    const baseline = standingBaseline();
    const calibrator = new ExerciseProfileCalibrator();
    calibrator.start('squat', baseline);
    const features = extractAll(
      makeSquatSet({ reps: 3, minKneeAngle: 118, leadInMs: 5500 }).frames,
    );
    for (const frame of features) calibrator.update(frame);
    expect(calibrator.state.stage).toBe('recording');
    expect(calibrator.state.canFinish).toBe(true);
    expect(calibrator.finish().stage).toBe('complete');
  });

  it('times out instead of saving an unreliable motion sample', () => {
    const baseline = standingBaseline();
    const calibrator = new ExerciseProfileCalibrator();
    calibrator.start('squat', baseline);
    const stillFrames = Array.from({ length: 1600 }, (_, index) =>
      makeFrame(index * 33.3),
    );
    for (const frame of extractAll(stillFrames)) calibrator.update(frame);
    expect(calibrator.state.stage).toBe('failed');
    expect(calibrator.state.profile).toBeNull();
  });
});
