/**
 * @bosco98/primal-sdk — build games for the PRIMAL motion console.
 *
 *   import { PrimalClient, FakeConsole, isConsoleEmbedded } from '@bosco98/primal-sdk';
 *
 *   // Standalone? Nobody is going to answer the handshake, so answer it yourself.
 *   if (!isConsoleEmbedded()) FakeConsole.attach().bindKeyboard();
 *
 *   const primal = await PrimalClient.connect({ gameId: 'my-game' });
 *   primal.subscribe({ channels: ['rep'], exercises: ['squat'] });
 *   primal.on('input/rep', (rep) => {
 *     dealDamage(10 * rep.formScore);
 *   });
 *
 * The same build runs standalone and as a cartridge, with no branch in game
 * logic: the fake console speaks the identical protocol the real one does.
 */

export * from './protocol/v1.js';
export * from './protocol/guards.js';

/* Game side */
export { PrimalClient, PrimalConnectionError } from './client.js';
export type { ConnectOptions, Handler, Unsubscribe } from './client.js';

/* Console side — the other half of the handshake, kept next to the first half
 * on purpose. A game bundles its own copy of this SDK, so this file is the
 * compatibility contract between that copy and the console's. */
export { PrimalHost, PrimalHostError } from './host/primal-host.js';
export type { PrimalHostOptions, HostHandler } from './host/primal-host.js';

/* Am I in a console? */
export {
  isConsoleEmbedded,
  withConsoleParam,
  CONSOLE_PARAM,
  CONSOLE_PARAM_VALUE,
} from './embed.js';

/* Develop and test without a camera. Also exported from `/testing` for games
 * that would rather keep it out of a production bundle. */
export { FakeConsole } from './testing/fake-console.js';
export type { FakeConsoleOptions, FakeRepOptions } from './testing/fake-console.js';

export { SDK_VERSION } from './version.js';
