# Building a game for PRIMAL

How to build a body-controlled web game with `@bosco98/primal-sdk` and ship it as
a cartridge the console can launch. The API reference is
[`sdk/README.md`](../sdk/README.md); this is the workflow.

The reference cartridge is
[primal-game-dodge-collect](https://github.com/Bosco98/primal-game-dodge-collect).
Clone it rather than starting from nothing.

A finished game is **one static web page**. Unlike a phone-controller platform
there is no second page to write: the console owns the camera and the player,
and your game only receives messages.

---

## 1. Choose how to consume the SDK

**No build step** — copy `primal.js` (the IIFE bundle from the SDK's `dist/`)
into your repo:

```html
<script src="vendor/primal.js"></script>   <!-- sets window.Primal -->
```

11kb, zero dependencies, no npm auth. This is how the reference cartridge does
it, and it is the fastest path to something playable.

**npm (ESM + TypeScript types)** — the package is on GitHub Packages, which
needs auth even though it is public:

```bash
# .npmrc in the project:
#   @bosco98:registry=https://npm.pkg.github.com
# ~/.npmrc on your machine (a PAT with read:packages):
#   //npm.pkg.github.com/:_authToken=YOUR_TOKEN
npm install @bosco98/primal-sdk
```

If you use a bundler, set a **relative base** (Vite: `base: './'`) so one build
works at `/`, under `/<repo>/` on Pages, and inside the console. Absolute asset
URLs are the most common way a working local build comes out broken on Pages.

---

## 2. Boot

```js
const { PrimalClient, FakeConsole, isConsoleEmbedded } = window.Primal;

// Standalone? Nobody is going to answer the handshake, so answer it yourself.
if (!isConsoleEmbedded()) FakeConsole.attach().bindKeyboard();

const primal = await PrimalClient.connect({ gameId: 'my-game' });
```

**There is no branch after this line.** The fake console speaks the identical
protocol the real one does, so the game takes one path either way. That is the
whole trick, and it is what makes the game developable at a desk.

`isConsoleEmbedded()` checks for `?primal=console` (which the console appends
when it iframes you) plus an actual iframe. It is synchronous, so a standalone
game starts immediately instead of sitting through a 10-second connect timeout.

---

## 3. Subscribe narrowly

```js
primal.subscribe({
  channels: ['gesture', 'body', 'intensity'],
  exercises: [],        // no rep recognition needed at all
  bodyRateHz: 30,       // console clamps to 1..60
});
```

This is not hygiene — the console **skips recognisers nobody is listening to**,
and MediaPipe already owns the GPU. `exercises: []` turns off rep classification
entirely. Ask for what you use and nothing else.

| Channel | You get | Rate |
|---|---|---|
| `gesture` | `jump`, `crouch`, `lean_left/right`, `punch_left/right`, `block` — edge-triggered `start`/`end` with a confidence | as they happen |
| `body` | hands, bodyCenter, head, lean, crouch — mirrored and baseline-normalised | `bodyRateHz` |
| `intensity` | `instant` and `avg10s` effort, 0..1 | ~5Hz |
| `rep` | counted reps with `formScore`, `flags`, `durationMs` | per rep |
| `rep_progress` | live in-rep phase and depth | continuous |

---

## 4. The rules that make a game feel right

These are not style preferences. Each one is a bug that will otherwise find you.

**Fill the viewport.** `position: fixed; inset: 0`, no page scroll. The console
shows you in a fullscreen iframe.

**Resolve input on `message.ts`, not arrival time.** Every envelope carries the
console's clock, and `primal.toConsoleClock()` converts yours to match. The
pipeline is 140–200ms end to end and nothing you write will fix that — but
resolving against *when the console observed the movement* removes the jitter,
and jitter is what players perceive as unresponsive.

```js
primal.on('input/gesture', (g, message) => {
  if (g.state !== 'start') return;
  queue.push(map(g.gesture), message.ts, g.confidence);   // not performance.now()
});
```

**Never mutate simulation state from a message handler.** Handlers fire between
simulation steps. Push into a queue; consume it from a fixed-timestep loop.

**Give every required movement ≥1.1s of telegraph**, and make every timing
window ≥±180ms. A human needs ~250ms to read a symbol and ~350ms to complete a
jump, on top of the pipeline. Assert the floor in code rather than trusting it.

**`lean_*` and `crouch` are *held* gestures, with hysteresis.** Lean and stay
leaning and you get exactly one `start`. If you need a two-step move in one
motion, drive it from `body.lean` and use the gesture only to start the
animation early. See `src/input/lanes.js` in the reference cartridge.

**Dual-path anything critical.** Subscribe to both `gesture: crouch` and
`body.crouch`, act on whichever arrives first, then latch ~400ms. The gesture is
lower latency; the continuous value is the safety net. Without the latch, a
30Hz body stream turns one duck into fifteen.

**Degrade, don't die.** On `tracking/status` going bad, freeze spawning and
coach the specific fix — never end the run. Treat `low_light` and
`multiple_people` as non-blocking, or the game is unplayable in a room with
another person in it.

**Honour `session/pause` within one frame**, drop queued input rather than
buffering it, and keep repainting a static frame. A canvas that stops painting
looks like a crash.

**Be honest in `workout/summary`.** `reps` is keyed by `ExerciseId` —
squat/pushup/jumping_jack/lunge. If your movements aren't those, send `{}`.
`activeSeconds` must exclude paused and untracked time. And the score you report
must be **dominated by physical work done**, never by loot:

```js
score: Math.round((jumps*3 + crouches*3 + laneChanges*1 + reaches*0.5)
                  * (0.6 + 0.8 * avgIntensity))
```

Show a flashier number on screen if you like. The console-facing one tracks the
workout, because a cross-game leaderboard that rewarded farming over moving
would quietly teach players to move less.

**Partial workouts count.** Quitting mid-session still sends a full summary.

---

## 5. Develop without a camera

`FakeConsole` is the whole reason this is pleasant. It is a `PrimalHost`
subclass, so it drives your game through the real protocol:

```
S / J / L / P   squat, jumping jack, lunge, push-up rep
A / D           hold to lean
W or Space      jump
C               hold to crouch
Q / E           punch      B  hold to block
mouse           moves your hands
```

It is also how you write tests:

```js
const fake = FakeConsole.attach();
const primal = await PrimalClient.connect({ gameId: 'test' });
fake.rep('squat', { formScore: 0.9 });
expect(fake.summary?.reps.squat).toBe(1);
```

---

## 6. Ship it

Serve the manifest at `/primal.manifest.json` — the console fetches it at launch
to warn the player what the game needs before loading it:

```json
{
  "id": "my-game",
  "name": "My Game",
  "version": "0.1.0",
  "protocolVersions": [1],
  "channels": ["gesture", "body"],
  "exercises": [],
  "estimatedMinutes": 12
}
```

Push to a public repo and enable Pages (branch `main`, root):

```bash
gh repo create Bosco98/my-game --public --source=. --remote=origin
git push -u origin main
gh api repos/Bosco98/my-game/pages -X POST -f 'source[branch]=main' -f 'source[path]=/'
```

Then register the cartridge in
[`console/public/games.json`](../console/public/games.json):

```json
{ "id": "my-game", "title": "My Game", "tagline": "One line of flavour",
  "cover": "covers/my-game.svg", "url": "https://bosco98.github.io/my-game/",
  "estimatedMinutes": 12 }
```

Add a 320×200 SVG cover under `console/public/covers/`. **No console code
changes** — the registry is read at runtime, and the console derives the
handshake origin from that URL and refuses to talk to anything else.

`url` may be relative (`my-game/`) for a cartridge served from the console's own
origin during development.

Two constraints worth knowing up front:

- **HTTPS only.** An HTTPS console cannot embed an HTTP game (mixed content).
- **`id` must match** what you pass to `PrimalClient.connect({ gameId })`. The
  console rejects a mismatch with `unknown_game` rather than connecting to the
  wrong thing.

---

## 7. Test checklist

1. **Standalone:** open the page directly. It should be interactive
   *immediately* — if there is a pause before anything happens,
   `isConsoleEmbedded()` is not wired up.
2. **Locally in the console:** point the registry entry at a relative URL, run
   the console, launch from the library.
3. **Deployed:** same flow against the deployed console and the game's Pages URL.
4. **Pause:** switch tabs mid-run; it must freeze and resume cleanly with no
   burst of stale input.
5. **Tracking loss:** step out of frame; it must coach, not end the run.
