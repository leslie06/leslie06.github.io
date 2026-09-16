// 游戏统计接口。部署在 Cloudflare Workers 上，数据库用 D1（就是 SQLite）。
//
//   POST /e            游戏里的打点上报（匿名，无 Cookie）
//   GET  /?k=密钥      看板
//   GET  /api?k=密钥   看板取数
//
// 部署见 stats/README.md。本地可以 `node stats/test.mjs` 跑一遍，不需要 Cloudflare 账号。

const GAMES = new Set(['index', 'bcity', 'pelican', 'kart', 'roadRash', 'gun-fight', 'zombie', 'wuxia', 'contra', 'mario']);
const REAL_PLAY = 60;      // 活跃满 60 秒才算「真玩了一局」
const SITE = 'leslie06.github.io';

export const SQL = {
  // 同一会话只占一行；心跳到达顺序不保证，所以取较大的 active
  upsert: `INSERT INTO ev (day, game, sid, active, mobile, from_index, country, ip_hash, ts)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(day, game, sid) DO UPDATE SET active = max(ev.active, excluded.active)`,
  summary: `SELECT game,
              COUNT(*)                                        AS sessions,
              COUNT(DISTINCT ip_hash)                         AS devices,
              SUM(CASE WHEN active >= ? THEN 1 ELSE 0 END)    AS real_plays,
              CAST(ROUND(AVG(active)) AS INTEGER)             AS avg_active,
              SUM(active)                                     AS total_active,
              SUM(mobile)                                     AS mobile,
              SUM(from_index)                                 AS from_index
            FROM ev WHERE day >= ? GROUP BY game ORDER BY sessions DESC`,
  // 中位数：按 active 排序取中间一行（偶数行取中间两行的平均）
  median: `WITH r AS (
             SELECT game, active,
                    ROW_NUMBER() OVER (PARTITION BY game ORDER BY active) AS rn,
                    COUNT(*)    OVER (PARTITION BY game)                  AS c
             FROM ev WHERE day >= ?)
           SELECT game, CAST(ROUND(AVG(active)) AS INTEGER) AS median
           FROM r WHERE rn IN ((c + 1) / 2, (c + 2) / 2) GROUP BY game`,
  daily: `SELECT day, game, COUNT(*) AS sessions,
            SUM(CASE WHEN active >= ? THEN 1 ELSE 0 END) AS real_plays,
            CAST(ROUND(AVG(active)) AS INTEGER) AS avg_active
          FROM ev WHERE day >= ? GROUP BY day, game ORDER BY day`,
};

// 北京时间的日期，跨天不会因为 UTC 差八小时错位
export const cnDay = (now = Date.now()) => new Date(now + 8 * 3600e3).toISOString().slice(0, 10);
export const daysAgo = (n, now = Date.now()) => cnDay(now - n * 86400e3);

