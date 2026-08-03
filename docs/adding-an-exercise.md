# Adding an exercise

Every rep-counted exercise in PRIMAL is a small declarative definition. The
state machine, hysteresis, dwell requirements, abandon timeout, form scoring and
flag logic are shared, so an accuracy fix made once applies to all of them.

Definitions live in
[`primal-console/src/recognition/exercises.ts`](../primal-console/src/recognition/exercises.ts);
the shared engine is
[`exercise.ts`](../primal-console/src/recognition/exercise.ts).

## The one idea

Every exercise reduces to a single number:

```
progress = 0    resting
progress = 1.0  the shallowest movement that may be counted as a rep
progress > 1.0  deeper than required — this is what form scoring is built from
```

A squat measures it from hip drop and knee bend, a jumping jack from arms and
stance, a push-up from elbow bend. Downstream nothing is a special case.

## Writing one

```ts
export const BURPEE_DEFINITION: ExerciseDefinition = {
  id: 'burpee',
  label: 'Burpee',
  cue: 'Drop to the floor, then jump up with your hands overhead.',
  requires: 'full',

  progress(features, baseline) {
    const down = (features.hipY - baseline.standingHipY) / baseline.torsoLength / 0.6;
    const up = (features.wristRiseMean - baseline.standingWristRise) / 1.5;
    return Math.max(0, down) * 0.5 + Math.max(0, up) * 0.5;
  },

  goodProgress: 1.3,
  excellentProgress: 1.7,
};
```

Then register it in `EXERCISE_DEFINITIONS` and add `'burpee'` to `ExerciseId` in
[the protocol](../primal-sdk/src/protocol/v1.ts).

## Four rules that matter

**1. Prefer two independent signals.** A single signal the camera cannot see is
a rep that never counts. Squats combine hip drop (reliable head-on) with knee
bend (precise, but depth-inferred and often wrong).

**2. Normalise against the player's own `Baseline`, never against absolutes.**
Bodies and camera distances differ. Absolute thresholds are what broke squat
counting for anyone whose standing legs measured under 158° — MediaPipe reads a
straight leg as bent when it can only see it head-on. Both signals must read
approximately zero when the player is at rest, or a rep will never close.

**3. Choose the combinator deliberately.**
`Math.max` when either signal alone should be able to carry a rep (squat).
`mean` when the movement genuinely requires both (a jumping jack is arms *and*
legs — letting arms alone count turns it into an easier exercise than the one
you asked for).

**4. Reject look-alikes explicitly.** A lunge drops the hips and bends the knees
exactly like a squat. Without `SQUAT.LUNGE_REJECT_SPLIT`, one movement gets
counted twice when both are subscribed.

## Testing it

No webcam, no human. `test/synthetic.ts` poses a body by inverse kinematics, so
a set at an exact depth and tempo is a function call:

```ts
it('counts a clean set exactly', () => {
  const { reps } = runFixture(makeBurpeeSet({ reps: 10 }), 'burpee');
  expect(reps).toHaveLength(10);
});
```

Cover at least: the exact count for a clean set, a movement too shallow to
count, and — most importantly — the exercises it must **not** be confused with.
The cross-contamination block in `exercises.test.ts` is where those live.

## Current recognisers

| Exercise | Signals | Status |
| --- | --- | --- |
| Squat | hip drop `max` knee bend | Stable, validated against a real camera |
| Jumping jack | arm rise `mean` stance width | Stable in synthetic tests, not yet camera-validated |
| Lunge | hip drop `mean` front-back foot split | **Beta** — the split relies on MediaPipe `z`, the axis a single camera infers rather than observes |
| Push-up | elbow bend, gated on torso tilt | **Beta** — needs a side-on camera; a console webcam sees the worst possible angle |

Beta is not a hedge, it is a promise to the player: the UI says the recogniser
will struggle so nobody concludes the console is broken when it does.
