import { describe, expect, it } from 'vitest';
import { Calibrator, type Baseline } from '../src/recognition/calibration.js';
import { FeatureExtractor } from '../src/recognition/features.js';
import { RecognitionEngine } from '../src/recognition/engine.js';
import { createRecognizer } from '../src/recognition/exercises.js';
import type { DetectedRep } from '../src/recognition/recognizer.js';
import type { PoseFixture, PoseFrame } from '../src/pose/types.js';
import type { ExerciseId } from '@bosco98/primal-sdk';
import {
  makeAbsentFrame,
  makeFrame,
  makeJumpingJackSet,
  makeLungeSet,
  makePushupSet,
  makeSquatSet,
} from './synthetic.js';

/**
 * The full Phase 1 chain: frames -> features -> calibration -> rep events.
 * If a threshold change breaks counting, it breaks here rather than in front of
 * a sweating user.
 */
interface RunResult {
  reps: DetectedRep[];
  baseline: Baseline | null;
  phases: string[];
}

function run(frames: PoseFrame[], exercise: ExerciseId = 'squat'): RunResult {
  const extractor = new FeatureExtractor();
  const calibrator = new Calibrator();
  const recognizer = createRecognizer(exercise);
  if (!recognizer) throw new Error(`No recogniser for ${exercise}`);
  calibrator.start();

  const reps: DetectedRep[] = [];
  const phases: string[] = [];

  for (const frame of frames) {
    const features = extractor.extract(frame);

    if (!calibrator.current) {
      calibrator.update(features);
      continue;
    }

    const output = recognizer.update(features, calibrator.current);
    if (output.progress) {
      const last = phases[phases.length - 1];
      if (last !== output.progress.phase) phases.push(output.progress.phase);
    }
    if (output.rep) reps.push(output.rep);
  }

  return { reps, baseline: calibrator.current, phases };
}

function runFixture(fixture: PoseFixture, exercise: ExerciseId = 'squat'): RunResult {
  return run(fixture.frames, exercise);
}

describe('calibration', () => {
  it('captures a baseline from a standing lead-in', () => {
    const { baseline } = runFixture(makeSquatSet({ reps: 1 }));
    expect(baseline).not.toBeNull();
    expect(baseline!.torsoLength).toBeGreaterThan(0.15);
    expect(baseline!.standingKneeAngle).toBeGreaterThan(165);
  });

  it('does not calibrate when the person is out of frame', () => {
    const frames = Array.from({ length: 120 }, (_, i) => makeAbsentFrame(i * 33.3));
    expect(run(frames).baseline).toBeNull();
  });

  it('does not calibrate when the player is too close to the camera', () => {
    // A torso far larger than the framing band means they are on top of the lens.
    const extractor = new FeatureExtractor();
    const calibrator = new Calibrator();
    calibrator.start();
    let last = calibrator.update(extractor.extract(makeFrame(0)));

    for (let i = 0; i < 150; i++) {
      const frame = makeFrame(i * 33.3);
      // Scale the body up about its centre to simulate stepping in close.
      for (const point of frame.landmarks) {
        point.y = 0.5 + (point.y - 0.5) * 2.2;
      }
      last = calibrator.update(extractor.extract(frame));
    }

    expect(calibrator.current).toBeNull();
    expect(last.issues).toContain('too_close');
  });
});

describe('squat counting', () => {
  it('counts a clean set exactly', () => {
    const { reps } = runFixture(makeSquatSet({ reps: 10, minKneeAngle: 92 }));
    expect(reps).toHaveLength(10);
  });

  it('scores clean reps highly and flags nothing', () => {
    const { reps } = runFixture(makeSquatSet({ reps: 5, minKneeAngle: 90 }));
    expect(reps).toHaveLength(5);
    for (const rep of reps) {
      expect(rep.flags).toEqual([]);
      expect(rep.formScore).toBeGreaterThan(0.7);
      expect(rep.exercise).toBe('squat');
    }
  });

  it('emits a full down / bottom / up / rest cycle', () => {
    const { phases } = runFixture(makeSquatSet({ reps: 1, minKneeAngle: 92 }));
    expect(phases.slice(0, 4)).toEqual(['down', 'bottom', 'up', 'rest']);
  });

  it('reports rep duration in a plausible range', () => {
    const { reps } = runFixture(makeSquatSet({ reps: 3, repDurationMs: 2000 }));
    for (const rep of reps) {
      expect(rep.durationMs).toBeGreaterThan(800);
      expect(rep.durationMs).toBeLessThan(2000);
    }
  });
});

