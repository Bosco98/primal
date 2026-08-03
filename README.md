# THE HERD

A bright three-minute movement runner where **your body is the controller**.
Turn your room into an arcade track: hop between lanes, clear the logs, duck
the overhead gates, reach for energy, and keep the pace crew behind you.

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
      │          │          │          │
      │ ──────────────────────────────  │  ── JUMP    hips above this
      │    ●     │    ●     │    ●     │  ·· stand ·· where your hips rest
      │ ──────────────────────────────  │  ── SQUAT   hips below this
      │          │  (knees) │          │
      └──────────┴──────────┴──────────┘
```

The horizontal bands are **absolute screen regions** — nothing to learn, and
nothing that can drift.

Both vertical lines hang off one tracked point, **your hips**, and one
reference, the standing baseline:

```
jumpLine  = stand − 0.12 · torso                 ≈ 6cm of hip rise
squatLine = stand + 0.62 · (knee − stand)        ≈ 22cm of hip drop
```

So `jump < stand < squat` holds by construction, for every body at every
distance — the two lines *cannot* converge, because there is no arithmetic that
brings them together. An earlier version measured the jump from the ankles
against a ground reference and the squat from the hips against a standing one:
two body parts, two independent references, and nothing stopping them meeting.
When the player's feet left the frame they did exactly that.

Deriving both from the hips also drops the requirement to see feet, and makes
the moves mutually exclusive for free — a rise and a drop are the same
subtraction with opposite signs.

The baseline only samples while you are neither jumping nor squatting. A
percentile alone follows you into a long squat, and then standing back up reads
as a jump.

The duck is a **half squat**, not a bob: hips two thirds of the way down to your
knees. It is the move doing most of the work on your legs, so it is worth
asking for properly.

That is why there is no calibration. The old design learned your neutral pose
over two seconds and then hid it; this one draws the skeleton, the marker on
your hips and both lines at their live positions, so what you see is exactly
what the recogniser is testing.

Your hands are two cursors — reach out for the fireflies.

**Nothing past the title screen needs a click**, because the player is standing
two metres from the machine — framed by the camera and out of reach of the
mouse at the same time. Hold a good position and the run counts itself down and
starts; jump on the summary screen to go again; Escape quits a run.

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
│   ├── zones.ts      the controller: bands, jump line, squat line
│   ├── signals.ts    effort, framing checks, coaching
│   ├── engine.ts     camera frame → control frame, in one call
│   └── keyboard.ts   desk mode
├── game/
│   ├── run.ts        the fixed-timestep loop
│   ├── world.ts      obstacles, the pack, fireflies, scoring
│   ├── scene.ts      pooled, adaptive Three.js renderer
│   └── config.ts     every tuned number, with why it is that number
└── ui/
    ├── skeleton.ts   bones, joints, the hip marker, the mirroring
    └── ...           controller overlay, controls guide, stage
```

React owns the screens; `Run` owns everything inside a run. They are kept apart
deliberately — React renders on state change, a game renders every frame on a
fixed clock, and mixing them is how an effect ends up tearing down mid-frame.

## Timing, and why the windows are generous

The pipeline — camera, MediaPipe, zone recognition, simulation, render — runs
**140–200ms end to end**. Two things claw part of that back:

- **Prediction.** Once your hips are past halfway to a line *and moving
  decisively toward it*, the trigger fires on where they will be in 100ms, not
  where they are. The halfway gate keeps a single jittery frame from firing a
  move from rest.
- **Grace, not panic.** Knee confidence flickers exactly when motion blur is
  highest — mid-move. The recogniser trusts the geometry for 400ms past the
  last confident sighting, and the run only freezes after tracking has been
  lost for a sustained 700ms, so a flicker never swallows a jump or pauses the
  game.

The rest the design absorbs instead of pretending otherwise:

```
telegraph     ≥ 1.10 s   asserted at runtime, not trusted
pre-buffer      250 ms   an action this early still counts
coyote          120 ms   and this late
scroll speed   ≤ 85 u/s  past this, obstacles become unreadable
                         before they become undodgeable
```

## Tests

```bash
npm test        # controller geometry and the skeleton overlay
npm run typecheck
```

They cover the two things a webcam cannot cheaply prove. A bad threshold does
not throw — it quietly stops registering squats, and you find out by standing in
front of a camera being ignored. A sign error in the mirroring draws a perfect
skeleton on the wrong side of the picture, which looks fine in a screenshot and
is maddening in motion. Both run headless against a synthetic body.

What they do *not* cover is whether the thresholds feel right, which only a real
person in front of a real camera can answer.
