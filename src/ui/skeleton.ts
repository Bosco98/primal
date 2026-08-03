import { LM, POSE_CONNECTIONS } from '../pose/landmarks.js';
import type { ZoneState } from '../control/zones.js';
import type { Landmark } from '../pose/types.js';

/**
 * Drawing the tracked body, kept apart from the React component that hosts it.
 *
 * Separate module because this is the part with arithmetic in it. The overlay
 * component is a canvas and a request-animation-frame loop — nothing to get
 * wrong that a glance would not catch. The mirroring here is the opposite: a
 * sign error puts a perfect skeleton on the wrong side of the picture, which
 * looks plausible in a still and is maddening in motion, so it is worth being
 * able to assert on directly.
 */

export const BONE = '251,254,255';
export const ACCENT = '22,93,255';
export const WARM = '255,166,43';
export const COOL = '38,198,184';

/**
 * Screen x for an image-space landmark.
 *
 * The preview is mirrored, so this is the same `1 - x` the controller applies
 * to the hips. It must stay the same flip: if the skeleton and the band logic
 * ever disagree about which way is left, the marker drifts off the body.
 */
export function screenX(lm: Landmark, width: number): number {
  return (1 - lm.x) * width;
}

/** Below this a landmark is a guess, and a bone drawn to a guess is noise. */
const VISIBLE = 0.4;

/**
 * Bones and joints over the player's own body.
 *
 * Low-confidence landmarks are skipped rather than drawn faintly — a limb drawn
 * to a hallucinated wrist looks like tracking and behaves like nothing.
 */
export function drawSkeleton(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  landmarks: Landmark[],
  zones: ZoneState | null,
  scale: number,
): void {
  const at = (i: number): Landmark | null => {
    const lm = landmarks[i];
    return lm && lm.visibility > VISIBLE ? lm : null;
  };

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  for (const [a, b] of POSE_CONNECTIONS) {
    const from = at(a);
    const to = at(b);
    if (!from || !to) continue;
    // Hip-to-knee is the segment the squat is measured along, so it carries the
    // accent and everything else stays neutral.
    const isLeg =
      (a === LM.LEFT_HIP && b === LM.LEFT_KNEE) || (a === LM.RIGHT_HIP && b === LM.RIGHT_KNEE);
    ctx.strokeStyle = isLeg ? `rgba(${ACCENT},0.9)` : `rgba(${BONE},0.7)`;
    ctx.lineWidth = (isLeg ? 4 : 3) * scale;
    ctx.beginPath();
    ctx.moveTo(screenX(from, width), from.y * height);
    ctx.lineTo(screenX(to, width), to.y * height);
    ctx.stroke();
  }

  // Joints from the shoulders down. The face landmarks are skipped: five dots
  // clustered on a nose read as a smudge, not as tracking.
  ctx.fillStyle = `rgba(${ACCENT},0.95)`;
  for (let i = LM.LEFT_SHOULDER; i < landmarks.length; i++) {
    const lm = at(i);
    if (!lm) continue;
    ctx.beginPath();
    ctx.arc(screenX(lm, width), lm.y * height, 3 * scale, 0, Math.PI * 2);
    ctx.fill();
  }

  const nose = at(LM.NOSE);
  if (nose) {
    ctx.strokeStyle = `rgba(${BONE},0.7)`;
    ctx.lineWidth = 3 * scale;
    ctx.beginPath();
    ctx.arc(screenX(nose, width), nose.y * height, 13 * scale, 0, Math.PI * 2);
    ctx.stroke();
  }

  drawHipMarker(ctx, width, height, landmarks, zones, scale);
}

/**
 * The one point every threshold is tested against.
 *
 * Drawn brighter than any other joint on purpose: everything the controller
 * decides comes from where this dot sits relative to two lines, so a player
 * watching it can see a squat register before the game reacts. It is also the
 * fastest way to spot a misread — if the dot is not on your hips, nothing else
 * on screen means anything.
 */
function drawHipMarker(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  landmarks: Landmark[],
  zones: ZoneState | null,
  scale: number,
): void {
  const left = landmarks[LM.LEFT_HIP];
  const right = landmarks[LM.RIGHT_HIP];
  if (!left || !right) return;

  const x = (screenX(left, width) + screenX(right, width)) / 2;
  const y = ((left.y + right.y) / 2) * height;
  const tint = zones?.jumping ? WARM : zones?.ducking ? COOL : BONE;

  ctx.beginPath();
  ctx.arc(x, y, 13 * scale, 0, Math.PI * 2);
  ctx.strokeStyle = `rgba(${tint},0.9)`;
  ctx.lineWidth = 2.5 * scale;
  ctx.stroke();

  ctx.beginPath();
  ctx.arc(x, y, 5 * scale, 0, Math.PI * 2);
  ctx.fillStyle = `rgba(${tint},1)`;
  ctx.fill();
}
