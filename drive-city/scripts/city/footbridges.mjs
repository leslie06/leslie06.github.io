// Footbridges (过街天桥, 2026-10-02): OSM's foot bridges that cross a car road on the ground, as decks at
// DECK_Y with stairs down at their ends and piers off the carriageways, into public/city/footbridges.json
// for city/visual/Footbridges.ts. Each bridge way is one deck: the stretch from the first crossing's far
// kerb to the last's plus MARGIN (extended past the way's end when OSM stops it at the kerb). At a free
// end a straight stair runs down STAIR_RUN metres - along an OSM steps way joined there, else along the
// rest of the way past the deck, else straight on, else turned to either side, whichever keeps clear of
// carriageways, buildings, water and the other stairs. Two decks whose ends meet are joined (the arms
// of a junction's bridge). Skipped: a bridge way with a raised car road beside or over it (an
// overpass's own footway), and park bridges (they cross no car road).
// Run by build.mjs at its end; by hand: node scripts/city/footbridges.mjs
// Data © OpenStreetMap contributors, ODbL.
import fs from 'node:fs';
import path from 'node:path';
import { REGIONS, TILE, project } from './region.mjs';

const DIR = path.resolve('public/city');
const OSM = path.resolve('.cache/osm');
/** Deck top, the stair's run (two flights and a landing), the margin past the kerbs, longest unsupported span. */
const DECK_Y = 6, STAIR_RUN = 14, MARGIN = 2.5, SPAN = 24;
const FOOT = /^(footway|path|pedestrian|cycleway)$/;
const CAR = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|busway)(_link)?$/;
const ANY_CAR = /^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|busway)(_link)?$/;

const man = JSON.parse(fs.readFileSync(path.join(DIR, 'manifest.json'), 'utf8'));
const inRegion = (lat, lon) => REGIONS.some((b) => lat >= b.s && lat <= b.n && lon >= b.w && lon <= b.e);

const ways = new Map(), steps = new Map(), nodeSteps = new Map();
for (const f of fs.readdirSync(OSM).filter((f) => /^chunk.*\.json$/.test(f))) {
  for (const e of JSON.parse(fs.readFileSync(path.join(OSM, f), 'utf8')).elements) {
    if (e.type !== 'way' || !e.geometry) continue;
    const h = e.tags.highway ?? '';
    if (h === 'steps') { if (!steps.has(e.id)) { steps.set(e.id, e); for (const n of [e.nodes[0], e.nodes.at(-1)]) (nodeSteps.get(n) ?? nodeSteps.set(n, []).get(n)).push(e); } continue; }
    if (!FOOT.test(h) || !e.tags.bridge || e.tags.bridge === 'no' || ways.has(e.id)) continue;
    if (!e.geometry.some((g) => inRegion(g.lat, g.lon))) continue;
    ways.set(e.id, e);
  }
}

const tiles = new Map();
const tileAt = (ix, iz) => {
  const k = `${ix}_${iz}`;
  if (!tiles.has(k)) tiles.set(k, man.tiles[k] ? JSON.parse(fs.readFileSync(path.join(DIR, `t_${k}.json`), 'utf8')) : null);
  return tiles.get(k);
};
/** Tiles within r of any of the points. */
const tilesNear = (P, r) => {
  const ks = new Set(), out = [];
  for (const [x, z] of P) for (let dx = -r; dx <= r; dx += r) for (let dz = -r; dz <= r; dz += r) ks.add(`${Math.floor((x + dx) / TILE)}_${Math.floor((z + dz) / TILE)}`);
  for (const k of ks) { const [ix, iz] = k.split('_').map(Number); const t = tileAt(ix, iz); if (t) out.push(t); }
  return out;
};
const pip = (x, z, o) => { let c = false; for (let i = 0, j = o.length - 2; i < o.length; j = i, i += 2) if ((o[i + 1] > z) !== (o[j + 1] > z) && x < (o[j] - o[i]) * (z - o[i + 1]) / (o[j + 1] - o[i + 1]) + o[i]) c = !c; return c; };
const segDist = (x, z, ax, az, bx, bz) => { const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1, t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L)); return Math.hypot(x - ax - vx * t, z - az - vz * t); };
const isect = (ax, az, bx, bz, cx, cz, dx, dz) => { const d = (bx - ax) * (dz - cz) - (bz - az) * (dx - cx); if (!d) return -1; const t = ((cx - ax) * (dz - cz) - (cz - az) * (dx - cx)) / d, u = ((cx - ax) * (bz - az) - (cz - az) * (bx - ax)) / d; return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? t : -1; };

