# Rep Battle — Build Plan (Launch Game 1)

**Status:** BUILD. Second game implemented (after `dodge-collect` proves the platform).
**Repo:** `primal-game-rep-battle`
**API surface proved:** `input/rep` (count + `formScore` + `flags` + `durationMs`), `input/rep_progress` for in-rep feedback.
**Workout type:** strength / muscular endurance.
**Session length:** 8–11 minutes for one full boss fight.

Turn-based boss fight in the shape of a Pokémon battle. Your attack is a *set*. The boss's turn is your *rest interval*. PvE against a scripted AI boss for MVP.

---

## 1. Why this shape

The turn-based RPG structure is not a theme choice, it is a **physiological fit**.

Strength training is intrinsically interval-shaped: a set of 8–15 reps, then 40–90 seconds of rest, repeated. Almost every real-time game design fights that structure — it wants continuous input. A turn-based battle *wants* the player to stop and watch for 40 seconds. The rest interval, which every other fitness game has to awkwardly bolt on, is here the most narratively important part of the game: the boss's turn.

That is the whole insight. Everything else follows from it.

---

## 2. Core loop, second by second

One **turn cycle** is 72 seconds. A fight is 8–10 turn cycles.

```
T+0.0   BOSS TELEGRAPH        (3s)   Boss winds up, shows next-turn intent.
                                     Banner: "STONE SENTINEL braces. HARDEN."
T+3.0   ATTACK CALL           (4s)   Game names the exercise + target for this window.
                                     "SQUAT x12 — DEPTH MATTERS"
                                     3-2-1 countdown, last beat is loud.
T+7.0   ATTACK WINDOW        (35s)   *** THE SET ***
                                     Player performs reps. Every rep resolves live:
                                       - rep_progress drives a charge/weapon wind-up
                                       - rep event fires a strike, damage number, hit-stop
                                     Timer bar drains. Target-rep pip row fills.
T+42.0  WINDOW RESOLVE        (3s)   Sum shown: reps, avg form, combo, TOTAL DAMAGE.
                                     Boss HP bar drains in one satisfying sweep.
T+45.0  BOSS TURN            (24s)   *** THE REST INTERVAL ***
                                     Boss animates its attack. Player HP drops.
                                     Big centre countdown: "REST 24 ... 23 ...".
                                     Coaching line: "Breathe. Shake out your legs."
                                     Optional: one 'block' gesture in a 2s window
                                     to halve incoming damage (see 6.3).
T+69.0  NEXT TURN PREVIEW     (3s)   "NEXT: JUMPING JACK x30" — lets the player
                                     mentally prepare and reposition.
T+72.0  -> next cycle
```

**Work:rest is 35:37 — almost exactly 1:1.** That is the right ratio for a moderate-intensity muscular-endurance circuit. It is short rest for pure strength work, which is deliberate: we are optimising for *total volume and heart rate*, not for a 1RM.

### Per-fight volume

| | |
|---|---|
| Attack windows per fight | 8 (short boss) — 10 (long boss) |
| Reps per window | 10–16 depending on exercise and tempo |
| **Total reps per fight** | **90–130** |
| Total time under tension | ~4:40 of the ~10:00 fight |
| Realistic session | 1 fight, or 2 fights with 3 min between |

90–130 reps of bodyweight squats and jumping jacks in 10 minutes is a genuine workout. A player who finishes a fight has done real work — that is the bar every design decision here is judged against.

---

## 3. The damage formula

Both **how many** reps and **how good** they were must matter, and neither may dominate. If reps dominate, players bounce shallowly and fast. If form dominates, players do 4 perfect reps and stop. The formula below makes a sloppy rep worth roughly a quarter of a clean one, so grinding out garbage volume is strictly worse than doing it properly — but doing it properly *and* more is best.

### 3.1 Per-rep damage

```
repDamage = BASE
          * qualityMult(formScore)
          * flagMult(flags)
          * tempoMult(durationMs, exercise)
          * comboMult(cleanStreak)
          * archetypeMult(boss, exercise, rep)
```

