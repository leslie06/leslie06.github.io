// 不用 Cloudflare 账号就能验的部分：拿 node:sqlite 冒充 D1，把 worker 的 fetch 跑一遍。
//   node stats/test.mjs      退出码 0 = 全过
import { DatabaseSync } from 'node:sqlite';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import worker, { cnDay } from './worker.js';

const HERE = dirname(fileURLToPath(import.meta.url));
const db = new DatabaseSync(':memory:');
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
const env = { DB, SALT: 'test-salt', DASH_KEY: 'secret' };

let failed = 0;
const ok = (name, cond, extra = '') => {
  if (!cond) failed++;
  console.log(`${cond ? '  ok  ' : ' FAIL '} ${name}${extra ? '  ' + extra : ''}`);
};
const beat = (body, headers = {}) => worker.fetch(new Request('https://s/e', {
  method: 'POST', body: JSON.stringify(body),
  headers: { 'user-agent': 'test-ua', 'cf-connecting-ip': '1.2.3.4', ...headers },
}), env);
const rows = () => db.prepare('SELECT * FROM ev').all();

// —— 打点
ok('正常上报返回 204', (await beat({ g: 'kart', s: 'aaa1', a: 5, w: 1440, r: 'https://leslie06.github.io/' })).status === 204);
ok('落库一行', rows().length === 1);
ok('从目录页进来的标记为 1', rows()[0].from_index === 1);
ok('宽屏不算手机', rows()[0].mobile === 0);
ok('不存 IP 原文', !JSON.stringify(rows()[0]).includes('1.2.3.4'));

await beat({ g: 'kart', s: 'aaa1', a: 47, w: 1440, r: '' });
ok('心跳更新同一行', rows().length === 1 && rows()[0].active === 47);
await beat({ g: 'kart', s: 'aaa1', a: 12, w: 1440, r: '' });
ok('乱序到达的小值不覆盖大值', rows()[0].active === 47);

await beat({ g: 'kart', s: 'bbb2', a: 120, w: 390, r: 'https://t.co/x' });
ok('手机宽度算手机', rows().find(r => r.sid === 'bbb2').mobile === 1);
ok('外部来源不算目录页', rows().find(r => r.sid === 'bbb2').from_index === 0);

await beat({ g: 'kart', s: 'ccc3', a: 90, w: 1280, r: '' }, { 'cf-connecting-ip': '9.9.9.9' });
await beat({ g: 'pelican', s: 'ddd4', a: 30, w: 1280, r: '' });

const before = rows().length;
await beat({ g: '../etc/passwd', s: 'x', a: 1 });
await beat({ g: 'kart', s: '', a: 1 });
await beat({ g: 'kart' });
ok('白名单外的游戏名丢弃', rows().length === before);
ok('坏 JSON 也回 204', (await worker.fetch(new Request('https://s/e', { method: 'POST', body: '{' }), env)).status === 204);
ok('GET /e 不接受', (await worker.fetch(new Request('https://s/e'), env)).status === 405);

await beat({ g: 'kart', s: 'eee5', a: 999999, w: 1280 });
ok('活跃秒数封顶一天', rows().find(r => r.sid === 'eee5').active === 86400);
ok('会话号里的怪字符被清掉', (await beat({ g: 'kart', s: '<script>x</script>fff6', a: 3 }), rows().some(r => r.sid === 'scriptxscriptfff6')));

// —— 看板取数
const res = await worker.fetch(new Request('https://s/api?k=secret&days=14'), env);
const data = await res.json();
const kart = data.games.find(g => g.game === 'kart');
ok('汇总按打开数排序，kart 在前', data.games[0].game === 'kart');
ok('打开数 = 会话数', kart.sessions === rows().filter(r => r.game === 'kart').length, `(${kart.sessions})`);
ok('设备数按哈希去重', kart.devices === 2, `(${kart.devices})`);
ok('有效游玩 = 活跃≥60 秒的会话', kart.real_plays === 3, `(${kart.real_plays})`);   // 120 / 90 / 86400
ok('中位时长算得出来', kart.median > 0, `(${kart.median} 秒)`);
ok('手机数正确', kart.mobile === 1);
ok('每日明细有 kart 也有 pelican', new Set(data.daily.map(d => d.game)).size === 2);
ok('日期是北京时间的今天', data.daily.every(d => d.day === cnDay()));

