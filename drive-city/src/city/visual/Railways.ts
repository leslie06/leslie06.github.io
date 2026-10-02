import * as THREE from 'three';
import type { Collider } from '@dimforge/rapier3d-compat';
import type { Engine, System } from '../../core/Engine';
import { CG, groups } from '../../core/Physics';
import { inside } from '../Clear';
import { FlatMesh } from './Footbridges';

/** public/city/rail.json (scripts/city/railways.mjs). */
export interface RailFile {
  r: {
    /** 0 main line, 1 subway / light rail, 2 yard, siding or spur. */
    k: number;
    /** Centre line [x, z, ...], a point every 10 m or less. */
    p: number[];
    /** Deck height per point (absent: all on the ground). */
    h?: number[];
    /** Per segment: 1 parapet on the left, 2 on the right, 4 set in a road (a level crossing). */
    e?: number[];
    /** Piers [x, z, deck height, ...]. */
    q?: number[];
  }[];
}

const CELL = 256, NEAR = 700, FAR = 900;
/** Ballast bed: top and foot widths, depth; the track gauge; the deck's width, depth and parapet. */
const BED_TOP = 2.8, BED_FOOT = 3.6, BED_H = 0.3, GAUGE = 1.435, DECK_W = 4.4, DECK_D = 1.3, PARAPET = 0.9;
/** Metres of track the bed texture covers (four sleepers). */
const TEX_LEN = 2.4;
const C = { girder: '#aaa69f', parapet: '#bdb9b1', rail: '#5e5852', head: '#a29d96', pier: '#a39f97', crossing: '#8b8a86' };

