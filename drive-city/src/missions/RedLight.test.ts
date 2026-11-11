import { describe, expect, it } from 'vitest';
import type { Network, NetworkEdge } from '../city/Data';
import { LaneGraph } from '../traffic/LaneGraph';
import { Signals } from '../traffic/Signals';
import { redAhead } from './RedLight';

/** 十字路口：C(0,0) 有灯，四条 200 米的双向路；东边那条在 E(200,0) 之前 60 米处断成两段（中间的点没灯）。 */
const nodes = [0, 0, -200, 0, 200, 0, 0, -200, 0, 200, 140, 0];
const edge = (a: number, b: number): NetworkEdge => ({ a, b, c: 'secondary', o: 0, l: 0, w: 8, p: [nodes[a * 2], nodes[a * 2 + 1], nodes[b * 2], nodes[b * 2 + 1]] });
const NET: Network = { nodes, sig: [1, 0, 0, 0, 0, 0], edges: [edge(1, 0), edge(0, 5), edge(5, 2), edge(3, 0), edge(0, 4)] };

describe('等红灯', () => {
  const g = new LaneGraph(NET), sig = new Signals(g, 'osm');
  const west = g.links.find((l) => l.from === 1 && l.to === 0)!;
  const when = (want: 0 | 2) => { for (let t = 0; t < 400; t += 0.5) if (sig.state(west, t) === want) return t; throw new Error('no such light'); };

  it('路口有灯', () => { expect(sig.junctionOf(0)).toBeGreaterThanOrEqual(0); });

  it('朝着红灯停在 90 米内算，绿灯不算', () => {
    expect(redAhead(g, sig, when(2), -30, 2, 1, 0)).toBe(true);
    expect(redAhead(g, sig, when(0), -30, 2, 1, 0)).toBe(false);
  });

  it('离得远、背着灯、不在路上都不算', () => {
    const t = when(2);
    expect(redAhead(g, sig, t, -150, 2, 1, 0)).toBe(false);
    expect(redAhead(g, sig, t, -30, -2, -1, 0)).toBe(false);
    expect(redAhead(g, sig, t, -30, 40, 1, 0)).toBe(false);
  });

  it('隔着一段没灯的路也看得到前面的灯', () => {
    // 从 E 往西：先是 E→(140,0) 60 米，再 (140,0)→C 140 米；车在第一段上离路口 150 米，够不着，开到第二段 80 米处够得着
    const east = g.links.find((l) => l.from === 5 && l.to === 0)!;
    let t = -1;
    for (let k = 0; k < 400; k += 0.5) if (sig.state(east, k) === 2) { t = k; break; }
    expect(t).toBeGreaterThanOrEqual(0);
    expect(redAhead(g, sig, t, 150, -2, -1, 0)).toBe(false);
    expect(redAhead(g, sig, t, 80, -2, -1, 0)).toBe(true);
    // 第一段的末尾（离路口 142 米）不算；把够得着的距离放到 160 米就算了
    expect(redAhead(g, sig, t, 142, -2, -1, 0, 160)).toBe(true);
  });
});
