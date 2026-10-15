// 游戏统计接口。部署在 Cloudflare Workers 上，数据库用 D1（就是 SQLite）。
//
//   POST /e            游戏里的打点上报（匿名，无 Cookie）
//   POST /lb           排行榜交成绩（text/plain 的 JSON，不触发跨域预检），回名次
//   GET  /lb?g=&b=&p=  排行榜前十 + 这个玩家自己的名次
//   GET  /online?g=    在线人数（最近 45 秒有心跳的会话）和今天玩过的设备数
//   POST /fb           玩家反馈（text/plain 的 JSON：类型、正文、联系方式、游戏情况、截图）
//   GET  /fb?k=密钥    反馈列表（/fb/list 取数，/fb/shot?id= 截图，POST /fb/state?id=&s= 标状态）
//   GET  /?k=密钥      看板
//   GET  /api?k=密钥   看板取数
//   POST /acct/*、/save/*  账号（用户名 + 密码）和云存档，见下面「账号与云存档」
//   POST /chat、GET /chat   游戏里的聊天，见下面「聊天」；/chat/admin?k=密钥 后台
//
// 部署见 stats/README.md。本地可以 `node stats/test.mjs` 跑一遍，不需要 Cloudflare 账号。

const GAMES = new Set(['index', 'bcity', 'pelican', 'kart', 'kart-new', 'roadRash', 'gun-fight', 'zombie', 'wuxia', 'contra', 'mario']);
const REAL_PLAY = 60;      // 活跃满 60 秒才算「真玩了一局」
const ONLINE_MS = 45000;   // 三次心跳没来就算下线
const SITE = 'leslie06.github.io';

export const SQL = {
  // 同一会话只占一行；心跳到达顺序不保证，所以取较大的 active
  upsert: `INSERT INTO ev (day, game, sid, active, mobile, from_index, country, ip_hash, ip_masked, ts, seen)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(day, game, sid) DO UPDATE SET active = max(ev.active, excluded.active), seen = max(ev.seen, excluded.seen)`,
  // 在线：最近 ONLINE_MS 里有过心跳的会话（游戏开着的页面每 15 秒一跳，后台标签页被浏览器压到一分钟一跳，就掉出去了）
  online: 'SELECT COUNT(*) AS c FROM ev WHERE game = ? AND seen > ?',
  todayDevices: 'SELECT COUNT(DISTINCT ip_hash) AS c FROM ev WHERE game = ? AND day = ?',
  // Cloudflare 上能直接拿到地域，顺手写进缓存表；自建服务器由 server.mjs 的后台任务补
  geoPut: `INSERT INTO geo (prefix, province, city, isp, ts) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(prefix) DO NOTHING`,
  regions: `SELECT COALESCE(NULLIF(g.province, ''), '未知') AS province,
              COUNT(*) AS sessions, COUNT(DISTINCT e.ip_hash) AS devices,
              SUM(CASE WHEN e.active >= ? THEN 1 ELSE 0 END) AS real_plays,
              CAST(ROUND(AVG(e.active)) AS INTEGER) AS avg_active
            FROM ev e LEFT JOIN geo g ON g.prefix = e.ip_masked
            WHERE e.day >= ? GROUP BY province ORDER BY sessions DESC LIMIT 20`,
  recent: `SELECT e.ts, e.game, e.active, e.mobile, e.from_index, e.ip_masked,
             g.province, g.city, g.isp
           FROM ev e LEFT JOIN geo g ON g.prefix = e.ip_masked
           WHERE e.day >= ? ORDER BY e.ts DESC LIMIT 60`,
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

// 只保留网段：223.104.5.77 -> 223.104.5.x；IPv6 留前四组
export function maskIp(ip) {
  if (!ip) return '';
  if (ip.includes(':')) return ip.split(':').slice(0, 4).join(':') + '::x';
  const p = ip.split('.');
  return p.length === 4 ? `${p[0]}.${p[1]}.${p[2]}.x` : '';
}

async function hash(...parts) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(parts.join('|')));
  return [...new Uint8Array(buf, 0, 8)].map(b => b.toString(16).padStart(2, '0')).join('');
}

const CORS = { 'access-control-allow-origin': '*', 'access-control-allow-headers': 'content-type', 'access-control-max-age': '86400' };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json;charset=utf-8', 'cache-control': 'no-store', ...CORS } });

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
    const day = cnDay(), masked = maskIp(ip);
    await env.DB.prepare(SQL.upsert).bind(
      day, b.g, sid, active, width && width <= 820 ? 1 : 0, fromIndex,
      request.cf?.country ?? 'XX', await hash(ip, ua, day, env.SALT ?? 'salt'), masked, Date.now(), Date.now(),
    ).run();
    // Cloudflare 自带地域信息；自建服务器上这里没有，交给后台任务去查
    if (masked && request.cf?.region) {
      await env.DB.prepare(SQL.geoPut).bind(masked, request.cf.region, request.cf.city ?? '', '', Date.now()).run();
    }
  } catch { /* 静默丢弃 */ }
}

// ---------------------------------------------------------------- 排行榜
// 每个游戏哪些榜、成绩的合理范围。asc = 越小越好（计时，毫秒）。范围外的成绩直接丢：
// 挡不住有心人，但能挡住坏数据和手滑。
export const BOARDS = {
  bcity: {
    race0: { asc: true, min: 40e3, max: 20 * 60e3 }, race1: { asc: true, min: 40e3, max: 20 * 60e3 },
    race2: { asc: true, min: 40e3, max: 20 * 60e3 }, race3: { asc: true, min: 40e3, max: 20 * 60e3 },
    combo: { asc: false, min: 1, max: 5e6 },
    taxi: { asc: false, min: 1, max: 2e5 },
    heist: { asc: true, min: 30e3, max: 30 * 60e3 },
    // 计时赛（drive-city/src/trials/Courses.ts 的 COURSES，3.8-7.8 km）：最快的时间
    trial_changan: { asc: true, min: 40e3, max: 30 * 60e3 }, trial_e2: { asc: true, min: 40e3, max: 30 * 60e3 },
    trial_e3: { asc: true, min: 40e3, max: 30 * 60e3 }, trial_w2: { asc: true, min: 40e3, max: 30 * 60e3 },
    trial_e4: { asc: true, min: 40e3, max: 30 * 60e3 }, trial_n4: { asc: true, min: 40e3, max: 30 * 60e3 },
    trial_jingtong: { asc: true, min: 40e3, max: 30 * 60e3 },
  },
};
const LB_TOP = 10;
/** 一台设备（ip_hash，每天换盐）一天在一个榜上最多开几个新号，防刷屏。 */
const LB_NEW_PER_DAY = 5;

