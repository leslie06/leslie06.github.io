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

console.log(failed ? `\n${failed} 条没过` : '\n全过');
process.exit(failed ? 1 : 0);
