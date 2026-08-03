import {
  PrimalHost,
  withConsoleParam,
  type SubscribePayload,
  type WorkoutSummaryPayload,
} from '@bosco98/primal-sdk';
import type { RecognitionEngine, RecognitionOutput } from '../recognition/engine.js';
import type { GameEntry } from './registry.js';

/**
 * Runs one game inside one iframe.
 *
 * The handshake itself is `PrimalHost`, which lives in the SDK next to the
 * client half — this class is only the console-specific part: point an iframe
 * at a registry entry, honour whatever the game subscribes to, and pump the
 * recognition engine's output down the wire.
 *
 * Nothing is sent before the game subscribes. That is not just hygiene: the
 * engine skips recognisers nobody listens to, which is real frame budget back
 * on the one thread MediaPipe is already saturating.
 */

export type GameHostPhase =
  | 'loading'
  | 'connecting'
  | 'running'
  | 'ended'
  | 'error';

export interface GameHostCallbacks {
  onPhaseChange?(phase: GameHostPhase, detail?: string): void;
  /** The game reported a finished workout. */
  onSummary?(summary: WorkoutSummaryPayload): void;
  /** The game asked to be torn down (its own exit, or `session/end`). */
  onExit?(): void;
  /** The game asked to show or hide the camera preview. */
  onPreviewChange?(visible: boolean): void;
}

const CONNECT_TIMEOUT_MS = 15_000;

export class GameHost {
  private host: PrimalHost | null = null;
  private subscription: SubscribePayload | null = null;
  private bodyIntervalMs = 1000 / 30;
  private lastBodyAt = 0;
  private disposed = false;
  private phase: GameHostPhase = 'loading';

  constructor(
    private readonly entry: GameEntry,
    private readonly engine: RecognitionEngine,
    private readonly callbacks: GameHostCallbacks = {},
  ) {}

  /** The URL to point the iframe at — the registry URL plus the console marker. */
  get frameSrc(): string {
    return withConsoleParam(new URL(this.entry.url.toString())).toString();
  }

  get currentPhase(): GameHostPhase {
    return this.phase;
  }

  /**
   * Begin the handshake. Call once the iframe exists; it does not need to have
   * finished loading, because the game retries its hello until we answer.
   */
  async start(iframe: HTMLIFrameElement, consoleVersion: string): Promise<void> {
    if (this.disposed) return;
    this.setPhase('connecting');

    const host = PrimalHost.attach({
      target: iframe.contentWindow,
      origin: this.entry.origin,
      gameId: this.entry.id,
      consoleVersion,
    });
    this.host = host;

    host.on('config/subscribe', (payload) => {
      this.subscription = payload;
      // The console clamps, exactly as the protocol says it may.
      const hz = Math.min(60, Math.max(1, payload.bodyRateHz ?? 30));
      this.bodyIntervalMs = 1000 / hz;
      this.engine.setSubscription(payload);
    });

    host.on('workout/summary', (summary) => this.callbacks.onSummary?.(summary));
    host.on('ui/setPreview', (p) => this.callbacks.onPreviewChange?.(p.visible));
    host.on('game/exit', () => {
      this.setPhase('ended');
      this.callbacks.onExit?.();
    });

    try {
      await host.waitForReady(CONNECT_TIMEOUT_MS);
    } catch (cause) {
      if (this.disposed) return;
      this.setPhase(
        'error',
        cause instanceof Error ? cause.message : 'The game never answered the handshake.',
      );
      return;
    }

    if (this.disposed) return;
    this.setPhase('running');
    host.sessionStart();
  }

  /**
   * Forward one frame of recognition output. Called from the engine's frame
   * callback, so it runs at inference rate (~30Hz) and must stay allocation-light.
   */
  push(output: RecognitionOutput, now: number): void {
    const host = this.host;
    if (!host || !host.isReady || this.disposed) return;
    const channels = this.subscription?.channels;
    if (!channels || channels.length === 0) return;

    if (channels.includes('gesture')) {
      for (const gesture of output.gestures) host.emit('input/gesture', gesture);
    }

    if (channels.includes('rep')) {
      for (const rep of output.reps) host.emit('input/rep', rep);
      for (const progress of output.progress) host.emit('input/rep_progress', progress);
    }

    if (channels.includes('intensity')) {
      host.emit('input/intensity', output.intensity);
    }

    // Body is the only high-rate channel, and the only one the game gets to
    // throttle. Everything else is edge-triggered and must not be dropped.
    if (channels.includes('body') && output.body && now - this.lastBodyAt >= this.bodyIntervalMs) {
      this.lastBodyAt = now;
      host.emit('input/body', output.body);
    }
  }

  /** Tracking status changes rarely; the caller sends it only on a real change. */
  pushTracking(output: RecognitionOutput): void {
    if (!this.host?.isReady || this.disposed) return;
    this.host.emit('tracking/status', output.tracking);
  }

  pause(reason: 'user' | 'hidden' | 'tracking_lost' | 'calibrating' = 'user'): void {
    this.host?.pause(reason);
  }

  resume(): void {
    this.host?.resume();
  }

  /**
   * Ask the game to wrap up. The protocol says a game must send its summary
   * immediately on `session/end`, so give it a moment to do so before the
   * iframe goes away — a workout that is thrown away because the console tore
   * down half a frame early is a workout the player did for nothing.
   */
  async end(reason: 'user' | 'game' | 'error' = 'user', graceMs = 400): Promise<void> {
    const host = this.host;
    if (!host?.isReady) return;
    if (host.summary) return; // Already reported; nothing to wait for.

    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, graceMs);
      const off = host.on('workout/summary', () => {
        clearTimeout(timer);
        off();
        resolve();
      });
      host.end(reason);
    });
  }

  /** The last summary the game reported, if any. */
  get summary(): WorkoutSummaryPayload | null {
    return this.host?.summary ?? null;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.host?.close();
    this.host = null;
  }

  private setPhase(phase: GameHostPhase, detail?: string): void {
    this.phase = phase;
    this.callbacks.onPhaseChange?.(phase, detail);
  }
}
