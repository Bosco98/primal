import { useState } from 'react';
import type {
  ExerciseId,
  GestureId,
  RepFlag,
  WorkoutSummaryPayload,
} from '@bosco98/primal-sdk';
import { GameStage } from './games/GameStage.js';
import { Library } from './games/Library.js';
import type { GameEntry } from './games/registry.js';

import { EXERCISE_DEFINITIONS } from './recognition/exercises.js';
import { SkeletonOverlay } from './ui/SkeletonOverlay.js';
import {
  usePoseEngine,
  type EngineSnapshot,
} from './usePoseEngine.js';
import type { ExerciseCalibrationState } from './recognition/exercise-profile.js';

/** Reported to games in the welcome, so a game can adapt to an older console. */
const CONSOLE_VERSION = '0.2.0';


/**
 * Phase 0 + 1 dev dashboard.
 *
 * This is not the launcher. It exists so the pose pipeline and the recognisers
 * can be watched directly — if a rep counter is wrong, it is wrong here first,
 * in a screen with every intermediate number on it.
 */
export default function App() {
  const [launched, setLaunched] = useState<GameEntry | null>(null);
  const [lastSummary, setLastSummary] = useState<WorkoutSummaryPayload | null>(null);
  const {
    status,
    error,
    snapshot,
    video,
    frameRef,
    guideRef,
    deepEnoughRef,
    exercise,
    setExercise,
    start,
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
    engineRef,
    outputSinkRef,
  } = usePoseEngine();

  const calibrated = snapshot.calibration?.phase === 'done';

  // A launched game owns the whole screen. The dashboard is a dev tool, and
  // leaving it visible next to a game would put the player's attention on
  // numbers instead of on moving.
  if (launched && engineRef.current) {
    return (
      <GameStage
        entry={launched}
        engine={engineRef.current}
        consoleVersion={CONSOLE_VERSION}
        sinkRef={outputSinkRef}
        onExit={(summary) => {
          setLastSummary(summary);
          setLaunched(null);
        }}
      />
    );
  }

  return (
    <div className="app">
      <header className="header">
        <h1>
          PRIMAL<span className="dot" />
        </h1>
        <p className="tagline">motion pipeline · dev dashboard</p>
      </header>

      {status === 'idle' && <StartScreen onStart={start} />}
      {status === 'starting' && <p className="notice">Starting camera and loading the model…</p>}
      {status === 'error' && (
        <div className="notice error">
          <strong>{error}</strong>
          <button onClick={start}>Try again</button>
        </div>
      )}

      {status === 'running' && (
        <>
        {lastSummary && (
          <p className="notice" role="status">
            Last session: {lastSummary.activeSeconds.toFixed(0)}s active ·{' '}
            {Math.round(lastSummary.avgIntensity * 100)}% avg intensity
            {typeof lastSummary.score === 'number' && ` · ${lastSummary.score} pts`}
          </p>
        )}
        <Library ready={calibrated} onLaunch={setLaunched} />
        </>
      )}

      {status === 'running' && (
        <main className="layout">
          <section className="preview">
            <SkeletonOverlay
              video={video}
              frameRef={frameRef}
              guideRef={guideRef}
              deepEnoughRef={deepEnoughRef}
              quality={snapshot.tracking?.quality ?? 0}
            />
            <CalibrationBanner snapshot={snapshot} />
            <ExerciseCalibrationControls
              exercise={exercise}
              calibrated={snapshot.calibration?.phase === 'done'}
              isRecording={isRecording}
              calibration={exerciseCalibration}
              hasProfile={hasExerciseProfile}
              onBegin={beginExerciseCalibration}
              onFinish={finishExerciseCalibration}
              onCancel={cancelExerciseCalibration}
            />
            <RecordingControls
              calibrated={snapshot.calibration?.phase === 'done'}
              isRecording={isRecording}
              isCalibrating={isActiveExerciseCalibration(exerciseCalibration)}
              seconds={recordingSeconds}
              notice={recordingNotice}
              onStart={startRecording}
              onSave={saveRecording}
            />
          </section>

          <aside className="panels">
            <ExercisePanel exercise={exercise} onSelect={setExercise} />
            <RepPanel snapshot={snapshot} />
            <GesturePanel snapshot={snapshot} />
            <SignalPanel snapshot={snapshot} />
            <StatsPanel snapshot={snapshot} />
            <div className="actions">
              <button onClick={resetReps}>Reset reps</button>
              <button onClick={recalibrate}>Recalibrate</button>
            </div>
          </aside>
        </main>
      )}
    </div>
  );
}

