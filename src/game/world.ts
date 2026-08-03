import {
  HAND,
  MAX_SCROLL_SPEED,
  MIN_TELEGRAPH_S,
  PACK,
  RUN_SECONDS,
  SCORE,
  SECOND_WIND,
  SURGE,
  TRACK_DEPTH,
  phaseAt,
  type Phase,
} from './config.js';
import type { HandCursors } from './hands.js';
import type { LaneModel } from './lanes.js';
import type { InputQueue } from './queue.js';
import type { Point2, RunSummary } from '../types.js';

export interface Obstacle {
  id: number;
  type: string;
  lane: number;
  z: number;
  resolved: boolean;
  hit: boolean;
  grazed: boolean;
}

export interface Coin {
  group: number;
  x: number;
  y: number;
  z: number;
  taken: boolean;
}

export interface Flash {
  text: string;
  color: string;
  life: number;
}

/**
 * The simulation. Stepped at a fixed 60Hz, never from a message handler, and
 * never from the render loop.
 *
 * Everything here is deterministic given (state, dt, consumed input), which is
 * what keeps the game fair when the browser stutters because MediaPipe just did
 * a long inference.
 */

let nextId = 1;

export class World {
  /**
   * @param projector maps a coin to normalised screen space, so collection is
   *   tested against exactly where the coin is drawn. Injected rather than
   *   duplicated: a hitbox that disagrees with the sprite is the worst kind of
   *   bug here, because it reads as "the tracking is bad".
   */
  elapsed = 0;
  activeMs = 0;
  over = false;
  outcome: 'finished' | 'caught' | null = null;
  obstacles: Obstacle[] = [];
  coins: Coin[] = [];
  spawnTimer = 1.2;
  gap = PACK.START_GAP;
  score = 0;
  combo = 0;
  bestCombo = 0;
  distance = 0;
  burn = 0;
  burnFill = 0;
  surge = 0;
  landingGrace = 0;
  secondWindHeld = 0;
  secondWindCharge = 0;
  invuln = 0;
  airborne = 0;
  ducking = 0;
  movements = { jumps: 0, crouches: 0, laneChanges: 0, reaches: 0 };
  lastLane = 0;
  intensitySum = 0;
  intensitySamples = 0;
  hits = 0;
  nearMisses = 0;
  coinsCollected = 0;
  flash: Flash | null = null;

  constructor(
    private readonly queue: InputQueue,
    private readonly lanes: LaneModel,
    private readonly hands: HandCursors,
    private readonly projector: (coin: Coin) => Point2,
  ) {
    this.reset();
  }

  reset(): void {
    this.elapsed = 0;
    this.activeMs = 0;
    this.over = false;
    this.outcome = null; // 'finished' | 'caught'

    this.obstacles = [];
    this.coins = [];

    this.spawnTimer = 1.2;
    this.gap = PACK.START_GAP;
    this.score = 0;
    this.combo = 0;
    this.bestCombo = 0;
    this.distance = 0;

    this.burn = 0;
    this.burnFill = 0;
    this.surge = 0; // seconds remaining
    this.landingGrace = 0;
    this.secondWindHeld = 0;
    this.secondWindCharge = 0;
    this.invuln = 0;

    this.airborne = 0; // seconds remaining in a jump
    this.ducking = 0;

    // What the workout summary is built from. Counted here, at the moment the
    // movement is actually performed, not inferred later.
    this.movements = { jumps: 0, crouches: 0, laneChanges: 0, reaches: 0 };
    this.lastLane = 0;
    this.intensitySum = 0;
    this.intensitySamples = 0;
    this.hits = 0;
    this.nearMisses = 0;
    this.coinsCollected = 0;
    this.flash = null;
  }

  get phase(): Phase {
    return phaseAt(this.elapsed);
  }

  get scrollSpeed(): number {
    const base = this.phase.scroll;
    // The cap is a consequence of the latency budget, not a preference.
    return Math.min(MAX_SCROLL_SPEED, this.surge > 0 ? base * 1.15 : base);
  }

  get scoreMultiplier(): number {
    if (this.surge > 0) return SURGE.SCORE_MULTIPLIER;
    return this.phase.id === 'finale' ? 3 : 1;
  }

  /* ---------------------------------------------------------------------- */
  /* Step                                                                    */
  /* ---------------------------------------------------------------------- */

  step(dt: number, now: number): void {
    if (this.over) return;

    this.elapsed += dt;
    this.activeMs += dt * 1000;
    this.distance += this.scrollSpeed * dt;

    this.tickTimers(dt);
    this.consumeActions(now);
    this.moveObstacles(dt);
    this.moveCoins(dt);
    this.spawn(dt);
    this.tickPack(dt);
    this.tickEffects(dt);

    if (this.elapsed >= RUN_SECONDS) this.finish('finished');
  }

