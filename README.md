# PRIMAL

A fitness game console where your body is the controller. A webcam plus pose
detection turns real movement into game input — the point of the platform is to
get you to actually work out; the games are how it gets you to.

**Live console:** https://bosco98.github.io/primal/ — open it on a laptop, allow
the camera, stand back far enough that your whole body is in frame.

Camera frames never leave the machine. Games never get camera access at all;
they receive derived pose messages over a `MessagePort`.

## Layout

The SDK and the console are two halves of one contract, so they live together
and version together. Games are downstream consumers and live apart.

| Path | What it is |
|---|---|
| [`sdk/`](sdk/) | `@bosco98/primal-sdk` — the wire protocol, `PrimalClient` (game side), `PrimalHost` (console side), and `FakeConsole` for developing without a camera. Published to GitHub Packages on every `sdk/**` push. |
| [`console/`](console/) | Camera, MediaPipe pose pipeline, recognisers, calibration, the game library and the game host. |
| [`docs/`](docs/) | Protocol notes, the platform architecture, game design plans, and the post-MVP roadmap. |
| [`console/public/games.json`](console/public/games.json) | The registry: which cartridges this console can launch. |

Games are their own repositories with their own GitHub Pages deployments:

| Repo | What it is |
|---|---|
| [primal-game-dodge-collect](https://github.com/Bosco98/primal-game-dodge-collect) | *Dodge & Collect* — lean, duck, jump and reach. Also the reference cartridge. |

## Run it locally

Needs Node 24.

```bash
cd sdk && npm install && npm run build     # console consumes this via file:../sdk
cd ../console && npm install && npm run dev   # http://localhost:5173
```

Stand back, hold still for two seconds while it calibrates, then do some squats.
The right-hand panel shows live rep count, form score, gesture states and the
pipeline's frame rate. Registered games appear under **Games**.

## How a game connects

A game is a static web page that runs standalone *and* as a cartridge, with no
branch in its own logic:

```ts
import { PrimalClient, FakeConsole, isConsoleEmbedded } from '@bosco98/primal-sdk';

// Standalone? Nobody will answer the handshake, so answer it yourself.
if (!isConsoleEmbedded()) FakeConsole.attach().bindKeyboard();

const primal = await PrimalClient.connect({ gameId: 'dodge-collect' });
primal.subscribe({ channels: ['gesture', 'body'], exercises: [], bodyRateHz: 30 });
primal.on('input/gesture', (g) => { if (g.gesture === 'jump') jump(); });
```

The console appends `?primal=console` when it iframes a game. `isConsoleEmbedded()`
reads that synchronously, so a standalone game starts immediately instead of
sitting through a connection timeout.

Both halves of the handshake live in the SDK on purpose — a game bundles its own
copy of it, so `sdk/src/host/primal-host.ts` *is* the compatibility contract
between that copy and the console's. Full walkthrough:
[`docs/BUILDING-A-GAME.md`](docs/BUILDING-A-GAME.md).

## Adding a game to the console

Build it, host it over HTTPS, then add an entry to
[`console/public/games.json`](console/public/games.json):

```json
{ "id": "my-game", "title": "My Game", "cover": "covers/my-game.svg",
  "url": "https://bosco98.github.io/my-game/" }
```

No console code changes. The console derives the handshake origin from that URL
and refuses to talk to anything else.

## Where things stand

Built and tested:

- The pose pipeline: camera, MediaPipe pose landmarker with GPU/CPU fallback,
  and a swappable `PoseSource` so recorded fixtures can drive the whole stack.
- A shared recogniser skeleton — every exercise is a small declarative
  definition over one normalised "how far through the movement are you" signal.
  See [adding an exercise](docs/adding-an-exercise.md).
- Four exercises on top of it: **squat** (validated against a real camera),
  **jumping jack**, and **lunge** and **push-up** marked beta for stated reasons.
- Gestures (lean, crouch, jump, block, punch), body-as-cursor, and effort.
- The full wire protocol, both halves of the SDK, the game registry and the
  game host.

Not built yet: the games themselves.

## Tests

```bash
cd sdk && npm test          # protocol, handshake, host
cd console && npm test      # recognisers, against synthetic fixtures
cd console && npx playwright test    # real browser, fake camera
```

The console's unit tests need no webcam and no human: `test/synthetic.ts` poses a
synthetic body by inverse kinematics, so a set of squats at an exact depth and
tempo is just a function call.