function ExerciseCalibrationControls({
  exercise,
  calibrated,
  isRecording,
  calibration,
  hasProfile,
  onBegin,
  onFinish,
  onCancel,
}: {
  exercise: ExerciseId;
  calibrated: boolean;
  isRecording: boolean;
  calibration: ExerciseCalibrationState;
  hasProfile: boolean;
  onBegin: () => void;
  onFinish: () => void;
  onCancel: () => void;
}) {
  const label = EXERCISE_DEFINITIONS.find((definition) => definition.id === exercise)?.label;
  const active = isActiveExerciseCalibration(calibration);
  const actionLabel = active
    ? calibration.stage === 'countdown'
      ? 'Get ready'
      : calibration.stage === 'ready_hold'
        ? 'Hold ready'
        : 'Perform 5 normal reps'
    : hasProfile
      ? `Learn my ${label} again`
      : `Learn my ${label}`;
  const progressLabel = calibration.stage === 'recording'
    ? `${calibration.validReps} / 5`
    : calibration.countdown > 0
      ? String(calibration.countdown)
      : null;

  return (
    <div className={active ? 'exercise-calibration-controls active' : 'exercise-calibration-controls'}>
      {progressLabel && (
        <div className="exercise-calibration-progress" aria-hidden="true">
          {progressLabel}
        </div>
      )}
      <button disabled={!calibrated || isRecording || active} onClick={onBegin}>
        {calibrated ? actionLabel : 'Finish body calibration first'}
      </button>
      <p className="exercise-calibration-help" role="status" aria-live="polite">
        {calibration.message ||
          (hasProfile ? 'Personal range active' : 'Optional · using the default movement range')}
      </p>
      {active && (
        <div className="exercise-calibration-actions">
          {calibration.canFinish && (
            <button className="finish-calibration" onClick={onFinish}>Finish now</button>
          )}
          <button className="cancel-calibration" onClick={onCancel}>Cancel</button>
        </div>
      )}
    </div>
  );
}

function RecordingControls({
  calibrated,
  isRecording,
  isCalibrating,
  seconds,
  notice,
  onStart,
  onSave,
}: {
  calibrated: boolean;
  isRecording: boolean;
  isCalibrating: boolean;
  seconds: number;
  notice: string | null;
  onStart: () => void;
  onSave: () => void;
}) {
  return (
    <div className={isRecording ? 'recording-controls active' : 'recording-controls'}>
      {isRecording && (
        <div className="recording-status" role="status" aria-live="polite">
          <span className="recording-dot" aria-hidden="true" />
          Recording · {seconds}s
        </div>
      )}
      <button
        className={isRecording ? 'save-recording' : 'start-recording'}
        disabled={(!isRecording && !calibrated) || isCalibrating}
        onClick={isRecording ? onSave : onStart}
      >
        {isRecording
          ? 'Download debug sample'
          : calibrated
            ? 'Export debug sample'
            : 'Finish calibration first'}
      </button>
      <p className="recording-help" aria-live="polite">
        {isRecording
          ? 'Move normally, then download the landmark data.'
          : notice ?? 'Secondary debug tool · pose coordinates only, no video'}
      </p>
    </div>
  );
}

function isActiveExerciseCalibration(calibration: ExerciseCalibrationState): boolean {
  return (
    calibration.stage === 'countdown' ||
    calibration.stage === 'ready_hold' ||
    calibration.stage === 'recording'
  );
}

function StartScreen({ onStart }: { onStart: () => void }) {
  return (
    <div className="start">
      <h2>Your body is the controller.</h2>
      {/*
        Explaining before prompting is not just manners: a browser permission
        prompt that arrives unexplained gets denied, and a denied camera is a
        dead console with no obvious way back.
      */}
      <p>
        PRIMAL uses your webcam to see how you move. Video is processed entirely on this
        machine and never leaves it. Personal calibration stores only derived movement
        measurements in this browser. Debug samples contain landmarks, never video.
      </p>
      <p className="hint">
        Stand about two metres back so your whole body is in frame, then hold still for a
        moment while it calibrates.
      </p>
      <button className="primary" onClick={onStart}>
        Enable camera
      </button>
    </div>
  );
}

function CalibrationBanner({ snapshot }: { snapshot: EngineSnapshot }) {
  const calibration = snapshot.calibration;
  if (!calibration || calibration.phase === 'done' || calibration.phase === 'idle') {
    const issues = snapshot.tracking?.issues ?? [];
    if (issues.length === 0) return null;
    return <div className="banner warn">{describeIssues(issues)}</div>;
  }

  return (
    <div className="banner">
      <span>{calibration.message}</span>
      <div className="progress">
        <div style={{ width: `${Math.round(calibration.progress * 100)}%` }} />
      </div>
    </div>
  );
}

function ExercisePanel({
  exercise,
  onSelect,
}: {
  exercise: ExerciseId;
  onSelect: (next: ExerciseId) => void;
}) {
  const active = EXERCISE_DEFINITIONS.find((d) => d.id === exercise);
  return (
    <div className="panel">
      <h3>Exercise</h3>
      <div className="pills">
        {EXERCISE_DEFINITIONS.map((definition) => (
          <button
            key={definition.id}
            className={definition.id === exercise ? 'pill on' : 'pill'}
            onClick={() => onSelect(definition.id)}
          >
            {definition.label}
            {definition.beta ? ' ·β' : ''}
          </button>
        ))}
      </div>
      {active && <p className="sub">{active.cue}</p>}
      {active?.beta && (
        <p className="sub warn-text">
          Beta: a front-facing webcam struggles to see this one. Set up side-on.
        </p>
      )}
    </div>
  );
}