/** Polyline with arc lengths; `at(s)` extrapolates past either end along the end segment. */
function line(P) {
  const S = [0];
  for (let i = 1; i < P.length; i++) S.push(S[i - 1] + Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]));
  const L = S.at(-1);
  const at = (s) => {
    let i = 1;
    while (i < P.length - 1 && S[i] < s) i++;
    const a = P[i - 1], b = P[i], l = S[i] - S[i - 1] || 1, t = (s - S[i - 1]) / l;
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  /** Points from s0 to s1 with the vertices in between. */
  const cut = (s0, s1) => { const out = [at(s0)]; for (let i = 0; i < P.length; i++) if (S[i] > s0 + 0.5 && S[i] < s1 - 0.5) out.push(P[i]); out.push(at(s1)); return out; };
  return { P, S, L, at, cut };
}

const bridges = [];
let skippedLifted = 0, noCross = 0;
for (const w of [...ways.values()].sort((a, b) => a.id - b.id)) {
  const P = w.geometry.map((g) => project(g.lat, g.lon));
  const ln = line(P);
  if (ln.L < 4) continue;
  const T = tilesNear(P, 60);
  const segs = [];
  for (const t of T) for (const r of t.roads) {
    if (!ANY_CAR.test(r.c)) continue;
    for (let i = 0; i + 3 < r.p.length; i += 2) {
      const h = r.h ? Math.max(r.h[i / 2] ?? 0, r.h[i / 2 + 1] ?? 0) : 0;
      segs.push({ ax: r.p[i], az: r.p[i + 1], bx: r.p[i + 2], bz: r.p[i + 3], hw: r.w / 2, c: r.c, h });
    }
  }
  // the crossings (car roads on the ground) and anything raised it runs beside or under
  const cross = [];
  let lifted = false;
  for (let i = 0; i + 1 < P.length; i++) {
    const [ax, az] = P[i], [bx, bz] = P[i + 1], sl = ln.S[i + 1] - ln.S[i];
    for (const q of segs) {
      if (q.h > 2.5) {
        for (let k = 0; k <= 4 && !lifted; k++) { const x = ax + (bx - ax) * k / 4, z = az + (bz - az) * k / 4; if (segDist(x, z, q.ax, q.az, q.bx, q.bz) < q.hw + 2) lifted = true; }
        continue;
      }
      if (q.h > 1 || !CAR.test(q.c)) continue;
      const t = isect(ax, az, bx, bz, q.ax, q.az, q.bx, q.bz);
      if (t < 0) continue;
      const ql = Math.hypot(q.bx - q.ax, q.bz - q.az) || 1;
      const sin = Math.abs(((bx - ax) * (q.bz - q.az) - (bz - az) * (q.bx - q.ax)) / (sl * ql || 1));
      cross.push({ s: ln.S[i] + sl * t, half: q.hw / Math.max(0.45, sin) });
    }
  }
  if (lifted) { skippedLifted++; continue; }
  if (!cross.length) { noCross++; continue; }
  let s0 = Math.min(...cross.map((c) => c.s - c.half)) - MARGIN, s1 = Math.max(...cross.map((c) => c.s + c.half)) + MARGIN;
  // an end just past the deck's: take the deck to it (where the arms of a bridge meet)
  if (s0 > 0 && s0 < 6) s0 = 0;
  if (s1 < ln.L && s1 > ln.L - 6) s1 = ln.L;
  const width = Math.min(6, Math.max(3, parseFloat(w.tags.width) || 3.6));
  bridges.push({ id: w.id, w, ln, s0, s1, width, segs, T, deck: ln.cut(s0, s1), ends: [null, null] });
}

