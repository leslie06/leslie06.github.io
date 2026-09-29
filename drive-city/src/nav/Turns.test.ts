/**
 * Turn-by-turn on real routes: off 东四环 at 朝阳公园桥 and right into 姚家园路, and nothing said on a
 * straight run along the ring.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Network } from '../city/Data';
import { LaneGraph } from '../traffic/LaneGraph';
import { Router } from './Router';
import { routeTurns } from './Turns';

const net = JSON.parse(fs.readFileSync(fileURLToPath(new URL('../../public/city/network.json', import.meta.url)), 'utf8')) as Network;
const g = new LaneGraph(net), router = new Router(g);
const turns = (x0: number, z0: number, x1: number, z1: number) => {
  const r = router.route(x0, z0, Math.atan2(x1 - x0, z1 - z0), x1, z1)!;
  return routeTurns(g, r.pts, r.links);
};

describe('turn-by-turn', () => {
  it('takes the exit at 朝阳公园桥 and turns right into 姚家园路', () => {
    const t = turns(7370, -2050, 8300, -2640);
    expect(t[0].kind).toBe('exit');
    expect(t.some((q) => q.kind === 'R' && q.road === '姚家园路')).toBe(true);
    expect(t[t.length - 1].kind).toBe('arrive');
  });
  it('says nothing on 东四环 straight on from 红领巾桥 to 双新桥', () => {
    const t = turns(7378, -1700, 7380, -3700);
    expect(t.filter((q) => q.kind !== 'arrive' && q.kind !== 'S')).toHaveLength(0);
  });
});
