import type {
  PoseFixture,
  PoseFrame,
  PoseFrameHandler,
  PoseSource,
  PoseSourceStats,
} from './types.js';

export interface FixturePoseSourceOptions {
  /** Replay at the recorded wall-clock pace. Off means as fast as possible. */
  realtime?: boolean;
  /** Playback multiplier when `realtime` is on. */
  speed?: number;
  loop?: boolean;
}

/**
 * Replays a recorded session in place of the camera.
 *
 * This is what makes rep detection testable. A recorded squat set is a fixed
 * input, so a threshold change either still counts ten reps or it does not —
 * no webcam, no human, no doing forty squats to check a regression.
 *
 * It also powers the Playwright suite: the console accepts
 * `?poseSource=fixture:<name>` and drives the whole launcher-to-summary flow
 * with nobody in front of the machine.
 */
export class FixturePoseSource implements PoseSource {
  readonly kind = 'fixture' as const;
  readonly video = null;

  private readonly fixture: PoseFixture;
  private readonly options: Required<FixturePoseSourceOptions>;
  private readonly handlers = new Set<PoseFrameHandler>();

  private index = 0;
  private running = false;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private startedAt = 0;
  private statsInternal: PoseSourceStats = { fps: 0, inferenceMs: 0, dropped: 0 };

  constructor(fixture: PoseFixture, options: FixturePoseSourceOptions = {}) {
    this.fixture = fixture;
    this.options = {
      realtime: options.realtime ?? true,
      speed: options.speed ?? 1,
      loop: options.loop ?? false,
    };
  }

  get stats(): PoseSourceStats {
    return this.statsInternal;
  }

  get frameCount(): number {
    return this.fixture.frames.length;
  }

  get name(): string {
    return this.fixture.name;
  }

  onFrame(handler: PoseFrameHandler): () => void {
    this.handlers.add(handler);
    return () => this.handlers.delete(handler);
  }

  async start(): Promise<void> {
    if (this.running) return;
    if (this.fixture.frames.length === 0) return;
    this.running = true;
    this.index = 0;
    this.startedAt = performance.now();

    if (this.options.realtime) {
      this.scheduleNext();
    } else {
      this.runToCompletion();
    }
  }

  stop(): void {
    this.running = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /**
   * Push every remaining frame synchronously. Deterministic and instant, which
   * is what unit tests want.
   */
  runToCompletion(): void {
    const frames = this.fixture.frames;
    while (this.index < frames.length) {
      this.emit(frames[this.index]!);
      this.index++;
    }
    this.running = false;
  }

  /** Push exactly one frame. Useful for stepping through a fixture in a test. */
  step(): PoseFrame | null {
    const frame = this.fixture.frames[this.index];
    if (!frame) return null;
    this.index++;
    this.emit(frame);
    return frame;
  }

  private scheduleNext(): void {
    if (!this.running) return;
    const frames = this.fixture.frames;
    const frame = frames[this.index];

    if (!frame) {
      if (this.options.loop) {
        this.index = 0;
        this.startedAt = performance.now();
        this.scheduleNext();
      } else {
        this.running = false;
      }
      return;
    }

    // Frame timestamps are relative to the first recorded frame.
    const offset = (frame.t - frames[0]!.t) / this.options.speed;
    const dueIn = Math.max(0, this.startedAt + offset - performance.now());

    this.timer = setTimeout(() => {
      if (!this.running) return;
      this.index++;
      this.emit(frame);
      this.scheduleNext();
    }, dueIn);
  }

  private emit(frame: PoseFrame): void {
    // Re-stamp into the current clock so downstream timing behaves as if live.
    const emitted: PoseFrame = this.options.realtime
      ? { ...frame, t: performance.now() }
      : frame;

    for (const handler of this.handlers) {
      try {
        handler(emitted);
      } catch (error) {
        console.error('[primal] pose frame handler threw', error);
      }
    }
  }
}
