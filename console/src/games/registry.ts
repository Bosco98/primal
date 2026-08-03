import type { GameManifest, InputChannel } from '@bosco98/primal-sdk';

/**
 * The game registry: which cartridges this console can launch.
 *
 * Two files, two owners, on purpose:
 *
 *  - `games.json` (this console's) is the **library** — which games exist and
 *    where they live. Adding a game is a JSON entry and a cover; no console
 *    code changes.
 *  - `primal.manifest.json` (each game's) is the **contract** — what the game
 *    needs: channels, exercises, session length, protocol versions. Owned by
 *    the game, fetched at launch, so a game can change what it asks for
 *    without this console shipping an update.
 *
 * A malformed entry is skipped with a warning, never fatal: one bad cartridge
 * must not empty the whole library.
 */

export interface GameEntry {
  id: string;
  title: string;
  tagline?: string;
  /** Resolved absolute cover image URL. */
  cover: string;
  /** Resolved absolute game URL, without the console marker. */
  url: URL;
  /** Origin the handshake must come from. Derived from `url`; not configurable. */
  origin: string;
  /** Optional hints for the library card, before the manifest is fetched. */
  estimatedMinutes?: number;
}

/** A launched game's own declaration of what it needs. */
export interface GameRequirements {
  channels: InputChannel[];
  exercises: string[];
  estimatedMinutes?: number;
  protocolVersions: number[];
}

interface RawEntry {
  id?: unknown;
  title?: unknown;
  tagline?: unknown;
  cover?: unknown;
  url?: unknown;
  estimatedMinutes?: unknown;
}

export async function loadRegistry(signal?: AbortSignal): Promise<GameEntry[]> {
  const response = await fetch(new URL('games.json', document.baseURI), { signal });
  if (!response.ok) throw new Error(`games.json: HTTP ${response.status}`);
  const body = (await response.json()) as { games?: unknown };
  const raw = Array.isArray(body.games) ? (body.games as RawEntry[]) : [];
  return raw.flatMap((entry) => {
    const parsed = parseEntry(entry);
    if (!parsed) console.warn('[primal] games.json: skipping malformed entry', entry);
    return parsed ? [parsed] : [];
  });
}

function parseEntry(raw: RawEntry): GameEntry | null {
  if (typeof raw.id !== 'string' || typeof raw.title !== 'string' || typeof raw.url !== 'string') {
    return null;
  }
  try {
    // Relative URLs resolve against the console, so a locally served cartridge
    // is just "dodge-collect/" during development.
    const url = new URL(raw.url, document.baseURI);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return {
      id: raw.id,
      title: raw.title,
      tagline: typeof raw.tagline === 'string' ? raw.tagline : undefined,
      cover: new URL(typeof raw.cover === 'string' ? raw.cover : '', document.baseURI).toString(),
      url,
      origin: url.origin,
      estimatedMinutes:
        typeof raw.estimatedMinutes === 'number' ? raw.estimatedMinutes : undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Fetch a game's manifest so the console can warn about what it needs *before*
 * loading it. Returns null when the game doesn't serve one — that is allowed,
 * and the console falls back to subscribing to whatever the game asks for at
 * runtime. A cross-origin game needs permissive CORS on this file; failing to
 * read it must not block the launch.
 */
export async function fetchRequirements(
  entry: GameEntry,
  signal?: AbortSignal,
): Promise<GameRequirements | null> {
  try {
    const url = new URL('primal.manifest.json', entry.url);
    const response = await fetch(url, { signal, mode: 'cors' });
    if (!response.ok) return null;
    const manifest = (await response.json()) as Partial<GameManifest>;
    if (manifest.id !== entry.id) {
      console.warn(
        `[primal] ${entry.id}: manifest declares id "${manifest.id}"; registry says "${entry.id}"`,
      );
    }
    return {
      channels: Array.isArray(manifest.channels) ? manifest.channels : [],
      exercises: Array.isArray(manifest.exercises) ? manifest.exercises : [],
      estimatedMinutes:
        typeof manifest.estimatedMinutes === 'number' ? manifest.estimatedMinutes : undefined,
      protocolVersions: Array.isArray(manifest.protocolVersions) ? manifest.protocolVersions : [1],
    };
  } catch {
    return null; // No manifest, unreachable, or blocked by CORS. Not fatal.
  }
}