function RepPanel({ snapshot }: { snapshot: EngineSnapshot }) {
  const rep = snapshot.lastRep;
  return (
    <div className="panel">
      <h3>{snapshot.rep?.label ?? 'Reps'}</h3>
      <div className="count">{snapshot.repCount}</div>
      <Meter label="Range of motion" value={snapshot.rep?.progress ?? 0} />
      <p className="sub phase">
        {snapshot.rep
          ? `${snapshot.rep.phase}${snapshot.rep.deepEnough ? ' · that counts' : ''}`
          : 'waiting for tracking'}
      </p>
      {rep ? (
        <>
          <Meter label="Form" value={rep.formScore} />
          <div className="flags">
            {rep.flags.length === 0 ? (
              <span className="flag good">clean</span>
            ) : (
              rep.flags.map((flag) => (
                <span key={flag} className="flag">
                  {describeFlag(flag)}
                </span>
              ))
            )}
          </div>
          <p className="sub">{Math.round(rep.durationMs)}ms per rep</p>
        </>
      ) : (
        <p className="sub">Do a rep to see form scoring.</p>
      )}
    </div>
  );
}

const GESTURES: GestureId[] = [
  'lean_left',
  'lean_right',
  'crouch',
  'jump',
  'block',
  'punch_left',
  'punch_right',
];

function GesturePanel({ snapshot }: { snapshot: EngineSnapshot }) {
  const active = new Set(snapshot.activeGestures);
  return (
    <div className="panel">
      <h3>Gestures</h3>
      <div className="pills">
        {GESTURES.map((gesture) => (
          <span key={gesture} className={active.has(gesture) ? 'pill on' : 'pill'}>
            {gesture.replace('_', ' ')}
          </span>
        ))}
      </div>
    </div>
  );
}

function SignalPanel({ snapshot }: { snapshot: EngineSnapshot }) {
  const body = snapshot.body;
  return (
    <div className="panel">
      <h3>Signals</h3>
      <Meter label="Intensity" value={snapshot.intensity} />
      <Meter label="Intensity 10s" value={snapshot.intensityAvg} />
      <Meter label="Crouch" value={body?.crouch ?? 0} />
      <Meter label="Lean" value={((body?.lean ?? 0) + 1) / 2} centered />
      <p className="sub">{snapshot.activeSeconds}s active this session</p>
    </div>
  );
}

function StatsPanel({ snapshot }: { snapshot: EngineSnapshot }) {
  const healthy = snapshot.fps >= 20;
  return (
    <div className="panel">
      <h3>Pipeline</h3>
      <dl className="stats">
        <dt>Pose FPS</dt>
        <dd className={healthy ? 'ok' : 'bad'}>{snapshot.fps}</dd>
        <dt>Inference</dt>
        <dd>{snapshot.inferenceMs}ms</dd>
        <dt>Delegate</dt>
        <dd className={snapshot.delegate === 'GPU' ? 'ok' : 'bad'}>{snapshot.delegate ?? '—'}</dd>
        <dt>Dropped</dt>
        <dd>{snapshot.dropped}</dd>
        <dt>Quality</dt>
        <dd>{Math.round((snapshot.tracking?.quality ?? 0) * 100)}%</dd>
        {/*
          These two are the first thing to look at when a rep does not count.
          Knee angle is what MediaPipe thinks your leg is doing; standing is what
          it measured at calibration. If they are close while you are squatting,
          the camera cannot see your bend and hip drop is carrying the rep.
        */}
        <dt>Progress</dt>
        <dd>{snapshot.rep ? snapshot.rep.progress.toFixed(2) : '—'}</dd>
        <dt>Phase</dt>
        <dd>{snapshot.rep?.phase ?? '—'}</dd>
      </dl>
    </div>
  );
}

function Meter({
  label,
  value,
  centered = false,
}: {
  label: string;
  value: number;
  centered?: boolean;
}) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div className="meter">
      <div className="meter-label">
        <span>{label}</span>
        <span>{centered ? `${pct - 50 > 0 ? '+' : ''}${pct - 50}` : `${pct}%`}</span>
      </div>
      <div className="meter-track">
        <div className="meter-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

function describeFlag(flag: RepFlag): string {
  switch (flag) {
    case 'shallow':
      return 'too shallow';
    case 'fast':
      return 'too fast';
    case 'asymmetric':
      return 'uneven';
    case 'partial':
      return 'partial';
  }
}

function describeIssues(issues: readonly string[]): string {
  if (issues.includes('too_close')) return 'Step back a little.';
  if (issues.includes('too_far')) return 'Step closer.';
  if (issues.includes('low_light')) return 'Too dark — turn on a light.';
  if (issues.includes('not_in_frame')) return 'Get your whole body in frame.';
  return 'Tracking is unsteady.';
}
