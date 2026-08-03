# PRIMAL — Post-MVP Roadmap

**Nothing in this document is being built now.** MVP is two games (`dodge-collect`, `rep-battle`) plus the console and SDK. This file exists so that good ideas aren't lost and so that MVP decisions don't accidentally foreclose them.

Everything here is judged against the same bar as the game designs: **does it make the player work out more, or train more consistently?** Features that only make the product look bigger are not on this list.

Horizons are relative to MVP ship, not calendar dates:

- **Near** — the next thing after MVP. Small, unblocks most of the rest.
- **Mid** — needs Near to exist first, or needs real production work.
- **Far** — needs platform capability that doesn't exist yet, or needs a user base.

---

## Dependency spine

```
                    [1] Cross-game profile & fitness stats
                             |
        +--------------------+---------------------+-------------------+
        |                    |                     |                   |
  [2] Currency         [6] Streaks &         [8] Character       WORKOUT QUEST
        |               consistency            stat growth        (first post-MVP
        |                    |                     |                   game)
  [7] Cards / decks     [3] Friends &         (needs per-exercise
                         social                history)
                             |
                    [4a] Async challenges / ghosts
                             |
                    [5] Ranked ladder & leagues
                             |
                    [4b] Real-time PvP matchmaking
                        (also needs latency work)

  [9] Phone-as-camera (WebRTC)  -- independent, unblocks Shadow Boxer + living rooms
  [10] Game registry & open SDK -- independent, needs dodge-collect as template
```

---

# NEAR HORIZON

## 1. Cross-game player profile & fitness stats

A persistent, console-owned record of every session: reps by exercise, `activeSeconds`, `avgIntensity`, form scores, dates. Surfaced as a home-screen dashboard — total reps this week, sessions this month, form trend, a simple "you're getting stronger" line backed by actual numbers.

**Why it matters for the mission:** right now every session evaporates when the iframe closes. A workout you can't see the accumulation of is a workout with no compounding reward, and compounding reward is what turns three sessions into thirty. It is also the only honest feedback loop the product has — a fitness game whose progression bars are made up is just a game.

**Prerequisites:** none beyond MVP. `workout/summary` already carries the right fields; this is storage plus a view. Build it immediately after MVP because **almost everything else on this list depends on it**, and because the two MVP games are already emitting the data with nowhere to put it.

**Do it right the first time:** store per-exercise, per-set granularity, not just session totals. Workout Quest's progressive overload needs set-level history and you will not want to migrate.

## 2. Shared sweat-earned currency

One currency ("Grit", "Sweat", whatever) earned from `workout/summary.score` across all games at a fixed conversion, spendable on cosmetics, character skins, and game unlocks. Because `consoleScore` is effort-normalized by convention (see `game-plans/README.md`), currency is earned by *work done*, not by winning or by grinding a subsystem.

**Why it matters:** it makes every game contribute to one visible pool, so a player who's bored of one game keeps their progress by playing another — the pool is the reason to stay in the ecosystem rather than the specific game. It also gives games a reward economy without each having to invent one.

**Prerequisites:** [1]. Also requires locking down the effort-normalization convention so third-party games can't mint currency by inflating their scores — server-side sanity checks against `activeSeconds` and `reps` before crediting.

**Hard rule to carry forward:** currency must never be spendable on anything that reduces required exercise. Cosmetics and content unlocks only.

## 3. Streaks & consistency mechanics (incl. "gets out of shape" decay)

Day streaks, weekly targets (e.g. 3 sessions/week), and a decay mechanic: your character visibly gets out of shape when you don't train. Rendered, not just numbered — the fighter softens, the dungeon crawler's stats slide.

**Why it matters:** consistency is the single largest determinant of fitness outcome, and it is the thing games are best at manipulating. This is probably the highest-leverage feature on this entire list per unit of engineering.

