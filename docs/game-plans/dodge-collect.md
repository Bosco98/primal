# Dodge & Collect — Build Plan (Launch Game 2, built FIRST)

**Status:** BUILD. First game implemented. Also the **reference/template repo** third-party developers clone.
**Repo:** `primal-game-dodge-collect`
**API surface proved:** continuous `input/body` (30Hz), low-latency `input/gesture`, `tracking/status` degradation, `session/pause` mid-run.
**Workout type:** cardio (HIIT-shaped).
**Session length:** 2:30–3:00 per run; a natural sitting is 3–5 runs with 60–90s between = 12–18 min.

---

## 1. Why this game is built first

Three reasons, in order:

1. **It is the fastest path to "the platform works."** It exercises the two hardest parts of the input protocol — a 30Hz continuous stream and edge-triggered low-latency gestures — without needing a rep recognizer to be perfect. If the console can drive this game at a playable feel, the console is real.
2. **It is the easiest game to make fun on day one.** Endless runners are a solved genre. The novelty is entirely in the input.
3. **It is the best teaching artifact.** A third-party developer reading one repo should see: handshake, subscribe, an input handler for every channel type, a fixed-timestep simulation, pause handling, tracking-degradation handling, and a correct `workout/summary`. This game touches all of it. See §12.

---

## 2. Core loop

The player stands ~2m from the webcam. The camera sees them from the front. On screen they see a 3-lane track running away from the camera (fake-3D: 2D sprites scaled by depth, no actual 3D).

```
spawn obstacle at horizon
   -> obstacle scrolls toward player, growing
      -> player reads the obstacle's TYPE (colour + silhouette)
         -> player performs the matching PHYSICAL MOVEMENT
            -> hit or clear resolved at the "commit line"
               -> clear = +score, +combo; hit = -1 life, combo reset, 1.2s invuln
                  -> difficulty scalar ticks up
                     -> repeat until 3 lives lost or the 3:00 timer ends
```

Two things happen continuously underneath that loop:

- **Coins** spawn in arcs and lateral clusters. They are collected by the player's *hands*, tracked as two on-screen cursors driven by `input/body.hands`. Coins are never on the lane path — you have to *reach* for them. This is the mechanic that adds upper-body movement to a lower-body game.
- **Intensity** (`input/intensity.avg10s`) drives a "Burn" meter. Above 0.65 for 10s the player enters **Overdrive**: 2× coin value, faster scroll. Overdrive is the game's way of paying the player for actually working hard rather than doing minimum-effort twitches.

A run ends at 3:00 (a "clean finish", bonus awarded) or at 0 lives. Both end states are followed by the same summary screen. Losing is not punished with a longer path back in — retry is one gesture away (see §8).

---

## 3. Obstacle taxonomy

Every obstacle maps to exactly one physical movement. No obstacle is ambiguous. Colour-codes are consistent and learned in the first 20 seconds.

| # | Obstacle | Visual | Required movement | Input used | Detection |
|---|----------|--------|-------------------|------------|-----------|
| 1 | **Hurdle** | Low orange bar across the full track | Jump | `gesture: jump` (start) | Gesture fired within the commit window |
| 2 | **Low beam** | Blue beam at head height across the full track | Crouch / squat down | `gesture: crouch` start, OR `body.crouch > 0.55` | Either path (see note) |
| 3 | **Lane wall** | Grey slab filling 1 lane | Move to a free lane | `gesture: lean_left/right` for the discrete hop; `body.lean` for validation | Player lane at commit line |
| 4 | **Double wall** | Grey slabs filling 2 lanes | Move to the single free lane (possibly 2 lanes over) | as above | as above |
| 5 | **Beam + wall** | Blue beam over a 1-lane slab | Lane change, then crouch, within ~0.9s | both | sequential windows |
| 6 | **Hurdle gauntlet** | 3 hurdles spaced 0.75s apart | 3 jumps in a row | `gesture: jump` ×3 | per-hurdle windows |
| 7 | **Coin arc (high)** | Gold coins in an arc above head height | Reach a hand up | `body.hands[*]` | AABB overlap of hand cursor |
| 8 | **Coin spur (lateral)** | Coins off the side of the track at shoulder height | Reach a hand sideways | `body.hands[*]` | AABB overlap |
| 9 | **Coin sweep (low)** | Coins at knee height | Reach down (usually caught mid-squat) | `body.hands[*]` | AABB overlap |