async function hash(...parts) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return [...new Uint8Array(buf, 0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const json = (o) => new Response(JSON.stringify(o), { headers: { 'content-type': 'application/json;charset=utf-8', ...CORS } });

async function ingest(request, env) {
  // 打点永远回 204：出错也不要让浏览器重试，更不要把错误吐给页面
  try {
    const b = JSON.parse(await request.text());
    if (!GAMES.has(b.g) || typeof b.s !== 'string' || !b.s) return;
    const sid = b.s.replace(/[^a-z0-9]/gi, '').slice(0, 32);
    if (!sid) return;
    const active = Math.min(Math.max(Math.round(+b.a || 0), 0), 86400);
    const width = Math.min(Math.max(Math.round(+b.w || 0), 0), 20000);
    let fromIndex = 0;
    try { const u = new URL(b.r); fromIndex = u.host === SITE && u.pathname === '/' ? 1 : 0; } catch { }
    const ip = request.headers.get('cf-connecting-ip') ?? '';
    const ua = request.headers.get('user-agent') ?? '';
    const day = cnDay();
    await env.DB.prepare(SQL.upsert).bind(
      day, b.g, sid, active, width && width <= 820 ? 1 : 0, fromIndex,
      request.cf?.country ?? 'XX', await hash(ip, ua, day, env.SALT ?? 'salt'), Date.now(),
    ).run();
  } catch { /* 静默丢弃 */ }
}

async function api(env, days) {
  const since = daysAgo(days);
  const [summary, median, daily] = await Promise.all([
    env.DB.prepare(SQL.summary).bind(REAL_PLAY, since).all(),
    env.DB.prepare(SQL.median).bind(since).all(),
    env.DB.prepare(SQL.daily).bind(REAL_PLAY, since).all(),
  ]);
  const med = Object.fromEntries(median.results.map(r => [r.game, r.median]));
  return {
    since, days, realPlay: REAL_PLAY,
    games: summary.results.map(r => ({ ...r, median: med[r.game] ?? 0 })),
    daily: daily.results,
  };
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (url.pathname === '/e') {
      if (request.method !== 'POST') return new Response(null, { status: 405, headers: CORS });
      await ingest(request, env);
      return new Response(null, { status: 204, headers: CORS });
    }
    if (url.pathname === '/health') return new Response('ok');
    // 自助排查：手机上打开这个地址，一眼看出这台设备是从哪个国家的出口连过来的
    if (url.pathname === '/me') {
      const c = request.cf ?? {};
      // 自建服务器上没有 cf 那套地理信息，就把来源 IP 回显给本人看（只显示给他自己，不入库）
      const ip = request.headers.get('cf-connecting-ip') ?? '';
      const big = c.country ?? (ip ? ip.replace(/\.\d+$/, '.x').replace(/:[0-9a-f]*$/i, ':x') : '?');
      const sub = c.country ? `接入节点 ${c.colo ?? '?'} · ${c.city ?? ''} ${c.timezone ?? ''}` : '这是服务器看到的你的 IP';
      return new Response(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
        <body style="margin:0;display:grid;place-items:center;height:100vh;background:#07090f;color:#e6e8f0;
          font:16px/1.8 -apple-system,'PingFang SC',sans-serif;text-align:center">
        <div><div style="font-size:12px;letter-spacing:2px;color:#8d94ae">能打开这一页，就说明你连得上统计服务</div>
        <div style="font-size:${c.country ? 64 : 34}px;font-weight:800;color:#f5a33a;letter-spacing:2px;margin:6px 0">${big}</div>
        <div style="font-size:12px;color:#535a72">${sub}</div></div>`,
        { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
    }

    const ok = env.DASH_KEY && url.searchParams.get('k') === env.DASH_KEY;
    if (url.pathname === '/api') {
      if (!ok) return new Response('unauthorized', { status: 401 });
      const days = Math.min(Math.max(+url.searchParams.get('days') || 14, 1), 365);
      return json(await api(env, days));
    }
    if (url.pathname === '/') return new Response(DASH, { headers: { 'content-type': 'text/html;charset=utf-8' } });
    return new Response('not found', { status: 404 });
  },
};

const DASH = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>玩了多少 · 统计</title>
<style>
  :root{--bg:#07090f;--panel:#121622;--line:rgba(123,131,159,.2);--text:#e6e8f0;--muted:#8d94ae;--dim:#535a72;--accent:#f5a33a;
    --mono:"Courier New",Menlo,Consolas,monospace;--ui:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 var(--ui);padding:clamp(18px,4vw,42px);}
  h1{margin:0 0 4px;font-size:22px;letter-spacing:3px;}
  .sub{color:var(--muted);font:11px/1.8 var(--mono);letter-spacing:1px;margin-bottom:20px;}
  .bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:18px;}
  button{font:12px var(--ui);color:var(--text);background:var(--panel);border:1px solid var(--line);
    border-radius:8px;padding:7px 12px;cursor:pointer;}
  button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#0b0d14;font-weight:700;}
  table{width:100%;border-collapse:collapse;font-variant-numeric:tabular-nums;}
  th,td{padding:10px 8px;text-align:right;border-bottom:1px solid var(--line);white-space:nowrap;}
  th{font:11px var(--mono);letter-spacing:1px;color:var(--dim);font-weight:400;}
  td:first-child,th:first-child{text-align:left;font-weight:600;}
  td.n{font-family:var(--mono);}
  .big{color:var(--accent);font-size:16px;}
  .spark{height:26px;width:120px}
  .empty{padding:40px 0;color:var(--muted);text-align:center;}
  .note{margin-top:18px;color:var(--dim);font-size:12px;line-height:1.9;}
  .wrap{overflow-x:auto;}
</style></head><body>
<h1>玩了多少</h1>
<div class="sub" id="range">LOADING…</div>
<div class="bar" id="days">
  <button data-d="7">最近 7 天</button><button data-d="14" aria-pressed="true">14 天</button>
  <button data-d="30">30 天</button><button data-d="90">90 天</button>
</div>
<div class="wrap"><table id="t"><thead><tr>
  <th>游戏</th><th>打开</th><th>设备</th><th>有效游玩</th><th>有效率</th>
  <th>平均时长</th><th>中位时长</th><th>手机</th><th>从目录进</th><th>每日打开</th>
</tr></thead><tbody></tbody></table></div>
<div class="empty" id="empty" hidden>还没有数据。打开一个游戏玩十几秒，刷新这一页。</div>
<p class="note">时间按北京时间。「有效游玩」= 活跃满 60 秒的会话；活跃只统计页面可见、且最近 30 秒内有过操作的时间，
挂在后台不计。「设备」按当天的 IP+UA 哈希去重，跨天会重复计。</p>
<script>
const key = new URLSearchParams(location.search).get('k') || '';
const fmt = (s) => s >= 60 ? Math.floor(s / 60) + '分' + String(s % 60).padStart(2, '0') + '秒' : s + '秒';
const pct = (a, b) => b ? Math.round(a / b * 100) + '%' : '–';
function spark(days, vals) {
  if (!vals.length) return '';
  const max = Math.max(...vals, 1), w = 120, h = 26, bw = w / vals.length;
  return '<svg class="spark" viewBox="0 0 ' + w + ' ' + h + '">' + vals.map((v, i) =>
    '<rect x="' + (i * bw + 0.5).toFixed(1) + '" y="' + (h - Math.max(1, v / max * h)).toFixed(1) +
    '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + Math.max(1, v / max * h).toFixed(1) +
    '" fill="#f5a33a" opacity="' + (i === vals.length - 1 ? 1 : .55) + '"><title>' + days[i] + '：' + v + '</title></rect>').join('') + '</svg>';
}
async function load(d) {
  const r = await fetch('/api?days=' + d + '&k=' + encodeURIComponent(key));
  if (!r.ok) { document.getElementById('range').textContent = key ? '密钥不对' : '网址后面要带 ?k=你的密钥'; return; }
  const data = await r.json();
  document.getElementById('range').textContent = data.since + ' 起 · ' + data.days + ' 天 · 有效游玩门槛 ' + data.realPlay + ' 秒';
  const days = [...new Set(data.daily.map(x => x.day))].sort();
  const body = document.querySelector('#t tbody');
  body.innerHTML = data.games.map(g => {
    const per = Object.fromEntries(data.daily.filter(x => x.game === g.game).map(x => [x.day, x.sessions]));
    return '<tr><td>' + g.game + '</td>' +
      '<td class="n big">' + g.sessions + '</td><td class="n">' + g.devices + '</td>' +
      '<td class="n">' + g.real_plays + '</td><td class="n">' + pct(g.real_plays, g.sessions) + '</td>' +
      '<td class="n">' + fmt(g.avg_active) + '</td><td class="n">' + fmt(g.median) + '</td>' +
      '<td class="n">' + pct(g.mobile, g.sessions) + '</td><td class="n">' + pct(g.from_index, g.sessions) + '</td>' +
      '<td>' + spark(days, days.map(day => per[day] || 0)) + '</td></tr>';
  }).join('');
  document.getElementById('t').hidden = !data.games.length;
  document.getElementById('empty').hidden = !!data.games.length;
}
document.getElementById('days').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of document.querySelectorAll('#days button')) x.setAttribute('aria-pressed', String(x === b));
  load(b.dataset.d);
});
load(14);
</script></body></html>`;
