# Dodge & Collect — Feel, Excitement & Progression

**Companion to [`dodge-collect.md`](./dodge-collect.md).** That document specifies *what
the game is made of* — obstacle taxonomy, latency budget, scene graph, SDK calls.
This one specifies *why it is thrilling and why you come back*: the moment-to-moment
feel, the escalation inside a run, the arc across a session, and the arc across weeks.

Read that one first. Where the two disagree, this one wins on design, that one wins
on engineering.

---

## 0. The thesis

Subway Surfers is not exciting because you dodge things. It is exciting because of
five things layered on top of dodging:

1. **Something is chasing you**, and it is visible.
2. **Powerups turn survival into spectacle** — the jetpack sequence is the best 15
   seconds of the game and you barely play it.
3. **Near-misses are celebrated**, so ordinary competence feels heroic.
4. **A run is never wasted** — missions, coins, and the score board all tick up.
5. **The world changes** — new districts, new music, new colour.

A body-controlled runner has one enormous advantage over Subway Surfers here and one
enormous liability. The advantage: the player is *actually sprinting*, so the
adrenaline is real, not simulated. The liability: the player is exhausted, and every
system must survive being read by someone whose heart rate is 165 and who is mid-jump.

So the design rule for everything below:

> **Excitement is delivered through the body, not through the UI.**
> If a mechanic is only legible by reading text, it does not exist during a run.

And the mission rule, inherited from [`README.md`](./README.md):

> **Every reward is bought with movement.** No mechanic in this game may make the
> correct play "move less."

---

## 1. Run shape — finite by design

**A run is 3:00 and never longer.** This is not a technical limit, it is the whole
point. Endless runners are endless because attention is the resource. Here the
resource is *your legs*, and past three minutes of continuous jumping the form
degrades, the injury risk rises, and the player quits for the day instead of doing
another run.

Finite runs buy us things an endless runner cannot have:

- **A composed difficulty curve** with a real climax, instead of an asymptote.
- **A sprint finish.** The player always ends on the hardest 30 seconds, which is
  what makes the rest feel earned.
- **Designed rest.** The gap between runs is the recovery interval of a HIIT set.
- **A guaranteed end state**, so missions and progression can settle predictably.

Three to five runs with 60–90s between is a 12–18 minute HIIT session at roughly a
1:2 work:rest ratio. That is the product. The game is the delivery mechanism.

---

## 2. The Sweeper — the chase, and the anti-coasting engine

**Replace the three-lives system in [`dodge-collect.md`](./dodge-collect.md) §2 with a
continuous pursuer.** This is the single biggest change proposed here.

Discrete lives are a poor fit for this game: they are invisible at a glance while
jumping, they make each hit binary and punishing, and they make the last life
terrifying in a way that causes players to *stop moving hard* to conserve it —
exactly the wrong incentive for a fitness product.

### 2.1 The mechanic

The **Sweeper** is a machine on the track behind you. Its distance is one number:

```
gap ∈ [0, 100] metres,  starts at 60.
gap <= 0  =>  caught  =>  run over (unless Second Wind, §4.2)
```

Per second:

```
gap += (obstaclesClearedThisSecond * 4.0)
     + (coinSweepsThisSecond * 2.0)
     - drain(D)                                  // phase pressure, §5
     + (intensity.avg10s - 0.50) * 6.0           // the effort term
     - (hitsThisSecond * 18.0)
gap = clamp(gap, 0, 100)
```

The effort term is the important one. At `avg10s = 0.85` you gain **+2.1 m/s** for
free. At `avg10s = 0.30` — a player doing minimum-viable twitches to trigger the
gesture recogniser — you *lose* **1.2 m/s** even while clearing everything. Subway
Surfers chases you for failing. This game chases you for **coasting**, and that is
the correct thing for a fitness game to punish.

Three hits in quick succession from a full 60m gap is a catch. So the felt difficulty
matches "three lives" — but it is continuous, recoverable, and always legible.

### 2.2 How the player perceives it — no HUD required

The gap is read **through the world**, not through a bar:

