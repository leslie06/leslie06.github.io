// 把打点片段写进游戏的 index.html（只替换 STATS_START / STATS_END 之间的内容）。
//
//   node stats/apply.mjs https://你的接口.workers.dev/e        # 全部九个
//   node stats/apply.mjs https://你的接口.workers.dev/e kart    # 只改一个
//   node stats/apply.mjs --off                                 # 撤掉打点
//
// 没填接口地址时片段照样写进去，但里面是占位符，运行时会直接 return，一个请求都不发。
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const GAMES = ['index', 'bcity', 'pelican', 'kart', 'roadRash', 'gun-fight', 'zombie', 'wuxia', 'contra', 'mario'];
const START = '<!-- STATS_START 匿名统计，由 stats/apply.mjs 生成，不要手改 -->';
const END = '<!-- STATS_END -->';
const PLACEHOLDER = 'https://STATS-ENDPOINT/e';

// 活跃时长的三条规矩：页面可见才算、最近 30 秒有操作才算、每 15 秒报一次防丢包
const snippet = (game, api) => `${START}
<script>
(() => {
  const API = '${api}', GAME = '${game}';
  if (API.indexOf('STATS-ENDPOINT') >= 0 || !navigator.sendBeacon) return;
  try { if (/[?&]nostat/.test(location.search) || localStorage.getItem('nostat')) return; } catch (e) {}
  const sid = Math.random().toString(36).slice(2) + Date.now().toString(36);
  let active = 0, last = Date.now();
  for (const ev of ['pointerdown', 'keydown', 'touchstart', 'wheel'])
    addEventListener(ev, () => (last = Date.now()), { passive: true, capture: true });
  setInterval(() => {
    if (document.visibilityState === 'visible' && Date.now() - last < 30000) active++;
  }, 1000);
  const send = () => {
    try {
      navigator.sendBeacon(API, new Blob(
        [JSON.stringify({ g: GAME, s: sid, a: active, w: innerWidth, r: document.referrer })],
        { type: 'text/plain' }));   // text/plain 不触发跨域预检
    } catch (e) {}
  };
  send();
  setInterval(send, 15000);
  addEventListener('pagehide', send);
  addEventListener('visibilitychange', () => document.visibilityState === 'hidden' && send());
})();
</script>
${END}`;

const args = process.argv.slice(2);
const off = args.includes('--off');
const api = args.find(a => a.startsWith('http')) ?? PLACEHOLDER;
const picked = args.filter(a => !a.startsWith('-') && !a.startsWith('http'));
const targets = picked.length ? picked : GAMES;

for (const game of targets) {
  if (!GAMES.includes(game)) { console.error(`跳过 ${game}：不在游戏列表里`); continue; }
  const file = game === 'index' ? join(ROOT, 'index.html') : join(ROOT, game, 'index.html');
  let html = await readFile(file, 'utf8');
  const i = html.indexOf(START), j = html.indexOf(END);
  const block = off ? '' : snippet(game, api);
  if (i >= 0 && j > i) {
    html = html.slice(0, i) + block + html.slice(j + END.length);
    html = html.replace(/\n{3,}/g, '\n\n');
  } else if (!off) {
    const head = html.indexOf('</head>');
    if (head < 0) { console.error(`跳过 ${game}：没找到 </head>`); continue; }
    html = html.slice(0, head) + block + '\n' + html.slice(head);
  } else { console.log(`${game}：本来就没有打点`); continue; }
  await writeFile(file, html);
  console.log(`${off ? "撤掉" : (api === PLACEHOLDER ? "写入（占位符，暂不发送）" : "写入")} ${file.slice(ROOT.length + 1)}`);
}
