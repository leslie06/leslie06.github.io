#!/usr/bin/env node
/* ---------------------------------------------------------------------------
   访问计数：拿到访客 IP，按 IP 去重，存进本地 SQLite。

   零依赖——数据库用 Node 22 自带的 node:sqlite，HTTP 用 node:http，
   不装任何 npm 包。

   去重不靠代码，靠 ip 这一列的 PRIMARY KEY：同一个 IP 再来只会把 hits 加一，
   不会新增一行。所以 COUNT(*) 天然就是去重后的人数。

   跑法：
     node server.js                      # 只监听本机
     cloudflared tunnel --url http://localhost:8787   # 另开一个终端，拿公网地址

   想存哈希而不是原始 IP：
     HASH_SALT=随便一串字符 node server.js
   --------------------------------------------------------------------------- */
'use strict';
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const PORT = Number(process.env.PORT) || 8787;
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'visits.db');
const SALT = process.env.HASH_SALT || '';       // 设了就存 sha256(ip+盐)

const db = new DatabaseSync(DB_PATH);
db.exec(`
  CREATE TABLE IF NOT EXISTS visitors (
    ip         TEXT PRIMARY KEY,
    first_seen INTEGER NOT NULL,
    last_seen  INTEGER NOT NULL,
    hits       INTEGER NOT NULL DEFAULT 1,
    ua         TEXT,
    ref        TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_last ON visitors(last_seen DESC);
`);

const upsert = db.prepare(`
  INSERT INTO visitors (ip, first_seen, last_seen, hits, ua, ref)
  VALUES (?, ?, ?, 1, ?, ?)
  ON CONFLICT(ip) DO UPDATE SET hits = hits + 1, last_seen = excluded.last_seen
`);
const qTotals = db.prepare('SELECT COUNT(*) AS uniques, COALESCE(SUM(hits),0) AS total FROM visitors');
const qSince  = db.prepare('SELECT COUNT(*) AS n FROM visitors WHERE first_seen >= ?');
const qRecent = db.prepare('SELECT * FROM visitors ORDER BY last_seen DESC LIMIT 200');

/* 真实 IP：经隧道/CDN 进来时在请求头里，直连才看 socket */
function clientIP(req) {
  const cf = req.headers['cf-connecting-ip'];
  if (cf) return cf.trim();
  const xff = req.headers['x-forwarded-for'];
  if (xff) return String(xff).split(',')[0].trim();
  return String(req.socket.remoteAddress || '').replace(/^::ffff:/, '');
}
function key(ip) {
  return SALT ? 'h:' + crypto.createHash('sha256').update(ip + SALT).digest('hex').slice(0, 24) : ip;
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400'
};
const json = (res, obj, code) => {
  const b = Buffer.from(JSON.stringify(obj));
  res.writeHead(code || 200, Object.assign({ 'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': b.length, 'Cache-Control': 'no-store' }, CORS));
  res.end(b);
};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (req.method === 'OPTIONS') { res.writeHead(204, CORS); return res.end(); }

  if (url.pathname === '/hit') {
    const ip = clientIP(req), now = Date.now();
    try {
      upsert.run(key(ip), now, now,
                 (req.headers['user-agent'] || '').slice(0, 300),
                 (req.headers['referer'] || url.searchParams.get('ref') || '').slice(0, 300));
    } catch (e) { console.error('写库失败', e.message); }
    res.writeHead(204, CORS); return res.end();
  }

  if (url.pathname === '/stats') {
    const t = qTotals.get();
    const day = 864e5, now = Date.now();
    return json(res, {
      uniques: t.uniques, total: t.total,
      today: qSince.get(now - day).n,
      week: qSince.get(now - day * 7).n,
      hashed: !!SALT
    });
  }

  if (url.pathname === '/list') return json(res, qRecent.all());

  if (url.pathname === '/' || url.pathname === '/index.html') {
    res.writeHead(200, Object.assign({ 'Content-Type': 'text/html; charset=utf-8' }, CORS));
    return res.end(DASH);
  }
  res.writeHead(404, CORS); res.end('not found');
});

const DASH = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>访问统计</title><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;background:#0b0e14;color:#ece4d2;font:14px/1.7 -apple-system,'PingFang SC',sans-serif">
<div style="max-width:900px;margin:0 auto;padding:34px 20px">
  <h1 style="font-size:20px;letter-spacing:.2em;font-weight:600;margin:0 0 22px;color:#e6b64c">访问统计</h1>
  <div id="k" style="display:flex;gap:14px;flex-wrap:wrap;margin-bottom:26px"></div>
  <table style="width:100%;border-collapse:collapse;font-size:13px">
    <thead><tr style="color:#7a819f;text-align:left">
      <th style="padding:7px 8px;border-bottom:1px solid #232a3a">访客</th>
      <th style="padding:7px 8px;border-bottom:1px solid #232a3a">次数</th>
      <th style="padding:7px 8px;border-bottom:1px solid #232a3a">首次</th>
      <th style="padding:7px 8px;border-bottom:1px solid #232a3a">最近</th>
      <th style="padding:7px 8px;border-bottom:1px solid #232a3a">设备</th>
    </tr></thead><tbody id="t"></tbody>
  </table>
</div>
<script>
const fmt = ms => new Date(ms).toLocaleString('zh-CN', {month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit'});
const card = (label, v, hot) =>
  '<div style="flex:1;min-width:150px;padding:16px 18px;background:#131a26;border:1px solid #232a3a;border-radius:6px">' +
  '<div style="font-size:11px;letter-spacing:.16em;color:#7a819f">' + label + '</div>' +
  '<div style="font-size:30px;font-weight:600;margin-top:5px;color:' + (hot ? '#e6b64c' : '#ece4d2') + '">' + v + '</div></div>';
async function load() {
  const s = await (await fetch('/stats')).json();
  document.getElementById('k').innerHTML =
    card('去重人数', s.uniques, 1) + card('总点击', s.total) +
    card('今日新访客', s.today) + card('七日新访客', s.week);
  const rows = await (await fetch('/list')).json();
  document.getElementById('t').innerHTML = rows.map(r =>
    '<tr><td style="padding:6px 8px;border-bottom:1px solid #171d29;font-family:ui-monospace,monospace">' +
    r.ip + '</td><td style="padding:6px 8px;border-bottom:1px solid #171d29">' + r.hits +
    '</td><td style="padding:6px 8px;border-bottom:1px solid #171d29;color:#a89f8c">' + fmt(r.first_seen) +
    '</td><td style="padding:6px 8px;border-bottom:1px solid #171d29;color:#a89f8c">' + fmt(r.last_seen) +
    '</td><td style="padding:6px 8px;border-bottom:1px solid #171d29;color:#5b6478;max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">' +
    (r.ua || '').replace(/</g,'&lt;') + '</td></tr>').join('');
}
load(); setInterval(load, 5000);
</script></body></html>`;

server.listen(PORT, () => {
  console.log('访问计数已启动  http://localhost:' + PORT);
  console.log('数据库          ' + DB_PATH);
  console.log('存储方式        ' + (SALT ? 'sha256 哈希（不存原始 IP）' : '原始 IP'));
  console.log('打点            /hit    看板 /  接口 /stats /list');
});