/** 昵称：去掉控制字符和尖括号引号，压空格，最多 12 个字；像网址的不要。 */
export function cleanName(raw) {
  let n = String(raw ?? '').normalize('NFKC').replace(/[\u0000-\u001f\u007f-\u009f<>&"'`\\]/g, '').replace(/\s+/g, ' ').trim();
  n = [...n].slice(0, 12).join('').trim();
  if (!n || /https?:|www\.|\.(com|cn|net|org|top|xyz|cc)\b/i.test(n)) return '';
  return n;
}
const cleanPid = (p) => String(p ?? '').replace(/[^a-z0-9]/gi, '').slice(0, 32);

const LBSQL = {
  get: 'SELECT name, score FROM lb WHERE game = ? AND board = ? AND pid = ?',
  // 一条语句插入或刷新：两次成绩前后脚到（同一个人连着交两个榜外成绩）时，先查后插会撞主键
  upsertAsc: `INSERT INTO lb (game, board, pid, name, score, day, ip_hash, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(game, board, pid) DO UPDATE SET name = excluded.name,
      ts = CASE WHEN excluded.score < lb.score THEN excluded.ts ELSE lb.ts END,
      score = MIN(lb.score, excluded.score)`,
  upsertDesc: `INSERT INTO lb (game, board, pid, name, score, day, ip_hash, ts) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(game, board, pid) DO UPDATE SET name = excluded.name,
      ts = CASE WHEN excluded.score > lb.score THEN excluded.ts ELSE lb.ts END,
      score = MAX(lb.score, excluded.score)`,
  rename: 'UPDATE lb SET name = ? WHERE game = ? AND pid = ?',
  newToday: 'SELECT COUNT(*) AS c FROM lb WHERE game = ? AND board = ? AND day = ? AND ip_hash = ?',
  total: 'SELECT COUNT(*) AS c FROM lb WHERE game = ? AND board = ?',
  // 名次 = 严格比他好的人数 + 1；同分先到先得（ts 早的在前）
  betterAsc: 'SELECT COUNT(*) AS c FROM lb WHERE game = ? AND board = ? AND (score < ? OR (score = ? AND ts < ?))',
  betterDesc: 'SELECT COUNT(*) AS c FROM lb WHERE game = ? AND board = ? AND (score > ? OR (score = ? AND ts < ?))',
  topAsc: `SELECT name, score, pid FROM lb WHERE game = ? AND board = ? ORDER BY score ASC, ts ASC LIMIT ${LB_TOP}`,
  topDesc: `SELECT name, score, pid FROM lb WHERE game = ? AND board = ? ORDER BY score DESC, ts ASC LIMIT ${LB_TOP}`,
};

async function rankOf(env, g, b, spec, pid) {
  const row = await env.DB.prepare('SELECT score, ts FROM lb WHERE game = ? AND board = ? AND pid = ?').bind(g, b, pid).first();
  if (!row) return null;
  const better = await env.DB.prepare(spec.asc ? LBSQL.betterAsc : LBSQL.betterDesc).bind(g, b, row.score, row.score, row.ts).first();
  return { rank: (better?.c ?? 0) + 1, score: row.score };
}

async function board(env, g, b, pid) {
  const spec = BOARDS[g]?.[b];
  if (!spec) return json({ error: 'board' }, 400);
  const top = await env.DB.prepare(spec.asc ? LBSQL.topAsc : LBSQL.topDesc).bind(g, b).all();
  const total = await env.DB.prepare(LBSQL.total).bind(g, b).first();
  const me = pid ? await rankOf(env, g, b, spec, pid) : null;
  return json({
    board: b, asc: spec.asc, total: total?.c ?? 0,
    top: top.results.map((r) => ({ name: r.name, score: r.score, me: !!pid && r.pid === pid })),
    me,
  });
}

async function submit(request, env) {
  let b;
  try { b = JSON.parse(await request.text()); } catch { return json({ error: 'json' }, 400); }
  const spec = BOARDS[b?.g]?.[b?.b];
  const pid = cleanPid(b?.p);
  const score = Math.round(+b?.v);
  if (!spec || !pid) return json({ error: 'board' }, 400);
  const name = cleanName(b.n) || '车手';
  // 只改名字（v 不给）：这个玩家所有榜上的名字一起改
  if (b.v === undefined || b.v === null) {
    await env.DB.prepare(LBSQL.rename).bind(name, b.g, pid).run();
    return json({ ok: true, name });
  }
  if (!Number.isFinite(score) || score < spec.min || score > spec.max) return json({ error: 'range' }, 400);
  const now = Date.now(), day = cnDay(now);
  const old = await env.DB.prepare(LBSQL.get).bind(b.g, b.b, pid).first();
  const ip = request.headers.get('cf-connecting-ip') ?? '', ua = request.headers.get('user-agent') ?? '';
  const ipHash = await hash(ip, ua, day, env.SALT ?? 'salt');
  if (!old) {
    const n = await env.DB.prepare(LBSQL.newToday).bind(b.g, b.b, day, ipHash).first();
    if ((n?.c ?? 0) >= LB_NEW_PER_DAY) return json({ error: 'busy' }, 429);
  }
  await env.DB.prepare(spec.asc ? LBSQL.upsertAsc : LBSQL.upsertDesc).bind(b.g, b.b, pid, name, score, day, ipHash, now).run();
  const best = !old || (spec.asc ? score < old.score : score > old.score);
  const r = await rankOf(env, b.g, b.b, spec, pid);
  const total = await env.DB.prepare(LBSQL.total).bind(b.g, b.b).first();
  return json({ ok: true, best, rank: r?.rank ?? 0, score: r?.score ?? score, total: total?.c ?? 0, name });
}

// ---------------------------------------------------------------- 反馈
// 游戏里的「反馈」面板交上来的意见：类型、正文、选填的联系方式、游戏附带的情况（版本、画质、设备、
// 在城里哪儿）、可选的一张画面截图。text/plain 的 JSON，和排行榜一样不触发跨域预检。
// 同一台设备一天最多 FB_PER_DAY 条；十分钟内一字不差的重复（连点两下）只收一条。
export const FB_KINDS = new Set(['bug', 'idea', 'praise', 'other']);
const FB_PER_DAY = 20, FB_TEXT = 2000, FB_SHOT = 450000;
const FBSQL = {
  put: `INSERT INTO fb (game, day, ts, kind, text, contact, ctx, pid, ip_hash, ip_masked, has_shot)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id`,
  shot: 'INSERT INTO fb_shot (id, data) VALUES (?, ?)',
  today: 'SELECT COUNT(*) AS c FROM fb WHERE day = ? AND ip_hash = ?',
  dup: 'SELECT id FROM fb WHERE ip_hash = ? AND text = ? AND ts > ? LIMIT 1',
  list: `SELECT f.id, f.game, f.ts, f.kind, f.text, f.contact, f.ctx, f.pid, f.state, f.has_shot,
           g.province, g.city, (SELECT COUNT(*) FROM fb o WHERE o.pid = f.pid AND f.pid <> '') AS by_pid
         FROM fb f LEFT JOIN geo g ON g.prefix = f.ip_masked
         WHERE (? = '' OR f.game = ?) AND (? = '' OR f.state = ?) ORDER BY f.ts DESC, f.id DESC LIMIT ?`,
  counts: `SELECT state, COUNT(*) AS c FROM fb GROUP BY state`,
  getShot: 'SELECT data FROM fb_shot WHERE id = ?',
  setState: 'UPDATE fb SET state = ? WHERE id = ?',
};
/** Text a player typed: control characters out (newlines kept), trimmed, capped. */
export const cleanText = (t, max) => String(t ?? '').replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim().slice(0, max);

async function feedback(request, env) {
  let b;
  try { b = JSON.parse(await request.text()); } catch { return json({ error: 'json' }, 400); }
  if (!GAMES.has(b?.g) || !FB_KINDS.has(b?.k)) return json({ error: 'kind' }, 400);
  const text = cleanText(b.t, FB_TEXT);
  if (!text) return json({ error: 'empty' }, 400);
  const contact = cleanText(b.c, 80).replace(/\n/g, ' ');
  let ctx = '';
  try { ctx = b.x && typeof b.x === 'object' ? JSON.stringify(b.x).slice(0, 3000) : ''; } catch { }
  const shot = typeof b.s === 'string' && b.s.startsWith('data:image/jpeg;base64,') && b.s.length <= FB_SHOT ? b.s : '';
  const now = Date.now(), day = cnDay(now);
  const ip = request.headers.get('cf-connecting-ip') ?? '', ua = request.headers.get('user-agent') ?? '';
  const ipHash = await hash(ip, ua, day, env.SALT ?? 'salt');
  const dup = await env.DB.prepare(FBSQL.dup).bind(ipHash, text, now - 600e3).first();
  if (dup) return json({ ok: true, id: dup.id, dup: true });
  const n = await env.DB.prepare(FBSQL.today).bind(day, ipHash).first();
  if ((n?.c ?? 0) >= FB_PER_DAY) return json({ error: 'busy' }, 429);
  const row = await env.DB.prepare(FBSQL.put).bind(b.g, day, now, b.k, text, contact, ctx, cleanPid(b.p) ?? '', ipHash, maskIp(ip), shot ? 1 : 0).first();
  if (shot && row?.id) await env.DB.prepare(FBSQL.shot).bind(row.id, shot).run();
  return json({ ok: true, id: row?.id ?? 0 });
}

async function feedbackList(env, url) {
  const game = url.searchParams.get('g') ?? '', state = url.searchParams.get('state') ?? '';
  const limit = Math.min(Math.max(+url.searchParams.get('n') || 200, 1), 1000);
  const rows = await env.DB.prepare(FBSQL.list).bind(game, game, state, state, limit).all();
  const counts = await env.DB.prepare(FBSQL.counts).all();
  return json({ items: rows.results, counts: Object.fromEntries(counts.results.map((r) => [r.state, r.c])) });
}

async function api(env, days) {
  const since = daysAgo(days);
  const [summary, median, daily, regions, recent] = await Promise.all([
    env.DB.prepare(SQL.summary).bind(REAL_PLAY, since).all(),
    env.DB.prepare(SQL.median).bind(since).all(),
    env.DB.prepare(SQL.daily).bind(REAL_PLAY, since).all(),
    env.DB.prepare(SQL.regions).bind(REAL_PLAY, since).all(),
    env.DB.prepare(SQL.recent).bind(since).all(),
  ]);
  const med = Object.fromEntries(median.results.map(r => [r.game, r.median]));
  return {
    since, days, realPlay: REAL_PLAY,
    games: summary.results.map(r => ({ ...r, median: med[r.game] ?? 0 })),
    daily: daily.results, regions: regions.results, recent: recent.results,
  };
}

// ---------------------------------------------------------------- 账号与云存档
// 用户名 + 密码（不收手机号、邮箱），存档整份存在服务器上。都是 POST text/plain 的 JSON（不触发跨域预检），
// 登录令牌放在请求体里（t），不走 Cookie。
//   /acct/register {g, name, pw}           -> {ok, name, token, recovery}
//   /acct/login    {g, name, pw}           -> {ok, name, token}
//   /acct/reset    {g, name, recovery, pw} -> {ok, name, token, recovery}（新的恢复码；旧的登录全部作废）
//   /acct/logout   {g, t}                  -> {ok}
//   /save/get      {g, t}                  -> {ok, name, ver, ts, data}（没存过 data 为 null）
//   /save/put      {g, t, ver, data, force} -> {ok, ver, ts}；ver 不是库里的当前版本（别的设备存过）回 409 {error:'conflict', ver, ts}，force 强行覆盖
export const SAVE_GAMES = new Set(['bcity']);
const PBKDF2_ITER = 100000;      // Cloudflare Workers 上 PBKDF2 最多 10 万次
const SAVE_MAX = 600000;         // 一份存档最多 60 万字符
const SESS_DAYS = 180;
const ACCT_NEW_PER_DAY = 5;      // 一台设备（每天换盐的 ip_hash）一天最多注册几个号
const FAIL_WINDOW = 15 * 60e3, FAIL_PER_NAME = 10, FAIL_PER_DEVICE = 30;
const RC_ABC = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // 恢复码不用 0 O 1 I，免得抄错
const hex = (buf) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randHex = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));
async function pbkdf2(pw, saltHex, iter = PBKDF2_ITER) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pw), 'PBKDF2', false, ['deriveBits']);
  const salt = Uint8Array.from(saltHex.match(/../g).map((h) => parseInt(h, 16)));
  return hex(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: iter }, key, 256));
}
async function pwHash(pw) { const salt = randHex(16); return `pbkdf2$${PBKDF2_ITER}$${salt}$${await pbkdf2(pw, salt)}`; }
async function pwCheck(pw, stored) {
  const [kind, iter, salt, h] = String(stored).split('$');
  if (kind !== 'pbkdf2' || !salt || !h) return false;
  const got = await pbkdf2(pw, salt, +iter);
  // 等长比较，不在第一个不同的字符就返回
  let d = got.length ^ h.length;
  for (let i = 0; i < Math.min(got.length, h.length); i++) d |= got.charCodeAt(i) ^ h.charCodeAt(i);
  return d === 0;
}
const sha = async (s) => hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
function recoveryCode() {
  const b = crypto.getRandomValues(new Uint8Array(12));
  const c = [...b].map((x) => RC_ABC[x % RC_ABC.length]).join('');
  return `${c.slice(0, 4)}-${c.slice(4, 8)}-${c.slice(8)}`;
}
const cleanRc = (s) => String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
/** 用户名：2-16 个字，字母、数字、汉字、下划线、减号；像网址的不要。 */
export function cleanUser(raw) {
  const n = String(raw ?? '').normalize('NFKC').trim();
  const len = [...n].length;
  if (len < 2 || len > 16) return '';
  if (!/^[\p{L}\p{N}_-]+$/u.test(n)) return '';
  if (/https?|www|\.(com|cn|net)/i.test(n)) return '';
  return n;
}
const goodPw = (pw) => typeof pw === 'string' && pw.length >= 6 && pw.length <= 64;
const ACSQL = {
  byName: 'SELECT id, name, pw, rc FROM acct WHERE game = ? AND lname = ?',
  insert: 'INSERT INTO acct (game, name, lname, pw, rc, day, ip_hash, ts, seen) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?) RETURNING id',
  newToday: 'SELECT COUNT(*) AS c FROM acct WHERE day = ? AND ip_hash = ?',
  seen: 'UPDATE acct SET seen = ? WHERE id = ?',
  setPw: 'UPDATE acct SET pw = ?, rc = ? WHERE id = ?',
  sessPut: 'INSERT INTO sess (token, acct, ts, seen) VALUES (?, ?, ?, ?)',
  sessGet: 'SELECT s.acct, s.seen, a.name FROM sess s JOIN acct a ON a.id = s.acct WHERE s.token = ? AND a.game = ?',
  sessSeen: 'UPDATE sess SET seen = ? WHERE token = ?',
  sessDel: 'DELETE FROM sess WHERE token = ?',
  sessDelAll: 'DELETE FROM sess WHERE acct = ?',
  failPut: 'INSERT INTO acct_fail (key, ts) VALUES (?, ?)',
  failCount: 'SELECT COUNT(*) AS c FROM acct_fail WHERE key = ? AND ts > ?',
  failGc: 'DELETE FROM acct_fail WHERE ts < ?',
  saveGet: 'SELECT data, ver, ts FROM save WHERE acct = ?',
  savePut: `INSERT INTO save (acct, data, ver, ts) VALUES (?, ?, ?, ?)
            ON CONFLICT(acct) DO UPDATE SET data = excluded.data, ver = excluded.ver, ts = excluded.ts`,
};
async function body(request) { try { return JSON.parse(await request.text()); } catch { return null; } }
async function deviceHash(request, env) {
  const ip = request.headers.get('cf-connecting-ip') ?? '', ua = request.headers.get('user-agent') ?? '';
  return hash(ip, ua, cnDay(), env.SALT ?? 'salt');
}
/** 失败太多（这个号，或者这台设备）：先别试了。 */
async function throttled(env, keys) {
  const since = Date.now() - FAIL_WINDOW;
  for (const [k, max] of keys) { const r = await env.DB.prepare(ACSQL.failCount).bind(k, since).first(); if ((r?.c ?? 0) >= max) return true; }
  return false;
}
async function failed(env, keys) {
  const now = Date.now();
  for (const [k] of keys) await env.DB.prepare(ACSQL.failPut).bind(k, now).run();
  await env.DB.prepare(ACSQL.failGc).bind(now - 86400e3).run();
}
async function newSession(env, acct) {
  const token = randHex(32), now = Date.now();
  await env.DB.prepare(ACSQL.sessPut).bind(await sha(token), acct, now, now).run();
  await env.DB.prepare(ACSQL.seen).bind(now, acct).run();
  return token;
}
async function session(env, g, t) {
  if (typeof t !== 'string' || t.length !== 64) return null;
  const key = await sha(t), s = await env.DB.prepare(ACSQL.sessGet).bind(key, g).first();
  if (!s) return null;
  const now = Date.now();
  if (now - s.seen > SESS_DAYS * 86400e3) { await env.DB.prepare(ACSQL.sessDel).bind(key).run(); return null; }
  if (now - s.seen > 3600e3) { await env.DB.prepare(ACSQL.sessSeen).bind(now, key).run(); await env.DB.prepare(ACSQL.seen).bind(now, s.acct).run(); }
  return { acct: s.acct, name: s.name, key };
}
async function account(request, env, path) {
  const b = await body(request);
  if (!b || !SAVE_GAMES.has(b.g)) return json({ error: 'game' }, 400);
  const g = b.g;
  if (path === '/acct/register') {
    const name = cleanUser(b.name);
    if (!name) return json({ error: 'name' }, 400);
    if (!goodPw(b.pw)) return json({ error: 'pw' }, 400);
    const dev = await deviceHash(request, env), day = cnDay();
    const n = await env.DB.prepare(ACSQL.newToday).bind(day, dev).first();
    if ((n?.c ?? 0) >= ACCT_NEW_PER_DAY) return json({ error: 'busy' }, 429);
    if (await env.DB.prepare(ACSQL.byName).bind(g, name.toLowerCase()).first()) return json({ error: 'taken' }, 409);
    const recovery = recoveryCode(), now = Date.now();
    let row;
    try { row = await env.DB.prepare(ACSQL.insert).bind(g, name, name.toLowerCase(), await pwHash(b.pw), await pwHash(cleanRc(recovery)), day, dev, now, now).first(); }
    catch { return json({ error: 'taken' }, 409); }   // 两个人同时抢同一个名字：唯一约束兜底
    return json({ ok: true, name, token: await newSession(env, row.id), recovery });
  }
  if (path === '/acct/login' || path === '/acct/reset') {
    const name = cleanUser(b.name), dev = await deviceHash(request, env);
    const keys = [[`n:${g}:${name.toLowerCase()}`, FAIL_PER_NAME], [`d:${dev}`, FAIL_PER_DEVICE]];
    if (await throttled(env, keys)) return json({ error: 'busy' }, 429);
    const a = name ? await env.DB.prepare(ACSQL.byName).bind(g, name.toLowerCase()).first() : null;
    if (path === '/acct/login') {
      if (!a || typeof b.pw !== 'string' || !(await pwCheck(b.pw, a.pw))) { await failed(env, keys); return json({ error: 'wrong' }, 401); }
      return json({ ok: true, name: a.name, token: await newSession(env, a.id) });
    }
    if (!goodPw(b.pw)) return json({ error: 'pw' }, 400);
    if (!a || !(await pwCheck(cleanRc(b.recovery), a.rc))) { await failed(env, keys); return json({ error: 'wrong' }, 401); }
    const recovery = recoveryCode();
    await env.DB.prepare(ACSQL.setPw).bind(await pwHash(b.pw), await pwHash(cleanRc(recovery)), a.id).run();
    await env.DB.prepare(ACSQL.sessDelAll).bind(a.id).run();
    return json({ ok: true, name: a.name, token: await newSession(env, a.id), recovery });
  }
  const s = await session(env, g, b.t);
  if (path === '/acct/logout') { if (s) await env.DB.prepare(ACSQL.sessDel).bind(s.key).run(); return json({ ok: true }); }
  if (!s) return json({ error: 'auth' }, 401);
  if (path === '/save/get') {
    const r = await env.DB.prepare(ACSQL.saveGet).bind(s.acct).first();
    return json({ ok: true, name: s.name, ver: r?.ver ?? 0, ts: r?.ts ?? 0, data: r ? r.data : null });
  }
  if (path === '/save/put') {
    if (typeof b.data !== 'string' || !b.data || b.data.length > SAVE_MAX) return json({ error: 'size' }, 413);
    try { JSON.parse(b.data); } catch { return json({ error: 'json' }, 400); }
    const r = await env.DB.prepare(ACSQL.saveGet).bind(s.acct).first(), cur = r?.ver ?? 0;
    if (!b.force && (+b.ver || 0) !== cur) return json({ error: 'conflict', ver: cur, ts: r?.ts ?? 0 }, 409);
    const now = Date.now();
    await env.DB.prepare(ACSQL.savePut).bind(s.acct, b.data, cur + 1, now).run();
    return json({ ok: true, ver: cur + 1, ts: now });
  }
  return json({ error: 'path' }, 404);
}

