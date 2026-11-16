/**
 * 闯空侧的区域判断（2026-11-16）在真实数据上：陆侧的地方（快速前往 T3 的落点、机场线两个站、穿过空侧边的公共道路、桥上、隧道里）
 * 一律不算闯；跑道、滑行道上算。
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Network } from '../city/Data';
import { LaneGraph } from '../traffic/LaneGraph';
import { Airside } from '../airport/Airside';
import { runways } from '../airport/Flights';
import { AIRPORT_BOX, type AirfieldData } from '../airport/Data';
import { trespassing } from './Zone';

const read = <T>(f: string) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../../public/city/${f}`, import.meta.url)), 'utf8')) as T;
const net = read<Network>('network.json');
const d = read<AirfieldData>('airfield.json');
const g = new LaneGraph(net);
const rws = runways(d);
const air = new Airside(d, rws);
const inside = (x: number, z: number) => air.inside(x, z);

describe('闯空侧的区域判断', () => {
  it('陆侧的落点和车站不算', () => {
    for (const [x, z] of [[18160, -16062], [18085, -16040], [18113, -15911], [16187, -18833]]) expect(trespassing(inside, g, x, 0, z)).toBe(false);
  });

  it('机场附近路网上的每一点（地面、桥上、隧道里）都不算', () => {
    const B = AIRPORT_BOX;
    let n = 0;
    const bad: string[] = [];
    for (const e of net.edges) {
      const p = e.p;
      if (!p.some((v, i) => i % 2 === 0 && v > B.x0 - 300 && v < B.x1 + 300 && p[i + 1] > B.z0 - 300 && p[i + 1] < B.z1 + 300)) continue;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
        for (let s = 0; s < L; s += 4) {
          const h = e.h ? e.h[i / 2] + (e.h[i / 2 + 1] - e.h[i / 2]) * s / L : 0;
          const x = p[i] + (p[i + 2] - p[i]) * s / L, z = p[i + 1] + (p[i + 3] - p[i + 1]) * s / L;
          n++;
          if (trespassing(inside, g, x, h + 0.5, z)) bad.push(`${e.n ?? e.c} ${x.toFixed(0)},${z.toFixed(0)}`);
        }
      }
    }
    expect(n).toBeGreaterThan(20000);
    expect(bad).toEqual([]);
  });

  it('跑道和滑行道上算', () => {
    expect(rws.length).toBe(3);
    for (const rw of rws) for (const u of [0.1, 0.5, 0.9]) {
      const x = rw.sx + (rw.nx - rw.sx) * u, z = rw.sz + (rw.nz - rw.sz) * u;
      expect(trespassing(inside, g, x, 0.3, z)).toBe(true);
      expect(air.runwayAt(x, z)?.rw.ref).toBe(rw.ref);
    }
    let n = 0, yes = 0;
    for (const w of d.taxiways) {
      const x = (w.p[0] + w.p[w.p.length - 2]) / 2, z = (w.p[1] + w.p[w.p.length - 1]) / 2;
      if (!inside(x, z)) continue;
      n++; if (trespassing(inside, g, x, 0.3, z)) yes++;
    }
    expect(n).toBeGreaterThan(200);
    expect(yes / n).toBeGreaterThan(0.97);
  });
});