**BASE = 10**

**qualityMult** — linear, steep, floored:
```
qualityMult = 0.40 + 1.20 * formScore        // formScore 0.0 -> 0.40
                                             // formScore 0.5 -> 1.00
                                             // formScore 1.0 -> 1.60
```
A perfect rep is **4× a garbage rep**. That ratio is the single most important tuning number in the game.

**flagMult** — multiplicative, floored at 0.25:
```
shallow    x 0.50     // didn't hit depth. The one we punish hardest.
partial    x 0.40     // didn't complete the rep at all
fast       x 0.70     // bounced through it; no control
asymmetric x 0.80     // favouring one side

flagMult = max(0.25, product of applicable penalties)
```
`shallow` and `partial` are the flags that correspond to the player cheating themselves out of the actual training stimulus, so they carry the heaviest penalties. `fast` is penalised but not brutally — some players are genuinely explosive.

**tempoMult** — rewards controlled depth, punishes bouncing, mildly discourages stalling:
```
squat / lunge / pushup:          jumping_jack:
  <1200ms  -> 0.55                 <400ms  -> 0.60
  1200-1900 -> lerp 0.55..1.00     400-650 -> lerp 0.60..1.00
  1900-3800 -> 1.00  (ideal)       650-1100 -> 1.00 (ideal)
  3800-5500 -> lerp 1.00..1.15     1100-1600 -> lerp 1.00..0.85
  >5500    -> 0.85 (stalling)      >1600   -> 0.70
```
Note squats get a **bonus above 3.8s** (up to 1.15×) — slow eccentrics are good training and the game should say so. Beyond 5.5s you're resting, not repping, and it decays. Jumping jacks are cardio, so slow is simply worse.

**comboMult** — rewards *consistency within a set*, which is what actually degrades when someone is tired and starts cheating:
```
A rep is CLEAN if formScore >= 0.75 AND flags is empty.
cleanStreak increments on clean reps, resets to 0 on any non-clean rep.
comboMult = 1.0 + 0.05 * min(cleanStreak, 10)      // caps at 1.50x
```
The cap at 10 matters: a 12-rep set can reach full combo, so the incentive is "keep every rep of this set clean", not "do 40 reps".

**archetypeMult** — the boss-specific mechanic. See §5.

### 3.2 Window bonuses

```
windowDamage = sum(repDamage) + targetBonus + flawlessBonus

targetBonus   = 0.25 * sum(repDamage)   if reps >= targetReps
flawlessBonus = 0.20 * sum(repDamage)   if reps >= targetReps AND zero flagged reps
```

Hitting the target rep count is worth +25%. That is a big, legible number and it is what makes players push out reps 11 and 12 when their legs are burning. **This is the mechanic that produces the last, most valuable reps of every set.**

### 3.3 Worked examples

| Scenario | Reps | Avg form | Flags | Total window damage |
|---|---|---|---|---|
| Sandbagger: fast shallow bouncing | 18 | 0.35 | shallow+fast on 15 | ~118 |
| Honest beginner | 11 | 0.68 | shallow on 3 | ~166 |
| Target hit, decent form | 12 | 0.80 | shallow on 1 | ~247 |
| Target hit, flawless | 12 | 0.92 | none | ~372 |

The sandbagger doing **50% more reps** deals **less than a third** of the damage of the clean player. That relationship is the design working. Verify it holds after any tuning change — write it as a unit test with fixed fixtures.

### 3.4 Boss HP tuning

Target: a competent player at good form clears a standard boss in **8 windows**.

```
expected clean window damage  ~ 250-300
standard boss HP              = 2,200      (8 windows @ ~275)
elite boss HP                 = 2,900      (10 windows)
```
Tune HP, never the formula. The formula encodes the training values; HP is just pacing.

---

## 4. `input/rep_progress` — making a set feel good