// ---------------------------------------------------------------- 聊天
// 在线玩家实时发言（游戏每隔几秒来取新的）。都是 text/plain 的 JSON，不触发跨域预检：
//   POST /chat {g, text, p, t?}  发一条（p 随机玩家号；t 登录令牌，有就用账号名，没有就是「游客」+ 编号）-> {ok, msg}
//   GET  /chat?g=&after=id       id 之后的新消息（after 不给就是最近 50 条）-> {msgs, last}
//   GET  /chat/admin?k=密钥       后台页；/chat/list?k= 取数（含已删的），POST /chat/hide?k=&id=&h=1|0 删 / 恢复，
//   POST /chat/ban?k=&id=&hours=  按这条消息禁言发言人（玩家号、账号、设备）几小时（0 = 解除）
// 限制：每条 1-120 字；同一个人 3 秒一条、一分钟 15 条；30 秒内一字不差的重复不收；网址、QQ 号、微信号这类广告不收；
// 脏话换成星号（CHAT_WORDS 是默认词表，自建服务器上 env.CHAT_WORDS 可以再加，一行一个）。
export const CHAT_GAMES = new Set(['bcity']);
const CHAT_MAX = 120, CHAT_GAP = 3000, CHAT_PER_MIN = 15, CHAT_PAGE = 50;
const CHAT_WORDS = ['傻逼', '傻b', '煞笔', '沙比', '傻屌', '操你', '草你', '肏', '日你', '尼玛', '你妈的', '他妈的', '去你妈', '妈逼', '妈b', '狗日', '贱人', '婊子', '王八蛋', '滚蛋', '脑残', '弱智', 'sb', 'nmsl', 'cnm', 'fuck', 'shit', 'bitch'];
const CHAT_AD = [/https?:|www\.|\.(com|cn|net|org|top|xyz|cc|vip)\b/i, /(qq|q群|vx|v信|微信|wx|加我|加群|代练|外挂|私聊)/i, /\d{7,}/];
/** 游客编号：随机玩家号算出的 4 位数（同一台设备固定）。 */
export async function guestNo(pid) { const h = await sha(`guest|${pid}`); return 1000 + (parseInt(h.slice(0, 8), 16) % 9000); }
export function cleanChat(raw, extra = []) {
  // NFC, not NFKC: NFKC turns Chinese full-width punctuation (，？！) into ASCII
  let s = String(raw ?? '').normalize('NFC').replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e]/g, '').replace(/\s+/g, ' ').trim();
  s = [...s].slice(0, CHAT_MAX).join('');
  if (!s) return { error: 'empty' };
  if (CHAT_AD.some((r) => r.test(s))) return { error: 'ad' };
  for (const w of [...CHAT_WORDS, ...extra]) {
    if (!w) continue;
    const re = new RegExp(w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi');
    s = s.replace(re, (m) => '*'.repeat([...m].length));
  }
  return { text: s };
}
const CHSQL = {
  put: 'INSERT INTO chat (game, ts, name, acct, pid, text, ip_hash) VALUES (?, ?, ?, ?, ?, ?, ?) RETURNING id',
  since: `SELECT id, ts, name, acct, pid, text FROM chat WHERE game = ? AND id > ? AND hidden = 0 ORDER BY id LIMIT 100`,
  recent: `SELECT * FROM (SELECT id, ts, name, acct, pid, text FROM chat WHERE game = ? AND hidden = 0 ORDER BY id DESC LIMIT ${CHAT_PAGE}) ORDER BY id`,
  lastBy: 'SELECT ts, text FROM chat WHERE (pid = ? OR ip_hash = ?) AND game = ? ORDER BY id DESC LIMIT 1',
  perMin: 'SELECT COUNT(*) AS c FROM chat WHERE (pid = ? OR ip_hash = ?) AND ts > ?',
  ban: 'SELECT until FROM chat_ban WHERE key = ? AND until > ?',
  banPut: `INSERT INTO chat_ban (key, until, ts) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET until = excluded.until, ts = excluded.ts`,
  get: 'SELECT * FROM chat WHERE id = ?',
  hide: 'UPDATE chat SET hidden = ? WHERE id = ?',
  list: 'SELECT id, game, ts, name, acct, pid, text, ip_hash, hidden FROM chat ORDER BY id DESC LIMIT ?',
  bans: 'SELECT key, until FROM chat_ban WHERE until > ? ORDER BY until DESC',
};
const chatOut = (r) => ({ id: r.id, ts: r.ts, name: r.name, guest: r.acct === null || r.acct === undefined, text: r.text });
async function chatPost(request, env) {
  const b = await body(request);
  if (!b || !CHAT_GAMES.has(b.g)) return json({ error: 'game' }, 400);
  const pid = cleanPid(b.p);
  if (!pid) return json({ error: 'pid' }, 400);
  const extra = String(env.CHAT_WORDS ?? '').split('\n').map((w) => w.trim()).filter(Boolean);
  const c = cleanChat(b.text, extra);
  if (c.error) return json({ error: c.error }, 400);
  const s = b.t ? await session(env, b.g, b.t) : null;
  const dev = await deviceHash(request, env), now = Date.now();
  for (const k of [`p:${pid}`, `d:${dev}`, ...(s ? [`a:${s.acct}`] : [])]) {
    const r = await env.DB.prepare(CHSQL.ban).bind(k, now).first();
    if (r) return json({ error: 'banned', until: r.until }, 403);
  }
  const last = await env.DB.prepare(CHSQL.lastBy).bind(pid, dev, b.g).first();
  if (last && now - last.ts < CHAT_GAP) return json({ error: 'fast' }, 429);
  if (last && last.text === c.text && now - last.ts < 30000) return json({ error: 'dup' }, 429);
  const n = await env.DB.prepare(CHSQL.perMin).bind(pid, dev, now - 60000).first();
  if ((n?.c ?? 0) >= CHAT_PER_MIN) return json({ error: 'fast' }, 429);
  const name = s ? s.name : `游客${await guestNo(pid)}`;
  const row = await env.DB.prepare(CHSQL.put).bind(b.g, now, name, s ? s.acct : null, pid, c.text, dev).first();
  return json({ ok: true, msg: chatOut({ id: row.id, ts: now, name, acct: s ? s.acct : null, text: c.text }) });
}
async function chatGet(env, url) {
  const g = url.searchParams.get('g');
  if (!CHAT_GAMES.has(g)) return json({ error: 'game' }, 400);
  const after = Math.max(0, Math.floor(+url.searchParams.get('after') || 0));
  const rows = after ? await env.DB.prepare(CHSQL.since).bind(g, after).all() : await env.DB.prepare(CHSQL.recent).bind(g).all();
  const msgs = rows.results.map(chatOut);
  return json({ msgs, last: msgs.length ? msgs[msgs.length - 1].id : after });
}
async function chatAdmin(request, env, url) {
  if (url.pathname === '/chat/admin') return new Response(CHATPAGE, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
  if (url.pathname === '/chat/list') {
    const rows = await env.DB.prepare(CHSQL.list).bind(Math.min(Math.max(+url.searchParams.get('n') || 300, 1), 2000)).all();
    const bans = await env.DB.prepare(CHSQL.bans).bind(Date.now()).all();
    return json({ items: rows.results, bans: bans.results });
  }
  if (request.method !== 'POST') return new Response(null, { status: 405 });
  const r = await env.DB.prepare(CHSQL.get).bind(+url.searchParams.get('id') || 0).first();
  if (!r) return json({ error: 'id' }, 404);
  if (url.pathname === '/chat/hide') { await env.DB.prepare(CHSQL.hide).bind(url.searchParams.get('h') === '0' ? 0 : 1, r.id).run(); return json({ ok: true }); }
  if (url.pathname === '/chat/ban') {
    const hours = Math.min(Math.max(+url.searchParams.get('hours') || 0, 0), 24 * 365), now = Date.now(), until = hours ? now + hours * 3600e3 : 0;
    for (const k of [`p:${r.pid}`, `d:${r.ip_hash}`, ...(r.acct ? [`a:${r.acct}`] : [])]) await env.DB.prepare(CHSQL.banPut).bind(k, until, now).run();
    return json({ ok: true, until });
  }
  return new Response('not found', { status: 404 });
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
    if (url.pathname === '/lb') {
      try {
        if (request.method === 'POST') return await submit(request, env);
        if (request.method === 'GET') return await board(env, url.searchParams.get('g'), url.searchParams.get('b'), cleanPid(url.searchParams.get('p')));
        return new Response(null, { status: 405, headers: CORS });
      } catch (e) { console.error('lb', e); return json({ error: 'server' }, 500); }
    }
    if ((url.pathname.startsWith('/acct/') || url.pathname.startsWith('/save/')) && request.method === 'POST') {
      try { return await account(request, env, url.pathname); } catch (e) { console.error('acct', e); return json({ error: 'server' }, 500); }
    }
    if (url.pathname === '/chat') {
      try {
        if (request.method === 'POST') return await chatPost(request, env);
        if (request.method === 'GET') return await chatGet(env, url);
        return new Response(null, { status: 405, headers: CORS });
      } catch (e) { console.error('chat', e); return json({ error: 'server' }, 500); }
    }
    if (url.pathname === '/fb' && request.method === 'POST') {
      try { return await feedback(request, env); } catch (e) { console.error('fb', e); return json({ error: 'server' }, 500); }
    }
    // 在线人数：最近 45 秒有心跳的会话数，和今天玩过的设备数（只给数字，谁都能看）
    if (url.pathname === '/online') {
      const g = url.searchParams.get('g');
      if (!GAMES.has(g)) return json({ error: 'game' }, 400);
      const now = Date.now();
      const [on, td] = await Promise.all([env.DB.prepare(SQL.online).bind(g, now - ONLINE_MS).first(), env.DB.prepare(SQL.todayDevices).bind(g, cnDay(now)).first()]);
      return json({ online: on?.c ?? 0, today: td?.c ?? 0 });
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
    if (url.pathname.startsWith('/chat/')) {
      if (!ok) return new Response('unauthorized', { status: 401 });
      return await chatAdmin(request, env, url);
    }
    // 反馈：看（需要密钥）、取截图、标已读 / 已处理
    if (url.pathname === '/fb' || url.pathname.startsWith('/fb/')) {
      if (!ok) return new Response('unauthorized', { status: 401 });
      if (url.pathname === '/fb') return new Response(FBPAGE, { headers: { 'content-type': 'text/html;charset=utf-8', 'cache-control': 'no-store' } });
      if (url.pathname === '/fb/list') return await feedbackList(env, url);
      if (url.pathname === '/fb/shot') {
        const r = await env.DB.prepare(FBSQL.getShot).bind(+url.searchParams.get('id') || 0).first();
        if (!r) return new Response('not found', { status: 404 });
        const bin = Uint8Array.from(atob(r.data.slice(r.data.indexOf(',') + 1)), (c) => c.charCodeAt(0));
        return new Response(bin, { headers: { 'content-type': 'image/jpeg', 'cache-control': 'private, max-age=86400' } });
      }
      if (url.pathname === '/fb/state' && request.method === 'POST') {
        const st = url.searchParams.get('s');
        if (!['new', 'read', 'done'].includes(st)) return json({ error: 'state' }, 400);
        await env.DB.prepare(FBSQL.setState).bind(st, +url.searchParams.get('id') || 0).run();
        return json({ ok: true });
      }
      return new Response('not found', { status: 404 });
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
  h2{margin:30px 0 8px;font-size:14px;letter-spacing:2px;color:var(--muted);font-weight:600;}
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
<div class="sub"><a id="fblink" style="color:var(--accent)" href="/fb">玩家反馈 →</a></div>
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

<h2>来自哪里</h2>
<div class="wrap"><table id="rt"><thead><tr>
  <th>省份</th><th>打开</th><th>设备</th><th>有效游玩</th><th>平均时长</th><th>占比</th>
</tr></thead><tbody></tbody></table></div>

<h2>最近的会话</h2>
<div class="wrap"><table id="st"><thead><tr>
  <th>时间</th><th>游戏</th><th>省份 · 城市</th><th>运营商</th><th>IP 网段</th><th>时长</th><th>设备</th><th>入口</th>
</tr></thead><tbody></tbody></table></div>

<p class="note">时间按北京时间。「有效游玩」= 活跃满 60 秒的会话；活跃只统计页面可见、且最近 30 秒内有过操作的时间，
挂在后台不计。「设备」按当天的 IP+UA 哈希去重，跨天会重复计。<br>
IP 只存到网段（最后一段抹成 x），完整地址不落库；省份是拿网段查一次归属地缓存下来的，同一网段不会重复查。</p>
<script>
const key = new URLSearchParams(location.search).get('k') || '';
document.getElementById('fblink').href = '/fb?k=' + encodeURIComponent(key);
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

  const total = data.regions.reduce((s, r) => s + r.sessions, 0);
  document.querySelector('#rt tbody').innerHTML = data.regions.map(r =>
    '<tr><td>' + r.province + '</td><td class="n big">' + r.sessions + '</td><td class="n">' + r.devices + '</td>' +
    '<td class="n">' + r.real_plays + '</td><td class="n">' + fmt(r.avg_active) + '</td>' +
    '<td class="n">' + pct(r.sessions, total) +
    '<span style="display:inline-block;height:8px;margin-left:8px;vertical-align:middle;background:#f5a33a;border-radius:2px;width:' +
    (total ? Math.max(2, r.sessions / total * 90) : 0).toFixed(0) + 'px"></span></td></tr>').join('');

  const when = (ts) => new Date(ts).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  document.querySelector('#st tbody').innerHTML = data.recent.map(r =>
    '<tr><td class="n">' + when(r.ts) + '</td><td>' + r.game + '</td>' +
    '<td>' + (r.province ? r.province + (r.city ? ' · ' + r.city : '')
      : (Date.now() - r.ts < 180000 ? '<span style="color:#8d94ae">查询中…</span>' : '未知')) + '</td>' +
    '<td>' + (r.isp || '–') + '</td><td class="n">' + (r.ip_masked || '–') + '</td>' +
    '<td class="n' + (r.active >= data.realPlay ? ' big' : '') + '">' + fmt(r.active) + '</td>' +
    '<td>' + (r.mobile ? '手机' : '电脑') + '</td><td>' + (r.from_index ? '目录页' : '直接进') + '</td></tr>').join('');
}
document.getElementById('days').addEventListener('click', e => {
  const b = e.target.closest('button'); if (!b) return;
  for (const x of document.querySelectorAll('#days button')) x.setAttribute('aria-pressed', String(x === b));
  load(b.dataset.d);
});
load(14);
</script></body></html>`;

// 反馈列表：/fb?k=密钥。最新的在上面，按游戏 / 状态筛；点截图看大图；「已读」「已处理」写回库。
const FBPAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>玩家反馈</title>
<style>
  :root{--bg:#07090f;--panel:#121622;--line:rgba(123,131,159,.2);--text:#e6e8f0;--muted:#8d94ae;--dim:#535a72;--accent:#f5a33a;
    --mono:"Courier New",Menlo,Consolas,monospace;--ui:"PingFang SC","Microsoft YaHei",system-ui,sans-serif;}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--text);font:14px/1.6 var(--ui);padding:clamp(16px,4vw,40px);}
  h1{margin:0 0 4px;font-size:22px;letter-spacing:3px;}
  .sub{color:var(--muted);font:11px/1.8 var(--mono);letter-spacing:1px;margin-bottom:16px;}
  .bar{display:flex;gap:8px;flex-wrap:wrap;margin-bottom:16px;}
  button{font:12px var(--ui);color:var(--text);background:var(--panel);border:1px solid var(--line);border-radius:8px;padding:6px 11px;cursor:pointer;}
  button[aria-pressed=true]{background:var(--accent);border-color:var(--accent);color:#0b0d14;font-weight:700;}
  .item{display:grid;grid-template-columns:1fr auto;gap:14px;padding:14px 16px;margin-bottom:10px;background:var(--panel);border:1px solid var(--line);border-radius:12px;}
  .item.done{opacity:.5}
  .meta{font:11px/1.8 var(--mono);color:var(--muted);letter-spacing:.5px}
  .kind{display:inline-block;padding:1px 8px;border-radius:999px;font:700 11px/1.7 var(--ui);margin-right:8px;color:#0b0d14}
  .k-bug{background:#ff6b5a}.k-idea{background:#5ab0ff}.k-praise{background:#62d39a}.k-other{background:#b8bdd0}
  .new .kind::after{content:" 新";}
  .text{white-space:pre-wrap;word-break:break-word;font-size:15px;margin:6px 0}
  .ctx{font:11px/1.7 var(--mono);color:var(--dim);word-break:break-all}
  .contact{color:var(--accent);font-size:13px}
  img{width:220px;max-width:36vw;border-radius:8px;border:1px solid var(--line);cursor:zoom-in;display:block}
  .acts{display:flex;gap:6px;margin-top:8px}
  .empty{padding:40px 0;color:var(--muted);text-align:center}
  @media (max-width:640px){.item{grid-template-columns:1fr}img{max-width:100%;width:100%}}
</style></head><body>
<h1>玩家反馈</h1>
<div class="sub" id="sum">LOADING…</div>
<div class="bar" id="states"><button data-s="" aria-pressed="true">全部</button><button data-s="new">未读</button><button data-s="read">已读</button><button data-s="done">已处理</button></div>
<div id="list"></div>
<div class="empty" id="empty" hidden>还没有反馈。</div>
<script>
const key = new URLSearchParams(location.search).get('k') || '';
const KIND = { bug: '问题', idea: '建议', praise: '好评', other: '其他' };
let state = '';
const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const when = (ts) => new Date(ts + 8 * 3600e3).toISOString().slice(5, 16).replace('T', ' ');
function ctxLine(c) {
  try { c = JSON.parse(c || '{}'); } catch { return esc(c); }
  const bits = [];
  if (c.v) bits.push('版本 ' + c.v);
  if (c.q) bits.push(c.q + (c.fps ? ' · ' + c.fps + ' fps' : ''));
  if (c.dev) bits.push(c.dev);
  if (c.w) bits.push(c.w + '×' + c.h + (c.touch ? ' 触屏' : ''));
  if (c.lang) bits.push(c.lang);
  if (c.road || c.pos) bits.push('在 ' + (c.road || '') + (c.pos ? ' (' + c.pos.join(', ') + ')' : ''));
  if (c.mode) bits.push(c.mode === 'driving' ? '开车中' : c.mode === 'onfoot' ? '步行中' : c.mode);
  if (c.tod !== undefined) bits.push('游戏时间 ' + c.tod);
  if (c.stars) bits.push(c.stars + ' 星通缉');
  if (c.play) bits.push('这次玩了 ' + (c.play < 90 ? c.play + ' 秒' : Math.round(c.play / 60) + ' 分钟'));
  return esc(bits.join(' · '));
}
async function setState(id, s) {
  await fetch('/fb/state?id=' + id + '&s=' + s + '&k=' + encodeURIComponent(key), { method: 'POST' });
  load();
}
async function load() {
  const r = await fetch('/fb/list?state=' + state + '&k=' + encodeURIComponent(key));
  if (!r.ok) { document.getElementById('sum').textContent = key ? '密钥不对' : '网址后面要带 ?k=你的密钥'; return; }
  const d = await r.json(), c = d.counts;
  document.getElementById('sum').textContent = '未读 ' + (c.new || 0) + ' · 已读 ' + (c.read || 0) + ' · 已处理 ' + (c.done || 0);
  const list = document.getElementById('list');
  list.innerHTML = d.items.map((f) => '<div class="item ' + f.state + '"><div>' +
    '<div class="meta"><span class="kind k-' + f.kind + '">' + (KIND[f.kind] || f.kind) + '</span>#' + f.id + ' · ' + when(f.ts) + ' · ' + esc(f.game) +
      (f.province ? ' · ' + esc(f.province) + ' ' + esc(f.city || '') : '') + (f.by_pid > 1 ? ' · 这位玩家共提了 ' + f.by_pid + ' 条' : '') + '</div>' +
    '<div class="text">' + esc(f.text) + '</div>' +
    (f.contact ? '<div class="contact">联系方式：' + esc(f.contact) + '</div>' : '') +
    '<div class="ctx">' + ctxLine(f.ctx) + '</div>' +
    '<div class="acts">' + (f.state !== 'read' ? '<button onclick="setState(' + f.id + ',\\'read\\')">标为已读</button>' : '') +
      (f.state !== 'done' ? '<button onclick="setState(' + f.id + ',\\'done\\')">已处理</button>' : '<button onclick="setState(' + f.id + ',\\'new\\')">重新打开</button>') + '</div>' +
    '</div>' + (f.has_shot ? '<a href="/fb/shot?id=' + f.id + '&k=' + encodeURIComponent(key) + '" target="_blank"><img loading="lazy" src="/fb/shot?id=' + f.id + '&k=' + encodeURIComponent(key) + '"></a>' : '<div></div>') +
    '</div>').join('');
  document.getElementById('empty').hidden = d.items.length > 0;
}
document.getElementById('states').addEventListener('click', (e) => {
  const b = e.target.closest('button'); if (!b) return;
  state = b.dataset.s;
  for (const x of document.querySelectorAll('#states button')) x.setAttribute('aria-pressed', String(x === b));
  load();
});
load();
</script></body></html>`;

const CHATPAGE = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>聊天管理</title>
<style>
  body{margin:0;background:#07090f;color:#e6e8f0;font:14px/1.6 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;padding:clamp(14px,3vw,32px)}
  h1{margin:0 0 4px;font-size:20px;letter-spacing:2px}.sub{color:#8d94ae;font-size:12px;margin-bottom:16px}
  table{width:100%;border-collapse:collapse}td{padding:7px 8px;border-bottom:1px solid rgba(123,131,159,.2);vertical-align:top}
  td.t{color:#8d94ae;white-space:nowrap;font-size:12px}td.n{white-space:nowrap;font-weight:700}tr.h td{opacity:.35;text-decoration:line-through}
  button{background:#222838;color:#e6e8f0;border:1px solid rgba(123,131,159,.3);border-radius:5px;padding:3px 8px;cursor:pointer;margin:0 2px 2px 0;font-size:12px}
  .guest{color:#8d94ae;font-weight:400;font-size:12px}.bans{margin:12px 0;color:#f5a33a;font-size:12px}
</style></head><body><h1>聊天管理</h1><div class="sub">最近的消息（新的在上）。删除：玩家就看不到了；禁言：按这条消息的玩家号、账号和设备，一段时间不能发。</div>
<div class="bans" id="bans"></div><table id="list"></table>
<script>
const k = new URLSearchParams(location.search).get('k');
const fmt = (ts) => new Date(ts).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' });
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
async function act(path) { await fetch(path + '&k=' + encodeURIComponent(k), { method: 'POST' }); load(); }
async function load() {
  const j = await (await fetch('/chat/list?k=' + encodeURIComponent(k))).json();
  document.getElementById('bans').textContent = j.bans.length ? '禁言中：' + j.bans.map((b) => b.key + ' 到 ' + fmt(b.until)).join('，') : '';
  document.getElementById('list').innerHTML = j.items.map((r) => '<tr class="' + (r.hidden ? 'h' : '') + '"><td class="t">' + fmt(r.ts) + '</td><td class="n">' + esc(r.name) + (r.acct ? '' : ' <span class="guest">游客</span>') + '</td><td>' + esc(r.text) + '</td><td style="white-space:nowrap">'
    + (r.hidden ? '<button onclick="act(\'/chat/hide?id=' + r.id + '&h=0\')">恢复</button>' : '<button onclick="act(\'/chat/hide?id=' + r.id + '\')">删除</button>')
    + '<button onclick="act(\'/chat/ban?id=' + r.id + '&hours=24\')">禁言1天</button><button onclick="act(\'/chat/ban?id=' + r.id + '&hours=720\')">禁言30天</button><button onclick="act(\'/chat/ban?id=' + r.id + '&hours=0\')">解除</button></td></tr>').join('');
}
load(); setInterval(load, 10000);
</script></body></html>`;