describe('form judgement', () => {
  it('counts shallow reps but flags and penalises them', () => {
    const { reps } = runFixture(makeSquatSet({ reps: 6, minKneeAngle: 122 }));
    expect(reps).toHaveLength(6);
    for (const rep of reps) {
      expect(rep.flags).toContain('shallow');
      expect(rep.formScore).toBeLessThan(0.65);
    }
  });

  it('refuses to count a dip that never reaches useful depth', () => {
    // 145 degrees is a bob, not a squat. Counting it would let a player farm
    // reps by bouncing, which is the failure mode that destroys trust.
    const { reps } = runFixture(makeSquatSet({ reps: 8, minKneeAngle: 145 }));
    expect(reps).toHaveLength(0);
  });

  it('flags reps done too fast to be controlled', () => {
    const { reps } = runFixture(
      makeSquatSet({ reps: 5, minKneeAngle: 95, repDurationMs: 520, restMs: 200, fps: 60 }),
    );
    expect(reps.length).toBeGreaterThan(0);
    for (const rep of reps) {
      expect(rep.flags).toContain('fast');
    }
  });

  it('flags a lopsided squat', () => {
    const { reps } = runFixture(
      makeSquatSet({ reps: 4, minKneeAngle: 95, kneeAsymmetry: 34 }),
    );
    expect(reps.length).toBeGreaterThan(0);
    for (const rep of reps) {
      expect(rep.flags).toContain('asymmetric');
    }
  });

  it('rewards depth: deeper reps score higher than shallower ones', () => {
    const deep = runFixture(makeSquatSet({ reps: 3, minKneeAngle: 85 })).reps;
    const shallow = runFixture(makeSquatSet({ reps: 3, minKneeAngle: 125 })).reps;
    expect(deep[0]!.formScore).toBeGreaterThan(shallow[0]!.formScore + 0.2);
  });
});

describe('players whose standing pose does not read as straight-legged', () => {
  // The bug this guards: thresholds were once absolute, so lockout was declared
  // at a fixed 158 degrees. A player whose standing legs measured below that
  // could never satisfy it — the machine counted the first rep, parked in
  // "ascending", and silently ignored every rep afterwards. Thresholds are now
  // relative to each player's own calibrated standing angle.
  it('keeps counting for a player who reads as 150 degrees standing', () => {
    const { reps } = runFixture(
      makeSquatSet({ reps: 6, standingKneeAngle: 150, minKneeAngle: 95 }),
    );
    expect(reps).toHaveLength(6);
  });

  it('keeps counting for a player who reads as 145 degrees standing', () => {
    const { reps } = runFixture(
      makeSquatSet({ reps: 5, standingKneeAngle: 145, minKneeAngle: 92 }),
    );
    expect(reps).toHaveLength(5);
  });

  it('never gets stuck: a rep that never completes is abandoned, not held', () => {
    // Descend and simply stay down. The next real rep must still be counted.
    const frames: PoseFrame[] = [];
    let t = 0;
    const push = (ms: number, knee: number) => {
      for (let i = 0; i < ms / 33.3; i++) frames.push(makeFrame((t += 33.3), { kneeAngle: knee }));
    };
    push(2600, 175); // calibrate
    push(12_000, 100); // squat and hold far past the abandon timeout
    push(1500, 175); // stand back up
    frames.push(...makeSquatSet({ reps: 2, leadInMs: 0 }).frames.map((f) => ({ ...f, t: (t += 33.3) })));

    const { reps } = run(frames);
    expect(reps.length).toBeGreaterThanOrEqual(2);
  });
});