The `input/rep` event fires *after* a rep completes. If that is the only feedback, the set is 35 seconds of silence punctuated by numbers. `rep_progress` is what makes it feel like a fight. Subscribe at whatever rate the console offers and drive these:

| Phase | `progress` | On-screen |
|---|---|---|
| `down` | 0 → 1 | Hero raises weapon; **charge ring** fills around the hero clockwise. Audio: a rising whoosh whose pitch tracks `progress`. Screen edges pull inward slightly (0 → 6px vignette). |
| `bottom` | 0 → 1 | Charge ring locks. If it reached ≥ 0.90 before `bottom`, the ring **flashes gold** and a "DEPTH" chip pops. If it capped below 0.65, the ring stays grey and a "GO DEEPER" ghost line appears at the depth you failed to reach. |
| `up` | 0 → 1 | Weapon swings down in sync with `progress`. Impact happens at `progress ≈ 0.85`, **not** at rep completion — landing the hit slightly early feels responsive and hides 100ms of pipeline latency. |
| `rest` | — | Hero returns to idle; charge ring dims. If `rest` persists > 4s mid-window, a soft "keep going" pulse. |

Then when `input/rep` arrives:
- **Hit-stop**: freeze the whole scene for 60ms (clean rep) / 30ms (flagged rep). Cheapest, highest-impact juice in the game.
- **Damage number** flies off the boss, sized and coloured by `repDamage`: grey <8, white 8–20, orange 20–35, gold >35.
- **Screen shake**: amplitude `min(6, repDamage * 0.15)` px, 120ms decay.
- **Combo pip** lights up in the streak row.
- **Flag callout**: on `shallow`, a red "SHALLOW" tag with the depth ghost line. **Never scold in words** — no "bad rep!". Show the miss geometrically and let the number be small. The player learns from the small number.

**Critical rule: the depth feedback must be visible *during* the rep, not after.** `rep_progress.phase === 'down'` with `progress` plateauing below 0.65 is the moment to show the "go deeper" line — while the player can still act on it. After-the-fact correction changes nothing about the rep they just did.

---

## 5. Boss design

A boss is defined by (a) which exercise it demands, (b) an `archetypeMult` rule that makes one *aspect* of the exercise matter more, and (c) a phase structure. The rule must be teachable in one banner line.

### 5.1 The Stone Sentinel — depth (squat)

- **Exercise:** `squat` throughout. 8 windows, target 12 reps, HP 2,200.
- **Rule:** *Armour.* Any rep with `formScore < 0.60` or a `shallow`/`partial` flag deals **only 20%** damage (`archetypeMult = 0.2`). Clean deep reps ignore armour entirely (1.0).
- **Why:** teaches depth, which is the single highest-value squat cue and the thing every beginner cheats. The armour makes the lesson unmissable: half-reps do essentially nothing.
- **Phases:** at 66% HP it *hardens* — armour threshold rises to `formScore < 0.70`. At 33% it *cracks* — armour off, but target reps rise to 15 and the window shortens to 30s. The final phase is the burnout set.
- **Boss turn:** slow ground-pound, 24s. Very readable telegraph.

### 5.2 The Gale Swarm — volume and pace (jumping_jack)

- **Exercise:** `jumping_jack`. 9 windows, target 30 reps, HP 2,000 total but distributed across spawning motes.
- **Rule:** *Dispersal.* Each rep kills one mote regardless of form (`archetypeMult` ignores `qualityMult` down-weighting: floor the quality term at 0.85). **But the swarm respawns 1 mote every 1.6s during the window.** Falling below ~1 rep/1.6s means net zero progress.
- **Why:** this is the cardio boss. It rewards sustained pace over perfection, which is correct for jumping jacks — and it produces genuinely elevated heart rate. The respawn timer is a pace-maker: it converts "do 30 jacks" into "do not slow down".
- **Phases:** 66% respawn drops to 1.3s, 33% to 1.0s. Window length stays 35s throughout.
- **Boss turn:** 24s, and the swarm visibly re-gathers — the rest interval is *legible as the enemy recovering too*, which makes resting feel tactical rather than like stopping.

