import { PACK, RUN_SECONDS, TRACK_DEPTH } from './config.js';
import type { Coin, World } from './world.js';
import type { HandCursors } from './hands.js';
import type { LaneModel } from './lanes.js';
import type { Point2 } from '../types.js';

/**
 * Canvas 2D renderer. Fake-3D: everything is a 2D shape scaled by depth, with
 * no actual 3D anywhere.
 *
 * Dusk on the savannah. The palette is deliberately low-contrast — violet sky,
 * dry gold grass — with ONE exception that is not negotiable: obstacles keep a
 * strict colour code (amber = jump, cyan = duck, pale grey = move) no matter
 * what the scene is doing. A naturalistic runner is only fun if you can still
 * read the next obstacle at a glance while airborne, and a dusk palette is
 * exactly the kind of thing that quietly destroys that. Atmosphere goes in the
 * background layers; the things that can kill you stay lit.
 *
 * Layout rules that are not negotiable, because of where the player's eyes
 * physically are while jumping and squatting:
 *  - Everything critical lives in the top 15%. A player mid-squat cannot read
 *    the bottom of the screen.
 *  - The runner sits above the bottom edge, leaving room for the neutral-stance
 *    ghost and the pack's silhouette.
 *  - The burn meter spans the full width so it is readable peripherally.
 */

const HORIZON = 0.34;
const GROUND = 0.82;
const LANE_SPREAD = 0.3;

export class Scene {
  private readonly ctx: CanvasRenderingContext2D;
  private dpr = 1;
  w = 0;
  h = 0;

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.ctx = canvas.getContext('2d', { alpha: false })!;
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  resize(): void {
    // The GPU is shared with MediaPipe in the parent frame; never render above
    // 1.5x, whatever the display claims it wants.
    this.dpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const rect = this.canvas.getBoundingClientRect();
    this.w = Math.max(1, rect.width);
    this.h = Math.max(1, rect.height);
    this.canvas.width = Math.floor(this.w * this.dpr);
    this.canvas.height = Math.floor(this.h * this.dpr);
  }

  /** z -> 0..1, where 0 is the commit line and 1 is the horizon. */
  private depth(z: number): number {
    return Math.max(0, Math.min(1, z / TRACK_DEPTH));
  }

  /** Perspective scale: 1 at the commit line, ~0.25 at the horizon. */
  private scaleAt(z: number): number {
    return 1 / (1 + this.depth(z) * 3);
  }

  private project(z: number, laneX: number): { x: number; y: number; s: number } {
    const s = this.scaleAt(z);
    const y = this.h * (HORIZON + (GROUND - HORIZON) * s);
    const x = this.w * 0.5 + laneX * this.w * LANE_SPREAD * s;
    return { x, y, s };
  }

