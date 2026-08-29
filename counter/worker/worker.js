/* ---------------------------------------------------------------------------
   访问计数 · Cloudflare Worker + D1 版

   和 ../server.js 记的是同一件事、同一套表：整站访客，和每个游戏各被多少人
   点开过。去重靠主键（visitors 的 ip，plays 的 (game, ip)），不靠代码。

   跟本地版的区别只有一条，但很要紧：**这个地址是公网上谁都能访问的。**
   本地版只听 localhost，看板和明细随便发；这里不行 ——

   - /hit /games   公开。前者写，后者只返回计数，没有个人信息
   - /export       要 ADMIN_TOKEN。全量明细，含 IP，绝不能裸奔
   - 没有看板      看数用本地那个：node ../server.js --pull <地址> <token>
                   拉一份下来，然后 http://localhost:8787/

   HASH_SALT 设了就存 sha256(ip+盐) 而不是原始 IP。本地版可以不设（库在自己
   机器上），**云上强烈建议设**：数据放在别人的机器上，IP 在《个人信息保护法》
   和 GDPR 下都算个人信息。

   部署见 README.md。
   --------------------------------------------------------------------------- */

// 白名单。/hit 无鉴权，不限死的话谁都能拿 curl 往库里灌任意字符串。
const GAMES = ['roadRash', 'zombie', 'wuxia', 'contra', 'mario'];

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'content-type',
  'Access-Control-Max-Age': '86400',
};
const json = (obj, code = 200) =>
  new Response(JSON.stringify(obj), {
    status: code,
    headers: { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...CORS },
  });

async function key(ip, salt) {
  if (!salt) return ip;
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(ip + salt));
  return 'h:' + [...new Uint8Array(buf)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 24);
}

/* 定长比较，别让 token 被逐字符试出来 */
function tokenOk(given, want) {
  if (!want || !given || given.length !== want.length) return false;
  let d = 0;
  for (let i = 0; i < want.length; i++) d |= given.charCodeAt(i) ^ want.charCodeAt(i);
  return d === 0;
}

export default {
  async fetch(req, env) {
    const url = new URL(req.url);
    const p = url.pathname;
    if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

    /* 打点。/hit 记整站，/hit?g=roadRash 另外记这个游戏。
       sendBeacon 发的是 POST，普通 fetch 是 GET，两个都收。 */
    if (p === '/hit') {
      const ip = req.headers.get('CF-Connecting-IP') || '0.0.0.0';
      const k = await key(ip, env.HASH_SALT);
      const now = Date.now();
      const g = url.searchParams.get('g');

      const stmts = [
        env.DB.prepare(
          `INSERT INTO visitors (ip, first_seen, last_seen, hits, ua, ref)
           VALUES (?, ?, ?, 1, ?, ?)
           ON CONFLICT(ip) DO UPDATE SET hits = hits + 1, last_seen = excluded.last_seen`
        ).bind(k, now, now,
               (req.headers.get('user-agent') || '').slice(0, 300),
               (req.headers.get('referer') || url.searchParams.get('ref') || '').slice(0, 300)),
      ];
      if (GAMES.includes(g)) {
        stmts.push(env.DB.prepare(
          `INSERT INTO plays (game, ip, first_seen, last_seen, hits)
           VALUES (?, ?, ?, ?, 1)
           ON CONFLICT(game, ip) DO UPDATE SET hits = hits + 1, last_seen = excluded.last_seen`
        ).bind(g, k, now, now));
      }
      // 打点失败也要返回 204：目录页不该因为统计挂了就在控制台报红
      try { await env.DB.batch(stmts); } catch (e) { console.error('写库失败', e.message); }
      return new Response(null, { status: 204, headers: CORS });
    }

    /* 目录页要的就这一条。只有计数，没有个人信息，所以公开。 */
    if (p === '/games') {
      const out = {};
      for (const g of GAMES) out[g] = { uniques: 0, total: 0 };
      try {
        const { results } = await env.DB
          .prepare('SELECT game, COUNT(*) AS uniques, SUM(hits) AS total FROM plays GROUP BY game').all();
        for (const r of results) if (out[r.game]) out[r.game] = { uniques: r.uniques, total: r.total };
      } catch (e) { console.error('读库失败', e.message); }
      return json(out);
    }

    /* 全量明细，给本地 --pull 同步用。含 IP，必须带 token。
       ADMIN_TOKEN 没设就直接关掉（fail closed），别因为忘了配就把库敞开。 */
    if (p === '/export') {
      if (!tokenOk(url.searchParams.get('k'), env.ADMIN_TOKEN))
        return json({ error: 'unauthorized' }, 401);
      const since = Number(url.searchParams.get('since')) || 0;
      const v = await env.DB.prepare('SELECT * FROM visitors WHERE last_seen >= ? ORDER BY last_seen').bind(since).all();
      const pl = await env.DB.prepare('SELECT * FROM plays    WHERE last_seen >= ? ORDER BY last_seen').bind(since).all();
      return json({ visitors: v.results, plays: pl.results, now: Date.now() });
    }

    return new Response('not found\n\n/hit  /games  /export?k=<token>\n', { status: 404, headers: CORS });
  },
};