### 5.3 The Twin Effigy — symmetry (lunge)

- **Exercise:** `lunge`. 8 windows, target 14 (7/leg), HP 2,400.
- **Rule:** *Two bodies.* The boss is two linked halves with separate HP pools. Damage routes to the half matching the lunging leg. **If either half is more than 25% ahead of the other, the lagging half regenerates 8 HP/s.** An `asymmetric` flag applies an extra ×0.6.
- **Why:** unilateral work exposes and corrects left/right imbalance, which is the actual training value of lunges. The regen mechanic makes alternating legs mandatory rather than a suggestion, and does it without a nag.
- **Phases:** at 50% the halves start *swapping positions* on the boss turn, so the player must watch the telegraph to know which leg leads.
- **Note:** `lunge` recognizer maturity is "decent", not first-class. Ship this boss **after** launch, gated on recognizer confidence in playtests. If leg-side detection is unreliable, fall back to "alternate on the game's cadence" and use `asymmetric` only.

### 5.4 Pushup — bonus only, never critical path

The `pushup` recognizer is BETA and unreliable from a front-on webcam. **No boss requires pushups and no fight can be blocked by them.**

Pushups appear only as an **optional Overkill window**: after a boss dies, the player may accept a 20-second bonus round for cosmetic currency. If detection fails, nothing is lost — the player still won the fight. This gives us a live, zero-risk data channel for improving the recognizer. When it graduates from BETA, a fourth boss archetype gets designed around it.

---

## 6. Pacing, difficulty, and not being a jerk

### 6.1 Difficulty tiers

The player picks a tier before the fight. Tiers change **target reps and rest**, never the damage formula.

| Tier | Target reps (squat) | Window | Boss turn (rest) | Windows | Est. total reps |
|---|---|---|---|---|---|
| Recruit | 8 | 35s | 35s | 8 | 60–75 |
| Standard | 12 | 35s | 24s | 8 | 90–110 |
| Veteran | 15 | 32s | 20s | 10 | 130–160 |

**The rest interval is the difficulty knob, not the rep count.** Shortening rest from 35s to 20s is a far bigger training-load increase than adding 4 reps, and it is the honest way to make the game harder for a fitter player.

### 6.2 Rest is sacred

Hard rules, enforced in code:

- **Minimum boss turn is 18 seconds.** No tier, no phase, no combo state may shorten it below that. A player who is not recovered does worse reps and gets hurt.
- **No player input is required during the first 15s of the boss turn.** The optional block (§6.3) always lands in the last 6s.
- The rest countdown is displayed **large and centred**. The player is breathing hard and should not have to hunt for it.
- Coaching lines rotate on the boss turn: "Breathe out on the way up next set." / "Heels down." / "Shake out your legs." One line, big text, changes every ~8s. This is the only place in the game we give technique cues, because it is the only place the player can absorb them.
- **After 4 windows, insert an extended intermission** (60s) framed as a story beat — the boss retreats to a second arena. Mid-workout recovery, disguised.

### 6.3 The optional block

In the last 6 seconds of the boss turn a 2-second window opens for a `block` gesture (arms crossed). Blocking halves incoming damage.

Keep it optional and keep it cheap: it is one arm movement, it re-engages attention right before the next set, and it gives the boss turn a beat. It must never be required — a player who is genuinely gassed and ignores it should still be fine.

### 6.4 Failure and retry

Player HP exists to create tension, not to eject people from workouts.

- **Boss damage scales inversely with your last window's performance:**
  ```
  bossDamage = BOSS_BASE * (1.25 - 0.75 * lastWindowPerformance)
  lastWindowPerformance = clamp(windowDamage / expectedWindowDamage, 0, 1)
  ```
  Doing well protects you. Doing badly hurts more — but see below.
