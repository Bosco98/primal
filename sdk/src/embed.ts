/**
 * Am I running inside a console, or on my own?
 *
 * A game needs to know this *before* it tries to hand-shake, because the two
 * cases want opposite things:
 *
 *  - Embedded: talk to the parent window and wait for it.
 *  - Standalone: don't wait at all — nobody is going to answer. Attach a
 *    `FakeConsole` and start immediately.
 *
 * Without this a standalone game sits through the full connect timeout (10s by
 * default) before it can do anything, which makes local development miserable.
 * The console appends `?primal=console` when it iframes a game, so the answer
 * is one synchronous, allocation-free check.
 */

export const CONSOLE_PARAM = 'primal';
export const CONSOLE_PARAM_VALUE = 'console';

/**
 * True when this page is running inside a PRIMAL console's game iframe.
 *
 *   if (!isConsoleEmbedded()) FakeConsole.attach().bindKeyboard();
 *   const primal = await PrimalClient.connect({ gameId: 'my-game' });
 *
 * Both branches then take the identical path: the fake answers the same
 * handshake the real console does, so no game logic is ever conditional on
 * where it is running.
 *
 * Requires *both* an iframe and the marker. The iframe check alone would be
 * true for any embed; the marker alone would be true for a top-level page
 * someone bookmarked with the query string still attached.
 */
export function isConsoleEmbedded(): boolean {
  if (typeof window === 'undefined') return false;
  if (window.parent === window) return false;
  return new URLSearchParams(window.location.search).get(CONSOLE_PARAM) === CONSOLE_PARAM_VALUE;
}

/** Add the console marker to a game URL. This is what the console does. */
export function withConsoleParam(url: URL): URL {
  url.searchParams.set(CONSOLE_PARAM, CONSOLE_PARAM_VALUE);
  return url;
}
