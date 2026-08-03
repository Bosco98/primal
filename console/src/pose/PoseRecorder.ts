import type { ExerciseId } from '@bosco98/primal-sdk';
import type { Baseline } from '../recognition/calibration.js';
import type { PoseFrame } from './types.js';

export interface PoseRecording {
  schemaVersion: 1;
  exercise: ExerciseId;
  expectedReps: number;
  detectedReps: number;
  recordedAt: string;
  baseline: Baseline;
  frames: PoseFrame[];
}

/** Records landmarks only. Camera pixels and video never enter this object. */
export class PoseRecorder {
  private exercise: ExerciseId | null = null;
  private baseline: Baseline | null = null;
  private startedAt = 0;
  private frames: PoseFrame[] = [];

  get active(): boolean {
    return this.exercise !== null;
  }

  start(exercise: ExerciseId, baseline: Baseline): void {
    this.exercise = exercise;
    this.baseline = structuredClone(baseline);
    this.startedAt = 0;
    this.frames = [];
  }

  capture(frame: PoseFrame): void {
    if (!this.active) return;
    if (this.frames.length === 0) this.startedAt = frame.t;
    this.frames.push({
      t: frame.t - this.startedAt,
      present: frame.present,
      landmarks: frame.landmarks.map((point) => ({ ...point })),
      world: frame.world.map((point) => ({ ...point })),
    });
  }

  stop(detectedReps: number, expectedReps = 5): PoseRecording | null {
    if (!this.exercise || !this.baseline || this.frames.length === 0) {
      this.cancel();
      return null;
    }

    const recording: PoseRecording = {
      schemaVersion: 1,
      exercise: this.exercise,
      expectedReps,
      detectedReps,
      recordedAt: new Date().toISOString(),
      baseline: this.baseline,
      frames: this.frames,
    };
    this.cancel();
    return recording;
  }

  cancel(): void {
    this.exercise = null;
    this.baseline = null;
    this.startedAt = 0;
    this.frames = [];
  }
}