**But decay is dangerous and must be tuned defensively.** The failure mode is real and common: a player misses four days, opens the app, sees they've lost two weeks of progress, and never opens it again. Rules:
- Decay starts only after **4 consecutive rest days**, and is capped at losing ~3 weeks of gains no matter how long the absence.
- A single "rest day token" per week auto-protects the streak. Rest days are part of training, not a failure.
- Returning after a long gap triggers a **welcome-back** flow with a deliberately easy session, not a damage report.
- Decay is always **recoverable faster than it was earned** — two sessions should undo a week of drift.

**Prerequisites:** [1]. Character rendering for the visible-decay version can lag behind the numeric version.

---

# MID HORIZON

## 4a. Social: friends, challenges, async competition

Friend lists, shared session feeds, and challenges — "beat my 12-round Sentinel time", "most squats this week", "beat my Dodge & Collect ghost". All asynchronous.

**Why it matters:** social accountability is the second-largest determinant of exercise adherence after habit. A friend who can see whether you trained this week is worth more than any in-game reward. Challenges also give a strong player a reason to push past "good enough", which is where the extra volume comes from.

**Prerequisites:** [1] for profiles, plus accounts and a backend. Start with **async only** — challenge a recorded run or a score. Async is cheap, timezone-proof, and delivers most of the social value. Shadow Boxer's ghost model (`game-plans/shadow-boxer.md` §5.1) is the pattern: record an input timeline, replay it.

## 5. Character stat growth mirroring real fitness progress

Character stats (STRENGTH, ENDURANCE, TECHNIQUE, RESOLVE) derived directly from training data rather than from XP spent — see `game-plans/workout-quest.md` §6.3 for the derivation. Stats are read-only, cannot be bought, and are shared across all games: your Rep Battle squats raise the stamina cap of your Shadow Boxer fighter.

**Why it matters:** this is the honest version of RPG progression, and it is strictly better than the dishonest version. When the number goes up it's because the player actually got stronger, so the dopamine is attached to the real thing. It also makes the cross-game profile *felt* rather than just displayed, and gives players a reason to train exercises they'd otherwise skip.

**Prerequisites:** [1] with per-exercise history. Should be designed alongside Workout Quest, which is its natural home.

## 6. Card / move collection & deck building

Collectible cards representing attacks, buffs, and modifiers — drawn from the pool of moves you've unlocked, assembled into a deck before a session, and drawn during rest intervals. In Rep Battle, a card played on the boss's turn modifies the next attack window ("Deep Cut: 2× damage on reps above 0.9 form, −20% otherwise"). In a boxing context, cards are combos and stances.

**Why it matters:** it puts a genuine strategic layer entirely inside the rest interval, which is exactly where decision-making belongs. It also makes exercise *variety* mechanically rewarded — a deck that wants lunge cards gives the player a reason to train lunges. And it is the most natural currency sink of any feature here.

**Prerequisites:** [2] for the economy. Design constraint that must hold: **cards may modify how reps are scored, never how many are required.** A card that says "win with fewer reps" inverts the product.

## 7. Phone-as-remote-camera via WebRTC

Use a phone as the camera, streaming to the desktop console over WebRTC, so the player can put the phone on a shelf across the room and use the laptop or a TV as the display.

**Why it matters:** this is a bigger unlock than it sounds. The current setup — laptop webcam, ~2m away — constrains framing, forces the player to stay near the laptop, and produces the front-on angle that makes the pushup recognizer unreliable. A phone camera can be placed at a better distance and a better angle, which improves recognizer quality across the board and makes floor exercises (pushups, planks, sit-ups) viable for the first time. It also just makes the product usable in a living room rather than at a desk.

**Prerequisites:** independent of the rest of the list, but non-trivial: WebRTC signalling, pairing UX, and — the real problem — **latency**. Encode + network + decode adds 60–120ms on top of a pipeline that is already the binding constraint. Two possible architectures: (a) stream video to the desktop and run inference there, or (b) run MediaPipe **on the phone** and stream landmarks, which is far cheaper on bandwidth and latency but constrains model choice. Prototype (b) first.