- **Player HP = 1000. BOSS_BASE ≈ 110.** A player performing at ~60% survives ~11 boss turns, which is longer than any fight. **You have to be trying to fail.**
- **At 0 HP: Second Wind, not Game Over.** The screen reads "SECOND WIND". The player continues from the boss's *current HP* with 400 HP restored, after a **45-second forced rest**. This costs a cosmetic rank on the post-fight card and nothing else. Unlimited Second Winds.
  - Rationale: a player who is struggling has, by definition, been working hard. Sending them to a defeat screen and a re-fight from full boss HP means they quit and don't come back. **The workout already happened. Bank it.**
- **Quit mid-fight** still sends a full `workout/summary` with everything done so far. Partial workouts count. Always.
- **Two consecutive windows below 40% of target** → the game silently offers "Drop to Recruit?" as a one-tap option on the next boss turn. Offered once. Never mentioned again if declined.

---

## 7. Screen layout

**During an attack window:**

```
+--------------------------------------------------------------------------+
|                        STONE SENTINEL                                    |
|            [##################################----------]  1,420 / 2,200 |
|                     PHASE 2 - HARDENED                                   |
|                                                                          |
|                              /\_/\                                       |
|                             ( o.o )      <- boss sprite, idle-breathing  |
|                             > ^ <          flinch anim on each rep       |
|                                                                          |
|                                       -47  -52  -38   <- damage floaters |
|          _O_                                                             |
|         /|\        <- hero sprite, mirrors your rep phase                |
|         / \           charge ring around it, fills with rep_progress     |
|                                                                          |
|  +--------------------------------------------------------------------+  |
|  |  SQUAT   x12          [##########------]  22s                      |  |
|  |  REPS  * * * * * * * o o o o o        9 / 12                       |  |
|  |  CLEAN STREAK  ######____  6      x1.30                            |  |
|  |  DEPTH  [======|=====]  0.86        WINDOW DMG   284               |  |
|  +--------------------------------------------------------------------+  |
|  YOU  [########################------]  740/1000        +---------+     |
|                                                          | webcam  |     |
|                                                          | preview |     |
|                                                          +---------+     |
+--------------------------------------------------------------------------+
```

**During a boss turn (rest):**

```
+--------------------------------------------------------------------------+
|                        STONE SENTINEL                                    |
|            [##################################----------]  1,420 / 2,200 |
|                                                                          |
|                          *** SLAM INCOMING ***                           |
|                              /\_/\                                       |
|                             ( >_< )   <- big wind-up animation           |
|                                                                          |
|                                                                          |
|                              R E S T                                     |
|                                                                          |
|                                1 8                                       |
|                                                                          |
|                   "Breathe. Shake out your legs."                        |
|                                                                          |
|            NEXT:  SQUAT x12        BLOCK window in 12s                   |
|  YOU  [########################------]  740/1000                         |
+--------------------------------------------------------------------------+
```

Layout rules:
- **Rep pips, timer, and clean-streak live in a single bottom band.** The player is squatting and their gaze naturally drops; put the set-critical info low. Boss HP is up top where it can be glanced at between reps.
- **The depth bar is the only continuous element in the band** and it is the one the player watches during the descent. Give it the "target" tick mark at the depth that stops earning `shallow`.
- During rest, the rest countdown is the largest element on screen by a wide margin.
- Webcam preview: `sm`, bottom-right during windows; **hidden during boss turns** (`ui/setPreview {visible:false}`) so the player looks at the coaching line instead of at themselves.
- 1280×720 render target, DPR capped at 1.5.

---

## 8. PixiJS scene and asset list

### Scene graph