  draw(world: World, lanes: LaneModel, hands: HandCursors): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);

    this.sky(world);
    this.track(world);
    this.coins(world);
    this.obstacles(world);
    this.runner(world, lanes);
    this.pack(world);
    this.handCursors(hands);
    this.hud(world);

    ctx.restore();
  }

  private sky(world: World): void {
    const ctx = this.ctx;
    const surge = world.surge > 0;
    const g = ctx.createLinearGradient(0, 0, 0, this.h * GROUND);
    if (surge) {
      // Open ground along the riverbank: the sky lifts and the dust clears.
      g.addColorStop(0, '#2b1c4a');
      g.addColorStop(0.55, '#7a4a6b');
      g.addColorStop(1, '#d98f5a');
    } else if (world.phase.id === 'finale') {
      g.addColorStop(0, '#1a0d24');
      g.addColorStop(0.6, '#5c1f33');
      g.addColorStop(1, '#8f3a2f');
    } else {
      g.addColorStop(0, '#1a1030');
      g.addColorStop(0.6, '#3d2450');
      g.addColorStop(1, '#7a4a52');
    }
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);

    // A low sun sitting on the horizon, so the dusk reads as dusk.
    const hy = this.h * HORIZON;
    ctx.beginPath();
    ctx.arc(this.w * 0.5, hy + 6, this.h * 0.075, 0, Math.PI * 2);
    ctx.fillStyle = surge ? 'rgba(255,214,10,0.34)' : 'rgba(255,150,80,0.22)';
    ctx.fill();

    // Danger reads through the world, not through a bar: at close range the
    // whole screen tightens.
    if (world.gap < 25) {
      const t = 1 - world.gap / 25;
      ctx.fillStyle = `rgba(120,10,20,${0.08 + t * 0.26})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private track(world: World): void {
    const ctx = this.ctx;
    const near = this.project(0, 0);
    const far = this.project(TRACK_DEPTH, 0);

    ctx.beginPath();
    ctx.moveTo(this.project(TRACK_DEPTH, -1.5).x, far.y);
    ctx.lineTo(this.project(TRACK_DEPTH, 1.5).x, far.y);
    ctx.lineTo(this.project(0, 1.5).x, near.y);
    ctx.lineTo(this.project(0, -1.5).x, near.y);
    ctx.closePath();
    const g = ctx.createLinearGradient(0, far.y, 0, near.y);
    g.addColorStop(0, 'rgba(92,70,44,0.55)');
    g.addColorStop(1, 'rgba(168,134,74,0.85)');
    ctx.fillStyle = g;
    ctx.fill();

    ctx.strokeStyle = 'rgba(226,196,128,0.22)';
    ctx.lineWidth = 1;
    for (const lane of [-1.5, -0.5, 0.5, 1.5]) {
      ctx.beginPath();
      ctx.moveTo(this.project(TRACK_DEPTH, lane).x, far.y);
      ctx.lineTo(this.project(0, lane).x, near.y);
      ctx.stroke();
    }

    // Scrolling rungs, so speed is legible even on an empty stretch.
    const spacing = 10;
    const offset = world.distance % spacing;
    for (let z = TRACK_DEPTH - offset; z > 0; z -= spacing) {
      const p = this.project(z, 0);
      const half = this.w * LANE_SPREAD * 1.5 * p.s;
      ctx.strokeStyle = `rgba(226,196,128,${0.04 + p.s * 0.14})`;
      ctx.beginPath();
      ctx.moveTo(p.x - half, p.y);
      ctx.lineTo(p.x + half, p.y);
      ctx.stroke();
    }
  }

  private obstacles(world: World): void {
    const ctx = this.ctx;
    // Far to near, so nearer things overdraw.
    const sorted = [...world.obstacles].sort((a, b) => b.z - a.z);
    for (const o of sorted) {
      const p = this.project(o.z, o.lane);
      const w = this.w * LANE_SPREAD * p.s;
      const alpha = o.hit ? 0.35 : 1;

      if (o.type === 'hurdle') {
        // Fallen log across the track. AMBER = get your feet over it.
        const width = w * 2.4;
        ctx.fillStyle = `rgba(255,159,28,${alpha})`;
        roundRect(ctx, p.x - width / 2, p.y - 16 * p.s, width, 14 * p.s, 7 * p.s);
        ctx.fillStyle = `rgba(120,66,12,${alpha * 0.9})`;
        roundRect(ctx, p.x - width / 2, p.y - 6 * p.s, width, 5 * p.s, 2 * p.s);
      } else if (o.type === 'beam') {
        // Low branch at head height. CYAN = get under it.
        const width = w * 2.6;
        ctx.fillStyle = `rgba(76,201,240,${alpha})`;
        roundRect(ctx, p.x - width / 2, p.y - 152 * p.s, width, 15 * p.s, 7 * p.s);
        ctx.fillStyle = `rgba(76,201,240,${alpha * 0.35})`;
        for (let i = -1; i <= 1; i += 1) {
          roundRect(ctx, p.x + i * width * 0.3, p.y - 140 * p.s, 6 * p.s, 22 * p.s, 3 * p.s);
        }
      } else {
        // Thorn thicket filling a lane. PALE = go around it.
        ctx.fillStyle = `rgba(168,176,196,${alpha})`;
        roundRect(ctx, p.x - w * 0.42, p.y - 86 * p.s, w * 0.84, 86 * p.s, 8 * p.s);
        ctx.fillStyle = `rgba(60,56,74,${alpha * 0.8})`;
        roundRect(ctx, p.x - w * 0.3, p.y - 70 * p.s, w * 0.6, 44 * p.s, 6 * p.s);
      }
    }
  }

  /**
   * Where a coin lands, in pixels. The world uses the normalised form of this
   * for collection, so the hitbox is always exactly the sprite.
   *
   * `coin.y` is a height band: ~0.16 overhead, ~0.42 shoulder, ~0.72 knee. It
   * becomes a height *above the track*, scaled by depth, so a coin sits in the
   * world rather than floating at a fixed screen position.
   */
  coinPoint(coin: Coin): { x: number; y: number; s: number } {
    const p = this.project(coin.z, coin.x * 1.4);
    const height = (1 - coin.y) * 260 * p.s;
    return { x: p.x, y: p.y - height, s: p.s };
  }

  /** The same point, normalised — this is what the hand cursors are measured in. */
  coinNormalised(coin: Coin): Point2 {
    const p = this.coinPoint(coin);
    return { x: p.x / this.w, y: p.y / this.h };
  }

  private coins(world: World): void {
    const ctx = this.ctx;
    for (const c of world.coins) {
      if (c.taken) continue;
      const p = this.coinPoint(c);
      if (p.y < -20 || p.y > this.h + 20) continue;
      const r = Math.max(2.5, 13 * p.s);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,226,120,${0.35 + p.s * 0.65})`;
      ctx.fill();
      if (p.s > 0.5) {
        ctx.beginPath();
        ctx.arc(p.x, p.y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(255,226,120,${(p.s - 0.5) * 0.55})`;
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
  }

  private runner(world: World, lanes: LaneModel): void {
    const ctx = this.ctx;
    const p = this.project(0, lanes.visual);
    const jump = world.airborne > 0 ? Math.sin((1 - world.airborne / 0.62) * Math.PI) : 0;
    const duck = world.ducking > 0 ? 1 : 0;
    const y = p.y - jump * 70;
    const height = duck ? 30 : 52;

    // Neutral-stance ghost: players self-correct against it without being told.
    ctx.strokeStyle = 'rgba(255,255,255,0.13)';
    ctx.lineWidth = 1;
    ctx.strokeRect(this.w * 0.5 - 13, p.y - 52, 26, 52);

    if (world.invuln > 0 && Math.floor(world.invuln * 12) % 2 === 0) return;

    ctx.fillStyle = world.surge > 0 ? '#ffd60a' : '#f4ede2';
    ctx.fillRect(p.x - 13, y - height, 26, height);
    ctx.beginPath();
    ctx.arc(p.x, y - height - 10, 10, 0, Math.PI * 2);
    ctx.fill();

    // Shadow sells the jump height better than the sprite does.
    ctx.fillStyle = `rgba(0,0,0,${0.4 - jump * 0.25})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 4, 18 - jump * 6, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * The pack, read through the world rather than off a HUD bar.
   *
   * Three channels, all of which scale continuously with the gap, so the player
   * always knows without reading anything:
   *  - eyes in the grass at the bottom of frame, more of them as they close
   *  - a dark mass rising behind you
   *  - your own shadow thrown forward up the track by the low sun behind them
   *
   * A predator reads differently from a hazard, which is the whole reason the
   * theme is a living thing: eyes that are looking at you are worse than a wall.
   */
  private pack(world: World): void {
    if (world.gap > 55) return;
    const ctx = this.ctx;
    const t = 1 - Math.max(0, world.gap) / 55;
    const base = this.h;

    // The mass.
    ctx.beginPath();
    ctx.moveTo(0, base);
    ctx.quadraticCurveTo(this.w * 0.5, base - this.h * 0.03 - t * this.h * 0.2, this.w, base);
    ctx.closePath();
    ctx.fillStyle = `rgba(14,8,20,${0.35 + t * 0.55})`;
    ctx.fill();

    // Eyes. Count and brightness both climb; they blink out of phase so the
    // group reads as several animals rather than one decal.
    const count = Math.min(7, 1 + Math.floor(t * 7));
    const crest = base - this.h * 0.02 - t * this.h * 0.14;
    for (let i = 0; i < count; i += 1) {
      const spread = (i - (count - 1) / 2) / Math.max(1, count);
      const ex = this.w * (0.5 + spread * 0.72);
      const ey = crest + Math.sin(i * 2.1) * this.h * 0.018 + this.h * 0.03;
      const blink = Math.sin(world.elapsed * 3 + i * 1.7) > -0.92 ? 1 : 0.15;
      const r = (2.6 + t * 2.6) * blink;
      ctx.fillStyle = `rgba(255,${120 - t * 90},60,${(0.5 + t * 0.5) * blink})`;
      ctx.beginPath();
      ctx.arc(ex - 5 - t * 3, ey, r, 0, Math.PI * 2);
      ctx.arc(ex + 5 + t * 3, ey, r, 0, Math.PI * 2);
      ctx.fill();
    }

    // Your shadow, thrown up the track. Puts the threat in your forward field
    // of view without a rear-view mirror.
    if (t > 0.25) {
      const p = this.project(0, 0);
      ctx.beginPath();
      ctx.ellipse(this.w * 0.5, p.y - 30, 26 + t * 26, 70 + t * 90, 0, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(10,6,14,${(t - 0.25) * 0.34})`;
      ctx.fill();
    }

    if (world.elapsed >= PACK.COMMIT_AT && world.elapsed < PACK.COMMIT_AT + PACK.COMMIT_SECONDS) {
      ctx.textAlign = 'center';
      ctx.font = '700 26px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = `rgba(255,90,60,${0.6 + 0.4 * Math.sin(world.elapsed * 9)})`;
      ctx.fillText('THEY COMMIT', this.w * 0.5, this.h * 0.44);
    }
  }

  private handCursors(hands: HandCursors): void {
    const ctx = this.ctx;
    // Drawn on top of everything, always: they are the player's proprioceptive
    // anchor and must never be occluded.
    for (const hand of [hands.left, hands.right]) {
      ctx.beginPath();
      ctx.arc(hand.x * this.w, hand.y * this.h, 22, 0, Math.PI * 2);
      ctx.strokeStyle = hand.visible ? 'rgba(29,233,182,0.9)' : 'rgba(29,233,182,0.3)';
      ctx.lineWidth = 3;
      ctx.stroke();
    }
  }

  private hud(world: World): void {
    const ctx = this.ctx;
    const remaining = Math.max(0, RUN_SECONDS - world.elapsed);
    const mm = Math.floor(remaining / 60);
    const ss = Math.floor(remaining % 60).toString().padStart(2, '0');

    ctx.font = '600 22px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f8f9fa';
    ctx.textAlign = 'left';
    ctx.fillText(`${mm}:${ss}`, 20, 22);

    ctx.textAlign = 'right';
    ctx.fillText(Math.floor(world.score).toLocaleString(), this.w - 20, 22);

    ctx.textAlign = 'center';
    if (world.combo > 1) {
      ctx.font = '700 34px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#e2c480';
      ctx.fillText(`x${world.combo}`, this.w * 0.5, 16);
    }

    // Burn meter: full width, top edge, fills toward the centre from both sides
    // so it registers in peripheral vision.
    const fill = world.surge > 0 ? world.surge / 12 : world.burnFill;
    const color = world.surge > 0 ? '#ffd60a' : '#1de9b6';
    ctx.fillStyle = 'rgba(255,255,255,0.1)';
    ctx.fillRect(0, 0, this.w, 6);
    ctx.fillStyle = color;
    ctx.fillRect(this.w * 0.5 - (this.w * fill) / 2, 0, this.w * fill, 6);

    // Gap ribbon, left edge. Optional backstop; the world is the real channel.
    const gapT = world.gap / PACK.MAX_GAP;
    ctx.fillStyle = 'rgba(255,255,255,0.08)';
    ctx.fillRect(8, this.h * 0.25, 5, this.h * 0.5);
    ctx.fillStyle = gapT < 0.25 ? '#ff5a3c' : '#e2c480';
    ctx.fillRect(8, this.h * 0.75 - this.h * 0.5 * gapT, 5, this.h * 0.5 * gapT);

    if (world.secondWindHeld > 0) {
      ctx.textAlign = 'left';
      ctx.font = '600 13px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = '#e2c480';
      ctx.fillText('◆ SECOND WIND', 22, 54);
    }

    if (world.flash) {
      ctx.textAlign = 'center';
      ctx.globalAlpha = Math.min(1, world.flash.life / 0.5);
      ctx.font = '700 44px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = world.flash.color;
      ctx.fillText(world.flash.text, this.w * 0.5, this.h * 0.3);
      ctx.globalAlpha = 1;
    }
  }

  overlay(lines: Array<{ text: string; big?: boolean; color?: string }>): void {
    const ctx = this.ctx;
    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.fillStyle = 'rgba(6,8,16,0.88)';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    let y = this.h * 0.5 - (lines.length * 34) / 2;
    for (const line of lines) {
      ctx.font = line.big
        ? '700 40px ui-monospace, SFMono-Regular, Menlo, monospace'
        : '400 17px ui-monospace, SFMono-Regular, Menlo, monospace';
      ctx.fillStyle = line.color || '#f8f9fa';
      ctx.fillText(line.text, this.w * 0.5, y);
      y += line.big ? 52 : 30;
    }
    ctx.restore();
  }
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, Math.min(w, h) / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
  ctx.fill();
}
