/**
 * Street order (M4): which junctions have lights, and that a driver stops at a red one.
 * OSM marks only 463 signal nodes in this extract against 3,591 junctions where streets meet, so
 * `Signals` infers the rest; without them most of the city had nothing to obey.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Network, NetworkEdge } from '../city/Data';
import { LaneGraph } from './LaneGraph';
import { Signals, type LightsMode } from './Signals';
import { AiDriver, lineStats } from './AiDriver';
import { Rig } from '../vehicle/Rig';

const DT = 1 / 60;
const CYCLE = 56;   // 30 s green for the main road, 16 s for the side street, + amber and all-red

/** A hand-built network: `nodes` flat [x, z, ...]; each edge a straight line a -> b. */
function net(nodes: number[], edges: [a: number, b: number, cls?: string, w?: number][], sig: number[] = []): Network {
  const e: NetworkEdge[] = edges.map(([a, b, c = 'primary', w = 14]) =>
    ({ a, b, c, o: 0, l: 0, w, p: [nodes[a * 2], nodes[a * 2 + 1], nodes[b * 2], nodes[b * 2 + 1]] }));
  return { nodes, sig: sig.length ? sig : new Array(nodes.length / 2).fill(0), edges: e };
}

//   D (0,-100)
//   |
//   A --- B --- C      A(-100,0) B(0,0) C(100,0)
//   |
//   E (0,100)          all primary, B is the crossing
const CROSS = net([-100, 0, 0, 0, 100, 0, 0, -100, 0, 100], [[0, 1], [1, 2], [3, 1], [1, 4]]);

describe('traffic lights', () => {
  const g = new LaneGraph(CROSS);
  const sig = new Signals(g);
  const into = (from: number, to: number) => g.links.find((l) => l.from === from && l.to === to)!;

  it('signalises a crossing of two main roads that OSM did not mark', () => {
    expect(CROSS.sig.every((s) => !s)).toBe(true);
    expect(sig.junctionOf(1)).toBeGreaterThanOrEqual(0);
    expect(sig.inferred).toBe(1);
    // The arms are not junctions of their own.
    for (const n of [0, 2, 3, 4]) expect(sig.junctionOf(n)).toBe(-1);
  });

  it('never shows green to both axes at once, and gives the main road the longer green', () => {
    const ew = into(0, 1), ns = into(3, 1);
    expect(sig.phaseOf(ew)).not.toBe(sig.phaseOf(ns));
    let gEw = 0, gNs = 0, both = 0, n = 0;
    const seen = new Set<number>();
    for (let t = 0; t < CYCLE * 3; t += 0.25) {
      const a = sig.state(ew, t), b = sig.state(ns, t);
      if (a === 0 && b === 0) both++;
      if (a === 0) gEw++;
      if (b === 0) gNs++;
      seen.add(a); n++;
    }
    expect(both).toBe(0);
    expect([...seen].sort()).toEqual([0, 1, 2]);          // green, amber and red all happen
    expect(Math.max(gEw, gNs) / n).toBeCloseTo(30 / CYCLE, 1);
    expect(Math.min(gEw, gNs) / n).toBeCloseTo(16 / CYCLE, 1);
    expect(sig.greenSpan(sig.junctionOf(1), 0)).toBeGreaterThan(sig.greenSpan(sig.junctionOf(1), 1));
    expect(sig.cycleOf(sig.junctionOf(1))).toBe(CYCLE);
  });

  it('a driver brakes to a stop at the line on red and goes on green', async () => {
    const l = into(0, 1);
    // A moment when this approach stays red for the next 9 s, and one when it stays green.
    const stays = (want: number, secs: number) => {
      for (let t = 0; t < CYCLE; t += 0.25) {
        let ok = true;
        for (let u = 0; u <= secs; u += 0.5) if (sig.state(l, t + u) !== want) { ok = false; break; }
        if (ok) return t;
      }
      return -1;
    };
    const drive = async (t0: number) => {
      const at = g.at(l, l.len - 60, g.laneOffset(l, 0), { x: 0, z: 0, dx: 0, dz: 0 });
      const rig = await Rig.create({ at: { x: at.x, y: 0.36, z: at.z }, yaw: Math.atan2(at.dx, at.dz) });
      const driver = new AiDriver(g, sig, l.id, l.len - 60, 0, () => 0.5);
      rig.launch(12);
      let t = t0;
      for (let i = 0; i < 9 * 60; i++) { rig.stepInput(driver.update(rig.car, DT, t, null), DT); t += DT; }
      return rig.car;
    };
    const red = stays(2, 9), green = stays(0, 9);
    expect(red).toBeGreaterThanOrEqual(0);
    expect(green).toBeGreaterThanOrEqual(0);

    const before = { ...lineStats };
    const stopped = await drive(red);
    // The stop line is 7 m before the node at x = 0; the car must be short of it and standing.
    expect(stopped.pos.x).toBeLessThan(-4);
    expect(stopped.speed).toBeLessThan(1);
    expect(lineStats.crossed - before.crossed).toBe(0);
    const through = await drive(green);
    expect(through.pos.x).toBeGreaterThan(20);
    // The probe's red-light count sees the line crossed once, on green.
    expect(lineStats.crossed - before.crossed).toBe(1);
    expect(lineStats.onRed - before.onRed).toBe(0);
  });
});

