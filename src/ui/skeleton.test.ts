import assert from 'node:assert/strict';
import { test } from 'node:test';
import { drawSkeleton, screenX } from './skeleton.ts';
import { LM } from '../pose/landmarks.ts';
import type { Landmark } from '../pose/types.ts';

/**
 * The skeleton overlay, against a recording canvas.
 *
 * There is no camera in a test and no person in front of it, so the real
 * failure this guards is the one a screenshot would not catch either: the
 * skeleton drawn on the correct body but flipped, so it tracks the player in
 * reverse. The video underneath is mirrored, and every landmark arrives
 * unmirrored, which means exactly one `1 - x` has to happen and it has to
 * happen here.
 */

const W = 400;
const H = 300;

interface Call {
  op: string;
  args: number[];
  stroke: string;
  fill: string;
  lineWidth: number;
}

function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const state = { strokeStyle: '', fillStyle: '', lineWidth: 0 };
  const record = (op: string, ...args: number[]): void => {
    calls.push({
      op,
      args,
      stroke: String(state.strokeStyle),
      fill: String(state.fillStyle),
      lineWidth: state.lineWidth,
    });
  };
  const ctx = {
    set strokeStyle(v: string) { state.strokeStyle = v; },
    get strokeStyle() { return state.strokeStyle; },
    set fillStyle(v: string) { state.fillStyle = v; },
    get fillStyle() { return state.fillStyle; },
    set lineWidth(v: number) { state.lineWidth = v; },
    get lineWidth() { return state.lineWidth; },
    lineCap: '',
    lineJoin: '',
    beginPath: () => record('beginPath'),
    moveTo: (x: number, y: number) => record('moveTo', x, y),
    lineTo: (x: number, y: number) => record('lineTo', x, y),
    arc: (x: number, y: number, r: number) => record('arc', x, y, r),
    stroke: () => record('stroke'),
    fill: () => record('fill'),
  };
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

function lm(x: number, y: number, visibility = 1): Landmark {
  return { x, y, z: 0, visibility };
}

/** A person standing slightly to the camera's left, fully visible. */
function body(overrides: Record<number, Landmark> = {}): Landmark[] {
  const points: Landmark[] = Array.from({ length: 33 }, () => lm(0.5, 0.5));
  points[LM.NOSE] = lm(0.5, 0.2);
  points[LM.LEFT_SHOULDER] = lm(0.58, 0.3);
  points[LM.RIGHT_SHOULDER] = lm(0.42, 0.3);
  points[LM.LEFT_HIP] = lm(0.56, 0.55);
  points[LM.RIGHT_HIP] = lm(0.44, 0.55);
  points[LM.LEFT_KNEE] = lm(0.56, 0.72);
  points[LM.RIGHT_KNEE] = lm(0.44, 0.72);
  points[LM.LEFT_ANKLE] = lm(0.56, 0.9);
  points[LM.RIGHT_ANKLE] = lm(0.44, 0.9);
  for (const [i, point] of Object.entries(overrides)) points[Number(i)] = point;
  return points;
}

test('landmarks are mirrored exactly once', () => {
  assert.equal(screenX(lm(0, 0), W), W, 'image left edge lands on screen right');
  assert.equal(screenX(lm(1, 0), W), 0);
  assert.equal(screenX(lm(0.5, 0), W), W / 2, 'centre is a fixed point');
});

test('the player\'s left hand stays on their left, like a mirror', () => {
  // MediaPipe names limbs from the subject's own body and reports the raw
  // camera view, where you appear as another person would: the player's left
  // hand sits at a HIGH image x. Mirroring sends it back to screen-left, which
  // is where the player expects to see it. Drop the flip and every lateral
  // control reads backwards.
  const points = body({ [LM.LEFT_WRIST]: lm(0.8, 0.4), [LM.RIGHT_WRIST]: lm(0.2, 0.4) });
  assert.ok(screenX(points[LM.LEFT_WRIST]!, W) < W / 2, 'left hand on screen-left');
  assert.ok(screenX(points[LM.RIGHT_WRIST]!, W) > W / 2, 'right hand on screen-right');
});

test('bones and joints are drawn for a visible body', () => {
  const { ctx, calls } = recorder();
  drawSkeleton(ctx, W, H, body(), null, 1);

  const lines = calls.filter((c) => c.op === 'lineTo');
  const dots = calls.filter((c) => c.op === 'arc');
  assert.ok(lines.length > 10, `expected a skeleton, got ${lines.length} segments`);
  assert.ok(dots.length > 5, `expected joints, got ${dots.length}`);
  assert.ok(
    calls.every((c) => c.args.every(Number.isFinite)),
    'every coordinate must be finite',
  );
});

test('bones to low-confidence landmarks are omitted, not faded', () => {
  const full = recorder();
  drawSkeleton(full.ctx, W, H, body(), null, 1);

  const armless = recorder();
  drawSkeleton(
    armless.ctx,
    W,
    H,
    body({ [LM.LEFT_ELBOW]: lm(0.7, 0.4, 0.1), [LM.LEFT_WRIST]: lm(0.8, 0.5, 0.1) }),
    null,
    1,
  );

  const count = (r: { calls: Call[] }) => r.calls.filter((c) => c.op === 'lineTo').length;
  assert.ok(count(armless) < count(full), 'an occluded arm must drop its bones');
});

test('the hip marker sits on the mirrored hip midpoint', () => {
  const { ctx, calls } = recorder();
  drawSkeleton(ctx, W, H, body(), null, 1);

  // Hips at image x 0.56 and 0.44 → midpoint 0.5 → screen centre.
  const marker = calls.filter((c) => c.op === 'arc' && c.args[2] === 13 && c.args[1] === 0.55 * H);
  assert.equal(marker.length, 1, 'exactly one hip ring');
  assert.equal(marker[0]!.args[0], W / 2);
});

test('the hip marker takes the colour of the move being held', () => {
  const zonesFor = (jumping: boolean, ducking: boolean) =>
    ({ jumping, ducking }) as never;

  const tintOf = (jumping: boolean, ducking: boolean): string => {
    const { ctx, calls } = recorder();
    drawSkeleton(ctx, W, H, body(), zonesFor(jumping, ducking), 1);
    const dot = calls.find((c) => c.op === 'fill' && c.fill.includes(',1)'));
    return dot?.fill ?? '';
  };

  assert.match(tintOf(true, false), /255,159,28/, 'jumping is warm');
  assert.match(tintOf(false, true), /76,201,240/, 'ducking is cool');
  assert.match(tintOf(false, false), /235,242,255/, 'resting is neutral');
});

test('a body with no hips draws bones but no marker', () => {
  const points = body();
  points[LM.LEFT_HIP] = undefined as unknown as Landmark;
  const { ctx, calls } = recorder();
  assert.doesNotThrow(() => drawSkeleton(ctx, W, H, points, null, 1));
  // Radius 5 belongs to the marker's inner dot alone — the head ring is also 13.
  assert.equal(calls.filter((c) => c.op === 'arc' && c.args[2] === 5).length, 0);
});
