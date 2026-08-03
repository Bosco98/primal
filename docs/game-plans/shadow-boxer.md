# Shadow Boxer — Design Only (Future)

**Status:** DESIGN ONLY. Not built for MVP. Blocked on platform latency work (§4, §7).
**API surface it would prove:** low-latency `input/gesture` with `start`/`end` states, and the console's ability to deliver sub-frame-budget input.
**Workout type:** cardio (boxing-style HIIT), high upper-body and core load.
**Session length:** 12–16 minutes (3 rounds × 3 min + 1-min rests), or a 9-minute short format.

Real-time 1v1 duel. You throw a punch; your on-screen fighter throws a punch. You block; they block. You slip left; they slip left. Street Fighter camera, boxing rules.

---

## 1. Why this document is careful

This is the original vision for PRIMAL, and it is the most viscerally appealing of the four concepts. It is also **the hardest thing on the platform to make feel good**, for reasons that are physical and not solvable by working harder on the game code. This document exists to (a) keep the design alive and specified, and (b) state precisely and honestly what has to be true before it is worth building.

The failure mode to avoid is building it early, having it feel like punching through treacle, and concluding the idea is bad. The idea is good. The pipeline isn't ready.

---

## 2. Core loop

```
ROUND START (3:00 clock)
  -> continuous exchange:
       you throw -> your fighter throws -> lands / is blocked / whiffs
       opponent telegraphs -> you block or slip -> damage reduced / taken
       stamina drains on every thrown punch, regenerates when guarding
  -> knockdown at 0 HP -> 8-count -> stand at 40% HP (max 2 knockdowns/round)
ROUND END -> 1:00 REST (mandatory, uninterruptible)
  -> corner scene: stats, coaching line, opponent tendency readout
  -> next round
3 rounds -> decision on points, or KO
```

Rounds are the entire pacing structure. The rest between rounds is not a menu — it is a rendered corner scene with a cutman and a coach, because the player must *want* to sit in it for the full 60 seconds. This is the same principle as `rep-battle`'s boss turn: **the rest interval must be the best-looking part of the game.**

---

## 3. Combat model

### 3.1 Inputs → actions

| Physical movement | Gesture event | In-game action |
|---|---|---|
| Left straight/jab | `punch_left` start→end | Left punch. Damage scales with extension speed (see 3.2). |
| Right straight/cross | `punch_right` | Right punch, ~1.4× damage, ~1.3× recovery frames. |
| Both arms up/crossed | `block` start (held) | Guard. Active while `state === 'start'` and until `end`. |
| Lean left / right | `lean_left` / `lean_right` | Slip. Full evade of a straight; does not evade a hook. |
| Crouch | `crouch` | Duck. Evades head shots; exposes you to body shots. |
| Jump | `jump` | Step-back / reset spacing. Cheap disengage with a cooldown. |

`input/body` at 30Hz runs underneath for **guard posture** (hands high vs. hands low, from `hands.*.y` relative to `head.y`) and for **stance drift**. Fighting with your hands down is punished — that's the correct boxing lesson and it costs the player real shoulder endurance, which is exactly the training effect we want.

### 3.2 Punch quality from gesture data

The `input/gesture` payload carries `confidence` and `start`/`end` states. From the start→end interval and the console's hand positions we derive:

```
extensionMs   = t(end) - t(start)
punchPower    = clamp( map(extensionMs, 420ms..160ms -> 0.4..1.0), 0.4, 1.0 )
guardPenalty  = 1.0 if the OTHER hand was high at t(start), else 0.75
damage        = BASE * punchPower * guardPenalty * comboMult * staminaMult
```

Fast, snappy, committed punches hurt more; lazy pawing does not. `guardPenalty` enforces keeping the non-punching hand up, which is both correct technique and additional isometric shoulder work.

### 3.3 Combos