| gap | What the player sees and hears |
|---|---|
| 60–100 | Nothing. Clean track. Ambient music. |
| 40–60 | Distant rumble. Occasional light sweep across the track from behind. |
| 25–40 | The Sweeper's headlights throw the runner's **shadow forward** onto the track. |
| 10–25 | Its silhouette enters the bottom of the frame. Music adds a driving layer. |
| 0–10 | Red vignette pulsing at ~150bpm. Grabber arms reach into frame. Music strips to percussion. |

The forward-cast shadow is the key trick: it puts the threat *in the player's forward
field of view* without a rear-view mirror, and it scales continuously, so the player
always knows without reading anything. A thin gap ribbon on the left edge exists as a
backstop for players who want the number, and can be turned off.

### 2.3 Why this is better for the workout

- It converts "don't get hit" into "**keep working**", which is the actual goal.
- It removes the death spiral. One bad obstacle costs 18m, not a third of your run.
- It gives the game a legitimate way to reward intensity that isn't a separate meter
  the player has to remember to look at.
- It makes recovery visible: fight the Sweeper back from 8m to 40m and the whole
  screen calms down around you. That is a better feeling than a life counter ticking
  back up, and this game can deliver it because the pursuit is analogue.

---

## 3. Snappiness — the engineering of feel

The user-facing requirement is "very real time and very snappy." The pipeline is
**140–200ms end to end** and no amount of code in this game will fix that. Snappiness
here is therefore a *design* problem, solved with five specific techniques. None of
these are optional; together they are the difference between a game that feels
telepathic and one that feels like a laggy webcam toy.

### 3.1 Resolve on event timestamp, not on arrival time

Every envelope carries `ts` in the **console's clock domain**, and the SDK hands the
game `consoleClockOffsetMs` and `toConsoleClock()`. Use them.

```js
client.on('input/gesture', (p, msg) => {
  if (p.state !== 'start') return;
  // msg.ts is when the CONSOLE OBSERVED the movement, not when we got the message.
  queue.push({ action: map(p.gesture), atConsoleTs: msg.ts, confidence: p.confidence });
});
```

The simulation then resolves the action against the world state **as it was at
`msg.ts`**, rewinding up to 200ms of obstacle positions from a small ring buffer.
This does not remove latency, but it removes *jitter* — and jitter is what players
actually perceive as "unresponsive". A consistent 180ms delay feels like weight. A
delay wandering between 120 and 260ms feels broken.

The current build plan never mentions `ts`. It should be the first thing in
`input/gestureQueue.js`.

### 3.2 Asymmetric forgiveness windows

```
pre-buffer   : an action arriving up to 250ms BEFORE the commit window still counts
commit window: ±180ms around contact
coyote time  : a jump landing up to 120ms AFTER the hurdle passed still clears it
```

Total forgiveness ≈ 550ms, deliberately front-loaded. Humans anticipate; let them.
The player who jumps early should never be punished for being *keen*.

### 3.3 Predictive response, deferred commitment

Gestures carry confidence. Start the animation early, commit late:

```
confidence >= 0.35  ->  begin the lane-slide / crouch anim immediately (visual only)
confidence >= 0.55  ->  commit the simulation state
never reaches 0.55  ->  ease back to the previous lane over 120ms
```

The player sees a response inside one frame of the earliest possible detection. The
simulation stays correct. This is the highest-leverage trick available to us, and it
works precisely because our input is analogue and confidence-scored.

### 3.4 Lanes are a position, not a sequence of hops

**This is a required correction to [`dodge-collect.md`](./dodge-collect.md) §7.**

That plan says lane state is "a game-side integer incremented by gesture events." But
`lean_left` / `lean_right` in the console are **held** gestures with hysteresis
(enter at 0.42, exit at 0.26). A player who leans left and *stays* leaning emits
exactly one `start`. To reach the far lane they must return through centre and lean
again — 500–700ms of physical movement for what should be one motion. Obstacle type 4
(double wall) explicitly requires a two-lane move, and at Squeeze-phase pacing that is
not reliably achievable.

Use the body position directly, with the gesture as an accelerator:

```
targetLane = zone(body.lean)      // < -0.42 => left, > +0.42 => right, else centre
                                  // with 0.26 hysteresis on the way back out
on gesture lean_left/right start  => snap the animation immediately (§3.3)
```