/** A plus-shaped crossing at (0, 0) whose four arms are `cls`, and an extra arm of `stub` heading north-east. */
function plus(cls: [string, string], stub?: string): Network {
  const nodes = [-100, 0, 0, 0, 100, 0, 0, -100, 0, 100, 70, -70];
  const edges: [number, number, string][] = [[0, 1, cls[0]], [1, 2, cls[0]], [3, 1, cls[1]], [1, 4, cls[1]]];
  if (stub) edges.push([1, 5, stub]);
  return net(nodes, edges.map(([a, b, c]) => [a, b, c, 8]));
}

describe('which junctions get lights', () => {
  const lights = (n: Network, mode: LightsMode = 'all') => { const g = new LaneGraph(n); return { g, sig: new Signals(g, mode) }; };

  it('lights two lanes crossing, on the short cycle', () => {
    const { sig } = lights(plus(['residential', 'residential']));
    const j = sig.junctionOf(1);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(sig.cycleOf(j)).toBeLessThan(CYCLE);
    expect(sig.minor).toBe(1);
    // The old rule (two roads of tertiary or better) left it dark, which is the gap this closes.
    expect(lights(plus(['residential', 'residential']), 'main').sig.junctionOf(1)).toBe(-1);
  });

  it('lights a lane meeting a main road on the long cycle, with the main road on the long green', () => {
    // A T: the tertiary runs through east-west, the lane comes in from the north only.
    const n = net([-100, 0, 0, 0, 100, 0, 0, -100], [[0, 1, 'tertiary', 10], [1, 2, 'tertiary', 10], [3, 1, 'residential', 7]]);
    const { g, sig } = lights(n);
    const j = sig.junctionOf(1);
    expect(j).toBeGreaterThanOrEqual(0);
    expect(sig.cycleOf(j)).toBe(CYCLE);
    const main = g.links.find((l) => l.from === 0 && l.to === 1)!, lane = g.links.find((l) => l.from === 3 && l.to === 1)!;
    expect(sig.phaseOf(main)).toBe(0);
    expect(sig.phaseOf(lane)).toBe(1);
    expect(sig.greenSpan(j, 0)).toBeGreaterThan(sig.greenSpan(j, 1));
  });

  it('never shows green to both axes at once on either cycle', () => {
    for (const cls of [['residential', 'residential'], ['primary', 'residential']] as [string, string][]) {
      const { g, sig } = lights(plus(cls));
      const ew = g.links.find((l) => l.from === 0 && l.to === 1)!, ns = g.links.find((l) => l.from === 3 && l.to === 1)!;
      for (let t = 0; t < 200; t += 0.25) expect(sig.state(ew, t) === 0 && sig.state(ns, t) === 0).toBe(false);
    }
  });

  it('does not light a driveway, a ramp onto an expressway or anything on a motorway', () => {
    // A street running straight through with a driveway off it: two street arms, not a junction.
    const drive = net([-100, 0, 0, 0, 100, 0, 0, -40], [[0, 1, 'residential'], [1, 2, 'residential'], [3, 1, 'service']]);
    expect(lights(drive).sig.junctionOf(1)).toBe(-1);
    // An on-ramp joining a trunk road: merges, even where the data meets it square on.
    for (const at of [[60, -25], [0, -60]]) {
      const ramp = net([-100, 0, 0, 0, 100, 0, ...at], [[0, 1, 'trunk', 20], [1, 2, 'trunk', 20], [3, 1, 'trunk_link', 7]]);
      expect(lights(ramp).sig.junctionOf(1)).toBe(-1);
    }
    const mw = net([-100, 0, 0, 0, 100, 0, 0, -60], [[0, 1, 'motorway', 20], [1, 2, 'motorway', 20], [3, 1, 'primary', 14]]);
    expect(lights(mw).sig.junctionOf(1)).toBe(-1);
    // A fork where a street splits into two running nearly the same way.
    const fork = net([-100, 0, 0, 0, 100, 10, 100, -10], [[0, 1, 'residential'], [1, 2, 'residential'], [1, 3, 'residential']]);
    expect(lights(fork).sig.junctionOf(1)).toBe(-1);
  });

  it('gives a junction drawn as close nodes one clock, and the next junction its own', () => {
    // A lane crossing two parallel streets 15 m apart (a staggered pair: one junction), then a
    // third 60 m on (a junction of its own).
    const xs = [0, 15, 75];
    const nodes: number[] = [-100, 0];
    const edges: [number, number, string, number][] = [];
    for (const x of xs) { nodes.push(x, 0, x, -100, x, 100); }
    nodes.push(200, 0);
    // Along the lane: 0 -> 1 -> 4 -> 7 -> 10; each crossing node k has arms to k+1 (north) and k+2 (south).
    let prev = 0;
    for (let i = 0; i < xs.length; i++) {
      const k = 1 + i * 3;
      edges.push([prev, k, 'residential', 8], [k, k + 1, 'residential', 8], [k, k + 2, 'residential', 8]);
      prev = k;
    }
    edges.push([prev, 10, 'residential', 8]);
    const { sig } = lights(net(nodes, edges));
    expect(sig.junctionOf(1)).toBeGreaterThanOrEqual(0);
    expect(sig.junctionOf(4)).toBe(sig.junctionOf(1));
    expect(sig.junctionOf(7)).toBeGreaterThanOrEqual(0);
    expect(sig.junctionOf(7)).not.toBe(sig.junctionOf(1));
  });

  it('does not chain a street of close junctions into one', () => {
    // Side streets every 20 m for 400 m: each is within the join distance of the next.
    const nodes: number[] = [], edges: [number, number, string, number][] = [];
    for (let i = 0; i <= 20; i++) nodes.push(i * 20, 0, i * 20, -50);
    for (let i = 0; i < 20; i++) edges.push([i * 2, i * 2 + 2, 'residential', 8]);
    for (let i = 1; i < 20; i++) edges.push([i * 2, i * 2 + 1, 'residential', 8]);
    const { g, sig } = lights(net(nodes, edges));
    const span = new Map<number, [number, number]>();
    for (let i = 0; i < g.nodeX.length; i++) {
      const c = sig.junctionOf(i);
      if (c < 0) continue;
      const s = span.get(c) ?? [Infinity, -Infinity];
      span.set(c, [Math.min(s[0], g.nodeX[i]), Math.max(s[1], g.nodeX[i])]);
    }
    expect(span.size).toBeGreaterThan(3);
    for (const [a, b] of span.values()) expect(b - a).toBeLessThan(121);
  });
});

