import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Network, NetworkEdge } from '../city/Data';
import { LaneGraph } from '../traffic/LaneGraph';
import { project } from '../city/Geo';
import { Router, type Route } from './Router';

const EAST = Math.PI / 2, WEST = -Math.PI / 2;

/** A hand-built network: `nodes` flat [x, z, ...]; each edge a straight line a -> b unless `via` adds points. */
function net(nodes: number[], edges: [a: number, b: number, cls?: string, oneway?: 0 | 1, via?: number[]][]): Network {
  const e: NetworkEdge[] = edges.map(([a, b, c = 'residential', o = 0, via = []]) =>
    ({ a, b, c, o, l: 0, w: 7, p: [nodes[a * 2], nodes[a * 2 + 1], ...via, nodes[b * 2], nodes[b * 2 + 1]] }));
  return { nodes, sig: [], edges: e };
}

/** Closest vertex of the route to (x, z). */
function passes(r: Route, x: number, z: number): number {
  let best = Infinity;
  for (let i = 0; i < r.pts.length; i += 2) best = Math.min(best, Math.hypot(r.pts[i] - x, r.pts[i + 1] - z));
  return best;
}

/** Every consecutive pair of links meets at a node and each is a legal direction of travel. */
function legal(g: LaneGraph, r: Route): boolean {
  for (let i = 1; i < r.links.length; i++) {
    const a = g.links[r.links[i - 1]], b = g.links[r.links[i]];
    if (a.to !== b.from || !g.out[a.to].includes(b.id)) return false;
  }
  return true;
}

// West stub 0-1, east stub 2-3, a short northern detour 1-4-2 and a longer southern one 1-5-2.
//            4 (100,-60)
//   0 ---- 1           2 ---- 3
//            5 (100,120)
const NODES = [-100, 0, 0, 0, 200, 0, 300, 0, 100, -60, 100, 120];
const NORTH = 2 * Math.hypot(100, 60), SOUTH = 2 * Math.hypot(100, 120);

