// Screenshot harness for the critic loop.
// Usage: node scripts/shot.mjs [--url http://127.0.0.1:5195] [--poses a,b,c|all] [--out shots] [--size 1920x1080] [--quality high] [--swiftshader] [--hud] [--lang zh|en] [--world city] [--params "tod=22&rain=1"]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]] : []).filter(Boolean));
const url = args.url ?? 'http://127.0.0.1:5195';
const out = path.resolve(args.out ?? 'shots');
const [w, h] = (args.size ?? '1920x1080').split('x').map(Number);
const quality = args.quality ?? "high";
fs.mkdirSync(out, { recursive: true });

const gpuArgs = args.swiftshader
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl'];
const browser = await chromium.launch({ headless: !args.headed, args: [...gpuArgs, '--autoplay-policy=no-user-gesture-required', '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
// Block Vite's HMR client so a file save by someone else can't full-reload the page mid-capture.
await page.route('**/@vite/client', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'export const createHotContext = () => ({ accept() {}, dispose() {}, prune() {}, on() {}, send() {} }); export function injectQuery(u) { return u; } export function updateStyle() {} export function removeStyle() {}' }));
const logs = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(`[${t}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

const full = `${url}/?shot=1&quality=${quality}${args.hud ? '&hud=1' : ''}${args.lang ? `&lang=${args.lang}` : ''}${args.world ? `&world=${args.world}` : ''}${args.params ? `&${args.params}` : ''}`;
await page.goto(full, { waitUntil: 'load' });
try { await page.waitForFunction(() => window.__gameReady === true, null, { timeout: 120000 }); }
catch (e) { console.error('game never became ready'); console.error(logs.join('\n')); await page.screenshot({ path: path.join(out, '_failed.png') }); await browser.close(); process.exit(1); }
const gl = await page.evaluate(() => { const c = document.createElement('canvas'); const g = c.getContext('webgl2'); const d = g?.getExtension('WEBGL_debug_renderer_info'); return d ? g.getParameter(d.UNMASKED_RENDERER_WEBGL) : 'unknown'; });
const all = await page.evaluate(() => window.__poses());
const wanted = !args.poses || args.poses === 'all' ? all : String(args.poses).split(',');
// ui_* poses exist to judge the DOM HUD, which the page hides unless ?hud=1. A warning was not
// enough: three review rounds in a row scored bare 3D frames as broken UI. The URL is already fixed
// by now, so toggle HUD visibility per pose at capture time instead — ui_* always on, others follow --hud.
const uiPoses = wanted.filter((p) => p.startsWith('ui_'));
if (!args.hud && uiPoses.length) console.warn(`note: HUD forced on for ${uiPoses.length} ui_* pose(s); they are meaningless without it.`);
const results = [];
for (const pose of wanted) {
  const t0 = Date.now();
  await page.evaluate(([p, flag]) => {
    const hud = window.__engine?.get('hud');
    hud?.setVisible?.(p.startsWith('ui_') || flag);
  }, [pose, !!args.hud]);
  const r = await page.evaluate((p) => window.__shot(p), pose);
  const stats = await page.evaluate(() => window.__stats());
  const file = path.join(out, `${pose}.png`);
  await page.screenshot({ path: file });
  results.push({ pose, ok: r.ok, error: r.error, ms: Date.now() - t0, ...stats });
  console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${pose} ${Date.now() - t0}ms calls=${stats.calls} tris=${stats.triangles}${r.error ? ' ' + r.error : ''}`);
}
fs.writeFileSync(path.join(out, '_report.json'), JSON.stringify({ gl, url: full, results, logs }, null, 2));
console.log('renderer:', gl);
if (logs.length) console.log('console:\n' + logs.slice(0, 40).join('\n'));
await browser.close();
