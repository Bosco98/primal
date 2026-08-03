# Workout Quest — Design Only (Future)

**Status:** DESIGN ONLY. Not built for MVP. The highest-value concept of the four for long-term retention.
**API surface it would prove:** `input/intensity` as a gameplay driver, `workout/progress` as a rich mid-session channel, and cross-session persistence (the profile layer from `roadmap.md`).
**Workout type:** mixed — full-body circuit training.
**Session length:** 15 minutes, fixed. Optionally a 10-min short and a 22-min long.

A structured circuit-training program wearing a dungeon crawl as a costume. Each room is a set. Each floor is a circuit. The boss room is the finisher. You clear the dungeon by completing the workout.

---

## 1. The thesis

The other three games take a game and try to extract exercise from it. This one takes **a real training program and makes it tolerable**. That inversion is why it is the strongest long-term product.

A well-designed 15-minute bodyweight circuit, done 3–4× a week, produces measurable fitness improvement. That is not in dispute. The reason people don't do it is not that they don't know it works — it's that it's boring, there's no feedback, and there's no reason to come back tomorrow. Those are all *game design problems*, and they are much easier to solve than "invent a fun game that accidentally produces a training stimulus."

Specifically:
- **Boring** → narrative, loot, room variety, music that escalates.
- **No feedback** → form scores, intensity meter, room-clear ratings.
- **No reason to return** → an ongoing dungeon run, progressive overload that visibly gets harder, a character that grows because *you* got stronger.

Everything else in this document is downstream of that.

---

## 2. Core loop

```
SESSION START -> the dungeon remembers where you were; today is Floor N
  |
  +-- CORRIDOR (rest / walk / loot / story)  20-40s
  |     no exercise required; character auto-walks; dialogue or a chest
  |
  +-- ROOM (one set)                          40-60s
  |     enemy appears -> game states the set: "18 JUMPING JACKS"
  |     reps damage the enemy 1:1 (form-scaled)
  |     room clears when the set is complete OR the timer expires
  |     -> ROOM RATING: S/A/B/C on completion% + avg formScore
  |     -> loot roll weighted by rating
  |
  +-- repeat 8-10 rooms across 2 floors
  |
  +-- BOSS ROOM (finisher)                    2:00
  |     AMRAP burst + a short hold; the hardest 2 minutes
  |
  +-- COOLDOWN CHAMBER                        1:00
        stretch prompts, session summary, XP, what changed for next time
```

The player is never asked to make a tactical decision during a set. The game does not compete for attention with the exercise. All decision-making (route choice, loot equipping, upgrade spending) happens in corridors — i.e. during rest.

**This is the design's core discipline: gameplay in the rest, exercise in the rooms.** Games that put decisions inside the set make people do worse reps.

---

## 3. The actual program

This is a real circuit and should be reviewable as one. Total 15:00.

### Session template — "Standard, Week 1"