describe('Router', () => {
  it('takes the shortest path when every road is the same class', () => {
    const g = new LaneGraph(net(NODES, [[0, 1], [2, 3], [1, 4], [4, 2], [1, 5], [5, 2]]));
    const r = new Router(g).route(-50, 0, EAST, 250, 0)!;
    expect(r).not.toBeNull();
    expect(passes(r, 100, -60)).toBeLessThan(0.1);
    expect(passes(r, 100, 120)).toBeGreaterThan(50);
    expect(r.len).toBeCloseTo(50 + NORTH + 50, 1);
    expect([r.pts[0], r.pts[1]]).toEqual([-50, 0]);
    expect(r.pts[r.pts.length - 2]).toBeCloseTo(250, 3);
    expect(legal(g, r)).toBe(true);
  });

  it('never drives a one-way street the wrong way', () => {
    // The northern detour is one-way westbound (drawn 2 -> 4 -> 1).
    const g = new LaneGraph(net(NODES, [[0, 1], [2, 3], [4, 1, 'residential', 1], [2, 4, 'residential', 1], [1, 5], [5, 2]]));
    const router = new Router(g);
    const east = router.route(-50, 0, EAST, 250, 0)!;
    expect(passes(east, 100, 120)).toBeLessThan(0.1);
    expect(passes(east, 100, -60)).toBeGreaterThan(50);
    expect(east.len).toBeCloseTo(50 + SOUTH + 50, 1);
    expect(legal(g, east)).toBe(true);
    const west = router.route(250, 0, WEST, -50, 0)!;
    expect(passes(west, 100, -60)).toBeLessThan(0.1);
    expect(west.len).toBeCloseTo(50 + NORTH + 50, 1);
    // Every link is driven in one of its legal directions.
    for (const id of [...east.links, ...west.links]) {
      const l = g.links[id];
      if (l.oneway) expect([[2, 4], [4, 1]]).toContainEqual([l.from, l.to]);
    }
  });

  it('prefers a faster main road over a shorter side street', () => {
    const g = new LaneGraph(net(NODES, [[0, 1], [2, 3], [1, 4], [4, 2], [1, 5, 'trunk'], [5, 2, 'trunk']]));
    const r = new Router(g).route(-50, 0, EAST, 250, 0)!;
    expect(passes(r, 100, 120)).toBeLessThan(0.1);
    expect(r.len).toBeCloseTo(50 + SOUTH + 50, 1);
  });

  it('starts along the heading', () => {
    // A square ring; start in the middle of the south side, target in the middle of the north side:
    // both ways round are 400 m, so the heading decides.
    const g = new LaneGraph(net([0, 0, 200, 0, 200, 200, 0, 200], [[0, 1], [1, 2], [2, 3], [3, 0]]));
    const router = new Router(g);
    const e = router.route(100, 203, EAST, 100, 0)!;
    expect(e.pts[2]).toBeGreaterThan(e.pts[0]);
    expect(e.len).toBeCloseTo(400, 1);
    const w = router.route(100, 203, WEST, 100, 0)!;
    expect(w.pts[2]).toBeLessThan(w.pts[0]);
    expect(w.len).toBeCloseTo(400, 1);
  });

  it('ends at the target\'s projection on the nearest road, and turns back when the target is behind', () => {
    const g = new LaneGraph(net(NODES, [[0, 1], [2, 3], [1, 4], [4, 2], [1, 5], [5, 2]]));
    const router = new Router(g);
    const r = router.route(-50, 0, EAST, 250, 30)!;
    expect(r.pts[r.pts.length - 2]).toBeCloseTo(250, 3);
    expect(r.pts[r.pts.length - 1]).toBeCloseTo(0, 3);
    // Same link, target ahead: straight there.
    const ahead = router.route(-80, 0, EAST, -20, 0)!;
    expect(ahead.len).toBeCloseTo(60, 3);
    expect(ahead.links.length).toBe(1);
    // Same link, target behind: a U-turn on the spot beats going round.
    const behind = router.route(-20, 0, EAST, -80, 0)!;
    expect(behind.len).toBeCloseTo(60, 3);
  });

  it('ends on the connected network, not on a nearer road it cannot reach', () => {
    // An isolated road 40 m north of the east stub's dead end (a service road in a park, say).
    const g = new LaneGraph(net([...NODES, 300, -40, 400, -40], [[0, 1], [2, 3], [1, 4], [4, 2], [1, 5], [5, 2], [6, 7]]));
    const r = new Router(g).route(-50, 0, EAST, 350, -35)!;
    expect(r).not.toBeNull();
    expect(r.pts[r.pts.length - 2]).toBeCloseTo(300, 3);
    expect(r.pts[r.pts.length - 1]).toBeCloseTo(0, 3);
    // Starting on the island snaps to the network as well.
    expect(new Router(g).route(350, -40, EAST, -50, 0)).not.toBeNull();
  });

  it('returns null when no reachable road is near', () => {
    const g = new LaneGraph(net([...NODES, 1000, 1000, 1100, 1000], [[0, 1], [2, 3], [1, 4], [4, 2], [1, 5], [5, 2], [6, 7]]));
    expect(new Router(g).route(-50, 0, EAST, 1050, 1004)).toBeNull();
    expect(new Router(g).route(-50, 0, EAST, 9000, 9000)).toBeNull();
  });
});

const NETWORK = fileURLToPath(new URL('../../public/city/network.json', import.meta.url));