// —— IP 打码与地域
ok('只存网段，最后一段抹掉', rows().every(r => /\.x$/.test(r.ip_masked) || r.ip_masked === ''), `(${rows()[0].ip_masked})`);
ok('库里没有完整 IP', !JSON.stringify(rows()).includes('1.2.3.4') && !JSON.stringify(rows()).includes('9.9.9.9'));
db.prepare("INSERT INTO geo (prefix, province, city, isp, ts) VALUES ('1.2.3.x','北京市','北京','中国移动',0)").run();
const geoData = await (await worker.fetch(new Request('https://s/api?k=secret&days=14'), env)).json();
const bj = geoData.regions.find(r => r.province === '北京市');
ok('地域表按省份汇总', !!bj && bj.sessions > 0, `(北京 ${bj?.sessions} 次)`);
ok('查不到归属地的算「未知」', geoData.regions.some(r => r.province === '未知'));
ok('最近会话列表带省份和网段', geoData.recent.length > 0 && geoData.recent.some(r => r.province === '北京市' && /\.x$/.test(r.ip_masked)));
ok('最近会话按时间倒序', geoData.recent.every((r, i, a) => i === 0 || a[i - 1].ts >= r.ts));

ok('没密钥取不到数', (await worker.fetch(new Request('https://s/api'), env)).status === 401);
ok('密钥不对取不到数', (await worker.fetch(new Request('https://s/api?k=nope'), env)).status === 401);
ok('看板页能打开', (await worker.fetch(new Request('https://s/?k=secret'), env)).status === 200);
ok('/health 正常', (await worker.fetch(new Request('https://s/health'), env)).status === 200);
ok('乱路径 404', (await worker.fetch(new Request('https://s/whatever'), env)).status === 404);

// —— 排行榜
const post = (body, ip = '5.6.7.8') => worker.fetch(new Request('https://s/lb', {
  method: 'POST', body: JSON.stringify(body), headers: { 'user-agent': 'ua', 'cf-connecting-ip': ip, 'content-type': 'text/plain' },
}), env).then(async (r) => ({ status: r.status, cors: r.headers.get('access-control-allow-origin'), body: await r.json() }));
const top = (b, p = '') => worker.fetch(new Request(`https://s/lb?g=bcity&b=${b}&p=${p}`), env).then((r) => r.json());
let r1 = await post({ g: 'bcity', b: 'race0', p: 'pa', n: '阿飞', v: 150000 });
ok('交成绩回名次', r1.status === 200 && r1.body.rank === 1 && r1.body.best, JSON.stringify(r1.body));
ok('排行榜带跨域头', r1.cors === '*');
await post({ g: 'bcity', b: 'race0', p: 'pb', n: '小李', v: 120000 });
await post({ g: 'bcity', b: 'race0', p: 'pc', n: '<img src=x>老王', v: 200000 });
r1 = await post({ g: 'bcity', b: 'race0', p: 'pa', n: '阿飞', v: 170000 });
ok('更慢的成绩不覆盖', !r1.body.best && r1.body.score === 150000 && r1.body.rank === 2, JSON.stringify(r1.body));
r1 = await post({ g: 'bcity', b: 'race0', p: 'pa', n: '阿飞', v: 110000 });
ok('更快的成绩刷新并升到第一', r1.body.best && r1.body.rank === 1);
let lb = await top('race0', 'pc');
ok('计时榜从快到慢', lb.top.map((x) => x.score).join() === '110000,120000,200000', lb.top.map((x) => x.score).join());
ok('查询带上自己的名次', lb.me?.rank === 3 && lb.top[2].me && !lb.top[0].me);
ok('名字里的尖括号被去掉', !lb.top.some((x) => /[<>]/.test(x.name)), lb.top[2].name);
await post({ g: 'bcity', b: 'combo', p: 'pa', n: '阿飞', v: 3000 });
await post({ g: 'bcity', b: 'combo', p: 'pb', n: '小李', v: 9000 });
lb = await top('combo', 'pa');
ok('积分榜从高到低', lb.top[0].score === 9000 && lb.me.rank === 2);
ok('超出范围的成绩不收', (await post({ g: 'bcity', b: 'race0', p: 'pd', v: 1000 })).status === 400);
ok('计时赛榜收成绩', (await post({ g: 'bcity', b: 'trial_changan', p: 'pa', n: '阿飞', v: 343400 })).status === 200);
ok('计时赛太快不收', (await post({ g: 'bcity', b: 'trial_e2', p: 'pa', v: 20e3 })).status === 400);
ok('不在白名单的榜不收', (await post({ g: 'bcity', b: 'hack', p: 'pd', v: 5000 })).status === 400);
ok('别的游戏的榜不收', (await post({ g: 'kart', b: 'race0', p: 'pd', v: 50000 })).status === 400);
ok('像网址的名字换成默认', (await post({ g: 'bcity', b: 'taxi', p: 'pe', n: 'www.spam.com', v: 500 })).body.name === '车手');
await post({ g: 'bcity', b: 'taxi', p: 'pe', n: '新名字' });
ok('只给名字就改名', (await top('taxi')).top[0].name === '新名字');
const both = await Promise.all([post({ g: 'bcity', b: 'taxi', p: 'pz', n: 'z', v: 300 }), post({ g: 'bcity', b: 'taxi', p: 'pz', n: 'z', v: 900 })]);
ok('同一个人同时交两次不出错，留好的那次', both.every((r) => r.status === 200) && (await top('taxi', 'pz')).me?.score === 900, both.map((r) => r.status).join());
let limited = 0;
for (let i = 0; i < 7; i++) if ((await post({ g: 'bcity', b: 'combo', p: 'flood' + i, n: 'x', v: 100 + i }, '8.8.8.8')).status === 429) limited++;
ok('同一设备一天最多开 5 个新号', limited === 2, `(${limited} 次被挡)`);
ok('库里没有完整 IP（排行榜）', !JSON.stringify(db.prepare('SELECT * FROM lb').all()).includes('8.8.8.8'));

