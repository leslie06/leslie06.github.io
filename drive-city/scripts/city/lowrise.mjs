// Streets kept low (2026-10-22, 藤原豆腐店: 「这条街其他建筑都改成低层，不能有高层。藤原豆腐店要像这张照片一样，成为地标」):
// every building touching a zone is cut down to the zone's cap (its roof scaled with it, a tower's housing type made a
// slab's), and the far skyline loses the boxes standing in it. Patches the built tiles and skyline.json in place, so it
// can run on its own after a change here (`node scripts/city/lowrise.mjs`) and runs at the end of build.mjs; running it
// twice changes nothing.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(ROOT, 'public', 'city');

/** A zone: a box in a frame (origin, heading like a landmark's: x across, y along), and the height cap (m). */
const ZONES = [
  // the street of 藤原豆腐店 (landmarks/tofushop: origin 5606.10, -4484.66, heading -4.82): the street runs y -98..73,
  // x 10; a block's depth either side and ~20 m past its ends
  { name: '藤原豆腐店那条街', gx: 5606.10, gz: -4484.66, heading: -4.82, x0: -60, x1: 80, y0: -120, y1: 95, cap: 8.5 },
];

/** The zone's ring in game x, z. */
function ring(z) {
  const a = -z.heading * Math.PI / 180, c = Math.cos(a), s = Math.sin(a);
  // landmarks' frame: game = (gx + x c + (-y) s, gz - x s + (-y) c) with y north (-z)
  const W = (x, y) => [z.gx + x * c - y * s, z.gz - x * s - y * c];
  return [W(z.x0, z.y0), W(z.x1, z.y0), W(z.x1, z.y1), W(z.x0, z.y1)].flat();
}

function inside(x, z, r) {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) c = !c;
  }
  return c;
}
const overlaps = (a, b) => {
  for (let i = 0; i < a.length; i += 2) if (inside(a[i], a[i + 1], b)) return true;
  for (let i = 0; i < b.length; i += 2) if (inside(b[i], b[i + 1], a)) return true;
  return false;
};

const zones = ZONES.map((z) => ({ ...z, r: ring(z) }));
const box = (r) => { let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity; for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); } return { x0, x1, z0, z1 }; };
const manifest = JSON.parse(fs.readFileSync(path.join(OUT, 'manifest.json'), 'utf8'));
const T = manifest.tile;
let cut = 0, files = 0;
for (const z of zones) {
  const b = box(z.r);
  for (let ix = Math.floor(b.x0 / T) - 1; ix <= Math.floor(b.x1 / T) + 1; ix++) for (let iz = Math.floor(b.z0 / T) - 1; iz <= Math.floor(b.z1 / T) + 1; iz++) {
    const f = path.join(OUT, `t_${ix}_${iz}.json`);
    if (!fs.existsSync(f)) continue;
    const t = JSON.parse(fs.readFileSync(f, 'utf8'));
    let changed = false;
    for (const bd of t.buildings) {
      if (bd.h <= z.cap || !overlaps(bd.o, z.r)) continue;
      const k = z.cap / bd.h;
      bd.rh = Math.round(bd.rh * k * 10) / 10;
      bd.h = z.cap;
      if (bd.m > 0) bd.m = Math.min(bd.m, Math.max(0, z.cap - 3));
      if (bd.t >= 3) bd.t = 2;
      changed = true; cut++;
    }
    if (changed) { fs.writeFileSync(f, JSON.stringify(t)); files++; }
  }
}
// the far skyline (build.mjs: rows of 8 sorted by x, centres as decimetre deltas): the boxes standing in a zone go
{
  const f = path.join(OUT, 'skyline.json');
  const sk = JSON.parse(fs.readFileSync(f, 'utf8'));
  const rows = [];
  let px = 0, pz = 0;
  for (let i = 0; i < sk.d.length; i += 8) {
    px += sk.d[i]; pz += sk.d[i + 1];
    rows.push([px, pz, ...sk.d.slice(i + 2, i + 8)]);
  }
  const keep = rows.filter((r) => !zones.some((z) => inside(r[0] / 10, r[1] / 10, z.r)));
  const d = [];
  px = 0; pz = 0;
  for (const r of keep) { d.push(r[0] - px, r[1] - pz, ...r.slice(2)); px = r[0]; pz = r[1]; }
  fs.writeFileSync(f, JSON.stringify({ ...sk, d }));
  console.log(`lowrise: ${cut} buildings cut down in ${files} tiles; skyline ${rows.length} -> ${keep.length}`);
}
