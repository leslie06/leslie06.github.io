import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { describe, it, expect } from 'vitest';
import type { RoadPiece } from '../city/Data';
import { project } from '../city/Geo';
import { LANDMARKS } from '../city/landmarks';
import { placeFurniture } from '../city/visual/StreetFurniture';
import type { Network } from '../city/Data';
import { LaneGraph } from '../traffic/LaneGraph';
import { Router } from '../nav/Router';
import { OVERPASS, UNDERGROUND } from './Structures';

/**
 * Picks where the stunt ramps and the 兔儿爷 collectibles go, from the real tiles, and writes
 * `src/stunts/spots.ts`. Run it after rebuilding the city:
 *
 *   GEN=1 npx vitest run src/stunts/Spots.gen.test.ts
 *
 * The core of the map (the spawn, 国贸, 建国门 and the lanes round them) gets the density; the rest
 * of the 78 km² stays scenery. A ramp needs a straight run-up, the ramp and a landing, 9 m wide,
 * clear of every building, tree, lamp, signal and piece of street furniture (the furniture is
 * placed at runtime from the roads, so it is placed here the same way); the ramp and the landing
 * must also be off the carriageways, so traffic never meets one. Collectibles stand on the kerb of
 * the smaller streets and lanes, spread out by farthest-point sampling.
 */
const CORE = { x0: 2600, x1: 6400, z0: -900, z1: 1300 };
const TILE = 256;
const RUNUP = 55, RAMP = 9, LAND = 45, HALF_W = 4.5;
const JUMPS = 10, JUMP_APART = 250;
const RABBITS = 25, RABBIT_APART = 160;

interface Tile { roads: RoadPiece[]; buildings: { o: number[] }[]; areas: { k: string; o: number[] }[]; trees: number[]; lamps: number[]; signals: number[]; crossings: number[]; stops: number[] }

const inPoly = (x: number, z: number, o: number[]) => {
  let inside = false;
  for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) {
    const xi = o[i], zi = o[i + 1], xj = o[j], zj = o[j + 1];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) inside = !inside;
  }
  return inside;
};
const segDist = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
  const vx = bx - ax, vz = bz - az, L2 = vx * vx + vz * vz || 1, u = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2));
  return Math.hypot(x - ax - vx * u, z - az - vz * u);
};

