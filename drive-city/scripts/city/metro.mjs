// The subway lines for the map (2026-10-03, 「地图像高德」): OSM's route=subway / light_rail relations from
// the Beijing extract, into public/city/metro.json - per line its ref, name, colour, its track as polylines
// (game metres, simplified to 4 m, both directions' relations merged by ref) and its stations
// ([x, z, name], from the relations' stop members, one per name). Lines kept where any of them comes
// within 3 km of the play area. Needs osmium-tool and data/beijing-latest.osm.pbf, like extract-pbf.mjs.
// Usage: node scripts/city/metro.mjs   (build.mjs runs it at its end when the pbf is there)
// Data © OpenStreetMap contributors, ODbL.
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REGIONS, project } from './region.mjs';

const PBF = path.resolve('data/beijing-latest.osm.pbf');
const OUT = path.resolve('public/city/metro.json');
if (!fs.existsSync(PBF)) { console.log('metro: no data/beijing-latest.osm.pbf, skipped'); process.exit(0); }
const TMP = path.resolve('.cache/osm-pbf/metro.osm.pbf');
fs.mkdirSync(path.dirname(TMP), { recursive: true });
execFileSync('osmium', ['tags-filter', PBF, 'r/route=subway,light_rail', '-o', TMP, '-O']);
const opl = spawnSync('osmium', ['cat', TMP, '-f', 'opl,add_metadata=false'], { maxBuffer: 1 << 30 }).stdout.toString();
const unesc = (s) => s.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
const tagsOf = (s) => { const t = {}; if (s) for (const kv of s.split(',')) { const i = kv.indexOf('='); t[unesc(kv.slice(0, i))] = unesc(kv.slice(i + 1)); } return t; };
const nodes = new Map(), ways = new Map(), rels = [];
for (const line of opl.split('\n')) {
  if (!line) continue;
  const f = {};
  for (const part of line.split(' ')) f[part[0]] = part.slice(1);
  const id = Number(line.slice(1, line.indexOf(' ')));
  if (line[0] === 'n') nodes.set(id, { x: +f.x, y: +f.y, t: tagsOf(f.T) });
  else if (line[0] === 'w') ways.set(id, f.N ? f.N.split(',').map((r) => Number(r.slice(1))) : []);
  else if (line[0] === 'r') rels.push({ t: tagsOf(f.T), m: f.M ? f.M.split(',').map((s) => { const at = s.indexOf('@'); return { type: s[0], ref: Number(s.slice(1, at)), role: unesc(s.slice(at + 1)) }; }) : [] });
}
// play-area box, grown 3 km
let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
for (const b of REGIONS) for (const [la, lo] of [[b.s, b.w], [b.n, b.e]]) { const [x, z] = project(la, lo); bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
const near = (x, z) => x > bx0 - 3000 && x < bx1 + 3000 && z > bz0 - 3000 && z < bz1 + 3000;
function dp(P, tol) {
  if (P.length < 3) return P;
  const keep = new Uint8Array(P.length); keep[0] = keep[P.length - 1] = 1;
  const st = [[0, P.length - 1]];
  while (st.length) {
    const [a, b] = st.pop(); let w = -1, wi = -1;
    const [ax, az] = P[a], [bx, bz] = P[b], L2 = (bx - ax) ** 2 + (bz - az) ** 2 || 1;
    for (let i = a + 1; i < b; i++) { const t = Math.max(0, Math.min(1, ((P[i][0] - ax) * (bx - ax) + (P[i][1] - az) * (bz - az)) / L2)); const d = Math.hypot(P[i][0] - ax - (bx - ax) * t, P[i][1] - az - (bz - az) * t); if (d > w) { w = d; wi = i; } }
    if (w > tol) { keep[wi] = 1; st.push([a, wi], [wi, b]); }
  }
  return P.filter((_, i) => keep[i]);
}
/** A line's short name as the map prints it: 1号线, 亦庄线, 首都机场线 (no 北京地铁, no direction, no slash). */
const shortName = (s) => s.replace(/^(北京)?(地铁|轻轨)\s*/, '').replace(/[（(].*$/, '').replace(/[:：].*$/, '').replace(/\s.*[→>].*$/, '').split('/')[0].replace(/\s+/g, '').trim();
/** Official colours where OSM has none or the generic grey. */
const COLOUR = { 八通线: '#A12830', 西郊线: '#E50619', 大兴机场线: '#3F48CC', 燕房线: '#D85F26', 亦庄线: '#D61572' };
const byRef = new Map();
for (const r of rels) {
  const t = r.t, raw = t['name:zh'] ?? t.name ?? t.ref;
  if (!raw) continue;
  const name = shortName(raw);
  if (!name) continue;
  const L = byRef.get(name) ?? byRef.set(name, { ref: t.ref ?? name, name, colour: '#888888', ways: new Set(), stations: new Map() }).get(name);
  if (t.colour && !/^#888888$/i.test(t.colour) && L.colour === '#888888') L.colour = t.colour;
  if (L.colour === '#888888' && COLOUR[name]) L.colour = COLOUR[name];
  for (const m of r.m) {
    if (m.type === 'w' && !/platform/.test(m.role)) L.ways.add(m.ref);
    else if (m.type === 'n' && /^stop/.test(m.role)) {
      const n = nodes.get(m.ref);
      const name = n && (n.t['name:zh'] ?? n.t.name);
      if (n && name) { const nm = name.replace(/(地铁)?站$/, '').replace(/[（(].*$/, ''); if (!L.stations.has(nm)) L.stations.set(nm, project(n.y, n.x)); }
    }
  }
}
const lines = [];
for (const L of byRef.values()) {
  const polys = [];
  let any = false;
  for (const wid of L.ways) {
    const ns = ways.get(wid);
    if (!ns) continue;
    const P = ns.map((id) => nodes.get(id)).filter(Boolean).map((n) => project(n.y, n.x));
    if (P.length < 2) continue;
    if (P.some(([x, z]) => near(x, z))) any = true;
    polys.push(dp(P, 4).flatMap(([x, z]) => [Math.round(x), Math.round(z)]));
  }
  if (!any || !polys.length) continue;
  lines.push({ ref: L.ref, name: L.name, colour: L.colour, p: polys, st: [...L.stations].map(([n, [x, z]]) => [Math.round(x), Math.round(z), n]) });
}
lines.sort((a, b) => a.ref.localeCompare(b.ref, 'zh'));
const json = JSON.stringify({ lines });
fs.writeFileSync(OUT, json);
console.log(`metro: ${lines.length} lines, ${lines.reduce((a, l) => a + l.st.length, 0)} stations, ${(json.length / 1024).toFixed(0)} KB`);
