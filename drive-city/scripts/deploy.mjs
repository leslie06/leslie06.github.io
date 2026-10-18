// Build and copy the game into the GitHub Pages site next door (ai-games/bcity, served at /bcity/).
// Photo textures are shrunk for the web: the loader downsizes at runtime anyway, and a visitor
// should not download 65 MB to drive down Chang'an Avenue. macOS only (uses sips).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const out = path.resolve(root, '..', 'bcity');
const MAX = 1024, QUALITY = 62;
/** Maps nobody reads on the web build: ao barely shows on tiling ground, disp is never requested. */
const DROP = ['arm', 'ao', 'disp'];
/** Only the colour map needs full size; normals and roughness hold up at half. */
const HALF = ['normal', 'rough'];

const mb = (p) => {
  let n = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : (n += fs.statSync(f).size); } };
  walk(p);
  return (n / 1048576).toFixed(1);
};

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
// The last deploy's program files stay one more round. Pages caches index.html for up to 10 minutes, so a visitor can
// get the old page after a deploy, and it asks for the old hashed bundles: deleted, the game died on a 404 before the
// loading bar moved (2026-10-18, the funnel's 「资源下载失败」 on index-VEDhqTrW.js). `deploy-assets.json` lists a
// deploy's own files, so only one generation is carried, not every one since.
const assetsOut = path.join(out, 'assets'), genFile = path.join(out, 'deploy-assets.json');
const carried = new Map();
if (fs.existsSync(assetsOut)) {
  const mine = fs.existsSync(genFile) ? JSON.parse(fs.readFileSync(genFile, 'utf8')) : fs.readdirSync(assetsOut);
  for (const f of mine) { const p = path.join(assetsOut, f); if (fs.existsSync(p)) carried.set(f, fs.readFileSync(p)); }
}
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(dist, out, { recursive: true });
fs.writeFileSync(genFile, JSON.stringify(fs.readdirSync(assetsOut)));
let kept = 0;
for (const [f, b] of carried) if (!fs.existsSync(path.join(assetsOut, f))) { fs.writeFileSync(path.join(assetsOut, f), b); kept++; }
if (kept) console.log(`kept ${kept} files of the last deploy in assets/ for cached pages`);
const before = mb(out);

// Shrink the textures and drop the maps the loader never asks for.
const texDir = path.join(out, 'textures');
if (fs.existsSync(texDir)) {
  for (const set of fs.readdirSync(texDir)) {
    const dir = path.join(texDir, set);
    if (!fs.statSync(dir).isDirectory()) continue;
    const manifestPath = path.join(dir, 'manifest.json');
    if (fs.existsSync(manifestPath)) {
      const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
      for (const k of DROP) {
        if (!m.maps?.[k]) continue;
        fs.rmSync(path.join(dir, m.maps[k]), { force: true });
        delete m.maps[k];
      }
      m.res = `${MAX}`;
      fs.writeFileSync(manifestPath, JSON.stringify(m));
    }
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jpg')) continue;
      const size = HALF.includes(f.replace('.jpg', '')) ? MAX / 2 : MAX;
      execFileSync('sips', ['-Z', String(size), '-s', 'formatOptions', String(QUALITY), path.join(dir, f)], { stdio: 'ignore' });
    }
  }
}
// The site's anonymous play stats (stats/apply.mjs) live in each game's index.html, and the copy
// above replaced ours, so every deploy since 2026-09-17 had shipped bcity without them - no data at
// all on how long anyone played. Put them back, following the site: the endpoint the site's own
// index.html reports to, and nothing if stats are switched off there (`apply.mjs --off`).
const site = fs.readFileSync(path.resolve(root, '..', 'index.html'), 'utf8');
const api = site.match(/const API = '([^']+)', GAME = 'index'/)?.[1];
if (api && !api.includes('STATS-ENDPOINT')) execFileSync('node', [path.resolve(root, '..', 'stats', 'apply.mjs'), api, 'bcity'], { stdio: 'inherit' });
else console.log('stats are off on the site: bcity deployed without them');
console.log(`deployed to ${out}: ${before} MB -> ${mb(out)} MB`);