Your body *is* the lane selector. Lean hard left and you are in the left lane, no
matter how you got there. A two-lane move is one continuous body movement. It is more
intuitive, more responsive, and it dovetails with the drift re-baselining that §7 of
the build plan already specifies. The edge-triggered gesture survives as the low-
latency hint that starts the animation early.

### 3.5 Physical response curves

Snappiness lives in the animation timings as much as the input path:

| Event | Response |
|---|---|
| Lane change | 90ms slide, `easeOutQuint`. Never linear, never longer. |
| Camera | 3° roll toward the lane, settling in 80ms. |
| Jump | Runner leaves the ground on frame 1. Anticipation frames are a lie we cannot afford. |
| Landing | 60ms squash, dust puff, one-frame camera drop. |
| Hit | 60ms hit-stop (freeze the world, not the HUD), 8px shake, hard low-pass on the music for 400ms. |
| Coin | Sound plays on the frame of overlap, pitched up per coin in a sweep. |

Audio through WebAudio with pre-decoded buffers. Never `<audio>` elements — their
first-play latency alone can exceed the entire input pipeline.

---

## 4. The excitement layer

Four systems, in descending order of how much they matter.

### 4.1 SURGE — the powerup that *is* the rest interval

This is the best idea in the design and it should be built third, right after
obstacles and coins.

The Burn meter fills from `intensity.avg10s`. Fill it and the runner **lifts off the
track for 12 seconds.**

During Surge:

- All ground obstacles pass harmlessly beneath you. There is nothing to dodge.
- Ribbons of coins stream through the air, collected **only with the hand cursors**.
- Score ×3, and the Sweeper loses 1.5 m/s.
- The world opens up — the camera pulls back, the district skyline becomes visible,
  the music switches to its Surge layer.
- It ends with a landing beat, and no obstacle spawns for 1.2s after touchdown.

Look at what that is physiologically: **twelve seconds of legs-off, arms-only active
recovery, awarded for having worked hard.** It is the jetpack sequence — the flashiest,
most-anticipated moment in the game — and it is simultaneously the interval structure
that makes the workout defensible. The reward and the rest are the same object.

Nothing else in this design gets that alignment for free. Build it properly: this is
the moment players will describe to other people.

### 4.2 SECOND WIND — one free catch, earned with effort

The hoverboard. Held in reserve, maximum one (two at higher tiers).

- **Earned by** holding `avg10s >= 0.70` for 20 continuous seconds. Never bought,
  never granted, never a consolation prize for losing.
- **Auto-consumes** the moment `gap <= 0`: the Sweeper is thrown back to 35m, 2s of
  invulnerability, one big loud VFX beat.
- The player does not choose to spend it, because a player mid-jump at 170bpm cannot
  make a good spending decision.

The purpose is blunt: **stop the run from ending at 1:20.** A run that ends early is a
workout that did not happen, and the recovery gate in §8.3 of the build plan is
explicitly designed to make an early death not worth resting for. Second Wind is the
mechanic that keeps the heart rate elevated through the middle of a run, and the fact
that you earn it by working hard means the players who need it least get it most —
which is fine, because those players are already getting the workout.

### 4.3 Near-misses — free adrenaline

When an obstacle passes within 25% of a lane width of the runner's hitbox, or a jump
clears a hurdle by less than 15% of its height:

```
+25 score, "CLOSE!" flash, doppler whoosh, 1.5° camera kick, 40ms of 0.85× timescale
```

This is nearly free to implement and it is a disproportionate share of why runners
feel good. It rewards *precision* rather than caution, and it makes a barely-competent
player feel like they are performing. Cap it at one per obstacle so a gauntlet does
not turn into a slot machine.

### 4.4 Set pieces — the world does something

One scripted moment per phase, so a run has a shape you can remember afterward:

| Time | Set piece | What happens |
|---|---|---|
| ~0:50 | **First Surge** | Timed so the difficulty ramp usually delivers it here. Onboarding by reward. |
| ~1:15 | **The Tunnel** (15s) | Lights die. Obstacles are rim-lit only. Telegraph time is *unchanged* — the danger is atmospheric, never mechanical. Coins are the only light source. |
| ~2:00 | **The Lunge** (8s) | The Sweeper doubles its drain with a loud, unmissable telegraph. You out-run it by clearing obstacles. Fair, terrifying, and it lands exactly where a HIIT interval's hardest moment should. |
| 2:30 | **Finale** | Coin storm, ×3 value, colour shift, music escalation, no new mechanics. Pure sprint. |

**The Tunnel rule generalises: set pieces may change how a run feels, never how it
resolves.** Every required movement keeps its ≥1.1s telegraph and its ±180ms window
regardless of what the lighting is doing.

### 4.5 Explicitly rejected

| Idea | Why not |
|---|---|
| **Coin magnet** | The correct play becomes "stop reaching." It deletes the upper-body workout to save the player effort. This is the exact failure mode the platform exists to avoid. |
| **Score multiplier powerup** | Changes the number, not the movement. Nothing happens in the body. |
| **Paid / watch-an-ad revive** | Turns the recovery gate into a purchase. Second Wind does this job and charges effort instead. |
| **Adaptive downward difficulty** | Teaches the player that struggling is rewarded. Already ruled out in the build plan; it stays ruled out. |

---

## 5. Progression I — inside a run (0:00 → 3:00)

Difficulty is one scalar `D ∈ [0,1]`; everything below is a lerp on it. This extends
the build plan's ramp with Sweeper pressure and set pieces.

| Phase | Time | Scroll | Obstacle interval | Sweeper drain | New this phase |
|---|---|---|---|---|---|
| **Onboard** | 0:00–0:20 | 40 u/s | 3.4s | 0.0 m/s | Types 1–3, one at a time. The Sweeper is invisible. Nobody loses here. |
| **Build** | 0:20–1:00 | 48 u/s | 2.6s | 1.5 m/s | Type 4. Coin arcs. Sweeper becomes audible. First Surge. |
| **Press** | 1:00–1:45 | 56 u/s | 2.1s | 2.8 m/s | Type 5. Lateral spurs. The Tunnel. Shadow-casting begins. |
| **Squeeze** | 1:45–2:30 | 64 u/s | 1.7s | 4.0 m/s | Type 6. Two obstacles in flight. The Lunge. |
| **Finale** | 2:30–3:00 | 72 u/s | 1.4s | 5.0 m/s | Coin storm, ×3. All types. |

Hard caps that no tier, district, or difficulty setting may exceed:

```
scroll speed    <= 85 u/s      (past this, obstacles are unreadable before undodgeable)
telegraph time  >= 1.10 s      (measured, per obstacle, asserted in tests)
commit window   >= ±180 ms
```

These are consequences of the measured latency budget, not preferences. A test should
fail if a spawn is scheduled that would violate them.

**Movement budget per run** (unchanged from the build plan, restated because it is the
actual product spec): ~30–38 jumps, ~24–30 crouches, ~28–34 lane changes, ~45–60 hand
reaches. Roughly 48 scored movements per minute, of which ~22/min are load-bearing.

---

## 6. Progression II — inside a session (3–5 runs, 12–18 min)

A session is not five identical runs. Runs are **districts**, played in order, and
each district changes *which muscles work*, not just the colour palette.

| # | District | Twist | Emphasis |
|---|---|---|---|
| 1 | **Rail Yard** | Baseline mix. | Balanced |
| 2 | **Neon Market** | Coin density +60%, lateral spurs everywhere. | Shoulders, reach, ROM |
| 3 | **The Tunnels** | Low beams dominate; hurdles rare. | Quads — this is the squat run |
| 4 | **Rooftops** | Hurdle gauntlets dominate; crosswind adds a constant lane drift you must lean against. | Plyometric + core |
| 5 | **Skyline** | All types at once, longest Surge, highest coin value. | Everything |

This gives the district select a genuine training meaning: *"legs are sore, do Neon
Market."* A fitness game whose level select is also a workout selector is doing two
jobs with one screen.

### The gate between runs is a designed scene, not a menu

The build plan's 45-second **Recover** gate is correct and should be the best-looking
screen in the game — a slow flyover of the next district while:

