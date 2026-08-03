import { MAX_CATCHUP_STEPS, SIM_STEP_MS } from './config.js';
import { HandCursors } from './hands.js';
import { LaneModel } from './lanes.js';
import { InputQueue } from './queue.js';
import { Scene } from './scene.js';
import { World } from './world.js';
import type { ControlFrame } from '../control/engine.js';
import type { KeyboardDriver } from '../control/keyboard.js';
import type { RunSummary, Tracking } from '../types.js';

export interface RunCallbacks {
  onEnd(summary: RunSummary): void;
  onCoach(message: string | null): void;
}

/**
 * One run, from first frame to summary.
 *
 * The whole loop lives here rather than in a React component on purpose. React
 * renders when state changes; a game renders every frame and steps its
 * simulation on a fixed clock that has nothing to do with either. Mixing the
 * two is how you end up with an effect tearing down mid-frame — which is
 * exactly the bug that used to hang the launcher. React owns the screens; this
 * owns everything inside a run.
 */
export class Run {
  private readonly queue = new InputQueue();
  private readonly lanes = new LaneModel();
  private readonly hands = new HandCursors();
  private readonly scene: Scene;
  private readonly world: World;

  private raf = 0;
  private accumulator = 0;
  private last = 0;
  private paused = false;
  private stopped = false;
  private coaching: string | null = null;
  private resumeAt = 0;
  private unplayableSince = 0;

  /**
   * How long tracking must be continuously lost before the run freezes.
   * Landmark confidence flickers across its threshold for a few frames at a
   * time — worst during fast moves, when motion blur is highest — and a pause
   * that trips on a single frame turns that flicker into a game that freezes
   * mid-jump every few seconds. Genuinely walking off camera still pauses well
   * before an obstacle can arrive unseen: the telegraph floor is 1.1s.
   */
  private static readonly TRACKING_LOSS_MS = 700;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly callbacks: RunCallbacks,
  ) {
    this.scene = new Scene(canvas);
    this.world = new World(this.queue, this.lanes, this.hands, (coin) =>
      this.scene.coinNormalised(coin),
    );
  }

  start(): void {
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    this.paused = paused;
    // Drop queued input rather than buffering it: buffering means a burst of
    // stale jumps the instant the game resumes.
    this.queue.clear();
    if (!paused) this.last = performance.now();
  }

  /** Called once per pose frame, from outside the render loop. */
  feed(frame: ControlFrame): void {
    for (const action of frame.actions) this.queue.push(action, frame.t);
    this.lanes.set(frame.zones.band);
    this.hands.update(frame.body, frame.t);
    this.world.setIntensity(frame.intensity.avg10s);
    this.applyTracking(frame.tracking);
  }

  /** Desk mode: the same inputs, from a keyboard. */
  feedKeyboard(driver: KeyboardDriver, now: number): void {
    for (const action of driver.drain()) this.queue.push(action, now);
    this.lanes.set(driver.band);
    // The pointer already spans the screen, so undo the reach gain that exists
    // to spare a real player from stretching to the edge of the camera frame.
    // Without this the cursors sit pinned to the bezels and never reach a coin.
    const x = 0.5 + (driver.pointer.x - 0.5) / 2.2;
    const y = 0.25 + 0.15 + (driver.pointer.y - 0.5) / 2.0;
    this.hands.update(
      {
        hands: {
          left: { x: 1 - x, y, visible: true },
          right: { x, y, visible: true },
        },
        center: { x: 0.5, y: 0.55 },
        head: { x: 0.5, y: 0.25 },
        lean: driver.band,
        crouch: 0,
      },
      now,
    );
    this.world.setIntensity(driver.intensity());
  }

  /**
   * Degrade, don't die. Losing sight of the player freezes the run and coaches
   * the specific fix; it never costs them the run they were having.
   */
  private applyTracking(tracking: Tracking): void {
    const now = performance.now();
    if (tracking.playable) {
      this.unplayableSince = 0;
    } else if (this.unplayableSince === 0) {
      this.unplayableSince = now;
    }
    const blocked =
      this.unplayableSince !== 0 && now - this.unplayableSince >= Run.TRACKING_LOSS_MS;
    if (blocked && !this.coaching) {
      this.coaching = 'blocked';
      this.setPaused(true);
      this.callbacks.onCoach('blocked');
    } else if (!blocked && this.coaching) {
      this.coaching = null;
      // Never resume on the same frame tracking recovers — the player is still
      // getting reoriented, and an obstacle arriving now is not their fault.
      this.resumeAt = performance.now() + 900;
      this.callbacks.onCoach(null);
    }
    if (this.resumeAt && performance.now() >= this.resumeAt) {
      this.resumeAt = 0;
      this.setPaused(false);
    }
  }

  private readonly frame = (now: number): void => {
    if (this.stopped) return;
    this.raf = requestAnimationFrame(this.frame);

    const deltaMs = Math.min(250, now - this.last);
    this.last = now;

    if (!this.paused && !this.world.over) {
      this.accumulator += deltaMs;
      let steps = 0;
      while (this.accumulator >= SIM_STEP_MS && steps < MAX_CATCHUP_STEPS) {
        const dt = SIM_STEP_MS / 1000;
        this.world.step(dt, now);
        this.world.tickBurn(dt);
        this.lanes.step(dt);
        this.accumulator -= SIM_STEP_MS;
        steps += 1;
      }
      // Whatever is left is unrecoverable; dropping it beats spiralling.
      if (steps === MAX_CATCHUP_STEPS) this.accumulator = 0;
    }

    this.scene.draw(this.world, this.lanes, this.hands);

    if (this.world.over && !this.stopped) {
      this.stop();
      this.callbacks.onEnd(this.world.summary);
    }
  };

  resize(): void {
    this.scene.resize();
  }
}
