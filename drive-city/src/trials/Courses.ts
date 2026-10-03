import type { LaneGraph } from '../traffic/LaneGraph';

/**
 * 计时赛 courses (2026-10-03): a stretch of one of the city's famous roads, driven one way from `from` to `to` along
 * the road named `key` (every section of it, 东三环中路 / 东三环北路, and the spans named after their bridges). The
 * line is walked on the lane graph, not routed: the router's shortest way would leave the ring at a slip road. Each
 * starts on a plain stretch between interchanges: a gate at one held the car at the foot of its deck.
 */
export interface CourseDef { id: string; zh: string; en: string; key: string; from: [number, number]; to: [number, number] }

export const COURSES: CourseDef[] = [
  { id: 'changan', zh: '长安街', en: "Chang'an Avenue", key: '长安街|复兴门|西长安街|东长安街|建国门|复兴门内|复兴门外', from: [-3500, 330], to: [4300, 195] },
  { id: 'e2', zh: '东二环', en: 'East 2nd Ring', key: '东二环', from: [2700, 700], to: [2560, -3380] },
  { id: 'e3', zh: '东三环', en: 'East 3rd Ring', key: '东三环', from: [4930, 1100], to: [4964, -4373] },
  { id: 'w2', zh: '西二环', en: 'West 2nd Ring', key: '西二环', from: [-4100, -2950], to: [-4661, 1424] },
  { id: 'e4', zh: '东四环', en: 'East 4th Ring', key: '东四环', from: [7356, 300], to: [7150, -5200] },
  { id: 'n4', zh: '北四环', en: 'North 4th Ring', key: '北四环', from: [-1500, -8640], to: [5554, -6872] },
  { id: 'jingtong', zh: '京通快速路', en: 'Jingtong Expressway', key: '京通快速|建国路', from: [8500, 140], to: [12300, 80] },
];

export interface Course { def: CourseDef; links: number[]; s0: number; len: number }

/** Main lines first: a ring road's 辅路 carries its name too. */
const RANK: Record<string, number> = { motorway: 0, trunk: 0, primary: 1, secondary: 2, tertiary: 3 };

/** The course's links from the start, and the arc length on the first where it begins; null when the road cannot be followed. */
export function walkCourse(g: LaneGraph, def: CourseDef, log?: string[]): Course | null {
  const key = new RegExp(def.key);
  const [fx, fz] = def.from, [tx, tz] = def.to;
  const goal = Math.hypot(tx - fx, tz - fz);
  // the road's own sections, the spans named after their bridges, and the pieces OSM left without a name
  const ok = (name: string) => key.test(name) || /桥$/.test(name) || name === '';
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  // the start: the nearest carriageway of the road heading towards the end
  let start = -1, s0 = 0, bd = Infinity;
  for (const id of g.near(fx, fz, 300)) {
    const l = g.links[id], rank = RANK[l.cls];
    if (!key.test(l.name) || rank === undefined) continue;
    const p = g.project(l, fx, fz, l.len / 2);
    if (p.d > 300) continue;
    g.at(l, p.s, 0, at);
    if (at.dx * (tx - fx) / goal + at.dz * (tz - fz) / goal < 0.5) continue;
    const score = p.d + rank * 120;
    if (score < bd) { bd = score; start = id; s0 = p.s; }
  }
  if (start < 0) { log?.push('no start'); return null; }
  log?.push(`start ${g.links[start].name} ${g.links[start].cls} s ${s0.toFixed(0)}`);
  const links = [start];
  let len = g.links[start].len - s0, id = start;
  for (let hop = 0; hop < 400; hop++) {
    const l = g.links[id];
    g.at(l, l.len, 0, at);
    if (Math.hypot(at.x - tx, at.z - tz) < 90) return { def, links, s0, len };
    const hx = l.d1x, hz = l.d1z;
    let best = -1, bs = Infinity;
    for (const nx of g.out[l.to]) {
      const n = g.links[nx];
      if (nx === l.rev || n.cls.endsWith('_link') || !ok(n.name)) continue;
      const turn = Math.acos(Math.max(-1, Math.min(1, hx * n.d0x + hz * n.d0z)));
      if (turn > 0.6) continue;
      const score = turn + (key.test(n.name) ? 0 : n.name ? 0.3 : 0.15) + Math.max(0, (RANK[n.cls] ?? 4) - (RANK[l.cls] ?? 4)) * 0.4;
      if (score < bs) { bs = score; best = nx; }
    }
    if (best < 0) { log?.push(`stuck after ${l.name} ${l.cls} at ${at.x.toFixed(0)},${at.z.toFixed(0)}: out ${g.out[l.to].map((q) => `${g.links[q].name || '-'}/${g.links[q].cls}/${(Math.acos(Math.max(-1, Math.min(1, hx * g.links[q].d0x + hz * g.links[q].d0z))) * 57.3).toFixed(0)}deg`).join(' ')}`); return null; }
    id = best; links.push(id); len += g.links[id].len;
    // past the end without reaching it: the end is not on this road
    if (len > goal * 1.6 + 500) { log?.push(`overshot at ${at.x.toFixed(0)},${at.z.toFixed(0)}`); return null; }
    // stop on the link that passes the end
    const n = g.links[id], p = g.project(n, tx, tz, n.len / 2);
    if (p.d < 90 && p.s > 1 && p.s < n.len - 1) { len -= n.len - p.s; return { def, links, s0, len }; }
  }
  return null;
}