  private tickTimers(dt: number): void {
    this.airborne = Math.max(0, this.airborne - dt);
    this.ducking = Math.max(0, this.ducking - dt);
    this.invuln = Math.max(0, this.invuln - dt);
    this.landingGrace = Math.max(0, this.landingGrace - dt);

    if (this.surge > 0) {
      this.surge = Math.max(0, this.surge - dt);
      if (this.surge === 0) {
        this.landingGrace = SURGE.LANDING_GRACE;
        this.pushFlash('LANDING', '#4cc9f0');
      }
    }

    // Lane changes are counted as movement the moment the lane actually flips.
    if (this.lanes.lane !== this.lastLane) {
      this.movements.laneChanges += Math.abs(this.lanes.lane - this.lastLane);
      this.lastLane = this.lanes.lane;
    }
  }

  /** Called from the intensity handler, not per step. */
  setIntensity(avg10s: number): void {
    this.burn = avg10s;
    this.intensitySum += avg10s;
    this.intensitySamples += 1;
  }

  tickBurn(dt: number): void {
    if (this.surge > 0) return;
    if (this.burn > SURGE.ENTER_INTENSITY) {
      this.burnFill = Math.min(1, this.burnFill + dt / SURGE.FILL_SECONDS);
      if (this.burnFill >= 1) {
        this.burnFill = 0;
        this.surge = SURGE.DURATION;
        this.pushFlash('SURGE', '#ffd60a');
      }
    } else {
      this.burnFill = Math.max(0, this.burnFill - dt / (SURGE.FILL_SECONDS * 2));
    }

    if (this.burn >= SECOND_WIND.INTENSITY) {
      this.secondWindCharge += dt;
      if (this.secondWindCharge >= SECOND_WIND.HOLD_SECONDS && this.secondWindHeld < 1) {
        this.secondWindHeld = 1;
        this.secondWindCharge = 0;
        this.pushFlash('SECOND WIND', '#1de9b6');
      }
    } else {
      this.secondWindCharge = Math.max(0, this.secondWindCharge - dt * 0.5);
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Player actions                                                          */
  /* ---------------------------------------------------------------------- */

  private consumeActions(now: number): void {
    // A jump or duck is accepted with no obstacle present too — the player is
    // allowed to move for its own sake, and the movement still counts.
    if (this.queue.take('JUMP', now) && this.airborne === 0) {
      this.airborne = 0.62;
      this.movements.jumps += 1;
    }
    if (this.queue.take('DUCK', now) && this.ducking === 0) {
      this.ducking = 0.55;
      this.movements.crouches += 1;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Obstacles                                                               */
  /* ---------------------------------------------------------------------- */

  private spawn(dt: number): void {
    // Surge is a designed rest: nothing to dodge, legs off, arms only.
    if (this.surge > 0 || this.landingGrace > 0) {
      this.spawnTimer = Math.max(this.spawnTimer, 0.6);
      if (this.surge > 0) this.spawnCoinArc(true);
      return;
    }

    this.spawnTimer -= dt;
    if (this.spawnTimer > 0) return;

    const phase = this.phase;
    this.spawnTimer = phase.interval;

    const type = phase.types[(Math.random() * phase.types.length) | 0] ?? 'hurdle';
    if (type === 'gauntlet') {
      for (let i = 0; i < 3; i++) {
        this.obstacles.push(makeObstacle('hurdle', 0, TRACK_DEPTH + i * 0.75 * phase.scroll));
      }
    } else if (type === 'double') {
      const free = (Math.random() * 3 | 0) - 1;
      for (const lane of [-1, 0, 1]) {
        if (lane !== free) this.obstacles.push(makeObstacle('wall', lane, TRACK_DEPTH));
      }
    } else if (type === 'wall') {
      this.obstacles.push(makeObstacle('wall', (Math.random() * 3 | 0) - 1, TRACK_DEPTH));
    } else {
      this.obstacles.push(makeObstacle(type, 0, TRACK_DEPTH));
    }

    if (Math.random() < 0.55) this.spawnCoinArc(false);
    this.assertTelegraph();
  }

  /**
   * Every required movement gets at least 1.1s of visible warning. This is a
   * hard floor from the latency budget, so it is asserted rather than trusted:
   * a config edit that violates it should be loud, not subtly unfair.
   */
  private assertTelegraph(): void {
    const telegraph = TRACK_DEPTH / this.scrollSpeed;
    if (telegraph < MIN_TELEGRAPH_S) {
      console.error(
        `[dodge-collect] telegraph ${telegraph.toFixed(2)}s < ${MIN_TELEGRAPH_S}s floor ` +
          `at ${this.scrollSpeed} u/s. Obstacles are now unreadable before they are undodgeable.`,
      );
    }
  }

  private moveObstacles(dt: number): void {
    const speed = this.scrollSpeed;
    for (const o of this.obstacles) {
      const wasAhead = o.z > 0;
      o.z -= speed * dt;
      if (wasAhead && o.z <= 0 && !o.resolved) this.resolve(o);
    }
    this.obstacles = this.obstacles.filter((o) => o.z > -12);
  }

  private resolve(o: Obstacle): void {
    o.resolved = true;
    if (this.surge > 0) return; // Flying over it.

    let cleared = false;
    if (o.type === 'hurdle') cleared = this.airborne > 0;
    else if (o.type === 'beam') cleared = this.ducking > 0;
    else if (o.type === 'wall') cleared = this.lanes.lane !== o.lane;

    if (cleared) {
      this.onCleared(o);
    } else if (this.invuln > 0) {
      o.grazed = true;
    } else {
      this.onHit(o);
    }
  }

  private onCleared(o: Obstacle): void {
    this.combo += 1;
    this.bestCombo = Math.max(this.bestCombo, this.combo);
    this.score += SCORE.COMBO_STEP * Math.min(this.combo, SCORE.COMBO_CAP) * this.scoreMultiplier;
    this.gap = Math.min(PACK.MAX_GAP, this.gap + PACK.CLEAR_BONUS);

    // Near-miss: reward precision, not caution. Nearly free to compute and a
    // disproportionate share of why a runner feels good to play.
    const near =
      (o.type === 'hurdle' && this.airborne < 0.22) ||
      (o.type === 'beam' && this.ducking < 0.18);
    if (near) {
      this.nearMisses += 1;
      this.score += SCORE.NEAR_MISS * this.scoreMultiplier;
      this.pushFlash('CLOSE!', '#ffd60a');
    }
  }

  private onHit(o: Obstacle): void {
    o.hit = true;
    this.hits += 1;
    this.combo = 0;
    this.invuln = 1.2;
    this.gap -= PACK.HIT_COST;
    this.pushFlash('HIT', '#e63946');
    if (this.gap <= 0) this.caught();
  }

  /* ---------------------------------------------------------------------- */
  /* Coins                                                                   */
  /* ---------------------------------------------------------------------- */

  private spawnCoinArc(dense: boolean): void {
    if (this.coins.length > 60) return;
    const group = nextId++;
    const count = dense ? 6 : 5;
    // Coins are never on the lane path and never inside the resting silhouette:
    // if you can get it without moving, it isn't a coin, it's decoration.
    const side = Math.random() < 0.5 ? -1 : 1;
    const style = Math.random();
    for (let i = 0; i < count; i++) {
      const t = i / (count - 1);
      let x: number;
      let y: number;
      if (style < 0.4) {
        x = side * (0.55 + t * 0.35); // lateral spur — reach sideways
        y = 0.42;
      } else if (style < 0.75) {
        x = (t - 0.5) * 1.2; // high arc — reach up
        y = 0.16 + Math.sin(t * Math.PI) * -0.12;
      } else {
        x = (t - 0.5) * 1.1; // low sweep — caught mid-squat
        y = 0.72;
      }
      this.coins.push({ group, x, y, z: TRACK_DEPTH, taken: false });
    }
  }

  private moveCoins(dt: number): void {
    const speed = this.scrollSpeed;
    for (const c of this.coins) {
      c.z -= speed * dt;
      if (c.taken || c.z > 14 || c.z < -4) continue;
      if (this.tryCollect(c)) {
        c.taken = true;
        this.coinsCollected += 1;
        this.movements.reaches += 1;
        this.score += SCORE.COIN * this.scoreMultiplier;
        if (this.surge > 0) this.gap = Math.min(PACK.MAX_GAP, this.gap + 0.15);
        this.checkSweep(c.group);
      }
    }
    this.coins = this.coins.filter((c) => c.z > -6);
  }

  private tryCollect(coin: Coin): boolean {
    if (!this.projector) return false;
    const p = this.projector(coin);
    if (!p) return false;
    // Circle test against either hand, in the same normalised space the cursor
    // lives in. Generous on purpose: reaching is the exercise, pixel precision
    // is not.
    const reach = (HAND.RADIUS + HAND.COIN_RADIUS) / 1000;
    for (const hand of [this.hands.left, this.hands.right]) {
      const dx = hand.x - p.x;
      const dy = hand.y - p.y;
      if (dx * dx + dy * dy < reach * reach) return true;
    }
    return false;
  }

  /** A full arc collected is worth a flourish — it takes a real extension. */
  private checkSweep(group: number): void {
    const members = this.coins.filter((c) => c.group === group);
    if (members.length && members.every((c) => c.taken)) {
      this.score += SCORE.SWEEP_FLOURISH * this.scoreMultiplier;
      this.gap = Math.min(PACK.MAX_GAP, this.gap + PACK.COIN_SWEEP_BONUS);
      this.pushFlash('SWEEP +50', '#ffd60a');
    }
  }

  /* ---------------------------------------------------------------------- */
  /* The pack                                                                */
  /* ---------------------------------------------------------------------- */

  private tickPack(dt: number): void {
    let drain = this.phase.drain;

    // The Commit: they stop pacing. Out-runnable, so it is tension rather than
    // a punishment — the player can still push them back by clearing.
    const commitEnd = PACK.COMMIT_AT + PACK.COMMIT_SECONDS;
    if (this.elapsed >= PACK.COMMIT_AT && this.elapsed < commitEnd) drain *= 2;

    // The effort term: this is what makes coasting expensive. Off during
    // Onboard — the first twenty seconds teach the controls, and a player
    // still working out which way to lean must not be losing ground for it.
    const effort =
      this.phase.drain === 0 ? 0 : (this.burn - PACK.EFFORT_PIVOT) * PACK.EFFORT_GAIN;
    // SURGE.GAP_GAIN, not PACK's — there is no PACK.GAP_GAIN, and reading one
    // made this whole expression NaN for the rest of the run the first time
    // Surge fired, silently switching the pack off. Caught by the TS port.
    const surgeGain = this.surge > 0 ? SURGE.GAP_GAIN : 0;

    this.gap += (effort + surgeGain - drain) * dt;
    this.gap = Math.max(0, Math.min(PACK.MAX_GAP, this.gap));

    if (this.gap <= 0) this.caught();
  }

  private caught(): void {
    // Earned by working hard, spent automatically: a player at 170bpm mid-jump
    // cannot make a good spending decision, so don't ask them to.
    if (this.secondWindHeld > 0) {
      this.secondWindHeld -= 1;
      this.gap = SECOND_WIND.RESTORE_GAP;
      this.invuln = SECOND_WIND.INVULN_SECONDS;
      this.pushFlash('SECOND WIND!', '#1de9b6');
      return;
    }
    this.finish('caught');
  }

  finish(outcome: 'finished' | 'caught'): void {
    if (this.over) return;
    this.over = true;
    this.outcome = outcome;
    if (outcome === 'finished') {
      this.score += SCORE.FINISH_BONUS;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Feedback                                                                */
  /* ---------------------------------------------------------------------- */

  private pushFlash(text: string, color: string): void {
    this.flash = { text, color, life: 0.9 };
  }

  private tickEffects(dt: number): void {
    if (this.flash) {
      this.flash.life -= dt;
      if (this.flash.life <= 0) this.flash = null;
    }
  }

  /* ---------------------------------------------------------------------- */
  /* Reporting                                                               */
  /* ---------------------------------------------------------------------- */

  get avgIntensity(): number {
    return this.intensitySamples === 0 ? 0 : this.intensitySum / this.intensitySamples;
  }

  get totalMovements(): number {
    const m = this.movements;
    return m.jumps + m.crouches + m.laneChanges + m.reaches;
  }

  /**
   * What the run is worth as exercise, as distinct from the on-screen score.
   *
   * Dominated by physical work done, never by coins. The on-screen number can
   * be as flashy as it likes; this one has to stay honest, because it is the
   * only feedback that tells the player whether they actually trained.
   */
  get effortScore(): number {
    const m = this.movements;
    return Math.round(
      (m.jumps * 3 + m.crouches * 3 + m.laneChanges * 1 + m.reaches * 0.5) *
        (0.6 + 0.8 * this.avgIntensity),
    );
  }

  get summary(): RunSummary {
    return {
      score: Math.floor(this.score),
      bestCombo: this.bestCombo,
      movements: {
        jumps: this.movements.jumps,
        ducks: this.movements.crouches,
        laneChanges: this.movements.laneChanges,
        reaches: this.movements.reaches,
      },
      totalMovements: this.totalMovements,
      activeSeconds: this.activeMs / 1000,
      avgIntensity: this.avgIntensity,
      outcome: this.outcome ?? 'finished',
    };
  }
}

function makeObstacle(type: string, lane: number, z: number): Obstacle {
  return { id: nextId++, type, lane, z, resolved: false, hit: false, grazed: false };
}
