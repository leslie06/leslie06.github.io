/**
 * Prune public/textures down to what the code actually loads, then report the saving.
 *
 * Three classes of dead weight accumulate because the fetcher grabs every map Polyhaven offers
 * while the loader only wires up some of them:
 *   - `arm.*`  — a packed AO/Rough/Metal map. `core/Assets.ts` has no arm path at all, so these
 *                have never been requested by anything. Always removable.
 *   - `disp.*` — only loaded when a set is preloaded with `{ disp: true }` (parallax relief).
 *                Sets outside that list carry it for nothing.
 *   - whole sets that no longer appear in any source file.
 *
 * Run with --dry to see what would go. Re-run `npm run assets:fetch` to restore anything.
 */
import fs from 'node:fs';
import path from 'node:path';

const dry = process.argv.includes('--dry');
const TEX = path.resolve('public/textures');
const SRC = path.resolve('src');

const srcFiles = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (p.endsWith('.ts')) srcFiles.push(p);
  }
})(SRC);
const allSrc = srcFiles.map((f) => fs.readFileSync(f, 'utf8')).join('\n');

// Sets named anywhere in source. Set names are always string literals, so this is exact enough:
// a false positive only costs disk, and a false negative would break the build, which the
// screenshot run after this script would catch immediately.
const referenced = new Set([...allSrc.matchAll(/'([a-z0-9_]+)'/g)].map((m) => m[1]));

// Sets preloaded with displacement. Matches `preload([...], { disp: true })` across newlines.
const dispSets = new Set();
for (const m of allSrc.matchAll(/preload\(\s*\[([^\]]*)\][^)]*disp:\s*true/g)) {
  for (const n of m[1].matchAll(/'([a-z0-9_]+)'/g)) dispSets.add(n[1]);
}

let freed = 0, keptSets = 0, droppedSets = 0, droppedFiles = 0;
const size = (p) => { try { return fs.statSync(p).size; } catch { return 0; } };

for (const set of fs.readdirSync(TEX)) {
  const dir = path.join(TEX, set);
  if (!fs.statSync(dir).isDirectory()) continue;

  if (!referenced.has(set)) {
    for (const f of fs.readdirSync(dir)) freed += size(path.join(dir, f));
    droppedSets++;
    console.log(`drop set  ${set}`);
    if (!dry) fs.rmSync(dir, { recursive: true });
    continue;
  }
  keptSets++;

  const manifestPath = path.join(dir, 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const kill = ['arm'];
  if (!dispSets.has(set)) kill.push('disp');

  for (const key of kill) {
    for (const f of fs.readdirSync(dir)) {
      if (f.startsWith(key + '.')) {
        freed += size(path.join(dir, f)); droppedFiles++;
        if (!dry) fs.rmSync(path.join(dir, f));
      }
    }
    delete manifest.maps[key];
  }
  if (!dry) fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
}

console.log(`\nkept ${keptSets} sets, dropped ${droppedSets} sets and ${droppedFiles} unused maps`);
console.log(`freed ${(freed / 1e6).toFixed(1)} MB${dry ? ' (dry run, nothing deleted)' : ''}`);
console.log(`disp kept for ${dispSets.size} sets: ${[...dispSets].sort().join(', ')}`);