| # | Segment | Time | Work | Rest | Exercise |
|---|---|---|---|---|---|
| 0 | Gate (warm-up) | 0:00–1:30 | 90s | — | 40 jumping jacks at easy pace, then 8 slow bodyweight squats. Framed as "the gate mechanism warms up". |
| | **FLOOR 1 — lap 1** | | | | |
| 1 | Room 1-A | 1:30–2:15 | 40s | 25s corridor | 14 squats |
| 2 | Room 1-B | 2:15–3:00 | 40s | 25s corridor | 30 jumping jacks |
| 3 | Room 1-C | 3:00–3:45 | 40s | 25s corridor | 16 alternating lunges (8/leg) |
| | **FLOOR 1 — lap 2** | | | | |
| 4 | Room 1-A' | 3:45–4:30 | 40s | 25s | 14 squats |
| 5 | Room 1-B' | 4:30–5:15 | 40s | 25s | 30 jumping jacks |
| 6 | Room 1-C' | 5:15–6:00 | 40s | 25s | 16 alternating lunges |
| 7 | **Stairwell** | 6:00–6:45 | — | 45s | Long rest. Story beat, floor-1 loot summary. |
| | **FLOOR 2 — lap 1** (shorter rest) | | | | |
| 8 | Room 2-A | 6:45–7:30 | 45s | 20s | 16 squats |
| 9 | Room 2-B | 7:30–8:15 | 45s | 20s | 36 jumping jacks |
| 10 | Room 2-C | 8:15–9:00 | 45s | 20s | 18 alternating lunges |
| | **FLOOR 2 — lap 2** | | | | |
| 11 | Room 2-A' | 9:00–9:45 | 45s | 20s | 16 squats |
| 12 | Room 2-B' | 9:45–10:30 | 45s | 20s | 36 jumping jacks |
| 13 | Room 2-C' | 10:30–11:15 | 45s | 20s | 18 alternating lunges |
| 14 | **Boss antechamber** | 11:15–12:00 | — | 45s | Rest. Boss telegraph, gear equip. |
| 15 | **BOSS — phase 1** | 12:00–12:50 | 50s | 25s | AMRAP squats (target 20+) |
| 16 | **BOSS — phase 2** | 13:15–14:00 | 45s | — | AMRAP jumping jacks (target 45+) |
| 17 | Cooldown chamber | 14:00–15:00 | 60s | — | Guided stretch prompts; summary; XP; next-session preview |

**Week-1 volume:** ~84 squats, ~171 jumping jacks, ~68 lunges. **~5:30 total work in 15:00**, work:rest ≈ 1:1 on floor 1 tightening to ~2:1 on floor 2, plus a finisher. That is a legitimate metabolic conditioning session, and the escalating work:rest ratio is what makes it feel like a dungeon getting harder rather than a spreadsheet.

**No pushups anywhere in the critical path.** Pushup rooms exist only as **optional side-chambers**: a locked door offering a bonus chest for 10 pushups. If detection fails, the player loses a bonus, never progress. This gives the BETA recognizer real-world data at zero cost to the session.

### Variants

- **Short (10:00):** drop Floor 2 lap 2, shorten the boss to one phase.
- **Long (22:00):** three floors, three-exercise circuit each, two boss phases plus a "gauntlet" corridor.
- **Recovery day (8:00):** all rooms at 60% volume, longer rests, framed as "scouting" — exists so that a player's streak survives a day when they're wrecked. Losing a streak to an all-or-nothing session is the most common reason fitness apps get uninstalled.

---

## 4. Narrative and loot — carrying the boring parts

Sets 4 through 12 are the hard, unglamorous middle of any workout. That is where people stop. Everything below exists to get the player through it.

### 4.1 The chest is on the other side of the set

Loot is never awarded *before* work and never awarded on a timer. Every room-clear rolls a chest. Rarity weights by room rating:

| Room rating | Criteria | Common | Rare | Epic |
|---|---|---|---|---|
| S | 100% of target reps, avg formScore ≥ 0.85 | 40% | 45% | 15% |
| A | ≥ 90% reps, avg formScore ≥ 0.75 | 60% | 35% | 5% |
| B | ≥ 70% reps | 82% | 18% | 0% |
| C | anything completed | 95% | 5% | 0% |

The rating is shown *immediately* on room clear with a big letter and a one-line reason ("A — 3 shallow reps"). Immediate, specific, non-judgemental.

### 4.2 What loot may and may not do

**Hard rule: loot may never reduce the amount of exercise required.** No item makes the sets shorter, no item makes reps count double, no item lets you skip a room. The moment gear can substitute for work, the product's purpose inverts and the player optimises toward doing less.

What loot *may* do:
- **Cosmetics.** Most of it. Armour, weapons, character skins, torch colours, pet companions. Cosmetics are infinite and cost nothing to the training program.
- **Narrative keys.** Unlock new dungeons, floors, boss encounters, side-chambers, lore.
- **Rest charms — the one bounded exception.** A charm may grant up to +5s rest on a specific room type, capped at one equipped charm and never below the 18s rest floor. This is a real, felt benefit that a struggling player can earn, and it is small enough not to hollow out the session.
- **Score multipliers** on the game-facing score. Never on `workout/summary.score` (see §5).