// —— 在线人数
const online = async (g = 'bcity') => (await worker.fetch(new Request('https://s/online?g=' + g), env)).json();
const onBefore = (await online()).online;
await beat({ g: 'bcity', s: 'on1', a: 1 }); await beat({ g: 'bcity', s: 'on2', a: 1 }, { 'cf-connecting-ip': '7.7.7.7' }); await beat({ g: 'bcity', s: 'on1', a: 2 });
const o = await online();
ok('在线人数：两个会话（同一会话跳两次算一个）', o.online === onBefore + 2, JSON.stringify(o));
ok('今天玩过的设备数', o.today >= 2);
db.prepare("UPDATE ev SET seen = ? WHERE sid = 'on2'").run(Date.now() - 60e3);
ok('一分钟没心跳就不算在线', (await online()).online === onBefore + 1);
ok('不认识的游戏不给数', (await worker.fetch(new Request('https://s/online?g=hack'), env)).status === 400);

// —— 反馈
const fb = async (body, ip = '5.6.7.8') => {
  const r = await worker.fetch(new Request('https://s/fb', { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'text/plain', 'user-agent': 'fb-ua', 'cf-connecting-ip': ip } }), env);
  return { status: r.status, body: await r.json().catch(() => null) };
};
const admin = (path, init) => worker.fetch(new Request('https://s' + path + (path.includes('?') ? '&' : '?') + 'k=secret', init), env);
const shot = 'data:image/jpeg;base64,' + btoa('fake-jpeg-bytes');
const f1 = await fb({ g: 'bcity', k: 'bug', t: '  车开到国贸桥卡住了\n动不了  ', c: 'wx: abc', x: { v: 'abc123', q: 'low', pos: [4524, 190], road: '建国门外大街' }, s: shot, p: 'player1' });
ok('反馈收下，回编号', f1.status === 200 && f1.body.ok && f1.body.id > 0, JSON.stringify(f1.body));
ok('正文去掉首尾空白、保留换行', db.prepare('SELECT text FROM fb WHERE id = ?').get(f1.body.id).text === '车开到国贸桥卡住了\n动不了');
ok('截图单独存', db.prepare('SELECT data FROM fb_shot WHERE id = ?').get(f1.body.id)?.data === shot);
ok('十分钟内一字不差的重复只收一条', (await fb({ g: 'bcity', k: 'bug', t: '车开到国贸桥卡住了\n动不了', p: 'player1' })).body.dup === true && db.prepare('SELECT COUNT(*) AS c FROM fb').get().c === 1);
ok('空的不收', (await fb({ g: 'bcity', k: 'idea', t: '   ' })).status === 400);
ok('类型不对不收', (await fb({ g: 'bcity', k: 'hack', t: 'x' })).status === 400);
ok('别的网址的截图不收', (await fb({ g: 'bcity', k: 'idea', t: '加个地图', s: 'data:image/png;base64,AAA' })).status === 200 && db.prepare('SELECT has_shot FROM fb ORDER BY id DESC LIMIT 1').get().has_shot === 0);
ok('超长正文截到 2000 字', (await fb({ g: 'bcity', k: 'other', t: '长'.repeat(5000) })).status === 200 && db.prepare('SELECT length(text) AS n FROM fb ORDER BY id DESC LIMIT 1').get().n === 2000);
let fbLimited = 0;
for (let i = 0; i < 24; i++) if ((await fb({ g: 'bcity', k: 'idea', t: '建议 ' + i }, '9.9.9.9')).status === 429) fbLimited++;
ok('同一设备一天最多 20 条', fbLimited === 4, `(${fbLimited} 次被挡)`);
ok('库里没有完整 IP（反馈）', !JSON.stringify(db.prepare('SELECT * FROM fb').all()).includes('5.6.7.8'));
ok('没密钥看不了反馈', (await worker.fetch(new Request('https://s/fb/list'), env)).status === 401);
const list = await (await admin('/fb/list')).json();
ok('列表最新在上、带计数', list.items.length > 20 && list.items[list.items.length - 1].id === f1.body.id && list.counts.new > 20);
const img = await admin('/fb/shot?id=' + f1.body.id);
ok('截图按 JPEG 回出来', img.status === 200 && img.headers.get('content-type') === 'image/jpeg' && new TextDecoder().decode(await img.arrayBuffer()) === 'fake-jpeg-bytes');
await admin('/fb/state?id=' + f1.body.id + '&s=done', { method: 'POST' });
ok('标为已处理', (await (await admin('/fb/list?state=done')).json()).items.map((r) => r.id).join() === String(f1.body.id));
ok('反馈页要密钥才出', (await worker.fetch(new Request('https://s/fb'), env)).status === 401 && (await admin('/fb')).status === 200);

