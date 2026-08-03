import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  BodyPayload,
  ExerciseId,
  GestureId,
  RepPayload,
  TrackingStatusPayload,
} from '@bosco98/primal-sdk';
import { CameraError, CameraPoseSource } from './pose/CameraPoseSource.js';
import { PoseRecorder, type PoseRecording } from './pose/PoseRecorder.js';
import type { PoseFrame, PoseSource } from './pose/types.js';
import { loadBaseline, saveBaseline, type CalibrationState } from './recognition/calibration.js';
import { RecognitionEngine, type DepthGuide, type RecognitionOutput } from './recognition/engine.js';
import type { RepDebug } from './recognition/exercise.js';
import type { ZoneState } from './recognition/zones.js';
import {
  clearExerciseProfiles,
  ExerciseProfileCalibrator,
  loadExerciseProfiles,
  saveExerciseProfile,
  type ExerciseCalibrationStage,
  type ExerciseCalibrationState,
  type ExerciseProfile,
} from './recognition/exercise-profile.js';

export type { ExerciseCalibrationStage } from './recognition/exercise-profile.js';

export type EngineStatus = 'idle' | 'starting' | 'running' | 'error';

export interface EngineSnapshot {
  fps: number;
  inferenceMs: number;
  delegate: 'GPU' | 'CPU' | null;
  dropped: number;
  calibration: CalibrationState | null;
  tracking: TrackingStatusPayload | null;
  intensity: number;
  intensityAvg: number;
  body: BodyPayload | null;
  repCount: number;
  lastRep: RepPayload | null;
  activeGestures: GestureId[];
  activeSeconds: number;
  rep: RepDebug | null;
}

const EMPTY: EngineSnapshot = {
  fps: 0,
  inferenceMs: 0,
  delegate: null,
  dropped: 0,
  calibration: null,
  tracking: null,
  intensity: 0,
  intensityAvg: 0,
  body: null,
  repCount: 0,
  lastRep: null,
  activeGestures: [],
  activeSeconds: 0,
  rep: null,
};

/** React state updates per second. The canvas reads a ref and runs at full rate. */
const UI_HZ = 12;
const IDLE_EXERCISE_CALIBRATION: ExerciseCalibrationState = {
  stage: 'idle',
  message: '',
  countdown: 0,
  validReps: 0,
  canFinish: false,
  elapsedSeconds: 0,
  profile: null,
};

/**
 * Drives the camera, the recognition engine, and the debug UI.
 *
 * Pose frames arrive at 30Hz but React re-renders at 12Hz: the skeleton canvas
 * reads the latest frame from a ref instead, so nothing in the render path is
 * tied to inference rate. Rep and gesture events bypass the throttle, because a
 * counter that updates an eighth of a second late feels broken.
 */
