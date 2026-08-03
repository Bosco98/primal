import type {
  ConsoleToGameMessage,
  ConsoleToGameType,
  GameToConsoleMessage,
  GameToConsoleType,
  HelloMessage,
  RejectMessage,
  WelcomeMessage,
} from './v1.js';

/**
 * Structural guards for the wire protocol.
 *
 * These are deliberately shallow: they run on every `input/body` frame (30Hz)
 * so they check the envelope shape and the message type, not the full payload.
 * Payload correctness is the sender's responsibility — both sides are built
 * from the same types in `v1.ts`, so deep per-frame validation buys nothing.
 */

const CONSOLE_TO_GAME_TYPES: ReadonlySet<string> = new Set<ConsoleToGameType>([
  'input/rep',
  'input/rep_progress',
  'input/gesture',
  'input/body',
  'input/intensity',
  'tracking/status',
  'session/start',
  'session/pause',
  'session/resume',
  'session/end',
]);

const GAME_TO_CONSOLE_TYPES: ReadonlySet<string> = new Set<GameToConsoleType>([
  'game/ready',
  'game/exit',
  'config/subscribe',
  'workout/progress',
  'workout/summary',
  'ui/setPreview',
]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isEnvelopeShaped(value: unknown): value is Record<string, unknown> & { t: string } {
  return (
    isRecord(value) &&
    typeof value.t === 'string' &&
    typeof value.v === 'number' &&
    typeof value.ts === 'number' &&
    typeof value.seq === 'number' &&
    isRecord(value.p)
  );
}

export function isConsoleToGameMessage(value: unknown): value is ConsoleToGameMessage {
  return isEnvelopeShaped(value) && CONSOLE_TO_GAME_TYPES.has(value.t);
}

export function isGameToConsoleMessage(value: unknown): value is GameToConsoleMessage {
  return isEnvelopeShaped(value) && GAME_TO_CONSOLE_TYPES.has(value.t);
}

export function isHelloMessage(value: unknown): value is HelloMessage {
  return (
    isRecord(value) &&
    value.t === 'primal/hello' &&
    Array.isArray(value.protocolVersions) &&
    value.protocolVersions.every((v) => typeof v === 'number') &&
    typeof value.gameId === 'string' &&
    typeof value.sdkVersion === 'string'
  );
}

export function isWelcomeMessage(value: unknown): value is WelcomeMessage {
  return (
    isRecord(value) &&
    value.t === 'primal/welcome' &&
    typeof value.protocolVersion === 'number' &&
    typeof value.sessionId === 'string' &&
    typeof value.consoleVersion === 'string' &&
    typeof value.consoleClockOffsetMs === 'number'
  );
}

export function isRejectMessage(value: unknown): value is RejectMessage {
  return (
    isRecord(value) &&
    value.t === 'primal/reject' &&
    typeof value.reason === 'string' &&
    typeof value.message === 'string'
  );
}

/** Highest protocol major both sides can speak, or `null` if they are incompatible. */
export function negotiateVersion(
  gameVersions: readonly number[],
  consoleVersions: readonly number[],
): number | null {
  const shared = gameVersions.filter((v) => consoleVersions.includes(v));
  return shared.length === 0 ? null : Math.max(...shared);
}
