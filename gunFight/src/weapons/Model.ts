import * as THREE from 'three';
import type { WeaponMaterials } from './Materials';
import type { BuiltGroups, V3 } from './Build';
import type { HandPoseName } from './Hands';
import type { GripSolid } from './Grip';

/**
 * Shared shape of every viewmodel plus the tiny keyframe system the models describe their
 * reload / cycle / inspect / melee clips with. Everything is in gun-root space.
 */

export type Key<T> = [number, T];

export interface HandPlacement {
  pos: V3; fingers: V3; back: V3; elbow?: V3; pose: HandPoseName;
  /** forearm length multiplier (1 = full). Aimed pistol grips cut it so the arms clear the sight picture. */
  sleeve?: number;
  /**
   * Name of the entry in `WeaponModel.grips` this hand is holding, or 'none' when the hand is off the
   * weapon (reaching for a magazine, slapping a bolt). The grip solver moves the wrist and closes the
   * fingers until they rest on that solid, so `pos` only has to be approximately right - it decides
   * *where along* the handguard the hand sits, not how far off it floats. See Grip.ts.
   */
  contact?: string;
}

export interface HandTrack { pos?: Key<V3>[]; fingers?: Key<V3>[]; back?: Key<V3>[]; elbow?: Key<V3>[]; pose?: Key<HandPoseName>[]; contact?: Key<string>[] }

export interface ClipEvent { t: number; sound?: string; action?: 'magOut' | 'magIn' | 'chamber' | 'shell' | 'hit' }

export interface Clip {
  duration: number;
  /** additive gun offset (meters / radians) */
  gunPos?: Key<V3>[];
  gunRot?: Key<V3>[];
  left?: HandTrack;
  right?: HandTrack;
  /** named part parameters 0..1 (mag, charge, bolt, slide, pump, boltHandle, ...) */
  parts?: Record<string, Key<number>[]>;
  magVisible?: Key<number>[];
  events?: ClipEvent[];
  /** parts that keep their final value when the clip ends (e.g. slide lock) */
  hold?: string[];
}

export interface PartMotion {
  obj: THREE.Object3D;
  /** translation at param=1 */
  pos?: V3;
  /** rotation (euler) at param=1 */
  rot?: V3;
  /** pivot for the rotation, in gun space (defaults to the object's own origin) */
  pivot?: V3;
}

export interface WeaponModel {
  root: THREE.Group;
  groups: BuiltGroups;
  sockets: { muzzle: THREE.Object3D; eject: THREE.Object3D; aim: THREE.Object3D };
  ejectDir: V3;
  parts: Record<string, PartMotion>;
  hands: { right: HandPlacement; left: HandPlacement };
  /**
   * Optional grip while fully aimed, blended in by the aim blend. Iron-sighted weapons need it: the hip
   * grip puts the forearms straight up the middle of the frame, where they occlude the sight picture.
   * Aimed, the hands drop below the sight axis and the forearms leave through the lower corners.
   */
  handsAds?: { right: HandPlacement; left: HandPlacement };
  clips: { reload: Clip; reloadEmpty: Clip; cycle?: Clip; inspect: Clip; melee: Clip; draw?: Clip };
  /** automatic action after each shot: part parameter goes 0->1 in `back` s, back to 0 in `fwd` s */
  fireCycle?: { part: string; back: number; fwd: number; lockOpenOnEmpty?: boolean };
  /** trigger part name, if any */
  trigger?: string;
  /** hand pose while firing */
  firePose?: HandPoseName;
  /** point-light offset (gun space) for the muzzle flash light */
  muzzleLightPos: V3;
  /** scope: the lens mesh gets the render-target texture; `ocular` (rear glass) is hidden while aiming */
  scope?: { lens: THREE.Mesh; reticleMask: THREE.Mesh; radius: number; ocular?: THREE.Mesh };
  /** collimated red dot: the reticle quad is re-projected every frame so it is parallax-free and fades off-axis */
  redDot?: { reticle: THREE.Mesh; center: V3; radius: number };
  /**
   * The solids the hands hold, by name. Every weapon must declare at least the one its support hand
   * and its firing hand use; `WeaponSystem` asserts in dev that the gloves are actually touching them.
   */
  grips: Record<string, GripSolid>;
  /** how many rounds a "reload" clip loads (shotgun loads one shell per clip) */
  roundsPerReload?: number;
  /** total triangles (for the report) */
  triangles: number;
}

export interface ModelCtx { mats: WeaponMaterials }

// ---------- keyframe sampling ----------
const _v = new THREE.Vector3();
function smooth(t: number): number { return t * t * (3 - 2 * t); }

export function sampleN(keys: Key<number>[] | undefined, t: number, fallback = 0): number {
  if (!keys || keys.length === 0) return fallback;
  if (t <= keys[0][0]) return keys[0][1];
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a] = keys[i - 1], [t1, b] = keys[i];
      const u = t1 > t0 ? smooth((t - t0) / (t1 - t0)) : 1;
      return a + (b - a) * u;
    }
  }
  return keys[keys.length - 1][1];
}

export function sampleV(keys: Key<V3>[] | undefined, t: number, out: THREE.Vector3, fallback: V3 = [0, 0, 0]): THREE.Vector3 {
  if (!keys || keys.length === 0) return out.set(fallback[0], fallback[1], fallback[2]);
  if (t <= keys[0][0]) { const k = keys[0][1]; return out.set(k[0], k[1], k[2]); }
  for (let i = 1; i < keys.length; i++) {
    if (t <= keys[i][0]) {
      const [t0, a] = keys[i - 1], [t1, b] = keys[i];
      const u = t1 > t0 ? smooth((t - t0) / (t1 - t0)) : 1;
      _v.set(b[0], b[1], b[2]);
      return out.set(a[0], a[1], a[2]).lerp(_v, u);
    }
  }
  const k = keys[keys.length - 1][1];
  return out.set(k[0], k[1], k[2]);
}

/** step function (for pose names) */
export function sampleStep<T>(keys: Key<T>[] | undefined, t: number, fallback: T): T {
  if (!keys || keys.length === 0) return fallback;
  let v = keys[0][1];
  for (const [kt, kv] of keys) { if (t >= kt) v = kv; else break; }
  return v;
}

export function countTriangles(obj: THREE.Object3D): number {
  let n = 0;
  obj.traverse((o) => { const m = o as THREE.Mesh; if (m.isMesh && m.geometry) { const g = m.geometry; n += g.index ? g.index.count / 3 : g.getAttribute('position').count / 3; } });
  return Math.round(n);
}