```
app.stage
├── bgLayer                 1 sprite + 1 parallax sprite, tinted per phase
├── battleLayer
│   ├── bossContainer       boss sprite + shadow + phase-tint overlay
│   ├── heroContainer       hero sprite + weapon sprite + charge ring (Graphics)
│   └── fxLayer             impact sprites, dust, pooled (cap 40)
├── floaterLayer            damage numbers — pooled BitmapText, cap 24
├── hudLayer
│   ├── bossHpBar           2 Graphics rects + BitmapText  (lag-bar: a red
│   │                       trailing rect that catches up over 400ms)
│   ├── playerHpBar         same pattern
│   ├── setBand             timer bar, rep pips, streak pips, depth bar, dmg total
│   └── bannerText          BitmapText, large
└── overlayLayer            countdown, rest card, second wind, summary, pause
```

### Performance rules

Same platform constraints as `dodge-collect` — MediaPipe owns the GPU:
- Single 2048² atlas. BitmapText everywhere. Pooled floaters and FX. **No filters.**
- This game is *far* cheaper than dodge-collect: static camera, ≤ 60 sprites on screen. Budget headroom should go into hit-stop, shake, and particle punch on rep impact, because that is what makes a set feel worth doing.
- Fixed 60Hz simulation, interpolated render, degrade render to 30fps below 45fps average.
- Idle-breathing animations on both characters at all times — a static screen during a 24s rest looks broken.

### Asset list

| Asset | Notes |
|---|---|
| `atlas.png/.json` | 2048² |
| Hero | idle (4f), squat-down (4f), squat-up (4f), strike (5f), hit (2f), victory (6f) |
| Boss ×3 | idle (4f), telegraph (5f), attack (6f), flinch (2f), phase-shift (4f), death (8f) |
| Charge ring | 1 radial-mask sprite, rotated/masked by Graphics |
| Impact FX | 4 sprites + 3 dust sprites |
| Arena backgrounds ×3 | 1 bg + 1 parallax layer each |
| HUD frame | 9-slice panel, 2 bar textures |
| Bitmap font | 3 sizes: floaters, HUD, banner |
| SFX | rep-charge loop, impact (3 variants by damage tier), shallow-thud, target-hit fanfare, boss telegraph, boss attack, phase shift, victory, rest-tick |
| Music | 2 loops (battle, phase-3 intensity) + victory sting |

Asset budget **under 5MB**.

---

## 9. SDK usage — exact calls

```js
import { createClient } from '@bosco98/primal-sdk';

const eg = await createClient();

await eg.subscribe({
  channels:   ['rep', 'rep_progress', 'gesture', 'intensity', 'tracking'],
  exercises:  ['squat', 'jumping_jack', 'lunge'],   // pushup added only for the
                                                     // optional Overkill round
  bodyRateHz: 0,                                     // no continuous body stream needed
});

eg.setPreview({ corner: 'bottom-right', size: 'sm', visible: true });
```

`bodyRateHz: 0` is deliberate and worth a comment in the source: this game does not need the 30Hz body stream, and not requesting it leaves console budget free.

```js
// --- the set --------------------------------------------------------------
eg.on('input/rep', (r) => {
  if (state !== 'ATTACK_WINDOW') return;      // reps outside the window are ignored
  if (r.exercise !== currentWindow.exercise) {
    showWrongExerciseHint(r.exercise);        // gentle, no penalty
    return;
  }
  if (seenRepIds.has(r.repId)) return;        // idempotency — repId is the dedupe key
  seenRepIds.add(r.repId);

  const dmg = computeRepDamage(r);            // §3.1
  applyDamage(dmg, r);
  juice(dmg, r.flags);                        // hit-stop, shake, floater, pips
});

eg.on('input/rep_progress', (p) => {
  if (state !== 'ATTACK_WINDOW') return;
  driveChargeRing(p.phase, p.progress);       // §4
  if (p.phase === 'down' && p.progress > 0.35) trackDepthPlateau(p.progress);
  if (p.phase === 'up'   && p.progress >= 0.85 && !struckThisRep) fireStrikeAnim();
});

eg.on('input/gesture', (g) => {
  if (state === 'BOSS_TURN' && blockWindowOpen &&
      g.gesture === 'block' && g.state === 'start') registerBlock();
});

eg.on('input/intensity', (i) => { intensitySum += i.avg10s; intensitySamples++; });

eg.on('tracking/status', (s) => {
  const bad = !s.personDetected || s.quality < 0.5;
  if (bad && state === 'ATTACK_WINDOW') freezeWindowTimer(s.issues);  // §10
  else unfreezeWindowTimer();
});

// --- lifecycle ------------------------------------------------------------
eg.on('session/pause',  () => setPaused(true));    // freezes window timer + all anims
eg.on('session/resume', () => resumeWithCountdown(3));
eg.on('session/end',    () => { sendSummary(); eg.exit({ reason: 'session_end' }); });
```

