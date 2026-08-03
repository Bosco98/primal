# PRIMAL platform architecture — adopting the Opn-gamedeck model

A study of [Bosco98/Opn-gamedeck](https://github.com/Bosco98/Opn-gamedeck) and what
PRIMAL should take from it.

**Headline:** PRIMAL already has the architecture. What it doesn't have is the
*distribution* — the parts that make a third party able to actually build and ship a
game. Opn-gamedeck's protocol is weaker than PRIMAL's; its plumbing is far stronger.
Copy the plumbing, keep the protocol.

---

## 1. How Opn-gamedeck works

### Repo layout

```
Opn-gamedeck/                       ← ONE repo
├── sdk/                            @bosco98/opencontrol-sdk → GitHub Packages
├── console/                        the deck shell (React + Vite)
│   └── public/games.json           the registry: which cartridges exist
├── docs/BUILDING-A-GAME.md         the third-party workflow
├── .claude/skills/opencontrol-game/   scaffolds a whole new game repo
└── .github/workflows/
    ├── publish-sdk.yml             on push to sdk/** → publish
    └── pages.yml                   deploy the console

Bosco98/game-platformer  ← separate repo, own Pages, own deploy
Bosco98/game-racing      ← separate repo
Bosco98/game-fighter     ← separate repo
```

**SDK and console live together; games live apart.** That split is the whole design.
The SDK and console are two halves of one contract and must version together — the
console depends on the SDK via `file:../sdk`, so a local SDK change is instantly live
in the console with no publish step. Games are downstream consumers on a published
version, and they must be able to move independently.

### The bridge — the best idea in the repo

A game calls `OpenControl.host()`. That's it. There is no console-mode branch anywhere
in the game's code.

```ts
const adapter = options.adapter
  ?? (isConsoleEmbedded() ? new ConsoleBridgeAdapter() : new PeerJSAdapter());
```

`isConsoleEmbedded()` is just `window.parent !== window && searchParams.get("oc") === "console"`.
The console appends `?oc=console` when it iframes the game; the SDK silently swaps its
WebRTC transport for a postMessage bridge to the parent. The console then opens one
`MessageChannel` per connected phone and speaks the *normal wire protocol* over it as a
synthetic controller. The game cannot tell a bridged phone from a real one.

Result: **one game binary runs standalone (phones connect over WebRTC) and as a
cartridge (phones come from the deck), with zero conditional code.**

### Both ends of the bridge live in the SDK

[`sdk/src/networking/console-bridge.ts`](https://github.com/Bosco98/Opn-gamedeck/blob/main/sdk/src/networking/console-bridge.ts)
exports `ConsoleBridgeAdapter` (game side) *and* `connectToBridgedGame()` (console
side), with this comment:

> Both ends live in this file on purpose: a remote game bundles its own copy of the
> SDK, and the postMessage protocol below is the compatibility contract between that
> copy and the console's.

That is the single most important structural decision in the repo, and §3 below is why
PRIMAL needs to copy it specifically.

The handshake is small and worth knowing:

```
game → console   host-ready   (posted to "*", retried every 500ms until acked)
console → game   host-ack     (game pins the console's origin from this)
console → game   connect      + a transferred MessagePort, one per phone
game → console   host-closed
```

Origin handling is asymmetric and deliberate: the game posts `host-ready` to `"*"`
because it carries nothing sensitive, then pins whatever origin acked it. The console
validates against the origin from the registry entry, so it will only talk to the game
it meant to launch.

### The registry — adding a game is a JSON entry

[`console/public/games.json`](https://github.com/Bosco98/Opn-gamedeck/blob/main/console/public/games.json):

```json
{ "id": "racing", "title": "Tilt Grand Prix", "tagline": "Your phone is the wheel",
  "cover": "covers/racing.svg", "url": "https://bosco98.github.io/game-racing/",
  "profile": "tilt", "maxPlayers": 8 }
```

Fetched at runtime, parsed defensively (malformed entries are warned about and
skipped, never fatal), and resolved to absolute URLs plus an origin for bridge
validation. Relative URLs resolve against the console's own origin, so a game can be
served locally during development by changing one string.

**Adding a cartridge requires no console code change.** That is the plug-and-play claim,
and it is true.

### Profiles — the versioned input contract

A profile is `{ id, version, render? }`: a typed event map plus an optional built-in
touch UI, held in a `Map` with `registerProfile()` / `getProfile()`. Games depend on
the *contract*; the UI is an implementation detail free to change. The registry entry
declares which profile a game hosts with, and a mismatch rejects the player with
`profile-mismatch` rather than failing mysteriously.

`classic`, `arcade`, `tilt`, `menu` ship built in. `menu` is the deck's own controller —
the console eats its own dog food, which is why the extension point is real.

### Distribution

- **tsup dual build**: ESM (`dist/index.js`, peerjs external) for npm consumers, plus a
  minified IIFE (`dist/opencontrol.js`, everything bundled) exposing `window.OpenControl`
  for `<script>`-tag games with no build step at all.
- **CI publishes on any `sdk/**` push**, skipping if that version already exists — so
  releasing is just bumping `package.json`.
- Every game deploys to its own GitHub Pages.
- `player.send()` types starting with `oc:` are **reserved** for deck↔phone control
  traffic and stripped by the relay in both directions, so a hostile or careless remote
  game cannot spoof console messages.

### The docs are part of the product

`docs/BUILDING-A-GAME.md` is a workflow, not a feature list — choose an SDK consumption
style, pick a profile, write two pages, deploy, register, test. It states the rules that
make a game feel right ("fill the viewport", "no lobby gate — start on first join",
"handle mid-game joins") as *rules*, with the reasoning attached.

And `.claude/skills/opencontrol-game/SKILL.md` automates the whole sequence: scaffold,
implement, verify, create the repo, enable Pages, register the cartridge, check the
deploys. That is what makes "add a game" a 20-minute operation instead of an afternoon.

---

## 2. What PRIMAL already has

Do not rebuild these. Several are better than the Opn-gamedeck equivalent.

| Capability | Opn-gamedeck | PRIMAL | Verdict |
|---|---|---|---|
| Games in iframes, postMessage → MessagePort | ✅ | ✅ [`client.ts`](../primal-sdk/src/client.ts) | Same design |
| Versioned protocol, negotiated at handshake | implicit `v: 1` | ✅ explicit, with written compat rules | **PRIMAL better** |
| Envelope metadata | none | ✅ `ts`, `seq`, clock offset, latency EMA | **PRIMAL better** |
| Typed message maps | partial | ✅ full `ConsoleToGamePayloads` / `GameToConsolePayloads` | **PRIMAL better** |
| Unknown message types ignored | ✅ | ✅ | Same |
| Narrow subscription (only pay for what you use) | n/a | ✅ `config/subscribe` | PRIMAL-specific, good |
| Develop with no hardware | `MemoryAdapter` | ✅ [`FakeConsole`](../primal-sdk/src/testing/fake-console.ts) + `bindKeyboard()` | **PRIMAL much better** |
| Game manifest | `games.json` entry | ✅ `GameManifest` type | Different models — see §3.3 |
| Tests | none | ✅ 25 SDK + 39 console | **PRIMAL better** |

`FakeConsole.bindKeyboard()` in particular is exactly the `mockDriver.js` that
[`dodge-collect.md`](game-plans/dodge-collect.md) §12 calls "the most important file in
the repo" — and it already exists, in the SDK, for every game. Opn-gamedeck has no
equivalent.

**The protocol work is done and it is good. The gap is everything around it.**

---

## 3. The gaps

Verified against the current tree, in priority order.

### 3.1 The console side of the handshake doesn't exist — and belongs in the SDK

`primal-sdk` ships `PrimalClient` (game side) and `FakeConsole` (test side). There is no
console side. When `primal-console` builds its game host, it will hand-roll a second
implementation of the handshake, and the two will drift — a game bundling SDK 0.1.0
talking to a console that reimplemented 0.2.0's assumptions is exactly the failure
Opn-gamedeck's comment is guarding against.

**Fix:** promote the handshake host into the SDK as `PrimalHost` (`src/host/`), exporting
something like:

```ts
const host = PrimalHost.attach(iframe, { origin: entry.origin });
await host.ready;
host.emit('input/gesture', { gesture: 'jump', state: 'start', confidence: 0.9 });
host.on('workout/summary', (s) => profile.record(s));
```

`FakeConsole` then becomes a thin subclass that adds `bindKeyboard()` and the
`rep()`/`gesture()` conveniences. Today `FakeConsole` *is* 90% of a working console
host — it accepts the hello, mints the MessageChannel, sends the welcome, and validates
inbound messages. That code is sitting in `src/testing/`, which means the real console
would either import test code or copy it. Neither is right.

This is the highest-value change and it unblocks the console's game host.

### 3.2 A standalone game waits 10 seconds before it can start

`PrimalClient.connect()` posts hello at `window.parent` and rejects on a 10s timeout.
Run a game on its own dev server and nothing happens for ten seconds. Opn-gamedeck
answers the same question instantly and deterministically with `isConsoleEmbedded()`.

**Fix:** adopt the `?primal=console` marker. Export `isConsoleEmbedded()`, and let games
do:

```ts
if (!isConsoleEmbedded()) FakeConsole.attach().bindKeyboard();
const primal = await PrimalClient.connect({ gameId: 'dodge-collect' });
```

Zero branches in the game logic — the fake answers the same handshake — and it starts
immediately either way.

### 3.3 There is no registry, and two half-designed models

The protocol defines `GameManifest`, served by each game at `/primal.manifest.json` — a
**pull** model. Opn-gamedeck uses a console-owned `games.json` — a **push** model. PRIMAL
has neither implemented, and the pull model alone is insufficient: the console still
needs a list of URLs to pull *from*.

**Fix — use both, with clear ownership:**

- `console/public/games.json` is the **library**: which games this console offers.
  Minimal entry — `{ id, url, cover }`. Owned by the console.
- `primal.manifest.json` is the **contract**: what the game needs — `channels`,
  `exercises`, `estimatedMinutes`, `protocolVersions`. Owned by the game, fetched at
  launch, and used to warn the player up front ("needs squats, ~15 min") and to reject
  on protocol mismatch *before* the iframe loads.

That is strictly better than Opn-gamedeck's single JSON, because a game's input
requirements can change without the console shipping an update — and PRIMAL already
designed the type for it.

Also copy the defensive parsing from [`registry.ts`](https://github.com/Bosco98/Opn-gamedeck/blob/main/console/src/registry.ts):
one malformed entry warns and is skipped, never takes down the library.

### 3.4 The SDK cannot actually be installed

`@primal/sdk` has no `publishConfig`, no CI, no `dist` on any registry, and the `@primal`
npm scope isn't yours. A third-party developer today cannot get this package.

**Fix:**
- Rename to `@bosco98/primal-sdk` (GitHub Packages requires the scope to match the owner).
- Add `publishConfig.registry` and copy `publish-sdk.yml` verbatim — including the
  "skip if this version is already published" guard, which makes releasing a one-line
  version bump.
- Add a tsup IIFE build alongside the existing `tsc` ESM output, exposing `window.Primal`.
  A `<script src="primal.js">` game with no build step is the fastest possible path to a
  playable prototype, and it is how the first version of dodge-collect should be built.

### 3.5 No repos, no remotes, no CI

None of the five PRIMAL folders has a git remote configured, and there are no workflow
files anywhere in the tree. The README's "independent git repositories" is currently
aspirational.

**Fix — collapse to the Opn-gamedeck shape:**

```
primal/                     ← one repo: sdk + console + docs + registry
├── sdk/                    @bosco98/primal-sdk
├── console/                shell, pose pipeline, launcher, game host
│   └── public/games.json
├── docs/                   ← primal-docs moves here
└── .github/workflows/      publish-sdk.yml, pages.yml

primal-game-dodge-collect/  ← own repo, own Pages
primal-game-rep-battle/     ← own repo, own Pages
```

`primal-sdk` and `primal-console` are two halves of one contract; splitting them buys
nothing and costs a publish cycle on every protocol change. Docs belong with the code
they describe. Games stay separate because they genuinely are independent.

### 3.6 Origin validation is unimplemented on both sides

`ConnectOptions.consoleOrigin` defaults to `'*'`, and there is no console side to
validate the game's origin at all. Once games are hosted on their own origins this is a
real hole: any page that can get itself iframed could answer a hello.

**Fix:** copy the asymmetric pattern exactly — game posts hello to `'*'`, pins the origin
that answers; console validates `event.origin` against the registry entry's origin
before answering.

### 3.7 No reserved namespace

Opn-gamedeck reserves the `oc:` prefix and strips it in both directions. PRIMAL's
vocabulary is closed (fixed message types), so the exposure is smaller — but the moment
a `game/custom` or free-form channel is added, the same guard is needed. Worth reserving
`primal/` now while it costs nothing.

### 3.8 No BUILDING-A-GAME.md, no scaffolding skill

[`dodge-collect.md`](game-plans/dodge-collect.md) §12 plans for the game repo to *become*
the template by being readable. Opn-gamedeck does better: a separate workflow doc plus a
Claude skill that creates the repo, wires the deploy, and registers the cartridge. Both
are cheap and both should be copied — the doc after the first game exists, the skill
after the second.

---

## 4. Migration plan

Ordered so each step unblocks the next. Steps 1–4 are prerequisites for building
dodge-collect properly; 5–8 are what make it a platform.

| # | Step | Why now |
|---|---|---|
| 1 | Merge `primal-sdk` + `primal-console` + `primal-docs` into one `primal` repo; create the GitHub repo and push | Everything else assumes this shape |
| 2 | Add `isConsoleEmbedded()` + the `?primal=console` marker | 3 lines, removes the 10s standalone stall, unblocks fast iteration |
| 3 | Extract `PrimalHost` from `FakeConsole` into `sdk/src/host/`; `FakeConsole extends PrimalHost` | One handshake implementation. Blocks the console's game host |
| 4 | Build the console's game host on `PrimalHost` — iframe, launch, teardown, origin validation | The console can finally run a game |
| 5 | `games.json` + defensive registry loader + manifest fetch at launch | Adding a game becomes a JSON entry |
| 6 | Rename to `@bosco98/primal-sdk`, add tsup IIFE build, add `publish-sdk.yml` | Third parties can install it; `<script>` games become possible |
| 7 | `primal-game-dodge-collect` as its own repo + Pages + `pages.yml` | First real cartridge, end to end |
| 8 | `docs/BUILDING-A-GAME.md`, then `.claude/skills/primal-game/SKILL.md` | Adding game #3 becomes routine |

Steps 2 and 3 are small and high-leverage — do them before writing any dodge-collect
code, because both change how `main.js` boots.

---

## 5. What NOT to copy

- **The protocol shape.** PRIMAL's is stricter and better documented. OpenControl's
  untyped `{ t, event, data }` frames are a step backwards from typed payload maps.
- **`file:../sdk` for games.** Correct for the console (same repo, versions together),
  wrong for games (they must build against a published version, or "works on my machine"
  becomes the default failure).
- **Vendoring the IIFE bundle into game repos.** Opn-gamedeck's platformer does this to
  dodge the GitHub Packages PAT requirement. It works, but a game shipping a stale copy
  of the SDK is a debugging trap. Prefer a `<script src>` pointing at the console's own
  origin, or accept the PAT.
- **No tests.** The Opn-gamedeck skill locks in "no tests — the user tests on real
  phones." PRIMAL's recognisers are validated by 39 synthetic tests, and that is the
  only reason a rep counter can be trusted without a human in the loop. Keep them.