// --- joints: deck ends of two bridges within 8 m are joined by a deck between them
const endPt = (b, k) => (k ? b.deck.at(-1) : b.deck[0]);
for (let i = 0; i < bridges.length; i++) for (let k = 0; k < 2; k++) {
  if (bridges[i].ends[k]) continue;
  const p = endPt(bridges[i], k);
  for (let j = i + 1; j < bridges.length; j++) for (let m = 0; m < 2; m++) {
    if (bridges[j].ends[m]) continue;
    const q = endPt(bridges[j], m);
    if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 8) { bridges[i].ends[k] = { joint: j }; bridges[j].ends[m] = { joint: i }; }
  }
}
// the joined end of the first takes the deck on to the other's end point
for (let i = 0; i < bridges.length; i++) for (let k = 0; k < 2; k++) {
  const e = bridges[i].ends[k];
  if (!e || e.joint < i) continue;
  const o = bridges[e.joint], m = o.ends[0]?.joint === i ? 0 : 1, q = endPt(o, m);
  if (k) bridges[i].deck.push([...q]); else bridges[i].deck.unshift([...q]);
}

// --- stairs
const unit = (x, z) => { const l = Math.hypot(x, z) || 1; return [x / l, z / l]; };
const stairRing = (tx, tz, dx, dz, w) => {
  const nx = -dz * w / 2, nz = dx * w / 2, bx = tx + dx * STAIR_RUN, bz = tz + dz * STAIR_RUN;
  return [tx + nx, tz + nz, bx + nx, bz + nz, bx - nx, bz - nz, tx - nx, tz - nz];
};
const ringsOverlap = (a, b) => {
  for (let i = 0; i < a.length; i += 2) if (pip(a[i], a[i + 1], b)) return true;
  for (let i = 0; i < b.length; i += 2) if (pip(b[i], b[i + 1], a)) return true;
  for (let i = 0; i < a.length; i += 2) for (let j = 0; j < b.length; j += 2) if (isect(a[i], a[i + 1], a[(i + 2) % a.length], a[(i + 3) % a.length], b[j], b[j + 1], b[(j + 2) % b.length], b[(j + 3) % b.length]) >= 0) return true;
  return false;
};
const placedStairs = [];
let stairsSteps = 0, stairsWay = 0, stairsStraight = 0, stairsTurned = 0, stairsForced = 0;
for (const b of bridges) {
  const bld = b.T.flatMap((t) => t.buildings.filter((x) => x.k !== 'wall' && (x.m ?? 0) < 3));
  const water = b.T.flatMap((t) => t.areas.filter((a) => a.k === 'water'));
  // how bad a stair is: in a carriageway (never), in a building, in water, on another stair
  const bad = (r, tx, tz, dx, dz) => {
    for (let k = 0; k <= STAIR_RUN; k += 1) {
      for (const o of [-0.5, 0, 0.5]) {
        const x = tx + dx * k - dz * o * b.width, z = tz + dz * k + dx * o * b.width;
        for (const q of b.segs) if (q.h < 1 && segDist(x, z, q.ax, q.az, q.bx, q.bz) < q.hw + 0.3) return 100;
      }
    }
    let v = 0;
    if (bld.some((x) => ringsOverlap(r, x.o))) v += 10;
    if (water.some((a) => pip(tx + dx * STAIR_RUN / 2, tz + dz * STAIR_RUN / 2, a.o))) v += 10;
    if (placedStairs.some((s) => Math.hypot(s[0] - tx, s[1] - tz) < STAIR_RUN * 2 && ringsOverlap(r, s[2]))) v += 5;
    return v;
  };
  b.stairs = [];
  for (let k = 0; k < 2; k++) {
    if (b.ends[k]) continue;
    const D = b.deck, top = k ? D.at(-1) : D[0], prev = k ? D.at(-2) : D[1];
    const on = unit(top[0] - prev[0], top[1] - prev[1]);       // straight on, out of the deck
    const node = k ? b.w.nodes.at(-1) : b.w.nodes[0];
    const sEnd = k ? b.ln.L : 0, sDeck = k ? b.s1 : b.s0;
    const cands = [];
    // an OSM steps way at the way's end (when the deck reaches it)
    if (Math.abs(sEnd - sDeck) < 3) for (const st of nodeSteps.get(node) ?? []) {
      const G = st.geometry.map((g) => project(g.lat, g.lon));
      const far = st.nodes[0] === node ? G.at(-1) : G[0];
      cands.push({ d: unit(far[0] - top[0], far[1] - top[1]), kind: 'steps' });
    }
    // the rest of the way past the deck
    if (Math.abs(sEnd - sDeck) >= 6) { const p = b.ln.at(k ? Math.min(b.ln.L, sDeck + 8) : Math.max(0, sDeck - 8)); cands.push({ d: unit(p[0] - top[0], p[1] - top[1]), kind: 'way' }); }
    cands.push({ d: on, kind: 'straight' });
    cands.push({ d: [-on[1], on[0]], kind: 'turned' }, { d: [on[1], -on[0]], kind: 'turned' });
    // a square landing at deck height past the deck's end, the stair leaving it from the side it faces
    const hw = b.width / 2, cx = top[0] + on[0] * hw, cz = top[1] + on[1] * hw;
    let best = null;
    for (const c of cands) {
      const sx = cx + c.d[0] * hw, sz = cz + c.d[1] * hw;
      const r = stairRing(sx, sz, c.d[0], c.d[1], b.width + 0.4);
      const v = bad(r, sx, sz, c.d[0], c.d[1]);
      if (!best || v < best.v) best = { ...c, v, r, sx, sz };
      if (v === 0) break;
    }
    if (best.v >= 100) continue;   // nowhere to go down but a carriageway: the deck stops there
    if (best.v) stairsForced++;
    ({ steps: () => stairsSteps++, way: () => stairsWay++, straight: () => stairsStraight++, turned: () => stairsTurned++ })[best.kind]();
    placedStairs.push([best.sx, best.sz, best.r]);
    // [k (which deck end), stair start x, z, foot x, z]
    b.stairs.push([k, best.sx, best.sz, best.sx + best.d[0] * STAIR_RUN, best.sz + best.d[1] * STAIR_RUN]);
  }
}

