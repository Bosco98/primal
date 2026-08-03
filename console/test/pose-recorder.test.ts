import { describe, expect, it } from 'vitest';
import { Calibrator } from '../src/recognition/calibration.js';
import { FeatureExtractor } from '../src/recognition/features.js';
import { PoseRecorder } from '../src/pose/PoseRecorder.js';
import { makeFrame } from './synthetic.js';

function baseline() {
  const calibrator = new Calibrator();
  const extractor = new FeatureExtractor();
  calibrator.start();
  for (let i = 0; i < 90; i++) calibrator.update(extractor.extract(makeFrame(i * 33.3)));
  if (!calibrator.current) throw new Error('Fixture did not calibrate');
  return calibrator.current;
}

describe('pose recorder', () => {
  it('records replayable landmarks without camera pixels', () => {
    const recorder = new PoseRecorder();
    recorder.start('jumping_jack', baseline());
    const first = makeFrame(10_000);
    const second = makeFrame(10_033.3, { armsOverhead: 1, ankleSpread: 0.65 });
    recorder.capture(first);
    recorder.capture(second);

    const result = recorder.stop(0);
    expect(result?.exercise).toBe('jumping_jack');
    expect(result?.expectedReps).toBe(5);
    expect(result?.detectedReps).toBe(0);
    expect(result?.frames.map((frame) => frame.t)).toEqual([0, 33.29999999999927]);
    expect(result?.frames[0]?.landmarks).not.toBe(first.landmarks);
    expect(result).not.toHaveProperty('video');
  });

  it('returns nothing for an empty recording', () => {
    const recorder = new PoseRecorder();
    recorder.start('lunge', baseline());
    expect(recorder.stop(0)).toBeNull();
    expect(recorder.active).toBe(false);
  });
});
