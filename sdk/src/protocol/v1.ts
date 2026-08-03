/**
 * PRIMAL wire protocol, version 1.
 *
 * This file is the single source of truth for every message that crosses the
 * console <-> game boundary. Both `primal-console` and every game import
 * these types from `@bosco98/primal-sdk`; the normative prose spec lives in
 * `docs/protocol/v1.md` and must be updated alongside this file.
 *
 * Compatibility rules:
 *  - Receivers MUST ignore messages whose `t` they do not recognise. This makes
 *    adding a message type a non-breaking change.
 *  - Adding an optional field to a payload is non-breaking.
 *  - Removing/renaming a field or changing its meaning requires a new major
 *    version, negotiated during the handshake.
 */

export const PROTOCOL_VERSION = 1;

/** Protocol majors this SDK build can speak, newest first. */
export const SUPPORTED_PROTOCOL_VERSIONS: readonly number[] = [1];

/* -------------------------------------------------------------------------- */
/* Handshake                                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Handshake messages travel over `window.postMessage` because the MessagePort
 * does not exist yet. Everything after the handshake travels over the port.
 */

/** Game -> console. Repeated until a welcome or reject arrives. */
export interface HelloMessage {
  t: 'primal/hello';
  /** Protocol majors this game can speak. */
  protocolVersions: number[];
  sdkVersion: string;
  gameId: string;
  /**
   * The game document's `performance.timeOrigin`. Lets the console compute a
   * real `consoleClockOffsetMs` instead of assuming the two clocks agree —
   * without it, every `ts` a game reads is off by however long before it the
   * console's document was created, and measured input latency is fiction.
   *
   * Optional because it was added after protocol 1 shipped; a console that
   * doesn't get one falls back to a zero offset.
   */
  timeOrigin?: number;
}

/** Console -> game, with `port2` of a fresh MessageChannel in `event.ports[0]`. */
export interface WelcomeMessage {
  t: 'primal/welcome';
  /** The major both sides agreed on. */
  protocolVersion: number;
  sessionId: string;
  consoleVersion: string;
  /**
   * Add this to the game's `performance.now()` to land in the console's clock
   * domain, which is what every envelope `ts` is expressed in. Lets a game
   * measure true end-to-end input latency.
   */
  consoleClockOffsetMs: number;
}

/** Console -> game. Terminal: the game will receive no port. */
export interface RejectMessage {
  t: 'primal/reject';
  reason: 'unsupported_protocol' | 'unknown_game' | 'origin_mismatch';
  message: string;
  supportedVersions: number[];
}

export type HandshakeMessage = HelloMessage | WelcomeMessage | RejectMessage;

/* -------------------------------------------------------------------------- */
/* Envelope                                                                    */
/* -------------------------------------------------------------------------- */

export interface Envelope<T extends string, P> {
  /** Protocol major. */
  v: number;
  /** Message type. */
  t: T;
  /** Console clock (`performance.now()` domain) at which the event occurred. */
  ts: number;
  /** Monotonic per-direction counter. Gaps mean dropped/throttled messages. */
  seq: number;
  /** Payload. */
  p: P;
}

/* -------------------------------------------------------------------------- */
/* Vocabulary 1: reps                                                          */
/* -------------------------------------------------------------------------- */

export type ExerciseId = 'squat' | 'pushup' | 'jumping_jack' | 'lunge';

/**
 * Quality problems detected in a rep. A rep is still *counted* when flagged —
 * games decide whether to reward it. Flagging beats silently inflating counts.
 */
export type RepFlag =
  /** Did not reach target depth/range of motion. */
  | 'shallow'
  /** Completed faster than is plausible under control. */
  | 'fast'
  /** Left/right sides moved unevenly. */
  | 'asymmetric'
  /** Rep aborted partway and returned to start; counted at low confidence. */
  | 'partial';

export interface RepPayload {
  exercise: ExerciseId;
  /** Monotonic per-session id for this rep. */
  repId: number;
  /** Running total for this exercise this session, including this rep. */
  count: number;
  /** 0..1 composite of depth, tempo, symmetry and posture. */
  formScore: number;
  flags: RepFlag[];
  /** Wall time from rep start to rep completion. */
  durationMs: number;
}

export type RepPhase = 'down' | 'bottom' | 'up' | 'rest';

/**
 * Emitted continuously while a rep is in flight so games can render live
 * feedback (a charging meter, a stretching bowstring). Optional to consume.
 */
export interface RepProgressPayload {
  exercise: ExerciseId;
  phase: RepPhase;
  /** 0..1 through the current phase. */
  progress: number;
  /** 0..1 depth achieved so far, relative to the target range of motion. */
  depth: number;
}

/* -------------------------------------------------------------------------- */
/* Vocabulary 2: gestures                                                      */
/* -------------------------------------------------------------------------- */

export type GestureId =
  | 'punch_left'
  | 'punch_right'
  | 'block'
  | 'lean_left'
  | 'lean_right'
  | 'jump'
  | 'crouch';

/**
 * Edge-triggered. Momentary gestures (punches, jumps) emit `start` then `end`;
 * held gestures (block, lean, crouch) hold `start` until released.
 */
export interface GesturePayload {
  gesture: GestureId;
  state: 'start' | 'end';
  /** 0..1. */
  confidence: number;
}

/* -------------------------------------------------------------------------- */
/* Vocabulary 3: body as cursor                                                */
/* -------------------------------------------------------------------------- */

