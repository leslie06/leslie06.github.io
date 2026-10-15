// 用 Node 跑这套统计服务（和 Cloudflare Worker 是同一份 worker.js，数据库换成本地 SQLite 文件）。
//
//   本地开发：node stats/server.mjs                      # 8787 端口，密钥 dev，库在 stats/.dev.sqlite
//   服务器上：DB_FILE=/var/lib/... DASH_KEY=... node server.mjs
//
// 环境变量：PORT、DASH_KEY、SALT、DB_FILE、VERBOSE=1（每收一条打点打个点，调试用）
import { createServer } from 'node:http';
import { EventEmitter } from 'node:events';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker, { maskIp } from './worker.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(process.env.DB_FILE ?? join(HERE, '.dev.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec(await readFile(join(HERE, 'schema.sql'), 'utf8'));
// 老库升级：schema.sql 的 CREATE TABLE IF NOT EXISTS 不会给已有表加列
for (const [col, decl] of [['ip_masked', "TEXT NOT NULL DEFAULT ''"], ['seen', 'INTEGER NOT NULL DEFAULT 0']]) {
  const has = db.prepare('PRAGMA table_info(ev)').all().some(c => c.name === col);
  if (!has) { db.exec(`ALTER TABLE ev ADD COLUMN ${col} ${decl}`); console.log(`已补上字段 ${col}`); }
}
// 在线人数按最近心跳数（字段补上以后才能建这个索引，所以不放 schema.sql）
db.exec('CREATE INDEX IF NOT EXISTS ev_seen ON ev (game, seen)');

// D1 的接口形状：prepare().bind().run() / .all()
const DB = {
  prepare(sql) {
    let args = [];
    const st = {
      bind(...a) { args = a; return st; },
      run() { db.prepare(sql).run(...args); return { success: true }; },
      all() { return { results: db.prepare(sql).all(...args) }; },
      first() { return db.prepare(sql).get(...args) ?? null; },
    };
    return st;
  },
};
const env = { DB, SALT: process.env.SALT ?? 'dev-salt', DASH_KEY: process.env.DASH_KEY ?? 'dev' };
// 聊天的额外屏蔽词：CHAT_WORDS_FILE 指向的文本文件，一行一个（改了重启服务生效）
if (process.env.CHAT_WORDS_FILE) { try { env.CHAT_WORDS = await readFile(process.env.CHAT_WORDS_FILE, 'utf8'); } catch { console.log('没读到屏蔽词文件', process.env.CHAT_WORDS_FILE); } }
const port = +(process.env.PORT ?? 8787);
const verbose = process.env.VERBOSE === '1';

