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
 *  - The runner sits above the bottom edge, leaving room for the pack.
 *  - The burn meter spans the full width so it is readable peripherally.
 *
 * The sense of speed comes from the verge, not the track: grass tufts
 * streaming past on both sides cross the whole screen and visually accelerate
 * as they near the camera. The track itself stays calm so obstacles pop.
 */

const HORIZON = 0.34;
const GROUND = 0.82;
const LANE_SPREAD = 0.3;

/**
 * Deterministic 0..1 from an integer. All scattered scenery (stars, tufts,
 * trees) is derived from this so it holds still between frames — per-frame
 * Math.random() here would make the whole backdrop shimmer.
 */
function hash(n: number): number {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
}

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
    // The GPU is shared with MediaPipe; never render above 1.5x, whatever the
    // display claims it wants.
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
    this.backdrop(world);
    this.track(world);
    this.grass(world);
    this.coins(world);
    this.obstacles(world);
    this.runner(world, lanes);
    this.pack(world);
    this.handCursors(hands);
    this.vignette();
    this.hud(world);

    ctx.restore();
  }

  /* ---------------------------------------------------------------------- */
  /* Background                                                              */
  /* ---------------------------------------------------------------------- */

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

    const hy = this.h * HORIZON;

    // First stars of the evening, thinning toward the light at the horizon.
    for (let i = 0; i < 70; i++) {
      const sx = hash(i) * this.w;
      const sy = hash(i + 100) * hy * 0.85;
      const twinkle = 0.35 + 0.65 * Math.abs(Math.sin(world.elapsed * 1.6 + i * 1.93));
      const a = (1 - sy / hy) * 0.5 * twinkle;
      const size = i % 9 === 0 ? 2 : 1;
      ctx.fillStyle = `rgba(240,238,255,${a.toFixed(3)})`;
      ctx.fillRect(sx, sy, size, size);
    }

    // A low sun with a genuine glow. Drawn before the tree line, so it sets
    // behind the savannah instead of floating on it.
    const sunX = this.w * 0.5;
    const sunY = hy + 8;
    const sunR = this.h * 0.09;
    const glow = ctx.createRadialGradient(sunX, sunY, 0, sunX, sunY, sunR * 3);
    glow.addColorStop(0, surge ? 'rgba(255,224,130,0.5)' : 'rgba(255,170,90,0.38)');
    glow.addColorStop(0.35, surge ? 'rgba(255,214,10,0.18)' : 'rgba(255,140,70,0.14)');
    glow.addColorStop(1, 'rgba(255,140,70,0)');
    ctx.fillStyle = glow;
    ctx.fillRect(sunX - sunR * 3, sunY - sunR * 3, sunR * 6, sunR * 6);
    ctx.beginPath();
    ctx.arc(sunX, sunY, sunR, 0, Math.PI * 2);
    ctx.fillStyle = surge ? 'rgba(255,224,130,0.55)' : 'rgba(255,190,110,0.5)';
    ctx.fill();
  }

  /**
   * Parallax savannah: a far ridge, a line of acacias, a near ridge. Each
   * drifts with distance at a different, far slower rate than the track —
   * which is most of what makes the fake-3D read as a world moving past
   * rather than shapes sliding down a screen.
   */
  private backdrop(world: World): void {
    const ctx = this.ctx;
    const hy = this.h * HORIZON;

    // Land is dark at dusk; only the sky glows. Without this plain the sunset
    // gradient continues below the horizon and the ridge silhouettes end in a
    // hard stripe with bright sky underneath — which reads as a glitch, not a
    // landscape. It also gives the gold track and grass something to sit on.
    const plain = ctx.createLinearGradient(0, hy, 0, this.h);
    plain.addColorStop(0, world.surge > 0 ? '#5c3838' : '#3f2739');
    plain.addColorStop(0.4, '#2b1a2b');
    plain.addColorStop(1, '#1c1120');
    ctx.fillStyle = plain;
    ctx.fillRect(0, hy, this.w, this.h - hy);

    this.ridge(hy, world.distance * 0.15, this.h * 0.045, '#241636', 0);
    this.acacias(hy + 2, world.distance * 0.3);
    this.ridge(hy + 2, world.distance * 0.45, this.h * 0.022, '#170d22', 40);

    // Danger reads through the world, not through a bar: at close range the
    // whole backdrop tightens. Drawn before the track so obstacles stay lit.
    if (world.gap < 25) {
      const t = 1 - world.gap / 25;
      ctx.fillStyle = `rgba(120,10,20,${0.08 + t * 0.26})`;
      ctx.fillRect(0, 0, this.w, this.h);
    }
  }

  private ridge(hy: number, scrollPx: number, amp: number, color: string, seed: number): void {
    const ctx = this.ctx;
    ctx.beginPath();
    ctx.moveTo(0, hy + 3);
    for (let x = 0; x <= this.w + 16; x += 16) {
      const t = x + scrollPx;
      const y =
        hy -
        amp * (0.55 + 0.45 * Math.sin(t * 0.008 + seed)) -
        amp * 0.7 * Math.sin(t * 0.0027 + seed * 1.7);
      ctx.lineTo(x, y);
    }
    ctx.lineTo(this.w, hy + 3);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }

  private acacias(hy: number, scrollPx: number): void {
    const ctx = this.ctx;
    ctx.fillStyle = '#150b20';
    ctx.strokeStyle = '#150b20';
    const spacing = 300;
    const count = Math.ceil(this.w / spacing) + 2;
    const span = count * spacing;
    for (let i = 0; i < count; i++) {
      const x = ((((i * spacing + hash(i) * 180 - scrollPx) % span) + span) % span) - spacing;
      const s = 0.65 + hash(i + 9) * 0.55;
      // Trunk, forking into the canopy.
      ctx.lineWidth = 2.5 * s;
      ctx.beginPath();
      ctx.moveTo(x, hy);
      ctx.lineTo(x + 2 * s, hy - 22 * s);
      ctx.moveTo(x + 2 * s, hy - 14 * s);
      ctx.lineTo(x + 10 * s, hy - 24 * s);
      ctx.stroke();
      // The flat-topped canopy that says "savannah" in one shape.
      ctx.beginPath();
      ctx.ellipse(x + 4 * s, hy - 27 * s, 30 * s, 6.5 * s, 0, 0, Math.PI * 2);
      ctx.ellipse(x + 8 * s, hy - 32 * s, 16 * s, 4.5 * s, 0, 0, Math.PI * 2);
      ctx.fill();
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

  /**
   * Grass streaming past on both verges, at true scroll speed. The strongest
   * speed cue in the scene: it crosses the whole screen and visually
   * accelerates as it nears the camera, exactly like a roadside.
   */
  private grass(world: World): void {
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    for (let i = 0; i < 44; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const laneX = side * (1.75 + hash(i) * 1.7);
      const z =
        (((hash(i + 50) * TRACK_DEPTH - world.distance) % TRACK_DEPTH) + TRACK_DEPTH) %
        TRACK_DEPTH;
      const p = this.project(z, laneX);
      if (p.s < 0.3) continue;
      const height = (12 + hash(i + 80) * 20) * p.s;
      ctx.strokeStyle = `rgba(196,164,96,${((p.s - 0.25) * 0.5).toFixed(3)})`;
      ctx.lineWidth = Math.max(1, 2.2 * p.s);
      for (let blade = -1; blade <= 1; blade++) {
        ctx.beginPath();
        ctx.moveTo(p.x + blade * 3 * p.s, p.y);
        ctx.quadraticCurveTo(
          p.x + blade * 5 * p.s,
          p.y - height * 0.6,
          p.x + blade * 9 * p.s + side * 4 * p.s,
          p.y - height,
        );
        ctx.stroke();
      }
    }
  }

  /* ---------------------------------------------------------------------- */
  /* World objects                                                           */
  /* ---------------------------------------------------------------------- */

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
        const hgt = 15 * p.s;
        const top = p.y - hgt - 2 * p.s;
        ctx.fillStyle = `rgba(255,159,28,${alpha})`;
        roundRect(ctx, p.x - width / 2, top, width, hgt, hgt / 2);
        ctx.fillStyle = `rgba(140,74,10,${alpha * 0.55})`;
        roundRect(ctx, p.x - width / 2, top + hgt * 0.55, width, hgt * 0.45, hgt * 0.22);
        // Sawn end grain on both ends, so it reads as a log and not a bar.
        for (const e of [-1, 1]) {
          ctx.beginPath();
          ctx.ellipse(p.x + (e * width) / 2, top + hgt / 2, 5 * p.s, hgt / 2, 0, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255,214,150,${alpha})`;
          ctx.fill();
          ctx.beginPath();
          ctx.ellipse(p.x + (e * width) / 2, top + hgt / 2, 2.4 * p.s, hgt / 4, 0, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(150,84,20,${alpha})`;
          ctx.fill();
        }
        // A snapped branch stub.
        ctx.strokeStyle = `rgba(255,159,28,${alpha})`;
        ctx.lineWidth = 3.5 * p.s;
        ctx.beginPath();
        ctx.moveTo(p.x - width * 0.18, top + 2 * p.s);
        ctx.lineTo(p.x - width * 0.23, top - 11 * p.s);
        ctx.stroke();
      } else if (o.type === 'beam') {
        // Low branch at head height. CYAN = get under it.
        const width = w * 2.6;
        const top = p.y - 152 * p.s;
        ctx.fillStyle = `rgba(76,201,240,${alpha})`;
        roundRect(ctx, p.x - width / 2, top, width, 14 * p.s, 7 * p.s);
        // Foliage hanging beneath — the reason ducking is the move.
        for (let i = -2; i <= 2; i++) {
          const fx = p.x + i * width * 0.18;
          ctx.beginPath();
          ctx.ellipse(
            fx,
            top + (22 + Math.abs(i) * 4) * p.s,
            13 * p.s,
            (12 + (i % 2 === 0 ? 6 : 0)) * p.s,
            0,
            0,
            Math.PI * 2,
          );
          ctx.fillStyle = `rgba(76,201,240,${alpha * 0.38})`;
          ctx.fill();
        }
        ctx.strokeStyle = `rgba(76,201,240,${alpha * 0.6})`;
        ctx.lineWidth = 2 * p.s;
        for (let i = -1; i <= 1; i++) {
          ctx.beginPath();
          ctx.moveTo(p.x + i * width * 0.28, top + 12 * p.s);
          ctx.lineTo(p.x + i * width * 0.3, top + 34 * p.s);
          ctx.stroke();
        }
      } else {
        // Thorn thicket filling a lane. PALE = go around it.
        const half = w * 0.42;
        const hgt = 88 * p.s;
        ctx.beginPath();
        ctx.moveTo(p.x - half, p.y);
        const spikes = 7;
        for (let i = 0; i <= spikes; i++) {
          const sx = p.x - half + (i / spikes) * half * 2;
          const peak = i % 2 === 0 ? 0.55 : 0.78 + hash(o.id * 7 + i) * 0.22;
          ctx.lineTo(sx, p.y - hgt * peak);
        }
        ctx.lineTo(p.x + half, p.y);
        ctx.closePath();
        ctx.fillStyle = `rgba(168,176,196,${alpha})`;
        ctx.fill();
        ctx.fillStyle = `rgba(60,56,74,${alpha * 0.8})`;
        roundRect(ctx, p.x - half * 0.72, p.y - hgt * 0.52, half * 1.44, hgt * 0.52, 6 * p.s);
        // Crossed thorns poking out of the dark mass.
        ctx.strokeStyle = `rgba(168,176,196,${alpha * 0.8})`;
        ctx.lineWidth = 1.6 * p.s;
        for (let i = 0; i < 3; i++) {
          const tx = p.x - half * 0.4 + i * half * 0.4;
          const ty = p.y - hgt * (0.25 + hash(o.id * 3 + i) * 0.2);
          ctx.beginPath();
          ctx.moveTo(tx - 7 * p.s, ty + 5 * p.s);
          ctx.lineTo(tx + 7 * p.s, ty - 5 * p.s);
          ctx.moveTo(tx - 6 * p.s, ty - 6 * p.s);
          ctx.lineTo(tx + 6 * p.s, ty + 6 * p.s);
          ctx.stroke();
        }
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
      // A firefly: soft glow around a bright core, pulsing slightly.
      const pulse = 0.8 + 0.2 * Math.sin(world.elapsed * 6 + c.group * 2.3 + c.x * 5);
      const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, r * 2.4);
      glow.addColorStop(0, `rgba(255,236,150,${(0.5 + p.s * 0.4) * pulse})`);
      glow.addColorStop(0.45, `rgba(255,226,120,${0.2 * pulse})`);
      glow.addColorStop(1, 'rgba(255,226,120,0)');
      ctx.fillStyle = glow;
      ctx.fillRect(p.x - r * 2.4, p.y - r * 2.4, r * 4.8, r * 4.8);
      ctx.beginPath();
      ctx.arc(p.x, p.y, r * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255,246,200,${0.55 + p.s * 0.45})`;
      ctx.fill();
    }
  }

  /**
   * The runner: an articulated figure, not a box. Legs scissor with the
   * stride, tuck when airborne; the torso folds forward into a squat; Surge
   * lifts the whole figure clear of the ground and sets it glowing. The point
   * is feedback — every input the recogniser fires should be visible as a
   * pose change within a frame.
   */
  private runner(world: World, lanes: LaneModel): void {
    const ctx = this.ctx;
    const p = this.project(0, lanes.visual);
    const jump = world.airborne > 0 ? Math.sin((1 - world.airborne / 0.62) * Math.PI) : 0;
    const ducked = world.ducking > 0;
    const surging = world.surge > 0;
    const tucked = world.airborne > 0 || surging;

    // Surge is flight: the rest interval reads as being lifted clear.
    const hover = surging ? 44 + Math.sin(world.elapsed * 5) * 6 : 0;
    const lift = jump * 88 + hover;
    const footY = p.y - lift;

    // Shadow stays on the ground; it is what sells the height of everything.
    const off = Math.min(1, lift / 88);
    ctx.fillStyle = `rgba(8,4,12,${0.42 - off * 0.28})`;
    ctx.beginPath();
    ctx.ellipse(p.x, p.y + 4, 22 - off * 8, 5.5, 0, 0, Math.PI * 2);
    ctx.fill();

    // Neutral-stance mark: where centre lane meets the ground. Players
    // self-correct against it without being told.
    ctx.strokeStyle = 'rgba(244,237,226,0.1)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([5, 7]);
    ctx.beginPath();
    ctx.ellipse(this.w * 0.5, p.y + 4, 30, 7, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    if (world.invuln > 0 && Math.floor(world.invuln * 12) % 2 === 0) return;

    const color = surging ? '#ffd60a' : '#f4ede2';
    const phase = world.distance * 0.55;

    const hipY = footY - (ducked ? 22 : 36);
    const hipX = p.x;
    const shoulderX = hipX + (ducked ? 15 : 6);
    const shoulderY = hipY - (ducked ? 13 : 27);

    ctx.strokeStyle = color;
    ctx.fillStyle = color;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    if (surging) {
      ctx.shadowColor = 'rgba(255,214,10,0.8)';
      ctx.shadowBlur = 16;
    }

    // Legs: scissoring on the ground, tucked in the air.
    ctx.lineWidth = 5.5;
    for (const dir of [1, -1]) {
      const swing = tucked ? 0.5 * dir : Math.sin(phase) * dir;
      const kneeX = hipX + swing * 9 + 4;
      const kneeY = hipY + (ducked ? 10 : 17) - Math.abs(swing) * 3;
      ctx.beginPath();
      ctx.moveTo(hipX, hipY);
      if (tucked) {
        ctx.quadraticCurveTo(kneeX + 6, kneeY, hipX + swing * 8 + 8, kneeY + 8);
      } else {
        ctx.quadraticCurveTo(kneeX, kneeY, hipX + swing * 15, footY - Math.max(0, -swing) * 9);
      }
      ctx.stroke();
    }

    // Torso.
    ctx.lineWidth = 8;
    ctx.beginPath();
    ctx.moveTo(hipX, hipY);
    ctx.lineTo(shoulderX, shoulderY);
    ctx.stroke();

    // Arms, swinging opposite the legs; folded back in a squat.
    ctx.lineWidth = 4.5;
    for (const dir of [1, -1]) {
      const swing = ducked ? -0.7 : Math.sin(phase + Math.PI) * dir * 0.8;
      ctx.beginPath();
      ctx.moveTo(shoulderX, shoulderY + 3);
      ctx.quadraticCurveTo(
        shoulderX + swing * 8,
        shoulderY + 12,
        shoulderX + swing * 14 + 4,
        shoulderY + (ducked ? 6 : 16) - Math.max(0, swing) * 14,
      );
      ctx.stroke();
    }

    // Head, leading the movement when squatting.
    ctx.beginPath();
    ctx.arc(shoulderX + (ducked ? 8 : 3), shoulderY - 10, 7.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.shadowBlur = 0;
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

  /** Darkened corners pull the eye to the track without touching the HUD. */
  private vignette(): void {
    const ctx = this.ctx;
    const r0 = Math.min(this.w, this.h) * 0.45;
    const r1 = Math.max(this.w, this.h) * 0.75;
    const g = ctx.createRadialGradient(
      this.w / 2,
      this.h * 0.48,
      r0,
      this.w / 2,
      this.h * 0.52,
      r1,
    );
    g.addColorStop(0, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(5,2,10,0.38)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
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
