import type * as THREE from 'three';
import type { RenderApi } from '../game/Contracts';
import type { Look } from './TimeOfDay';

/**
 * What the render system offers beyond the RenderApi contract. Other modules only need RenderApi;
 * these are for streaming code (`prepare`), poses and debugging.
 */
export interface RenderSystem extends RenderApi {
  /**
   * Patch the lit materials under `root` now (shadow cascades, `userData.wet`), instead of waiting
   * for the 30-frame scan. Call it on a freshly built tile before adding it to the scene.
   */
  prepare(root: THREE.Object3D): void;
  /** Jump every lagging quantity (exposure, wetness, sky LUT, environment map) to its target. */
  settle(): void;
  /** Everything the current time and weather resolve to (read-only use). */
  readonly look: Look;
  /** Exposure in use this frame (smoothed towards look.exposure). */
  readonly exposure: number;
  /** The clock time the game booted with (17.0 or ?tod); poses restore it. */
  readonly defaultTime: number;
  /** True draws without the post chain (debug A/B). */
  bypass: boolean;
}
