// Renders every landmark by day and by night from the preview page (landmarks.html).
// Usage: node scripts/landmark-shots.mjs [--url http://127.0.0.1:5191] [--ids tiananmen,citic]
//        [--shots hero:day,hero:night,close:day,far:day] [--out shots/landmarks] [--size 1600x900] [--swiftshader]
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith('--') ? [a.slice(2), arr[i + 1]?.startsWith('--') || arr[i + 1] === undefined ? true : arr[i + 1]] : []).filter((p) => p.length));
const url = args.url ?? 'http://127.0.0.1:5191';
const out = path.resolve(args.out ?? 'shots/landmarks');
const [w, h] = (args.size ?? '1600x900').split('x').map(Number);
const combos = String(args.shots ?? 'hero:day,hero:night,close:day,far:day').split(',').map((s) => s.split(':'));
fs.mkdirSync(out, { recursive: true });

const gpuArgs = args.swiftshader
  ? ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader']
  : ['--use-gl=angle', '--use-angle=metal', '--ignore-gpu-blocklist', '--enable-gpu-rasterization', '--enable-webgl'];
const browser = await chromium.launch({ headless: !args.headed, args: [...gpuArgs, '--mute-audio'] });
const page = await browser.newPage({ viewport: { width: w, height: h }, deviceScaleFactor: 1 });
// Block Vite's HMR client so someone else's file save can't reload the page mid-capture.
await page.route('**/@vite/client', (r) => r.fulfill({ status: 200, contentType: 'application/javascript', body: 'export const createHotContext = () => ({ accept() {}, dispose() {}, prune() {}, on() {}, send() {} }); export function injectQuery(u) { return u; } export function updateStyle() {} export function removeStyle() {}' }));
const logs = [];
page.on('console', (m) => { const t = m.type(); if (t === 'error' || t === 'warning') logs.push(`[${t}] ${m.text()}`); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));

await page.goto(`${url}/landmarks.html?shot=1`, { waitUntil: 'load' });
try { await page.waitForFunction(() => window.__lm?.ready === true, null, { timeout: 120000 }); }
catch { console.error('gallery never became ready\n' + logs.join('\n')); await page.screenshot({ path: path.join(out, '_failed.png') }); await browser.close(); process.exit(1); }
const ids = args.ids ? String(args.ids).split(',') : await page.evaluate(() => window.__lm.ids);
const results = [];
for (const id of ids) {
  for (const [view, mode] of combos) {
    const t0 = Date.now();
    const r = await page.evaluate(([i, v, n]) => window.__lm.show(i, { view: v, night: n }), [id, view, mode === 'night']);
    const file = path.join(out, `${id}-${view}-${mode}.png`);
    await page.screenshot({ path: file });
    results.push({ id, view, mode, ms: Date.now() - t0, ...r });
    console.log(`${id.padEnd(14)} ${view}:${mode.padEnd(5)} ${String(Date.now() - t0).padStart(5)}ms  frame calls=${r.calls} tris=${r.triangles}  model tris=${r.model.triangles} calls=${r.model.drawCalls} far=${r.model.farTriangles}/${r.model.farDrawCalls}`);
  }
}
fs.writeFileSync(path.join(out, '_report.json'), JSON.stringify({ url, results, logs }, null, 2));
if (logs.length) console.log('console:\n' + logs.slice(0, 30).join('\n'));
await browser.close();
