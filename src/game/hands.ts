import { HAND } from './config.js';
import type { Body, TrackedPoint } from '../types.js';

/**
 * One-euro filter. Smooths hard when the hand is still and barely at all when
 * it is moving fast, which is exactly the trade a cursor wants: no visible
 * jitter at rest, no lag on a reach.
 */
class OneEuro {
  private value: number | null = null;
  private derivative = 0;
  private lastT = 0;

  constructor(
    private readonly minCutoff: number,
    private readonly beta: number,
  ) {
  }

  filter(x: number, t: number): number {
    if (this.value === null) {
      this.value = x;
      this.lastT = t;
      return x;
    }
    const dt = Math.max(1e-3, (t - this.lastT) / 1000);
    this.lastT = t;

    const dAlpha = alpha(1.0, dt);
    const dx = (x - this.value) / dt;
    this.derivative += dAlpha * (dx - this.derivative);

    const cutoff = this.minCutoff + this.beta * Math.abs(this.derivative);
    const a = alpha(cutoff, dt);
    this.value += a * (x - this.value);
    return this.value;
  }
}

function alpha(cutoff: number, dt: number): number {
  const tau = 1 / (2 * Math.PI * cutoff);
  return 1 / (1 + tau / dt);
}

/**
 * Two hand cursors, driven by `input/body.hands`.
 *
 * The mapping is **body-relative, not frame-absolute**: anchored to
 * `bodyCenter` and `head` rather than to raw frame coordinates, so the cursor
 * doesn't slide across the screen when the player steps sideways. That is the
 * general rule for every continuous input on this platform.
 *
 * Mirroring is applied exactly once, in `zones.body()`, so `hands.right` is
 * already the hand that belongs on screen-right. Do not mirror again here —
 * double-mirroring makes everything feel subtly wrong rather than obviously
 * broken, which is far harder to notice.
 */
export class HandCursors {
  readonly left: TrackedPoint;
  readonly right: TrackedPoint;
  private readonly filters: Record<'lx' | 'ly' | 'rx' | 'ry', OneEuro>;

  constructor() {
    this.left = { x: 0.35, y: 0.5, visible: false };
    this.right = { x: 0.65, y: 0.5, visible: false };
    this.filters = {
      lx: new OneEuro(HAND.MIN_CUTOFF, HAND.BETA),
      ly: new OneEuro(HAND.MIN_CUTOFF, HAND.BETA),
      rx: new OneEuro(HAND.MIN_CUTOFF, HAND.BETA),
      ry: new OneEuro(HAND.MIN_CUTOFF, HAND.BETA),
    };
  }

  update(body: Body | null, now: number): void {
    if (!body) return;
    this.apply('left', body.hands.left, body, now, this.filters.lx, this.filters.ly);
    this.apply('right', body.hands.right, body, now, this.filters.rx, this.filters.ry);
  }

  private apply(
    side: 'left' | 'right',
    hand: TrackedPoint,
    body: Body,
    now: number,
    fx: OneEuro,
    fy: OneEuro,
  ): void {
    const cursor = this[side];
    // A hand that dropped out for 100ms next to a coin should still get the
    // coin: freeze in place and fade, never snap to a garbage position and
    // never stop collecting.
    if (!hand || hand.visible === false) {
      cursor.visible = false;
      return;
    }
    cursor.visible = true;
    const x = 0.5 + (hand.x - body.center.x) * HAND.GAIN_X;
    const y = 0.5 + (hand.y - body.head.y - 0.15) * HAND.GAIN_Y;
    cursor.x = clamp01(fx.filter(x, now));
    cursor.y = clamp01(fy.filter(y, now));
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
