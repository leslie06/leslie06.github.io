import * as THREE from 'three';
import type { Engine, System } from '../../core/Engine';
import { CG, groups } from '../../core/Physics';
import type { Collider } from '@dimforge/rapier3d-compat';

/** public/city/footbridges.json (scripts/city/footbridges.mjs). */
export interface FootbridgesFile {
  /** Deck top and the stairs' run. */
  y: number; run: number;
  b: {
    /** Deck centre line [x, z, ...]. */
    p: number[];
    w: number;
    /** Stairs: [deck end 0|1, top x, z, foot x, z]; a landing w square stands past that end of the deck. */
    s: number[][];
    /** Piers [x, z, ...]. */
    q: number[];
    /** 1: a canopy over the deck. */
    r: number;
  }[];
}

const CELL = 256, NEAR = 650, FAR = 850;
const GIRDER = 0.85, RAIL = 1.15, POST_GAP = 2, ROOF_POST = 4.2;
const C = {
  girder: '#c4c9ce', band: '#2f68a6', deck: '#7a6c66', panel: '#99a4ad', post: '#5f6a74', top: '#e3e6e8',
  pier: '#a2aab1', roof: '#4c8cc4', roofPost: '#d9dde0', step: '#8d8a86', nose: '#c9a23a',
};

/** Triangles with flat normals and vertex colours, into growing arrays. */
export class FlatMesh {
  pos: number[] = []; nrm: number[] = []; col: number[] = [];
  private c = new THREE.Color();
  quad(a: number[], b: number[], c: number[], d: number[], colour: string): void {
    const ux = b[0] - a[0], uy = b[1] - a[1], uz = b[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1; nx /= l; ny /= l; nz /= l;
    this.c.set(colour);
    for (const p of [a, b, c, a, c, d]) { this.pos.push(p[0], p[1], p[2]); this.nrm.push(nx, ny, nz); this.col.push(this.c.r, this.c.g, this.c.b); }
  }
  /**
   * A prism along a -> b in plan: across from o0 to o1 (left of the direction), from y0 to y1 at a and
   * y2 to y3 at b (a sloped stringer or rail). All six faces, wound outwards.
   */
  bar(ax: number, az: number, bx: number, bz: number, o0: number, o1: number, y0: number, y1: number, y2: number, y3: number, colour: string, na?: number[], nb?: number[]): void {
    const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L;
    // (`na`/`nb`: the offset directions at each end, for a mitred run of bars; the segment's own normal by default)
    const P = (x: number, z: number, o: number, y: number) => { const n = x === bx && z === bz ? nb : na; return n ? [x + n[0] * o, y, z + n[1] * o] : [x + nx * o, y, z + nz * o]; };
    const a0 = P(ax, az, o0, y0), a1 = P(ax, az, o1, y0), a2 = P(ax, az, o1, y1), a3 = P(ax, az, o0, y1);
    const b0 = P(bx, bz, o0, y2), b1 = P(bx, bz, o1, y2), b2 = P(bx, bz, o1, y3), b3 = P(bx, bz, o0, y3);
    this.quad(a3, a2, b2, b3, colour);   // top
    this.quad(a0, b0, b1, a1, colour);   // bottom
    this.quad(a0, a3, b3, b0, colour);   // side o0
    this.quad(a1, b1, b2, a2, colour);   // side o1
    this.quad(a0, a1, a2, a3, colour);   // end a
    this.quad(b0, b3, b2, b1, colour);   // end b
  }
  /** A column, square in plan, centred on (x, z). */
  column(x: number, z: number, h: number, y0: number, y1: number, colour: string): void { this.bar(x - h, z, x + h, z, -h, h, y0, y1, y0, y1, colour); }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

/** One collider to make: a box (centre, half extents, yaw) or a convex hull, in one of three groups. */
type ColSpec = { box?: [number, number, number, number, number, number, number]; hull?: number[]; group: 'all' | 'walk' | 'car' };

/** The ring a bridge keeps clear of street trees, lamps and kerb furniture: deck, landings and stairs. */
export function footbridgeZones(f: FootbridgesFile): number[][] {
  const out: number[][] = [];
  const rect = (ax: number, az: number, bx: number, bz: number, hw: number) => {
    const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L * hw, nz = (bx - ax) / L * hw;
    return [ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz];
  };
  for (const b of f.b) {
    for (let i = 0; i + 3 < b.p.length; i += 2) out.push(rect(b.p[i], b.p[i + 1], b.p[i + 2], b.p[i + 3], b.w / 2 + 1.5));
    for (const [, sx, sz, fx, fz] of b.s) out.push(rect(sx, sz, fx, fz, b.w / 2 + 0.8));
  }
  return out;
}

/** Whether a guide sign's pole or plate stands within 2.5 m of a deck (it would hang through the girder). */
export function underFootbridge(f: FootbridgesFile, g: { x: number; z: number; yaw: number; reach: number; w: number }): boolean {
  const c = Math.cos(g.yaw), s = Math.sin(g.yaw);
  const pts = [[g.x, g.z], [g.x - g.reach * c, g.z + g.reach * s], [g.x - (g.reach + g.w / 2) * c, g.z + (g.reach + g.w / 2) * s]];
  const sd = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => { const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L)); return Math.hypot(x - ax - vx * t, z - az - vz * t); };
  for (const b of f.b) {
    if (Math.abs(b.p[0] - g.x) > 400 || Math.abs(b.p[1] - g.z) > 400) continue;
    for (let i = 0; i + 3 < b.p.length; i += 2) for (const [x, z] of pts) if (sd(x, z, b.p[i], b.p[i + 1], b.p[i + 2], b.p[i + 3]) < b.w / 2 + 2.5) return true;
  }
  return false;
}

