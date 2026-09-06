import * as THREE from 'three';
import { pickLight } from './math';

/**
 * Pool of short-lived PointLights (muzzle flashes, metal sparks, explosions). All lights are
 * created up-front and stay in the scene at intensity 0 so materials never recompile when one
 * fires. Count comes from quality.dynamicLights.
 *
 * Envelope: intensity holds at full for the first `hold` fraction of the life, then falls off as
 * (1-t')^2 over the remainder, with an optional flicker. A muzzle flash uses hold~0.35 so it is
 * still at full brightness on the frame after the shot (a 1-frame pop that a still can miss is
 * the same as no light at all); an explosion uses a long hold so the blast is unmistakably
 * lighting its surroundings for the ~0.2 s a screenshot is likely to land on.
 */
export class LightPool {
  readonly lights: THREE.PointLight[] = [];
  private remaining: Float32Array;
  private life: Float32Array;
  private base: Float32Array;
  private flicker: Float32Array;
  private hold: Float32Array;
  constructor(parent: THREE.Object3D, count: number) {
    const n = Math.max(1, count | 0);
    this.remaining = new Float32Array(n); this.life = new Float32Array(n); this.base = new Float32Array(n); this.flicker = new Float32Array(n); this.hold = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 10, 2);
      l.castShadow = false;
      l.name = 'fx-light';
      parent.add(l);
      this.lights.push(l);
    }
  }

  flash(pos: THREE.Vector3, color: THREE.Color, intensity: number, life: number, distance = 10, flicker = 0, hold = 0): THREE.PointLight {
    const i = pickLight(this.remaining);
    const l = this.lights[i];
    l.position.copy(pos); l.color.copy(color); l.intensity = intensity; l.distance = distance;
    this.remaining[i] = life; this.life[i] = life; this.base[i] = intensity; this.flicker[i] = flicker;
    this.hold[i] = THREE.MathUtils.clamp(hold, 0, 0.95);
    return l;
  }

  /** Envelope value at normalised age `t` with the given hold plateau. Exported shape: 1 until hold, then quadratic to 0. */
  static envelope(t: number, hold: number): number {
    if (t <= hold) return 1;
    const u = (t - hold) / Math.max(1e-3, 1 - hold);
    return (1 - u) * (1 - u);
  }

  update(dt: number, time: number): void {
    for (let i = 0; i < this.lights.length; i++) {
      if (this.remaining[i] <= 0) continue;
      this.remaining[i] -= dt;
      const l = this.lights[i];
      if (this.remaining[i] <= 0) { l.intensity = 0; continue; }
      const t = 1 - this.remaining[i] / this.life[i];
      let k = LightPool.envelope(t, this.hold[i]);
      if (this.flicker[i] > 0) k *= 1 - this.flicker[i] * (0.5 + 0.5 * Math.sin(time * 97 + i * 3.1));
      l.intensity = this.base[i] * k;
    }
  }

  clear(): void { for (let i = 0; i < this.lights.length; i++) { this.remaining[i] = 0; this.lights[i].intensity = 0; } }
}
