import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { t } from '../core/I18n';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi, VehicleApi } from '../game/Contracts';
import type { RenderSystem } from '../render/RenderSystem';
import { SHORTCUTS } from './spots';
import type { StuntApi } from '.';

/** First time through each one pays this. */
export const SHORTCUT_PRIZE = 150;
/** Points in the street combo for going through. */
const POINTS = 90;
/** Metres off the path's line that still count as on it (the path is a car's width of clear ground). */
const OFF = 6;
const KEY = 'drivecity.shortcuts.v1';

export interface ShortcutApi extends System {
  readonly found: number;
  readonly total: number;
  debug: { paths(): { p: number[]; len: number; saves: number }[]; state(): { on: number; from: number; progress: number } };
}

/**
 * 胡同捷径: footpaths through the blocks of the core that a car fits down and that save a long way
 * round by road (Spots.gen.test.ts picks them: clear of every building, trunk and post within a
 * car's half width, and at least twice as short as the drive). Each end has a pair of red lanterns
 * on posts. The police drive the lane graph, which has no footpaths, so a shortcut also shakes them
 * off. Through one, end to end without leaving it: points in the combo, and SHORTCUT_PRIZE the
 * first time (`drivecity.shortcuts.v1`).
 */
export function installShortcuts(engine: Engine): void {
  const pl = engine.get<PlayerApi>('player');
  if (!pl || !SHORTCUTS.length) return;
  let found = new Set<number>();
  try { found = new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as number[]); } catch { /* private mode */ }
  const env = engine.get<RenderSystem>('render')?.uniforms;

  // Each path: its points, cumulative lengths, and its two ends with the direction into the path.
  const paths = SHORTCUTS.map((sc) => {
    const n = sc.p.length / 2, cum = new Float32Array(n);
    for (let i = 1; i < n; i++) cum[i] = cum[i - 1] + Math.hypot(sc.p[i * 2] - sc.p[i * 2 - 2], sc.p[i * 2 + 1] - sc.p[i * 2 - 1]);
    /** A point `s` metres along the path from its start. */
    const at = (s: number): [number, number] => {
      let k = 1;
      while (k < n - 1 && cum[k] < s) k++;
      const u = cum[k] > cum[k - 1] ? Math.max(0, Math.min(1, (s - cum[k - 1]) / (cum[k] - cum[k - 1]))) : 0;
      return [sc.p[k * 2 - 2] + (sc.p[k * 2] - sc.p[k * 2 - 2]) * u, sc.p[k * 2 - 1] + (sc.p[k * 2 + 1] - sc.p[k * 2 - 1]) * u];
    };
    // Each end's way in, from the path's first 6 m rather than its first segment: some paths start
    // with a stub a metre long pointing anywhere, and a gate turned by it stood across the way.
    const len = cum[n - 1], reach = Math.min(6, len / 2);
    const end = (x: number, z: number, [tx, tz]: [number, number]) => {
      const dx = tx - x, dz = tz - z, L = Math.hypot(dx, dz) || 1;
      return { x, z, dx: dx / L, dz: dz / L };
    };
    return { sc, cum, len, ends: [end(sc.p[0], sc.p[1], at(reach)), end(sc.p[n * 2 - 2], sc.p[n * 2 - 1], at(len - reach))] };
  });

  // --- the lantern gates -----------------------------------------------------------------------------
  const part = (g: THREE.BufferGeometry, hex: string, glow = 0) => {
    const geo = g.index ? g.toNonIndexed() : g, n = geo.getAttribute('position').count, c = new THREE.Color(hex);
    const col = new Float32Array(n * 3), gl = new Float32Array(n).fill(glow);
    for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    geo.setAttribute('aGlow', new THREE.BufferAttribute(gl, 1));
    geo.deleteAttribute('uv');
    return geo;
  };
  const posts: THREE.BufferGeometry[] = [];
  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const GATE = 2.3;   // posts either side of the path's line: 4.6 m apart, room for a car
  for (const p of paths) for (const e of p.ends) {
    const lx = e.dz, lz = -e.dx;
    // Set a couple of metres into the path, so the gate stands at its mouth rather than on the street.
    const cx = e.x + e.dx * 2, cz = e.z + e.dz * 2;
    for (const s of [-1, 1]) {
      const x = cx + lx * s * GATE, z = cz + lz * s * GATE;
      posts.push(part(new THREE.CylinderGeometry(0.09, 0.11, 2.9, 6).translate(x, 1.45, z), '#5a3522'));
      posts.push(part(new THREE.BoxGeometry(0.06, 0.06, 0.5).translate(0, 0, 0.25).rotateY(Math.atan2(-lx * s, -lz * s)).translate(x, 2.75, z), '#5a3522'));
      const hx = x - lx * s * 0.45, hz = z - lz * s * 0.45;
      posts.push(part(new THREE.SphereGeometry(0.26, 10, 8).scale(1, 1.2, 1).translate(hx, 2.3, hz), '#d8201c', 1.4));
      posts.push(part(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10).translate(hx, 2.63, hz), '#e8b62a', 0.6));
      posts.push(part(new THREE.CylinderGeometry(0.16, 0.16, 0.08, 10).translate(hx, 1.97, hz), '#e8b62a', 0.6));
      posts.push(part(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 4).translate(hx, 1.77, hz), '#e8b62a', 0.4));
      const c = world.createCollider(R.ColliderDesc.cylinder(1.45, 0.12).setTranslation(x, 1.45, z).setCollisionGroups(groups(CG.WORLD, CG.ALL)), body);
      engine.physics.tag(c, { surface: 'concrete', tag: 'lantern' });
    }
    // A little plaque on one post: 捷径.
    const px = cx + lx * GATE, pz = cz + lz * GATE;
    posts.push(part(new THREE.BoxGeometry(0.34, 0.5, 0.04).rotateY(Math.atan2(e.dx, e.dz)).translate(px - e.dx * 0.12, 1.5, pz - e.dz * 0.12), '#1d3b6e', 0.3));
  }
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 });
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uNight = env?.uNight ?? { value: 0 };
    sh.vertexShader = sh.vertexShader.replace('#include <common>', '#include <common>\nattribute float aGlow;\nvarying float vGlow;').replace('#include <begin_vertex>', '#include <begin_vertex>\nvGlow = aGlow;');
    sh.fragmentShader = sh.fragmentShader.replace('#include <common>', '#include <common>\nuniform float uNight;\nvarying float vGlow;')
      .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\ntotalEmissiveRadiance += vColor.rgb * vGlow * (0.25 + 2.5 * uNight);');
  };
  mat.customProgramCacheKey = () => 'lanterns';
  const mesh = new THREE.Mesh(mergeGeometries(posts)!, mat);
  mesh.name = 'shortcut-gates'; mesh.castShadow = true;
  engine.scene.add(mesh);
  queueMicrotask(() => engine.get<RenderSystem>('render')?.prepare?.(mesh));

  // --- going through ---------------------------------------------------------------------------------
  /** Arc length along path `i` nearest (x, z), and how far off the line. */
  const along = (i: number, x: number, z: number) => {
    const { sc, cum } = paths[i];
    let best = { s: 0, d: Infinity };
    for (let k = 1; k < cum.length; k++) {
      const ax = sc.p[k * 2 - 2], az = sc.p[k * 2 - 1], vx = sc.p[k * 2] - ax, vz = sc.p[k * 2 + 1] - az, L2 = vx * vx + vz * vz || 1;
      const u = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
      const d = Math.hypot(x - ax - vx * u, z - az - vz * u);
      if (d < best.d) best = { s: cum[k - 1] + u * Math.sqrt(L2), d };
    }
    return best;
  };
  let on = -1, from = 0, progress = 0, clock = 0, start = 0;
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const blips: Blip[] = [];
  let blipsOn = false;
  const api: ShortcutApi = {
    name: 'shortcuts',
    get found() { return found.size; },
    total: paths.length,
    debug: { paths: () => SHORTCUTS, state: () => ({ on, from, progress }) },
    fixedUpdate(dt) {
      clock += dt;
      const v = engine.get<VehicleApi>('vehicle');
      if (!v || pl.mode !== 'driving' || !v.occupied) { on = -1; return; }
      const car = v.car;
      if (on < 0) {
        // Into one from either end: within 5 m of an end's mouth, heading in.
        for (let i = 0; i < paths.length && on < 0; i++) {
          paths[i].ends.forEach((e, k) => {
            if (on >= 0 || Math.hypot(car.pos.x - e.x, car.pos.z - e.z) > 6) return;
            if (car.vel.x * e.dx + car.vel.z * e.dz < 2) return;
            on = i; from = k; progress = 0; start = clock;
          });
        }
        return;
      }
      const p = paths[on], a = along(on, car.pos.x, car.pos.z);
      const s = from === 0 ? a.s : p.len - a.s;
      if (a.d > OFF || clock - start > p.len / 2 + 20) { on = -1; return; }
      progress = Math.max(progress, s / p.len);
      if (s > p.len - 4 && progress > 0.9) {
        const i = on;
        on = -1;
        engine.get<StuntApi>('stunts')?.score('shortcut', POINTS);
        if (!found.has(i)) {
          found.add(i);
          try { localStorage.setItem(KEY, JSON.stringify([...found])); } catch { /* ignore */ }
          engine.get<MissionApi>('missions')?.addCash(SHORTCUT_PRIZE);
          toast(t('shortcut.found', { i: found.size, of: paths.length, n: SHORTCUT_PRIZE, km: (p.sc.saves / 1000).toFixed(1) }));
        }
      }
    },
    update() {
      const n = engine.get<NavApi>('nav');
      if (n && !blipsOn) {
        blipsOn = true;
        n.addBlips(() => {
          blips.length = 0;
          const at = pl.position;
          for (const p of paths) for (const e of p.ends) if (!n.mapOpen ? Math.hypot(e.x - at.x, e.z - at.z) < 150 : true) blips.push({ kind: 'shortcut', x: e.x, z: e.z });
          return blips;
        });
      }
    },
  };
  engine.add(api);
}