export interface Point2 {
  /** 0..1, left to right of the calibrated play area. */
  x: number;
  /** 0..1, top to bottom of the calibrated play area. */
  y: number;
}

export interface TrackedPoint extends Point2 {
  /** False when the landmark is occluded or out of frame; x/y are then stale. */
  visible: boolean;
}

/**
 * Continuous body state, already mirrored (the player's right hand appears on
 * the right of the screen) and normalised against the calibration baseline, so
 * games never touch raw landmarks.
 */
export interface BodyPayload {
  hands: { left: TrackedPoint; right: TrackedPoint };
  bodyCenter: Point2;
  head: Point2;
  /** -1 fully left, 0 centred, +1 fully right, relative to calibrated centre. */
  lean: number;
  /** 0 standing, 1 fully squatted, relative to calibrated standing height. */
  crouch: number;
}

/* -------------------------------------------------------------------------- */
/* Vocabulary 4: effort                                                        */
/* -------------------------------------------------------------------------- */

export interface IntensityPayload {
  /** 0..1 smoothed instantaneous movement intensity. */
  instant: number;
  /** 0..1 rolling 10-second average. Use this to pace a workout. */
  avg10s: number;
}

/* -------------------------------------------------------------------------- */
/* Lifecycle and tracking                                                      */
/* -------------------------------------------------------------------------- */

export type TrackingIssue =
  | 'not_in_frame'
  | 'too_close'
  | 'too_far'
  | 'low_light'
  | 'multiple_people';

export interface TrackingStatusPayload {
  personDetected: boolean;
  /** 0..1 overall confidence that input is currently trustworthy. */
  quality: number;
  issues: TrackingIssue[];
}

export interface SessionStartPayload {
  sessionId: string;
  /** Console clock at session start. */
  startedAt: number;
}

export type PauseReason = 'tracking_lost' | 'user' | 'hidden' | 'calibrating';

export interface SessionPausePayload {
  reason: PauseReason;
}

export interface SessionEndPayload {
  reason: 'user' | 'game' | 'error';
}

/* -------------------------------------------------------------------------- */
/* Game -> console commands                                                    */
/* -------------------------------------------------------------------------- */

export type InputChannel = 'rep' | 'gesture' | 'body' | 'intensity';

/**
 * Games receive nothing until they subscribe. Subscribing narrowly is not just
 * hygiene: the console skips recognisers nobody is listening to, which is real
 * CPU back in the frame budget.
 */
export interface SubscribePayload {
  channels: InputChannel[];
  /** Which exercises to run rep detection for. Required if `rep` is subscribed. */
  exercises?: ExerciseId[];
  /** Desired `input/body` rate. Console clamps to 1..60; defaults to 30. */
  bodyRateHz?: number;
}

/** Incremental progress, for the console's always-visible workout HUD. */
export interface WorkoutProgressPayload {
  reps?: Partial<Record<ExerciseId, number>>;
  activeSeconds?: number;
}

/** Sent once when a play session ends. Drives the console's summary screen. */
export interface WorkoutSummaryPayload {
  reps: Partial<Record<ExerciseId, number>>;
  activeSeconds: number;
  /** 0..1 average of `intensity.avg10s` across the session. */
  avgIntensity: number;
  /** Game-defined score, for the game's own leaderboards. */
  score?: number;
}

/** Toggle the console's picture-in-picture camera/skeleton preview. */
export interface SetPreviewPayload {
  visible: boolean;
}

/* -------------------------------------------------------------------------- */
/* Message maps                                                                */
/* -------------------------------------------------------------------------- */

export interface ConsoleToGamePayloads {
  'input/rep': RepPayload;
  'input/rep_progress': RepProgressPayload;
  'input/gesture': GesturePayload;
  'input/body': BodyPayload;
  'input/intensity': IntensityPayload;
  'tracking/status': TrackingStatusPayload;
  'session/start': SessionStartPayload;
  'session/pause': SessionPausePayload;
  'session/resume': Record<string, never>;
  'session/end': SessionEndPayload;
}

export interface GameToConsolePayloads {
  'game/ready': Record<string, never>;
  'game/exit': Record<string, never>;
  'config/subscribe': SubscribePayload;
  'workout/progress': WorkoutProgressPayload;
  'workout/summary': WorkoutSummaryPayload;
  'ui/setPreview': SetPreviewPayload;
}

export type ConsoleToGameType = keyof ConsoleToGamePayloads;
export type GameToConsoleType = keyof GameToConsolePayloads;

export type ConsoleToGameMessage = {
  [K in ConsoleToGameType]: Envelope<K, ConsoleToGamePayloads[K]>;
}[ConsoleToGameType];

export type GameToConsoleMessage = {
  [K in GameToConsoleType]: Envelope<K, GameToConsolePayloads[K]>;
}[GameToConsoleType];

/* -------------------------------------------------------------------------- */
/* Manifest                                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Every game serves this as `/primal.manifest.json`. The console fetches it
 * when a game is added by URL; it is the plug-and-play contract.
 */
export interface GameManifest {
  id: string;
  name: string;
  version: string;
  /** Protocol majors this game can speak. */
  protocolVersions: number[];
  description?: string;
  /** Path or URL to a 16:9 thumbnail. */
  thumbnail?: string;
  /** Declared up front so the launcher can warn before a game is started. */
  channels: InputChannel[];
  exercises?: ExerciseId[];
  /** Rough session length, shown in the launcher. */
  estimatedMinutes?: number;
}
