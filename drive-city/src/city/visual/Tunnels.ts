import * as THREE from 'three';
import type { Collider } from '@dimforge/rapier3d-compat';
import type { Engine, System } from '../../core/Engine';
import { CG, groups } from '../../core/Physics';
import { FlatMesh } from './Footbridges';

/** public/city/tunnels.json (scripts/city/build.mjs, "underpasses"). */
export interface TunnelsFile {
  t: {
    /** Centre line [x, z, ...], a point every 10 m or less. */
    p: number[];
    /** Road surface height per point (negative down in the underpass, 0 at the ends). */
    h: number[];
    /** Half widths per point, left and right of the direction (pulled in where a road runs alongside, carried out to meet a trench beside). */
    l: number[]; w: number[];
    /** The carriageway's own half width. */
    r: number;
    /** Per segment: 1 covered (the tunnel, or under a road; else an open trench), 2 a wall on the left, 4 on the right. */
    c: number[];
  }[];
  /** The open trenches as rings [x, z, ...]: holes in the ground plane and its collider. */
  holes: number[][];
}

const CELL = 256, NEAR = 700, FAR = 900;
/** Wall thickness, the parapet over the ground at full depth, the roof slab under the ground. */
const WALL_T = 0.45, PARAPET = 1.05, SLAB = 0.9, FLARE = 0.8;
/**
 * The offset direction at point i of a centre line [x, z, ...]: the adjoining segments' left normals averaged and
 * stretched by 1/cos of half the bend (a mitre), so offset lines meet at the bisector. At an end, the segment beyond
 * is the joining way's (`beyond`), when one runs on from there.
 */
function mitreNormal(p: number[], i: number, beyond: number[] | null): number[] {
  const m = p.length / 2, seg = (k: number) => { const L = Math.hypot(p[k * 2 + 2] - p[k * 2], p[k * 2 + 3] - p[k * 2 + 1]) || 1; return [-(p[k * 2 + 3] - p[k * 2 + 1]) / L, (p[k * 2 + 2] - p[k * 2]) / L]; };
  const a = i > 0 ? seg(i - 1) : beyond ?? seg(0), b = i < m - 1 ? seg(i) : beyond ?? seg(m - 2);
  let nx = a[0] + b[0], nz = a[1] + b[1];
  const L = Math.hypot(nx, nz);
  if (L < 1e-6) return b;
  nx /= L; nz /= L;
  const k = 1 / Math.max(0.7, nx * b[0] + nz * b[1]);
  return [nx * k, nz * k];
}
const C = { wall: '#b4b0a7', coping: '#d3cfc7', roof: '#8e8c87', inner: '#c9c6bf', lamp: '#fff1d6' };

export interface TunnelApi extends System {
  readonly count: number;
  readonly built: () => number;
}

/**
 * The underpasses (下穿, 2026-10-02): the build sinks a car road's tunnel 6 m and its approaches down to it
 * (its tiles' road pieces carry the heights, so the carriageway itself is drawn by Roads.ts); this draws
 * the rest - along each open stretch (a trench, a hole in the ground) a concrete wall each side rising to
 * a parapet over the ground as the trench deepens; along each covered stretch the walls up to the ground,
 * the roof slab under it and a lamp strip down its middle (lit day and night). Colliders: the floor
 * under the road surface, the walls and the roof (the chase camera pulls in under it). Built per 256 m
 * cell within NEAR of the camera, dropped past FAR.
 */