A combo is a sequence of punches within 900ms of each other. `comboMult = 1.0 + 0.12 * min(chain, 4)` (caps at 1.48× on a 5-punch chain). **Alternating hands is required to chain** — L-R-L-R chains, L-L-L does not. This forces rotational core movement rather than one-arm spamming, which triples the metabolic cost and is the single biggest lever on whether this game is actually a workout.

### 3.4 Stamina — the workout governor

```
stamina: 0..100, starts at 100 each round
punch thrown        -8 (jab) / -12 (cross)
guard held           -3 / second
slip / duck          -4
idle / not guarding  +6 / second
below 30 stamina:   punchPower capped at 0.6, guard leaks 35% of damage
below 10 stamina:   fighter visibly drops hands; heavy breathing audio
```

This is what makes the game a workout rather than a flail-fest. Throwing 200 wild punches in round 1 empties stamina and you spend round 2 unable to hurt anyone — the same thing that happens to a real novice boxer. The optimal strategy is **paced, committed work with recovery** — which is precisely the training pattern we want to induce.

Stamina regen deliberately requires *not guarding*, so recovery means genuinely resetting your posture rather than freezing in a defensive crouch.

### 3.5 Blocking

Blocking reduces incoming damage by 80%, not 100%. Chip damage exists so that turtling is a losing strategy — a player who blocks for 3 minutes gets a poor workout and should also get a poor result. Slipping (a lean) evades fully but has a 500ms recovery window in which you cannot punch, so it costs tempo.

---

## 4. The latency problem — be honest

This is the section that determines whether the game gets built.

### 4.1 The budget, measured end to end

| Stage | Realistic ms | Notes |
|---|---|---|
| Camera exposure + capture at 30fps | 16–33 | One frame period. Halves at 60fps capture. |
| Frame → GPU → MediaPipe Pose inference | 12–28 | BlazePose lite/full, laptop iGPU or low-end dGPU |
| Landmark smoothing (one-euro / Kalman) | 20–40 **effective** | Not compute — it is *lag by construction*. Aggressive smoothing to kill jitter directly adds phase delay. |
| Gesture FSM confirmation (2–3 frames) | 33–66 | Needs multiple frames to distinguish a punch from a twitch |
| `postMessage` across origins | 1–4 | Cheap. Not the problem. |
| Game logic → Pixi render → present | 16–33 | 1–2 frames at 60fps |
| Display panel latency | 8–20 | Laptop panels are not gaming monitors |
| **Total** | **~110–225 ms** | |

For comparison: a competitive fighting game runs **~65–80ms** end to end and players complain about anything above 100ms. **We are 2–3× over budget and there is no single fix.**

### 4.2 What this actually breaks

- **Frame-tight blocking is impossible.** You cannot ask a player to react to a 300ms telegraph when 200ms of it is consumed before they see it.
- **Punch trading / priority** cannot be resolved fairly. Two fighters "simultaneously" throwing is unresolvable at this jitter.
- **Player-perceived responsiveness** is the real casualty: throwing a punch and seeing your fighter throw 200ms later feels like remote-controlling someone else, which destroys the embodiment that makes the concept appealing in the first place.

### 4.3 Designing around it (what a good version does anyway)

1. **Early-fire on velocity, not on completion.** Fire the punch event when the hand crosses an outward velocity threshold at ~40% extension, not when the arm is straight. This alone recovers **60–100ms** and is the highest-value item on the list. It costs some false positives; in this game a false positive is a wasted punch and some stamina, which is acceptable — a *missed* punch is not.
2. **Animate on intent, resolve on confirmation.** The moment the early-fire event lands, start the punch animation. If the gesture is later invalidated, blend into a whiff. The player sees instant response; correctness is fixed up behind the animation.
3. **Wide windows everywhere.** Block window ±250ms. Slip window ±300ms. Never a window under 200ms anywhere in the game.
4. **Opponent telegraphs are 700ms minimum** — long, exaggerated, boxing-legible wind-ups. This is a style choice that happens to be a latency fix.
5. **Never require reacting to something you did not see coming.** The opponent AI must always telegraph. No true mixups.
6. **Timestamp everything.** Console should stamp events with the *capture* time, not the emit time, so the game can measure and compensate for actual pipeline delay rather than guessing.
7. **Consider a deliberate opponent-side delay** so both fighters have symmetric perceived latency. Counterintuitive, but symmetric lag reads as "the game's rhythm"; asymmetric lag reads as "the game is broken".

