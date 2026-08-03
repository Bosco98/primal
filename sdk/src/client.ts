import {
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type ConsoleToGameMessage,
  type ConsoleToGamePayloads,
  type ConsoleToGameType,
  type Envelope,
  type GameToConsolePayloads,
  type GameToConsoleType,
  type HelloMessage,
  type RejectMessage,
  type SubscribePayload,
  type WelcomeMessage,
  type WorkoutProgressPayload,
  type WorkoutSummaryPayload,
} from './protocol/v1.js';
import { isConsoleToGameMessage, isRejectMessage, isWelcomeMessage } from './protocol/guards.js';
import { SDK_VERSION } from './version.js';

export interface ConnectOptions {
  /** Stable id for this game. Must match the `id` in your primal.manifest.json. */
  gameId: string;
  /**
   * Restrict which origin the console may be served from. Defaults to `'*'`,
   * which is fine for local development; set it in production.
   */
  consoleOrigin?: string;
  /** Give up after this long. Default 10000ms. */
  timeoutMs?: number;
  /** How often to re-send the hello while waiting. Default 250ms. */
  helloIntervalMs?: number;
  /**
   * Window to hand the handshake to. Defaults to `window.parent`, which is the
   * console when embedded and the game itself when running standalone (where a
   * `FakeConsole` can answer).
   */
  target?: Window;
}

export type Unsubscribe = () => void;

export type Handler<K extends ConsoleToGameType> = (
  payload: ConsoleToGamePayloads[K],
  message: Envelope<K, ConsoleToGamePayloads[K]>,
) => void;

export class PrimalConnectionError extends Error {
  constructor(
    message: string,
    readonly reason: RejectMessage['reason'] | 'timeout',
  ) {
    super(message);
    this.name = 'PrimalConnectionError';
  }
}

/**
 * The game side of the PRIMAL protocol.
 *
 *   const primal = await PrimalClient.connect({ gameId: 'rep-battle' });
 *   primal.subscribe({ channels: ['rep'], exercises: ['squat'] });
 *   primal.on('input/rep', (rep) => damage(rep.count, rep.formScore));
 *
 * Unknown message types are ignored, so a newer console never breaks an older
 * game.
 */
export class PrimalClient {
  readonly sessionId: string;
  readonly protocolVersion: number;
  readonly consoleVersion: string;

  /** Add to `performance.now()` to reach the console's clock domain. */
  private readonly clockOffsetMs: number;
  private readonly port: MessagePort;
  private readonly handlers = new Map<string, Set<Handler<ConsoleToGameType>>>();
  private outSeq = 0;
  private lastInSeq = -1;
  private latencyEmaMs = 0;
  private latencySamples = 0;
  private closed = false;

  private constructor(port: MessagePort, welcome: WelcomeMessage) {
    this.port = port;
    this.sessionId = welcome.sessionId;
    this.protocolVersion = welcome.protocolVersion;
    this.consoleVersion = welcome.consoleVersion;
    this.clockOffsetMs = welcome.consoleClockOffsetMs;

    this.port.onmessage = (event: MessageEvent) => this.receive(event.data);
    this.port.start?.();
  }

