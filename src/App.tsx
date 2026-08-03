import { useRef, useState } from 'react';
import { usePose } from './usePose.js';
import { coachFor } from './control/signals.js';
import { ControllerOverlay } from './ui/ControllerOverlay.js';
import { ControlsGuide } from './ui/ControlsGuide.js';
import { Stage } from './ui/Stage.js';
import type { RunSummary } from './types.js';
import type { ZoneState } from './control/zones.js';

type Screen = 'title' | 'framing' | 'playing' | 'summary';

/**
 * Four screens, in order: title, framing, run, summary.
 *
 * The framing step is the only one that might look like ceremony, and it is
 * load-bearing. Jump detection reads ankle height against a rolling ground
 * reference; with the player's feet out of frame that reference collapses to
 * the bottom of the picture and the controls quietly stop working for a reason
 * nobody could be expected to guess. So the game refuses to start until it can
 * see feet, and says why. It is a live check, not a countdown — it clears the
 * instant you step back, and there is nothing to hold still for.
 */
export default function App(): React.JSX.Element {
  const [screen, setScreen] = useState<Screen>('title');
  const [showGuide, setShowGuide] = useState(false);
  const [summary, setSummary] = useState<RunSummary | null>(null);
  const [deskMode, setDeskMode] = useState(false);
  const { status, error, tracking, video, start, sinkRef, frameRef } = usePose();

  // The framing overlay reads live zone state straight off the pose loop.
  const zonesRef = useRef<ZoneState | null>(null);
  zonesRef.current = frameRef.current?.zones ?? null;

  const beginFraming = (): void => {
    setDeskMode(false);
    setScreen('framing');
    void start();
  };

  const beginDeskRun = (): void => {
    setDeskMode(true);
    setScreen('playing');
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
        onQuit={() => setScreen('title')}
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
                <ControllerOverlay video={video} zonesRef={zonesRef} />
              </div>
              <p className={tracking.playable ? 'framing__status ok' : 'framing__status'}>
                {tracking.playable ? 'Good — all of you is in frame.' : coachFor(tracking)}
              </p>
              <div className="row">
                <button
                  type="button"
                  className="primary"
                  disabled={!tracking.playable}
                  onClick={() => setScreen('playing')}
                >
                  {tracking.playable ? 'Run' : 'Step back to start'}
                </button>
                <button type="button" onClick={() => setShowGuide(true)}>
                  How to play
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
          <div className="row">
            <button type="button" className="primary" onClick={() => setScreen('playing')}>
              Again
            </button>
            <button type="button" onClick={() => setScreen('title')}>
              Done
            </button>
          </div>
        </section>
      )}

      {showGuide && <ControlsGuide onClose={() => setShowGuide(false)} />}
    </div>
  );
}