// —— 反馈里的对话
const mine = async (p) => (await worker.fetch(new Request('https://s/fb/mine?g=bcity&p=' + p), env)).json();
const pl = async (path, b, ip = '5.6.7.8') => { const r = await worker.fetch(new Request('https://s' + path, { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'text/plain', 'user-agent': 'fb-ua', 'cf-connecting-ip': ip } }), env); return { status: r.status, body: await r.json().catch(() => null) }; };
ok('没回复时没有未读', (await mine('player1')).unread === 0 && (await mine('player1')).items[0].id === f1.body.id);
ok('没密钥不能回复', (await worker.fetch(new Request('https://s/fb/msg?id=' + f1.body.id, { method: 'POST', body: '{"t":"x"}' }), env)).status === 401);
const ans = await (await admin('/fb/msg?id=' + f1.body.id, { method: 'POST', body: JSON.stringify({ t: '  国贸桥哪个方向？\n能截个地图吗  ' }) })).json();
ok('后台回复', ans.ok && ans.msg.who === 'dev' && ans.msg.text === '国贸桥哪个方向？\n能截个地图吗');
let m1 = await mine('player1');
ok('玩家取到回复和未读数', m1.unread === 1 && m1.items[0].msgs.length === 1 && m1.items[0].msgs[0].unread === true && m1.items[0].msgs[0].text.startsWith('国贸桥'));
ok('别的玩家号取不到', (await mine('player2')).items.length === 0 && (await mine('')).items === undefined);
ok('取到的不带玩家号和设备', !JSON.stringify(m1).includes('player1') && !JSON.stringify(m1).includes('ip_hash'));
ok('看过了就不算未读', (await pl('/fb/seen', { g: 'bcity', p: 'player1' })).status === 200 && (await mine('player1')).unread === 0);
ok('后台看得到玩家已看', (await (await admin('/fb/list')).json()).items.find((r) => r.id === f1.body.id).msgs[0].seen > 0);
ok('别人的反馈回不了', (await pl('/fb/reply', { g: 'bcity', p: 'player2', id: f1.body.id, t: '我是冒充的' })).status === 404);
ok('空回复不收', (await pl('/fb/reply', { g: 'bcity', p: 'player1', id: f1.body.id, t: '  ' })).status === 400);
const rp = await pl('/fb/reply', { g: 'bcity', p: 'player1', id: f1.body.id, t: '往东，三环主路上' });
ok('玩家接着回', rp.status === 200 && rp.body.msg.who === 'me');
ok('连点两下只收一条', (await pl('/fb/reply', { g: 'bcity', p: 'player1', id: f1.body.id, t: '往东，三环主路上' })).body.dup === true && (await mine('player1')).items[0].msgs.length === 2);
const after = (await (await admin('/fb/list')).json()).items.find((r) => r.id === f1.body.id);
ok('玩家回了，反馈变回未读、对话按顺序', after.state === 'new' && after.msgs.map((m) => m.who).join() === 'dev,me');
await admin('/fb/msg?id=' + f1.body.id, { method: 'POST', body: JSON.stringify({ t: '收到，修好了' }) });
ok('后台回复后未读标成已读', (await (await admin('/fb/list')).json()).items.find((r) => r.id === f1.body.id).state === 'read');
const dv = (await mine('player1')).items[0].msgs.find((m) => m.text === '收到，修好了');
await admin('/fb/msgdel?id=' + dv.id, { method: 'POST' });
ok('后台删回复', (await mine('player1')).items[0].msgs.length === 2 && (await mine('player1')).unread === 0);
await admin('/fb/msgdel?id=' + rp.body.msg.id, { method: 'POST' });
ok('玩家的话删不掉', (await mine('player1')).items[0].msgs.length === 2);
let replyLimited = 0;
for (let i = 0; i < 32; i++) if ((await pl('/fb/reply', { g: 'bcity', p: 'player1', id: f1.body.id, t: '补充 ' + i })).status === 429) replyLimited++;
ok('玩家一天最多回 30 条', replyLimited === 3, `(${replyLimited} 次被挡)`);

