import type { Engine } from '../core/Engine';

/**
 * Named camera/game states for the screenshot harness (scripts/shot.mjs).
 * Each subsystem registers the poses that show off its work; the critic loop renders them all.
 * A pose puts the player somewhere, points the camera, and may set weapon/enemy state.
 * `settleFrames` lets temporal effects converge before the capture.
 */
export interface Pose {
  name: string;
  description: string;
  apply(engine: Engine): void | Promise<void>;
  settleFrames?: number;
  /** Frames advanced with real dt after apply (for animations mid-motion). */
  animateFrames?: number;
}

const registry = new Map<string, Pose>();
export function registerPose(pose: Pose): void { registry.set(pose.name, pose); }
export function getPose(name: string): Pose | undefined { return registry.get(name); }
export function listPoses(): string[] { return [...registry.keys()]; }
