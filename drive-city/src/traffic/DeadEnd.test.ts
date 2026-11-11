/**
 * A road that simply ends must not end the game.
 *
 * 「我把车开到家门口就卡住了……游戏死机了」(2026-09-23): the whole game hung, every time, on the way to
 * the villa. Nothing at the villa was to blame. The OSM network has 74 one-way roads that end with
 * no way on (the west end of 景恒街 is 320 m from the villa's gate, inside the traffic radius), and
 * `LaneGraph.next` answered such an end with the link itself. `AiDriver.update`'s advance loop took
 * that as "moved onto the next link", projected the car onto its end again, and went round forever
 * with the main thread - V8 paused by the probe (`.scratch/homefreeze.mjs`) sat in `AiDriver.fill`.
 *
 * So: `next` says -1 at a one-way dead end, the driver's queue stays short there, the driver brakes
 * for the end of the road and reports itself lost (the pool recycles it out of view), the advance
 * loop is capped whatever the data says, and nobody spawns on such a link.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import type { Network, NetworkEdge } from '../city/Data';
import { Rig } from '../vehicle/Rig';
import { AiDriver } from './AiDriver';
import { LaneGraph } from './LaneGraph';
import { Signals } from './Signals';

const DT = 1 / 60;

/** A hand-built network: `nodes` flat [x, z, ...]; each edge a straight line a -> b, one-way if `o`. */
function net(nodes: number[], edges: [a: number, b: number, o: 0 | 1][]): Network {
  const e: NetworkEdge[] = edges.map(([a, b, o]) =>
    ({ a, b, c: 'secondary', o, l: 0, w: 8, p: [nodes[a * 2], nodes[a * 2 + 1], nodes[b * 2], nodes[b * 2 + 1]] }));
  return { nodes, sig: new Array(nodes.length / 2).fill(0), edges: e };
}

//  A(-200,0) <--> B(0,0) --> C(120,0)      A-B two-way, B-C one-way and the road ends at C.
const ROAD = net([-200, 0, 0, 0, 120, 0], [[0, 1, 0], [1, 2, 1]]);

describe('traffic where the road ends', () => {
  const g = new LaneGraph(ROAD), sig = new Signals(g);
  const into = (from: number, to: number) => g.links.find((l) => l.from === from && l.to === to)!;

  it('has nowhere to send a driver on from a one-way end, and turns it round at a two-way one', () => {
    expect(g.next(into(1, 2).id, () => 0.5)).toBe(-1);
    expect(g.endsAfter(into(1, 2).id)).toBe(true);
    // The two-way road's end at A: the way on is back the way you came.
    expect(g.next(into(1, 0).id, () => 0.5)).toBe(into(0, 1).id);
    expect(g.endsAfter(into(1, 0).id)).toBe(false);
  });

  it('returns from update with a car standing past the end of the road (the hang)', async () => {
    // The test timeout is the watchdog: before the fix this call never came back.
    const l = into(1, 2);
    const rig = await Rig.create({ at: { x: 124, y: 0.36, z: 0 }, yaw: Math.PI / 2 });
    rig.settle(0.3);
    const driver = new AiDriver(g, sig, l.id, l.len - 0.1, 0, () => 0.5);
    const out = driver.update(rig.car, DT, 0, null);
    expect(driver.mode).toBe('lost');
    expect(out.forward).toBe(0);
  });

  it('drives a real car up to the end of a one-way road, brakes and stands there', async () => {
    const l = into(1, 2);
    const at = g.at(l, l.len - 60, g.laneOffset(l, 0), { x: 0, z: 0, dx: 0, dz: 0 });
    const rig = await Rig.create({ at: { x: at.x, y: 0.36, z: at.z }, yaw: Math.atan2(at.dx, at.dz) });
    const driver = new AiDriver(g, sig, l.id, l.len - 60, 0, () => 0.5);
    rig.launch(10);
    let t = 0;
    for (let i = 0; i < 15 * 60; i++) { rig.stepInput(driver.update(rig.car, DT, t, null), DT); t += DT; }
    // The road ends at x = 120: the car is short of it, standing, and given up on.
    expect(rig.car.pos.x).toBeGreaterThan(100);
    expect(rig.car.pos.x).toBeLessThan(121);
    expect(rig.car.speed).toBeLessThan(0.5);
    expect(driver.mode).toBe('lost');
  });

  it('never answers a link with itself on the real city network, except round a closed ring', () => {
    const file = fileURLToPath(new URL('../../public/city/network.json', import.meta.url));
    const city = new LaneGraph(JSON.parse(fs.readFileSync(file, 'utf8')) as Network);
    let ends = 0;
    const self: string[] = [];
    for (const l of city.links) {
      if (city.endsAfter(l.id)) ends++;
      // A closed ring (one edge from a node back to itself, 160-240 m of loop road here) may well be
      // driven round again: the projection then lands near its start, not its end, and the advance
      // loop leaves. Anything else answering with itself is the hang.
      if (city.next(l.id, () => 0.5) === l.id && !(l.from === l.to && l.len > 10)) self.push(`${l.id} ${l.cls} ${l.len.toFixed(0)} m`);
    }
    expect(self).toEqual([]);
    // The control: the data really has one-way dead ends, so the guard above is being exercised.
    expect(ends).toBeGreaterThan(0);
  });
});

