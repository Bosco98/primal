import { afterEach, describe, expect, it } from 'vitest';
import {
  isConsoleEmbedded,
  PrimalClient,
  PrimalConnectionError,
  PrimalHost,
  withConsoleParam,
} from '../src/index.js';

/**
 * `PrimalHost` is the console half of the handshake, and the only half a
 * hostile page can reach — the game announces itself by broadcasting a hello
 * and anything listening can answer. These tests cover the gates that decide
 * who gets a MessagePort.
 */

let host: PrimalHost | null = null;
let client: PrimalClient | null = null;

afterEach(() => {
  client?.disconnect();
  host?.close();
  client = null;
  host = null;
});

const tick = (ms = 30) => new Promise((resolve) => setTimeout(resolve, ms));

describe('acceptance', () => {
  it('completes a handshake and reports the game ready', async () => {
    host = PrimalHost.attach({ sessionId: 's1', consoleVersion: '9.9.9' });
    client = await PrimalClient.connect({ gameId: 'any-game', timeoutMs: 2000 });
    await host.waitForReady(2000);

    expect(host.isReady).toBe(true);
    expect(host.isConnected).toBe(true);
    expect(client.sessionId).toBe('s1');
    expect(client.consoleVersion).toBe('9.9.9');
  });

  it('accepts the expected gameId', async () => {
    host = PrimalHost.attach({ gameId: 'dodge-collect' });
    client = await PrimalClient.connect({ gameId: 'dodge-collect', timeoutMs: 2000 });
    await host.waitForReady(2000);
    expect(host.isReady).toBe(true);
  });

  it('drives a session lifecycle the game can observe', async () => {
    host = PrimalHost.attach();
    client = await PrimalClient.connect({ gameId: 'g', timeoutMs: 2000 });
    await host.waitForReady(2000);

    const seen: string[] = [];
    client.on('session/start', () => seen.push('start'));
    client.on('session/pause', (p) => seen.push(`pause:${p.reason}`));
    client.on('session/resume', () => seen.push('resume'));
    client.on('session/end', (p) => seen.push(`end:${p.reason}`));

    host.sessionStart();
    host.pause('tracking_lost');
    host.resume();
    host.end('user');
    await tick();

    expect(seen).toEqual(['start', 'pause:tracking_lost', 'resume', 'end:user']);
  });
});

describe('rejection', () => {
  it('rejects a game whose id is not the one being launched', async () => {
    host = PrimalHost.attach({ gameId: 'rep-battle' });

    const error = await PrimalClient.connect({
      gameId: 'something-else',
      timeoutMs: 1000,
    }).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(PrimalConnectionError);
    expect((error as PrimalConnectionError).reason).toBe('unknown_game');
    expect(host.isConnected).toBe(false);
  });

  it('ignores a hello from a window it was not told to expect', async () => {
    // A target the hello will never come from: the handshake must not complete.
    const decoy = { postMessage() {} } as unknown as Window;
    host = PrimalHost.attach({ target: decoy });

    await expect(
      PrimalClient.connect({ gameId: 'g', timeoutMs: 200, helloIntervalMs: 50 }),
    ).rejects.toBeInstanceOf(PrimalConnectionError);
    expect(host.isConnected).toBe(false);
  });

  it('ignores a hello from an origin it was not told to expect', async () => {
    host = PrimalHost.attach({ origin: 'https://games.example.com' });

    // happy-dom reports same-page messages as the page's own origin, which is
    // not the one above, so the host must stay silent.
    await expect(
      PrimalClient.connect({ gameId: 'g', timeoutMs: 200, helloIntervalMs: 50 }),
    ).rejects.toBeInstanceOf(PrimalConnectionError);
    expect(host.isConnected).toBe(false);
  });

  it('only answers the first hello, ignoring the retries behind it', async () => {
    host = PrimalHost.attach();
    client = await PrimalClient.connect({ gameId: 'g', timeoutMs: 2000, helloIntervalMs: 20 });
    await host.waitForReady(2000);
    const readyCount = () => host!.received.filter((m) => m.t === 'game/ready').length;

    await tick(120); // several retry intervals
    expect(readyCount()).toBe(1);
  });
});

