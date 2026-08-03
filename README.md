# THE HERD

An endless runner where **your body is the controller**. Dusk on the savannah,
you are separated from the herd, and something is pacing you in the long grass.
Hop between lanes, clear the fallen logs, duck the low branches — and keep
working, because they close in the moment you flag.

**Play:** https://bosco98.github.io/primal/

A webcam plus on-device pose detection turns real movement into game input.
**Camera frames never leave your machine** — nothing is uploaded, nothing is
recorded. There is no account, no server, and no calibration step.

## Run it locally

Needs Node 24.

```bash
npm install
npm run dev        # http://localhost:5173
```

`localhost` counts as a secure context, so the camera works without HTTPS.
No camera to hand? The title screen has a keyboard mode.

## The controls

There is nothing to set up. The controls are a grid drawn over the camera view,
and you move to the marks:

```
        LEFT       CENTRE      RIGHT
      ┌──────────┬──────────┬──────────┐
      │          │          │          │  ── JUMP ──  get your feet above it
      │    ●     │    ●     │    ●     │  stand in a band; hop to change lane
      │          │          │          │  ── DUCK ──  get your hips below it
      └──────────┴──────────┴──────────┘
```

The horizontal bands are **absolute screen regions** — nothing to learn, and
nothing that can drift. The jump and duck lines track rolling percentiles of
*your own body*: a high percentile of ankle height for the ground (so jumps
don't drag it down) and a low percentile of hip height for standing (so squats
don't). They are drawn at their live positions, so what you see is exactly what
the recogniser is testing.

That is why there is no calibration. The old design learned your neutral pose
over two seconds and then hid it; this one shows you the threshold and lets you
move relative to it.

Your hands are two cursors — reach out for the fireflies.

## Why it makes you work

**The pack** replaces a lives counter. One number, your gap in metres, that
closes when you get hit *and when you coast*:

```
gap += clears×4 + (intensity − 0.5)×6 − phaseDrain − hits×18
```

At 85% intensity you gain ground for free; at 30% you lose it even while
clearing everything. A predator does not sprint — it paces you and waits for
you to flag. Subway Surfers chases you for failing; the pack chases you for
*not working*, which is the thing a fitness game should actually punish.

**Surge** is the powerup that *is* the rest interval. Fill the burn meter with
real effort and you lift clear for 12 seconds: nothing to dodge, fireflies
caught with your hands only, ×3 score. Twelve seconds of legs-off, arms-only
active recovery, awarded for having worked hard.

A run is **3:00 and never longer**. The resource here is your legs: past three
minutes of continuous jumping, form degrades and you stop for the day instead
of doing another run. Three to five runs is a 12–18 minute session.

Full design: [`docs/design.md`](docs/design.md).

## Layout

```
src/
├── App.tsx           title → framing → run → summary
├── types.ts          shapes shared between the pipeline and the game
├── pose/             camera, landmarks, per-frame geometry (MediaPipe)
├── control/
│   ├── zones.ts      the controller: bands, jump line, duck line
│   ├── signals.ts    effort, framing checks, coaching
│   ├── engine.ts     camera frame → control frame, in one call
│   └── keyboard.ts   desk mode
├── game/
│   ├── run.ts        the fixed-timestep loop
│   ├── world.ts      obstacles, the pack, fireflies, scoring
│   ├── scene.ts      canvas 2D, fake-3D projection
│   └── config.ts     every tuned number, with why it is that number
└── ui/               controller overlay, controls guide, stage
```

React owns the screens; `Run` owns everything inside a run. They are kept apart
deliberately — React renders on state change, a game renders every frame on a
fixed clock, and mixing them is how an effect ends up tearing down mid-frame.

## Timing, and why the windows are generous

The pipeline — camera, MediaPipe, zone recognition, simulation, render — runs
**140–200ms end to end**, and no code here will shorten that. So the design
absorbs it instead of pretending otherwise:

```
telegraph     ≥ 1.10 s   asserted at runtime, not trusted
pre-buffer      250 ms   an action this early still counts
coyote          120 ms   and this late
scroll speed   ≤ 85 u/s  past this, obstacles become unreadable
                         before they become undodgeable
```
