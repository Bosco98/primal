import { describe, expect, it } from 'vitest';
import {
  isConsoleToGameMessage,
  isGameToConsoleMessage,
  isHelloMessage,
  isRejectMessage,
  isWelcomeMessage,
  negotiateVersion,
  PROTOCOL_VERSION,
} from '../src/index.js';

const envelope = (t: string) => ({ v: 1, t, ts: 0, seq: 0, p: {} });

describe('message guards', () => {
  it('accepts well-formed console-to-game envelopes', () => {
    expect(isConsoleToGameMessage(envelope('input/rep'))).toBe(true);
    expect(isConsoleToGameMessage(envelope('session/pause'))).toBe(true);
  });

  it('rejects envelopes going the wrong direction', () => {
    expect(isConsoleToGameMessage(envelope('workout/summary'))).toBe(false);
    expect(isGameToConsoleMessage(envelope('input/rep'))).toBe(false);
  });

  // The forward-compatibility contract: an old game must survive a new console
  // inventing message types, and vice versa.
  it('rejects unknown message types instead of throwing', () => {
    expect(isConsoleToGameMessage(envelope('input/telepathy'))).toBe(false);
    expect(isGameToConsoleMessage(envelope('workout/vibes'))).toBe(false);
  });

  it('rejects malformed and hostile input', () => {
    expect(isConsoleToGameMessage(null)).toBe(false);
    expect(isConsoleToGameMessage('input/rep')).toBe(false);
    expect(isConsoleToGameMessage({ t: 'input/rep' })).toBe(false);
    expect(isConsoleToGameMessage({ ...envelope('input/rep'), p: 'not-an-object' })).toBe(false);
    expect(isConsoleToGameMessage({ ...envelope('input/rep'), seq: '0' })).toBe(false);
  });

  it('recognises handshake messages', () => {
    expect(
      isHelloMessage({
        t: 'primal/hello',
        protocolVersions: [1],
        sdkVersion: '0.1.0',
        gameId: 'x',
      }),
    ).toBe(true);
    expect(isHelloMessage({ t: 'primal/hello', protocolVersions: ['1'] })).toBe(false);

    expect(
      isWelcomeMessage({
        t: 'primal/welcome',
        protocolVersion: 1,
        sessionId: 's',
        consoleVersion: '1',
        consoleClockOffsetMs: 0,
      }),
    ).toBe(true);

    expect(isRejectMessage({ t: 'primal/reject', reason: 'unknown_game', message: 'no' })).toBe(
      true,
    );
  });
});

describe('version negotiation', () => {
  it('picks the highest shared major', () => {
    expect(negotiateVersion([1, 2], [1, 2, 3])).toBe(2);
    expect(negotiateVersion([1], [1])).toBe(PROTOCOL_VERSION);
  });

  it('returns null when there is no overlap', () => {
    expect(negotiateVersion([1], [2, 3])).toBeNull();
    expect(negotiateVersion([], [1])).toBeNull();
  });
});