- mission bars visibly tick up from what you just earned,
- the run's movement counts count up one by one (jumps, ducks, lane changes, reaches),
- the next district previews its twist in one line,
- the countdown runs, skippable with a deliberate two-hand raise.

Rest is a scene. If the rest screen is boring, players skip the rest, and then it is
not a HIIT session any more — it is a smear of continuous mediocre effort.

Death before 1:30 still skips all of this and offers an instant retry. A 45-second run
is not work and must not be rewarded with rest.

---

## 7. Progression III — across sessions

### 7.1 Tier — the progressive overload

The one number that makes this still a workout in month three.

```
Tier 1..8.  Clean-finish a run (reach 3:00 with gap > 0) => Tier +1.
Tier raises the FLOOR of D: at Tier 5 a run opens at Build-phase difficulty.
Tier decays 1 per 7 consecutive days without a session. Kind, not punitive.
```

Everything else in the meta is cosmetic or motivational. This is the part that keeps
the physiological stimulus honest as the player gets fitter, and it is the direct
analogue of adding weight to the bar.

### 7.2 Missions — three per day, always movement-shaped

Rotating, and every one of them must be satisfiable **only by moving more**:

- "Clear 40 hurdles today."
- "Hold Surge for 30 seconds total."
- "Finish a run without being hit during the Finale."
- "Log 250 scored movements today."
- "Push the Sweeper back from under 10m to over 50m in one run."

Never a pure coin-count mission. Coins already reward reaching; a coin *target* invites
lazy waving at the nearest cluster, which is a worse movement than a full extension.

### 7.3 What unlocks

- **Districts** unlock in order and stay unlocked. The only real content gate.
- **Characters and boards** are pure cosmetics, bought with the shared effort currency
  when the console's cross-game profile lands ([`roadmap.md`](../roadmap.md) items 1–2).
  Cosmetics must never touch hitboxes, speed, or Surge duration.
- **A second Second Wind slot** at Tier 6. The one exception, and it is defensible: by
  Tier 6 the difficulty floor is high enough that runs are ending early again.

### 7.4 Weekly

One number on the home screen: **total movements this week**, with last week's line
drawn behind it. Not score, not coins, not a streak — the count of times the player
physically jumped, ducked, leaned, or reached. It is the most honest possible summary
of the product's actual value, and it is the one that will bring people back.

---

## 8. Screen layout — additions

The build plan's layout (§9) holds. Three changes:

- **Sweeper gap ribbon**, thin, left edge, vertical. Optional; the world already
  communicates it. The forward-cast shadow is the primary channel.
- **Burn/Surge meter** moves to the top edge, full width, 6px tall. It fills toward the
  centre from both sides so it is readable in peripheral vision — the player is
  jumping, and cannot fixate on a corner.
- **Nothing new below the runner.** That band belongs to the neutral-stance ghost and
  the Sweeper's silhouette.

Everything critical stays in the top 15%. A player mid-squat cannot read the bottom of
the screen, and this is not a preference — it is where their eyes physically are.

---

## 9. Corrections needed to the build plan and its SDK usage

Found by reading [`dodge-collect.md`](./dodge-collect.md) §11 against the shipped
[`primal-sdk/src/client.ts`](../../primal-sdk/src/client.ts) and
[`protocol/v1.ts`](../../primal-sdk/src/protocol/v1.ts). **The build plan's code
samples do not currently compile against the SDK.** Since this repo is also the
template third-party developers clone, these need fixing before anyone reads it.