describe('robustness', () => {
  it('counts nothing while standing still', () => {
    const frames = Array.from({ length: 300 }, (_, i) => makeFrame(i * 33.3, { kneeAngle: 175 }));
    expect(run(frames).reps).toHaveLength(0);
  });

  it('does not manufacture reps from jitter around the entry threshold', () => {
    // Landmark noise parked right at the descent threshold is the classic
    // phantom-rep generator. Hysteresis plus depth gating must swallow it.
    const frames: PoseFrame[] = [];
    for (let i = 0; i < 90; i++) frames.push(makeFrame(i * 33.3, { kneeAngle: 175 }));
    for (let i = 0; i < 300; i++) {
      const t = 3000 + i * 33.3;
      frames.push(makeFrame(t, { kneeAngle: 150 + Math.sin(i * 1.7) * 6 }));
    }
    expect(run(frames).reps).toHaveLength(0);
  });

  it('drops the in-flight rep when the player leaves the frame', () => {
    const set = makeSquatSet({ reps: 2, minKneeAngle: 92 });
    const frames = set.frames.slice();
    // Cut out midway through what would be the second rep.
    const cut = Math.floor(frames.length * 0.72);
    for (let i = cut; i < frames.length; i++) {
      frames[i] = makeAbsentFrame(frames[i]!.t);
    }
    const { reps } = run(frames);
    expect(reps).toHaveLength(1);
  });

  it('keeps an in-flight rep through a sub-250ms landmark occlusion', () => {
    const set = makeSquatSet({ reps: 1, minKneeAngle: 92 });
    const frames = set.frames.map((frame) => ({
      ...frame,
      landmarks: frame.landmarks.map((point) => ({ ...point })),
      world: frame.world.map((point) => ({ ...point })),
    }));
    const occlusionStart = frames.findIndex((frame) => frame.t >= 3200);
    for (let offset = 0; offset < 6; offset++) {
      const frame = frames[occlusionStart + offset]!;
      for (const index of [25, 26, 27, 28]) frame.landmarks[index]!.visibility = 0.1;
    }
    expect(run(frames).reps).toHaveLength(1);
  });

  it('ignores frames where the legs are not visible', () => {
    const set = makeSquatSet({ reps: 5, minKneeAngle: 92, leadInMs: 2500 });
    const frames = set.frames.map((frame, i) => {
      if (i < 90 || frame.landmarks.length === 0) return frame;
      // Occlude both knees and ankles: a desk in the way.
      const copy: PoseFrame = {
        ...frame,
        landmarks: frame.landmarks.map((p) => ({ ...p })),
      };
      for (const index of [25, 26, 27, 28]) {
        copy.landmarks[index]!.visibility = 0.1;
      }
      return copy;
    });
    expect(run(frames).reps).toHaveLength(0);
  });
});

describe('jumping jacks', () => {
  it('counts a clean set exactly', () => {
    const { reps } = runFixture(makeJumpingJackSet({ reps: 12 }), 'jumping_jack');
    expect(reps).toHaveLength(12);
  });

  it('scores clean jacks well', () => {
    const { reps } = runFixture(makeJumpingJackSet({ reps: 4 }), 'jumping_jack');
    for (const rep of reps) {
      expect(rep.exercise).toBe('jumping_jack');
      expect(rep.formScore).toBeGreaterThan(0.6);
    }
  });

  // A jack is arms *and* legs. Letting arms alone count would quietly turn the
  // exercise into something far easier than the one the player was asked for.
  it('refuses to count arms without the feet', () => {
    const armsOnly = makeJumpingJackSet({ reps: 8, peakSpread: 0.2 });
    expect(runFixture(armsOnly, 'jumping_jack').reps).toHaveLength(0);
  });

  it('refuses to count feet without the arms', () => {
    const feetOnly = makeJumpingJackSet({ reps: 8, peakArms: 0 });
    expect(runFixture(feetOnly, 'jumping_jack').reps).toHaveLength(0);
  });

  it('flags a half-hearted jack as shallow', () => {
    const half = makeJumpingJackSet({ reps: 5, peakSpread: 0.5, peakArms: 0.8 });
    const { reps } = runFixture(half, 'jumping_jack');
    expect(reps.length).toBeGreaterThan(0);
    for (const rep of reps) expect(rep.flags).toContain('shallow');
  });
});

describe('lunges', () => {
  it('counts a clean set exactly', () => {
    const { reps } = runFixture(makeLungeSet({ reps: 8 }), 'lunge');
    expect(reps).toHaveLength(8);
  });

  it('does not flag a lunge as uneven, since it is asymmetric by design', () => {
    const { reps } = runFixture(makeLungeSet({ reps: 4 }), 'lunge');
    for (const rep of reps) expect(rep.flags).not.toContain('asymmetric');
  });

  it('refuses to count a squat as a lunge', () => {
    // Knees bend and hips drop, but the feet stay level.
    const { reps } = runFixture(makeSquatSet({ reps: 8, minKneeAngle: 90 }), 'lunge');
    expect(reps).toHaveLength(0);
  });
});