/** Ballast with four concrete sleepers, across 0..1 = the bed's top, along 0..1 = TEX_LEN metres. */
function bedTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 128; c.height = 256;
  const g = c.getContext('2d')!;
  const img = g.createImageData(128, 256);
  let seed = 7;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 128 * 256; i++) {
    const v = 92 + rnd() * 50 + (rnd() < 0.08 ? -30 : 0);
    img.data[i * 4] = v + 8; img.data[i * 4 + 1] = v + 2; img.data[i * 4 + 2] = v - 6; img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  for (let k = 0; k < 4; k++) {
    const y = k * 64 + 21;
    g.fillStyle = 'rgba(30,26,22,0.55)'; g.fillRect(8, y + 2, 112, 24);
    g.fillStyle = '#b3afa7'; g.fillRect(8, y, 112, 22);
    g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(8, y + 17, 112, 5);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  return t;
}

/** Textured triangles (the ballast beds). */
class BedMesh {
  pos: number[] = []; uv: number[] = [];
  quad(a: number[], b: number[], c: number[], d: number[], ua: number[], ub: number[], uc: number[], ud: number[]): void {
    for (const [p, u] of [[a, ua], [b, ub], [c, uc], [a, ua], [c, uc], [d, ud]] as const) { this.pos.push(p[0], p[1], p[2]); this.uv.push(u[0], u[1]); }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.computeVertexNormals();
    g.computeBoundingSphere();
    return g;
  }
}

/** The ring each segment keeps clear of street trees, lamps and kerb furniture. */
export function railZones(f: RailFile): number[][] {
  const out: number[][] = [];
  for (const r of f.r) for (let i = 0; i + 3 < r.p.length; i += 2) {
    if ((r.e?.[i / 2] ?? 0) & 4) continue;
    const ax = r.p[i], az = r.p[i + 1], bx = r.p[i + 2], bz = r.p[i + 3], L = Math.hypot(bx - ax, bz - az) || 1;
    const hw = r.h && Math.max(r.h[i / 2], r.h[i / 2 + 1]) > 0.3 ? DECK_W / 2 + 0.6 : BED_FOOT / 2 + 0.4;
    const nx = -(bz - az) / L * hw, nz = (bx - ax) / L * hw;
    out.push([ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz]);
  }
  return out;
}

type Seg = { t: number; i: number };
type ColSpec = { box?: [number, number, number, number, number, number, number]; hull?: number[] };

export interface RailApi extends System {
  readonly tracks: number;
  readonly built: () => number;
}

/**
 * The railways (铁路, 2026-10-02): every track above ground as a ballast bed with concrete sleepers (a
 * repeating texture) and two rails; where the build lifted it, on a concrete deck with parapets on its
 * open sides and piers, the deck closing down to the ground as a solid wall where it is low; where it
 * crosses a road on the level, rails set flush in a concrete crossing. Built per 256 m cell within NEAR
 * of the camera (two meshes a cell: the beds and everything else) and dropped past FAR. Colliders: the
 * piers and the low decks (a car meets the ramp's side, not the bed); tracks inside a landmark's
 * footprint (the stations') are left to the landmark.
 */
export function placeRailways(engine: Engine, data: RailFile, footprints: number[][]): RailApi {
  const bedMat = new THREE.MeshStandardMaterial({ map: bedTexture(), roughness: 0.95 });
  bedMat.userData.wet = 'ground';
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0.1 });
  mat.userData.wet = 'surface';
  // segments by cell, leaving out those in a landmark's footprint
  const fpBox = footprints.map((f) => {
    let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
    for (let i = 0; i < f.length; i += 2) { x0 = Math.min(x0, f[i]); x1 = Math.max(x1, f[i]); z0 = Math.min(z0, f[i + 1]); z1 = Math.max(z1, f[i + 1]); }
    return [x0, z0, x1, z1];
  });
  const inFootprint = (x: number, z: number) => footprints.some((f, k) => { const b = fpBox[k]; return x > b[0] && x < b[2] && z > b[1] && z < b[3] && inside(x, z, f); });
  const cells = new Map<string, Seg[]>();
  const cellPiers = new Map<string, { t: number; j: number }[]>();
  const S = data.r.map((r) => { const s = [0]; for (let i = 2; i < r.p.length; i += 2) s.push(s[s.length - 1] + Math.hypot(r.p[i] - r.p[i - 2], r.p[i + 1] - r.p[i - 1])); return s; });
  const key = (x: number, z: number) => `${Math.floor(x / CELL)}_${Math.floor(z / CELL)}`;
  data.r.forEach((r, t) => {
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const mx = (r.p[i] + r.p[i + 2]) / 2, mz = (r.p[i + 1] + r.p[i + 3]) / 2;
      if (inFootprint(mx, mz)) continue;
      const k = key(mx, mz);
      (cells.get(k) ?? cells.set(k, []).get(k)!).push({ t, i: i / 2 });
    }
    for (let j = 0; r.q && j < r.q.length; j += 3) {
      if (inFootprint(r.q[j], r.q[j + 1])) continue;
      const k = key(r.q[j], r.q[j + 1]);
      (cellPiers.get(k) ?? cellPiers.set(k, []).get(k)!).push({ t, j });
      if (!cells.has(k)) cells.set(k, []);
    }
  });

  const buildCell = (k: string): { meshes: THREE.Mesh[]; cols: ColSpec[] } => {
    const bed = new BedMesh(), m = new FlatMesh(), cols: ColSpec[] = [];
    for (const { t, i } of cells.get(k) ?? []) {
      const r = data.r[t], ax = r.p[i * 2], az = r.p[i * 2 + 1], bx = r.p[i * 2 + 2], bz = r.p[i * 2 + 3];
      const ha = r.h?.[i] ?? 0, hb = r.h?.[i + 1] ?? 0, flags = r.e?.[i] ?? 0;
      const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L;
      const P = (x: number, z: number, o: number, y: number) => [x + nx * o, y, z + nz * o];
      if (flags & 4) {
        // a level crossing: concrete panels flush with the road, the rails set in them
        m.bar(ax, az, bx, bz, -1.5, 1.5, 0.02, 0.045, 0.02, 0.045, C.crossing);
        for (const s of [-1, 1]) m.bar(ax, az, bx, bz, s * GAUGE / 2 - 0.035, s * GAUGE / 2 + 0.035, 0.03, 0.055, 0.03, 0.055, C.head);
        continue;
      }
      const ya = ha + 0.02, yb = hb + 0.02, va = S[t][i] / TEX_LEN, vb = S[t][i + 1] / TEX_LEN;
      // the bed: top textured with the sleepers, sloped sides from the ballast at its edge
      bed.quad(P(ax, az, -BED_TOP / 2, ya + BED_H), P(ax, az, BED_TOP / 2, ya + BED_H), P(bx, bz, BED_TOP / 2, yb + BED_H), P(bx, bz, -BED_TOP / 2, yb + BED_H), [1, va], [0, va], [0, vb], [1, vb]);
      for (const s of [-1, 1]) {
        const top = [P(ax, az, s * BED_TOP / 2, ya + BED_H), P(bx, bz, s * BED_TOP / 2, yb + BED_H)], foot = [P(ax, az, s * BED_FOOT / 2, ya), P(bx, bz, s * BED_FOOT / 2, yb)];
        // wound outwards (+n on the left, -n on the right)
        if (s > 0) bed.quad(foot[0], foot[1], top[1], top[0], [0.02, va], [0.02, vb], [0.03, vb], [0.03, va]);
        else bed.quad(foot[0], top[0], top[1], foot[1], [0.98, va], [0.97, va], [0.97, vb], [0.98, vb]);
      }
      // the rails: a bright head and two dark sides (no ends or underside: 6 triangles each)
      for (const s of [-1, 1]) {
        const o = s * GAUGE / 2, y0a = ya + BED_H, y0b = yb + BED_H, y1a = y0a + 0.16, y1b = y0b + 0.16;
        m.quad(P(ax, az, o - 0.035, y1a), P(ax, az, o + 0.035, y1a), P(bx, bz, o + 0.035, y1b), P(bx, bz, o - 0.035, y1b), C.head);
        m.quad(P(ax, az, o + 0.035, y0a), P(bx, bz, o + 0.035, y0b), P(bx, bz, o + 0.035, y1b), P(ax, az, o + 0.035, y1a), C.rail);
        m.quad(P(ax, az, o - 0.035, y0a), P(ax, az, o - 0.035, y1a), P(bx, bz, o - 0.035, y1b), P(bx, bz, o - 0.035, y0b), C.rail);
      }
      if (Math.max(ha, hb) > 0.3) {
        // the deck: down to the ground where it is low (a wall a car meets), else a girder on piers
        const da = ha - DECK_D < 1 ? 0 : ha - DECK_D, db = hb - DECK_D < 1 ? 0 : hb - DECK_D;
        m.bar(ax, az, bx, bz, -DECK_W / 2, DECK_W / 2, da, ha, db, hb, C.girder);
        if (flags & 1) m.bar(ax, az, bx, bz, DECK_W / 2 - 0.2, DECK_W / 2, ha, ha + PARAPET, hb, hb + PARAPET, C.parapet);
        if (flags & 2) m.bar(ax, az, bx, bz, -DECK_W / 2, -DECK_W / 2 + 0.2, ha, ha + PARAPET, hb, hb + PARAPET, C.parapet);
        if (da === 0 || db === 0) {
          const corners = (x: number, z: number, y: number) => [...P(x, z, DECK_W / 2, 0), ...P(x, z, -DECK_W / 2, 0), ...P(x, z, DECK_W / 2, Math.max(y, 0.05)), ...P(x, z, -DECK_W / 2, Math.max(y, 0.05))];
          if (Math.max(ha, hb) > 0.6) cols.push({ hull: [...corners(ax, az, da === 0 ? ha : 0.05), ...corners(bx, bz, db === 0 ? hb : 0.05)] });
        }
      }
    }
    for (const { t, j } of cellPiers.get(k) ?? []) {
      const r = data.r[t], x = r.q![j], z = r.q![j + 1], h = r.q![j + 2];
      // the pier faces along the nearest segment
      let best = 0, bd = Infinity;
      for (let i = 0; i + 3 < r.p.length; i += 2) { const d = Math.hypot((r.p[i] + r.p[i + 2]) / 2 - x, (r.p[i + 1] + r.p[i + 3]) / 2 - z); if (d < bd) { bd = d; best = i; } }
      const dx = r.p[best + 2] - r.p[best], dz = r.p[best + 3] - r.p[best + 1], L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
      const top = h - DECK_D;
      m.bar(x - ux * 0.5, z - uz * 0.5, x + ux * 0.5, z + uz * 0.5, -0.9, 0.9, 0, top - 0.6, 0, top - 0.6, C.pier);
      m.bar(x - ux * 0.7, z - uz * 0.7, x + ux * 0.7, z + uz * 0.7, -DECK_W / 2 + 0.2, DECK_W / 2 - 0.2, top - 0.6, top, top - 0.6, top, C.pier);
      cols.push({ box: [x, top / 2, z, 0.5, top / 2, 0.9, Math.atan2(dz, dx)] });
    }
    const meshes: THREE.Mesh[] = [];
    if (bed.pos.length) { const mm = new THREE.Mesh(bed.geometry(), bedMat); mm.name = 'rail-bed'; mm.receiveShadow = true; meshes.push(mm); }
    if (m.pos.length) { const mm = new THREE.Mesh(m.geometry(), mat); mm.name = 'rail'; mm.castShadow = true; mm.receiveShadow = true; meshes.push(mm); }
    return { meshes, cols };
  };

  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const g = groups(CG.WORLD, CG.ALL);
  const live = new Map<string, { meshes: THREE.Mesh[]; colliders: Collider[] }>();
  const build = (k: string) => {
    const { meshes, cols } = buildCell(k);
    for (const mm of meshes) engine.scene.add(mm);
    const colliders: Collider[] = [];
    for (const c of cols) {
      let desc;
      if (c.box) {
        const [x, y, z, hx, hy, hz, yaw] = c.box;
        desc = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(-yaw / 2), z: 0, w: Math.cos(-yaw / 2) });
      } else desc = R.ColliderDesc.convexHull(Float32Array.from(c.hull!));
      if (!desc) continue;
      const col = world.createCollider(desc.setCollisionGroups(g), body);
      engine.physics.tag(col, { surface: 'concrete', tag: 'railway' });
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
  const sys: RailApi = {
    name: 'railways',
    tracks: data.r.length,
    built: () => live.size,
    update() {
      const p = engine.camera.position;
      if (Math.abs(p.x - lastX) < 20 && Math.abs(p.z - lastZ) < 20) return;
      lastX = p.x; lastZ = p.z;
      // one new cell a frame at most
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
