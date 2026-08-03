import { COYOTE_MS, PRE_BUFFER_MS } from './config.js';
import type { Action } from '../types.js';

interface Entry {
  action: Action;
  at: number;
  consumed: boolean;
}

/**
 * A small ring of recent player actions, consumed by the fixed-timestep loop.
 *
 * Two things this still does, and one it no longer needs to.
 *
 * Still: actions never mutate simulation state directly. They are queued with
 * the time they happened and consumed on a simulation step, because a handler
 * firing between steps produces input that happened at no particular time.
 *
 * Still: the windows are asymmetric and generous. The pose pipeline runs
 * 140-200ms end to end and no code here can shorten that, so the design absorbs
 * it — an action counts if it lands anywhere from 250ms early to 120ms late.
 * Humans anticipate; a player who jumps early should never be punished for it.
 *
 * No longer: converting between clock domains. Input used to cross a
 * postMessage boundary into another document with its own `timeOrigin`, so
 * every event carried a console timestamp that had to be translated. Same
 * document now — `performance.now()` means one thing.
 */
export class InputQueue {
  private readonly entries: Entry[] = [];

  push(action: Action, at: number): void {
    this.entries.push({ action, at, consumed: false });
    if (this.entries.length > 32) this.entries.splice(0, this.entries.length - 32);
  }

  /** Consume one matching action inside the forgiveness window, if there is one. */
  take(action: Action, now: number): boolean {
    for (const entry of this.entries) {
      if (entry.consumed || entry.action !== action) continue;
      const delta = entry.at - now;
      if (delta <= PRE_BUFFER_MS && delta >= -COYOTE_MS) {
        entry.consumed = true;
        return true;
      }
    }
    return false;
  }

  clear(): void {
    this.entries.length = 0;
  }
}