// ---------------------------------------------------------------- 归属地
// 每分钟把还没查过的网段查一遍，查过的永久缓存在 geo 表里。
// 发出去的是打码后的地址（223.104.5.x -> 223.104.5.1），完整 IP 从来没存过，也不会外发。
// 主用太平洋 IP 库（国内服务器连得上，返回 GBK）；连不上时退回 ip-api（海外服务器用）。
const pconline = async (ip) => {
  const res = await fetch(`https://whois.pconline.com.cn/ipJson.jsp?ip=${ip}&json=true`, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const j = JSON.parse(new TextDecoder('gbk').decode(await res.arrayBuffer()));
  // addr 形如「上海市 电信」；海外 IP 的 pro 是空的，addr 里只有国家名
  const parts = (j.addr || '').trim().split(/\s+/).filter(Boolean);
  const province = j.pro || parts[0] || '未知';
  const isp = parts.filter(x => x !== province && x !== j.pro && x !== j.city).join(' ');
  return { province, city: j.city === j.pro ? '' : (j.city || ''), isp };
};
const ipapi = async (ip) => {
  const res = await fetch(`http://ip-api.com/json/${ip}?lang=zh-CN&fields=status,country,regionName,city,isp`, { signal: AbortSignal.timeout(8000) });
  const j = await res.json();
  if (j.status !== 'success') throw new Error(j.message || 'lookup failed');
  return { province: j.regionName || j.country || '未知', city: j.city ?? '', isp: j.isp ?? '' };
};

let geoBusy = false;
async function resolveGeo() {
  if (geoBusy) return;
  geoBusy = true;
  try {
    const rows = db.prepare(
      `SELECT DISTINCT x.p FROM (SELECT ip_masked AS p FROM ev UNION SELECT ip_masked FROM fb) x LEFT JOIN geo g ON g.prefix = x.p
       WHERE x.p <> '' AND g.prefix IS NULL LIMIT 20`).all();
    if (!rows.length) return;
    const put = db.prepare(`INSERT INTO geo (prefix, province, city, isp, ts) VALUES (?, ?, ?, ?, ?)
                            ON CONFLICT(prefix) DO UPDATE SET province=excluded.province, city=excluded.city, isp=excluded.isp`);
    let done = 0;
    for (const { p } of rows) {
      const ip = p.includes(':') ? p.replace('::x', '::1') : p.replace(/\.x$/, '.1');
      let g;
      try { g = await pconline(ip); } catch { try { g = await ipapi(ip); } catch { g = null; } }
      // 查不到也写一行「未知」，免得每分钟重复查同一个网段
      put.run(p, g?.province ?? '未知', g?.city ?? '', g?.isp ?? '', Date.now());
      if (g) done++;
      await new Promise(r => setTimeout(r, 400));   // 对免费接口客气点
    }
    console.log(`归属地：查到 ${done}/${rows.length} 个网段`);
  } catch (e) {
    console.error('查归属地失败（下一轮重试）:', e.message);
  } finally {
    geoBusy = false;
  }
}
setTimeout(resolveGeo, 5000);
setInterval(resolveGeo, 60000);          // 兜底心跳
// 来了没见过的网段就马上查，别让看板上挂着一分钟的「未知」
let geoSoon = null;
const hasGeo = db.prepare('SELECT 1 FROM geo WHERE prefix = ?');
function geoHint(masked) {
  if (!masked || geoSoon || hasGeo.get(masked)) return;
  geoSoon = setTimeout(() => { geoSoon = null; resolveGeo(); }, 1500);
}

// 聊天长轮询：GET /chat?after=&wait=秒 没有新消息就挂着，等到有人发言（POST /chat 成功会敲一下）或等满 wait 秒（最多 25）
// 才回，游戏里别人的话马上就能看到。Cloudflare Worker 版没有这个，wait 被忽略、立刻回，游戏那边就退回每 3 秒问一次。
const chatBell = new EventEmitter();
chatBell.setMaxListeners(0);
const ring = (ms, res) => new Promise(r => {
  const done = () => { clearTimeout(t); chatBell.off('msg', done); res.off('close', done); r(); };
  const t = setTimeout(done, ms);
  chatBell.on('msg', done);
  res.on('close', done);
});

createServer(async (req, res) => {
  try {
    const chunks = [];
    let size = 0;
    // 反馈带一张截图（~100-400 KB）；比这大的不是游戏发的
    for await (const c of req) { size += c.length; if (size > 1 << 20) { res.writeHead(413); res.end(); return; } chunks.push(c); }
    // 反代过来的真实 IP：Caddy/nginx 会带 X-Forwarded-For
    const fwd = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    const mk = () => new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: { ...req.headers, 'cf-connecting-ip': fwd || req.socket.remoteAddress || '' },
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const request = mk();
    const url = new URL(request.url);
    let out = await worker.fetch(request, env);
    if (url.pathname === '/chat' && req.method === 'GET' && url.searchParams.has('after') && url.searchParams.has('wait')) {
      let gone = false;
      res.once('close', () => { gone = true; });
      const until = Date.now() + Math.min(25, Math.max(0, +url.searchParams.get('wait') || 0)) * 1000;
      while (out.status === 200 && !gone && Date.now() < until && !(await out.clone().json()).msgs?.length) {
        await ring(until - Date.now(), res);
        if (gone) return;
        out = await worker.fetch(mk(), env);
      }
      if (gone) return;
    }
    if (url.pathname === '/chat' && req.method === 'POST' && out.status === 200) chatBell.emit('msg');
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    if (new URL(request.url).pathname === '/fb' && req.method === 'POST') geoHint(maskIp(request.headers.get('cf-connecting-ip') ?? ''));
    if (new URL(request.url).pathname === '/e') {
      geoHint(maskIp(request.headers.get('cf-connecting-ip') ?? ''));
      if (verbose) process.stdout.write('·');
    }
  } catch (e) {
    console.error('请求出错', e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`统计服务在 127.0.0.1:${port}，看板 /?k=密钥`));