describe('the real city', () => {
  const city = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../public/city/network.json', import.meta.url)), 'utf8')) as Network;
  const g = new LaneGraph(city);
  const sig = new Signals(g);

  it('lights every junction of ordinary streets', () => {
    // Independent of how Signals decides: any node where three or more edges of ordinary street
    // classes meet and two of them cross at 60-120 degrees is a junction a driver expects a light at.
    const STREET = new Set(['primary', 'secondary', 'tertiary', 'unclassified', 'residential']);
    const arms: number[][] = Array.from({ length: g.nodeX.length }, () => []);
    // Up on an interchange's deck (over 3 m) the heads could only stand on the ground below: those
    // few junctions (7, on 广渠路's viaduct and the like) are left dark on purpose.
    const deck = new Set<number>();
    for (const e of city.edges) if (e.h) { if (e.h[0] > 3) deck.add(e.a); if (e.h[e.h.length - 1] > 3) deck.add(e.b); }
    for (const e of city.edges) {
      if (e.p.length < 4 || !STREET.has(e.c)) continue;
      const m = e.p.length;
      arms[e.a].push(Math.atan2(e.p[3] - e.p[1], e.p[2] - e.p[0]));
      arms[e.b].push(Math.atan2(e.p[m - 3] - e.p[m - 1], e.p[m - 4] - e.p[m - 2]));
    }
    let want = 0, dark = 0;
    for (let i = 0; i < arms.length; i++) {
      const a = arms[i];
      if (a.length < 3) continue;
      let square = false;
      for (let x = 0; x < a.length && !square; x++) for (let y = x + 1; y < a.length; y++) {
        const d = Math.abs(Math.cos(a[x] - a[y]));
        if (d < 0.5) { square = true; break; }
      }
      if (!square || deck.has(i)) continue;
      want++;
      if (sig.junctionOf(i) < 0) dark++;
    }
    expect(want).toBeGreaterThan(2000);
    expect(dark).toBe(0);
  });

  it('leaves driveways and motorways dark', () => {
    // A street running on past a service road's mouth is not a junction.
    const street: number[] = new Array(g.nodeX.length).fill(0), service: number[] = new Array(g.nodeX.length).fill(0);
    const motorway = new Set<number>();
    for (const e of city.edges) {
      for (const n of [e.a, e.b]) {
        if (e.c === 'service' || e.c === 'living_street') service[n]++; else street[n]++;
        if (e.c === 'motorway') motorway.add(n);
      }
    }
    let driveways = 0;
    for (let i = 0; i < g.nodeX.length; i++) {
      if (g.sig[i]) continue;
      if (street[i] === 2 && service[i] >= 1) { driveways++; expect(sig.junctionOf(i)).toBe(-1); }
      if (motorway.has(i)) expect(sig.junctionOf(i)).toBe(-1);
    }
    expect(driveways).toBeGreaterThan(300);
  });

  it('keeps every junction compact: one clock never spans a block', () => {
    const lo = new Map<number, number[]>();
    for (let i = 0; i < g.nodeX.length; i++) {
      const c = sig.junctionOf(i);
      if (c < 0) continue;
      (lo.get(c) ?? lo.set(c, []).get(c)!).push(i);
    }
    let worst = 0;
    for (const m of lo.values()) for (const a of m) for (const b of m) worst = Math.max(worst, Math.hypot(g.nodeX[a] - g.nodeX[b], g.nodeZ[a] - g.nodeZ[b]));
    expect(worst).toBeLessThan(121);
    expect(sig.centres.length).toBeGreaterThan(1500);
  });

  it('gives every signalised approach a light that changes', () => {
    let changing = 0, sampled = 0;
    for (const l of g.links) {
      if (sig.junctionOf(l.to) < 0 || sig.junctionOf(l.from) === sig.junctionOf(l.to)) continue;
      if (sampled >= 400) break;
      sampled++;
      const seen = new Set<number>();
      for (let t = 0; t < sig.cycleOf(sig.junctionOf(l.to)); t += 1) seen.add(sig.state(l, t));
      if (seen.size === 3) changing++;
    }
    expect(sampled).toBeGreaterThan(100);
    expect(changing).toBe(sampled);
  });
});