Even with all of this, the honest ceiling is a **rhythmic, committed, heavyweight-feeling** boxing game — not a twitchy one. That is a fine game. It is not the game people picture when they hear "Street Fighter with your body", and the design should commit to the version it can actually be.

---

## 5. PvP and friends

Two options, and the recommendation is not close.

### 5.1 Async "Ghost Duel" — RECOMMENDED for v1

Record the opponent's full input timeline from a real match (punch/block/slip events with timestamps, plus stamina curve). Replay it as the AI opponent, with a thin adaptive layer so it reacts to the player's guard state rather than being a pure recording.

- **Pros:** no netcode, no matchmaking infrastructure, no latency compounding, plays offline, works across timezones, trivially fair. A ghost is ~10KB.
- **Cons:** not truly reactive; a strong player will read a ghost's patterns after 2–3 matches.
- **Why it's right:** the local input pipeline already spends 110–225ms. Adding 40–90ms of network on top makes real-time unplayable. **You cannot build real-time PvP on a 200ms local budget.** Async sidesteps the entire problem while still delivering "I beat my friend's fighter", which is 80% of the social value.

### 5.2 Real-time PvP — far horizon

Only viable after the latency work in §4.3 lands *and* is verified to bring the local budget under ~110ms. Then: rollback netcode with a 2–3 frame rollback window, deterministic simulation, authoritative-host or lockstep. This is a multi-month project on its own and should not be attempted until Shadow Boxer exists and is fun in single-player.

### 5.3 The social layer that works today

- **Challenge a friend's ghost.** Asymmetric, async, sharable by link.
- **Fighter progression is shared across the profile** — your fighter's stamina cap grows from *all* PRIMAL sessions, including squats in `rep-battle`. This is the cross-game hook (see `roadmap.md`).
- **Weekly ghost gauntlet:** three friends' ghosts back to back, best cumulative round score.

---

## 6. The workout

This is the concept's strongest suit and the reason it stays on the roadmap despite the technical cost. Boxing training is *already* a top-tier conditioning modality, and the round structure is already a proven interval protocol.

### 6.1 Round structure

**Standard (fit players): 3 rounds × 3:00, 1:00 rest = 11:00 total.**
This is amateur boxing's actual format, and a 3:1 work:rest ratio is a hard, legitimate conditioning session.

**Novice: 3 rounds × 2:00, 1:00 rest = 8:00.** Default for first-time players; graduates to standard after 5 completed sessions.

**Championship: 5 rounds × 3:00, 1:00 rest = 19:00.** Unlocked, not default.

### 6.2 Expected load

At a sustainable pace the stamina system pushes the player toward **35–55 punches per minute** with continuous guard-holding and 15–25 slips/ducks per minute. That is:

- Sustained arms-above-heart isometric load (guard) — deceptively brutal, and the reason novices' arms drop in round 2
- Continuous rotational core work (alternating punches)
- Repeated lateral weight shifts and squats (slips and ducks)
- Expected **80–90% max HR** by mid-round 2

Per round: roughly **120–160 punches, 40–70 slips/ducks**. Over 3 rounds that's ~400 punches and ~150 lower-body movements. Comparable to a real boxing conditioning round on the pads.

### 6.3 Design rules that protect the workout

- **The 1-minute rest is uninterruptible and unskippable.** Recovery is what makes the next round possible. The corner scene fills it.
- **Stamina must not be circumventable by gear or upgrades.** If a player can buy their way out of fatigue, the game stops being a workout. Progression may raise the *cap* (which is what real fitness does) but never remove the drain.
- **No held-button equivalents.** Every action costs a physical movement. There is no input in this game that can be performed while standing still.
- **Punish hands-down.** Guard posture from `input/body` is checked continuously; a fighter with hands below shoulder height takes 1.4× damage. This produces sustained shoulder isometric load, which is the hardest and most valuable part of boxing conditioning, and does it without ever asking the player to hold a pose "for exercise".

