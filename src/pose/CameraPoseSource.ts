import { FilesetResolver, PoseLandmarker, type PoseLandmarkerResult } from '@mediapipe/tasks-vision';
import type { Landmark, PoseFrame, PoseFrameHandler, PoseSource, PoseSourceStats } from './types.js';

export interface CameraPoseSourceOptions {
  /** Requested capture size. 640x480 is the sweet spot for the lite model. */
  width?: number;
  height?: number;
  frameRate?: number;
  /** Served from `public/`; see `scripts/fetch-assets.mjs`. */
  wasmPath?: string;
  modelPath?: string;
  /** Called when the GPU delegate fails and we fall back to CPU. */
  onDelegateFallback?: (error: unknown) => void;
}

export class CameraError extends Error {
  constructor(
    message: string,
    readonly kind: 'permission_denied' | 'no_camera' | 'in_use' | 'unknown',
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

const EMPTY_STATS: PoseSourceStats = { fps: 0, inferenceMs: 0, dropped: 0 };

/**
 * Resolve a path in `public/` against the deployed base URL.
 *
 * Vite rewrites `import.meta.env.BASE_URL` at build time to whatever `base` is
 * ("/" in dev, "./" here), so this is the only correct way to reach a static
 * asset that must survive being served from a subdirectory.
 */
function asset(path: string): string {
  return new URL(path, new URL(import.meta.env.BASE_URL, window.location.href)).toString();
}


/**
 * Live camera + MediaPipe Pose Landmarker.
 *
 * Runs on the main thread deliberately: games live in cross-origin iframes,
 * which Chrome isolates into their own renderer processes, so this thread has
 * nothing to compete with during gameplay. Moving inference to a worker would
 * add OffscreenCanvas plumbing for no measurable win. If that assumption ever
 * breaks, `PoseSource` is the seam to swap behind.
 */
export class CameraPoseSource implements PoseSource {
  readonly kind = 'camera' as const;

  private readonly options: Required<Omit<CameraPoseSourceOptions, 'onDelegateFallback'>>;
  private readonly onDelegateFallback?: (error: unknown) => void;
  private readonly handlers = new Set<PoseFrameHandler>();

  private landmarker: PoseLandmarker | null = null;
  private stream: MediaStream | null = null;
  private videoEl: HTMLVideoElement | null = null;
  private running = false;
  private rafId: number | null = null;
  private videoCallbackId: number | null = null;

  /** MediaPipe rejects a timestamp that does not strictly increase. */
  private lastTimestamp = -1;
  private busy = false;
  /** Detections excluded from the inference average while the GPU warms up. */
  private warmupFrames = 5;

  private statsInternal: PoseSourceStats = { ...EMPTY_STATS };
  private frameTimes: number[] = [];

  /** Which delegate we ended up on, for the dev overlay. */
  delegate: 'GPU' | 'CPU' | null = null;

  constructor(options: CameraPoseSourceOptions = {}) {
    this.options = {
      width: options.width ?? 640,
      height: options.height ?? 480,
      frameRate: options.frameRate ?? 30,
      // Resolved against the app's base, not the server root. On GitHub Pages
      // the console lives under /primal/, where a leading-slash path would
      // 404 and take the whole pipeline down with it.
      wasmPath: options.wasmPath ?? asset('mediapipe-wasm'),
      modelPath: options.modelPath ?? asset('models/pose_landmarker_lite.task'),
    };
    this.onDelegateFallback = options.onDelegateFallback;
  }

  get video(): HTMLVideoElement | null {
    return this.videoEl;
  }

  get stats(): PoseSourceStats {
    return this.statsInternal;
  }

  onFrame(handler: PoseFrameHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.stream = await this.openCamera();
    this.videoEl = await this.attachVideo(this.stream);
    this.landmarker = await this.createLandmarker();
    this.running = true;
    this.scheduleNextFrame();
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== null) {
      cancelAnimationFrame(this.rafId);
      this.rafId = null;
    }
    if (this.videoCallbackId !== null && this.videoEl) {
      this.videoEl.cancelVideoFrameCallback?.(this.videoCallbackId);
      this.videoCallbackId = null;
    }
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    if (this.videoEl) {
      this.videoEl.srcObject = null;
      this.videoEl.remove();
      this.videoEl = null;
    }
    this.landmarker?.close();
    this.landmarker = null;
    this.statsInternal = { ...EMPTY_STATS };
    this.frameTimes = [];
    this.lastTimestamp = -1;
  }

  /* ---------------------------------------------------------------------- */
  /* Setup                                                                   */
  /* ---------------------------------------------------------------------- */

  private async openCamera(): Promise<MediaStream> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError('This browser cannot access cameras.', 'no_camera');
    }
    try {
      return await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: this.options.width },
          height: { ideal: this.options.height },
          frameRate: { ideal: this.options.frameRate },
          facingMode: 'user',
        },
        audio: false,
      });
    } catch (error) {
      throw new CameraError(describeCameraError(error), classifyCameraError(error), error);
    }
  }

  private async attachVideo(stream: MediaStream): Promise<HTMLVideoElement> {
    const video = document.createElement('video');
    video.srcObject = stream;
    video.playsInline = true;
    video.muted = true;
    // Kept out of the layout; the UI renders its own mirrored preview.
    video.style.position = 'fixed';
    video.style.opacity = '0';
    video.style.pointerEvents = 'none';
    video.style.width = '1px';
    video.style.height = '1px';
    document.body.appendChild(video);

    await video.play();
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
      await new Promise<void>((resolve) => {
        video.addEventListener('loadeddata', () => resolve(), { once: true });
      });
    }
    return video;
  }

  private async createLandmarker(): Promise<PoseLandmarker> {
    const fileset = await FilesetResolver.forVisionTasks(this.options.wasmPath);

    const build = (delegate: 'GPU' | 'CPU') =>
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: this.options.modelPath, delegate },
        runningMode: 'VIDEO',
        numPoses: 1,
        minPoseDetectionConfidence: 0.5,
        minPosePresenceConfidence: 0.5,
        minTrackingConfidence: 0.5,
        outputSegmentationMasks: false,
      });

    try {
      const landmarker = await build('GPU');
      this.delegate = 'GPU';
      return landmarker;
    } catch (error) {
      // Some integrated GPUs and remote-desktop sessions have no usable WebGL.
      // CPU is slower but keeps the console usable rather than dead.
      this.onDelegateFallback?.(error);
      const landmarker = await build('CPU');
      this.delegate = 'CPU';
      return landmarker;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Loop                                                                    */
  /* ---------------------------------------------------------------------- */

  private scheduleNextFrame(): void {
    if (!this.running || !this.videoEl) return;

    // requestVideoFrameCallback fires once per *decoded camera frame*, so we
    // never burn inference on a frame we already processed. rAF is the fallback.
    if (typeof this.videoEl.requestVideoFrameCallback === 'function') {
      this.videoCallbackId = this.videoEl.requestVideoFrameCallback(() => {
        this.processFrame();
        this.scheduleNextFrame();
      });
    } else {
      this.rafId = requestAnimationFrame(() => {
        this.processFrame();
        this.scheduleNextFrame();
      });
    }
  }

  private processFrame(): void {
    const video = this.videoEl;
    const landmarker = this.landmarker;
    if (!this.running || !video || !landmarker) return;
    if (video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) return;

    if (this.busy) {
      this.statsInternal.dropped++;
      return;
    }

    const now = performance.now();
    const timestamp = Math.max(now, this.lastTimestamp + 1);
    this.lastTimestamp = timestamp;

    this.busy = true;
    const startedAt = performance.now();
    let result: PoseLandmarkerResult | null = null;
    try {
      result = landmarker.detectForVideo(video, timestamp);
    } catch (error) {
      // A single bad frame (GPU context loss, resize race) must not kill the loop.
      console.error('[primal] pose inference failed for a frame', error);
    } finally {
      this.busy = false;
    }

    const inferenceMs = performance.now() - startedAt;
    // The first few detections pay for shader compilation and model warm-up —
    // seconds, not milliseconds. Folding those into the average would make the
    // stat useless for spotting a real regression.
    if (this.warmupFrames > 0) {
      this.warmupFrames--;
    } else {
      this.statsInternal.inferenceMs =
        this.statsInternal.inferenceMs === 0
          ? inferenceMs
          : this.statsInternal.inferenceMs * 0.9 + inferenceMs * 0.1;
    }
    this.trackFps(now);

    if (!result) return;
    this.emit(toPoseFrame(result, now));
  }

  private trackFps(now: number): void {
    this.frameTimes.push(now);
    const cutoff = now - 1000;
    while (this.frameTimes.length > 0 && this.frameTimes[0]! < cutoff) {
      this.frameTimes.shift();
    }
    this.statsInternal.fps = this.frameTimes.length;
  }

  private emit(frame: PoseFrame): void {
    for (const handler of this.handlers) {
      try {
        handler(frame);
      } catch (error) {
        console.error('[primal] pose frame handler threw', error);
      }
    }
  }
}

