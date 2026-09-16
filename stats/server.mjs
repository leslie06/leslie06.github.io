// 用 Node 跑这套统计服务（和 Cloudflare Worker 是同一份 worker.js，数据库换成本地 SQLite 文件）。
//
//   本地开发：node stats/server.mjs                      # 8787 端口，密钥 dev，库在 stats/.dev.sqlite
//   服务器上：DB_FILE=/var/lib/... DASH_KEY=... node server.mjs
//
// 环境变量：PORT、DASH_KEY、SALT、DB_FILE、VERBOSE=1（每收一条打点打个点，调试用）
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from './worker.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(process.env.DB_FILE ?? join(HERE, '.dev.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec(await readFile(join(HERE, 'schema.sql'), 'utf8'));

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
const port = +(process.env.PORT ?? 8787);
const verbose = process.env.VERBOSE === '1';

createServer(async (req, res) => {
  try {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    // 反代过来的真实 IP：Caddy/nginx 会带 X-Forwarded-For
    const fwd = (req.headers['x-forwarded-for'] ?? '').split(',')[0].trim();
    const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
      method: req.method,
      headers: { ...req.headers, 'cf-connecting-ip': fwd || req.socket.remoteAddress || '' },
      body: chunks.length ? Buffer.concat(chunks) : undefined,
    });
    const out = await worker.fetch(request, env);
    res.writeHead(out.status, Object.fromEntries(out.headers));
    res.end(Buffer.from(await out.arrayBuffer()));
    if (verbose && new URL(request.url).pathname === '/e') process.stdout.write('·');
  } catch (e) {
    console.error('请求出错', e);
    if (!res.headersSent) res.writeHead(500);
    res.end();
  }
}).listen(port, '127.0.0.1', () => console.log(`统计服务在 127.0.0.1:${port}，看板 /?k=${env.DASH_KEY}`));