---

## 7. Platform prerequisites

Shadow Boxer is not buildable until these land. In order:

1. **60fps capture path** where hardware allows. Halves the first stage of the latency budget. Verify MediaPipe can sustain inference at 60Hz on target hardware, or run inference at 30Hz with interpolated landmark prediction between frames.
2. **Velocity-based early-fire gesture detection** for `punch_left`/`punch_right`, emitting at ~40% extension. Biggest single win. Needs a new confidence model — the FSM must express "probably a punch, committing now" rather than "confirmed punch".
3. **Capture-time timestamps on every event.** `input/gesture` needs a `captureTs` alongside emit time so games can measure real pipeline delay and compensate. Should be added to protocol v1.1 regardless — every game benefits.
4. **A tunable smoothing profile per channel.** Punch detection wants minimal smoothing (accept jitter, want speed); hand-cursor games want heavy smoothing. One global filter cannot serve both. `config/subscribe` should accept a `latencyProfile: 'responsive' | 'smooth'`.
5. **Measured end-to-end latency instrumentation** in the console — a dev overlay showing capture→render ms. You cannot fix what you cannot see, and every number in §4.1 above is an estimate that must be replaced with a measurement before this design is trusted.
6. **`gesture` reliability bar:** `punch_left`/`punch_right` at ≥95% true-positive and ≤5% false-positive at 2m, across 3 body types and 2 lighting conditions. `block` and `crouch` at ≥90%. If punches are not this reliable, the game is not playable at any latency.
7. **Cross-game profile** (from `roadmap.md`) for fighter progression to mean anything.

**Decision gate:** build Shadow Boxer only after item 5 shows a measured end-to-end budget **under 130ms** with items 1–4 in place. If the measurement comes back at 180ms+ after honest effort, the correct response is to reshape the design toward a slower, more rhythmic combat model (longer telegraphs, committed heavy exchanges, no fast trading) rather than to ship a twitch game that feels broken.

---

## 8. Screen layout (sketch)

```
+--------------------------------------------------------------------------+
|  ROUND 2                        2:14                            R1  10-9 |
|  YOU  [######################-------]     [############---------] OPP    |
|  STA  [#############--------------]       [##################---]        |
|                                                                          |
|                                                                          |
|          \O/                                     O/                      |
|           |          <-- you            opp -->  |\      <- 700ms         |
|          / \                                    / \        telegraph      |
|      ____________________________________________________               |
|     /                    canvas floor                     \             |
|                                                                          |
|   GUARD: HIGH                                        COMBO x3            |
|                                                       +----------+       |
|                                                       | webcam   |       |
|                                                       | preview  |       |
|                                                       +----------+       |
+--------------------------------------------------------------------------+
```

Side-on fighting-game camera; player's fighter on the left, mirroring the player. **Stamina bars sit directly under HP** because stamina is the resource the player must learn to read. `GUARD: HIGH/LOW` is a persistent readout — the player needs to know when their hands have dropped without looking at the webcam preview.

Corner-rest screen replaces this entirely with a close-up corner scene, round scorecard, and a coaching line ("You're dropping the right hand when you're tired — keep it up").

---

## 9. If it never gets built

The pieces of this design that are worth harvesting into other games regardless:

- **Stamina as a workout governor.** Any real-time PRIMAL game should adopt it. It is the mechanic that converts "spam input" into "pace yourself", and pacing is what makes a session sustainable.
- **Guard posture from `input/body`** as passive isometric load — a cheap way to add difficulty and real training stimulus to any game where hands are visible.
- **Round structure with an uninterruptible rest and a beautiful rest screen.** Already borrowed by `rep-battle`.
- **Async ghosts** as the social model for the whole platform. Much cheaper than matchmaking and it works today.