| # | Build plan says | SDK actually has | Action |
|---|---|---|---|
| 1 | `await createClient()` | `PrimalClient.connect({ gameId })` | Fix the sample. |
| 2 | `await eg.subscribe(...)` | `subscribe()` is synchronous, returns void | Fix the sample. |
| 3 | `eg.setPreview({ corner, size, visible })` | `setPreview(visible: boolean)` | §9's "move the preview to top-right during Slipstream" **is not expressible.** Either drop it, or add optional `corner`/`size` to `SetPreviewPayload` — which the protocol's own compatibility rules make a non-breaking change. |
| 4 | `eg.progress({ phase, elapsedMs, movements, score })` | `WorkoutProgressPayload` is `{ reps?, activeSeconds? }` | Phase/movements/score have nowhere to go. Send `activeSeconds` only, or extend the payload. |
| 5 | `eg.summary({ reps: jumps + crouches })` | `reps: Partial<Record<ExerciseId, number>>` | **Type-invalid, and a real design decision.** See below. |
| 6 | `eg.exit({ reason })` | `exit()` takes no arguments | Fix the sample. |
| 7 | Lane changes driven by edge-triggered `lean_*` | `lean_*` is a *held* gesture with hysteresis | See §3.4. This is a gameplay bug, not a typo. |
| 8 | Slipstream on `issues.some(i => i !== 'low_light')` | `multiple_people` is a valid issue | That predicate slipstreams whenever a housemate walks past. Treat `multiple_people` as a non-blocking banner, like `low_light`. |

**On #5 — what does this game report as `reps`?** `ExerciseId` is
`squat | pushup | jumping_jack | lunge`. A dodge-crouch is not a squat, and a hurdle
jump is not a jumping jack. The temptation is to log crouches as `squat` so the number
looks good on the console dashboard. **Don't.** [`roadmap.md`](../roadmap.md) item 1
says that profile will eventually be surfaced as "you're getting stronger, here are
the numbers" — inflating it with half-depth dodge-ducks corrupts the one honest
feedback loop the product has.

Recommendation: send `reps: {}`, an accurate `activeSeconds`, a real `avgIntensity`,
and the effort-normalised `score`. Then add an optional `movements?: number` to
`WorkoutSummaryPayload` — non-breaking, and it gives every future movement-based game
somewhere truthful to put its work. This game is the first customer for that field;
Shadow Boxer will be the second.

The effort-normalised console score is unchanged and stays the rule:

```
consoleScore = round( (jumps*3 + crouches*3 + laneChanges*1 + coins*0.5)
                      * (0.6 + 0.8 * avgIntensity) )
```

---

## 10. Build order

Revised from §13 of the build plan to get the *feel* validated as early as possible.
The point of this ordering is that step 5 answers the only question that matters —
"is this fun to play with your body?" — before any art exists.

1. Pixi scaffold, fixed-timestep loop, scrolling track. No input. Verify 60fps with
   MediaPipe running in the console.
2. `mockDriver.js` — keyboard-driven, protocol-shaped. Fully playable at a desk.
   **The most important file in the repo.**
3. Obstacles 1–4, commit-line resolution, combo, near-misses (§4.3). Placeholder art.
4. The Sweeper (§2) — gap maths, forward shadow, audio layers.
5. SDK handshake, `input/gesture`, timestamp-based resolution (§3.1), forgiveness
   windows (§3.2), predictive lane snap (§3.3–3.4). **First real playtest. This is the
   gate: if it does not feel snappy here, fix it before adding anything else.**
6. `input/body` hand cursors, coins, coin sweeps.
7. `input/intensity` → Burn → **Surge** (§4.1) and Second Wind (§4.2).
8. Difficulty ramp, phases, set pieces (§4.4).
9. Slipstream, pause, calibration drift handling.
10. Summary, recovery gate scene (§6), missions, Tier.
11. Districts.
12. Art pass, audio, atlas packing.
13. Template extraction — README, CHECKLIST, comments. A scheduled step, not a freebie.

Steps 1–5 are the MVP of *feel*. If step 5 is not fun with grey boxes and no sound,
no amount of steps 6–13 will save it, and the right response is to change the input
model, not to add more content.

---

## 11. Ship gate — additions to `docs/CHECKLIST.md`

On top of the existing list:

- [ ] Gestures resolve against envelope `ts`, not arrival time
- [ ] Pre-buffer, commit window, and coyote time all implemented and unit-tested
- [ ] Lane selection follows body position, not gesture edges (§3.4)
- [ ] No spawn can violate the 1.1s telegraph floor — asserted in a test, not by review
- [ ] Surge is reachable by a moderately fit adult inside the first 60 seconds
- [ ] The Sweeper's state is legible with the HUD entirely hidden
- [ ] No mechanic exists for which "move less" is the correct play
- [ ] `workout/summary.reps` contains no exercise the player did not actually do