function buildBridge(m: FlatMesh, cols: ColSpec[], b: FootbridgesFile['b'][number], Y: number, run: number): void {
  const hw = b.w / 2, P = b.p, n = P.length / 2;
  const under = Y - GIRDER, top = Y + RAIL;
  const ends = [0, 1].map((k) => {
    const i = k ? n - 1 : 0, j = k ? n - 2 : 1;
    const L = Math.hypot(P[i * 2] - P[j * 2], P[i * 2 + 1] - P[j * 2 + 1]) || 1;
    return { x: P[i * 2], z: P[i * 2 + 1], ox: (P[i * 2] - P[j * 2]) / L, oz: (P[i * 2 + 1] - P[j * 2 + 1]) / L };
  });
  const railRun = (ax: number, az: number, bx: number, bz: number, o: number, ya: number, yb: number, side: number) => {
    // kick plate, mesh panel, top rail on the o side (side = which way is outward)
    const i0 = o - side * 0.06, o0 = Math.min(o, i0), o1 = Math.max(o, i0);
    m.bar(ax, az, bx, bz, o0, o1, ya, ya + 0.22, yb, yb + 0.22, C.girder);
    m.bar(ax, az, bx, bz, o0 + 0.015, o1 - 0.015, ya + 0.22, ya + RAIL - 0.1, yb + 0.22, yb + RAIL - 0.1, C.panel);
    m.bar(ax, az, bx, bz, o0 - 0.02, o1 + 0.02, ya + RAIL - 0.1, ya + RAIL, yb + RAIL - 0.1, yb + RAIL, C.top);
    const L = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.round(L / POST_GAP));
    const nx = -(bz - az) / (L || 1), nz = (bx - ax) / (L || 1);
    for (let i = 0; i <= k; i++) {
      const t = i / k, x = ax + (bx - ax) * t + nx * (o0 + o1) / 2, z = az + (bz - az) * t + nz * (o0 + o1) / 2, y = ya + (yb - ya) * t;
      m.column(x, z, 0.05, y, y + RAIL + 0.04, C.post);
    }
  };
  const box = (ax: number, az: number, bx: number, bz: number, o0: number, o1: number, y0: number, y1: number, group: ColSpec['group']) => {
    const L = Math.hypot(bx - ax, bz - az) || 1, nx = -(bz - az) / L, nz = (bx - ax) / L, om = (o0 + o1) / 2;
    cols.push({ box: [(ax + bx) / 2 + nx * om, (y0 + y1) / 2, (az + bz) / 2 + nz * om, L / 2, (y1 - y0) / 2, (o1 - o0) / 2, Math.atan2(bz - az, bx - ax)], group });
  };

  // --- the deck
  for (let i = 0; i + 1 < n; i++) {
    const ax = P[i * 2], az = P[i * 2 + 1], bx = P[i * 2 + 2], bz = P[i * 2 + 3];
    m.bar(ax, az, bx, bz, -hw - 0.1, hw + 0.1, under, Y - 0.12, under, Y - 0.12, C.girder);
    for (const s of [-1, 1]) m.bar(ax, az, bx, bz, s > 0 ? hw + 0.1 : -hw - 0.13, s > 0 ? hw + 0.13 : -hw - 0.1, under + 0.3, Y - 0.2, under + 0.3, Y - 0.2, C.band);
    m.bar(ax, az, bx, bz, -hw, hw, Y - 0.12, Y, Y - 0.12, Y, C.deck);
    for (const s of [-1, 1]) railRun(ax, az, bx, bz, s * hw, Y, Y, s);
    box(ax, az, bx, bz, -hw - 0.1, hw + 0.1, under, Y, 'all');
    for (const s of [-1, 1]) box(ax, az, bx, bz, s * hw - 0.06, s * hw + 0.06, Y, top, 'all');
    // a square pad over each bend
    if (i > 0) m.bar(ax - hw, az, ax + hw, az, -hw, hw, Y - 0.13, Y - 0.01, Y - 0.13, Y - 0.01, C.deck);
    // the canopy: posts on both edges and an arched roof of five strips
    if (b.r) {
      const L = Math.hypot(bx - ax, bz - az), k = Math.max(1, Math.round(L / ROOF_POST)), nx = -(bz - az) / (L || 1), nz = (bx - ax) / (L || 1);
      for (let j = 0; j <= k; j++) for (const s of [-1, 1]) {
        const t = j / k;
        m.column(ax + (bx - ax) * t + nx * s * (hw - 0.03), az + (bz - az) * t + nz * s * (hw - 0.03), 0.06, top, Y + 2.75, C.roofPost);
      }
      const arch = (u: number) => Y + 2.75 + 0.55 * (1 - u * u);
      for (let j = 0; j < 5; j++) {
        const u0 = -1 + j * 0.4, u1 = u0 + 0.4;
        m.bar(ax, az, bx, bz, u0 * (hw + 0.25), u1 * (hw + 0.25), arch(u0), arch(u0) + 0.06, arch(u0), arch(u0) + 0.06, C.roof);
        // the strip's top follows the arch (its far edge raised to the next point)
        m.quad([ax + nx * u0 * (hw + 0.25), arch(u0) + 0.07, az + nz * u0 * (hw + 0.25)], [ax + nx * u1 * (hw + 0.25), arch(u1) + 0.07, az + nz * u1 * (hw + 0.25)],
          [bx + nx * u1 * (hw + 0.25), arch(u1) + 0.07, bz + nz * u1 * (hw + 0.25)], [bx + nx * u0 * (hw + 0.25), arch(u0) + 0.07, bz + nz * u0 * (hw + 0.25)], C.roof);
      }
    }
  }

  // --- piers: a column and a cross head under the girder
  for (let i = 0; i + 1 < b.q.length; i += 2) {
    const x = b.q[i], z = b.q[i + 1];
    let best = 0, bd = Infinity;
    for (let k = 0; k + 1 < n; k++) { const d = Math.hypot(P[k * 2] - x, P[k * 2 + 1] - z) + Math.hypot(P[k * 2 + 2] - x, P[k * 2 + 3] - z); if (d < bd) { bd = d; best = k; } }
    const dx = P[best * 2 + 2] - P[best * 2], dz = P[best * 2 + 3] - P[best * 2 + 1], L = Math.hypot(dx, dz) || 1;
    m.column(x, z, 0.32, 0, under, C.pier);
    m.bar(x - dx / L * 0.4, z - dz / L * 0.4, x + dx / L * 0.4, z + dz / L * 0.4, -hw - 0.1, hw + 0.1, under - 0.45, under, under - 0.45, under, C.pier);
    cols.push({ box: [x, under / 2, z, 0.34, under / 2, 0.34, 0], group: 'all' });
  }

  // --- landings past the free ends, and the stairs
  for (const [k, sx, sz, fx, fz] of b.s) {
    const e = ends[k], cx = e.x + e.ox * hw, cz = e.z + e.oz * hw;
    const ax = e.x, az = e.z, bx = e.x + e.ox * b.w, bz = e.z + e.oz * b.w;
    m.bar(ax, az, bx, bz, -hw - 0.1, hw + 0.1, under, Y - 0.12, under, Y - 0.12, C.girder);
    m.bar(ax, az, bx, bz, -hw, hw, Y - 0.12, Y, Y - 0.12, Y, C.deck);
    m.column(cx, cz, 0.3, 0, under, C.pier);
    box(ax, az, bx, bz, -hw - 0.1, hw + 0.1, under, Y, 'all');
    cols.push({ box: [cx, under / 2, cz, 0.32, under / 2, 0.32, 0], group: 'all' });
    const L = Math.hypot(fx - sx, fz - sz) || 1, dx = (fx - sx) / L, dz = (fz - sz) / L;
    // the landing's railings on the sides the deck does not come in by and the stair does not leave by
    const px = -e.oz, pz = e.ox;   // left of the deck's way out
    const sides = [{ nx: e.ox, nz: e.oz }, { nx: px, nz: pz }, { nx: -px, nz: -pz }];
    let leave = 0, bestDot = -Infinity;
    sides.forEach((s, i) => { const d = s.nx * dx + s.nz * dz; if (d > bestDot) { bestDot = d; leave = i; } });
    sides.forEach((s, i) => {
      if (i === leave) return;
      // the side as a segment, run so that its left is the landing's inside
      const mx = cx + s.nx * hw, mz = cz + s.nz * hw, tx = -s.nz * hw, tz = s.nx * hw;
      railRun(mx - tx, mz - tz, mx + tx, mz + tz, 0, Y, Y, -1);
      box(mx - tx, mz - tz, mx + tx, mz + tz, -0.06, 0.06, Y, top, 'all');
    });
    // two flights and a landing halfway, steps as blocks, stringers and railings either side
    const rise = Y, half = (run - 2) / 2, steps = Math.round(rise / 2 / 0.15), tread = half / steps, sh = rise / 2 / steps;
    const at = (s: number) => [sx + dx * s, sz + dz * s];
    const flight = (s0: number, y0: number) => {
      for (let i = 0; i < steps; i++) {
        const [ax2, az2] = at(s0 + i * tread), [bx2, bz2] = at(s0 + (i + 1) * tread), yt = y0 - (i + 1) * sh;
        m.bar(ax2, az2, bx2, bz2, -hw + 0.12, hw - 0.12, yt - 0.3, yt, yt - 0.3, yt, C.step);
        m.bar(ax2, az2, ax2 + dx * 0.05, az2 + dz * 0.05, -hw + 0.12, hw - 0.12, yt - 0.01, yt + 0.004, yt - 0.01, yt + 0.004, C.nose);
      }
      const [ax2, az2] = at(s0), [bx2, bz2] = at(s0 + half), y1 = y0 - rise / 2;
      for (const s of [-1, 1]) {
        m.bar(ax2, az2, bx2, bz2, s > 0 ? hw - 0.12 : -hw, s > 0 ? hw : -hw + 0.12, y0 - 0.55, y0 + 0.12, y1 - 0.55, y1 + 0.12, C.girder);
        railRun(ax2, az2, bx2, bz2, s * hw, y0 + 0.12, y1 + 0.12, s);
      }
      // walk-only ramp from the ground (people climb it), and a car-only block that a car meets as a face
      const corners = (s: number, y: number, yb: number) => { const [x, z] = at(s); return [x - dz * hw, yb, z + dx * hw, x + dz * hw, yb, z - dx * hw, x - dz * hw, y, z + dx * hw, x + dz * hw, y, z - dx * hw]; };
      cols.push({ hull: [...corners(s0, y0, 0), ...corners(s0 + half, y1, 0)], group: 'walk' });
      cols.push({ hull: [...corners(s0, y0, 0), ...corners(s0 + half, Math.max(y1, 0.9), 0)], group: 'car' });
    };
    flight(0, Y);
    const [lx0, lz0] = at(half), [lx1, lz1] = at(half + 2), ly = Y / 2;
    m.bar(lx0, lz0, lx1, lz1, -hw, hw, ly - 0.3, ly, ly - 0.3, ly, C.step);
    for (const s of [-1, 1]) { m.column(lx1 - dz * s * (hw - 0.3), lz1 + dx * s * (hw - 0.3), 0.15, 0, ly - 0.3, C.pier); railRun(lx0, lz0, lx1, lz1, s * hw, ly, ly, s); }
    box(lx0, lz0, lx1, lz1, -hw, hw, 0, ly, 'walk');
    box(lx0, lz0, lx1, lz1, -hw, hw, 0, ly, 'car');
    flight(half + 2, ly);
  }
}