### 4.3 The run persists across sessions

The dungeon is not restarted each session. You are 3 floors into the Sunken Vault; today you clear floors 4 and 5. **A workout you skip is a dungeon you left a character standing in.** That framing is a far stronger pull than a streak counter, because it is a place rather than a number.

Practical consequence: the dungeon must have a natural "chapter" length of roughly 8–12 sessions (~3 weeks), ending with a real boss and a real narrative payoff, then a new dungeon opens. Three weeks is roughly the horizon over which a new exercise habit either sticks or doesn't, so the first chapter's ending should land exactly where most people quit.

### 4.4 Story delivery

All narrative is delivered in corridors and rests. Two to four lines of dialogue, voiced or text, over a static scene. Never during a set — the player is breathing too hard to read.

---

## 5. Using `input/intensity` and `workout/progress`

### 5.1 Intensity as a first-class mechanic

`input/intensity` gives `{instant, avg10s}` at 5Hz. This is the only channel that reports *how hard the player is actually working*, independent of rep counting, and this game is the one that should build on it.

**The Torch.** The character carries a torch whose brightness tracks `avg10s`. Each room declares a target intensity band:

```
Floor 1 rooms:  target avg10s >= 0.45
Floor 2 rooms:  target avg10s >= 0.60
Boss phases:    target avg10s >= 0.75
```

- Above target: torch burns bright, room is fully lit, enemy takes normal damage.
- Below target for 6+ continuous seconds: torch dims, the room darkens at the edges, enemies **regenerate 4% HP/s**. No text, no scolding — the room just gets dark and the enemy stops dying.
- Sustained above target for a full room: **Ember** bonus, +1 rarity tier on the chest roll.

This is the mechanic that stops a player from doing technically-complete but effortless reps. It is also entirely wordless, which matters — nobody wants to be nagged by their exercise game.

**Safety valve, in the other direction.** If `instant > 0.90` for 60 continuous seconds, or `avg10s > 0.85` across two consecutive rooms, the game inserts an unscheduled "collapsed passage" corridor: +30s rest, framed as a story beat, no penalty, no rating impact. The player must never learn that the game will let them redline indefinitely.

**During rest, intensity should fall.** If `avg10s` hasn't dropped below 0.5 by the end of a corridor, extend the corridor by up to 15s. Recovery is part of the program, and the game should measure whether it actually happened rather than assume it.

### 5.2 `workout/progress`

This game has the richest progress channel of the four. Emit on every room clear and every corridor entry:

```js
eg.progress({
  phase:        'room' | 'corridor' | 'boss' | 'cooldown',
  roomIndex:    9,
  roomsTotal:   17,
  floor:        2,
  exercise:     'jumping_jack',
  setReps:      34,
  setTarget:    36,
  setFormAvg:   0.81,
  sessionReps:  { squat: 44, jumping_jack: 96, lunge: 34 },
  elapsedMs, activeMs,
});
```

The console can use this for a persistent progress ring outside the iframe, and later for the cross-game profile. It also means a session interrupted at minute 11 still has 11 minutes of structured, attributed data — which matters enormously for §6.

### 5.3 `workout/summary`

```js
eg.summary({
  reps:          totalReps,
  activeSeconds: sumOfRoomWorkSeconds,      // excludes corridors, pause, tracking loss
  avgIntensity:  meanOfAvg10sDuringRoomsOnly,   // corridors would drag it down
  score:         consoleScore,
});
```

`consoleScore` is effort-normalized and **loot-independent**, consistent with every other PRIMAL game:

```
consoleScore = round( sum over sets of (reps * (0.5 + formScore) * exerciseWeight)
                      * intensityBandBonus )
exerciseWeight: squat 1.0, lunge 1.0, pushup 1.2, jumping_jack 0.45
intensityBandBonus: 1.0 baseline, 1.15 if the set met its intensity target
```