  /** Perform the handshake. Resolves once the console has answered. */
  static connect(options: ConnectOptions): Promise<PrimalClient> {
    const {
      gameId,
      consoleOrigin = '*',
      timeoutMs = 10_000,
      helloIntervalMs = 250,
      target = window.parent,
    } = options;

    return new Promise<PrimalClient>((resolve, reject) => {
      let settled = false;
      const hello: HelloMessage = {
        t: 'primal/hello',
        protocolVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
        sdkVersion: SDK_VERSION,
        gameId,
        // Lets the console align its clock to ours, so envelope `ts` values are
        // comparable and `latencyMs` measures something real.
        timeOrigin: typeof performance !== 'undefined' ? performance.timeOrigin : undefined,
      };

      const cleanup = () => {
        window.removeEventListener('message', onMessage);
        clearInterval(interval);
        clearTimeout(timer);
      };

      const onMessage = (event: MessageEvent) => {
        if (settled) return;
        if (consoleOrigin !== '*' && event.origin !== consoleOrigin) return;

        const data: unknown = event.data;

        if (isRejectMessage(data)) {
          settled = true;
          cleanup();
          reject(
            new PrimalConnectionError(
              `Console rejected the connection: ${data.message}`,
              data.reason,
            ),
          );
          return;
        }

        if (!isWelcomeMessage(data)) return;

        const port = event.ports[0];
        if (!port) return; // Malformed welcome; keep waiting rather than hanging on a dead client.

        settled = true;
        cleanup();
        const client = new PrimalClient(port, data);
        client.send('game/ready', {});
        resolve(client);
      };

      window.addEventListener('message', onMessage);

      const postHello = () => target.postMessage(hello, consoleOrigin);
      postHello();
      const interval = setInterval(postHello, helloIntervalMs);

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        cleanup();
        reject(
          new PrimalConnectionError(
            `No PRIMAL console answered within ${timeoutMs}ms. Are you running this game outside the console? ` +
              `Use FakeConsole from @bosco98/primal-sdk/testing for standalone development.`,
            'timeout',
          ),
        );
      }, timeoutMs);
    });
  }

  /* ---------------------------------------------------------------------- */
  /* Receiving                                                               */
  /* ---------------------------------------------------------------------- */

  on<K extends ConsoleToGameType>(type: K, handler: Handler<K>): Unsubscribe {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as Handler<ConsoleToGameType>);
    return () => {
      set!.delete(handler as Handler<ConsoleToGameType>);
    };
  }

  once<K extends ConsoleToGameType>(type: K, handler: Handler<K>): Unsubscribe {
    const off = this.on(type, ((payload, message) => {
      off();
      handler(payload, message as never);
    }) as Handler<K>);
    return off;
  }

  private receive(data: unknown): void {
    if (this.closed) return;
    if (!isConsoleToGameMessage(data)) return; // Ignore anything we don't understand.

    const message = data as ConsoleToGameMessage;

    // Envelope timestamps are in console-clock; this is true end-to-end latency.
    const observed = performance.now() + this.clockOffsetMs - message.ts;
    if (Number.isFinite(observed) && observed >= 0) {
      this.latencyEmaMs =
        this.latencySamples === 0 ? observed : this.latencyEmaMs * 0.9 + observed * 0.1;
      this.latencySamples++;
    }
    this.lastInSeq = message.seq;

    const set = this.handlers.get(message.t);
    if (!set) return;
    for (const handler of set) {
      try {
        handler(message.p as never, message as never);
      } catch (error) {
        // One game bug must not take down the whole input stream.
        console.error(`[primal] handler for "${message.t}" threw`, error);
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Sending                                                                 */
  /* ---------------------------------------------------------------------- */

  private send<K extends GameToConsoleType>(type: K, payload: GameToConsolePayloads[K]): void {
    if (this.closed) return;
    const envelope: Envelope<K, GameToConsolePayloads[K]> = {
      v: PROTOCOL_VERSION,
      t: type,
      ts: performance.now() + this.clockOffsetMs,
      seq: this.outSeq++,
      p: payload,
    };
    this.port.postMessage(envelope);
  }

  /**
   * Declare which input channels this game wants. Nothing is delivered until
   * you call this. Subscribe narrowly: the console skips recognisers nobody
   * listens to, which is frame budget back in your pocket.
   */
  subscribe(payload: SubscribePayload): void {
    this.send('config/subscribe', payload);
  }

  /** Incremental workout progress for the console's HUD. Cheap; call freely. */
  reportProgress(payload: WorkoutProgressPayload): void {
    this.send('workout/progress', payload);
  }

  /** Call once when a play session ends. Drives the console summary screen. */
  reportSummary(payload: WorkoutSummaryPayload): void {
    this.send('workout/summary', payload);
  }

  /** Show or hide the console's picture-in-picture camera preview. */
  setPreview(visible: boolean): void {
    this.send('ui/setPreview', { visible });
  }

  /** Ask the console to tear this game down and return to the launcher. */
  exit(): void {
    this.send('game/exit', {});
  }

  /* ---------------------------------------------------------------------- */
  /* Introspection                                                           */
  /* ---------------------------------------------------------------------- */

  /**
   * Smoothed end-to-end input latency in ms: the age of arriving events
   * measured from when the console observed the movement. Worth showing in a
   * debug overlay; a real-time game should treat >120ms as a problem.
   */
  get latencyMs(): number {
    return this.latencySamples === 0 ? 0 : this.latencyEmaMs;
  }

  /** Convert a local `performance.now()` reading into the console clock. */
  toConsoleClock(localTime: number): number {
    return localTime + this.clockOffsetMs;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /** Detach from the console. The game keeps running; input stops. */
  disconnect(): void {
    if (this.closed) return;
    this.closed = true;
    this.handlers.clear();
    this.port.onmessage = null;
    this.port.close();
  }
}
