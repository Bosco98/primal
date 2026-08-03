import { describe, expect, it } from 'vitest';

/**
 * Guards the assumptions `test/setup.ts` makes about the test environment.
 * If a happy-dom upgrade starts (or stops) supporting port transfer, this fails
 * here with a clear cause instead of surfacing as a mysterious handshake
 * timeout across the whole suite.
 */
describe('test environment', () => {
  it('delivers window.postMessage to itself with a source', async () => {
    const event = await new Promise<MessageEvent | null>((resolve) => {
      const timer = setTimeout(() => resolve(null), 200);
      window.addEventListener(
        'message',
        (e) => {
          clearTimeout(timer);
          resolve(e as MessageEvent);
        },
        { once: true },
      );
      window.parent.postMessage({ t: 'probe' }, '*');
    });

    expect(event).not.toBeNull();
    expect(event!.source).not.toBeNull();
  });

  it('carries transferred MessagePorts through in event.ports', async () => {
    const ports = await new Promise<readonly MessagePort[]>((resolve) => {
      const timer = setTimeout(() => resolve([]), 200);
      window.addEventListener(
        'message',
        (e) => {
          const me = e as MessageEvent;
          if ((me.data as { t?: string })?.t !== 'probe-port') return;
          clearTimeout(timer);
          resolve(me.ports);
        },
        { once: true },
      );
      const channel = new MessageChannel();
      window.postMessage({ t: 'probe-port' }, '*', [channel.port2]);
    });

    expect(ports.length).toBe(1);
  });

  it('delivers messages across a MessageChannel', async () => {
    const delivered = await new Promise<boolean>((resolve) => {
      const timer = setTimeout(() => resolve(false), 200);
      const channel = new MessageChannel();
      channel.port1.onmessage = () => {
        clearTimeout(timer);
        resolve(true);
      };
      channel.port2.postMessage('ping');
    });

    expect(delivered).toBe(true);
  });
});
