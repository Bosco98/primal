import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import type { PoseRecording } from '../src/pose/PoseRecorder.js';
import { FeatureExtractor, type FrameFeatures } from '../src/recognition/features.js';
import { createRecognizer, definitionFor } from '../src/recognition/exercises.js';
import {
  analyzeExerciseCalibration,
  exerciseCalibrationSample,
  exerciseSignals,
  ExerciseProfileCalibrator,
  median,
  medianAbsoluteDeviation,
  visibleForExerciseCalibration,
} from '../src/recognition/exercise-profile.js';

interface Row {
  t: number;
  progress: number;
  visible: boolean;
  primary: number;
  secondary: number;
  rep: boolean;
}

for (const input of process.argv.slice(2)) {
  const recording = JSON.parse(readFileSync(resolve(input), 'utf8')) as PoseRecording;
  const definition = definitionFor(recording.exercise);
  const recognizer = createRecognizer(recording.exercise);
  if (!definition || !recognizer) throw new Error(`Unknown exercise: ${recording.exercise}`);

  const extractor = new FeatureExtractor();
  const rows: Row[] = [];
  const extracted: FrameFeatures[] = [];
  for (const frame of recording.frames) {
    const features = extractor.extract(frame);
    extracted.push(features);
    const progress = features.present ? definition.progress(features, recording.baseline) : 0;
    const output = recognizer.update(features, recording.baseline);
    const [primary, secondary] = signals(recording.exercise, features, recording.baseline);
    rows.push({
      t: frame.t,
      progress,
      visible:
        definition.requires === 'full'
          ? features.lowerBodyVisible && features.upperBodyVisible
          : definition.requires === 'lower'
            ? features.lowerBodyVisible
            : definition.requires === 'lower_any'
              ? features.leftLowerBodyVisible || features.rightLowerBodyVisible
              : definition.requires === 'upper_any'
                ? features.leftUpperBodyVisible || features.rightUpperBodyVisible
                : features.upperBodyVisible,
      primary,
      secondary,
      rep: output.rep !== undefined,
    });
  }

  const bouts = movementBouts(rows);
  console.log(`\n${input}`);
  console.log(
    JSON.stringify({
      exercise: recording.exercise,
      expected: recording.expectedReps,
      savedDetected: recording.detectedReps,
      replayDetected: rows.filter((row) => row.rep).length,
      frames: rows.length,
      invisibleFrames: rows.filter((row) => !row.visible).length,
      maxProgress: round(Math.max(...rows.map((row) => row.progress))),
    }),
  );
  for (const [index, bout] of bouts.entries()) {
    const peak = bout.reduce((best, row) => (row.progress > best.progress ? row : best));
    console.log(
      `${index + 1}: ${round(bout[0]!.t / 1000)}-${round(bout.at(-1)!.t / 1000)}s ` +
        `peak=${round(peak.progress)} signals=${round(peak.primary)},${round(peak.secondary)} ` +
        `visible=${bout.every((row) => row.visible)} counted=${bout.some((row) => row.rep)}`,
    );
  }


  const ready = findReadyWindow(recording.exercise, extracted, recording.baseline);
  if (ready) {
    const readySamples = ready.frames.map((features) =>
      exerciseCalibrationSample(recording.exercise, features, recording.baseline),
    );
    const movementFrames = extracted.filter((features) => features.t > ready.end);
    const movementSamples = movementFrames.map((features) =>
      exerciseCalibrationSample(recording.exercise, features, recording.baseline),
    );
    const learned = analyzeExerciseCalibration(
      recording.exercise,
      readySamples,
      movementSamples,
      recording.baseline,
    );
    let personalizedReplay = 0;
    if (learned.profile) {
      const personalized = createRecognizer(recording.exercise)!;
      personalized.setProfile(learned.profile);
      for (const features of movementFrames) {
        if (personalized.update(features, recording.baseline).rep) personalizedReplay++;
      }
    }
    console.log(
      JSON.stringify({
        readyWindowSeconds: [round(ready.start / 1000), round(ready.end / 1000)],
        learnedCycles: learned.acceptedCycles,
        learnedSignals: learned.reliableSignals,
        personalizedReplay,
        learningIssue: learned.issue,
      }),
    );
  }

  const guidedCalibration = new ExerciseProfileCalibrator();
  guidedCalibration.start(recording.exercise, recording.baseline);
  for (const features of extracted) guidedCalibration.update(features);
  let guidedReplay = 0;
  if (guidedCalibration.state.profile) {
    const personalized = createRecognizer(recording.exercise)!;
    personalized.setProfile(guidedCalibration.state.profile);
    for (const features of extracted) {
      if (personalized.update(features, recording.baseline).rep) guidedReplay++;
    }
  }
  console.log(
    JSON.stringify({
      handsFreeStage: guidedCalibration.state.stage,
      handsFreeCycles: guidedCalibration.state.validReps,
      handsFreeReplay: guidedReplay,
      handsFreeMessage: guidedCalibration.state.message,
    }),
  );
}