**Also unblocks:** a much wider exercise library, which is the substrate for everything Workout Quest wants to grow into.

## 8. Hosted game registry & open SDK for third-party developers

A public `@primal/sdk` package, a documented protocol spec, a template repo, and a registry the console reads to list games — starting curated, potentially opening later.

**Why it matters:** content variety is a retention problem, and a solo developer cannot outproduce boredom. Third-party games are the only scalable answer. The mission risk is that outside developers optimise for fun over workout, so the platform must encode the values in the *contract*: effort-normalized `workout/summary.score`, honest `activeSeconds`, mandatory pause handling, mandatory tracking degradation, no mechanic that reduces required exercise. Enforce with a submission checklist and server-side sanity checks on submitted summaries.

**Prerequisites:** `dodge-collect` finished and deliberately refactored into a template (see its §12) — including the mock input driver, without which third-party development is unpleasant enough that nobody finishes a game. Protocol v1 frozen with a versioning story. Registry can start as a hand-edited JSON file.

---

# FAR HORIZON

## 9. PvP matchmaking — async first, real-time much later

**Async matchmaking** (near-far boundary): pair players by profile stats and recent scores, exchange ghosts, resolve offline. Buildable once [4a] exists and is mostly a matchmaking-queue problem.

**Real-time PvP** is genuinely far, and the blocker is physics, not engineering enthusiasm. The local input pipeline currently costs **110–225ms** end to end (`game-plans/shadow-boxer.md` §4.1). Adding 40–90ms of network on top produces something unplayable for anything reaction-based. Real-time PvP needs, in order: the latency reduction work (60fps capture, velocity-based early-fire gestures, capture timestamps, per-channel smoothing profiles), a measured budget under ~130ms, deterministic simulation, and rollback netcode.

**Why it matters anyway:** live competition against a person is the strongest motivator in exercise, full stop. People push harder against an opponent than against any score. It's worth the wait; it's not worth shipping badly.

**A cheaper interim:** *synchronous co-presence without synchronous mechanics* — two players doing the same Rep Battle at the same time, seeing each other's rep counter live, both fighting the same boss. All the social pressure, none of the netcode. **This is probably the right thing to build instead of real-time PvP**, and it could move to mid horizon.

## 10. Ranked ladder & leagues

Seasonal ranks, tiers, and weekly league placement based on effort-normalized score across all games, with promotion and relegation.

**Why it matters:** for the subset of players motivated by competition, ranked is the strongest possible retention mechanic — and because the ranking input is effort-normalized, climbing the ladder *is* training harder. Leagues (small groups of ~20 promoted/relegated weekly) work better than a global ladder for the median player, who will never be near the top of anything.

**Prerequisites:** [4a] social, [1] profile, and a real user base — a ladder with 40 people is worse than no ladder. Also needs anti-cheat with teeth, because a ladder creates the first real incentive to fake input. Server-side plausibility checks on `reps` vs `activeSeconds` vs `avgIntensity`, and eventually spot video verification for the top tier.

**Sequencing note:** do not build ranked before streaks and challenges. Ranked serves the competitive minority; streaks serve everybody. Build the thing that helps the median player first.

---

## Explicitly not on this roadmap

Recorded so the decisions don't get relitigated:

- **Heart-rate strap / wearable integration.** Tempting, and it would validate `input/intensity`. But it adds a hardware dependency to a product whose entire pitch is "you need a webcam and nothing else". Revisit only as an optional accuracy boost, never as a requirement.
- **Mobile-native apps.** The console is a browser product. A phone is a camera (see [7]), not a second platform.
- **Nutrition, weight tracking, or anything that turns this into a diet app.** Scope discipline. The product gets people moving.
- **Multiplayer co-op inside a single session on one camera.** Two people in frame breaks pose tracking assumptions throughout the stack. Two cameras, two consoles, one shared session is the answer — that's [9]'s co-presence idea, not this.
