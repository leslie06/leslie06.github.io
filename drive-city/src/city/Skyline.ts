import * as THREE from 'three';
import type { EnvUniforms } from '../game/Contracts';
import type { Skyline } from './Data';
import { TILE } from './Geo';

/** Far-box colours by kind (glass, office, resid, hutong, trad, wall, low, station): the detail palette. */
const COL = ['#5f7688', '#d6d1c6', '#dcd3c2', '#a3a5a4', '#9a3226', '#9c9ea0', '#c9c5bb', '#ddd4c4'];

/**
 * Every building of 20 m or more as an instanced box, drawn only where the detailed tiles are not
 * loaded: the city keeps its silhouette to the horizon for one draw call. Windows are a world-space
 * grid that fades to its average where it would alias; glass towers are dark and glossy; roofs
 * are grey. Windows light up at night like the detailed facades.
 */
export class SkylineLod {
  readonly mesh: THREE.InstancedMesh;
  private data: number[];
  private tiles: string[];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private p = new THREE.Vector3();
  private s = new THREE.Vector3();
  private hidden = new Set<string>();

  constructor(sky: Skyline, env: EnvUniforms) {
    this.data = sky.b;
    const n = this.data.length / 8;
    const geo = new THREE.BoxGeometry(2, 1, 2).translate(0, 0.5, 0);
    const kinds = new Float32Array(n);
    for (let i = 0; i < n; i++) kinds[i] = this.data[i * 8 + 6];
    geo.setAttribute('aKind', new THREE.InstancedBufferAttribute(kinds, 1));
    const mat = new THREE.MeshStandardMaterial({ roughness: 0.8, metalness: 0 });
    mat.customProgramCacheKey = () => 'skyline2';
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = env.uNight;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nattribute float aKind;\nvarying float vKind;\nvarying vec3 vW;\nvarying vec3 vN;')
        .replace('#include <worldpos_vertex>', '#include <worldpos_vertex>\nvKind = aKind;\nvW = (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;\nvN = normalize(mat3(modelMatrix * instanceMatrix) * normal);');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vKind;\nvarying vec3 vW;\nvarying vec3 vN;\nfloat skyHash(vec2 p){return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453);}\nfloat skyWin; float skyGlass;')
        .replace('#include <color_fragment>', `#include <color_fragment>
{
  float side = 1.0 - abs(vN.y);
  skyGlass = 1.0 - step(0.5, vKind);
  float u = abs(vN.x) > abs(vN.z) ? vW.z : vW.x;
  vec2 cell = vec2(u / (skyGlass > 0.5 ? 1.6 : 3.2), vW.y / (skyGlass > 0.5 ? 4.0 : 3.1));
  vec2 f = fract(cell);
  float fw = max(fwidth(cell.x), fwidth(cell.y));
  float pat = skyGlass > 0.5 ? (step(0.06, f.x) * step(0.25, f.y)) : step(0.2, f.x) * step(f.x, 0.8) * step(0.3, f.y) * step(f.y, 0.85);
  skyWin = mix(pat, skyGlass > 0.5 ? 0.7 : 0.33, smoothstep(0.2, 0.6, fw)) * step(4.0, vW.y) * side;
  diffuseColor.rgb *= skyGlass > 0.5 ? mix(1.25, 0.8, skyWin) : 1.0 - 0.42 * skyWin;
  diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.52, 0.52, 0.5), smoothstep(0.5, 0.9, vN.y) * 0.75);
}`)
        .replace('#include <roughnessmap_fragment>', '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.12, skyGlass * (1.0 - abs(vN.y)));')
        .replace('#include <metalnessmap_fragment>', '#include <metalnessmap_fragment>\nmetalnessFactor = mix(metalnessFactor, 0.8, skyGlass * (1.0 - abs(vN.y)));')
        .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
{
  float u = abs(vN.x) > abs(vN.z) ? vW.z : vW.x;
  vec2 cell = vec2(u / 3.2, vW.y / 3.2);
  float on = step(0.52, skyHash(floor(cell) + floor(vW.xz / 40.0)));
  totalEmissiveRadiance += vec3(1.0, 0.75, 0.45) * skyWin * on * uNight * 1.6;
}`);
    };
    this.mesh = new THREE.InstancedMesh(geo, mat, n);
    this.mesh.name = 'skyline';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = true;
    this.tiles = [];
    const c = new THREE.Color();
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      this.tiles.push(`${Math.floor(this.data[o] / TILE)}_${Math.floor(this.data[o + 1] / TILE)}`);
      c.set(COL[this.data[o + 6]] ?? COL[1]).offsetHSL(0, 0, (this.data[o + 7] - 0.5) * 0.08);
      this.mesh.setColorAt(i, c);
    }
    this.write();
  }

  /** Boxes inside a landmark footprint (flat world [x, z, ...] polygons): the landmark model replaces them. */
  private excluded = new Set<number>();
  exclude(footprints: number[][]): void {
    const d = this.data;
    const inside = (x: number, z: number, r: number[]) => {
      let c = false;
      for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
        const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
        if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) c = !c;
      }
      return c;
    };
    for (let i = 0; i < this.tiles.length; i++) {
      const x = d[i * 8], z = d[i * 8 + 1];
      if (footprints.some((f) => f.length >= 6 && inside(x, z, f))) this.excluded.add(i);
    }
    this.write();
  }

  /** Hide the boxes of tiles that are drawn in detail. */
  setDetailed(keys: Set<string>): void {
    let changed = keys.size !== this.hidden.size;
    if (!changed) for (const k of keys) if (!this.hidden.has(k)) { changed = true; break; }
    if (!changed) return;
    this.hidden = new Set(keys);
    this.write();
  }

  private write(): void {
    const d = this.data;
    for (let i = 0; i < this.tiles.length; i++) {
      const o = i * 8;
      if (this.hidden.has(this.tiles[i]) || this.excluded.has(i)) this.s.set(0, 0, 0);
      else this.s.set(d[o + 3], d[o + 5], d[o + 4]);
      this.q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -d[o + 2]);
      this.p.set(d[o], 0, d[o + 1]);
      this.mesh.setMatrixAt(i, this.m.compose(this.p, this.q, this.s));
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}
