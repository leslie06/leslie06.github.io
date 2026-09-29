import type { LaneGraph, Link } from '../traffic/LaneGraph';
import type { Network } from '../city/Data';
import { shortName } from '../city/Signs';
import { tierOf } from './MapData';

/**
 * What the full map labels besides the landmarks (「跟高德地图一样」): places from OSM
 * (public/city/places.json, scripts/city/places.mjs), the named interchanges, and the roads as
 * whole chains so a name can be set along any straight stretch of them.
 */
export const PLACE_CATS = ['metro', 'rail', 'park', 'hospital', 'school', 'mall', 'hotel', 'sight', 'gov', 'office', 'resid', 'area'] as const;
export type PlaceCat = typeof PLACE_CATS[number];
export interface Name { zh: string; en: string }
export interface Place {
  x: number; z: number; cat: PlaceCat;
  /** 0 shows at city zoom ... 3 only at street zoom. */
  rank: number;
  /** Area in hectares (0 for a point), which breaks ties within a rank. */
  ha: number;
  name: Name;
}
export interface Bridge { x: number; z: number; name: Name }
export interface RoadChain {
  name: Name;
  /** Ring roads by their ring (东三环), for the zoomed-out shields. */
  short: Name;
  /** Drawing tier of its biggest class (MapData TIERS: 4 expressways ... 1 local). */
  tier: number;
  /** Centre line resampled every `CHAIN_STEP` m, [x, z, ...]. */
  pts: Float32Array;
  len: number;
  x0: number; z0: number; x1: number; z1: number;
}
export const CHAIN_STEP = 20;

const BASE: string = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

/** The OSM places, or none when the file is missing (a city built without the pbf export). */
export async function loadPlaces(): Promise<Place[]> {
  try {
    const r = await fetch(`${BASE}city/places.json`);
    if (!r.ok) return [];
    const d = await r.json() as { cats: string[]; p: [number, number, number, number, number, string, string][] };
    return d.p.map(([x, z, c, rank, ha, zh, en]) => ({ x, z, cat: d.cats[c] as PlaceCat, rank, ha, name: { zh, en: en || zh } }));
  } catch { return []; }
}

/** One label per interchange: its named points (every point of every span) clustered within 700 m. */
export function bridgesOf(net: Network): Bridge[] {
  const byName = new Map<string, [number, number][]>();
  for (const [x, z, n] of net.br ?? []) (byName.get(n) ?? byName.set(n, []).get(n)!).push([x, z]);
  const out: Bridge[] = [];
  for (const [n, pts] of byName) {
    const groups: [number, number][][] = [];
    for (const p of pts) {
      const g = groups.find((q) => q.some((o) => Math.hypot(o[0] - p[0], o[1] - p[1]) < 700));
      if (g) g.push(p); else groups.push([p]);
    }
    for (const g of groups) out.push({ x: g.reduce((a, p) => a + p[0], 0) / g.length, z: g.reduce((a, p) => a + p[1], 0) / g.length, name: { zh: n, en: net.en?.[n] || n } });
  }
  return out;
}

/**
 * Every named road as chains of links joined end to end on the straightest continuation, both
 * carriageways separately (the labeller keeps one name per stretch of screen). Slip roads and
 * spans named after their interchange (红领巾桥 on 东四环's deck) are left to the bridge labels.
 */
export function roadChains(g: LaneGraph, en: Record<string, string> = {}): RoadChain[] {
  const L = g.links;
  const canon = (l: Link) => l.rev < 0 || l.id < l.rev;
  const named = (l: Link) => !!l.name && canon(l) && !l.cls.endsWith('_link') && !/桥$/.test(l.name);
  const at = new Map<number, number[]>();
  for (const l of L) if (named(l)) for (const v of [l.from, l.to]) (at.get(v) ?? at.set(v, []).get(v)!).push(l.id);
  const used = new Uint8Array(L.length);
  // Direction of link `l` leaving node v (as walked from v), for choosing the straightest way on.
  const leave = (l: Link, v: number): [number, number] => (l.from === v ? [l.d0x, l.d0z] : [-l.d1x, -l.d1z]);
  const arrive = (l: Link, v: number): [number, number] => (l.to === v ? [l.d1x, l.d1z] : [-l.d0x, -l.d0z]);
  /** From link `l` arriving at node v, the same-named unused link going on straightest (within 50°), or -1. */
  const next = (l: Link, v: number): number => {
    const [ax, az] = arrive(l, v);
    let best = -1, bd = Math.cos(50 * Math.PI / 180);
    for (const id of at.get(v) ?? []) {
      const c = L[id];
      if (used[id] || c.name !== l.name) continue;
      const [bx, bz] = leave(c, v), d = ax * bx + az * bz;
      if (d > bd) { bd = d; best = id; }
    }
    return best;
  };
  const out: RoadChain[] = [];
  for (const l0 of L) {
    if (!named(l0) || used[l0.id]) continue;
    used[l0.id] = 1;
    // Walk on from its end and back from its start; each piece as [link, forwards].
    const fwd: [Link, boolean][] = [], back: [Link, boolean][] = [];
    for (let l = l0, v = l0.to; ;) {
      const id = next(l, v);
      if (id < 0) break;
      used[id] = 1;
      const c = L[id], f = c.from === v;
      fwd.push([c, f]);
      l = c; v = f ? c.to : c.from;
    }
    for (let l = l0, v = l0.from; ;) {
      const id = next(l, v);
      if (id < 0) break;
      used[id] = 1;
      const c = L[id], f = c.to === v;
      back.push([c, f]);
      l = c; v = f ? c.from : c.to;
    }
    const pieces: [Link, boolean][] = [...back.reverse(), [l0, true], ...fwd];
    // Concatenate and resample.
    const raw: number[] = [];
    let tier = 0;
    for (const [l, f] of pieces) {
      tier = Math.max(tier, tierOf(l.cls));
      const n = l.pts.length / 2;
      for (let k = 0; k < n; k++) { const i = f ? k : n - 1 - k; raw.push(l.pts[i * 2], l.pts[i * 2 + 1]); }
    }
    const pts: number[] = [raw[0], raw[1]];
    let carry = 0, len = 0;
    for (let i = 2; i < raw.length; i += 2) {
      const ax = raw[i - 2], az = raw[i - 1], dx = raw[i] - ax, dz = raw[i + 1] - az, d = Math.hypot(dx, dz);
      if (d < 1e-6) continue;
      let t = CHAIN_STEP - carry;
      while (t <= d) { pts.push(ax + dx * t / d, az + dz * t / d); t += CHAIN_STEP; }
      carry = d - (t - CHAIN_STEP);
      len += d;
    }
    if (len < 60 || pts.length < 6) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (let i = 0; i < pts.length; i += 2) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 1]); z1 = Math.max(z1, pts[i + 1]); }
    const n = l0.name, sh = shortName(n);
    const e = en[n] || n;
    out.push({ name: { zh: n, en: e }, short: { zh: sh, en: en[sh] || e.replace(/( Ring Rd) [NSEWM]$/, '$1') }, tier, pts: new Float32Array(pts), len, x0, z0, x1, z1 });
  }
  // Biggest roads first, the longest stretch of each first.
  out.sort((a, b) => b.tier - a.tier || b.len - a.len);
  return out;
}
