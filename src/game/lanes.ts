import type { Band } from '../types.js';

/**
 * Where the runner is, and how it gets there on screen.
 *
 * This is now almost nothing, and that is the point. It used to carry a lane
 * state machine driven by edge-triggered lean gestures, plus a rolling median
 * of body position, plus re-baselining, plus disagreement recovery — roughly
 * sixty lines whose entire job was surviving the fact that `lean` was measured
 * against a remembered neutral pose that drifted as the player shuffled around
 * the room over three minutes.
 *
 * Screen bands are absolute. They cannot drift, so none of that is needed: the
 * band the player is standing in *is* the lane. All that remains is easing the
 * drawn position toward it.
 */
export class LaneModel {
  /** Where the runner actually is. */
  lane: Band = 0;
  /** Where it is drawn, eased toward `lane`. */
  visual = 0;

  set(band: Band): void {
    this.lane = band;
  }

  step(dt: number): void {
    // 90ms ease-out. Never linear: linear reads as floaty at this distance.
    const k = 1 - Math.pow(0.001, dt / 0.09);
    this.visual += (this.lane - this.visual) * k;
  }

  reset(): void {
    this.lane = 0;
    this.visual = 0;
  }
}
