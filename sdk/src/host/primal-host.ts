import {
  PROTOCOL_VERSION,
  SUPPORTED_PROTOCOL_VERSIONS,
  type ConsoleToGamePayloads,
  type ConsoleToGameType,
  type Envelope,
  type GameToConsoleMessage,
  type GameToConsolePayloads,
  type GameToConsoleType,
  type HelloMessage,
  type RejectMessage,
  type SubscribePayload,
  type WelcomeMessage,
  type WorkoutSummaryPayload,
} from '../protocol/v1.js';
import { isGameToConsoleMessage, isHelloMessage, negotiateVersion } from '../protocol/guards.js';

/**
 * The console side of the PRIMAL protocol.
 *
 * This lives in the SDK, next to `PrimalClient`, on purpose. A game bundles
 * its own copy of the SDK and may be served from a different origin entirely,
 * so the handshake below *is* the compatibility contract between that copy and
 * whatever console it lands in. Two independent implementations of it — one
 * here, one hand-rolled inside the console app — would drift, and the failure
 * would show up as a game that silently never connects.
 *
 * The console uses it to drive a real game iframe:
 *
 *   const host = PrimalHost.attach({
 *     target: iframe.contentWindow,
 *     origin: entry.origin,
 *     consoleVersion: VERSION,
 *   });
 *   await host.ready;
 *   host.emit('input/gesture', { gesture: 'jump', state: 'start', confidence: 0.9 });
 *
 * `FakeConsole` extends it to drive a game from a keyboard, so tests and
 * standalone development exercise the exact same code path production does.
 */

export type HostHandler<K extends GameToConsoleType> = (
  payload: GameToConsolePayloads[K],
  message: Envelope<K, GameToConsolePayloads[K]>,
) => void;

export type Unsubscribe = () => void;

export interface PrimalHostOptions {
  /** Reported to the game in the welcome. */
  consoleVersion?: string;
  /** Identifies this play session. Generated if omitted. */
  sessionId?: string;
  /**
   * Restrict which origin a hello may come from. Defaults to `'*'`, which is
   * right for same-page use (`FakeConsole`) and wrong for production — the
   * console should always pass the origin from the game's registry entry.
   */
  origin?: string;
  /**
   * Only accept a hello from this window. The console passes
   * `iframe.contentWindow` so an unrelated frame cannot answer in the game's
   * place. Defaults to accepting any source.
   */
  target?: Window | null;
  /** Reject any game whose `gameId` is not this. Defaults to accepting any. */
  gameId?: string;
  /** Where to listen for the handshake. Defaults to the global `window`. */
  window?: Window;
}

interface PendingReady {
  resolve: () => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout> | null;
}

export class PrimalHostError extends Error {
  constructor(
    message: string,
    readonly reason: RejectMessage['reason'] | 'timeout' | 'closed',
  ) {
    super(message);
    this.name = 'PrimalHostError';
  }
}

export class PrimalHost {
  readonly sessionId: string;
  readonly consoleVersion: string;
  /** Every message the game has sent, in order. */
  readonly received: GameToConsoleMessage[] = [];

  protected readonly win: Window;
  private readonly allowedOrigin: string;
  private readonly target: Window | null;
  private readonly expectedGameId: string | undefined;

  private port: MessagePort | null = null;
  private outSeq = 0;
  private closed = false;
  private connectedAt: number | null = null;
  /** Pinned from the accepted hello; everything after is posted only here. */
  private gameOrigin: string | null = null;
  private clockOffsetMs = 0;
  private ready = false;
  private readonly readyWaiters: PendingReady[] = [];
  private readonly handlers = new Map<string, Set<HostHandler<GameToConsoleType>>>();
  protected readonly detachFns: Array<() => void> = [];

  protected constructor(options: PrimalHostOptions) {
    this.win = options.window ?? window;
    this.sessionId = options.sessionId ?? `session-${Math.random().toString(36).slice(2, 10)}`;
    this.consoleVersion = options.consoleVersion ?? '0.0.0';
    this.allowedOrigin = options.origin ?? '*';
    this.target = options.target ?? null;
    this.expectedGameId = options.gameId;

    const onWindowMessage = (event: MessageEvent) => this.onHandshakeMessage(event);
    this.win.addEventListener('message', onWindowMessage);
    this.detachFns.push(() => this.win.removeEventListener('message', onWindowMessage));
  }

  static attach(options: PrimalHostOptions = {}): PrimalHost {
    return new PrimalHost(options);
  }