**Note on beams (#2):** subscribe to both `gesture: crouch` and `body.crouch`. Fire on whichever arrives first, then latch for 400ms so a single duck can't double-count. The gesture is lower latency; the continuous value is the safety net when the gesture FSM misses. This dual-path pattern is the single most useful thing a third-party dev can copy from this repo.

**Deliberately excluded:** no obstacle requires `pushup`. No obstacle requires a full `input/rep` event. This game never touches the rep recognizer — that is `rep-battle`'s job.

### Movement budget by type

Over a full 3:00 run at default difficulty:

| Movement | Count | Notes |
|----------|-------|-------|
| Jump | 30–38 | The main cardio driver |
| Crouch (squat-down) | 24–30 | Loads quads; this is the "strength-ish" part |
| Lane change (lean) | 28–34 | Cheap; core/oblique engagement, low cost |
| Hand reach | 45–60 | Upper-body movement, shoulder ROM |
| **Total scored movements** | **~130–160** | |

That is **~48 movements per minute**, of which ~22/min are jumps or squats — i.e. full-body, load-bearing. That is the intensity band we care about.

---

## 4. Difficulty ramp and the cardio argument

### 4.1 The ramp

Scroll speed is in *track units per second*; the track is 100 units from horizon to commit line.

| Phase | Time | Scroll speed | Obstacle interval | Coin density | What's new |
|-------|------|--------------|-------------------|--------------|-----------|
| Onboard | 0:00–0:20 | 40 u/s | 3.4 s | low | Types 1,2,3 only, one at a time, big telegraph |
| Build | 0:20–1:00 | 48 u/s | 2.6 s | med | Type 4 introduced; coin arcs start |
| Press | 1:00–1:45 | 56 u/s | 2.1 s | med-high | Type 5 introduced; lateral coin spurs |
| Squeeze | 1:45–2:30 | 64 u/s | 1.7 s | high | Type 6 introduced; two obstacles in flight |
| Finale | 2:30–3:00 | 72 u/s | 1.4 s | coin storm | All types, 3× coin value, no new mechanics |

Difficulty is a single scalar `D` in `[0,1]` driven by elapsed time, and everything above is a lerp on `D`. Do **not** make difficulty adaptive-downward on the first release — a runner that gets easier when you struggle teaches the player to struggle. Adaptive-*upward* is fine and is what the Overdrive mechanic already does.

### 4.2 Reaction-time budget — the constraint that sets scroll speed

End-to-end input latency (camera → MediaPipe → gesture FSM → postMessage → game logic → render → display) is realistically **140–200ms** on the target hardware. On top of that a human needs ~250ms to recognise a symbol and ~350ms to initiate and complete a jump.

So an obstacle must be **visible and legible for ≥ 1.1s** before it reaches the commit line, and the *commit window* must be generous:

```
telegraph_time  = spawn_distance / scroll_speed   >= 1.10 s   (hard floor)
commit_window   = ±180 ms around contact          (jump / crouch)
lane_window     = position sampled at contact, no timing window
```

At the Finale's 72 u/s, spawn distance must therefore be ≥ 80 units, and the track's visible depth is 100 units — fine. **If you ever raise scroll speed past ~85 u/s, obstacles become unreadable before they are undodgeable. Cap it there.**

The commit window is ±180ms, not ±80ms. This is not generosity for its own sake — it is compensating for a latency budget the console cannot fix. Build the window into the design instead of pretending the pipeline is faster than it is.

### 4.3 Why this is a real cardio workout

A 3-minute run with ~22 jumps+squats per minute plus continuous lateral movement and arm reaching is structurally a **HIIT interval**. For a moderately fit adult this should land in **75–88% of max HR** by the 1:30 mark and stay there. The Finale phase is deliberately shaped as a sprint finish — the last 30s is where the HR peak happens.

The between-run rest (60–90s, enforced by the summary screen and a "Ready?" gate — see §8) is the recovery interval. Three to five runs is a **12–18 minute HIIT session with a 1:2 work:rest ratio**, which is a defensible training stimulus, not a gimmick.

Deliberate design consequences of that framing:
- **Runs are never longer than 3:00.** Past 3 minutes of continuous jumping, form degrades, injury risk rises, and the player stops for the day instead of doing another run. Short runs with a clean restart produce more total volume.
- **The Finale is always the hardest 30s.** Ending on the peak is what makes the player feel they earned the rest.
- **Death before 1:30 auto-offers an immediate retry with no summary screen**, because a 45-second run is not a workout and the player should not be rewarded with rest for failing early.

---

## 5. The coin / hand-cursor mechanic

This is the part that is genuinely novel and worth getting right.

- Subscribe to `input/body` at **30Hz**. Do not ask for more; MediaPipe is already the GPU bottleneck and 30Hz is plenty for a cursor.
- `hands.left` / `hands.right` arrive as normalized `{x, y, visible}` in `[0,1]`, in **camera space**, which is mirrored relative to the player. Mirror `x` (`x' = 1 - x`) so that the player's right hand moves the cursor on the right of the screen. Getting this wrong makes the game feel broken and is the #1 bug a new dev will hit — call it out in the repo README.
- Map to screen with a **gain** so the player doesn't have to reach to the literal edge of the camera frame:
  ```
  screenX = clamp( 0.5 + (x' - bodyCenter.x) * GAIN_X, 0, 1 )
  screenY = clamp( 0.5 + (y  - head.y - 0.15) * GAIN_Y, 0, 1 )
  GAIN_X = 2.2, GAIN_Y = 2.0
  ```
  Anchoring to `bodyCenter`/`head` rather than to absolute frame coords means the cursor doesn't drift when the player steps sideways. **Body-relative, not frame-absolute** — this is the general rule for all continuous input on this platform.
- **Smoothing:** one-euro filter, `minCutoff = 1.2`, `beta = 0.02`. Coin collection is a big AABB, so we can afford smoothing lag; jitter looks worse than lag here.
- **Visibility:** when `visible === false`, fade the cursor to 30% alpha and *freeze it in place* rather than snapping it to a garbage position. Do not disable collection — a hand that dropped out for 100ms next to a coin should still get the coin.
- **Hitbox:** hand cursor is a 64px-radius circle; coins are 40px. Generous on purpose. Reaching is the exercise; pixel precision is not.
- **Coin value:** base 10. ×2 in Overdrive. ×3 in the Finale. A "sweep" (all coins in one arc collected) awards a +50 flourish. Sweeps are what make the player commit to a full arm extension instead of a lazy wave.

**Design rule:** coins are always placed where a *full-range-of-motion reach* is needed. Never place a coin within the resting silhouette of the player. If the player can get it without moving, it isn't a coin, it's decoration.

---

## 6. Scoring

```
runScore = distanceScore + coinScore + comboBonus + finishBonus

distanceScore = floor(metersTravelled) * 1
coinScore     = sum(coin values collected)
comboBonus    = for each obstacle cleared: 5 * min(combo, 20)
                combo increments per cleared obstacle, resets to 0 on any hit
finishBonus   = 500 if the 3:00 timer is reached with >=1 life
              + 250 if no obstacle was hit in the Finale phase
```

`workout/score` reported to the console is **not** `runScore`. See §11 — the console-facing score is effort-normalized so that a player who works hard and dies isn't ranked below a player who coasts.

On-screen the player sees `runScore` and their combo. Keep the combo counter huge and centre-top; it is the single strongest driver of "one more run".

---

## 7. Calibration dependency

`lean` is **baseline-relative**. The console establishes a neutral standing pose during calibration and reports `lean` as displacement from that baseline. The game inherits two problems from this:

1. **The baseline drifts.** Over a 3-minute run the player physically walks/shuffles. By 2:00 their neutral may be 15cm left of where it started, and they will be stuck in the left lane.
2. **The baseline may be wrong at start** if the player was mid-step during calibration.

Handling:

- **Trust gestures for lane changes, trust `body.lean` only for validation.** `gesture: lean_left` is edge-triggered and baseline-drift-immune in a way the raw value is not. Lane state is a game-side integer `-1|0|1` incremented by gesture events, *not* a direct mapping from `lean`.
- **Soft re-baseline during quiet moments.** Maintain a rolling 3s median of `bodyCenter.x` during any window with no obstacle in the commit zone. If the median deviates from the assumed centre by > 0.06 for 3 consecutive seconds, shift the assumed centre by 50% of the delta. Never re-baseline during an active obstacle.
- **Disagreement recovery.** If the game's lane state is `left` but `body.lean > +0.4` (player is bodily right) for 1.5s continuously, snap the lane state to match the body and play a small "recentre" whoosh. The body is always the ground truth; the state machine is the approximation.
- **On-screen ghost.** A faint outline of the neutral stance is drawn at the bottom-centre of the track. Players self-correct against it without being told to.
- **If calibration is missing entirely** (`tracking/status` never reported `personDetected`), do not start a run. Show the "step into frame" card and wait.

---

## 8. Tracking degradation and pause handling

### 8.1 `tracking/status`

```
personDetected: false                 -> SLIPSTREAM (see below)
quality < 0.5 for > 500ms             -> SLIPSTREAM
issues includes 'too_close'|'too_far' -> SLIPSTREAM + specific coaching card
issues includes 'low_light'           -> non-blocking banner, run continues
issues includes 'not_in_frame'        -> SLIPSTREAM
```

**SLIPSTREAM** is the key idea and the thing other games should copy. When tracking degrades mid-run:

- The runner keeps running (the world keeps scrolling, so the game doesn't feel dead).
- **Obstacle spawning stops immediately.** Any obstacle already in flight is *dissolved* with a particle puff before it reaches the commit line. The player can never be hit by something they couldn't have dodged.
- Coins stop spawning; in-flight coins are collected automatically at half value.
- Distance still accrues but at 50% score rate, so slipstream is never a farming strategy.
- A card appears with the *specific* fix: "Step back — you're too close" / "Move into frame" / "Turn on a light".
- On recovery (`quality >= 0.6` and `personDetected` for 400ms continuous), play a 1.5s "resuming in 3-2-1" countdown, then resume spawning. Never resume spawning on the same frame tracking recovers — the player is still getting reoriented.
- If slipstream lasts > 20s, end the run and go to summary. Report honest `activeSeconds` (see §11).

### 8.2 `session/pause` / `session/resume`

Mandatory behaviour. On `session/pause`:

- Freeze the simulation immediately — set `simulationRunning = false` on the same tick the message is handled. Do not wait for the next frame.
- Keep the render loop alive (rAF continues) but draw a static frame with a dim overlay + "PAUSED" card. A frozen canvas that stops repainting looks like a crash.
- **Stop all audio.**
- **Discard all queued input.** Any `input/gesture` or `input/body` arriving while paused is dropped, not buffered. Buffering means a burst of stale jumps on resume.
- Freeze the run timer and the `activeSeconds` accumulator.

On `session/resume`: 3-2-1 countdown, then unfreeze. Never resume instantly into an incoming obstacle.

On `session/end`: send `workout/summary` immediately, then `game/exit`. Do not wait for an animation.

### 8.3 Failure and retry

- **Death after 1:30** → summary screen with a "Ready?" gate. The retry button is disabled for **45 seconds** with a visible countdown labelled "Recover". This is deliberate: it enforces the rest interval that makes this a HIIT session instead of a smear of continuous mediocre effort. The countdown is skippable with a deliberate two-hand-raise gesture for players who genuinely want to go again.
- **Death before 1:30** → instant "Again?" prompt, no rest gate, no summary. A 45-second run isn't work; don't reward it with rest.
- **Three deaths in the same phase across consecutive runs** → offer to drop the difficulty scalar by 15% for the next run. Offer it, don't impose it, and never mention it again if declined twice.

---

## 9. Screen layout

```
+--------------------------------------------------------------------------+
|  1:47                    x14 COMBO                        SCORE  12,480   |
|  [====== BURN ==========------]  OVERDRIVE                 <3 <3 <3       |
|                                                                          |
|                          . . . horizon . . .                             |
|                       \                        /                         |
|                        \      [ COIN ARC ]    /                          |
|                         \   o  o  o  o  o    /                           |
|                          \                  /                            |
|                           \   ############ /      <- low beam (CROUCH)   |
|                            \              /                              |
|                             \    ####    /        <- lane wall (LEAN)    |
|                              \          /                                |
|                               \  ====  /          <- hurdle (JUMP)       |
|                                \      /                                  |
|          (L)                    \    /                    (R)            |
|         hand                     \  /                    hand            |
|        cursor              ======[@]======                cursor         |
|                            COMMIT LINE / runner                          |
|                          .  neutral-stance ghost  .                      |
|                                                                          |
|                                                        +--------------+  |
|                                                        |   webcam     |  |
|                                                        |   preview    |  |
|                                                        +--------------+  |
+--------------------------------------------------------------------------+
```

Layout rules:
- The runner sprite sits at the commit line, **not** at the bottom edge — leaving ~12% of screen height below it gives room for the neutral-stance ghost and stops the runner being occluded by the browser chrome on short laptop screens.
- Hand cursors are drawn **on top of everything**, always visible, even outside the track. They are the player's proprioceptive anchor.
- Webcam preview goes bottom-right at `sm` via `ui/setPreview`. It moves to top-right only during Slipstream so the coaching card can own the bottom.
- Everything critical (combo, lives, burn) is in the top 15%. A player who is jumping and squatting cannot reliably read the bottom of the screen.
- Target rendering resolution 1280×720, letterboxed. Do not render at devicePixelRatio > 1.5; the GPU is shared with MediaPipe.

---

## 10. PixiJS scene and asset list

### Scene graph

```
app.stage
├── worldContainer                 (sortableChildren = false; manual depth order)
│   ├── skyLayer                   1 sprite, static, tinted per phase
│   ├── groundLayer                2 tiling sprites (track + side terrain), UV-scrolled
│   ├── laneGuides                 3 Graphics polys, drawn once, alpha animated
│   ├── obstacleLayer              ParticleContainer-eligible; pooled sprites
│   ├── coinLayer                  pooled sprites, 1 shared spritesheet frame set
│   ├── runnerContainer            runner sprite + shadow + 4-frame squash anim
│   └── fxLayer                    puffs, sparks — pooled, capped at 60 live
├── hudContainer
│   ├── timerText, scoreText, comboText   (BitmapText, not Text — see below)
│   ├── burnMeter                  2 Graphics rects
│   ├── livesGroup                 3 sprites
│   └── phaseFlash                 1 full-screen Graphics rect, alpha-tweened
├── handCursorLayer                2 sprites
└── overlayContainer               pause card, slipstream card, summary, countdown
```

### Performance rules (non-negotiable — MediaPipe owns the GPU)

- **One spritesheet.** All gameplay art in a single 2048×2048 atlas. Zero texture swaps per frame.
- **BitmapText for all HUD numbers.** `PIXI.Text` re-rasterises on change; the score changes every frame.
- **Object pools for obstacles, coins, and FX.** Zero allocation in the hot loop. Pre-warm 24 obstacles, 120 coins, 60 FX at boot.
- **No filters, no blur, no shadow filters.** Fake glow with an additive sprite.
- **Cap at 60fps, and degrade to 30fps** rendering (not simulation) if `app.ticker.FPS` averages < 45 for 3s. Simulation stays at a fixed 60Hz timestep regardless.
- **Fixed timestep:** accumulate `deltaMS`, step simulation in 16.667ms chunks, max 3 catch-up steps per frame, interpolate render positions. This is what keeps the game fair when the browser stutters because MediaPipe just did a long inference.

### Asset list

| Asset | Format | Notes |
|-------|--------|-------|
| `atlas.png/.json` | 2048² atlas | everything below packs into it |
| runner | 8 frames run, 4 jump, 3 crouch, 2 hit | simple side/back-view character |
| hurdle | 1 sprite + 1 broken variant | |
| low beam | 1 sprite, 9-slice horizontally | |
| lane wall | 1 sprite, 2 tints (single/double) | |
| coin | 6-frame spin | |
| hand cursor | 2 sprites (open / grabbing) | |
| track tile | 1 tiling texture 256×256 | |
| side terrain | 2 tiling textures (parallax layers) | |
| puff / spark | 3 sprites | |
| HUD font | 1 bitmap font, 2 sizes | numerals + caps only |
| SFX | 9 files, mp3, <30KB each | jump, land, crouch, lane, coin, sweep, hit, overdrive, finale |
| Music | 2 loops (main, finale) | ~1.5MB total, streamed |

Total asset budget: **under 4MB**, first-frame-interactive under 2s on a warm cache. Games load inside an iframe after the console has already loaded MediaPipe; a heavy game makes the whole console feel broken.

---

## 11. SDK usage — exact calls

```js
import { createClient } from '@bosco98/primal-sdk';

// --- boot -----------------------------------------------------------------
const eg = await createClient();          // completes the MessageChannel handshake
                                          // rejects after 5s -> show "standalone/dev mode"

await eg.subscribe({
  channels:   ['body', 'gesture', 'intensity', 'tracking'],
  exercises:  [],                         // no rep recognizer needed at all
  bodyRateHz: 30,
});

eg.setPreview({ corner: 'bottom-right', size: 'sm', visible: true });
```

**Note the empty `exercises` array.** This game explicitly tells the console not to run rep classification, which frees console-side budget. Requesting only what you need is part of being a good citizen on this platform, and the template repo should say so loudly.

```js
// --- input ----------------------------------------------------------------
eg.on('input/gesture', (e) => {
  if (e.state !== 'start') return;              // we only care about edges
  if (e.confidence < 0.55) return;              // tuneable; 0.55 chosen to favour
                                                // false-positives over misses
  switch (e.gesture) {
    case 'jump':       queueAction('JUMP');  break;
    case 'crouch':     queueAction('CROUCH'); break;
    case 'lean_left':  queueAction('LANE_L'); break;
    case 'lean_right': queueAction('LANE_R'); break;
  }
});

eg.on('input/body', (b) => {
  updateHandCursors(b.hands, b.bodyCenter, b.head);
  bodyLean   = b.lean;      // validation only, not lane control
  bodyCrouch = b.crouch;    // fallback duck path
  feedRebaseline(b.bodyCenter);
});

eg.on('input/intensity', (i) => {
  burn = i.avg10s;
  if (burn > 0.65 && !overdrive) enterOverdrive();
  if (burn < 0.45 &&  overdrive) exitOverdrive();
});

eg.on('tracking/status', (s) => {
  const bad = !s.personDetected || s.quality < 0.5 ||
              s.issues.some(i => i !== 'low_light');
  bad ? enterSlipstream(s.issues) : exitSlipstream();
});

// --- lifecycle ------------------------------------------------------------
eg.on('session/pause',  () => setPaused(true));
eg.on('session/resume', () => resumeWithCountdown());
eg.on('session/start',  () => beginRun());
eg.on('session/end',    () => { sendSummary(); eg.exit({ reason: 'session_end' }); });
```

`queueAction` pushes into a small ring buffer consumed by the fixed-timestep simulation step, tagged with the event's arrival time. **Never mutate simulation state directly from a message handler** — it desyncs the fixed timestep and produces input that fires "between" frames. Another thing the template should demonstrate explicitly.

```js
// --- outbound -------------------------------------------------------------
// every 5s during a run
eg.progress({
  phase:        currentPhase,          // 'onboard'|'build'|'press'|'squeeze'|'finale'
  elapsedMs:    runElapsedMs,
  movements:    totalScoredMovements,
  score:        runScore,
});

// on run end (death or clean finish)
eg.summary({
  reps:          jumps + crouches,     // countable full-body reps only
  activeSeconds: activeMs / 1000,      // excludes pause AND slipstream
  avgIntensity:  intensitySum / intensitySamples,
  score:         consoleScore,
});
```

`consoleScore` is **effort-normalized**, not `runScore`:

```
consoleScore = round( (jumps * 3 + crouches * 3 + laneChanges * 1 + coins * 0.5)
                      * (0.6 + 0.8 * avgIntensity) )
```

Rationale: the console uses this for cross-game profile and (later) currency. A leaderboard that rewards coin-farming over jumping would quietly teach players to move less. **The console-facing score must always be dominated by physical work done.** Every game on this platform should apply the same rule.

`activeSeconds` excludes pause and slipstream time. Be honest here — this number will eventually feed a fitness profile the user trusts.

---

## 12. What makes this a good template repo

This repo is the thing third-party developers clone. Structure it for reading, not for cleverness.

```
primal-game-dodge-collect/
├── README.md              <- 5-min "your first PRIMAL game", not a feature list
├── src/
│   ├── main.js            <- boot, handshake, subscribe. ~80 lines. Read this first.
│   ├── input/
│   │   ├── gestureQueue.js   <- ring buffer + why you don't mutate state in handlers
│   │   ├── handCursor.js     <- body-relative mapping, mirroring, one-euro filter
│   │   └── rebaseline.js     <- drift correction
│   ├── sim/
│   │   ├── loop.js           <- fixed timestep + interpolation. Heavily commented.
│   │   ├── obstacles.js
│   │   └── scoring.js
│   ├── render/
│   │   ├── scene.js
│   │   └── pools.js
│   ├── lifecycle/
│   │   ├── pause.js          <- the mandatory behaviour, isolated and obvious
│   │   └── tracking.js       <- slipstream
│   └── dev/
│       └── mockDriver.js     <- ***THE MOST IMPORTANT FILE IN THE REPO***
└── docs/CHECKLIST.md      <- "before you ship" list
```

The five things a copying developer must be able to find in under a minute:

1. **`mockDriver.js` — develop without a console or a webcam.** A keyboard-driven fake that emits protocol-shaped `input/gesture` and `input/body` events into the same handlers. Without this, third-party development is miserable: you cannot iterate on a game if every reload requires standing up and jumping. This file is why devs will actually finish games. Ship it, document it, keep it working.
2. **Correct pause handling in one file** (`lifecycle/pause.js`), so it's trivially copyable and obviously mandatory.
3. **Slipstream** as the worked example of "degrade, don't die" — because every game will face tracking dropout and most devs' first instinct (game over) is wrong.
4. **The body-relative coordinate mapping and the mirror flip**, with the mirroring bug called out by name in a comment. Everyone hits it.
5. **The effort-normalized `consoleScore`**, with the paragraph explaining *why* — so third-party games don't accidentally build reward loops that reduce movement.

`docs/CHECKLIST.md` ship gate:
- [ ] Pauses within one frame of `session/pause`, drops queued input
- [ ] Never game-overs on tracking loss
- [ ] Subscribes only to channels it uses; `exercises: []` if no reps needed
- [ ] Single texture atlas, pooled sprites, no filters, ≤1.5 DPR
- [ ] Fixed-timestep simulation independent of render rate
- [ ] `activeSeconds` excludes paused and untracked time
- [ ] `workout/summary` score dominated by physical work
- [ ] Runs at ≥50fps with MediaPipe active on a 2020 MacBook Air
- [ ] Every required movement has ≥1.1s of telegraph

---

## 13. Build order

1. Pixi scaffold + fixed-timestep loop + scrolling track. No input. (Verify 60fps with MediaPipe running in the console.)
2. `mockDriver.js` + keyboard controls. Full game playable at a desk.
3. Obstacle types 1–4, commit-line resolution, lives, combo.
4. SDK handshake + `input/gesture`. Real jumping. **First playtest — this is the moment the platform is proven or isn't.**
5. `input/body` hand cursors + coins.
6. Difficulty ramp + Overdrive + `input/intensity`.
7. Slipstream + pause + calibration drift handling.
8. Summary + `workout/summary` + retry gates.
9. Art pass, audio, atlas packing.
10. Extract README/CHECKLIST/template cleanup — the "make it a template" pass is a real, scheduled step, not something that happens for free.
