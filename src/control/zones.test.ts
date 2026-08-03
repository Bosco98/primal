import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ZoneRecognizer, ZONES } from './zones.ts';
import type { FrameFeatures } from '../pose/features.ts';

/**
 * The controller's geometry, against a synthetic body.
 *
 * `zones.ts` decides every input in the game from two subtractions, and it is
 * the one file a webcam cannot cheaply tell you is wrong: a bad threshold does
 * not throw, it just quietly stops registering squats, and you find out by
 * standing in front of a camera being ignored. So the properties that must hold
 * for every body at every distance are pinned here instead.
 *
 * The first test is the regression: jump and squat lines used to be derived
 * from different body parts against independent references, and could meet.
 */

/** A person 0.85 of the frame tall, standing still. */
const STAND_HIP = 0.55;
const STAND_KNEE = 0.72;
const TORSO = 0.25;
const SPAN = STAND_KNEE - STAND_HIP;

function frame(hipY: number, kneeY = STAND_KNEE): FrameFeatures {
  return {
    t: 0,
    present: true,
    hipSpeedY: 0,
    hipY,
    kneeY,
    ankleY: 0.9,
    shoulderY: hipY - TORSO,
    torsoLength: TORSO,
    hipCenterX: 0.5,
    shoulderCenterX: 0.5,
    headY: 0.2,
    kneesVisible: true,
    lowerBodyVisible: true,
    wristLeft: { x: 0.4, y: 0.5, z: 0, visibility: 1 },
    wristRight: { x: 0.6, y: 0.5, z: 0, visibility: 1 },
  } as unknown as FrameFeatures;
}

function standing(hipY = STAND_HIP, kneeY = STAND_KNEE): ZoneRecognizer {
  const zones = new ZoneRecognizer();
  for (let i = 0; i < 30; i++) zones.update(frame(hipY, kneeY));
  return zones;
}

test('jump line is above the baseline and the squat line below it', () => {
  const { jumpLineY, standY, squatLineY, ready } = standing().current;
  assert.equal(ready, true);
  assert.ok(jumpLineY < standY, `jump ${jumpLineY} should be above stand ${standY}`);
  assert.ok(standY < squatLineY, `stand ${standY} should be above squat ${squatLineY}`);
  assert.ok(squatLineY - jumpLineY > 0.06, 'the two lines must be visibly apart');
});

test('the lines stay apart even when the knees are misread onto the hips', () => {
  // The floor on hip-to-knee span is the only thing standing between one bad
  // frame and both lines collapsing onto the baseline.
  const { jumpLineY, standY, squatLineY } = standing(STAND_HIP, STAND_HIP + 0.001).current;
  assert.ok(jumpLineY < standY && standY < squatLineY);
  assert.ok(squatLineY - jumpLineY > 0.05);
});

test('a hop fires JUMP once; rocking onto the toes fires nothing', () => {
  const zones = standing();
  assert.deepEqual(zones.update(frame(STAND_HIP - 0.01)), [], 'a 2cm rise is not a jump');
  zones.update(frame(STAND_HIP));

  assert.deepEqual(zones.update(frame(STAND_HIP - 0.045)), ['JUMP']);
  assert.deepEqual(zones.update(frame(STAND_HIP - 0.045)), [], 'held apex must not re-fire');
});

test('a half squat fires DUCK once; a bob fires nothing', () => {
  const zones = standing();
  assert.deepEqual(zones.update(frame(STAND_HIP + SPAN * 0.3)), [], '30% depth is a bob');
  zones.update(frame(STAND_HIP));

  assert.deepEqual(zones.update(frame(STAND_HIP + SPAN * 0.7)), ['DUCK']);
  assert.equal(zones.current.ducking, true);
  assert.equal(zones.current.jumping, false, 'a squat can never also be a jump');
});

test('holding a squat does not drag the baseline down with it', () => {
  // Without freezing the history while a move is held, a percentile follows the
  // player into a long squat — and then simply standing up clears the jump
  // line, firing a jump nobody performed.
  const zones = standing();
  const baseline = zones.current.standY;

  zones.update(frame(STAND_HIP + SPAN * 0.7));
  for (let i = 0; i < 120; i++) zones.update(frame(STAND_HIP + SPAN * 0.75)); // 4 seconds
  assert.equal(zones.current.standY, baseline, 'baseline must not follow a held squat');

  const events = [];
  for (let i = 0; i < 20; i++) events.push(...zones.update(frame(STAND_HIP)));
  assert.ok(!events.includes('JUMP'), `standing up fired ${events.join(',')}`);
});

