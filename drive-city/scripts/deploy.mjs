// Build and copy the game into the GitHub Pages site next door (ai-games/drivecity).
// Photo textures are shrunk for the web: the loader downsizes at runtime anyway, and a visitor
// should not download 65 MB to drive down Chang'an Avenue. macOS only (uses sips).
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const dist = path.join(root, 'dist');
const out = path.resolve(root, '..', 'drivecity');
const MAX = 1024, QUALITY = 62;

const mb = (p) => {
  let n = 0;
  const walk = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) { const f = path.join(d, e.name); e.isDirectory() ? walk(f) : (n += fs.statSync(f).size); } };
  walk(p);
  return (n / 1048576).toFixed(1);
};

execFileSync('npm', ['run', 'build'], { cwd: root, stdio: 'inherit' });
fs.rmSync(out, { recursive: true, force: true });
fs.cpSync(dist, out, { recursive: true });
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
      if (m.maps?.arm) { fs.rmSync(path.join(dir, m.maps.arm), { force: true }); delete m.maps.arm; }
      m.res = `${MAX}`;
      fs.writeFileSync(manifestPath, JSON.stringify(m));
    }
    for (const f of fs.readdirSync(dir)) {
      if (!f.endsWith('.jpg')) continue;
      execFileSync('sips', ['-Z', String(MAX), '-s', 'formatOptions', String(QUALITY), path.join(dir, f)], { stdio: 'ignore' });
    }
  }
}
console.log(`deployed to ${out}: ${before} MB -> ${mb(out)} MB`);