describe('reading what the game sent', () => {
  it('exposes the latest subscription and the summary', async () => {
    host = PrimalHost.attach();
    client = await PrimalClient.connect({ gameId: 'g', timeoutMs: 2000 });
    await host.waitForReady(2000);

    client.subscribe({ channels: ['gesture'], exercises: [] });
    client.subscribe({ channels: ['gesture', 'body'], exercises: [], bodyRateHz: 30 });
    client.reportSummary({ reps: { squat: 12 }, activeSeconds: 90, avgIntensity: 0.7, score: 400 });
    await tick();

    expect(host.subscription?.channels).toEqual(['gesture', 'body']);
    expect(host.subscription?.bodyRateHz).toBe(30);
    expect(host.summary?.reps.squat).toBe(12);
    expect(host.summary?.activeSeconds).toBe(90);
  });

  it('notices when the game asks to exit', async () => {
    host = PrimalHost.attach();
    client = await PrimalClient.connect({ gameId: 'g', timeoutMs: 2000 });
    await host.waitForReady(2000);

    expect(host.exited).toBe(false);
    client.exit();
    await tick();
    expect(host.exited).toBe(true);
  });

  it('survives a console-side handler that throws', async () => {
    host = PrimalHost.attach();
    client = await PrimalClient.connect({ gameId: 'g', timeoutMs: 2000 });
    await host.waitForReady(2000);

    const seen: number[] = [];
    host.on('workout/progress', () => {
      throw new Error('console bug');
    });
    host.on('workout/progress', (p) => seen.push(p.activeSeconds ?? 0));

    client.reportProgress({ activeSeconds: 5 });
    client.reportProgress({ activeSeconds: 10 });
    await tick();

    expect(seen).toEqual([5, 10]);
  });
});

describe('clock alignment', () => {
  it('derives a real offset from the game timeOrigin so latency is measurable', async () => {
    host = PrimalHost.attach();
    client = await PrimalClient.connect({ gameId: 'g', timeoutMs: 2000 });
    await host.waitForReady(2000);

    // Same document here, so the two clocks genuinely agree and the offset is 0.
    // The point of the assertion is that a number was negotiated at all — a
    // cross-document host derives a non-zero value by the same path.
    expect(Number.isFinite(host.gameClockOffsetMs)).toBe(true);
    expect(host.gameClockOffsetMs).toBe(0);

    host.emit('input/intensity', { instant: 0.5, avg10s: 0.5 });
    await tick();
    expect(client.latencyMs).toBeGreaterThanOrEqual(0);
    expect(client.latencyMs).toBeLessThan(1000);
  });
});

describe('teardown', () => {
  it('close() is idempotent and stops delivery', async () => {
    host = PrimalHost.attach();
    client = await PrimalClient.connect({ gameId: 'g', timeoutMs: 2000 });
    await host.waitForReady(2000);

    const seen: number[] = [];
    host.on('workout/progress', (p) => seen.push(p.activeSeconds ?? 0));

    host.close();
    host.close(); // must not throw
    client.reportProgress({ activeSeconds: 1 });
    await tick();

    expect(seen).toEqual([]);
    expect(host.isClosed).toBe(true);
    expect(host.isConnected).toBe(false);
  });

  it('fails pending ready waiters instead of hanging when closed', async () => {
    host = PrimalHost.attach();
    const pending = host.waitForReady(5000);
    host.close();
    await expect(pending).rejects.toThrow(/closed/i);
  });
});

describe('embed detection', () => {
  it('is false for a top-level page', () => {
    // The test page is not framed, so this must be false whatever the query is.
    expect(isConsoleEmbedded()).toBe(false);
  });

  it('marks a game URL the way the console does', () => {
    const url = withConsoleParam(new URL('https://bosco98.github.io/primal-game-dodge-collect/'));
    expect(url.searchParams.get('primal')).toBe('console');
    expect(url.toString()).toContain('primal=console');
  });
});