function findReadyWindow(
  exercise: PoseRecording['exercise'],
  frames: FrameFeatures[],
  baseline: PoseRecording['baseline'],
): { start: number; end: number; frames: FrameFeatures[] } | null {
  const present = frames.filter((features) => features.present);
  if (present.length === 0) return null;
  const searchEnd = present[0]!.t + (present.at(-1)!.t - present[0]!.t) * 0.45;
  let best: { start: number; end: number; frames: FrameFeatures[]; score: number } | null = null;

  for (let index = 0; index < present.length; index++) {
    const start = present[index]!.t;
    if (start > searchEnd) break;
    const window = present.filter((features) => features.t >= start && features.t <= start + 2000);
    if (window.length < 10 || window.at(-1)!.t - start < 1800) continue;
    if (window.filter((features) => visibleForExerciseCalibration(exercise, features)).length / window.length < 0.9) {
      continue;
    }
    if (exercise === 'pushup' && median(window.map((features) => features.torsoTiltDeg)) < 50) {
      continue;
    }

    const signal = exercise === 'pushup' ? 'elbow_bend' : exercise === 'jumping_jack' ? 'arm_raise' : 'hip_drop';
    const values = window.map((features) => exerciseSignals(features, baseline)[signal]);
    const score = medianAbsoluteDeviation(values) + median(window.map((features) => features.overallSpeed));
    if (!best || score < best.score) best = { start, end: window.at(-1)!.t, frames: window, score };
  }
  return best;
}

function movementBouts(rows: Row[]): Row[][] {
  const bouts: Row[][] = [];
  let current: Row[] | null = null;
  let restFrames = 0;

  for (const row of rows) {
    if (!current && row.progress >= 0.3) current = [row];
    else if (current) current.push(row);
    if (!current) continue;

    if (row.progress <= 0.2) restFrames++;
    else restFrames = 0;
    if (restFrames >= 3) {
      bouts.push(current);
      current = null;
      restFrames = 0;
    }
  }
  if (current) bouts.push(current);
  return bouts;
}

function signals(
  exercise: PoseRecording['exercise'],
  features: FrameFeatures,
  baseline: PoseRecording['baseline'],
): [number, number] {
  if (exercise === 'jumping_jack') {
    return [
      (features.wristRiseMean - baseline.standingWristRise) / 1.5,
      (features.ankleSpread - baseline.standingAnkleSpread) / 0.55,
    ];
  }
  if (exercise === 'lunge') {
    return [
      (features.hipY - baseline.standingHipY) / baseline.torsoLength / 0.26,
      features.ankleSplitZ,
    ];
  }
  if (exercise === 'pushup') {
    return [
      features.torsoTiltDeg / 45,
      (168 - (features.elbowAngleLeft + features.elbowAngleRight) / 2) / 62,
    ];
  }
  return [
    (features.hipY - baseline.standingHipY) / baseline.torsoLength / 0.28,
    (baseline.standingKneeAngle - features.kneeAngleMean) / 38,
  ];
}

function round(value: number): number {
  return Math.round(value * 100) / 100;
}
