import type { Network } from './Data';
import type { LaneGraph, Link } from '../traffic/LaneGraph';

/**
 * Guide signs (指路标志) from the drivable graph, so a driver can find the way without the map
 * (2026-09-29, 「增加路牌，不要让用户迷路」). Three kinds, as Beijing puts them up:
 *
 * - `cross` (交叉路口预告): before a junction on a named street, the junction drawn as arrows with
 *   the road each one leads onto - straight on, left, right.
 * - `exit` (出口预告): on an expressway or a main road with slip roads, before a slip road leaves:
 *   出口 EXIT, the interchange's name (朝阳公园桥) and the road the slip road takes you to.
 * - `ahead` (前方): after each interchange on an expressway, the road and the way it runs (东四环 北)
 *   and the next interchanges with their distances (双新桥 1.2 km, 东风北桥 2.5 km).
 *
 * Every sign hangs from a cantilever at the right-hand kerb over the outer lanes, 5.5 m up (street
 * trees crowd the pavements, and a sign on posts there would be inside their crowns); on a deck the
 * pole stands on the parapet. Also `closures`: where a road runs off the edge of the data, a row of
 * barriers across it and a 前方道路封闭 board.
 *
 * Pure (a LaneGraph in, plain records out) so tests can run it on the real city in Node.
 */

export type SignKind = 'cross' | 'exit' | 'ahead';
export type ArmDir = 'L' | 'S' | 'R';
export interface SignLine { name: string; en: string; km?: number; dir?: ArmDir }
export interface GuideSign {
  kind: SignKind;
  /** Green on motorways (高速, 京通快速路), blue everywhere else. */
  colour: 'blue' | 'green';
  /** Pole foot and the height of what it stands on (a deck's surface, or 0). */
  x: number; z: number; y: number;
  /** Rotation about +Y taking local +Z to the face's normal (it faces the traffic coming at it); local -X is over the road. */
  yaw: number;
  /** Plate centre's horizontal distance from the pole, over the road, and the plate's size. */
  reach: number; w: number; h: number;
  /** Plate bottom above the base. */
  clear: number;
  /** cross: one line per arm (dir L/S/R). exit: the interchange (or road) first, then where it leads. ahead: the road, then the interchanges ahead with `km`. */
  lines: SignLine[];
  /** ahead: the way the road runs here (北, 东...). */
  heading?: string;
  /** Link and arc length the sign stands at (for tests and probes). */
  link: number; s: number;
}
export interface Closure { x: number; z: number; y: number; yaw: number; width: number }

const RANK: Record<string, number> = { motorway: 5, trunk: 5, primary: 4, secondary: 3, tertiary: 2, unclassified: 1, residential: 1, living_street: 0, service: 0, busway: 0 };
const isLink = (c: string) => c.endsWith('_link');
const MAIN = new Set(['motorway', 'trunk']);
/** Plate bottom over the road (the city's decks are 6.5 m apart; everything else drives under 4.5 m). */
export const CLEARANCE = 5.5;
export const PLATE = { cross: [4.4, 2.5], exit: [4.8, 2.2], ahead: [4.8, 2.7] } as const;

const COMPASS = (dx: number, dz: number) => (Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? '东' : '西') : dz > 0 ? '南' : '北');
/** 东四环中路 -> 东四环: a ring road is signed by its ring, not its section; OSM's 京通快速 / 京通快速道路 are 京通快速路. */
export const shortName = (n: string) => n.replace(/^([东西南北][二三四五]环)[东西南北中]?路?$/, '$1').replace(/快速(道路)?$/, '快速路');