describe('push-ups', () => {
  it('counts a clean side-on set exactly', () => {
    const { reps } = runFixture(makePushupSet({ reps: 6 }), 'pushup');
    expect(reps).toHaveLength(6);
  });

  it('does not count upright arm bends as push-ups', () => {
    const frames = makePushupSet({ reps: 4 }).frames.map((frame) => {
      const copy: PoseFrame = {
        ...frame,
        landmarks: frame.landmarks.map((point) => ({ ...point })),
        world: frame.world.map((point) => ({ ...point })),
      };
      // Align the shoulders over the hips so the torso gate stays upright.
      const hipX = (copy.landmarks[23]!.x + copy.landmarks[24]!.x) / 2;
      const shoulderX = (copy.landmarks[11]!.x + copy.landmarks[12]!.x) / 2;
      for (const index of [11, 12]) copy.landmarks[index]!.x += hipX - shoulderX;
      return copy;
    });
    expect(run(frames, 'pushup').reps).toHaveLength(0);
  });
});

describe('exercises do not contaminate each other', () => {
  it('does not count a lunge as a squat', () => {
    // Both drop the hips and bend the knees, so without the split-stance check
    // one movement would be counted twice by two subscribed recognisers.
    const { reps } = runFixture(makeLungeSet({ reps: 8 }), 'squat');
    expect(reps).toHaveLength(0);
  });

  it('does not count a jumping jack as a squat', () => {
    const { reps } = runFixture(makeJumpingJackSet({ reps: 10 }), 'squat');
    expect(reps).toHaveLength(0);
  });

  it('does not count a squat as a jumping jack', () => {
    const { reps } = runFixture(makeSquatSet({ reps: 8, minKneeAngle: 90 }), 'jumping_jack');
    expect(reps).toHaveLength(0);
  });
});

describe('the shared skeleton applies to every exercise', () => {
  const CASES: Array<{ id: ExerciseId; fixture: () => PoseFixture }> = [
    { id: 'squat', fixture: () => makeSquatSet({ reps: 4, minKneeAngle: 92 }) },
    { id: 'jumping_jack', fixture: () => makeJumpingJackSet({ reps: 4 }) },
    { id: 'lunge', fixture: () => makeLungeSet({ reps: 4 }) },
    { id: 'pushup', fixture: () => makePushupSet({ reps: 4 }) },
  ];

  for (const { id, fixture } of CASES) {
    it(`${id}: counts nothing while the player stands still`, () => {
      const frames = Array.from({ length: 300 }, (_, i) => makeFrame(i * 33.3));
      expect(run(frames, id).reps).toHaveLength(0);
    });

    it(`${id}: abandons the in-flight rep when the player leaves frame`, () => {
      const frames = fixture().frames.slice();
      const cut = Math.floor(frames.length * 0.55);
      for (let i = cut; i < frames.length; i++) frames[i] = makeAbsentFrame(frames[i]!.t);
      expect(run(frames, id).reps.length).toBeLessThan(4);
    });

    it(`${id}: reports the exercise on every rep it emits`, () => {
      for (const rep of runFixture(fixture(), id).reps) expect(rep.exercise).toBe(id);
    });
  }
});

describe('full engine exercise switching', () => {
  const CASES: Array<{ id: ExerciseId; fixture: () => PoseFixture }> = [
    { id: 'squat', fixture: () => makeSquatSet({ reps: 3 }) },
    { id: 'jumping_jack', fixture: () => makeJumpingJackSet({ reps: 3 }) },
    { id: 'lunge', fixture: () => makeLungeSet({ reps: 3 }) },
    { id: 'pushup', fixture: () => makePushupSet({ reps: 3 }) },
  ];

  for (const { id, fixture } of CASES) {
    it(`routes ${id} frames through the selected subscription`, () => {
      const engine = new RecognitionEngine();
      engine.setSubscription({
        channels: ['rep', 'gesture', 'body', 'intensity'],
        exercises: [id],
      });
      engine.startCalibration();
      const reps = fixture().frames.flatMap((frame) => engine.process(frame).reps);
      expect(reps).toHaveLength(3);
      expect(reps.every((rep) => rep.exercise === id)).toBe(true);
    });
  }
});
