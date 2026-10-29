// 联机中转的自测：起一个真的 server.mjs（临时库、随机端口），用 Node 自带的 WebSocket 当几个玩家。
//   node stats/mp.test.mjs      退出码 0 = 全过
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'mp-'));
const port = 20000 + Math.floor(Math.random() * 20000);
const srv = spawn(process.execPath, [join(HERE, 'server.mjs')], { env: { ...process.env, PORT: String(port), DB_FILE: join(dir, 'x.sqlite') }, stdio: ['ignore', 'pipe', 'pipe'] });
await new Promise((r) => srv.stdout.on('data', (d) => { if (String(d).includes('统计服务')) r(); }));

let failed = 0;
const ok = (name, cond, extra = '') => { if (!cond) failed++; console.log(cond ? '  ok  ' : 'FAIL  ', name, extra); };
/** A player: its socket and every message it got. */
const player = () => new Promise((resolve, reject) => {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/mp`);
  const got = [];
  ws.onmessage = (e) => got.push(JSON.parse(e.data));
  ws.onopen = () => resolve({ ws, got, send: (o) => ws.send(JSON.stringify(o)), wait: (pred, ms = 2000) => waitFor(() => got.find(pred), ms) });
  ws.onerror = reject;
});
const waitFor = async (fn, ms) => { const end = Date.now() + ms; while (Date.now() < end) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 15)); } return null; };

try {
  const a = await player();
  a.send({ t: 'create', g: 'bcity', p: 'aaaa1111' });
  const ja = await a.wait((m) => m.t === 'joined');
  ok('建房间：4 位房间号、自己是 1 号、游客名字', ja && /^\d{4}$/.test(ja.room) && ja.id === 1 && /^游客\d{4}$/.test(ja.name) && ja.peers.length === 0, JSON.stringify(ja));
  const b = await player();
  b.send({ t: 'join', g: 'bcity', p: 'bbbb2222', room: ja.room });
  const jb = await b.wait((m) => m.t === 'joined');
  ok('进房间：看到房主', jb && jb.id === 2 && jb.peers.length === 1 && jb.peers[0].id === 1);
  ok('房主收到有人进来', !!(await a.wait((m) => m.t === 'peer' && m.id === 2)));
  b.send({ t: 's', x: 10, z: -20, b: 'super' });
  const s = await a.wait((m) => m.t === 's');
  ok('状态转给别人、带上 id', s && s.id === 2 && s.x === 10 && s.b === 'super');
  await new Promise((r) => setTimeout(r, 100));
  ok('自己的状态不回给自己', !b.got.some((m) => m.t === 's'));
  const c = await player(), d = await player(), e = await player();
  for (const [p, pid] of [[c, 'cccc3333'], [d, 'dddd4444']]) { p.send({ t: 'join', g: 'bcity', p: pid, room: ja.room }); await p.wait((m) => m.t === 'joined'); }
  e.send({ t: 'join', g: 'bcity', p: 'eeee5555', room: ja.room });
  ok('满 4 人进不去', (await e.wait((m) => m.t === 'err'))?.e === 'full');
  const f = await player();
  f.send({ t: 'join', g: 'bcity', p: 'ffff6666', room: '0000' });
  ok('没这个房间', (await f.wait((m) => m.t === 'err'))?.e === 'noroom');
  b.ws.close();
  ok('有人走了，别人收到', !!(await a.wait((m) => m.t === 'gone' && m.id === 2)));
  // the name comes from the server: an account's name when logged in, a guest otherwise
  const reg = await (await fetch(`http://127.0.0.1:${port}/acct/register`, { method: 'POST', body: JSON.stringify({ g: 'bcity', name: '老司机', pw: 'secret1' }) })).json();
  const g2 = await player();
  g2.send({ t: 'create', g: 'bcity', p: 'gggg7777', tk: reg.token });
  ok('登录了用账号名', (await g2.wait((m) => m.t === 'joined'))?.name === '老司机');
  const h = await player();
  h.send({ t: 'create', g: 'bcity', p: 'hhhh8888', tk: 'x'.repeat(64) });
  ok('令牌不对就是游客', /^游客/.test((await h.wait((m) => m.t === 'joined'))?.name ?? ''));
  // flooding: at most 40 a second get through
  for (let i = 0; i < 100; i++) a.send({ t: 's', i });
  await new Promise((r) => setTimeout(r, 300));
  const through = c.got.filter((m) => m.t === 's' && m.id === 1).length;
  ok('一秒最多转 40 条', through > 0 && through <= 40, `(${through})`);
  const big = await player();
  big.send({ t: 'join', g: 'bcity', p: 'iiii9999', room: ja.room });
  ok('有人走了空出位子能进', !!(await big.wait((m) => m.t === 'joined')));
  await new Promise((r) => setTimeout(r, 1100));
  big.send({ t: 's', pad: 'x'.repeat(5000) });
  big.send({ t: 's', small: 1 });
  await a.wait((m) => m.small === 1);
  ok('太长的不转（后面正常的照转）', !a.got.some((m) => m.pad) && a.got.some((m) => m.small === 1));
  for (const p of [a, c, d, e, f, g2, h, big]) p.ws.close();
} finally {
  srv.kill();
  rmSync(dir, { recursive: true, force: true });
}
console.log(failed ? `\n${failed} 条没过` : '\n全过');
process.exit(failed ? 1 : 0);
