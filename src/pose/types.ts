export interface Landmark {
  x: number;
  y: number;
  z: number;
  /** 0..1 confidence that this landmark is actually visible in frame. */
  visibility: number;
}

/**
 * One inference result.
 *
 * Two coordinate systems arrive together and each is used for a different job:
 *
 *  - `landmarks` are normalised to the image (0..1, y down). Use for anything
 *    screen-shaped: the cursor, the skeleton overlay, framing checks.
 *  - `world` is metric (metres, origin at the hip midpoint, y up is negative)
 *    and roughly perspective-corrected. Use for joint angles and depth, which
 *    is why rep detection is far more stable against it than against image
 *    coordinates.
 */
export interface PoseFrame {
  /** Console clock (`performance.now()`) when this frame was captured. */
  t: number;
  /** True when a person was found. When false the landmark arrays are empty. */
  present: boolean;
  landmarks: Landmark[];
  world: Landmark[];
}

export interface PoseSourceStats {
  /** Frames delivered per second, averaged over the last second. */
  fps: number;
  /** Milliseconds spent inside inference, smoothed. */
  inferenceMs: number;
  /** Frames dropped because inference was still busy. */
  dropped: number;
}

export type PoseFrameHandler = (frame: PoseFrame) => void;

/**
 * Where pose frames come from.
 *
 * The console never talks to MediaPipe directly; it talks to this. That is what
 * lets a recorded fixture drive the entire recognition stack in tests, and what
 * will let a phone camera over WebRTC drive it later without the recognisers
 * noticing.
 */
export interface PoseSource {
  readonly kind: 'camera' | 'fixture';
  /** Live preview element, when the source has one. */
  readonly video: HTMLVideoElement | null;
  readonly stats: PoseSourceStats;

  start(): Promise<void>;
  stop(): void;
  /** Returns an unsubscribe function. */
  onFrame(handler: PoseFrameHandler): () => void;
}

/** A recorded session, replayable through `FixturePoseSource`. */
export interface PoseFixture {
  name: string;
  /** What the recording actually contains, for test assertions. */
  notes?: string;
  /** Ground truth, when this fixture is used to test rep counting. */
  expected?: {
    exercise?: string;
    reps?: number;
  };
  recordedAt: string;
  frames: PoseFrame[];
}
