import { useEffect, useState } from 'react';
import { usePose } from './usePose.js';
import { coachFor } from './control/signals.js';
import { ControllerOverlay } from './ui/ControllerOverlay.js';
import { ControlsGuide } from './ui/ControlsGuide.js';
import { Stage } from './ui/Stage.js';
import type { RunSummary } from './types.js';

type Screen = 'title' | 'framing' | 'playing' | 'summary';

/** Seconds the player must hold a good frame before the run starts itself. */
const AUTO_START_SECONDS = 3;

/**
 * Four screens, in order: title, framing, run, summary.
 *
 * Everything past the title must be operable from two metres away, because
 * that is where the player physically is: they cannot be framed by the camera
 * and within reach of the mouse at the same time. So nothing in the camera
 * flow requires a click. Framing starts the run by itself once the player has
 * held a good position through a short countdown; the summary restarts on a
 * jump; Escape (in `Stage`) quits a run. Buttons still exist for whoever *is*
 * at the desk, but they are the fallback, never the only path.
 */
export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('title');
  const [showGuide, setShowGuide] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [deskMode, setDeskMode] = useState(false);
  const [countdown, setCountdown] = useState<number | null>(null);
  const { status, error, tracking, video, start, stop, sinkRef, frameRef } = usePose();

  // The hands-free start. Being framed *is* the ready signal: hold it and the
  // countdown runs down; step out and it cancels. Guide open pauses it so
  // reading the instructions doesn't launch the game behind them.
  const armed =
    screen === 'framing' && status === 'running' && tracking.playable && !showGuide;
  useEffect(() => {
    if (!armed) {
      setCountdown(null);
      return;
    }
    setCountdown(AUTO_START_SECONDS);
    const timer = setInterval(
      () => setCountdown((current) => (current === null ? null : current - 1)),
      1000,
    );
    return () => clearInterval(timer);
  }, [armed]);
  useEffect(() => {
    if (countdown === 0) {
      setCountdown(null);
      setScreen('playing');
    }
  }, [countdown]);

  // The summary is also read from two metres away. The camera is still live
  // (only Done/Back releases it), so a jump is the "again" button.
  useEffect(() => {
    if (screen !== 'summary' || status !== 'running') return;
    sinkRef.current = (frame) => {
      if (frame.actions.includes('JUMP')) setScreen('playing');
    };
    return () => {
      sinkRef.current = null;
    };
  }, [screen, status, sinkRef]);

  const beginFraming = (): void => {
    setDeskMode(false);
    setScreen('framing');
    void start();
  };

  const beginDeskRun = (): void => {
    setDeskMode(true);
    setScreen('playing');
  };

  /** Every screen past the title needs a way home, and it must free the camera. */
  const goHome = (): void => {
    stop();
    setScreen('title');
  };

  if (screen === 'playing') {
    return (
      <Stage
        video={video}
        sinkRef={sinkRef}
        deskMode={deskMode}
        onEnd={(result) => {
          setSummary(result);
          setScreen('summary');
        }}
        onQuit={goHome}
      />
    );
  }

  return (
    <div className="app">
      <header className="masthead">
        <h1>
          THE HERD<span className="dot" />
        </h1>
        <p className="tagline">dusk on the savannah · something is pacing you</p>
      </header>

      {screen === 'title' && (
        <section className="card">
          <p className="lede">
            Your body is the controller. Hop between lanes, clear the fallen logs, duck the
            low branches — and keep working, because they close in the moment you flag.
          </p>
          <p className="fine">
            The camera never leaves this machine. Nothing is uploaded, nothing is recorded.
          </p>
          <div className="row">
            <button type="button" className="primary" onClick={beginFraming}>
              Start
            </button>
            <button type="button" onClick={() => setShowGuide(true)}>
              How to play
            </button>
          </div>
          <button type="button" className="link" onClick={beginDeskRun}>
            No camera? Play at a desk with the keyboard
          </button>
        </section>
      )}

      {screen === 'framing' && (
        <section className="framing">
          {status !== 'running' && (
            <button type="button" className="link" onClick={goHome}>
              ← Back
            </button>
          )}
          {status === 'starting' && (
            <p className="notice">Starting camera and loading the model…</p>
          )}
          {status === 'error' && (
            <div className="notice error">
              <strong>{error}</strong>
              <div className="row">
                <button type="button" onClick={() => void start()}>
                  Try again
                </button>
                <button type="button" onClick={beginDeskRun}>
                  Use the keyboard instead
                </button>
              </div>
            </div>
          )}

          {status === 'running' && (
            <>
              <div className="framing__camera">
                <ControllerOverlay video={video} frameRef={frameRef} />
                {countdown !== null && countdown > 0 && (
                  <div className="framing__countdown" role="status">
                    <span>{countdown}</span>
                    <small>hold it there</small>
                  </div>
                )}
              </div>
              <p className={tracking.playable ? 'framing__status ok' : 'framing__status'}>
                {tracking.playable
                  ? 'Good — hold that and the run starts by itself.'
                  : coachFor(tracking)}
              </p>
              <div className="row">
                <button type="button" onClick={() => setShowGuide(true)}>
                  How to play
                </button>
                <button type="button" className="ghost" onClick={goHome}>
                  Back
                </button>
              </div>
            </>
          )}
        </section>
      )}

      {screen === 'summary' && summary && (
        <section className="card summary">
          <h2 className={summary.outcome === 'caught' ? 'bad' : 'good'}>
            {summary.outcome === 'caught' ? 'Taken' : 'You made it'}
          </h2>
          <p className="summary__score">{summary.score.toLocaleString()}</p>
          <ul className="summary__stats">
            <li>
              <b>{summary.totalMovements}</b> movements
            </li>
            <li>
              <b>{summary.movements.jumps}</b> jumps
            </li>
            <li>
              <b>{summary.movements.ducks}</b> ducks
            </li>
            <li>
              <b>{summary.movements.laneChanges}</b> lane changes
            </li>
            <li>
              <b>{summary.movements.reaches}</b> reaches
            </li>
            <li>
              <b>{Math.round(summary.avgIntensity * 100)}%</b> avg intensity
            </li>
          </ul>
          <p className="fine">
            {Math.round(summary.activeSeconds)} seconds moving · best combo ×{summary.bestCombo}
          </p>
          {status === 'running' && !deskMode && (
            <p className="framing__status ok">Jump to go again.</p>
          )}
          <div className="row">
            <button type="button" className="primary" onClick={() => setScreen('playing')}>
              Again
            </button>
            <button type="button" onClick={goHome}>
              Done
            </button>
          </div>
        </section>
      )}

      {showGuide && <ControlsGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}