// —— 账号与云存档
const ac = async (path, b, ip = '7.7.7.7') => { const r = await worker.fetch(new Request('https://s' + path, { method: 'POST', body: JSON.stringify(b), headers: { 'content-type': 'text/plain', 'user-agent': 'test-ua', 'cf-connecting-ip': ip } }), env); return { status: r.status, body: await r.json() }; };
const reg = await ac('/acct/register', { g: 'bcity', name: '陈野Fan', pw: 'secret1' });
ok('注册成功：给令牌和恢复码', reg.status === 200 && reg.body.token?.length === 64 && /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(reg.body.recovery), JSON.stringify(reg.body).slice(0, 80));
ok('同名（不分大小写）不能再注册', (await ac('/acct/register', { g: 'bcity', name: '陈野fan', pw: 'secret2' })).status === 409);
ok('名字太短、带空格、像网址的不行', (await ac('/acct/register', { g: 'bcity', name: 'a', pw: 'secret1' })).status === 400 && (await ac('/acct/register', { g: 'bcity', name: 'a b', pw: 'secret1' })).status === 400 && (await ac('/acct/register', { g: 'bcity', name: 'www.x.com', pw: 'secret1' })).status === 400);
ok('密码太短不行', (await ac('/acct/register', { g: 'bcity', name: 'short', pw: '123' })).status === 400);
ok('不认识的游戏不行', (await ac('/acct/register', { g: 'nope', name: 'abc', pw: 'secret1' })).status === 400);
const row = db.prepare('SELECT * FROM acct').get();
ok('库里没有密码和恢复码原文', !JSON.stringify(row).includes('secret1') && !JSON.stringify(row).includes(reg.body.recovery.replace(/-/g, '')) && row.pw.startsWith('pbkdf2$100000$'));
ok('库里没有令牌原文', !JSON.stringify(db.prepare('SELECT * FROM sess').all()).includes(reg.body.token));
const t1 = reg.body.token;
const g0 = await ac('/save/get', { g: 'bcity', t: t1 });
ok('新号没有存档', g0.status === 200 && g0.body.data === null && g0.body.ver === 0 && g0.body.name === '陈野Fan');
const p1 = await ac('/save/put', { g: 'bcity', t: t1, ver: 0, data: JSON.stringify({ 'drivecity.cash': '500' }) });
ok('存档：版本 1', p1.status === 200 && p1.body.ver === 1);
const lg = await ac('/acct/login', { g: 'bcity', name: '陈野FAN', pw: 'secret1' });
ok('另一台设备登录（大小写不敏感）', lg.status === 200 && lg.body.name === '陈野Fan' && lg.body.token !== t1);
const g1 = await ac('/save/get', { g: 'bcity', t: lg.body.token });
ok('另一台设备读到存档', g1.body.ver === 1 && JSON.parse(g1.body.data)['drivecity.cash'] === '500');
await ac('/save/put', { g: 'bcity', t: lg.body.token, ver: 1, data: JSON.stringify({ 'drivecity.cash': '900' }) });
const stale = await ac('/save/put', { g: 'bcity', t: t1, ver: 1, data: JSON.stringify({ 'drivecity.cash': '100' }) });
ok('旧版本上的存档被挡：409 冲突', stale.status === 409 && stale.body.error === 'conflict' && stale.body.ver === 2);
ok('强行覆盖可以', (await ac('/save/put', { g: 'bcity', t: t1, ver: 1, force: true, data: JSON.stringify({ 'drivecity.cash': '100' }) })).body.ver === 3);
ok('坏数据、太大的存档不收', (await ac('/save/put', { g: 'bcity', t: t1, ver: 3, data: 'not json' })).status === 400 && (await ac('/save/put', { g: 'bcity', t: t1, ver: 3, data: JSON.stringify({ x: 'y'.repeat(700000) }) })).status === 413);
ok('没登录不能读写', (await ac('/save/get', { g: 'bcity', t: 'f'.repeat(64) })).status === 401 && (await ac('/save/put', { g: 'bcity', data: '{}' })).status === 401);
let wrong = 0, blocked = 0;
for (let i = 0; i < 12; i++) { const r = await ac('/acct/login', { g: 'bcity', name: '陈野Fan', pw: 'bad' + i }, '8.8.8.' + i); if (r.status === 401) wrong++; if (r.status === 429) blocked++; }
ok('同一个号 15 分钟错 10 次就先挡住', wrong === 10 && blocked === 2, `(${wrong} 错 ${blocked} 挡)`);
ok('挡住期间密码对了也先别登', (await ac('/acct/login', { g: 'bcity', name: '陈野Fan', pw: 'secret1' }, '6.6.6.6')).status === 429);
db.prepare('DELETE FROM acct_fail').run();
ok('恢复码错了不能重设', (await ac('/acct/reset', { g: 'bcity', name: '陈野Fan', recovery: 'AAAA-BBBB-CCCC', pw: 'newpass1' })).status === 401);
const rs = await ac('/acct/reset', { g: 'bcity', name: '陈野Fan', recovery: reg.body.recovery.toLowerCase().replace(/-/g, ' '), pw: 'newpass1' });
ok('恢复码重设密码（大小写、分隔符随意），给新恢复码', rs.status === 200 && rs.body.recovery && rs.body.recovery !== reg.body.recovery);
ok('重设后旧登录作废', (await ac('/save/get', { g: 'bcity', t: t1 })).status === 401 && (await ac('/save/get', { g: 'bcity', t: lg.body.token })).status === 401);
ok('新密码能登、旧密码不行', (await ac('/acct/login', { g: 'bcity', name: '陈野Fan', pw: 'newpass1' })).status === 200 && (await ac('/acct/login', { g: 'bcity', name: '陈野Fan', pw: 'secret1' })).status === 401);
ok('旧恢复码用过就失效', (await ac('/acct/reset', { g: 'bcity', name: '陈野Fan', recovery: reg.body.recovery, pw: 'x123456' })).status === 401);
await ac('/acct/logout', { g: 'bcity', t: rs.body.token });
ok('退出后令牌失效', (await ac('/save/get', { g: 'bcity', t: rs.body.token })).status === 401);
let made = 0;
for (let i = 0; i < 7; i++) if ((await ac('/acct/register', { g: 'bcity', name: 'bot' + i, pw: 'secret1' }, '3.3.3.3')).status === 200) made++;
ok('同一台设备一天最多注册 5 个号', made === 5, `(${made})`);
db.prepare('UPDATE save SET data = ?').run(JSON.stringify({ 'drivecity.cash': '100', 'drivecity.playtime.v1': '4000', 'drivecity.campaign.v1': JSON.stringify({ done: ['c1', 'c2'] }) }));
const accts = (await (await worker.fetch(new Request('https://s/api?k=secret&days=7'), env)).json()).accounts;
const ab = accts.games.find((g) => g.game === 'bcity'), fan = accts.list.find((a) => a.name === '陈野Fan'), bot = accts.list.find((a) => a.name === 'bot0');
ok('看板：注册账号数、今天新增、有存档的、累计时长', ab?.total === 6 && ab.new_today === 6 && ab.new_range === 6 && ab.saves === 1 && ab.play === 4000, JSON.stringify(ab));
ok('看板：账号列表带存档里的时长、钱、章节', fan?.play === 4000 && fan.cash === 100 && fan.chapters === 2 && fan.saved > 0 && bot && bot.play === null && bot.chapters === null, JSON.stringify([fan, bot]));
ok('看板：每日注册', accts.daily.some((d) => d.game === 'bcity' && d.n === 6));

