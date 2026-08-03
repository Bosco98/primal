import { useEffect, useRef, useState } from 'react';
import { Run } from '../game/run.js';
import { attachKeyboard } from '../control/keyboard.js';
import { ControllerOverlay } from './ControllerOverlay.js';
import type { ControlFrame } from '../control/engine.js';
import type { RunSummary } from '../types.js';

export interface StageProps {
  video: HTMLVideoElement | null;
  sinkRef: React.RefObject<((frame: ControlFrame) => void) | null>;
  /** True when there is no camera and the keyboard is driving. */
  deskMode: boolean;
  onEnd(summary: RunSummary): void;
  onQuit(): void;
}

/**
 * A run in progress: the game filling the screen, and the camera reduced to a
 * corner.
 *
 * The camera is deliberately small here. It was full-size during framing
 * because that is when you need to aim; once you are positioned the controls
 * are proprioceptive and the *runner* is your feedback — you know the duck
 * registered because the runner ducked, not because you watched a line light
 * up in a thumbnail. The corner preview answers one question: am I still in
 * frame.
 */
export function Stage({ video, sinkRef, deskMode, onEnd, onQuit }: StageProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const runRef = useRef<Run | null>(null);
  const frameRef = useRef<ControlFrame | null>(null);
  const [coaching, setCoaching] = useState(false);

  // Callbacks in a ref, out of the deps: they arrive as inline arrows, so a
  // fresh identity every render would tear the run down mid-frame.
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;
  const onQuitRef = useRef(onQuit);
  onQuitRef.current = onQuit;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const run = new Run(canvas, {
      onEnd: (summary) => onEndRef.current(summary),
      onCoach: (message) => setCoaching(message !== null),
    });
    runRef.current = run;

    sinkRef.current = (frame) => {
      frameRef.current = frame;
      run.feed(frame);
    };

    const keyboard = deskMode ? attachKeyboard() : null;
    if (keyboard) {
      const tick = (): void => {
        run.feedKeyboard(keyboard, performance.now());
        keyboardRaf = requestAnimationFrame(tick);
      };
      var keyboardRaf = requestAnimationFrame(tick);
    }

    const onResize = (): void => run.resize();
    window.addEventListener('resize', onResize);
    // Escape leaves the run. A player standing two metres back cannot reach a
    // button, but the keyboard is still the thing they walked away from.
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onQuitRef.current();
    };
    window.addEventListener('keydown', onKey);
    // A backgrounded tab stops delivering frames; a run that kept its timer
    // going would charge the player for seconds they were not exercising.
    const onVisibility = (): void => run.setPaused(document.hidden);
    document.addEventListener('visibilitychange', onVisibility);

    run.resize();
    run.start();

    return () => {
      window.removeEventListener('resize', onResize);
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('visibilitychange', onVisibility);
      sinkRef.current = null;
      keyboard?.detach();
      if (keyboard) cancelAnimationFrame(keyboardRaf);
      run.stop();
      runRef.current = null;
    };
  }, [sinkRef, deskMode]);

  return (
    <div className="stage">
      <canvas ref={canvasRef} className="stage__canvas" />

      {!deskMode && (
        <div className="stage__camera" aria-label="Camera preview">
          <ControllerOverlay video={video} frameRef={frameRef} labelled={false} />
        </div>
      )}

      {coaching && (
        <div className="stage__coach" role="status">
          <strong>Step back into view</strong>
          <span>Your run is waiting — nothing is being lost.</span>
        </div>
      )}

      {deskMode && (
        <p className="stage__hint">
          Desk mode · <b>W/Space</b> jump · <b>S</b> duck · <b>A/D</b> hop · mouse moves your hands
        </p>
      )}

      <button type="button" className="stage__quit" onClick={onQuit}>
        Quit
      </button>
    </div>
  );
}