function toPoseFrame(result: PoseLandmarkerResult, t: number): PoseFrame {
  const landmarks = result.landmarks?.[0];
  const world = result.worldLandmarks?.[0];

  if (!landmarks || !world || landmarks.length === 0) {
    return { t, present: false, landmarks: [], world: [] };
  }

  return {
    t,
    present: true,
    landmarks: landmarks.map(normalise),
    world: world.map(normalise),
  };
}

function normalise(point: {
  x: number;
  y: number;
  z: number;
  visibility?: number;
}): Landmark {
  return {
    x: point.x,
    y: point.y,
    z: point.z,
    visibility: point.visibility ?? 1,
  };
}

function classifyCameraError(error: unknown): CameraError['kind'] {
  const name = (error as { name?: string } | null)?.name;
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return 'permission_denied';
    case 'NotFoundError':
    case 'OverconstrainedError':
      return 'no_camera';
    case 'NotReadableError':
    case 'AbortError':
      return 'in_use';
    default:
      return 'unknown';
  }
}

function describeCameraError(error: unknown): string {
  switch (classifyCameraError(error)) {
    case 'permission_denied':
      return 'Camera access was blocked. Allow the camera for this site, then reload.';
    case 'no_camera':
      return 'No camera was found. Connect a webcam and reload.';
    case 'in_use':
      return 'The camera is already in use by another app. Close it and try again.';
    default:
      return 'The camera could not be started.';
  }
}