describe.skipIf(!process.env.GEN)('stunt spots', () => {
  it('writes src/stunts/spots.ts', () => {
    const tiles: Tile[] = [];
    for (let ix = Math.floor(CORE.x0 / TILE) - 1; ix <= Math.floor(CORE.x1 / TILE) + 1; ix++) {
      for (let iz = Math.floor(CORE.z0 / TILE) - 1; iz <= Math.floor(CORE.z1 / TILE) + 1; iz++) {
        const f = `public/city/t_${ix}_${iz}.json`;
        if (existsSync(f)) tiles.push(JSON.parse(readFileSync(f, 'utf8')) as Tile);
      }
    }
    // Everything a car must not meet, as points with a radius (poles, trunks, furniture) and polygons (buildings).
    const polys: { o: number[]; x0: number; x1: number; z0: number; z1: number }[] = [];
    const posts: number[] = [];
    /** Tall poles (lamps, signal masts): what a car flying over a road would still hit. */
    const poles: number[] = [];
    const roads: { p: number[]; hw: number; car: boolean; cls: string }[] = [];
    const CAR = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link', 'primary', 'primary_link', 'secondary', 'secondary_link', 'tertiary', 'tertiary_link', 'unclassified', 'residential', 'living_street', 'service', 'busway']);
    const areaPolys: { o: number[]; x0: number; x1: number; z0: number; z1: number }[] = [];
    for (const t of tiles) {
      for (const a of t.areas) if (a.k !== 'water') {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < a.o.length; i += 2) { x0 = Math.min(x0, a.o[i]); x1 = Math.max(x1, a.o[i]); z0 = Math.min(z0, a.o[i + 1]); z1 = Math.max(z1, a.o[i + 1]); }
        areaPolys.push({ o: a.o, x0, x1, z0, z1 });
      }
      for (const b of t.buildings) {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < b.o.length; i += 2) { x0 = Math.min(x0, b.o[i]); x1 = Math.max(x1, b.o[i]); z0 = Math.min(z0, b.o[i + 1]); z1 = Math.max(z1, b.o[i + 1]); }
        polys.push({ o: b.o, x0, x1, z0, z1 });
      }
      for (const a of t.areas) if (a.k === 'water') {
        let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
        for (let i = 0; i < a.o.length; i += 2) { x0 = Math.min(x0, a.o[i]); x1 = Math.max(x1, a.o[i]); z0 = Math.min(z0, a.o[i + 1]); z1 = Math.max(z1, a.o[i + 1]); }
        polys.push({ o: a.o, x0, x1, z0, z1 });
      }
      for (let i = 0; i < t.trees.length; i += 4) posts.push(t.trees[i], t.trees[i + 1], 1.2);
      for (let i = 0; i < t.lamps.length; i += 3) { posts.push(t.lamps[i], t.lamps[i + 1], 0.8); poles.push(t.lamps[i], t.lamps[i + 1]); }
      for (let i = 0; i < t.signals.length; i += 2) { posts.push(t.signals[i], t.signals[i + 1], 3); poles.push(t.signals[i], t.signals[i + 1]); }
      const f = placeFurniture(t.roads, t.crossings, t.stops);
      for (let i = 0; i < f.rail.length; i += 5) for (let k = 0; k <= 3; k++) posts.push(f.rail[i] + Math.cos(f.rail[i + 3]) * k, f.rail[i + 2] - Math.sin(f.rail[i + 3]) * k, 0.6);
      for (let i = 0; i < f.shelter.length; i += 4) posts.push(f.shelter[i], f.shelter[i + 2], 5);
      for (let i = 0; i < f.bin.length; i += 4) posts.push(f.bin[i], f.bin[i + 2], 1);
      for (let i = 0; i < f.bike.length; i += 5) posts.push(f.bike[i], f.bike[i + 2], 1.2);
      for (const r of t.roads) roads.push({ p: r.p, hw: r.w / 2, car: CAR.has(r.c), cls: r.c });
    }
    const marks = LANDMARKS.map((l) => project(l.lat, l.lon));
    // Spatial hash (8 m cells): polygons and road segments by their bounds, posts by their centre.
    const CELL = 8, key = (cx: number, cz: number) => cx * 100003 + cz;
    const grid = new Map<number, { polys: number[]; posts: number[]; segs: number[] }>();
    const cell = (cx: number, cz: number) => { const k = key(cx, cz); let c = grid.get(k); if (!c) { c = { polys: [], posts: [], segs: [] }; grid.set(k, c); } return c; };
    const cover = (x0: number, z0: number, x1: number, z1: number, fn: (c: { polys: number[]; posts: number[]; segs: number[] }) => void) => {
      for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++) for (let cz = Math.floor(z0 / CELL); cz <= Math.floor(z1 / CELL); cz++) fn(cell(cx, cz));
    };
    polys.forEach((p, i) => { if (p.x1 - p.x0 < 3000 && p.z1 - p.z0 < 3000) cover(p.x0, p.z0, p.x1, p.z1, (c) => c.polys.push(i)); });
    for (let i = 0; i < posts.length; i += 3) cover(posts[i] - posts[i + 2] - 1.5, posts[i + 1] - posts[i + 2] - 1.5, posts[i] + posts[i + 2] + 1.5, posts[i + 1] + posts[i + 2] + 1.5, (c) => c.posts.push(i));
    const segs: number[] = [];   // ax, az, bx, bz, hw
    for (const r of roads) if (r.car) for (let i = 2; i < r.p.length; i += 2) {
      const n = segs.length; segs.push(r.p[i - 2], r.p[i - 1], r.p[i], r.p[i + 1], r.hw);
      const m = r.hw + 1.5;
      cover(Math.min(r.p[i - 2], r.p[i]) - m, Math.min(r.p[i - 1], r.p[i + 1]) - m, Math.max(r.p[i - 2], r.p[i]) + m, Math.max(r.p[i - 1], r.p[i + 1]) + m, (c) => c.segs.push(n));
    }
    const blocked = (x: number, z: number, onRoadOk: boolean) => {
      for (const [lx, lz] of marks) if (Math.hypot(x - lx, z - lz) < 150) return true;
      const c = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!c) return false;
      for (const i of c.polys) { const p = polys[i]; if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1 && inPoly(x, z, p.o)) return true; }
      for (const i of c.posts) if (Math.hypot(posts[i] - x, posts[i + 1] - z) < posts[i + 2] + 1.5) return true;
      if (!onRoadOk) for (const i of c.segs) if (segDist(x, z, segs[i], segs[i + 1], segs[i + 2], segs[i + 3]) < segs[i + 4] + 1.5) return true;
      return false;
    };
    // Big polygons (a park's outline) skipped by the hash are water only; check those directly.
    const bigWater = polys.filter((p) => p.x1 - p.x0 >= 3000 || p.z1 - p.z0 >= 3000);
    const blocked0 = blocked;
    const blockedAll = (x: number, z: number, onRoadOk: boolean) => blocked0(x, z, onRoadOk) || bigWater.some((p) => inPoly(x, z, p.o));

    // --- ramps --------------------------------------------------------------------------------------
    const man = JSON.parse(readFileSync('public/city/manifest.json', 'utf8')) as { spawn: { x: number; z: number } };
    const spawn = [man.spawn.x, man.spawn.z];
    const cands: { x: number; z: number; yaw: number; score: number }[] = [];
    for (let x = CORE.x0; x <= CORE.x1; x += 12) for (let z = CORE.z0; z <= CORE.z1; z += 12) {
      if (blockedAll(x, z, false)) continue;
      for (let k = 0; k < 8; k++) {
        const yaw = k * Math.PI / 4, dx = Math.sin(yaw), dz = Math.cos(yaw), lx = dz, lz = -dx;
        let ok = true;
        // The ramp's foot is at (x, z); it rises over RAMP metres along (dx, dz); the landing follows.
        for (let s = -RUNUP; s <= RAMP + LAND && ok; s += 3) {
          for (let w = -HALF_W; w <= HALF_W && ok; w += 3) {
            if (blockedAll(x + dx * s + lx * w, z + dz * s + lz * w, s < -2)) ok = false;
          }
        }
        if (ok) cands.push({ x, z, yaw, score: -Math.hypot(x - spawn[0], z - spawn[1]) });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    const jumps: { x: number; z: number; yaw: number }[] = [];
    for (const c of cands) {
      if (jumps.length >= JUMPS) break;
      if (jumps.some((j) => Math.hypot(j.x - c.x, j.z - c.z) < JUMP_APART)) continue;
      jumps.push({ x: c.x, z: c.z, yaw: +c.yaw.toFixed(4) });
    }

    // --- 兔儿爷 ----------------------------------------------------------------------------------------
    const SMALL = new Set(['residential', 'living_street', 'service', 'unclassified', 'pedestrian', 'footway']);
    const spots: { x: number; z: number }[] = [];
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (const r of roads) {
      if (!SMALL.has(r.cls)) continue;
      for (let i = 2; i < r.p.length; i += 2) {
        const ax = r.p[i - 2], az = r.p[i - 1], bx = r.p[i], bz = r.p[i + 1], L = Math.hypot(bx - ax, bz - az);
        if (L < 12) continue;
        const u = 0.2 + rnd() * 0.6, nx = -(bz - az) / L, nz = (bx - ax) / L, side = rnd() < 0.5 ? 1 : -1;
        const x = ax + (bx - ax) * u + nx * side * (r.hw + 1.4), z = az + (bz - az) * u + nz * side * (r.hw + 1.4);
        if (x < CORE.x0 || x > CORE.x1 || z < CORE.z0 || z > CORE.z1) continue;
        if (!blockedAll(x, z, true)) spots.push({ x: +x.toFixed(1), z: +z.toFixed(1) });
      }
    }
    // Farthest-point sampling from the spawn: evenly spread, the first few close to where you start.
    const rabbits: { x: number; z: number }[] = [];
    let best = spots.reduce((a, b) => (Math.hypot(b.x - spawn[0], b.z - spawn[1]) < Math.hypot(a.x - spawn[0], a.z - spawn[1]) ? b : a));
    while (rabbits.length < RABBITS && best) {
      rabbits.push(best);
      let bd = -1, next: typeof best | null = null;
      for (const s of spots) {
        const d = Math.min(...rabbits.map((r) => Math.hypot(r.x - s.x, r.z - s.z)));
        if (d > bd) { bd = d; next = s; }
      }
      if (!next || bd < RABBIT_APART) break;
      best = next;
    }

    // Whether (x, z) is on a carriageway (road surface cars use).
    const onRoad = (x: number, z: number) => {
      const c = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!c) return false;
      for (const i of c.segs) if (segDist(x, z, segs[i], segs[i + 1], segs[i + 2], segs[i + 3]) < segs[i + 4]) return true;
      return false;
    };
    /** Only what reaches up to a flying car: buildings, lamp posts and signal masts (tree trunks stop at 3.2 m). */
    const tall = (x: number, z: number) => {
      const c = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (c) for (const i of c.polys) { const p = polys[i]; if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1 && inPoly(x, z, p.o)) return true; }
      for (let i = 0; i < poles.length; i += 2) if (Math.abs(poles[i] - x) < 2.5 && Math.abs(poles[i + 1] - z) < 2.5) return true;
      return marks.some(([lx, lz]) => Math.hypot(x - lx, z - lz) < 150) || bigWater.some((p) => inPoly(x, z, p.o));
    };
    const taken: { x: number; z: number; r: number }[] = jumps.map((j) => ({ x: j.x, z: j.z, r: 90 }));
    const free = (x: number, z: number, r: number) => taken.every((q) => Math.hypot(q.x - x, q.z - z) > q.r + r);
    /** Every point of a strip along `yaw` from `s0` to `s1` metres, `hw` either side of (x, z), passes `ok`. */
    const strip = (x: number, z: number, yaw: number, s0: number, s1: number, hw: number, ok: (px: number, pz: number) => boolean) => {
      const dx = Math.sin(yaw), dz = Math.cos(yaw), lx = dz, lz = -dx;
      for (let s = s0; s <= s1; s += 3) for (let w = -hw; w <= hw; w += Math.max(1, hw / 2)) if (!ok(x + dx * s + lx * w, z + dz * s + lz * w)) return false;
      return true;
    };

    // --- overpass flights: an embankment and a deck up to the edge of a road, the road, a landing ----
    const O = OVERPASS, lipAt = O.ramp + O.deck;
    const overs: { x: number; z: number; yaw: number; gap: number; score: number }[] = [];
    for (let x = CORE.x0; x <= CORE.x1; x += 16) for (let z = CORE.z0; z <= CORE.z1; z += 16) {
      if (blockedAll(x, z, false)) continue;
      for (let k = 0; k < 8; k++) {
        const yaw = k * Math.PI / 4, dx = Math.sin(yaw), dz = Math.cos(yaw);
        if (!strip(x, z, yaw, -10, O.ramp, O.w / 2 + 1, (px, pz) => !blockedAll(px, pz, false))) continue;
        // A run-up: the flight wants ~100 km/h at the lip, and a building 43 m short of the foot left no room to find it.
        if (!strip(x, z, yaw, -70, -10, 3, (px, pz) => !blockedAll(px, pz, false))) continue;
        if (!strip(x, z, yaw, O.ramp, lipAt, O.w / 2 + 1, (px, pz) => !tall(px, pz) && !onRoad(px, pz))) continue;
        // A road within 14 m past the lip (a pavement and its trees may come first); across it, open ground.
        let s = lipAt;
        while (s < lipAt + 14 && !onRoad(x + dx * s, z + dz * s)) s += 2;
        if (!onRoad(x + dx * s, z + dz * s)) continue;
        while (s < lipAt + 50 && (onRoad(x + dx * s, z + dz * s) || blockedAll(x + dx * s, z + dz * s, false))) s += 2;
        const gap = s - lipAt;
        if (gap < 12 || gap > 48) continue;
        if (!strip(x, z, yaw, lipAt, lipAt + gap, 3, (px, pz) => !tall(px, pz))) continue;
        if (!strip(x, z, yaw, lipAt + gap, lipAt + gap + O.land + 30, O.w / 2 + 1, (px, pz) => !blockedAll(px, pz, false))) continue;
        overs.push({ x, z, yaw, gap: Math.ceil(gap), score: -Math.hypot(x - spawn[0], z - spawn[1]) - Math.abs(gap - 24) * 8 });
      }
    }
    overs.sort((a, b) => b.score - a.score);
    const overpasses: { x: number; z: number; yaw: number; gap: number }[] = [];
    for (const o of overs) {
      if (overpasses.length >= 3) break;
      const cx = o.x + Math.sin(o.yaw) * lipAt, cz = o.z + Math.cos(o.yaw) * lipAt;
      if (!free(cx, cz, 120) || overpasses.some((q) => Math.hypot(q.x - o.x, q.z - o.z) < 400)) continue;
      overpasses.push({ x: o.x, z: o.z, yaw: +o.yaw.toFixed(4), gap: o.gap });
      taken.push({ x: cx, z: cz, r: 120 });
    }

    // --- the underground car park: a ramp down, a hall under a slab, on open ground ---------------------
    const U = UNDERGROUND, total = U.ramp + U.hall;
    const inArea = (x: number, z: number) => areaPolys.some((p) => x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1 && inPoly(x, z, p.o));
    let under: { x: number; z: number; yaw: number } | null = null, underScore = -Infinity;
    for (let x = CORE.x0; x <= CORE.x1; x += 8) for (let z = CORE.z0; z <= CORE.z1; z += 8) {
      if (blockedAll(x, z, false)) continue;
      // Square to the axes only: the ground's hole is cut as axis-aligned boxes.
      for (let k = 0; k < 8; k += 2) {
        const yaw = k * Math.PI / 4;
        if (!free(x, z, total + 20)) continue;
        // The approach and the whole footprint clear; the open ramp also off every ground patch (grass,
        // car park paint), which is drawn on top of the ground and would lie over the hole.
        if (!strip(x, z, yaw, -12, 0, U.rampW / 2 + 1, (px, pz) => !blockedAll(px, pz, true))) continue;
        if (!strip(x, z, yaw, 0, U.ramp, U.rampW / 2 + 1.5, (px, pz) => !blockedAll(px, pz, false) && !inArea(px, pz))) continue;
        if (!strip(x, z, yaw, U.ramp, total + 2, U.hallW / 2 + 2, (px, pz) => !blockedAll(px, pz, false))) continue;
        const sc = -Math.hypot(x - spawn[0], z - spawn[1]);
        if (sc > underScore) { underScore = sc; under = { x, z, yaw: +yaw.toFixed(4) }; }
      }
    }
    if (under) taken.push({ x: under.x, z: under.z, r: total + 20 });

    // --- hutong shortcuts: footpaths through a block that a car could take, far shorter than the road ---
    const net = JSON.parse(readFileSync('public/city/network.json', 'utf8')) as Network;
    const router = new Router(new LaneGraph(net));
    const PATHS = new Set(['footway', 'path', 'pedestrian', 'cycleway']);
    const nearCarRoad = (x: number, z: number, r: number) => {
      for (let cx = Math.floor((x - r) / CELL); cx <= Math.floor((x + r) / CELL); cx++) for (let cz = Math.floor((z - r) / CELL); cz <= Math.floor((z + r) / CELL); cz++) {
        const c = grid.get(key(cx, cz));
        if (c) for (const i of c.segs) if (segDist(x, z, segs[i], segs[i + 1], segs[i + 2], segs[i + 3]) < segs[i + 4] + r) return true;
      }
      return false;
    };
    /** Something a car's body would hit at (x, z): a building, or a post within its own radius + 0.3 m. */
    const roomy = (x: number, z: number) => {
      const c = grid.get(key(Math.floor(x / CELL), Math.floor(z / CELL)));
      if (!c) return false;
      for (const i of c.polys) { const p = polys[i]; if (x > p.x0 && x < p.x1 && z > p.z0 && z < p.z1 && inPoly(x, z, p.o)) return true; }
      for (const i of c.posts) if (Math.hypot(posts[i] - x, posts[i + 1] - z) < Math.min(posts[i + 2], 1.2) + 0.3) return true;
      return false;
    };
    const cuts: { p: number[]; len: number; saves: number }[] = [];
    for (const r of roads) {
      if (!PATHS.has(r.cls) || r.p.length < 4) continue;
      let len = 0;
      for (let i = 2; i < r.p.length; i += 2) len += Math.hypot(r.p[i] - r.p[i - 2], r.p[i + 1] - r.p[i - 1]);
      if (len < 35 || len > 260) continue;
      const ax = r.p[0], az = r.p[1], bx = r.p[r.p.length - 2], bz = r.p[r.p.length - 1];
      if (ax < CORE.x0 || ax > CORE.x1 || az < CORE.z0 || az > CORE.z1) continue;
      // Drivable at speed: no turn sharper than 55 degrees between legs of 2 m or more, and mostly
      // straight overall (a zigzag of right angles through a courtyard is not a shortcut).
      if (Math.hypot(bx - ax, bz - az) < len * 0.7) continue;
      let sharp = false, px = NaN, pz = NaN;
      for (let i = 2; i < r.p.length; i += 2) {
        const dx = r.p[i] - r.p[i - 2], dz = r.p[i + 1] - r.p[i - 1], L = Math.hypot(dx, dz);
        if (L < 2) continue;
        if (!Number.isNaN(px) && (px * dx + pz * dz) / L < Math.cos(55 * Math.PI / 180)) sharp = true;
        px = dx / L; pz = dz / L;
      }
      if (sharp) continue;
      if (!nearCarRoad(ax, az, 12) || !nearCarRoad(bx, bz, 12)) continue;
      // A car fits all the way: nothing within 2 m of the line but the streets it joins.
      let ok = true;
      for (let i = 2; i < r.p.length && ok; i += 2) {
        const L = Math.hypot(r.p[i] - r.p[i - 2], r.p[i + 1] - r.p[i - 1]);
        for (let s = 0; s <= L && ok; s += 2) {
          const u = s / (L || 1), x = r.p[i - 2] + (r.p[i] - r.p[i - 2]) * u, z = r.p[i - 1] + (r.p[i + 1] - r.p[i - 1]) * u;
          const nx = -(r.p[i + 1] - r.p[i - 1]) / (L || 1), nz = (r.p[i] - r.p[i - 2]) / (L || 1);
          for (const w of [-0.9, 0, 0.9]) if (roomy(x + nx * w, z + nz * w)) ok = false;
        }
      }
      // The way in and out: 12 m straight on past each end (across the pavement to the street) clear
      // of trunks and posts too - a gate right behind a street tree is a gate nobody can drive into.
      const n = r.p.length / 2;
      for (const [i, j] of [[0, 1], [n - 1, n - 2]]) {
        const dx = r.p[i * 2] - r.p[j * 2], dz = r.p[i * 2 + 1] - r.p[j * 2 + 1], L = Math.hypot(dx, dz) || 1;
        const nx = -dz / L, nz = dx / L;
        for (let d = 0; d <= 12 && ok; d += 1.5) for (const w of [-1.2, 0, 1.2]) if (roomy(r.p[i * 2] + dx / L * d + nx * w, r.p[i * 2 + 1] + dz / L * d + nz * w)) ok = false;
      }
      if (!ok) continue;
      const road = router.route(ax, az, NaN, bx, bz)?.len ?? Infinity;
      const saves = road - len;
      if (road < len * 2 || saves < 120) continue;
      cuts.push({ p: r.p.map((v) => +v.toFixed(1)), len: Math.round(len), saves: Math.round(Math.min(saves, 9999)) });
    }
    cuts.sort((a, b) => b.saves - a.saves);
    const shortcuts: typeof cuts = [];
    for (const c of cuts) {
      if (shortcuts.length >= 12) break;
      const mx = (c.p[0] + c.p[c.p.length - 2]) / 2, mz = (c.p[1] + c.p[c.p.length - 1]) / 2;
      if (shortcuts.some((q) => Math.hypot((q.p[0] + q.p[q.p.length - 2]) / 2 - mx, (q.p[1] + q.p[q.p.length - 1]) / 2 - mz) < 150)) continue;
      if (!free(mx, mz, 30)) continue;
      shortcuts.push(c);
    }

    const out = `// Generated by src/stunts/Spots.gen.test.ts from public/city - do not edit by hand:
//   GEN=1 npx vitest run src/stunts/Spots.gen.test.ts
/** Stunt ramps: the foot of the ramp at (x, z), rising along yaw (atan2(dx, dz)), a clear run-up behind and landing ahead. */
export const JUMPS: { x: number; z: number; yaw: number }[] = ${JSON.stringify(jumps)};
/** 兔儿爷 collectibles, on the kerbs of the lanes and small streets of the core. */
export const RABBITS: { x: number; z: number }[] = ${JSON.stringify(rabbits)};
/** Overpass flights: the foot of the embankment at (x, z) along yaw, the lip OVERPASS.ramp + deck on, a road \`gap\` metres wide past it. */
export const OVERPASSES: { x: number; z: number; yaw: number; gap: number }[] = ${JSON.stringify(overpasses)};
/** The underground car park: the top of its ramp at (x, z), going down along yaw (see UNDERGROUND). */
export const UNDERGROUND_AT: { x: number; z: number; yaw: number } | null = ${JSON.stringify(under)};
/** Hutong shortcuts: a footpath a car fits down, flat [x, z, ...]; its length and the metres it saves over the road. */
export const SHORTCUTS: { p: number[]; len: number; saves: number }[] = ${JSON.stringify(shortcuts)};
`;
    writeFileSync('src/stunts/spots.ts', out);
    console.log(`ramps: ${jumps.length} of ${cands.length} clear spots; rabbits: ${rabbits.length} of ${spots.length} kerb spots; overpasses ${overpasses.length} of ${overs.length}; underground ${JSON.stringify(under)}; shortcuts ${shortcuts.length} of ${cuts.length}`);
    expect(jumps.length).toBeGreaterThan(5);
    expect(rabbits.length).toBeGreaterThan(15);
  }, 600000);
});