No gear multiplier reaches this number. The console-facing score must track the workout, or the profile and any future currency will drift away from reality.

---

## 6. Progressive overload — the retention engine

This is the most important section in the document.

The reason a fitness game beats a fitness video is that it can **adapt**. A player who does the same 15-minute circuit for 8 weeks stops improving and gets bored simultaneously — the stimulus and the novelty run out together. A program that gets measurably harder as the player gets fitter solves both, and it is the thing that makes Workout Quest a product people use in month 6 rather than week 2.

### 6.1 The progression rule

Per exercise, per session, evaluate:

```
completion = actualReps / targetReps       (averaged across that exercise's sets)
quality    = mean formScore of those reps
shallowPct = fraction of reps with 'shallow' or 'partial'

PROGRESS  if completion >= 0.95 AND quality >= 0.78 AND shallowPct <= 0.15
   -> next session targetReps += ceil(targetReps * 0.06), min +1
HOLD      if completion >= 0.80
   -> targetReps unchanged
DELOAD    if completion < 0.80, OR two consecutive HOLDs with quality < 0.70
   -> next session targetReps -= ceil(targetReps * 0.12)
```

Constraints:
- **Cap weekly increase at 10% per exercise.** Faster than that outruns tissue adaptation and produces soreness that stops people training.
- **Never increase two consecutive sessions if the sessions were less than 36 hours apart.** Recovery is part of progression.
- **After a gap of ≥ 10 days, deload 15%** and label it "shaking off the rust" rather than punishing the player. Coming back after a break is the highest-churn moment in any fitness product; make the return session feel achievable.
- **Advance work density before rep count** once rep counts get long: at squat target > 22, prefer cutting corridor rest by 3s (floor 18s) over adding reps. Long sets become cardio; shorter rest is the better stimulus and keeps the session at 15 minutes.

### 6.2 The 15-minute box is inviolable

**Progression never lengthens the session.** 15 minutes is the promise, and "it only takes 15 minutes" is the reason the player starts. Progression increases *density* — more reps and less rest inside the same box. When the box is genuinely full (rest at the 18s floor and rep targets at the top of what fits in a 45s room), the player graduates to a new dungeon tier with harder exercise variants (jump squats, split squats, tempo squats) rather than a longer session.

That graduation moment — "the Vault is too easy for you now; the Deepworks have opened" — is the single best retention beat in the design. It is a fitness milestone and a narrative milestone at the same time, and it is earned by real physical improvement.

### 6.3 Character stats mirror real progress

The character sheet is generated from training data, not from XP spent:

| Character stat | Derived from |
|---|---|
| STRENGTH | rolling 4-session mean of squat + lunge target reps |
| ENDURANCE | rolling mean of `activeSeconds` at `avg10s ≥ 0.6` |
| TECHNIQUE | rolling mean `formScore` across all reps |
| RESOLVE | current streak + session completion rate |

Stats are read-only and cannot be bought. When STRENGTH goes from 14 to 15, it is because the player can genuinely do more squats. **This is the honest version of an RPG progression bar, and it is a better one** — the number going up is real, and the player knows it.

Show the four stats on the cooldown screen every session with the delta. That 20-second screen is where the habit is actually built.

---

## 7. Screen layout (sketch)

**In-room (during a set):**

```
+--------------------------------------------------------------------------+
|  FLOOR 2  -  ROOM 9 / 17            [####----] 11:04 left    * TORCH *   |
|                                                                          |
|                          ##################                              |
|                          #                #                              |
|                          #     ( x_x )    #   <- enemy, HP = reps left   |
|                          #      \ | /     #                              |
|                          #      HP [####--------]                        |
|                          #                #                              |
|                          #    \O/         #   <- your character,         |
|                          #     |          #      mirrors rep phase       |
|                          #    / \         #                              |
|                          ##################                              |
|                                                                          |
|  +--------------------------------------------------------------------+  |
|  |  JUMPING JACK      34 / 36        [###########-----]  9s            |  |
|  |  FORM  [========|===]  0.81       INTENSITY [#######|--]  0.66  OK  |  |
|  +--------------------------------------------------------------------+  |
|                                                        +----------+      |
|                                                        |  webcam  |      |
|                                                        +----------+      |
+--------------------------------------------------------------------------+
```

