import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { EnvUniforms } from '../game/Contracts';
import PROPS from './props.json';

/** The street life's things (scripts/blender/props/life.py -> props.json). */
export type PropKind = 'stool' | 'chess' | 'cart' | 'grill' | 'lantern' | 'speaker' | 'cage' | 'table' | 'broom' | 'flag' | 'guitar' | 'erhu' | 'bow' | 'cord';
const KINDS: PropKind[] = ['stool', 'chess', 'cart', 'grill', 'lantern', 'speaker', 'cage', 'table', 'broom', 'flag', 'guitar', 'erhu', 'bow', 'cord'];
/** How many of each can be out at once, and which cast shadows (the small and hand-held ones do not). */
const CAP: Record<PropKind, number> = { stool: 16, chess: 3, cart: 3, grill: 3, lantern: 4, speaker: 2, cage: 6, table: 4, broom: 3, flag: 2, guitar: 2, erhu: 2, bow: 2, cord: 6 };
const SHADOW = new Set<PropKind>(['chess', 'cart', 'grill', 'speaker', 'table', 'lantern']);

/** Material name -> colour and night glow (a sign, coals, a lantern, the speaker's panel). */
const LOOK: Record<string, [string, number]> = {
  steel: ['#9aa0a5', 0], steelDark: ['#4a4f54', 0], wood: ['#9b6b3e', 0], woodDark: ['#6b4526', 0], canvas: ['#2f4f7a', 0], board: ['#e2c48c', 0],
  ink: ['#2a1a10', 0], red: ['#c4231c', 0], black: ['#16161a', 0], white: ['#eceae4', 0], iron: ['#232325', 0], awningRed: ['#c8261e', 0],
  awningWhite: ['#f1efe8', 0], sign: ['#d22a1c', 0.7], signText: ['#f6d65a', 0.9], coal: ['#ff6a1c', 1.6], skewer: ['#c9a26a', 0], meat: ['#8c3b22', 0],
  lantern: ['#d8201c', 1.5], gold: ['#e2b13c', 0.2], speaker: ['#1c1d20', 0], grille: ['#3a3c40', 0], panel: ['#38d0ff', 1.2], tyre: ['#141414', 0],
  bamboo: ['#c9a764', 0], cloth: ['#2d5d8c', 0], plastic: ['#2e6fb5', 0], bottle: ['#2f7a3a', 0], label: ['#e8d9a8', 0], brush: ['#a8874a', 0],
  pole: ['#c8ccd0', 0], flagRed: ['#e2301f', 0], flagYellow: ['#f2c21a', 0], guitarBody: ['#b9772f', 0], guitarFace: ['#e8b46a', 0],
  fret: ['#3a2a1c', 0], string: ['#d8d8d8', 0], erhuDrum: ['#2a1612', 0], erhuPole: ['#3b2418', 0], horse: ['#d9c8a0', 0],
};

type Model = Record<string, { p: number[]; n: number[]; i: number[] }>;
function geometry(kind: PropKind): THREE.BufferGeometry {
  // A cord (a bird cage's, from a branch): 1 m hanging down from its origin, stretched by the y scale.
  if (kind === 'cord') {
    const g = new THREE.CylinderGeometry(0.006, 0.006, 1, 4, 1, true).translate(0, -0.5, 0).toNonIndexed();
    const n = g.getAttribute('position').count, c = new THREE.Color('#3b3128'), cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
    g.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    g.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n), 1));
    return g;
  }
  const model = (PROPS as unknown as Record<string, Model>)[kind];
  const parts = Object.entries(model).map(([mat, g]) => {
    const [hex, glow] = LOOK[mat] ?? ['#ff00ff', 0];
    const geo = new THREE.BufferGeometry(), n = g.p.length / 3, c = new THREE.Color(hex), cols = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) cols.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(g.p, (v) => v / 1000), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(g.n, (v) => v / 100), 3));
    geo.setAttribute('color', new THREE.BufferAttribute(cols, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(new Float32Array(n).fill(glow), 1));
    geo.setIndex(g.i);
    return geo;
  });
  return mergeGeometries(parts)!;
}

/**
 * The props, one InstancedMesh per kind (a draw call each only while one is out): life/ writes the
 * frame's placements between `begin` and `commit`. Glowing parts are lit a little by day and fully at night.
 */
export class LifeProps {
  private meshes = new Map<PropKind, THREE.InstancedMesh>();
  private n = new Map<PropKind, number>();

  constructor(scene: THREE.Scene, env: EnvUniforms | undefined) {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide });
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uNight = env?.uNight ?? { value: 0 };
      sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
      sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vGlow;')
        .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * (0.15 + 0.85 * uNight);');
    };
    mat.customProgramCacheKey = () => 'life-props';
    for (const k of KINDS) {
      const m = new THREE.InstancedMesh(geometry(k), mat, CAP[k]);
      m.name = `life:${k}`;
      m.frustumCulled = false;
      m.castShadow = SHADOW.has(k); m.receiveShadow = true;
      m.count = 0; m.visible = false;
      scene.add(m);
      this.meshes.set(k, m);
    }
  }

  begin(): void { for (const k of KINDS) this.n.set(k, 0); }

  add(kind: PropKind, m: THREE.Matrix4): void {
    const i = this.n.get(kind)!, mesh = this.meshes.get(kind)!;
    if (i >= CAP[kind]) return;
    mesh.setMatrixAt(i, m);
    this.n.set(kind, i + 1);
  }

  /** At (x, y, z) turned `yaw` about up. */
  place(kind: PropKind, x: number, y: number, z: number, yaw: number, sy = 1): void {
    _q.setFromAxisAngle(_up, yaw);
    _m.compose(_p.set(x, y, z), _q, _s.set(1, sy, 1));
    this.add(kind, _m);
  }

  commit(): void {
    for (const k of KINDS) {
      const mesh = this.meshes.get(k)!, n = this.n.get(k)!;
      mesh.count = n; mesh.visible = n > 0;
      if (n) mesh.instanceMatrix.needsUpdate = true;
    }
  }
}
const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3(1, 1, 1), _up = new THREE.Vector3(0, 1, 0);
