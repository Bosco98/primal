# PRIMAL Game Plans

Design documents for the four launch-era PRIMAL games.

**The product purpose: get the user to actually work out.** Games are the delivery mechanism; physical exercise is the payload. Every design decision in these documents is argued from "does this make the player sweat more, or train more consistently?" — not from "is this a good game in the abstract."

---

## The four games

| Game | Status | Doc |
|---|---|---|
| **Dodge & Collect** | **BUILD** — built first | [`dodge-collect.md`](./dodge-collect.md) |
| **Rep Battle** | **BUILD** — launch game 1 | [`rep-battle.md`](./rep-battle.md) |
| Shadow Boxer | Design only — future | [`shadow-boxer.md`](./shadow-boxer.md) |
| Workout Quest | Design only — future | [`workout-quest.md`](./workout-quest.md) |

### At a glance

| Game | Input channels used | Exercises | Workout type | Session length |
|---|---|---|---|---|
| **Dodge & Collect** | `body` @30Hz, `gesture`, `intensity`, `tracking` | none (movement only: jump, crouch, lean, reach) | Cardio (HIIT) | 2:30–3:00 per run; 3–5 runs = 12–18 min |
| **Rep Battle** | `rep`, `rep_progress`, `gesture` (block), `intensity`, `tracking` | squat, jumping_jack, lunge (pushup optional/bonus only) | Strength / muscular endurance | 8–11 min per boss fight |
| **Shadow Boxer** | `gesture` (low-latency), `body` @30Hz | none (punch, block, slip, duck) | Cardio, upper-body + core | 8–19 min (3 rounds × 3:00 + 1:00 rests) |
| **Workout Quest** | `rep`, `rep_progress`, `intensity`, `tracking` + persistence | squat, jumping_jack, lunge (pushup in optional side-rooms) | Mixed / full-body circuit | 15 min, fixed |

---

## MVP scope: two games

### Built first — Dodge & Collect
Endless runner. Lean to change lanes, squat to duck, jump over hurdles, reach out to grab coins.

**Proves:** the continuous `input/body` stream at 30Hz (hand cursors, lean, crouch) and edge-triggered `input/gesture` at low latency. This is the harder half of the input protocol, so getting this game playable is the milestone that says the console works.

**Also the reference/template repo** that third-party developers clone. It ships a mock input driver so games can be developed without a webcam, plus worked examples of pause handling, tracking degradation, fixed-timestep simulation, and effort-normalized scoring. See §12 of its doc.

### Launch game 1 — Rep Battle
Turn-based Pokémon-style boss fight. Your attack is a set of reps; the boss's turn is your rest interval.

**Proves:** `input/rep` end to end — count, `formScore`, `flags`, `durationMs` — plus `input/rep_progress` for in-rep feedback. It is the game that validates the rep recognizer as a *gameplay* input rather than a counter.

The turn structure is chosen because strength training is already interval-shaped: 35s of work, 24s of rest, 8–10 times. The rest interval that every other fitness game has to bolt on is here the most important scene in the game.

---

## Design-only, recorded not scheduled

### Shadow Boxer
Real-time boxing duel. The original vision, and the most appealing concept of the four — but blocked on a measured end-to-end latency budget of **110–225ms** against a fighting game's need for ~80ms. The doc states the full latency breakdown, the seven platform changes needed to close it, and the decision gate (measured budget under 130ms) before it should be attempted. Its async "ghost duel" model is likely the right social layer for the whole platform.

### Workout Quest
A real 15-minute circuit-training program dressed as a dungeon crawl. The most workout-dense concept and the strongest long-term retention candidate: it is the only one with progressive overload, so it is still appropriately hard in month 6. Blocked on the cross-game profile/persistence layer, which should be scheduled with this game as its driving customer. **Should be the first post-MVP game.**

---

## Conventions that apply to every game

These are extracted from the docs and hold platform-wide.

1. **`workout/summary.score` must be dominated by physical work done** — never by winning, never by loot, never by a coin-farming subsystem. Games are free to show a different, flashier score on screen. The console-facing number tracks the workout.
2. **`activeSeconds` is honest.** Exclude paused time and time when tracking was degraded.
3. **Rest is designed, not accidental.** Every game builds its recovery interval into the fiction (boss turn, corner scene, corridor) and makes it visually the best-looking part.
4. **Degrade, don't die.** Tracking loss must never cost the player progress or end a session. Freeze, coach the specific fix, resume with a countdown.
5. **`session/pause` is honoured within one frame**, queued input is dropped, and the canvas keeps repainting a static frame.
6. **Subscribe narrowly.** Request only the channels and exercises you use; MediaPipe already owns the GPU. `dodge-collect` sends `exercises: []`; `rep-battle` sends `bodyRateHz: 0`.
7. **Pushup is BETA and never on a critical path.** It appears only as optional bonus content, which also gives the recognizer free real-world data.
8. **Render cheap.** One texture atlas, BitmapText, pooled sprites, no filters, DPR ≤ 1.5, fixed-timestep simulation independent of render rate.
9. **Every required movement gets ≥1.1s of telegraph**, and every timing window is ≥180ms. The pipeline latency is real; design around it instead of pretending.
10. **Partial workouts always count.** Quitting mid-session still sends a full `workout/summary`.

---

## Related

- [`../protocol/`](../protocol/) — the input protocol v1 spec
- [`../roadmap.md`](../roadmap.md) — post-MVP features, recorded but not scheduled
