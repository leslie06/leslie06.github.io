// 本地跑一份统计服务，行为和线上 Worker 完全一致（同一份 worker.js），
// 数据库落在 stats/.dev.sqlite。用来在部署到 Cloudflare 之前先验打点通不通：
//
//   node stats/dev.mjs                                  # 起在 8787
//   node stats/apply.mjs http://127.0.0.1:8787/e kart    # 让 kart 往本地发
//   浏览器打开 kart/index.html 玩十几秒
//   http://127.0.0.1:8787/?k=dev                        # 看板
import { createServer } from 'node:http';
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker from './worker.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(process.env.DB_FILE ?? join(HERE, '.dev.sqlite'));
db.exec(await readFile(join(HERE, 'schema.sql'), 'utf8'));
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
const env = { DB, SALT: 'dev-salt', DASH_KEY: process.env.DASH_KEY ?? 'dev' };
const port = +(process.env.PORT ?? 8787);

createServer(async (req, res) => {
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const request = new Request(`http://127.0.0.1:${port}${req.url}`, {
    method: req.method,
    headers: { ...req.headers, 'cf-connecting-ip': req.socket.remoteAddress ?? '' },
    body: chunks.length ? Buffer.concat(chunks) : undefined,
  });
  const out = await worker.fetch(request, env);
  res.writeHead(out.status, Object.fromEntries(out.headers));
  res.end(Buffer.from(await out.arrayBuffer()));
  if (new URL(request.url).pathname === '/e') process.stdout.write('·');   // 收到一次打点
}).listen(port, () => console.log(`统计服务：http://127.0.0.1:${port}/?k=${env.DASH_KEY}`));
