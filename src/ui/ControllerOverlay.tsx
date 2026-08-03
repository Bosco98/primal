import { useEffect, useRef } from 'react';
import type { ZoneState } from '../control/zones.js';
import { ZONES } from '../control/zones.js';

export interface ControllerOverlayProps {
  video: HTMLVideoElement | null;
  zonesRef: React.MutableRefObject<ZoneState | null>;
  /** Draw the labels and legend. Off during a game, where space is tight. */
  labelled?: boolean;
}

/**
 * The controller, drawn over a mirrored camera view.
 *
 * This *is* the control scheme — not a diagram of it. Three absolute bands you
 * stand in, and two live lines you cross:
 *
 *   ── JUMP ──   cross it upward and you jump
 *   ●  ●  ●      stand in a band to pick your lane; hop sideways to change
 *   ── DUCK ──   drop below it and you duck
 *
 * The vertical lines sit at live thresholds derived from the player's own body,
 * so what you see is exactly what the recogniser is testing. That is the whole
 * reason there is no calibration step: instead of learning your neutral pose in
 * advance and then hiding it, the console shows you where the line is, right
 * now, and lets you move relative to it.
 */
export function ControllerOverlay({
  video,
  zonesRef,
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
        ctx.fillStyle = '#0b0f1a';
        ctx.fillRect(0, 0, w, h);
      }

      // Darken the feed so the grid stays readable over a bright room.
      ctx.fillStyle = 'rgba(6,8,16,0.42)';
      ctx.fillRect(0, 0, w, h);

      const zones = zonesRef.current;
      drawBands(ctx, w, h, zones, labelled);
      drawLines(ctx, w, h, zones, labelled);
      drawPlayer(ctx, w, h, zones);
      if (!zones?.present) drawWaiting(ctx, w, h, labelled);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [video, zonesRef, labelled]);

  return <canvas ref={canvasRef} className="controller-overlay" />;
}

const ACCENT = '29,233,182';
const WARM = '255,159,28';
const COOL = '76,201,240';

function drawBands(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  zones: ZoneState | null,
  labelled: boolean,
): void {
  const edges = [0.5 - ZONES.BAND_ENTER, 0.5 + ZONES.BAND_ENTER];
  const active = zones?.band ?? 0;

  // Highlight the band the player is standing in.
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

  ctx.strokeStyle = `rgba(${ACCENT},0.32)`;
  ctx.lineWidth = 1.5;
  ctx.setLineDash([6, 8]);
  for (const edge of edges) {
    ctx.beginPath();
    ctx.moveTo(edge * w, 0);
    ctx.lineTo(edge * w, h);
    ctx.stroke();
  }
  ctx.setLineDash([]);

  // The three standing marks.
  const centres = [edges[0]! / 2, 0.5, (1 + edges[1]!) / 2];
  centres.forEach((cx, i) => {
    const band = (i - 1) as -1 | 0 | 1;
    const on = band === active && zones?.present;
    ctx.beginPath();
    ctx.arc(cx * w, h * 0.5, on ? 11 : 7, 0, Math.PI * 2);
    ctx.fillStyle = on ? `rgba(${ACCENT},0.95)` : `rgba(${ACCENT},0.30)`;
    ctx.fill();
  });

  if (!labelled) return;
  ctx.font = '600 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = `rgba(${ACCENT},0.75)`;
  ['LEFT', 'CENTRE', 'RIGHT'].forEach((label, i) => {
    ctx.fillText(label, centres[i]! * w, h - 12);
  });
}

function drawLines(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  zones: ZoneState | null,
  labelled: boolean,
): void {
  if (!zones?.ready || !zones.present) return;

  const jumpY = clamp(0.04, 0.94, zones.jumpLineY) * h;
  const duckY = clamp(0.04, 0.94, zones.duckLineY) * h;

  line(ctx, w, jumpY, zones.jumping ? `rgba(${WARM},1)` : `rgba(${WARM},0.5)`, zones.jumping ? 4 : 2);
  line(ctx, w, duckY, zones.ducking ? `rgba(${COOL},1)` : `rgba(${COOL},0.5)`, zones.ducking ? 4 : 2);

  if (!labelled) return;
  ctx.font = '700 11px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'left';
  ctx.fillStyle = `rgba(${WARM},0.95)`;
  ctx.fillText('JUMP — get your feet above this', 10, jumpY - 8);
  ctx.fillStyle = `rgba(${COOL},0.95)`;
  ctx.fillText('DUCK — get your hips below this', 10, duckY + 18);
}

function line(ctx: CanvasRenderingContext2D, w: number, y: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(0, y);
  ctx.lineTo(w, y);
  ctx.stroke();
}

function drawPlayer(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  zones: ZoneState | null,
): void {
  if (!zones?.present) return;
  const x = clamp(0.02, 0.98, zones.playerX) * w;
  const y = clamp(0.02, 0.98, zones.playerY) * h;

  ctx.beginPath();
  ctx.arc(x, y, 16, 0, Math.PI * 2);
  ctx.strokeStyle = '#f8f9fa';
  ctx.lineWidth = 2.5;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(x, y, 5, 0, Math.PI * 2);
  ctx.fillStyle = '#f8f9fa';
  ctx.fill();
}

function drawWaiting(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  labelled: boolean,
): void {
  if (!labelled) return;
  ctx.font = '600 14px ui-monospace, SFMono-Regular, Menlo, monospace';
  ctx.textAlign = 'center';
  ctx.fillStyle = 'rgba(248,249,250,0.8)';
  ctx.fillText('Step back until your whole body is in view', w / 2, h / 2 - 40);
}

function clamp(lo: number, hi: number, v: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
