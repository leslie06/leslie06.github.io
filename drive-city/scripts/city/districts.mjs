// 区界（2026-11-09，地名标题用，「让人能感觉在真实的北京城跑」）：OSM 的 boundary=administrative + admin_level=6
// （东城区、朝阳区……）组成多边形，投影到游戏坐标、抽稀到 25 米，写到 public/city/districts.json：
// {"d": [{"zh": "朝阳区", "en": "Chaoyang District", "r": [[x, z, ...], ...]}]}（外环；只留碰到可玩区域的区）。
// Usage: node scripts/city/districts.mjs   (build.mjs 在最后跑它). Data © OpenStreetMap contributors, ODbL.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { REGIONS, project } from './region.mjs';

const PBF = path.resolve('data/beijing-latest.osm.pbf');
const OUT = path.resolve('public/city/districts.json');
if (!fs.existsSync(PBF)) { console.log('districts: no data/beijing-latest.osm.pbf, skipped'); process.exit(0); }
const TMP = path.resolve('.cache/osm-pbf/admin.osm.pbf'), GJ = path.resolve('.cache/osm-pbf/admin.geojsonseq');
fs.mkdirSync(path.dirname(TMP), { recursive: true });
// tags-filter 带出来的成员里，西城区的环拼不起来（export 不报错、直接没有）；按 id 递归取（getid -r）每个区都完整
execFileSync('osmium', ['tags-filter', PBF, 'r/admin_level=6', '-o', TMP, '-O']);
const rels = execFileSync('osmium', ['cat', TMP, '-t', 'relation', '-f', 'opl'], { maxBuffer: 1 << 28 }).toString().split('\n').filter((l) => /admin_level=6/.test(l));
const ids = rels.map((l) => l.slice(0, l.indexOf(' ')));
/** 区下面的街道（成员角色 subarea 的 relation）：区自己的环拼不起来时（西城区）用它们合起来。 */
const subareas = new Map(rels.map((l) => [l.slice(0, l.indexOf(' ')), [...(l.match(/ M(\S*)/)?.[1] ?? '').split(',')].filter((m) => /^r\d+@subarea$/.test(m)).map((m) => Number(m.slice(1, m.indexOf('@'))))]));
const FULL = TMP;
// 一起 export 时西城区（r568660）拼不出来，单独 export 就好（原因没查清）：每个区单独取出来（getid -r，成员有一些在
// 北京的抽取范围外，找不全会返回 1，但找到的照样写出来）再 export
const ONE = path.resolve('.cache/osm-pbf/admin-one.osm.pbf'), parts = [];
const unesc = (v) => v.replace(/%([0-9a-fA-F]+)%/g, (_, h) => String.fromCodePoint(parseInt(h, 16)));
for (const id of ids) {
  try { execFileSync('osmium', ['getid', '-r', FULL, id, '-o', ONE, '-O'], { stdio: 'ignore' }); } catch { /* 有成员找不到也照样写 */ }
  execFileSync('osmium', ['export', ONE, '-f', 'geojsonseq', '--geometry-types=polygon', '-a', 'id', '-o', GJ, '-O']);
  const want = Number(id.slice(1)), lines = fs.readFileSync(GJ, 'utf8').split('\n');
  const has = (l, n) => l.includes(`"@id":${n},`) || l.includes(`"@id":${n}}`);
  const own = lines.filter((l) => has(l, want));
  if (own.length) { parts.push(...own); continue; }
  // 拼不起来：街道的多边形当成这个区的环（名字换成区的）
  const rel = rels.find((l) => l.startsWith(id + ' ')) ?? '';
  const name = rel.match(/(?:[ ,T])name=([^,]*)/)?.[1], en = rel.match(/,name:en=([^,]*)/)?.[1];
  const subs = lines.filter((l) => (subareas.get(id) ?? []).some((n) => has(l, n)));
  for (const l of subs) { const f = JSON.parse(l.replace(/^\x1e/, '')); f.properties = { boundary: 'administrative', name: unesc(name ?? ''), 'name:en': unesc(en ?? ''), '@id': want }; parts.push(JSON.stringify(f)); }
  if (subs.length) console.log(`districts: ${unesc(name ?? id)} 自己的边界拼不起来，用 ${subs.length} 个街道的边界`);
}
fs.writeFileSync(GJ, parts.join('\n'));
let bx0 = Infinity, bz0 = Infinity, bx1 = -Infinity, bz1 = -Infinity;
for (const b of REGIONS) for (const [la, lo] of [[b.s, b.w], [b.n, b.e]]) { const [x, z] = project(la, lo); bx0 = Math.min(bx0, x); bx1 = Math.max(bx1, x); bz0 = Math.min(bz0, z); bz1 = Math.max(bz1, z); }
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
const out = [];
for (const line of fs.readFileSync(GJ, 'utf8').split('\n')) {
  const s = line.replace(/^\x1e/, '').trim();
  if (!s) continue;
  const f = JSON.parse(s), t = f.properties ?? {};
  const zh = t['name:zh'] ?? t.name;
  if (t.boundary !== 'administrative' || !zh || !/区$/.test(zh)) continue;
  const polys = f.geometry.type === 'Polygon' ? [f.geometry.coordinates] : f.geometry.coordinates;
  const rings = [];
  for (const poly of polys) {
    const P = poly[0].map(([lon, lat]) => project(lat, lon));
    if (!P.some(([x, z]) => x > bx0 - 2000 && x < bx1 + 2000 && z > bz0 - 2000 && z < bz1 + 2000)) continue;
    rings.push(dp(P, 25).flatMap(([x, z]) => [Math.round(x), Math.round(z)]));
  }
  if (!rings.length) continue;
  const had = out.find((d) => d.zh === zh);
  if (had) had.r.push(...rings); else out.push({ zh, en: t['name:en'] ?? '', r: rings });
}
const json = JSON.stringify({ d: out });
fs.writeFileSync(OUT, json);
console.log(`districts: ${out.map((d) => d.zh).join(' ')}, ${(json.length / 1024).toFixed(0)} KB`);