export function usePoseEngine() {
  const [status, setStatus] = useState<EngineStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [snapshot, setSnapshot] = useState<EngineSnapshot>(EMPTY);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);
  const [isRecording, setIsRecording] = useState(false);
  const [recordingSeconds, setRecordingSeconds] = useState(0);
  const [recordingNotice, setRecordingNotice] = useState<string | null>(null);
  const [exercise, setExerciseState] = useState<ExerciseId>('squat');
  const [exerciseCalibration, setExerciseCalibration] = useState<ExerciseCalibrationState>(
    IDLE_EXERCISE_CALIBRATION,
  );
  const [hasExerciseProfile, setHasExerciseProfile] = useState(false);

  const sourceRef = useRef<PoseSource | null>(null);
  const engineRef = useRef<RecognitionEngine | null>(null);
  const frameRef = useRef<PoseFrame | null>(null);
  const guideRef = useRef<DepthGuide | null>(null);
  const deepEnoughRef = useRef(false);
  const pendingRef = useRef<EngineSnapshot>(EMPTY);
  const savedBaselineAtRef = useRef<number | null>(null);
  const repLogRef = useRef<RepPayload[]>([]);
  const gesturesRef = useRef<Set<GestureId>>(new Set());
  const startedRef = useRef(false);
  const recorderRef = useRef(new PoseRecorder());
  const recordingStartCountRef = useRef(0);
  const recordingStartedAtRef = useRef(0);
  const exerciseCalibratorRef = useRef(new ExerciseProfileCalibrator());
  const exerciseCalibrationRef = useRef<ExerciseCalibrationState>(
    IDLE_EXERCISE_CALIBRATION,
  );
  /**
   * Where a running game taps the pipeline. A ref rather than state on purpose:
   * this is read once per pose frame, and re-rendering the dashboard 30 times a
   * second to deliver it would cost more than the game does.
   */
  const outputSinkRef = useRef<((output: RecognitionOutput) => void) | null>(null);
  /** Live control-grid state for the overlay. Ref, so it can render at 60Hz. */
  const zonesRef = useRef<ZoneState | null>(null);

  const activateExerciseProfile = useCallback(
    (profile: ExerciseProfile, engine = engineRef.current) => {
      if (!engine) return;
      engine.setExerciseProfile(profile);
      saveExerciseProfile(profile);
      repLogRef.current = [];
      engine.resetSession();
      setHasExerciseProfile(true);
    },
    [],
  );

  const stop = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current = null;
    engineRef.current = null;
    frameRef.current = null;
    recorderRef.current.cancel();
    setIsRecording(false);
    setRecordingSeconds(0);
    setRecordingNotice(null);
    exerciseCalibratorRef.current.cancel();
    exerciseCalibrationRef.current = IDLE_EXERCISE_CALIBRATION;
    setExerciseCalibration(IDLE_EXERCISE_CALIBRATION);
    startedRef.current = false;
    setVideo(null);
    setStatus('idle');
    setSnapshot(EMPTY);
  }, []);

  const start = useCallback(async () => {
    // React 18+ StrictMode mounts effects twice in development; without this
    // guard the second pass opens a second camera stream and the first leaks.
    if (startedRef.current) return;
    startedRef.current = true;

    setStatus('starting');
    setError(null);

    const engine = new RecognitionEngine();
    const saved = loadBaseline();
    if (saved) {
      engine.restoreBaseline(saved);
      engine.setExerciseProfiles(loadExerciseProfiles(saved));
    } else {
      engine.startCalibration();
    }
    setHasExerciseProfile(engine.hasExerciseProfile('squat'));
    engineRef.current = engine;

    const source = new CameraPoseSource({
      onDelegateFallback: (cause) =>
        console.warn('[primal] GPU delegate unavailable, falling back to CPU', cause),
    });
    sourceRef.current = source;

    source.onFrame((frame) => {
      frameRef.current = frame;
      recorderRef.current.capture(frame);
      const calibrationWasActive = isExerciseCalibrationActive(
        exerciseCalibrationRef.current.stage,
      );
      const output = engine.process(frame);

      const baseline = engine.baseline;
      if (baseline && calibrationWasActive) {
        const previous = exerciseCalibrationRef.current;
        const next = exerciseCalibratorRef.current.update(output.features);
        if (calibrationStateChanged(previous, next)) {
          exerciseCalibrationRef.current = next;
          setExerciseCalibration(next);
          announceCalibration(previous, next);
        }
        if (next.stage === 'complete' && previous.stage !== 'complete' && next.profile) {
          activateExerciseProfile(next.profile, engine);
        }
      }

      guideRef.current = output.guide;
      deepEnoughRef.current = output.rep?.deepEnough ?? false;

      // Games see exactly what the dashboard sees, from the same object, on the
      // same frame — so a bug reproduced on the debug overlay is the same bug.
      zonesRef.current = output.zones;
      outputSinkRef.current?.(output);

      // Only persist when the baseline is actually new. This used to write to
      // localStorage on every frame — a synchronous disk write at 30Hz, which
      // is pure jank on the one thread inference is running on.
      const capturedBaseline = output.calibration.baseline;
      if (capturedBaseline && savedBaselineAtRef.current !== capturedBaseline.capturedAt) {
        savedBaselineAtRef.current = capturedBaseline.capturedAt;
        saveBaseline(capturedBaseline);
      }

      for (const gesture of output.gestures) {
        if (gesture.state === 'start') gesturesRef.current.add(gesture.gesture);
        else gesturesRef.current.delete(gesture.gesture);
      }
      if (output.reps.length > 0 && !calibrationWasActive) {
        repLogRef.current.push(...output.reps);
      }

      const totals = engine.totals;
      pendingRef.current = {
        fps: Math.round(source.stats.fps),
        inferenceMs: Math.round(source.stats.inferenceMs * 10) / 10,
        delegate: source.delegate,
        dropped: source.stats.dropped,
        calibration: output.calibration,
        tracking: output.tracking,
        intensity: output.intensity.instant,
        intensityAvg: output.intensity.avg10s,
        body: output.body,
        repCount: repLogRef.current.length,
        lastRep: repLogRef.current[repLogRef.current.length - 1] ?? null,
        activeGestures: [...gesturesRef.current],
        activeSeconds: totals.activeSeconds,
        rep: output.rep,
      };

      // Discrete events must land immediately; the throttle is for the numbers.
      if (output.reps.length > 0 || output.gestures.length > 0) {
        setSnapshot(pendingRef.current);
      }
    });

    try {
      await source.start();
      setVideo(source.video);
      setStatus('running');
    } catch (cause) {
      startedRef.current = false;
      const message =
        cause instanceof CameraError
          ? cause.message
          : 'Could not start the pose pipeline. Check the browser console for details.';
      setError(message);
      setStatus('error');
      sourceRef.current = null;
    }
  }, [activateExerciseProfile]);

  useEffect(() => {
    if (status !== 'running') return;
    const timer = setInterval(() => setSnapshot(pendingRef.current), 1000 / UI_HZ);
    return () => clearInterval(timer);
  }, [status]);

  useEffect(() => {
    if (!isRecording) return;
    const update = () => {
      setRecordingSeconds(Math.floor((Date.now() - recordingStartedAtRef.current) / 1000));
    };
    update();
    const timer = setInterval(update, 250);
    return () => clearInterval(timer);
  }, [isRecording]);

  useEffect(() => () => sourceRef.current?.stop(), []);

  const recalibrate = useCallback(() => {
    recorderRef.current.cancel();
    setIsRecording(false);
    setRecordingSeconds(0);
    setRecordingNotice(null);
    repLogRef.current = [];
    savedBaselineAtRef.current = null;
    guideRef.current = null;
    exerciseCalibratorRef.current.cancel();
    exerciseCalibrationRef.current = IDLE_EXERCISE_CALIBRATION;
    setExerciseCalibration(IDLE_EXERCISE_CALIBRATION);
    clearExerciseProfiles();
    engineRef.current?.clearExerciseProfiles();
    setHasExerciseProfile(false);
    engineRef.current?.startCalibration();
    engineRef.current?.resetSession();
  }, []);

  const setExercise = useCallback((next: ExerciseId) => {
    recorderRef.current.cancel();
    setIsRecording(false);
    setRecordingSeconds(0);
    setRecordingNotice(null);
    exerciseCalibratorRef.current.cancel();
    exerciseCalibrationRef.current = IDLE_EXERCISE_CALIBRATION;
    setExerciseCalibration(IDLE_EXERCISE_CALIBRATION);
    setExerciseState(next);
    repLogRef.current = [];
    guideRef.current = null;
    engineRef.current?.setSubscription({
      channels: ['rep', 'gesture', 'body', 'intensity'],
      exercises: [next],
    });
    engineRef.current?.resetSession();
    setHasExerciseProfile(engineRef.current?.hasExerciseProfile(next) ?? false);
  }, []);

  const beginExerciseCalibration = useCallback(() => {
    const baseline = engineRef.current?.baseline;
    if (!baseline) {
      const state = {
        ...IDLE_EXERCISE_CALIBRATION,
        message: 'Finish body calibration first.',
      };
      exerciseCalibrationRef.current = state;
      setExerciseCalibration(state);
      return;
    }
    recorderRef.current.cancel();
    setIsRecording(false);
    setRecordingSeconds(0);
    repLogRef.current = [];
    engineRef.current?.resetSession();
    const state = exerciseCalibratorRef.current.start(exercise, baseline);
    exerciseCalibrationRef.current = state;
    setExerciseCalibration(state);
    announce('Get ready. Move into your starting position.');
  }, [exercise]);

  const finishExerciseCalibration = useCallback(() => {
    const previous = exerciseCalibrationRef.current;
    const next = exerciseCalibratorRef.current.finish();
    exerciseCalibrationRef.current = next;
    setExerciseCalibration(next);
    announceCalibration(previous, next);
    if (next.stage === 'complete' && next.profile) activateExerciseProfile(next.profile);
  }, [activateExerciseProfile]);

  const cancelExerciseCalibration = useCallback(() => {
    exerciseCalibratorRef.current.cancel();
    exerciseCalibrationRef.current = IDLE_EXERCISE_CALIBRATION;
    setExerciseCalibration(IDLE_EXERCISE_CALIBRATION);
    cancelAnnouncement();
  }, []);

  const startRecording = useCallback(() => {
    const baseline = engineRef.current?.baseline;
    if (!baseline) {
      setRecordingNotice('Finish calibration before recording.');
      return;
    }
    repLogRef.current = [];
    engineRef.current?.resetSession();
    recordingStartCountRef.current = 0;
    recordingStartedAtRef.current = Date.now();
    recorderRef.current.start(exercise, baseline);
    setRecordingSeconds(0);
    setRecordingNotice(null);
    setIsRecording(true);
  }, [exercise]);

  const saveRecording = useCallback(() => {
    const detectedReps = repLogRef.current.length - recordingStartCountRef.current;
    const recording = recorderRef.current.stop(detectedReps);
    setIsRecording(false);
    setRecordingSeconds(0);
    if (recording) {
      const filename = downloadRecording(recording);
      setRecordingNotice(`Saved ${filename}`);
    } else {
      setRecordingNotice('No pose frames were captured. Try recording again.');
    }
  }, []);

  const resetReps = useCallback(() => {
    recorderRef.current.cancel();
    setIsRecording(false);
    setRecordingSeconds(0);
    setRecordingNotice(null);
    repLogRef.current = [];
    engineRef.current?.resetSession();
  }, []);

  return {
    status,
    error,
    snapshot,
    video,
    frameRef,
    guideRef,
    deepEnoughRef,
    repLog: repLogRef,
    /** The live engine, for a game host to subscribe on the game's behalf. */
    engineRef,
    /** Set this to receive every frame of recognition output. */
    outputSinkRef,
    zonesRef,
    exercise,
    setExercise,
    start,
    stop,
    recalibrate,
    resetReps,
    isRecording,
    startRecording,
    saveRecording,
    recordingSeconds,
    recordingNotice,
    exerciseCalibration,
    hasExerciseProfile,
    beginExerciseCalibration,
    finishExerciseCalibration,
    cancelExerciseCalibration,
  };
}

