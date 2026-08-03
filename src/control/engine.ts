import { FeatureExtractor } from '../pose/features.js';
import type { PoseFrame } from '../pose/types.js';
import type { Action, Body, Intensity, Tracking } from '../types.js';
import { buildTracking, IntensityTracker } from './signals.js';
import { ZoneRecognizer, type ZoneState } from './zones.js';

/**
 * Everything between a camera frame and the game, in one place.
 *
 * This used to be a recognition engine, a subscription model, an iframe host, a
 * postMessage bridge, a wire protocol and a client — eleven hops and a
 * serialisation boundary. It is now one function call on the same frame. The
 * protocol earned its keep when games were third-party cartridges on other
 * origins; with one game in one folder it was pure latency and pure surface.
 */
export interface ControlFrame {
  /** Edge-triggered movements: fire once each, on the way in. */
  actions: Action[];
  /** The control grid: which band, where the lines are, what is held. */
  zones: ZoneState;
  /** Continuous body state, mirrored. Null before anyone is visible. */
  body: Body | null;
  intensity: Intensity;
  tracking: Tracking;
  /** Frame timestamp, in the same clock the game's loop uses. */
  t: number;
}

export class ControlEngine {
  private readonly extractor = new FeatureExtractor();
  private readonly zones = new ZoneRecognizer();
  private readonly intensity = new IntensityTracker();

  reset(): void {
    this.extractor.reset();
    this.zones.reset();
    this.intensity.reset();
  }

  process(frame: PoseFrame): ControlFrame {
    const features = this.extractor.extract(frame);
    const actions = this.zones.update(features);
    const intensity = this.intensity.update(features);
    const tracking = buildTracking(features);

    return {
      actions,
      zones: this.zones.current,
      body: features.present ? this.zones.body(features) : null,
      intensity,
      tracking,
      t: features.t,
    };
  }
}