**`repId` deduplication is mandatory.** Any recognizer can emit a duplicate under retry or reconnect, and in this game a duplicate is free damage. Dedupe on `repId`, not on timestamps.

```js
// --- outbound -------------------------------------------------------------
// once per window resolve
eg.progress({
  phase:      `turn_${turnIndex}`,
  bossHpPct:  bossHp / bossMaxHp,
  reps:       totalReps,
  lastWindow: { exercise, reps, avgFormScore, damage },
});

// on fight end, quit, or session/end — ALWAYS sent, even on quit mid-fight
eg.summary({
  reps:          totalReps,                       // all counted reps, all exercises
  activeSeconds: sumOfWindowSecondsActuallyWorked,
  avgIntensity:  intensitySum / intensitySamples,
  score:         consoleScore,
});
```

`consoleScore`, effort-normalized the same way as every other PRIMAL game — dominated by physical work, not by whether you won:

```
consoleScore = round( sum over all reps of (1 + formScore) * exerciseWeight )
exerciseWeight: squat 1.0, lunge 1.0, pushup 1.2, jumping_jack 0.45
```

Note this is **independent of boss HP and of victory**. A player who loses to the Sentinel having done 110 good squats scores higher than one who wins with 80 sloppy ones. The console-facing number tracks the workout, not the game.

Extra fields to include if the protocol allows game-specific payload (`summary.detail`), because these are what a fitness profile actually wants:
```
detail: {
  perExercise: { squat: {reps, avgForm, shallowPct}, ... },
  windows:     [{exercise, reps, targetReps, avgForm, damage}, ...],
  bestCleanStreak, bossId, difficultyTier, result: 'win'|'secondwind'|'quit'
}
```

---

## 10. Tracking degradation during a set

A set is 35 seconds of committed physical effort. Losing tracking at second 20 and having those reps vanish is the worst possible experience in this game.

- **Freeze the window timer** the moment tracking degrades. The player does not lose time they couldn't use.
- Show the specific fix as a band across the middle: "Step back — too close". Keep the boss and HP visible so the player knows nothing was lost.
- **Damage already dealt this window is kept.** Never roll back.
- On recovery, 3-second countdown, then the timer resumes from where it froze.
- If degradation exceeds **20s**, resolve the window with whatever was earned and proceed to the boss turn. Do not strand the player.
- `activeSeconds` in the summary excludes frozen time. Be honest.

---

## 11. Build order

1. State machine for the turn cycle with a mock rep source (keyboard) — get the 72s loop feeling right *before* any art. Sit through 8 full cycles yourself; if the rest interval is boring, fix it here.
2. Damage formula + unit tests with the four §3.3 fixtures.
3. SDK handshake, real `input/rep`, `repId` dedupe. **Playtest: do one full 8-window fight for real.** This is where you find out if 35s windows and 24s rests are right.
4. `input/rep_progress` juice pass — charge ring, hit-stop, floaters, depth ghost.
5. Stone Sentinel with phases. Ship-quality single boss.
6. Rest-interval polish: coaching lines, block window, intermission.
7. Second Wind, quit-safe summary, tracking freeze.
8. Gale Swarm (second boss, different exercise, proves the archetype system generalises).
9. Art/audio pass.
10. Twin Effigy — **gated on lunge recognizer confidence**, post-launch.