  /* ---------------------------------------------------------------------- */
  /* Handshake                                                               */
  /* ---------------------------------------------------------------------- */

  private onHandshakeMessage(event: MessageEvent): void {
    if (this.closed) return;
    if (!isHelloMessage(event.data)) return;
    // The game retries its hello until it hears back; ignore the extras.
    if (this.port) return;

    // Who is allowed to talk to us. Both checks are opt-in because same-page
    // use (FakeConsole, tests) has neither a distinct origin nor a target.
    if (this.target && event.source !== this.target) return;
    if (this.allowedOrigin !== '*' && event.origin !== this.allowedOrigin) return;

    const hello = event.data;
    const source = (event.source as Window | null) ?? this.win;
    // `event.origin` is "null" for sandboxed/opaque origins; posting to that
    // string throws, so fall back to a wildcard we have already validated.
    const replyOrigin = this.allowedOrigin !== '*' ? this.allowedOrigin : '*';

    if (this.expectedGameId !== undefined && hello.gameId !== this.expectedGameId) {
      this.reject(source, replyOrigin, 'unknown_game', `Expected game "${this.expectedGameId}", got "${hello.gameId}"`);
      return;
    }

    const version = negotiateVersion(hello.protocolVersions, SUPPORTED_PROTOCOL_VERSIONS);
    if (version === null) {
      this.reject(
        source,
        replyOrigin,
        'unsupported_protocol',
        `Game speaks protocol ${hello.protocolVersions.join(', ')}; this console speaks ${SUPPORTED_PROTOCOL_VERSIONS.join(', ')}`,
      );
      return;
    }

    this.gameOrigin = replyOrigin;
    this.clockOffsetMs = computeClockOffset(hello);
    this.accept(source, replyOrigin, version);
  }

  private reject(
    source: Window,
    origin: string,
    reason: RejectMessage['reason'],
    message: string,
  ): void {
    const rejection: RejectMessage = {
      t: 'primal/reject',
      reason,
      message,
      supportedVersions: [...SUPPORTED_PROTOCOL_VERSIONS],
    };
    source.postMessage(rejection, origin);
    this.failWaiters(new PrimalHostError(message, reason));
  }

  private accept(source: Window, origin: string, protocolVersion: number): void {
    const channel = new MessageChannel();
    this.port = channel.port1;
    this.port.onmessage = (event: MessageEvent) => this.onPortMessage(event);
    this.port.start();
    this.connectedAt = now();

    const welcome: WelcomeMessage = {
      t: 'primal/welcome',
      protocolVersion,
      sessionId: this.sessionId,
      consoleVersion: this.consoleVersion,
      consoleClockOffsetMs: this.clockOffsetMs,
    };
    source.postMessage(welcome, origin, [channel.port2]);
  }

  private onPortMessage(event: MessageEvent): void {
    if (this.closed) return;
    if (!isGameToConsoleMessage(event.data)) return; // Ignore what we don't understand.

    const message = event.data as GameToConsoleMessage;
    this.received.push(message);
    this.onGameMessage(message);

    if (message.t === 'game/ready' && !this.ready) {
      this.ready = true;
      for (const waiter of this.readyWaiters.splice(0)) {
        if (waiter.timer) clearTimeout(waiter.timer);
        waiter.resolve();
      }
    }

    const set = this.handlers.get(message.t);
    if (!set) return;
    for (const handler of [...set]) {
      try {
        handler(message.p as never, message as never);
      } catch (error) {
        // A console-side bug must not kill the game's message stream.
        console.error(`[primal] host handler for "${message.t}" threw`, error);
      }
    }
  }

  /**
   * Every game -> console message, before typed handlers run. Subclass hook;
   * the base does nothing.
   */
  protected onGameMessage(_message: GameToConsoleMessage): void {
    /* no-op */
  }