test('a knee-visibility flicker does not swallow a move, sustained loss blocks it', () => {
  // Knee confidence dips below threshold for a few frames exactly when motion
  // blur is highest — mid-move. A short grace keeps the geometry trusted
  // through the flicker; past it, the knees are genuinely gone and nothing
  // may fire.
  const zones = standing();
  const flicker = { ...frame(STAND_HIP + SPAN * 0.9), kneesVisible: false, t: 200 };
  assert.deepEqual(zones.update(flicker), ['DUCK'], 'a 200ms dropout is blur, not absence');

  const gone = standing();
  const hidden = { ...frame(STAND_HIP + SPAN * 0.9), kneesVisible: false, t: 1000 };
  assert.deepEqual(gone.update(hidden), [], 'a 1s dropout means the knees left the frame');
});

test('hips moving fast toward a line fire early; a slow drift does not', () => {
  // The pipeline runs ~100ms behind the body. Once past halfway and moving
  // decisively, the trigger fires on the predicted position, which hands most
  // of that latency back. Velocity alone must never fire from rest.
  const partWay = STAND_HIP - ZONES.JUMP_RISE * TORSO * 0.6;

  const fast = standing();
  assert.deepEqual(
    fast.update({ ...frame(partWay), hipSpeedY: -1.0 }),
    ['JUMP'],
    '60% of the way there and rising a torso-length per second is a jump',
  );

  const drift = standing();
  assert.deepEqual(drift.update({ ...frame(partWay), hipSpeedY: -0.2 }), []);

  const jitter = standing();
  assert.deepEqual(
    jitter.update({ ...frame(STAND_HIP), hipSpeedY: -3.0 }),
    [],
    'a velocity spike with the hips still at rest is noise, not a jump',
  );
});

test('thresholds land in the right place on a real body', () => {
  // Sanity on the units themselves: torso lengths are easy to get wrong by a
  // factor that still typechecks. ~1.75m person filling 85% of the frame.
  const frameCm = 175 / 0.85;
  const jumpCm = ZONES.JUMP_RISE * TORSO * frameCm;
  const squatCm = ZONES.SQUAT_DEPTH * SPAN * frameCm;

  assert.ok(jumpCm > 4 && jumpCm < 10, `jump asks for ${jumpCm.toFixed(1)}cm of hip rise`);
  assert.ok(squatCm > 15 && squatCm < 30, `squat asks for ${squatCm.toFixed(1)}cm of hip drop`);
});

test('each hand keeps its own name and lands on its own side', () => {
  // Both labels have to agree: in a mirror the player's left hand is the one on
  // screen-left. Nothing today reads the hands individually — both consumers
  // iterate the pair — so a swap here is invisible until the first feature that
  // cares which hand, and then it is silently backwards.
  const zones = standing();
  const f = frame(STAND_HIP);
  const body = zones.body({
    ...f,
    // Raw camera view: the player's left wrist sits at a HIGH image x.
    wristLeft: { x: 0.85, y: 0.4, z: 0, visibility: 1 },
    wristRight: { x: 0.15, y: 0.4, z: 0, visibility: 1 },
  } as unknown as typeof f);

  assert.ok(body.hands.left.x < 0.5, 'the left hand belongs on screen-left');
  assert.ok(body.hands.right.x > 0.5, 'the right hand belongs on screen-right');
});

test('bands latch with hysteresis so a wobble is not a lane change', () => {
  const zones = standing();
  const lean = (x: number) => {
    const f = frame(STAND_HIP);
    zones.update({ ...f, hipCenterX: 1 - x }); // screen x, unmirrored back
    return zones.current.band;
  };
  assert.equal(lean(0.5), 0);
  assert.equal(lean(0.5 - ZONES.BAND_ENTER + 0.01), 0, 'short of the edge stays centre');
  assert.equal(lean(0.5 - ZONES.BAND_ENTER - 0.01), -1, 'past the edge commits');
  assert.equal(lean(0.5 - ZONES.BAND_EXIT - 0.01), -1, 'drifting back does not release');
  assert.equal(lean(0.5), 0);
});
