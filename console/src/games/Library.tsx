import { useEffect, useState } from 'react';
import { loadRegistry, type GameEntry } from './registry.js';

export interface LibraryProps {
  /**
   * Whether the player is currently visible. This only softens the label — it
   * never blocks launching. Gating the library on tracking would put a
   * flickering condition in front of the one button that matters, and the game
   * already handles losing sight of you mid-run by coaching rather than dying.
   */
  seen: boolean;
  onLaunch(entry: GameEntry): void;
}

/**
 * The cartridge library, read from `games.json` at runtime.
 *
 * Adding a game is a JSON entry and a cover image — no code here changes. That
 * is the whole plug-and-play claim, so keep it true: nothing in this file may
 * special-case a specific game.
 */
export function Library({ seen, onLaunch }: LibraryProps): React.JSX.Element {
  const [entries, setEntries] = useState<GameEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    loadRegistry(controller.signal)
      .then(setEntries)
      .catch((cause: unknown) => {
        if (controller.signal.aborted) return;
        setError(cause instanceof Error ? cause.message : 'Could not read the game library.');
      });
    return () => controller.abort();
  }, []);

  if (error) {
    return (
      <section className="library">
        <h2>Games</h2>
        <p className="notice error">{error}</p>
      </section>
    );
  }

  if (!entries) {
    return (
      <section className="library">
        <h2>Games</h2>
        <p className="hint">Reading the library…</p>
      </section>
    );
  }

  if (entries.length === 0) {
    return (
      <section className="library">
        <h2>Games</h2>
        <p className="hint">
          No cartridges registered. Add one to <code>public/games.json</code> — see{' '}
          <code>docs/BUILDING-A-GAME.md</code>.
        </p>
      </section>
    );
  }

  return (
    <section className="library">
      <h2>Games</h2>
      <ul className="library__grid">
        {entries.map((entry) => (
          <li key={entry.id} className="library__card">
            <img src={entry.cover} alt="" className="library__cover" />
            <div className="library__meta">
              <strong>{entry.title}</strong>
              {entry.tagline && <span>{entry.tagline}</span>}
              {entry.estimatedMinutes && <span className="hint">~{entry.estimatedMinutes} min</span>}
            </div>
            <button type="button" onClick={() => onLaunch(entry)}>
              {seen ? 'Play' : 'Play anyway'}
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}