  private failWaiters(error: Error): void {
    for (const waiter of this.readyWaiters.splice(0)) {
      if (waiter.timer) clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Lifecycle                                                               */
  /* ---------------------------------------------------------------------- */

  /** Resolves once the game has handshaken and sent `game/ready`. */
  waitForReady(timeoutMs = 10_000): Promise<void> {
    if (this.ready) return Promise.resolve();
    if (this.closed) return Promise.reject(new PrimalHostError('Host is closed', 'closed'));
    return new Promise<void>((resolve, reject) => {
      const waiter: PendingReady = { resolve, reject, timer: null };
      waiter.timer = setTimeout(() => {
        const index = this.readyWaiters.indexOf(waiter);
        if (index >= 0) this.readyWaiters.splice(index, 1);
        reject(
          new PrimalHostError(
            `Game did not become ready within ${timeoutMs}ms. Is it built against @bosco98/primal-sdk and served with ?primal=console?`,
            'timeout',
          ),
        );
      }, timeoutMs);
      this.readyWaiters.push(waiter);
    });
  }

  get isReady(): boolean {
    return this.ready;
  }

  get isConnected(): boolean {
    return this.port !== null && !this.closed;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Add to the *game's* `performance.now()` to reach this console's clock.
   * Zero unless the game's hello carried its `timeOrigin` (SDK >= 0.2.0).
   */
  get gameClockOffsetMs(): number {
    return this.clockOffsetMs;
  }

  /* ---------------------------------------------------------------------- */
  /* Receiving                                                               */
  /* ---------------------------------------------------------------------- */

  on<K extends GameToConsoleType>(type: K, handler: HostHandler<K>): Unsubscribe {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler as HostHandler<GameToConsoleType>);
    return () => {
      set!.delete(handler as HostHandler<GameToConsoleType>);
    };
  }

  /** The most recent subscription the game requested, if any. */
  get subscription(): SubscribePayload | null {
    return this.lastPayload('config/subscribe');
  }

  /** The summary the game reported, if it has finished a session. */
  get summary(): WorkoutSummaryPayload | null {
    return this.lastPayload('workout/summary');
  }

  /** Whether the game has asked to be torn down. */
  get exited(): boolean {
    return this.received.some((m) => m.t === 'game/exit');
  }

  private lastPayload<K extends GameToConsoleType>(type: K): GameToConsolePayloads[K] | null {
    for (let i = this.received.length - 1; i >= 0; i--) {
      const message = this.received[i]!;
      if (message.t === type) return message.p as GameToConsolePayloads[K];
    }
    return null;
  }

  /* ---------------------------------------------------------------------- */
  /* Sending                                                                 */
  /* ---------------------------------------------------------------------- */

  /** Send one console -> game message. No-op before the handshake completes. */
  emit<K extends ConsoleToGameType>(type: K, payload: ConsoleToGamePayloads[K]): void {
    if (!this.port || this.closed) return;
    const envelope: Envelope<K, ConsoleToGamePayloads[K]> = {
      v: PROTOCOL_VERSION,
      t: type,
      ts: now(),
      seq: this.outSeq++,
      p: payload,
    };
    this.port.postMessage(envelope);
  }

  sessionStart(): void {
    this.emit('session/start', { sessionId: this.sessionId, startedAt: now() });
  }

  pause(reason: ConsoleToGamePayloads['session/pause']['reason'] = 'user'): void {
    this.emit('session/pause', { reason });
  }

  resume(): void {
    this.emit('session/resume', {});
  }

  end(reason: ConsoleToGamePayloads['session/end']['reason'] = 'user'): void {
    this.emit('session/end', { reason });
  }

  /** Seconds since the handshake completed. 0 before that. */
  get connectedSeconds(): number {
    return this.connectedAt === null ? 0 : (now() - this.connectedAt) / 1000;
  }

  /** Detach every listener and close the channel. Idempotent. */
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.failWaiters(new PrimalHostError('Host closed before the game was ready', 'closed'));
    for (const detach of this.detachFns.splice(0)) detach();
    this.handlers.clear();
    if (this.port) {
      this.port.onmessage = null;
      this.port.close();
      this.port = null;
    }
    void this.gameOrigin;
  }
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

/**
 * `consoleClockOffsetMs` is added to the game's `performance.now()` to land in
 * the console's clock domain. Both clocks count from their own document's
 * `timeOrigin`, so the difference between those origins is the whole offset:
 *
 *   gameOrigin + gameNow === consoleOrigin + consoleNow   (same instant)
 *   => consoleNow = gameNow + (gameOrigin - consoleOrigin)
 *
 * A game on an older SDK doesn't send its `timeOrigin`, in which case the two
 * clocks are treated as identical — which is exactly true for same-page use
 * and close enough for an iframe opened moments after its parent.
 */
function computeClockOffset(hello: HelloMessage): number {
  if (typeof hello.timeOrigin !== 'number' || !Number.isFinite(hello.timeOrigin)) return 0;
  if (typeof performance === 'undefined' || typeof performance.timeOrigin !== 'number') return 0;
  return hello.timeOrigin - performance.timeOrigin;
}