export interface FootbridgeApi extends System {
  readonly count: number;
  /** Cells built right now (for probes). */
  readonly built: () => number;
}

/**
 * The footbridges (过街天桥, 2026-10-02): a steel deck at `y` on piers off the carriageways, a blue
 * band along the girder, mesh-panel railings, a canopy on some; a square landing past each free end
 * and two flights with a landing down to the pavement. Built per 256 m cell when the camera comes
 * within NEAR (one vertex-coloured mesh per cell, its colliders with it) and dropped past FAR. People
 * walk up the stairs (walk-only ramps) and across the deck; a car meets the stairs' foot as a face.
 */
export function placeFootbridges(engine: Engine, data: FootbridgesFile): FootbridgeApi {
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6, metalness: 0.25 });
  mat.userData.wet = 'surface';
  const cells = new Map<string, number[]>();
  data.b.forEach((b, i) => {
    let cx = 0, cz = 0;
    for (let k = 0; k < b.p.length; k += 2) { cx += b.p[k]; cz += b.p[k + 1]; }
    const k = `${Math.floor(cx / (b.p.length / 2) / CELL)}_${Math.floor(cz / (b.p.length / 2) / CELL)}`;
    (cells.get(k) ?? cells.set(k, []).get(k)!).push(i);
  });
  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const gAll = groups(CG.WORLD, CG.ALL), gWalk = groups(CG.WORLD, CG.ALL & ~CG.CAR), gCar = groups(CG.WORLD, CG.CAR);
  const live = new Map<string, { mesh: THREE.Mesh; colliders: Collider[] }>();
  const build = (key: string) => {
    const m = new FlatMesh(), cols: ColSpec[] = [];
    for (const i of cells.get(key)!) buildBridge(m, cols, data.b[i], data.y, data.run);
    const mesh = new THREE.Mesh(m.geometry(), mat);
    mesh.name = 'footbridges';
    mesh.castShadow = true; mesh.receiveShadow = true;
    engine.scene.add(mesh);
    const colliders: Collider[] = [];
    for (const c of cols) {
      let desc: ReturnType<typeof R.ColliderDesc.cuboid> | null;
      if (c.box) {
        const [x, y, z, hx, hy, hz, yaw] = c.box;
        desc = R.ColliderDesc.cuboid(hx, hy, hz).setTranslation(x, y, z).setRotation({ x: 0, y: Math.sin(-yaw / 2), z: 0, w: Math.cos(-yaw / 2) });
      } else desc = R.ColliderDesc.convexHull(Float32Array.from(c.hull!));
      if (!desc) continue;
      const col = world.createCollider(desc.setCollisionGroups(c.group === 'walk' ? gWalk : c.group === 'car' ? gCar : gAll).setFriction(0.7), body);
      engine.physics.tag(col, { surface: 'metal', tag: 'footbridge' });
      colliders.push(col);
    }
    live.set(key, { mesh, colliders });
  };
  const drop = (key: string) => {
    const c = live.get(key)!;
    engine.scene.remove(c.mesh);
    c.mesh.geometry.dispose();
    for (const col of c.colliders) world.removeCollider(col, false);
    live.delete(key);
  };
  let lastX = Infinity, lastZ = Infinity;
  const sys: FootbridgeApi = {
    name: 'footbridges',
    count: data.b.length,
    built: () => live.size,
    update() {
      const p = engine.camera.position;
      if (Math.abs(p.x - lastX) < 20 && Math.abs(p.z - lastZ) < 20) return;
      lastX = p.x; lastZ = p.z;
      // one new cell a frame at most: a cell is a few bridges, a few ms
      let made = false;
      for (const key of cells.keys()) {
        const [ix, iz] = key.split('_').map(Number);
        const d = Math.hypot((ix + 0.5) * CELL - p.x, (iz + 0.5) * CELL - p.z);
        if (live.has(key)) { if (d > FAR) drop(key); }
        else if (d < NEAR && !made) { build(key); made = true; }
      }
      if (made) lastX = Infinity;   // come back next frame for the rest
    },
  };
  engine.add(sys);
  return sys;
}
