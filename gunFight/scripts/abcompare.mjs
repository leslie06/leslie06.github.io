// Blind A/B composites for the critic. Pairs each game screenshot with a reference image, randomizes
// left/right, labels them A and B only, and writes a hidden key so the reviewer can't cheat.
// Usage: node scripts/abcompare.mjs --shots shots/all --refs ref --out shots/ab [--seed 7] [--pairs vista:ref_03,...]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]] : []).filter(Boolean));
const shotsDir = path.resolve(args.shots ?? 'shots/all');
const refsDir = path.resolve(args.refs ?? 'ref');
const out = path.resolve(args.out ?? 'shots/ab');
fs.mkdirSync(out, { recursive: true });
let seed = Number(args.seed ?? Date.now() % 100000);
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };

const shots = fs.readdirSync(shotsDir).filter((f) => f.endsWith('.png') && !f.startsWith('_'));
const refs = fs.readdirSync(refsDir).filter((f) => /\.(jpe?g|png)$/i.test(f));
if (!refs.length) { console.error('no refs in', refsDir); process.exit(1); }
let pairs;
if (args.pairs) pairs = String(args.pairs).split(',').map((p) => { const [s, r] = p.split(':'); return [shots.find((f) => f.startsWith(s)), refs.find((f) => f.startsWith(r))]; });
else pairs = shots.map((s, i) => [s, refs[i % refs.length]]);

const b64 = (p) => `data:image/${p.endsWith('.png') ? 'png' : 'jpeg'};base64,${fs.readFileSync(p).toString('base64')}`;
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1920, height: 560 }, deviceScaleFactor: 1 });
const key = [];
for (const [s, r] of pairs) {
  if (!s || !r) continue;
  const gameLeft = rnd() < 0.5;
  const left = gameLeft ? path.join(shotsDir, s) : path.join(refsDir, r);
  const right = gameLeft ? path.join(refsDir, r) : path.join(shotsDir, s);
  const html = `<body style="margin:0;background:#111;display:flex;gap:8px;font:bold 22px system-ui;color:#fff">
    <div style="position:relative;width:956px;height:560px;overflow:hidden"><img src="${b64(left)}" style="width:100%;height:100%;object-fit:cover"><span style="position:absolute;left:12px;top:8px;background:#000a;padding:4px 10px">A</span></div>
    <div style="position:relative;width:956px;height:560px;overflow:hidden"><img src="${b64(right)}" style="width:100%;height:100%;object-fit:cover"><span style="position:absolute;left:12px;top:8px;background:#000a;padding:4px 10px">B</span></div></body>`;
  await page.setContent(html);
  await page.waitForTimeout(150);
  const name = `${path.basename(s, '.png')}.png`;
  await page.screenshot({ path: path.join(out, name) });
  key.push({ composite: name, A: gameLeft ? 'game' : 'ref', B: gameLeft ? 'ref' : 'game', game: s, ref: r });
  console.log('wrote', name);
}
fs.writeFileSync(path.join(out, '_key.json'), JSON.stringify(key, null, 2));
await browser.close();
