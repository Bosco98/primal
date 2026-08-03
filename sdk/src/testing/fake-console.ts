import type {
  BodyPayload,
  ConsoleToGamePayloads,
  ExerciseId,
  GameToConsoleMessage,
  GestureId,
  RepFlag,
  TrackingIssue,
} from '../protocol/v1.js';
import { PrimalHost, type PrimalHostOptions } from '../host/primal-host.js';

/**
 * A stand-in for the real console: speaks the protocol, but produces input from
 * a keyboard and mouse instead of a camera.
 *
 * It is a `PrimalHost` subclass, not a second implementation — the handshake,
 * the message channel, version negotiation and the guards are the same code the
 * real console runs. So a game that works against `FakeConsole` works against
 * the console for the same reasons, and there is only one place for the
 * handshake to be wrong.
 *
 * Two uses:
 *
 *  1. Standalone game development. Run your game on its own dev server, attach
 *     a FakeConsole, and press S to fire a squat rep. Nobody wants to do 200
 *     real squats to debug a damage formula.
 *
 *       if (!isConsoleEmbedded()) FakeConsole.attach().bindKeyboard();
 *       const primal = await PrimalClient.connect({ gameId: 'my-game' });
 *
 *     Note there is no branch around `connect()` — the fake answers the same
 *     handshake the console does, so the game takes one path either way.
 *
 *  2. Unit and E2E tests. Drive deterministic input, then assert on what the
 *     game sent back (`subscription`, `summary`, `received`).
 *
 *       const fake = FakeConsole.attach();
 *       const primal = await PrimalClient.connect({ gameId: 'test' });
 *       fake.rep('squat', { formScore: 0.9 });
 *       expect(fake.summary?.reps.squat).toBe(1);
 */
export interface FakeConsoleOptions extends PrimalHostOptions {
  /** Called for every message the game sends. */
  onMessage?: (message: GameToConsoleMessage) => void;
}

export interface FakeRepOptions {
  formScore?: number;
  flags?: RepFlag[];
  durationMs?: number;
}

const DEFAULT_BODY: BodyPayload = {
  hands: {
    left: { x: 0.35, y: 0.5, visible: true },
    right: { x: 0.65, y: 0.5, visible: true },
  },
  bodyCenter: { x: 0.5, y: 0.55 },
  head: { x: 0.5, y: 0.25 },
  lean: 0,
  crouch: 0,
};

export class FakeConsole extends PrimalHost {
  private readonly messageListener: ((message: GameToConsoleMessage) => void) | undefined;
  private repCounters = new Map<ExerciseId, number>();
  private nextRepId = 1;
  private body: BodyPayload = structuredClone(DEFAULT_BODY);

  private constructor(options: FakeConsoleOptions) {
    super({
      ...options,
      sessionId: options.sessionId ?? 'fake-session',
      consoleVersion: options.consoleVersion ?? '0.0.0-fake',
    });
    this.messageListener = options.onMessage;
  }

  static override attach(options: FakeConsoleOptions = {}): FakeConsole {
    return new FakeConsole(options);
  }

  protected override onGameMessage(message: GameToConsoleMessage): void {
    this.messageListener?.(message);
  }

  /* ---------------------------------------------------------------------- */
  /* Emitting input                                                          */
  /* ---------------------------------------------------------------------- */

  /** Fire a completed rep. Rep ids and per-exercise counts advance for you. */
  rep(exercise: ExerciseId, options: FakeRepOptions = {}): void {
    const count = (this.repCounters.get(exercise) ?? 0) + 1;
    this.repCounters.set(exercise, count);
    this.emit('input/rep', {
      exercise,
      repId: this.nextRepId++,
      count,
      formScore: options.formScore ?? 0.85,
      flags: options.flags ?? [],
      durationMs: options.durationMs ?? 1800,
    });
  }

  /** Fire a full down/up rep progress sweep, then the rep itself. */
  async repWithProgress(
    exercise: ExerciseId,
    options: FakeRepOptions & { stepMs?: number } = {},
  ): Promise<void> {
    const step = options.stepMs ?? 40;
    const sweep: Array<[ConsoleToGamePayloads['input/rep_progress']['phase'], number]> = [
      ['down', 0.33],
      ['down', 0.66],
      ['bottom', 1],
      ['up', 0.5],
      ['up', 1],
    ];
    for (const [phase, progress] of sweep) {
      this.emit('input/rep_progress', { exercise, phase, progress, depth: progress });
      await new Promise((r) => setTimeout(r, step));
    }
    this.rep(exercise, options);
    this.emit('input/rep_progress', { exercise, phase: 'rest', progress: 0, depth: 0 });
  }

  gesture(gesture: GestureId, state: 'start' | 'end', confidence = 0.9): void {
    this.emit('input/gesture', { gesture, state, confidence });
  }

