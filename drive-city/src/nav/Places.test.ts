/**
 * The full map's labels on the real city: roads as whole chains (the ring and the expressway each a
 * few long chains, not hundreds of junction-to-junction links), one label per interchange, and the
 * OSM places file covering what a map app shows.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Network } from '../city/Data';
import { LaneGraph } from '../traffic/LaneGraph';
import { bridgesOf, roadChains, PLACE_CATS } from './Places';

const read = <T>(f: string) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../../public/city/${f}`, import.meta.url)), 'utf8')) as T;
const net = read<Network>('network.json');
const g = new LaneGraph(net);

describe('map labels', () => {
  const t0 = performance.now();
  const roads = roadChains(g, net.en);
  const ms = performance.now() - t0;

  it('joins a road into long chains', () => {
    expect(ms).toBeLessThan(250);
    const ring = roads.filter((c) => c.name.zh === '东四环中路');
    expect(ring.length).toBeGreaterThan(0);
    expect(Math.max(...ring.map((c) => c.len))).toBeGreaterThan(1500);
    expect(ring[0].short.zh).toBe('东四环');
    expect(ring[0].short.en).toBe('E 4th Ring Rd');
    expect(ring[0].tier).toBe(4);
    // Samples every CHAIN_STEP m, and no interchange-named span or slip road among the chains.
    expect(roads.some((c) => /桥$/.test(c.name.zh))).toBe(false);
  });

  it('labels each interchange once', () => {
    const br = bridgesOf(net);
    for (const n of ['国贸桥', '四惠桥', '东风北桥', '双新桥', '朝阳公园桥', '小武基桥']) expect(br.filter((b) => b.name.zh === n).length, n).toBe(1);
    expect(br.find((b) => b.name.zh === '国贸桥')!.name.en).toBe('Guomao Qiao');
  });

  it('has the places a map app shows', () => {
    const d = read<{ cats: string[]; p: [number, number, number, number, number, string, string][] }>('places.json');
    expect(d.cats).toEqual([...PLACE_CATS]);
    const names = new Set(d.p.map((p) => p[5]));
    for (const n of ['国贸', '朝阳公园', '北京站', '协和医院', '北京工业大学', '北京朝阳站']) expect(names.has(n), n).toBe(true);
    for (const c of PLACE_CATS) expect(d.p.some((p) => d.cats[p[2]] === c), c).toBe(true);
  });
});
