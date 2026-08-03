import { useCallback, useEffect, useRef, useState } from 'react';
import { CameraError, CameraPoseSource } from './pose/CameraPoseSource.js';
import { ControlEngine, type ControlFrame } from './control/engine.js';
import type { Tracking } from './types.js';

export type PoseStatus = 'idle' | 'starting' | 'running' | 'error';

const IDLE_TRACKING: Tracking = {
  present: false,
  quality: 0,
  issues: ['no_person'],
  playable: false,
};

/**
 * Owns the camera and turns its frames into control frames.
 *
 * Everything hot lives in refs. React re-renders on state changes; pose frames
 * arrive at 30Hz and the game draws at 60. Pushing either through React state
 * would cost more than the game does, so only the coarse things a *screen*
 * needs — status, whether the player is framed — are state. The per-frame
 * stream goes to whoever installs `sinkRef`.
 */
export function usePose() {
  const [status, setStatus] = useState<PoseStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [tracking, setTracking] = useState<Tracking>(IDLE_TRACKING);
  const [video, setVideo] = useState<HTMLVideoElement | null>(null);

  const sourceRef = useRef<CameraPoseSource | null>(null);
  const engineRef = useRef(new ControlEngine());
  const startedRef = useRef(false);
  const frameRef = useRef<ControlFrame | null>(null);
  const sinkRef = useRef<((frame: ControlFrame) => void) | null>(null);

  const start = useCallback(async () => {
    // React StrictMode mounts effects twice in development; without this guard
    // the second pass opens a second camera stream and the first leaks.
    if (startedRef.current) return;
    startedRef.current = true;
    setStatus('starting');
    setError(null);

    const source = new CameraPoseSource({
      onDelegateFallback: (cause) =>
        console.warn('[primal] GPU delegate unavailable, falling back to CPU', cause),
    });
    sourceRef.current = source;

    let lastPublish = 0;
    source.onFrame((poseFrame) => {
      const frame = engineRef.current.process(poseFrame);
      frameRef.current = frame;
      sinkRef.current?.(frame);

      // Screens only need to know roughly whether the player is framed. 6Hz is
      // plenty and keeps React out of the pose loop.
      if (poseFrame.t - lastPublish > 160) {
        lastPublish = poseFrame.t;
        setTracking(frame.tracking);
      }
    });

    try {
      await source.start();
      setVideo(source.video);
      setStatus('running');
    } catch (cause) {
      startedRef.current = false;
      sourceRef.current = null;
      setError(
        cause instanceof CameraError
          ? cause.message
          : 'Could not start the camera. Check the browser console for details.',
      );
      setStatus('error');
    }
  }, []);

  /**
   * Release the camera and go back to idle.
   *
   * Backing out of the framing screen has to actually turn the camera off, not
   * just navigate away from it. A webcam light that stays on after the player
   * has left the screen that asked for it is the kind of thing that makes
   * someone distrust the whole "nothing leaves this machine" claim, however
   * true it is.
   */
  const stop = useCallback(() => {
    sourceRef.current?.stop();
    sourceRef.current = null;
    startedRef.current = false;
    frameRef.current = null;
    setVideo(null);
    setTracking(IDLE_TRACKING);
    setError(null);
    setStatus('idle');
  }, []);

  useEffect(() => () => sourceRef.current?.stop(), []);

  return { status, error, tracking, video, start, stop, sinkRef, frameRef };
}