describe('Router on the city network', () => {
  it.skipIf(!fs.existsSync(NETWORK))('routes across central Beijing in under 5 ms', () => {
    const g = new LaneGraph(JSON.parse(fs.readFileSync(NETWORK, 'utf8')) as Network);
    let t0 = performance.now();
    const router = new Router(g);
    const buildMs = performance.now() - t0;
    const spawn = { x: 4524.3, z: 189.9, yaw: -Math.PI / 2 };
    const places: [string, number, number][] = [
      ['Temple of Heaven', 39.882249, 116.406618], ['CCTV', 39.913812, 116.457966], ['Beijing Railway Station', 39.902290, 116.421031],
      ['Tiananmen', 39.907338, 116.391265], ['Zhengyangmen', 39.899184, 116.391618], ['Circular Mound', 39.875583, 116.406957],
    ];
    const pairs: { name: string; a: [number, number, number]; b: [number, number] }[] = [];
    for (const [name, lat, lon] of places) pairs.push({ name: `spawn -> ${name}`, a: [spawn.x, spawn.z, spawn.yaw], b: project(lat, lon) });
    pairs.push({ name: 'NW corner -> SE corner', a: [-900, -1800, 0], b: [6300, 4000] });
    pairs.push({ name: 'SW corner -> NE corner', a: [-900, 4000, Math.PI], b: [6300, -1800] });
    let seed = 7;
    const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32);
    for (let i = 0; i < 200; i++) pairs.push({ name: `random ${i}`, a: [-988 + rnd() * 7343, -1911 + rnd() * 6011, rnd() * 6.283], b: [-988 + rnd() * 7343, -1911 + rnd() * 6011] });

    for (let i = 0; i < 30; i++) { const p = pairs[i % pairs.length]; router.route(p.a[0], p.a[1], p.a[2], p.b[0], p.b[1]); }
    const times: number[] = [], lines: string[] = [];
    let found = 0;
    for (const p of pairs) {
      t0 = performance.now();
      const r = router.route(p.a[0], p.a[1], p.a[2], p.b[0], p.b[1]);
      const ms = performance.now() - t0;
      times.push(ms);
      const crow = Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]);
      if (r) { found++; expect(legal(g, r)).toBe(true); }
      if (!p.name.startsWith('random') || !r) lines.push(`${p.name.padEnd(34)} ${ms.toFixed(2).padStart(6)} ms  ${r ? `${(r.len / 1000).toFixed(2)} km (crow ${(crow / 1000).toFixed(2)} km), ${(r.time / 60).toFixed(1)} min, ${r.links.length} links, ${router.stats.expanded} expanded` : 'no route'}`);
    }
    // Wall time swings with whatever else the machine runs (parallel test files, other processes), so
    // the budget is checked on this process's CPU time (vitest runs each file in its own fork).
    const cpuMs = (fn: () => void) => { const c0 = process.cpuUsage(); fn(); const c = process.cpuUsage(c0); return (c.user + c.system) / 1000; };
    const reps = 3;
    const meanCpu = cpuMs(() => { for (let k = 0; k < reps; k++) for (const p of pairs) router.route(p.a[0], p.a[1], p.a[2], p.b[0], p.b[1]); }) / (reps * pairs.length);
    const cross = pairs.filter((p) => Math.hypot(p.b[0] - p.a[0], p.b[1] - p.a[1]) > 4000);
    let crossCpu = 0;
    for (const p of cross) crossCpu = Math.max(crossCpu, cpuMs(() => { for (let k = 0; k < 5; k++) router.route(p.a[0], p.a[1], p.a[2], p.b[0], p.b[1]); }) / 5);
    const sorted = [...times].sort((a, b) => a - b);
    const q = (f: number) => sorted[Math.min(sorted.length - 1, Math.floor(f * sorted.length))];
    const summary = `links ${g.links.length}, router build ${buildMs.toFixed(1)} ms\n${pairs.length} routes, wall: median ${q(0.5).toFixed(2)} ms, p95 ${q(0.95).toFixed(2)} ms, max ${sorted[sorted.length - 1].toFixed(2)} ms\nCPU: mean ${meanCpu.toFixed(2)} ms per route; worst of ${cross.length} routes over 4 km crow-flies ${crossCpu.toFixed(2)} ms; found ${found}/${pairs.length}\n`;
    fs.mkdirSync('.scratch', { recursive: true });
    fs.writeFileSync('.scratch/nav-router.txt', summary + '\n' + lines.join('\n') + '\n');
    expect(found).toBeGreaterThan(pairs.length * 0.97);
    expect(meanCpu).toBeLessThan(5);
    expect(crossCpu).toBeLessThan(5);
  });
});