// --- piers: off every carriageway, under each deck end and at most SPAN apart
for (const b of bridges) {
  const dl = line(b.deck);
  const free = (s) => { const [x, z] = dl.at(s); return !b.segs.some((q) => q.h < 3 && segDist(x, z, q.ax, q.az, q.bx, q.bz) < q.hw + 0.7); };
  const F = [];
  for (let s = 0.8; s <= dl.L - 0.8; s += 0.5) if (free(s)) F.push(s);
  const piers = [];
  if (F.length) {
    piers.push(F[0]);
    for (;;) {
      const last = piers.at(-1);
      if (dl.L - 0.8 - last <= SPAN && F.at(-1) - last < 6) break;
      // the farthest free spot within SPAN, else the first one past it
      let pick = -1;
      for (const t of F) if (t >= last + 6 && t <= last + SPAN) pick = t;
      if (pick < 0) pick = F.find((t) => t > last + SPAN) ?? -1;
      if (pick < 0) break;
      piers.push(pick);
    }
    if (F.at(-1) - piers.at(-1) >= 4) piers.push(F.at(-1));
  }
  b.piers = piers.map((s) => dl.at(s));
}

const q2 = (v) => Math.round(v * 100) / 100;
const out = {
  y: DECK_Y, run: STAIR_RUN,
  // deck centre line [x, z, ...], width, stairs [deck end 0|1, top x, z, foot x, z] each (a landing w square past that end), piers [x, z, ...], roof (a canopy over the deck)
  b: bridges.filter((b) => b.deck.length >= 2).map((b) => ({
    p: b.deck.flat().map(q2), w: q2(b.width), s: b.stairs.map((s) => s.map(q2)), q: b.piers.flat().map(q2),
    r: (b.id * 2654435761 >>> 0) % 10 < 4 ? 1 : 0,
  })),
};
fs.writeFileSync(path.join(DIR, 'footbridges.json'), JSON.stringify(out));
console.log(`footbridges: ${out.b.length} of ${ways.size} foot bridge ways (${noCross} cross no car road, ${skippedLifted} beside a raised road), ${bridges.filter((b) => b.ends.some(Boolean)).length} joined; stairs ${stairsSteps} on OSM steps, ${stairsWay} along the way, ${stairsStraight} straight on, ${stairsTurned} turned, ${stairsForced} forced into something; ${bridges.reduce((a, b) => a + b.piers.length, 0)} piers`);