// —— 聊天
const chat = async (b, ip = '4.4.4.4') => { const r = await worker.fetch(new Request('https://s/chat', { method: 'POST', body: JSON.stringify({ g: 'bcity', ...b }), headers: { 'content-type': 'text/plain', 'user-agent': 'test-ua', 'cf-connecting-ip': ip } }), env); return { status: r.status, body: await r.json() }; };
const chatGet = async (q) => (await worker.fetch(new Request('https://s/chat?g=bcity' + q), env)).json();
const c1 = await chat({ p: 'guestpid1', text: '  大家好，第四章怎么跟踪老周？ ' });
ok('游客发言：名字是「游客」+ 4 位编号', c1.status === 200 && /^游客\d{4}$/.test(c1.body.msg.name) && c1.body.msg.guest === true && c1.body.msg.text === '大家好，第四章怎么跟踪老周？', JSON.stringify(c1.body));
const c1b = await chat({ p: 'guestpid1', text: '再来一条' });
ok('3 秒内不能再发', c1b.status === 429 && c1b.body.error === 'fast');
db.prepare('UPDATE chat SET ts = ts - 5000').run();
ok('同一台设备编号固定', (await chat({ p: 'guestpid1', text: '我又来了' })).body.msg?.name === c1.body.msg.name);
const regC = await ac('/acct/register', { g: 'bcity', name: '老司机', pw: 'secret1' }, '5.5.5.5');
db.prepare('UPDATE chat SET ts = ts - 5000').run();
const c2 = await chat({ p: 'acctpid', t: regC.body.token, text: '你这傻逼车开得真烂' }, '5.5.5.5');
ok('登录的用账号名，脏话打星号', c2.body.msg?.name === '老司机' && c2.body.msg.guest === false && c2.body.msg.text === '你这**车开得真烂', JSON.stringify(c2.body));
db.prepare('UPDATE chat SET ts = ts - 5000').run();
ok('广告（网址、微信、QQ 号）不收', (await chat({ p: 'adpid', text: '加微信领福利' }, '6.6.6.1')).body.error === 'ad' && (await chat({ p: 'adpid2', text: 'www.xx.com' }, '6.6.6.2')).body.error === 'ad' && (await chat({ p: 'adpid3', text: '扣扣1234567890' }, '6.6.6.3')).body.error === 'ad');
ok('空的、没玩家号的不收', (await chat({ p: 'x1', text: '   ' }, '6.6.6.4')).status === 400 && (await chat({ text: 'hi' }, '6.6.6.5')).status === 400);
const long = await chat({ p: 'longpid', text: '长'.repeat(300) }, '6.6.6.6');
ok('超过 120 字截断', [...long.body.msg.text].length === 120);
const all = await chatGet('');
ok('取最近的消息（旧的在前，不含广告）', all.msgs.length === 4 && all.msgs[0].text.startsWith('大家好') && all.last === all.msgs[3].id, JSON.stringify(all.msgs.map((m) => m.text.slice(0, 6))));
const newer = await chatGet('&after=' + all.msgs[1].id);
ok('after 只给更新的', newer.msgs.length === 2 && newer.msgs[0].id === all.msgs[2].id);
ok('库里没有完整 IP（聊天）', !JSON.stringify(db.prepare('SELECT * FROM chat').all()).includes('4.4.4.4'));
ok('后台要密钥', (await worker.fetch(new Request('https://s/chat/list'), env)).status === 401 && (await admin('/chat/admin')).status === 200);
await admin('/chat/hide?id=' + c2.body.msg.id, { method: 'POST' });
ok('后台删掉的玩家看不到', !(await chatGet('')).msgs.some((m) => m.id === c2.body.msg.id));
await admin('/chat/ban?id=' + c1.body.msg.id + '&hours=24', { method: 'POST' });
db.prepare('UPDATE chat SET ts = ts - 5000').run();
const banned = await chat({ p: 'guestpid1', text: '我被禁言了吗' });
ok('禁言后不能发（按玩家号）', banned.status === 403 && banned.body.error === 'banned');
ok('换个玩家号同一台设备也不行', (await chat({ p: 'guestpid9', text: '换号' })).status === 403);
await admin('/chat/ban?id=' + c1.body.msg.id + '&hours=0', { method: 'POST' });
ok('解除禁言后能发', (await chat({ p: 'guestpid1', text: '解封了' })).status === 200);

