import { lazy, Suspense, useEffect, useState } from 'react';
import { usePose } from './usePose.js';
import { coachFor } from './control/signals.js';
import { ControllerOverlay } from './ui/ControllerOverlay.js';
import { ControlsGuide } from './ui/ControlsGuide.js';
import type { RunSummary } from './types.js';

// Keep Three.js and the gameplay renderer out of the title-screen bundle. In
// camera mode it loads during framing, before the hands-free countdown ends;
// on slower connections the explicit fallback is still preferable to a blank
// first paint.
const Stage = lazy(() => import('./ui/Stage.js').then((module) => ({ default: module.Stage })));

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
    void import('./ui/Stage.js');
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
      <Suspense fallback={<div className="game-loading"><b>Building your track…</b><span>One quick breath.</span></div>}>
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
      </Suspense>
    );
  }

  return (
    <div className="app">
      <header className="masthead">
        <a className="brand" href={import.meta.env.BASE_URL} aria-label="The Herd home">
          <span className="brand__mark" aria-hidden>H</span>
          <span>THE HERD</span>
        </a>
        <p className="tagline">A three-minute movement run</p>
      </header>

      {screen === 'title' && (
        <section className="home">
          <div className="home__copy">
            <p className="session-pill">No equipment · 3 minutes · full body</p>
            <h1>Run wild.<br />Move big.</h1>
            <p className="lede">
              Turn your room into an arcade track. Jump, squat, hop and reach — your body
              controls every move.
            </p>
            <div className="row home__actions">
              <button type="button" className="primary" onClick={beginFraming}>
                Start moving <span aria-hidden>→</span>
              </button>
              <button type="button" className="secondary" onClick={() => setShowGuide(true)}>
                See the moves
              </button>
            </div>
            <button type="button" className="link" onClick={beginDeskRun}>
              No camera? Try keyboard mode
            </button>
            <p className="privacy-note">
              <span aria-hidden>●</span> Private by design — camera processing stays on this device.
            </p>
          </div>

          <div className="workout-visual" aria-hidden>
            <span className="workout-visual__sun" />
            <span className="workout-visual__cloud cloud--one" />
            <span className="workout-visual__cloud cloud--two" />
            <div className="workout-visual__track">
              <i /><i />
            </div>
            <div className="workout-visual__runner">
              <span className="runner__head" />
              <span className="runner__body" />
              <span className="runner__arm runner__arm--left" />
              <span className="runner__arm runner__arm--right" />
              <span className="runner__leg runner__leg--left" />
              <span className="runner__leg runner__leg--right" />
            </div>
            <p><strong>60</strong> moves to a stronger finish</p>
          </div>
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
                  ? 'You’re ready — stay there and we’ll start together.'
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
            {summary.outcome === 'caught' ? 'Strong effort' : 'Finish strong!'}
          </h2>
          <p className="summary__label">Your run score</p>
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