Room edges physically darken as the intensity bar drops below the room's target band — the vignette is the feedback, the bar is just the explanation.

**Corridor (rest):**

```
+--------------------------------------------------------------------------+
|  FLOOR 2                                                     10:19 left  |
|                                                                          |
|                    ROOM 9 CLEARED        [ A ]                           |
|                    34/36 reps - 3 shallow - form 0.81                    |
|                                                                          |
|              \O/  ---->                          [=]                     |
|               |                                 chest                    |
|              / \                                                         |
|      ================================================                    |
|                                                                          |
|                          R E S T   1 4                                   |
|                                                                          |
|      "The lunge is coming. Front knee over the ankle, not past it."      |
|                                                                          |
|      NEXT:  ROOM 10  -  18 ALTERNATING LUNGES                            |
+--------------------------------------------------------------------------+
```

The character auto-walks toward the chest and the timer; the player does nothing. Rating, loot, coaching cue, and the next-room preview all live here. Everything the player needs to think about is in the rest, by construction.

---

## 8. Why this is the best long-term retention candidate

Ranked against the other three:

1. **It has a reason to exist tomorrow.** `dodge-collect` and `rep-battle` are sessions; Workout Quest is a *program*. Programs have a next session by definition. "Floor 5 tomorrow" beats "play again sometime".
2. **It is the only one that improves with the player.** The other three have a fixed difficulty ceiling that a fit player exhausts. Progressive overload means Workout Quest is still appropriately hard in month 6 — which is exactly when everything else has been abandoned.
3. **It produces the most exercise per minute of screen time.** ~5:30 of work in 15:00, at controlled intensity, hitting the whole body. `dodge-collect` produces high intensity but no strength stimulus and no progression. `rep-battle` has volume but one exercise per fight.
4. **Its data is the best.** Structured sets with targets, completion rates, and form scores are exactly what a fitness profile needs. `dodge-collect` produces "you jumped 34 times", which is much weaker evidence of progress.
5. **It is the safest.** Rests are scheduled, intensity has a ceiling as well as a floor, and the deload rules mean a player who is struggling gets an easier session rather than a failure screen.
6. **It has the honest progression story.** STRENGTH 15 means something. Every other game's progression is a number we made up.

The cost: it needs the profile/persistence layer (`roadmap.md`, near horizon) before it can exist at all, plus content — dungeons, rooms, loot, dialogue — which is real production work that neither MVP game requires. That is why it isn't the MVP. It should be the **first post-MVP game**, and the profile work should be scheduled with it as the driving customer.

---

## 9. Prerequisites

1. **Cross-game player profile with per-exercise history** — the progression rule in §6.1 needs at minimum the last 4 sessions per exercise. Without persistence, this game cannot exist.
2. **`workout/progress` accepted mid-session by the console** and durably stored, so a session abandoned at minute 11 still advances the dungeon and still feeds progression.
3. **Reliable `lunge`** — it is one of three core exercises here. If the recognizer isn't ready, substitute a second squat variant and design the lunge circuit for later.
4. **`input/intensity` validated against something real** (perceived exertion or a heart-rate strap on a handful of testers). §5.1's thresholds (0.45 / 0.60 / 0.75) are guesses until someone checks them. Getting these wrong makes the torch mechanic either trivial or infuriating.
5. **Content pipeline** — a data-driven room/dungeon format (JSON: rooms, exercises, targets, dialogue, loot tables) so that new dungeons are authored, not coded. Build this before the first dungeon, not after the third.