// —— 漏斗（b城追车）
const fnRows = () => db.prepare("SELECT * FROM fn WHERE game = 'bcity'").all();
await beat({ g: 'bcity', s: 'fun1', a: 3, w: 1440, m: { v: 1, js: 4.2, b_city: 6, title: 20.5, dlkb: 6800, kbps: 330, q: 'high', gpu: 'Apple M2' } });
ok('带漏斗的心跳写进 fn', fnRows().length === 1 && JSON.parse(fnRows()[0].data).title === 20.5);
await beat({ g: 'bcity', s: 'fun1', a: 70, w: 1440, m: { v: 1, js: 4.2, b_city: 6, title: 20.5, dlkb: 6800, kbps: 330, q: 'high', gpu: 'Apple M2', start: 25, move: 31.04, p1m: 88 } });
ok('后来的超集替换先前的', JSON.parse(fnRows()[0].data).p1m === 88 && JSON.parse(fnRows()[0].data).move === 31);
await beat({ g: 'bcity', s: 'fun1', a: 70, w: 1440, m: { v: 1, js: 4.2 } });
ok('乱序到的旧心跳不会覆盖', JSON.parse(fnRows()[0].data).p1m === 88);
await beat({ g: 'bcity', s: 'fun2', a: 0, w: 390, m: { v: 1, ret: 1, js: 9, e: 'TypeError: x is undefined', err: 2, 'Bad Key': 1, big: 'x'.repeat(500), obj: { a: 1 } } });
const f2 = JSON.parse(fnRows().find((r) => r.sid === 'fun2').data);
ok('坏键和对象丢掉、长串截断', !('Bad Key' in f2) && !('obj' in f2) && f2.big.length === 160 && f2.err === 2);
ok('手机标记', fnRows().find((r) => r.sid === 'fun2').mobile === 1);
await beat({ g: 'bcity', s: 'fun3', a: 0, w: 1440, m: [1, 2] });
await beat({ g: 'bcity', s: 'fun4', a: 0, w: 1440 });
ok('数组和没带 m 的不写 fn', fnRows().length === 2);
const fun = (await (await worker.fetch(new Request('https://s/api?days=7&k=secret'), env)).json()).funnel;
ok('看板：漏斗步骤和分组', fun.steps[0][0] === 'js' && fun.segs.all.n === 2 && fun.segs.mobile.n === 1 && fun.segs.back.n === 1 && fun.segs.fresh.n === 1);
ok('看板：每步人数和中位', fun.segs.all.num.js.c === 2 && fun.segs.all.num.title.c === 1 && fun.segs.all.num.title.p50 === 20.5);
ok('看板：最远到哪一步', fun.segs.all.last.p1m === 1 && fun.segs.all.last.js === 1);
ok('看板：出错信息汇总', fun.segs.all.str.e[0][0] === 'TypeError: x is undefined' && fun.segs.all.str.e[0][1] === 1);

console.log(failed ? `\n${failed} 条没过` : '\n全过');
process.exit(failed ? 1 : 0);
