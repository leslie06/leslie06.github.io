/**
 * Street order (M4): which junctions have lights, and that a driver stops at a red one.
 * OSM marks only 343 signal nodes in this extract against ~1,900 junctions where two main roads
 * meet, so `Signals` infers the rest; without them most of the city had nothing to obey.
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Network, NetworkEdge } from '../city/Data';
import { LaneGraph } from './LaneGraph';
import { Signals } from './Signals';
import { AiDriver } from './AiDriver';
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
    expect(sig.greenSpan(0)).toBeGreaterThan(sig.greenSpan(1));
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

    const stopped = await drive(red);
    // The stop line is 7 m before the node at x = 0; the car must be short of it and standing.
    expect(stopped.pos.x).toBeLessThan(-4);
    expect(stopped.speed).toBeLessThan(1);
    const through = await drive(green);
    expect(through.pos.x).toBeGreaterThan(20);
  });
});

describe('the real city', () => {
  const city = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../public/city/network.json', import.meta.url)), 'utf8')) as Network;
  const g = new LaneGraph(city);
  const sig = new Signals(g);

  it('lights the main crossings without lighting every side street', () => {
    expect(sig.inferred).toBeGreaterThan(200);          // OSM marks 343 nodes; class infers the rest
    // A light where two through streets meet, not one per node: a few hundred junctions.
    expect(sig.centres.length).toBeGreaterThan(200);
    expect(sig.centres.length).toBeLessThan(600);
    // Nowhere near every node: quiet streets stay unsignalised.
    const lit = [...g.nodeX].filter((_, i) => sig.junctionOf(i) >= 0).length;
    expect(lit / g.nodeX.length).toBeLessThan(0.4);
  });

  it('gives every signalised approach a light that changes', () => {
    let changing = 0, sampled = 0;
    for (const l of g.links) {
      if (sig.junctionOf(l.to) < 0 || sig.junctionOf(l.from) === sig.junctionOf(l.to)) continue;
      if (sampled >= 400) break;
      sampled++;
      const seen = new Set<number>();
      for (let t = 0; t < CYCLE; t += 1) seen.add(sig.state(l, t));
      if (seen.size === 3) changing++;
    }
    expect(sampled).toBeGreaterThan(100);
    expect(changing).toBe(sampled);
  });
});
