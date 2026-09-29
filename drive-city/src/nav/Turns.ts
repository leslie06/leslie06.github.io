import type { LaneGraph } from '../traffic/LaneGraph';
import { shortName } from '../city/Signs';

/**
 * Turn-by-turn directions for a GPS route (「不要让用户迷路」): the decisions along it - where the
 * road forks or a junction offers a choice - and what to do at each. Read by the radar's turn strip.
 */
export type TurnKind = 'L' | 'R' | 'SL' | 'SR' | 'U' | 'S' | 'exit' | 'arrive';
export interface Turn {
  /** Arc length along the route's points where it happens. */
  s: number;
  kind: TurnKind;
  /** The road it takes you onto ('' when unnamed), ring roads by their ring. */
  road: string;
}

const isLink = (c: string) => c.endsWith('_link');
/** Decisions this close together are one (a dual carriageway's junction is two or four nodes). */
const MERGE = 32;

export function routeTurns(g: LaneGraph, pts: Float32Array, links: readonly number[]): Turn[] {
  const n = pts.length / 2;
  if (n < 2) return [];
  const cum = new Float32Array(n);
  for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(pts[k * 2] - pts[k * 2 - 2], pts[k * 2 + 1] - pts[k * 2 - 1]);
  const len = cum[n - 1];
  /** Point at arc length s. */
  const at = (s: number): [number, number] => {
    s = Math.max(0, Math.min(len, s));
    let k = 1;
    while (k < n - 1 && cum[k] < s) k++;
    const t = cum[k] > cum[k - 1] ? (s - cum[k - 1]) / (cum[k] - cum[k - 1]) : 0;
    return [pts[k * 2 - 2] + (pts[k * 2] - pts[k * 2 - 2]) * t, pts[k * 2 - 1] + (pts[k * 2 + 1] - pts[k * 2 - 1]) * t];
  };
  /** Arc length of the route point nearest (x, z), searching forward from `from`. */
  let hint = 0;
  const sOf = (x: number, z: number): number => {
    let best = hint, bd = Infinity;
    for (let k = Math.max(1, hint); k < n; k++) {
      const ax = pts[k * 2 - 2], az = pts[k * 2 - 1], vx = pts[k * 2] - ax, vz = pts[k * 2 + 1] - az, L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)), d = Math.hypot(x - ax - vx * t, z - az - vz * t);
      if (d < bd) { bd = d; best = k; }
      if (bd < 0.5 && d > 60) break;
    }
    hint = best;
    const ax = pts[best * 2 - 2], az = pts[best * 2 - 1], vx = pts[best * 2] - ax, vz = pts[best * 2 + 1] - az, L2 = vx * vx + vz * vz || 1;
    return cum[best - 1] + Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)) * Math.sqrt(L2);
  };
  const heading = (s0: number, s1: number) => { const a = at(s0), b = at(s1); return Math.atan2(b[0] - a[0], b[1] - a[1]); };
  /** The first named road that is not a slip road from route link index i on. */
  const roadFrom = (i: number) => {
    for (let j = i; j < links.length && j < i + 12; j++) { const l = g.links[links[j]]; if (l.name && !isLink(l.cls)) return shortName(l.name); }
    return '';
  };

  // Decision points: a node where the route had a choice.
  const raw: { s: number; i: number; exit: boolean }[] = [];
  for (let i = 1; i < links.length; i++) {
    const a = g.links[links[i - 1]], b = g.links[links[i]];
    const options = g.out[a.to].filter((c) => c !== a.rev);
    if (options.length < 2) continue;
    // An exit is a slip road off a main road; a slip road onto one from a street is just the way on.
    raw.push({ s: sOf(g.nodeX[a.to], g.nodeZ[a.to]), i, exit: isLink(b.cls) && (a.cls === 'motorway' || a.cls === 'trunk' || a.hmax > 3) });
  }
  // Merge the ones a few metres apart; measure each turn over the span, from 25 m before to 35 m after.
  const out: Turn[] = [];
  for (let k = 0; k < raw.length;) {
    let j = k;
    while (j + 1 < raw.length && raw[j + 1].s - raw[j].s < MERGE) j++;
    const s0 = raw[k].s, s1 = raw[j].s;
    let d = heading(s1, s1 + 35) - heading(Math.max(0, s0 - 25), s0);
    while (d > Math.PI) d -= 2 * Math.PI;
    while (d < -Math.PI) d += 2 * Math.PI;
    const deg = d * 180 / Math.PI, a = Math.abs(deg);
    // Headings are atan2(x, z) with +X east and +Z south: a left turn raises it (north, π, to west, 3π/2).
    const left = deg > 0;
    const road = roadFrom(raw[j].i);
    const before = roadFrom(Math.max(0, raw[k].i - 1));
    const exit = raw.slice(k, j + 1).some((r) => r.exit);
    let kind: TurnKind | null = null;
    if (a > 150) kind = 'U';
    else if (a > 50) kind = left ? 'L' : 'R';
    else if (exit) kind = 'exit';
    else if (a > 20) kind = left ? 'SL' : 'SR';
    else if (road && road !== before) kind = 'S';
    // Taking the exit onto the ring's own side road is not "onto 东四环": say nothing rather than that.
    if (kind) out.push({ s: s1, kind, road: road === before ? '' : road });
    k = j + 1;
  }
  // A turn in the last few metres is the arrival itself.
  while (out.length && len - out[out.length - 1].s < 20) out.pop();
  out.push({ s: len, kind: 'arrive', road: '' });
  return out;
}