  /** Fire a momentary gesture: `start` now, `end` after `holdMs`. */
  tapGesture(gesture: GestureId, holdMs = 120): void {
    this.gesture(gesture, 'start');
    setTimeout(() => this.gesture(gesture, 'end'), holdMs);
  }

  /** Patch and emit the current body state. */
  setBody(patch: Partial<BodyPayload>): void {
    this.body = { ...this.body, ...patch };
    this.emit('input/body', this.body);
  }

  intensity(instant: number, avg10s = instant): void {
    this.emit('input/intensity', { instant, avg10s });
  }

  tracking(personDetected: boolean, quality = 1, issues: TrackingIssue[] = []): void {
    this.emit('tracking/status', { personDetected, quality, issues });
  }

  /* ---------------------------------------------------------------------- */
  /* Keyboard + mouse driving, for standalone development                    */
  /* ---------------------------------------------------------------------- */

  /**
   * Map a keyboard and mouse onto the input vocabulary so a game is playable
   * without a camera:
   *
   *   S / J / L / P   squat, jumping jack, lunge, push-up rep
   *   A / D           hold to lean left / right
   *   W or Space      jump
   *   C               hold to crouch
   *   Q / E           punch left / right
   *   B               hold to block
   *   mouse           moves the right hand (and the left hand, mirrored)
   *
   * Returns a function that unbinds. Also starts a `input/body` loop at
   * `bodyRateHz` so continuous games behave as they would live.
   */
  bindKeyboard(options: { target?: EventTarget; bodyRateHz?: number } = {}): () => void {
    const target = options.target ?? this.win;
    const rate = options.bodyRateHz ?? 30;

    const repKeys: Record<string, ExerciseId> = {
      KeyS: 'squat',
      KeyJ: 'jumping_jack',
      KeyL: 'lunge',
      KeyP: 'pushup',
    };
    const holdKeys: Record<string, GestureId> = {
      KeyA: 'lean_left',
      KeyD: 'lean_right',
      KeyC: 'crouch',
      KeyB: 'block',
    };
    const tapKeys: Record<string, GestureId> = {
      KeyQ: 'punch_left',
      KeyE: 'punch_right',
      Space: 'jump',
      KeyW: 'jump',
    };

    const held = new Set<string>();

    const onKeyDown = (event: Event) => {
      const e = event as KeyboardEvent;
      if (e.repeat) return;
      const code = e.code;

      if (repKeys[code]) {
        void this.repWithProgress(repKeys[code]!);
        e.preventDefault();
        return;
      }
      if (holdKeys[code] && !held.has(code)) {
        held.add(code);
        this.gesture(holdKeys[code]!, 'start');
        this.updateBodyFromKeys(held);
        e.preventDefault();
        return;
      }
      if (tapKeys[code]) {
        this.tapGesture(tapKeys[code]!);
        e.preventDefault();
      }
    };

    const onKeyUp = (event: Event) => {
      const code = (event as KeyboardEvent).code;
      if (held.has(code)) {
        held.delete(code);
        this.gesture(holdKeys[code]!, 'end');
        this.updateBodyFromKeys(held);
      }
    };

    const onMouseMove = (event: Event) => {
      const e = event as MouseEvent;
      const x = e.clientX / this.win.innerWidth;
      const y = e.clientY / this.win.innerHeight;
      this.body.hands.right = { x, y, visible: true };
      this.body.hands.left = { x: 1 - x, y, visible: true };
    };

    target.addEventListener('keydown', onKeyDown);
    target.addEventListener('keyup', onKeyUp);
    target.addEventListener('mousemove', onMouseMove);

    const timer = setInterval(() => this.emit('input/body', this.body), 1000 / rate);
    const intensityTimer = setInterval(() => {
      // Rough stand-in: any held key or recent rep reads as effort.
      const active = held.size > 0 ? 0.7 : 0.25;
      this.intensity(active);
    }, 200);

    const unbind = () => {
      target.removeEventListener('keydown', onKeyDown);
      target.removeEventListener('keyup', onKeyUp);
      target.removeEventListener('mousemove', onMouseMove);
      clearInterval(timer);
      clearInterval(intensityTimer);
    };
    this.detachFns.push(unbind);
    return unbind;
  }

  private updateBodyFromKeys(held: Set<string>): void {
    let lean = 0;
    if (held.has('KeyA')) lean -= 1;
    if (held.has('KeyD')) lean += 1;
    this.body.lean = lean;
    this.body.crouch = held.has('KeyC') ? 1 : 0;
    this.body.bodyCenter = { x: 0.5 + lean * 0.25, y: 0.55 + this.body.crouch * 0.15 };
  }

  /** Kept so existing call sites keep working; `close()` is the real name. */
  detach(): void {
    this.close();
  }
}
