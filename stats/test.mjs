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

console.log(failed ? `\n${failed} 条没过` : '\n全过');
process.exit(failed ? 1 : 0);
