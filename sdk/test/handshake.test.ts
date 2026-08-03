import { afterEach, describe, expect, it } from 'vitest';
import { PrimalClient, PrimalConnectionError } from '../src/index.js';
import { FakeConsole } from '../src/testing/index.js';

/**
 * End-to-end contract: a real PrimalClient talking to a FakeConsole over a real
 * MessageChannel. If this passes, a game written against the SDK will connect
 * to the console.
 */

let fake: FakeConsole | null = null;
let client: PrimalClient | null = null;

afterEach(() => {
  client?.disconnect();
  fake?.detach();
  client = null;
  fake = null;
});

async function connectPair() {
  fake = FakeConsole.attach({ sessionId: 'test-session', consoleVersion: '1.2.3' });
  client = await PrimalClient.connect({ gameId: 'test-game', timeoutMs: 2000 });
  await fake.waitForReady();
  return { fake, client };
}

describe('handshake', () => {
  it('completes and exchanges session metadata', async () => {
    const { client } = await connectPair();
    expect(client.sessionId).toBe('test-session');
    expect(client.consoleVersion).toBe('1.2.3');
    expect(client.protocolVersion).toBe(1);
    expect(client.isClosed).toBe(false);
  });

  it('reports the game as ready to the console', async () => {
    const { fake } = await connectPair();
    expect(fake.received[0]?.t).toBe('game/ready');
  });

  it('times out with a helpful error when no console answers', async () => {
    await expect(
      PrimalClient.connect({ gameId: 'lonely', timeoutMs: 150, helloIntervalMs: 50 }),
    ).rejects.toBeInstanceOf(PrimalConnectionError);
  });
});

describe('input delivery', () => {
  it('delivers rep events with running counts', async () => {
    const { fake, client } = await connectPair();
    const reps: number[] = [];
    client.on('input/rep', (rep) => reps.push(rep.count));

    fake.rep('squat');
    fake.rep('squat');
    fake.rep('squat');
    await tick();

    expect(reps).toEqual([1, 2, 3]);
  });

  it('keeps per-exercise counts independent', async () => {
    const { fake, client } = await connectPair();
    const seen: Array<[string, number]> = [];
    client.on('input/rep', (rep) => seen.push([rep.exercise, rep.count]));

    fake.rep('squat');
    fake.rep('lunge');
    fake.rep('squat');
    await tick();

    expect(seen).toEqual([
      ['squat', 1],
      ['lunge', 1],
      ['squat', 2],
    ]);
  });

  it('passes form scores and flags through untouched', async () => {
    const { fake, client } = await connectPair();
    let received: { formScore: number; flags: string[] } | null = null;
    client.on('input/rep', (rep) => {
      received = { formScore: rep.formScore, flags: [...rep.flags] };
    });

    fake.rep('squat', { formScore: 0.42, flags: ['shallow', 'fast'] });
    await tick();

    expect(received).toEqual({ formScore: 0.42, flags: ['shallow', 'fast'] });
  });

  it('delivers gesture start and end edges', async () => {
    const { fake, client } = await connectPair();
    const edges: string[] = [];
    client.on('input/gesture', (g) => edges.push(`${g.gesture}:${g.state}`));

    fake.gesture('block', 'start');
    fake.gesture('block', 'end');
    await tick();

    expect(edges).toEqual(['block:start', 'block:end']);
  });

  it('delivers body state', async () => {
    const { fake, client } = await connectPair();
    let lean = 0;
    client.on('input/body', (body) => {
      lean = body.lean;
    });

    fake.setBody({ lean: -0.8 });
    await tick();

    expect(lean).toBeCloseTo(-0.8);
  });

  it('delivers lifecycle events', async () => {
    const { fake, client } = await connectPair();
    const events: string[] = [];
    client.on('session/pause', (p) => events.push(`pause:${p.reason}`));
    client.on('session/resume', () => events.push('resume'));
    client.on('session/end', (p) => events.push(`end:${p.reason}`));

    fake.pause('tracking_lost');
    fake.resume();
    fake.end('user');
    await tick();

    expect(events).toEqual(['pause:tracking_lost', 'resume', 'end:user']);
  });

  it('stops delivering after unsubscribe', async () => {
    const { fake, client } = await connectPair();
    let count = 0;
    const off = client.on('input/rep', () => count++);

    fake.rep('squat');
    await tick();
    off();
    fake.rep('squat');
    await tick();

    expect(count).toBe(1);
  });

  it('isolates a throwing handler from the rest of the stream', async () => {
    const { fake, client } = await connectPair();
    let survived = 0;
    client.on('input/rep', () => {
      throw new Error('game bug');
    });
    client.on('input/rep', () => survived++);

    fake.rep('squat');
    fake.rep('squat');
    await tick();

    expect(survived).toBe(2);
  });

  it('stops delivering once disconnected', async () => {
    const { fake, client } = await connectPair();
    let count = 0;
    client.on('input/rep', () => count++);

    client.disconnect();
    fake.rep('squat');
    await tick();

    expect(count).toBe(0);
    expect(client.isClosed).toBe(true);
  });
});

describe('game to console commands', () => {
  it('sends subscriptions the console can read back', async () => {
    const { fake, client } = await connectPair();
    client.subscribe({ channels: ['rep', 'body'], exercises: ['squat'], bodyRateHz: 20 });
    await tick();

    expect(fake.subscription).toEqual({
      channels: ['rep', 'body'],
      exercises: ['squat'],
      bodyRateHz: 20,
    });
  });

  it('sends the workout summary', async () => {
    const { fake, client } = await connectPair();
    client.reportSummary({
      reps: { squat: 24 },
      activeSeconds: 300,
      avgIntensity: 0.62,
      score: 1500,
    });
    await tick();

    expect(fake.summary?.reps.squat).toBe(24);
    expect(fake.summary?.activeSeconds).toBe(300);
  });

  it('signals exit', async () => {
    const { fake, client } = await connectPair();
    client.exit();
    await tick();

    expect(fake.exited).toBe(true);
  });
});

/** Let the MessageChannel drain; port delivery is a macrotask. */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0));
}
