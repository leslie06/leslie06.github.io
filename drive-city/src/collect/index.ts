import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import RABBIT_MODEL from './rabbit.json';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi } from '../game/Contracts';
import type { RenderSystem } from '../render/RenderSystem';
import { RABBITS } from '../stunts/spots';

/** Each one found pays this; the whole set pays SET_PRIZE on top. */
export const RABBIT_PRIZE = 100;
export const SET_PRIZE = 2500;
/** Found by driving or walking within this many metres. */
const REACH = 2.8;
/** Shown on the radar only this close: they are there to be found. */
const HINT = 120;
const KEY = 'drivecity.rabbits.v1';

export interface CollectApi extends System {
  readonly found: number;
  readonly total: number;
  debug: { spots(): { x: number; z: number }[]; reset(): void };
}

/**
 * 兔儿爷, the clay Rabbit God of Beijing's Mid-Autumn fairs: RABBITS of them (placed by
 * stunts/Spots.gen.test.ts on the kerbs of the lanes round the core), floating over the pavement,
 * turning, a glow ring under each. Drive or walk into one: RABBIT_PRIZE each, SET_PRIZE for the
 * lot, saved in `drivecity.rabbits.v1`. The radar shows one only within HINT metres.
 */
export async function install(engine: Engine): Promise<void> {
  const pl = engine.get<PlayerApi>('player');
  if (!pl) return;
  let found = new Set<number>();
  try { found = new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as number[]); } catch { /* private mode */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...found])); } catch { /* ignore */ } };

  // The figure, ~0.8 m: a red robe on a gold base, gold armour, a white face with long ears.
  const part = (g: THREE.BufferGeometry, hex: string, glow = 0) => {
    const geo = g.index ? g.toNonIndexed() : g, n = geo.getAttribute('position').count, c = new THREE.Color(hex);
    const col = new Float32Array(n * 3), gl = new Float32Array(n).fill(glow);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
    geo.deleteAttribute('uv');
    return geo;
  };
  // The figure is modelled in Blender (scripts/blender/props/rabbit.py -> scripts/vehicles/import.mjs): per
  // material, positions in millimetres, normals in hundredths; here each gets its colour and night glow.
  const LOOK: Record<string, [string, number]> = {
    base: ['#d9a520', 0.4], lotus: ['#3c8a4a', 0], robe: ['#c8231d', 0], gold: ['#e8b62a', 0.5], face: ['#f6f1e6', 0], blush: ['#f08aa0', 0],
    mouth: ['#e04a6a', 0], eyes: ['#1a1a1a', 0], wood: ['#6b4a2a', 0], plume: ['#d81e1e', 0.3],
    flag1: ['#2c6fd6', 0.3], flag2: ['#2a9d5a', 0.3], flag3: ['#e2b13c', 0.3], flag4: ['#c8231d', 0.3],
  };
  const figure = mergeGeometries(Object.entries(RABBIT_MODEL as Record<string, { p: number[]; n: number[]; i: number[] }>).map(([name, g]) => {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(g.p, (v) => v / 1000), 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(g.n, (v) => v / 100), 3));
    geo.setIndex(g.i);
    const [hex, glow] = LOOK[name] ?? ['#ff00ff', 0];
    return part(geo, hex, glow);
  }))!;
  const env = engine.get<RenderSystem>('render')?.uniforms;
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.45, metalness: 0.1 });
  // A soft self-glow (more at night), so a figure reads in a dark lane.
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = env?.uNight ?? { value: 0 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * (0.12 + vGlow) * (0.4 + 1.6 * uNight);');
  };
  mat.customProgramCacheKey = () => 'rabbit';
  const n = RABBITS.length;
  const mesh = new THREE.InstancedMesh(figure, mat, n);
  mesh.name = 'rabbits'; mesh.castShadow = true; mesh.frustumCulled = false;
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  const ringMat = new THREE.MeshBasicMaterial({ color: '#ffb3c8', transparent: true, opacity: 0.55, depthWrite: false, blending: THREE.AdditiveBlending });
  const rings = new THREE.InstancedMesh(new THREE.RingGeometry(0.55, 0.75, 32).rotateX(-Math.PI / 2), ringMat, n);
  rings.name = 'rabbit-rings'; rings.frustumCulled = false;
  engine.scene.add(mesh, rings);
  queueMicrotask(() => engine.get<RenderSystem>('render')?.prepare?.(mesh));

  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), p = new THREE.Vector3(), s = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
  let clock = 0;
  // Only the figures within DRAW of the camera are written (packed): all 25 were drawn from
  // anywhere in the city, 5% of a low-tier frame's triangles for things a few pixels high.
  const DRAW = 250;
  const pose = () => {
    const cam = engine.camera.position;
    let k = 0;
    for (let i = 0; i < n; i++) {
      const r = RABBITS[i];
      if (found.has(i) || Math.abs(r.x - cam.x) > DRAW || Math.abs(r.z - cam.z) > DRAW) continue;
      m4.compose(p.set(r.x, 0.55 + Math.sin(clock * 2 + i) * 0.08, r.z), q.setFromAxisAngle(up, clock * 1.4 + i), s.set(1.1, 1.1, 1.1));
      mesh.setMatrixAt(k, m4);
      m4.compose(p.set(r.x, 0.07, r.z), q.identity(), s.setScalar(1 + 0.08 * Math.sin(clock * 3 + i)));
      rings.setMatrixAt(k, m4);
      k++;
    }
    mesh.count = k; rings.count = k;
    mesh.instanceMatrix.needsUpdate = true; rings.instanceMatrix.needsUpdate = true;
  };

  const toast = (x: string) => engine.get<HudApi>('hud')?.toast(x);
  const blips: Blip[] = [];
  let blipsOn = false;
  const api: CollectApi = {
    name: 'collect',
    get found() { return found.size; },
    total: n,
    debug: { spots: () => RABBITS, reset: () => { found.clear(); save(); } },
    fixedUpdate() {
      const at = pl.position;
      for (let i = 0; i < n; i++) {
        if (found.has(i)) continue;
        const r = RABBITS[i];
        if (Math.abs(r.x - at.x) > REACH || Math.abs(r.z - at.z) > REACH || Math.hypot(r.x - at.x, r.z - at.z) > REACH) continue;
        found.add(i); save();
        const m = engine.get<MissionApi>('missions');
        m?.addCash(RABBIT_PRIZE);
        if (found.size === n) { m?.addCash(SET_PRIZE); toast(t('rabbit.all', { n: SET_PRIZE })); }
        else toast(t('rabbit.found', { i: found.size, of: n, n: RABBIT_PRIZE }));
        engine.events.emit('collect:found', { x: r.x, z: r.z, found: found.size, total: n });
      }
    },
    update(dt) {
      clock += dt;
      pose();
      const nav = engine.get<NavApi>('nav');
      if (nav && !blipsOn) {
        blipsOn = true;
        nav.addBlips(() => {
          blips.length = 0;
          const at = pl.position;
          RABBITS.forEach((r, i) => { if (!found.has(i) && Math.hypot(r.x - at.x, r.z - at.z) < HINT) blips.push({ kind: 'collect', x: r.x, z: r.z }); });
          return blips;
        });
      }
    },
  };
  engine.add(api);
}