export function placeTunnels(engine: Engine, data: TunnelsFile): TunnelApi {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85 });
  mat.userData.wet = 'surface';
  const lampMat = new THREE.MeshBasicMaterial({ color: C.lamp, toneMapped: true });
  const cells = new Map<string, { t: number; i: number }[]>();
  data.t.forEach((r, t) => {
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      if (Math.min(r.h[i / 2], r.h[i / 2 + 1]) > -0.05) continue;
      const k = `${Math.floor((r.p[i] + r.p[i + 2]) / 2 / CELL)}_${Math.floor((r.p[i + 1] + r.p[i + 3]) / 2 / CELL)}`;
      (cells.get(k) ?? cells.set(k, []).get(k)!).push({ t, i: i / 2 });
    }
  });
  // Where one tunnel way runs on into another: the next way's first segment normal (or the last one's before ours),
  // in our direction of travel, so the walls are mitred across the joint too.
  const endKey = (x: number, z: number) => `${Math.round(x * 2)},${Math.round(z * 2)}`;
  const ends = new Map<string, { t: number; end: 0 | 1 }[]>();
  data.t.forEach((r, t) => { const m = r.p.length / 2; for (const end of [0, 1] as const) { const k = endKey(r.p[end ? m * 2 - 2 : 0], r.p[end ? m * 2 - 1 : 1]); (ends.get(k) ?? ends.set(k, []).get(k)!).push({ t, end }); } });
  const beyondOf = (t: number, end: 0 | 1): number[] | null => {
    const r = data.t[t], m = r.p.length / 2, x = r.p[end ? m * 2 - 2 : 0], z = r.p[end ? m * 2 - 1 : 1];
    const others = (ends.get(endKey(x, z)) ?? []).filter((e) => e.t !== t && e.end !== end);
    if (others.length !== 1) return null;
    const o = data.t[others[0].t].p, om = o.length / 2;
    // the other's segment at the joint, as a direction continuing ours
    const [ax, az, bx, bz] = end ? [o[0], o[1], o[2], o[3]] : [o[om * 2 - 4], o[om * 2 - 3], o[om * 2 - 2], o[om * 2 - 1]];
    const L = Math.hypot(bx - ax, bz - az) || 1;
    return [-(bz - az) / L, (bx - ax) / L];
  };
  type Hull = number[];
  const buildCell = (k: string) => {
    const m = new FlatMesh(), lamps = new FlatMesh(), hulls: Hull[] = [];
    for (const { t, i } of cells.get(k)!) {
      const r = data.t[t], ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3];
      const ha = r.h[i], hb = r.h[i + 1], hl = (r.l[i] + r.l[i + 1]) / 2, hr = (r.w[i] + r.w[i + 1]) / 2, covered = (r.c[i] & 1) === 1;
      // Offsets along each end's mitred normal (the two segments' normals averaged, stretched by 1/cos of half the
      // bend), not the segment's own: with that, on the inside of every bend the walls of consecutive segments
      // overlapped into the lane, a car's corner met them at a ramp's curve (the census, 2026-10-03), and on the
      // outside they left a notch open.
      const npt = r.p.length / 2;
      const na = mitreNormal(r.p, i, i === 0 ? beyondOf(t, 0) : null), nb = mitreNormal(r.p, i + 1, i + 1 === npt - 1 ? beyondOf(t, 1) : null);
      const P = (x: number, z: number, o: number, y: number) => { const n = x === ax && z === az ? na : nb; return [x + n[0] * o, y, z + n[1] * o]; };
      const prism = (o0: number, o1: number, ya0: number, ya1: number, yb0: number, yb1: number) =>
        hulls.push([...P(ax, az, o0, ya0), ...P(ax, az, o1, ya0), ...P(ax, az, o0, ya1), ...P(ax, az, o1, ya1), ...P(bx, bz, o0, yb0), ...P(bx, bz, o1, yb0), ...P(bx, bz, o0, yb1), ...P(bx, bz, o1, yb1)]);
      // the floor under the road surface (the tile draws the road; this is what the wheels meet)
      prism(-hr - 0.05, hl + 0.05, ha - 0.6, ha + 0.03, hb - 0.6, hb + 0.03);
      // the walls: up to a parapet over the ground in a trench (growing with the depth), up to the roof in the tunnel
      // (a tunnel's walls stop just under the ground: level with it they would z-fight its plane)
      const top = (h: number) => (covered ? -0.05 : Math.min(PARAPET, 0.25 - h * 0.4));
      // No wall where the trench is still under 0.4 m deep: its top stood 0.25 m proud of the ground there, a kerb
      // across anything driving in from the side (a hutong shortcut's mouth, 2026-10-03), and a car can take the step.
      const shallow = !covered && Math.min(ha, hb) > -0.4;
      for (const s of [-1, 1]) {
        if (shallow) break;
        const bit = s > 0 ? 2 : 4;
        if (!(r.c[i] & bit)) continue;   // a trench beside on that side: one trench, no wall between
        const o0 = s > 0 ? hl : -hr - WALL_T, o1 = s > 0 ? hl + WALL_T : -hr;
        // Where a wall starts or stops along the way (two carriageways' trenches parting or meeting), its end flares
        // out FLARE m over the segment: it stood square across the inner lane's edge (pulled 0.5 m into the lanes
        // where there is no room outside) and a car met it head on (紫竹院路's tunnel, the census of 2026-10-04).
        const q = s > 0 ? hl : hr, k = (q + FLARE) / Math.max(1, q);
        const fa = i > 0 && !(r.c[i - 1] & bit) ? k : 1, fb = i + 1 < r.c.length && !(r.c[i + 1] & bit) ? k : 1;
        const wa = [na[0] * fa, na[1] * fa], wb = [nb[0] * fb, nb[1] * fb];
        m.bar(ax, az, bx, bz, o0, o1, ha - 0.2, top(ha), hb - 0.2, top(hb), covered ? C.inner : C.wall, wa, wb);
        if (!covered) m.bar(ax, az, bx, bz, o0 - 0.04, o1 + 0.04, top(ha), top(ha) + 0.08, top(hb), top(hb) + 0.08, C.coping, wa, wb);
        const W = (x: number, z: number, o: number, y: number) => { const n = x === ax && z === az ? wa : wb; return [x + n[0] * o, y, z + n[1] * o]; };
        const ya0 = ha - 0.2, ya1 = top(ha) + (covered ? 0 : 0.08), yb0 = hb - 0.2, yb1 = top(hb) + (covered ? 0 : 0.08);
        hulls.push([...W(ax, az, o0, ya0), ...W(ax, az, o1, ya0), ...W(ax, az, o0, ya1), ...W(ax, az, o1, ya1), ...W(bx, bz, o0, yb0), ...W(bx, bz, o1, yb0), ...W(bx, bz, o0, yb1), ...W(bx, bz, o1, yb1)]);
      }
      if (covered) {
        m.bar(ax, az, bx, bz, -hr - WALL_T, hl + WALL_T, -SLAB, -0.04, -SLAB, -0.04, C.roof, na, nb);
        prism(-hr - WALL_T, hl + WALL_T, -SLAB, 0, -SLAB, 0);
        // the lamp strip, unlit so the tunnel reads lit whatever the sun does
        lamps.bar(ax, az, bx, bz, -0.18, 0.18, -SLAB - 0.06, -SLAB, -SLAB - 0.06, -SLAB, C.lamp);
        for (const s of [-1, 1]) {
          if (!(r.c[i] & (s > 0 ? 2 : 4))) continue;
          const o = s > 0 ? hl - 0.05 : -hr + 0.05;
          lamps.bar(ax, az, bx, bz, o - 0.06, o + 0.06, Math.min(ha, hb) + 3.2, Math.min(ha, hb) + 3.28, Math.min(ha, hb) + 3.2, Math.min(ha, hb) + 3.28, C.lamp, na, nb);
        }
      }
    }
    const meshes: THREE.Mesh[] = [];
    if (m.pos.length) { const mm = new THREE.Mesh(m.geometry(), mat); mm.name = 'tunnels'; mm.castShadow = true; mm.receiveShadow = true; meshes.push(mm); }
    if (lamps.pos.length) { const mm = new THREE.Mesh(lamps.geometry(), lampMat); mm.name = 'tunnel-lamps'; meshes.push(mm); }
    return { meshes, hulls };
  };
  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const g = groups(CG.WORLD, CG.ALL);
  const live = new Map<string, { meshes: THREE.Mesh[]; colliders: Collider[] }>();
  const build = (k: string) => {
    const { meshes, hulls } = buildCell(k);
    for (const mm of meshes) engine.scene.add(mm);
    const colliders: Collider[] = [];
    for (const h of hulls) {
      const desc = R.ColliderDesc.convexHull(Float32Array.from(h));
      if (!desc) continue;
      const col = world.createCollider(desc.setCollisionGroups(g).setFriction(0.95), body);
      engine.physics.tag(col, { surface: 'concrete', tag: 'tunnel' });
      colliders.push(col);
    }
    live.set(k, { meshes, colliders });
  };
  const drop = (k: string) => {
    const c = live.get(k)!;
    for (const mm of c.meshes) { engine.scene.remove(mm); mm.geometry.dispose(); }
    for (const col of c.colliders) world.removeCollider(col, false);
    live.delete(k);
  };
  let lastX = Infinity, lastZ = Infinity;
  const sys: TunnelApi = {
    name: 'tunnels',
    count: data.t.length,
    built: () => live.size,
    update() {
      const p = engine.camera.position;
      if (Math.abs(p.x - lastX) < 20 && Math.abs(p.z - lastZ) < 20) return;
      lastX = p.x; lastZ = p.z;
      let made = false;
      for (const k of cells.keys()) {
        const [ix, iz] = k.split('_').map(Number);
        const d = Math.hypot((ix + 0.5) * CELL - p.x, (iz + 0.5) * CELL - p.z);
        if (live.has(k)) { if (d > FAR) drop(k); }
        else if (d < NEAR && !made) { build(k); made = true; }
      }
      if (made) lastX = Infinity;
    },
  };
  engine.add(sys);
  return sys;
}

/** The trench rings, grown a little, as clear zones: no street tree, lamp, kerb furniture or building in a trench. */
export function trenchZones(f: TunnelsFile): number[][] {
  return f.holes;
}
