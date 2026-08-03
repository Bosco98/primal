import { useCallback, useEffect, useRef, useState } from 'react';
import { withConsoleParam, type WorkoutSummaryPayload } from '@bosco98/primal-sdk';
import type { RecognitionEngine, RecognitionOutput } from '../recognition/engine.js';
import { GameHost, type GameHostPhase } from './GameHost.js';
import type { GameEntry } from './registry.js';

export interface GameStageProps {
  entry: GameEntry;
  engine: RecognitionEngine;
  consoleVersion: string;
  /** Where to install the per-frame tap on the pose pipeline. */
  sinkRef: React.MutableRefObject<((output: RecognitionOutput) => void) | null>;
  onExit(summary: WorkoutSummaryPayload | null): void;
}

/**
 * Mounts a game's iframe and connects it to the pose pipeline.
 *
 * The iframe is `allow`-less on purpose: a game never needs the camera. The
 * console owns the only camera stream in the product, and pose data reaches the
 * game as protocol messages — a game that could open its own camera would break
 * that promise and there is no reason to let it.
 */
export function GameStage({
  entry,
  engine,
  consoleVersion,
  sinkRef,
  onExit,
}: GameStageProps): React.JSX.Element {
  const frameRef = useRef<HTMLIFrameElement | null>(null);
  const hostRef = useRef<GameHost | null>(null);
  const [phase, setPhase] = useState<GameHostPhase>('loading');
  const [detail, setDetail] = useState<string | null>(null);
  const [previewVisible, setPreviewVisible] = useState(false);
  const [frameSrc] = useState(() => withConsoleParam(new URL(entry.url.toString())).toString());

  const exit = useCallback(async () => {
    const host = hostRef.current;
    if (!host) {
      onExit(null);
      return;
    }
    await host.end('user');
    onExit(host.summary);
  }, [onExit]);

  useEffect(() => {
    const iframe = frameRef.current;
    if (!iframe) return;

    const host = new GameHost(entry, engine, {
      onPhaseChange: (next, why) => {
        setPhase(next);
        setDetail(why ?? null);
      },
      onPreviewChange: setPreviewVisible,
      onExit: () => {
        onExit(host.summary);
      },
    });
    hostRef.current = host;

    // Only the last tracking status matters, and it changes rarely — sending it
    // every frame would be 30 identical messages a second for no benefit.
    let lastTracking = '';
    sinkRef.current = (output) => {
      host.push(output, performance.now());
      const signature = `${output.tracking.personDetected}|${output.tracking.quality.toFixed(2)}|${output.tracking.issues.join(',')}`;
      if (signature !== lastTracking) {
        lastTracking = signature;
        host.pushTracking(output);
      }
    };

    void host.start(iframe, consoleVersion);

    // A backgrounded tab stops painting and stops delivering frames; a game
    // that keeps its timer running through that would charge the player for
    // seconds they were not exercising.
    const onVisibility = () => {
      if (document.hidden) host.pause('hidden');
      else host.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      sinkRef.current = null;
      host.dispose();
      hostRef.current = null;
    };
  }, [entry, engine, consoleVersion, sinkRef, onExit]);

  return (
    <div className="game-stage">
      <iframe
        ref={frameRef}
        className="game-stage__frame"
        // Computed from the entry, never from host state: a src that changed
        // after mount would reload the iframe and drop the handshake.
        src={frameSrc}
        title={entry.title}
        // No camera, no mic, no geolocation. Games get pose data, not sensors.
        allow=""
        // `allow-same-origin` is required, not lax: without it the frame gets
        // an opaque origin, `event.origin` arrives as "null", and the host's
        // registry-origin check can never match.
        sandbox="allow-scripts allow-same-origin"
      />

      {phase !== 'running' && (
        <div className="game-stage__curtain">
          <h2>{entry.title}</h2>
          <p>{curtainMessage(phase, detail)}</p>
          {phase === 'error' && (
            <button type="button" onClick={() => void exit()}>
              Back to library
            </button>
          )}
        </div>
      )}

      <button type="button" className="game-stage__exit" onClick={() => void exit()}>
        Exit
      </button>

      {previewVisible && <div className="game-stage__preview-slot" aria-hidden />}
    </div>
  );
}


function curtainMessage(phase: GameHostPhase, detail: string | null): string {
  switch (phase) {
    case 'loading':
      return 'Loading cartridge…';
    case 'connecting':
      return 'Connecting to the game…';
    case 'ended':
      return 'Session finished.';
    case 'error':
      return detail ?? 'The game could not be started.';
    default:
      return '';
  }
}
