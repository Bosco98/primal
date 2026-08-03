import { useEffect, useRef } from 'react';
import { ACCENT, BONE, COOL, WARM, drawSkeleton } from './skeleton.js';
import { ZONES, type ZoneState } from '../control/zones.js';
import type { ControlFrame } from '../control/engine.js';

export interface ControllerOverlayProps {
  video: HTMLVideoElement | null;
  frameRef: React.MutableRefObject<ControlFrame | null>;
  /** Draw the labels and legend. Off during a game, where space is tight. */
  labelled?: boolean;
}

/**
 * The controller, drawn over a mirrored camera view.
 *
 * This *is* the control scheme — not a diagram of it. Three absolute bands you
 * stand in, and two lines your hips cross:
 *
 *   ── JUMP ──   rise above it and you jump
 *   ·· stand ··  where your hips rest; both lines are measured from here
 *   ── SQUAT ──  drop below it and you duck
 *
 * The skeleton is not decoration. It is the only way to tell "the game can see
 * me" apart from "the game can see me but has misread where my legs are", which
 * from behind a threshold look identical — you squat, nothing happens, and
 * there is no way to know whether the problem is you, the light, or the model.
 * With bones drawn on, a bad frame is visibly a bad frame.
 *
 * The hip marker is drawn brighter than every other joint because it is the
 * point being tested. Everything the controller decides comes from where that
 * one dot sits relative to two lines, so a player watching it can see a duck
 * coming before it registers.
 */
export function ControllerOverlay({
  video,
  frameRef,
  labelled = true,
}: ControllerOverlayProps): React.JSX.Element {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let raf = 0;
    const draw = () => {
      raf = requestAnimationFrame(draw);
      const parent = canvas.parentElement;
      if (!parent) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      if (canvas.width !== Math.floor(w * dpr) || canvas.height !== Math.floor(h * dpr)) {
        canvas.width = Math.floor(w * dpr);
        canvas.height = Math.floor(h * dpr);
      }

      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, w, h);

      if (video && video.readyState >= 2) {
        // Mirrored, like a bathroom mirror: moving to your left must move you
        // to screen-left, or every lateral control reads backwards.
        ctx.save();
        ctx.translate(w, 0);
        ctx.scale(-1, 1);
        ctx.drawImage(video, 0, 0, w, h);
        ctx.restore();
      } else {
        ctx.fillStyle = '#c9f4ff';
        ctx.fillRect(0, 0, w, h);
      }

      // A light navy wash keeps the grid readable without turning framing into
      // a dark screen. The person and room remain easy to recognise.
      ctx.fillStyle = 'rgba(18,35,63,0.28)';
      ctx.fillRect(0, 0, w, h);

      const frame = frameRef.current;
      const zones = frame?.zones ?? null;
      const scale = labelled ? 1 : 0.62;

      drawBands(ctx, w, h, zones, labelled);
      drawLines(ctx, w, h, zones, labelled, scale);
      if (frame?.landmarks?.length) drawSkeleton(ctx, w, h, frame.landmarks, zones, scale);
      if (!zones?.present) drawWaiting(ctx, w, h, labelled);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video, frameRef, labelled]);

  return <canvas ref={canvasRef} className="controller-overlay" />;
}

function drawBands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  zones: ZoneState | null,
  labelled: boolean,
): void {
  const edges = [0.5 - ZONES.BAND_ENTER, 0.5 + ZONES.BAND_ENTER];
  const active = zones?.band ?? 0;

  const spans: Array<[number, number, number]> = [
    [-1, 0, edges[0]!],
    [0, edges[0]!, edges[1]!],
    [1, edges[1]!, 1],
  ];
  for (const [band, from, to] of spans) {
    if (band === active && zones?.present) {
      ctx.fillStyle = `rgba(${ACCENT},0.10)`;
      ctx.fillRect(from * w, 0, (to - from) * w, h);
    }
  }

  ctx.strokeStyle = `rgba(${ACCENT},0.30)`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 8]);
  for (const edge of edges) {
    ctx.beginPath();
    ctx.moveTo(edge * w, 0);
    ctx.lineTo(edge * w, h);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  if (!labelled) return;
  const centres = [edges[0]! / 2, 0.5, (1 + edges[1]!) / 2];
  ctx.font = '800 11px "Avenir Next", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ['LEFT', 'CENTRE', 'RIGHT'].forEach((label, i) => {
    const on = (i - 1) === active && zones?.present;
    ctx.fillStyle = on ? `rgba(${ACCENT},0.95)` : `rgba(${ACCENT},0.45)`;
    ctx.fillText(label, centres[i]! * w, h - 10);
  });
}

/**
 * The two thresholds, plus the baseline they are both measured from.
 *
 * Drawing the baseline matters even though nothing triggers on it: it is the
 * visual proof that the jump line is above and the squat line below, which is
 * the property that stops them ever meeting.
 */
function drawLines(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  zones: ZoneState | null,
  labelled: boolean,
  scale: number,
): void {
  if (!zones?.ready || !zones.present) return;

  const jumpY = clamp(0.03, 0.97, zones.jumpLineY) * h;
  const squatY = clamp(0.03, 0.97, zones.squatLineY) * h;
  const standY = clamp(0.03, 0.97, zones.standY) * h;

  // Wash the zone you are currently in, so a held duck is unmistakable.
  if (zones.jumping) {
    ctx.fillStyle = `rgba(${WARM},0.14)`;
    ctx.fillRect(0, 0, w, jumpY);
  }
  if (zones.ducking) {
    ctx.fillStyle = `rgba(${COOL},0.14)`;
    ctx.fillRect(0, squatY, w, h - squatY);
  }

  // The resting baseline: a reference, never a trigger, so it stays quiet.
  ctx.setLineDash([3, 6]);
  line(ctx, w, standY, `rgba(${BONE},0.34)`, 1.5 * scale);
  ctx.setLineDash([]);

  line(ctx, w, jumpY, `rgba(${WARM},${zones.jumping ? 1 : 0.6})`, (zones.jumping ? 4 : 2.2) * scale);
  line(ctx, w, squatY, `rgba(${COOL},${zones.ducking ? 1 : 0.6})`, (zones.ducking ? 4 : 2.2) * scale);

  if (!labelled) return;
  ctx.font = '800 11px "Avenir Next", "Segoe UI", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillStyle = `rgba(${WARM},0.95)`;
  ctx.fillText('JUMP — hips above this', 10, jumpY - 7);
  ctx.fillStyle = `rgba(${BONE},0.5)`;
  ctx.fillText('standing', 10, standY - 6);
  ctx.fillStyle = `rgba(${COOL},0.95)`;
  ctx.fillText('SQUAT — hips below this', 10, squatY + 16);
}

function line(ctx: CanvasRenderingContext2D, w: number, y: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  ctx.stroke();
}

function drawWaiting(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  labelled: boolean,
): void {
  if (!labelled) return;
  ctx.font = '750 14px "Avenir Next", "Segoe UI", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(248,249,250,0.8)';
  ctx.fillText('Step back until your whole body is in view', w / 2, h / 2 - 40);
}

function clamp(lo: number, hi: number, v: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
