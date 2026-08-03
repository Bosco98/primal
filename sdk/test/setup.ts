/**
 * happy-dom implements `window.postMessage` but drops the transfer list, so
 * `event.ports` always arrives empty. Real browsers deliver it, and the PRIMAL
 * handshake depends on it: the console hands the game a MessagePort that way.
 *
 * Rather than adding a test-only seam to the client, patch the environment so
 * the handshake code under test is exactly the code that ships. The real
 * handshake is additionally covered against Chrome by the console's Playwright
 * suite.
 */
const nativePostMessage = window.postMessage.bind(window);
void nativePostMessage;

type PostMessage = (message: unknown, targetOrigin?: unknown, transfer?: unknown) => void;

const patched: PostMessage = (message, _targetOrigin, transfer) => {
  const ports = (Array.isArray(transfer) ? transfer : []).filter(
    (item): item is MessagePort =>
      typeof item === 'object' && item !== null && typeof (item as MessagePort).postMessage === 'function',
  );

  const event = new MessageEvent('message', {
    data: message,
    origin: 'http://localhost',
    source: window as unknown as MessageEventSource,
    ports,
  });

  // Real postMessage is always asynchronous; preserve that so tests cannot
  // accidentally depend on synchronous delivery.
  queueMicrotask(() => window.dispatchEvent(event));
};

window.postMessage = patched as unknown as typeof window.postMessage;