export function placeSigns(g: LaneGraph, net: Network, regions?: number[][]): { signs: GuideSign[]; closures: Closure[] } {
  const L = g.links, n = g.nodeX.length;
  const into: number[][] = Array.from({ length: n }, () => []);
  for (const l of L) into[l.to].push(l.id);
  const deg = new Int32Array(n);
  for (const l of L) { deg[l.from]++; deg[l.to]++; }
  const en = net.en ?? {};
  const pin = (name: string) => en[name] ?? '';
  const tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  const junction = (v: number) => g.out[v].length + into[v].length >= 3 && new Set([...g.out[v], ...into[v]].map((id) => (L[id].rev >= 0 ? Math.min(id, L[id].rev) : id))).size >= 3;

  /**
   * Which road a link is part of: its name (a ring by its ring: 东四环中路 runs on as 东四环北路), or ''
   * when it has none of its own - unnamed, or a main road's span over an interchange named after it
   * (OSM calls 东四环's deck at 红领巾桥 "红领巾桥"), which belongs to whatever runs straight through it.
   */
  const keyOf = (l: Link) => (!l.name || (/桥$/.test(l.name) && !isLink(l.cls)) ? '' : shortName(l.name));
  const same = (a: Link, b: Link) => { const ka = keyOf(a), kb = keyOf(b); return ka && kb ? ka === kb : a.cls === b.cls; };
  /** The straightest way on after `l` along the same road, or -1 (straighter still across a span with no name of its own). */
  const onward = (l: Link): number => {
    let best = -1, bs = -1;
    for (const c of g.out[l.to]) {
      if (c === l.rev) continue;
      const o = L[c];
      if (!same(l, o)) continue;
      const d = l.d1x * o.d0x + l.d1z * o.d0z;
      if (d > (keyOf(l) && keyOf(o) ? 0.55 : 0.85) && d > bs) { bs = d; best = c; }
    }
    return best;
  };
  const backward = (l: Link): number => {
    let best = -1, bs = -1;
    for (const c of into[l.from]) {
      const o = L[c];
      if (o.id === l.rev || !same(l, o)) continue;
      const d = l.d0x * o.d1x + l.d0z * o.d1z;
      if (d > (keyOf(l) && keyOf(o) ? 0.55 : 0.85) && d > bs) { bs = d; best = c; }
    }
    return best;
  };
  /** `dist` metres before arc length `s` on `l`, walking back along the road: [link, s], or null if the road starts first. */
  const walkBack = (l: Link, s: number, dist: number): [Link, number] | null => {
    let cur = l, at = s - dist, guard = 0;
    while (at < 0 && guard++ < 30) {
      const p = backward(cur);
      if (p < 0) return null;
      cur = L[p]; at += cur.len;
    }
    return at >= 0 ? [cur, at] : null;
  };
  const walkOn = (l: Link, s: number, dist: number): [Link, number] | null => {
    let cur = l, at = s + dist, guard = 0;
    while (at > cur.len && guard++ < 30) {
      const q = onward(cur);
      if (q < 0) return null;
      at -= cur.len; cur = L[q];
    }
    return at <= cur.len ? [cur, at] : null;
  };
  /** Where taking `l` leads: the first named road that is not a slip road, a service road (辅路) or the road left, following the straightest way (<= 1.5 km). */
  const through = (name: string, from: string) => !name || /辅路$|桥$/.test(name) || (!!from && shortName(name) === shortName(from));
  const destOf = (l: Link, from: string): SignLine | null => {
    let cur = l, run = 0, guard = 0;
    while (guard++ < 40) {
      if (!isLink(cur.cls) && !through(cur.name, from)) return { name: shortName(cur.name), en: pin(shortName(cur.name)) || pin(cur.name) };
      run += cur.len;
      if (run > 1500) return null;
      let best = -1, bs = -2;
      for (const c of g.out[cur.to]) {
        if (c === cur.rev) continue;
        const o = L[c], d = cur.d1x * o.d0x + cur.d1z * o.d0z + (!isLink(o.cls) && !through(o.name, from) ? 0.3 : 0);
        if (d > bs) { bs = d; best = c; }
      }
      if (best < 0) return null;
      cur = L[best];
    }
    return null;
  };

  // g.project searches near its hint only; this one scans the whole polyline.
  const projectAll = (o: Link, x: number, z: number) => {
    let best = { s: 0, d: Infinity };
    for (let k = 1; k < o.cum.length; k++) {
      const ax = o.pts[k * 2 - 2], az = o.pts[k * 2 - 1], vx = o.pts[k * 2] - ax, vz = o.pts[k * 2 + 1] - az, L2 = vx * vx + vz * vz || 1;
      const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)), d = Math.hypot(x - ax - vx * t, z - az - vz * t);
      if (d < best.d) best = { s: o.cum[k - 1] + t * Math.sqrt(L2), d };
    }
    return best;
  };
  const proj = projectAll;
  // Links by 32 m cell along every segment, not only at their points: g.near indexes points, and a deck's
  // straight run between two points 200 m apart passed over a sign's spot unseen - the plate of a sign
  // for the street under 东四环 at 百子湾路 stood up through the deck (「路牌嵌入到了马路里」).
  const CELL = 32, segGrid = new Map<number, number[]>();
  const ck = (ix: number, iz: number) => ix * 100003 + iz;
  for (const o of L) {
    for (let k = 1; k < o.cum.length; k++) {
      const ax = o.pts[k * 2 - 2], az = o.pts[k * 2 - 1], bx = o.pts[k * 2], bz = o.pts[k * 2 + 1];
      const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, bz - az) / (CELL / 2)));
      for (let j = 0; j <= n; j++) {
        const key = ck(Math.floor((ax + (bx - ax) * j / n) / CELL), Math.floor((az + (bz - az) * j / n) / CELL));
        const list = segGrid.get(key) ?? segGrid.set(key, []).get(key)!;
        if (list[list.length - 1] !== o.id) list.push(o.id);
      }
    }
  }
  /** Links with a segment passing within about a cell of (x, z). */
  const nearLinks = (x: number, z: number): Set<number> => {
    const out = new Set<number>(), cx = Math.floor(x / CELL), cz = Math.floor(z / CELL);
    for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) for (const id of segGrid.get(ck(cx + i, cz + j)) ?? []) out.add(id);
    return out;
  };
  /** Not in any carriageway at about the same height (a pole's spot). */
  const clearOfRoads = (x: number, z: number, y: number, margin: number) => {
    for (const id of nearLinks(x, z)) {
      const o = L[id], p = proj(o, x, z);
      if (p.d < o.hw + margin && Math.abs(g.heightAt(o, p.s) - y) < 3.5) return false;
    }
    return true;
  };
  /** Nothing overhead between the base and the top of the plate (a deck passing over the spot). */
  const clearOverhead = (x: number, z: number, y: number, top: number) => {
    for (const id of nearLinks(x, z)) {
      const o = L[id];
      if (!o.h) continue;
      const p = proj(o, x, z);
      if (p.d > o.hw + 1.5) continue;
      const h = g.heightAt(o, p.s);
      if (h > y + 1.5 && h < y + top + 1.5) return false;
    }
    return true;
  };

  const signs: GuideSign[] = [];
  const placed: { x: number; z: number; dx: number; dz: number; y: number }[] = [];
  /** Put a sign at arc length s on l (right kerb), if the pole has room and no sign on this carriageway is within `gap`. */
  const put = (kind: SignKind, l: Link, s: number, lines: SignLine[], gap: number, heading?: string): boolean => {
    g.at(l, s, 0, tmp);
    const cx = tmp.x, cz = tmp.z, dx = tmp.dx, dz = tmp.dz, y = g.heightAt(l, s);
    for (const p of placed) if (Math.hypot(p.x - cx, p.z - cz) < gap && p.dx * dx + p.dz * dz > 0.7 && Math.abs(p.y - y) < 3) return false;
    const [w, h] = PLATE[kind];
    // Right of travel is (-dz, dx). Ground: on the pavement; deck: on the parapet (Roads.ts: hw + 0.05 .. + 0.45).
    const up = y > 0.4;
    for (const extra of up ? [0.25] : [1.0, 1.8, 2.6]) {
      const off = l.hw + extra, px = cx - dz * off, pz = cz + dx * off;
      if (!clearOfRoads(px, pz, y, up ? 0.1 : 0.4)) continue;
      // Over the lanes, clear of the street trees' crowns (they stand 2.2 m out and hang over the kerb): the
      // plate's right edge 2 m in from the kerb, or as far as the carriageway's middle allows on a narrow road.
      const reach = Math.max(extra + w / 2 - 0.4, Math.min(extra + 2 + w / 2, off));
      const qx = px + dz * reach, qz = pz - dx * reach;
      // The pole, the plate's middle and both its ends.
      if (![[px, pz], [qx, qz], [qx + dz * w / 2, qz - dx * w / 2], [qx - dz * w / 2, qz + dx * w / 2]].every(([ox, oz]) => clearOverhead(ox, oz, y, CLEARANCE + h))) continue;
      const colour = l.cls === 'motorway' || l.cls === 'motorway_link' ? 'green' : 'blue';
      signs.push({ kind, colour, x: px, z: pz, y, yaw: Math.atan2(-dx, -dz), reach, w, h, clear: CLEARANCE, lines, heading, link: l.id, s });
      placed.push({ x: cx, z: cz, dx, dz, y });
      return true;
    }
    return false;
  };

  const mainline = (l: Link) => MAIN.has(l.cls);

  // --- exit: before each slip road leaving a main road -------------------------------------------
  const bridges = (net.br ?? []).map(([x, z, name]) => ({ x, z, name }));
  const nearestBridge = (x: number, z: number, r: number) => {
    let best: (typeof bridges)[number] | null = null, bd = r;
    for (const b of bridges) { const d = Math.hypot(b.x - x, b.z - z); if (d < bd) { bd = d; best = b; } }
    return best;
  };
  /**
   * The interchange a slip road belongs to: the first named one its path passes (it may run 500 m
   * before it reaches the bridge it serves), else the first the main road passes within 500 m ahead.
   */
  const bridgeFor = (l: Link, ramp: Link): (typeof bridges)[number] | null => {
    let cur = ramp, run = 0, guard = 0;
    while (guard++ < 20 && run < 900) {
      for (let k = 0; k < cur.cum.length; k++) { const nb = nearestBridge(cur.pts[k * 2], cur.pts[k * 2 + 1], 110); if (nb) return nb; }
      run += cur.len;
      if (!isLink(cur.cls)) break;
      let best = -1, bs = -2;
      for (const c of g.out[cur.to]) { if (c === cur.rev) continue; const d = cur.d1x * L[c].d0x + cur.d1z * L[c].d0z; if (d > bs) { bs = d; best = c; } }
      if (best < 0) break;
      cur = L[best];
    }
    for (let d = 0; d <= 500; d += 20) {
      const at = walkOn(l, l.len, d);
      if (!at) break;
      g.at(at[0], at[1], 0, tmp);
      const nb = nearestBridge(tmp.x, tmp.z, 100);
      if (nb) return nb;
    }
    return null;
  };
  for (const l of L) {
    if (!mainline(l) && !(RANK[l.cls] >= 4 && l.oneway && l.name)) continue;
    const cont = onward(l);
    if (cont < 0) continue;
    const ramps = g.out[l.to].filter((c) => c !== l.rev && c !== cont && isLink(L[c].cls));
    if (!ramps.length) continue;
    const r = L[ramps[0]];
    // A slip road peeling off to the right (the city has left exits too; they are signed the same).
    const dest = destOf(r, l.name);
    const br = bridgeFor(l, r);
    if (!dest && !br) continue;
    const lines: SignLine[] = [];
    if (br) lines.push({ name: br.name, en: pin(br.name) });
    if (dest && dest.name !== br?.name) lines.push({ ...dest, dir: (l.d1x * r.d0z - l.d1z * r.d0x) < 0 ? 'L' : 'R' });
    else if (lines.length) lines[0].dir = (l.d1x * r.d0z - l.d1z * r.d0x) < 0 ? 'L' : 'R';
    for (const d of mainline(l) ? [260, 200, 150, 110] : [120, 90, 60]) {
      const at = walkBack(l, l.len, d);
      if (at && put('exit', at[0], at[1], lines, 90)) break;
    }
  }

  // --- ahead: after each interchange on a main road, the next ones ------------------------------
  // Each carriageway of a main road walked end to end (as one chain across its sections' names),
  // noting where it passes each named interchange; 200 m past one, a sign lists the next three.
  const visited = new Uint8Array(L.length);
  const chainStarts: number[] = [];
  for (const l of L) if (mainline(l) && backward(l) < 0) chainStarts.push(l.id);
  for (const l of L) if (mainline(l)) chainStarts.push(l.id); // rings closed on themselves; visited ones are skipped
  for (const startId of chainStarts) {
    if (visited[startId]) continue;
    const samples: { l: Link; s: number; x: number; z: number; run: number; road: string }[] = [];
    let cur: Link | null = L[startId], run = 0, guard = 0, road = keyOf(L[startId]);
    while (cur && !visited[cur.id] && guard++ < 400) {
      visited[cur.id] = 1;
      if (keyOf(cur)) road = keyOf(cur);
      for (let s = 0; s < cur.len; s += 10) { g.at(cur, s, 0, tmp); samples.push({ l: cur, s, x: tmp.x, z: tmp.z, run: run + s, road }); }
      run += cur.len;
      const q = onward(cur);
      cur = q >= 0 ? L[q] : null;
    }
    if (run < 400) continue;
    // Passings: [name, first run, last run], in order.
    const pass: { name: string; a: number; b: number }[] = [];
    for (const p of samples) {
      const nb = nearestBridge(p.x, p.z, 100);
      if (!nb) continue;
      const last = pass[pass.length - 1];
      // One passing per interchange: its points (stops round the outside, signals, spans) are spread over 500 m or more.
      const same = pass.find((q) => q.name === nb.name && p.run - q.b < 900);
      if (same) same.b = p.run;
      else pass.push({ name: nb.name, a: p.run, b: p.run });
    }
    if (!pass.length) continue;
    const sampleAt = (r: number) => samples[Math.min(samples.length - 1, Math.max(0, Math.round(r / 10)))];
    const spots = [...(pass[0].a > 700 ? [120] : []), ...pass.map((q) => q.b + 200)];
    for (const at of spots) {
      if (at > run - 30) continue;
      const next = pass.filter((q) => (q.a + q.b) / 2 > at + 80).slice(0, 3);
      if (!next.length) continue;
      const sp = sampleAt(at), far = sampleAt(at + 800);
      if (!sp.road) continue;
      const lines: SignLine[] = [{ name: sp.road, en: (pin(sp.road) || pin(sp.l.name)).replace(/ [NSEWM]$/, '') },
        ...next.map((q) => ({ name: q.name, en: pin(q.name), km: Math.max(0.1, Math.round(((q.a + q.b) / 2 - at) / 100) / 10) }))];
      for (const dd of [0, 40, -40, 80, 130, 180]) {
        const p = sampleAt(at + dd);
        if (put('ahead', p.l, p.s, lines, 150, COMPASS(far.x - sp.x, far.z - sp.z))) break;
      }
    }
  }

  // --- cross: before junctions of named streets -------------------------------------------------
  for (const l of L) {
    if (!l.name || isLink(l.cls) || (RANK[l.cls] ?? 0) < 2 || l.hmax > 0.3 || l.len < 45) continue;
    const J = l.to;
    if (!junction(J)) continue;
    // The junction as a cluster: a dual carriageway crosses another in four nodes, 15-40 m apart.
    const cluster = new Set([J]);
    const queue = [J];
    while (queue.length) {
      const v = queue.pop()!;
      for (const c of g.out[v]) {
        const o = L[c];
        if (o.len < 42 && junction(o.to) && !cluster.has(o.to) && Math.hypot(g.nodeX[o.to] - g.nodeX[J], g.nodeZ[o.to] - g.nodeZ[J]) < 60) { cluster.add(o.to); queue.push(o.to); }
      }
    }
    const arms: Partial<Record<ArmDir, { line: SignLine; rank: number }>> = {};
    for (const v of cluster) for (const c of g.out[v]) {
      const o = L[c];
      if (cluster.has(o.to) || c === l.rev) continue;
      g.at(o, Math.min(25, o.len), 0, tmp);
      const ex = tmp.x - g.nodeX[J], ez = tmp.z - g.nodeZ[J], el = Math.hypot(ex, ez) || 1;
      const dot = (l.d1x * ex + l.d1z * ez) / el, cross = (l.d1x * ez - l.d1z * ex) / el;
      if (dot < -0.5) continue; // back the way we came (the other carriageway)
      const dir: ArmDir = dot > 0.72 ? 'S' : cross < 0 ? 'L' : 'R';
      const line = o.name && !isLink(o.cls) ? { name: o.name, en: pin(o.name) } : destOf(o, '');
      if (!line) continue;
      const rank = (RANK[o.cls] ?? 0) + (o.name === l.name ? 0.5 : 0);
      if (!arms[dir] || rank > arms[dir]!.rank) arms[dir] = { line: { ...line, dir }, rank };
    }
    const side = [arms.L, arms.R].filter((a) => a && a.line.name !== l.name && a.rank >= ((RANK[l.cls] ?? 0) >= 4 ? 1 : 2));
    if (!side.length) continue;
    const lines = (['L', 'S', 'R'] as ArmDir[]).map((d) => arms[d]?.line).filter((q): q is SignLine => !!q);
    const d = (RANK[l.cls] ?? 0) >= 4 ? 90 : 60;
    put('cross', l, Math.max(15, l.len - d), lines, 70);
  }

  // --- closures: roads running off the edge of the data ------------------------------------------
  // Across a road's end where it runs off the data (and across a one-way's start there too: it is the
  // way out for anyone driving it the wrong way). The network, like the tiles, stops at the last
  // segment whose middle is inside, and past a node the next segment can be a few hundred metres long
  // (东四环 stops 76 m short of the edge), so "near" is 160 m on.
  const closures: Closure[] = [];
  if (regions?.length) {
    const inside = (x: number, z: number) => regions.some((r) => x >= r[0] && x <= r[2] && z >= r[1] && z <= r[3]);
    const done = new Set<number>();
    const close = (l: Link, s: number, facing: 1 | -1) => {
      g.at(l, s, 0, tmp);
      if (closures.some((c) => Math.hypot(c.x - tmp.x, c.z - tmp.z) < 6)) return;
      // Faces the traffic heading out: along -travel for an end, +travel for a start.
      closures.push({ x: tmp.x, z: tmp.z, y: g.heightAt(l, s), yaw: facing > 0 ? Math.atan2(-tmp.dx, -tmp.dz) : Math.atan2(tmp.dx, tmp.dz), width: l.hw * 2 + 1 });
    };
    for (const l of L) {
      if (done.has(l.id) || l.len < 20 || ((RANK[l.cls] ?? 0) < 1 && !isLink(l.cls))) continue;
      const end = !g.out[l.to].some((c) => c !== l.rev), start = !into[l.from].some((c) => c !== l.rev);
      if (end) {
        const ex = g.nodeX[l.to], ez = g.nodeZ[l.to];
        if (!inside(ex + l.d1x * 160, ez + l.d1z * 160) || !inside(ex, ez)) {
          done.add(l.id); if (l.rev >= 0) done.add(l.rev);
          let s = Math.max(0, l.len - 12);
          for (let k = 0; k < 20 && s > 0; k++) { g.at(l, s, 0, tmp); if (inside(tmp.x, tmp.z)) break; s -= 10; }
          close(l, Math.max(0, s), 1);
        }
      }
      if (start && l.oneway) {
        const sx = g.nodeX[l.from], sz = g.nodeZ[l.from];
        if (!inside(sx - l.d0x * 160, sz - l.d0z * 160) || !inside(sx, sz)) {
          let s = Math.min(l.len, 12);
          for (let k = 0; k < 20 && s < l.len; k++) { g.at(l, s, 0, tmp); if (inside(tmp.x, tmp.z)) break; s += 10; }
          close(l, Math.min(l.len, s), -1);
        }
      }
    }
  }
  return { signs, closures };
}