function isExerciseCalibrationActive(stage: ExerciseCalibrationStage): boolean {
  return stage === 'countdown' || stage === 'ready_hold' || stage === 'recording';
}

function calibrationStateChanged(
  previous: ExerciseCalibrationState,
  next: ExerciseCalibrationState,
): boolean {
  return (
    previous.stage !== next.stage ||
    previous.countdown !== next.countdown ||
    previous.validReps !== next.validReps ||
    previous.canFinish !== next.canFinish ||
    previous.elapsedSeconds !== next.elapsedSeconds ||
    previous.message !== next.message
  );
}

function announceCalibration(
  previous: ExerciseCalibrationState,
  next: ExerciseCalibrationState,
): void {
  if (next.stage === 'recording' && next.validReps > previous.validReps) {
    announce(`${next.validReps}`);
    return;
  }
  if (next.stage === previous.stage) return;
  if (next.stage === 'ready_hold') announce('Hold ready.');
  if (next.stage === 'recording') announce('Go. Perform five normal reps.');
  if (next.stage === 'complete') announce('Calibration saved.');
  if (next.stage === 'failed') announce('Calibration incomplete. Please try again.');
}

function announce(message: string): void {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(message);
  utterance.rate = 1.05;
  window.speechSynthesis.speak(utterance);
}

function cancelAnnouncement(): void {
  if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
    window.speechSynthesis.cancel();
  }
}

function downloadRecording(recording: PoseRecording): string {
  const blob = new Blob([JSON.stringify(recording)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  const filename = `primal-${recording.exercise}-${Date.now()}.pose.json`;
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  return filename;
}