// 2026-11-11（travel/Ride.ts，坐公交、打车）：司机照一条路线开；公交只进自己右手边的站。
describe('a driver with somewhere to go', () => {
  //  A(-200,0) <--> B(0,0) <--> C(200,0), and B <--> D(0,200) off to the south
  const T = net([-200, 0, 0, 0, 200, 0, 0, 200], [[0, 1, 0], [1, 2, 0], [1, 3, 0]]);
  const g = new LaneGraph(T), sig = new Signals(g);
  const into = (from: number, to: number) => g.links.find((l) => l.from === from && l.to === to)!;

  it('takes the links of its route in order, then drives on wherever', () => {
    const ab = into(0, 1), bd = into(1, 3);
    for (let seed = 1; seed <= 5; seed++) {
      let k = seed;
      const d = new AiDriver(g, sig, ab.id, 20, 0, () => ((k = (k * 1664525 + 1013904223) >>> 0) / 2 ** 32));
      d.follow([ab.id, bd.id]);
      expect(d.nextLink).toBe(bd.id);
      expect(d.planLeft).toBe(1);
    }
    // a route that does not join up is dropped where it breaks
    const d = new AiDriver(g, sig, ab.id, 20, 0, () => 0.5);
    d.follow([ab.id, into(3, 1).id]);
    expect(d.planLeft).toBe(0);
    expect(d.nextLink).not.toBe(into(3, 1).id);
  });

  it('hops along its route to a spot that will do', () => {
    const ab = into(0, 1), bd = into(1, 3);
    const d = new AiDriver(g, sig, ab.id, 190, 0, () => 0.5);
    d.follow([ab.id, bd.id]);
    expect(d.hop(30, () => false)).toBe(false);
    expect(d.link).toBe(ab.id);
    expect(d.hop(30, (_at, link, s) => link === bd.id && Math.abs(s - 20) < 0.01)).toBe(true);
    expect(d.link).toBe(bd.id);
    expect(d.s).toBeCloseTo(20, 2);
    expect(d.planLeft).toBe(0);
  });

  it('stops for the shelter at its own kerb, not the one across the road', () => {
    // eastbound on A -> B (x east, z south): the right-hand kerb is to the south (+z)
    const ab = into(0, 1);
    const d = new AiDriver(g, sig, ab.id, 20, 0, () => 0.5);
    expect(d.stopAhead(-120, 6, 15, 85)).toBeCloseTo(80, 1);
    expect(d.stopAhead(-120, -6, 15, 85)).toBe(-1);
    // and the one going the other way takes the northern one
    const ba = into(1, 0);
    const e = new AiDriver(g, sig, ba.id, 20, 0, () => 0.5);
    expect(e.stopAhead(-120, -6, 15, 150)).toBeCloseTo(120, 1);
    expect(e.stopAhead(-120, 6, 15, 150)).toBe(-1);
  });
});
