// 联机（2026-10-29 起，b城追车，「做成可以和朋友联机，可以同时开车，朋友也能上自己的车，做联机版」）：
// WebSocket 中转，房间在内存里，不进数据库。只在 Node 版（server.mjs）上有，Cloudflare Worker 版没有。
//
//   wss://…/mp            连上以后第一条消息：
//     {t:'create', g, p, tk}            建房间（p 随机玩家号，tk 登录令牌可不给）→ {t:'joined', room, id, peers}
//     {t:'join', g, p, tk, room}        进房间 → joined，或 {t:'err', e: noroom 没这个房间 / full 满了 / bad}
//   然后：
//     {t:'s', …} 自己的状态（位置、车、姿态，每秒 ~10 次）、{t:'e', …} 一次性的事（按喇叭）
//                → 原样转给房间里其他人，加上 id
//     别人进来 {t:'peer', id, name}，走了 {t:'gone', id}
//
// 一个房间最多 MAX_PEERS 人；房间号 4 位数字；没人了房间就删。名字服务器定：登录的用账号名，没登录是「游客」+ 4 位编号
// （和聊天的一样），不能自己冒充别人的账号名。限流：一条最多 2 KB、一个连接每秒最多 40 条，超了的直接丢。
// 15 秒 ping 一次，40 秒没回音就断。
import { createHash } from 'node:crypto';

export const MAX_PEERS = 4;
const MAX_ROOMS = 3000, MAX_MSG = 2048, PER_SEC = 40, PING_MS = 15000, DEAD_MS = 40000;
const GAMES = new Set(['bcity']);

/** 一个 WebSocket 连接（RFC 6455 服务端，只用文本帧）。 */
class Conn {
  constructor(socket) {
    this.socket = socket;
    this.buf = Buffer.alloc(0);
    this.frag = null;
    this.open = true;
    this.seen = Date.now();
    this.onText = () => {};
    this.onClose = () => {};
    socket.setNoDelay(true);
    socket.on('data', (d) => this.feed(d));
    socket.on('close', () => this.closed());
    socket.on('error', () => this.closed());
  }
  feed(d) {
    this.buf = this.buf.length ? Buffer.concat([this.buf, d]) : d;
    for (;;) {
      const b = this.buf;
      if (b.length < 2) return;
      const fin = b[0] & 0x80, op = b[0] & 0x0f, masked = b[1] & 0x80;
      let len = b[1] & 0x7f, at = 2;
      if (len === 126) { if (b.length < 4) return; len = b.readUInt16BE(2); at = 4; }
      else if (len === 127) { if (b.length < 10) return; len = Number(b.readBigUInt64BE(2)); at = 10; }
      if (len > MAX_MSG * 4 || !masked) { this.close(1009); return; }
      if (b.length < at + 4 + len) return;
      const mask = b.subarray(at, at + 4), data = Buffer.from(b.subarray(at + 4, at + 4 + len));
      for (let i = 0; i < data.length; i++) data[i] ^= mask[i & 3];
      this.buf = b.subarray(at + 4 + len);
      this.seen = Date.now();
      if (op === 0x8) { this.close(1000); return; }
      if (op === 0x9) { this.frame(0xa, data); continue; }
      if (op === 0xa) continue;
      if (op === 0x1 || op === 0x2) this.frag = [data];
      else if (op === 0x0 && this.frag) this.frag.push(data);
      else continue;
      if (fin) {
        const all = Buffer.concat(this.frag); this.frag = null;
        if (all.length <= MAX_MSG) this.onText(all.toString('utf8'));
      }
    }
  }
  frame(op, data) {
    if (!this.open) return;
    const n = data.length;
    const head = n < 126 ? Buffer.from([0x80 | op, n]) : n < 65536 ? Buffer.from([0x80 | op, 126, n >> 8, n & 255]) : null;
    if (!head) return;
    this.socket.write(Buffer.concat([head, data]));
  }
  send(o) { this.frame(0x1, Buffer.from(typeof o === 'string' ? o : JSON.stringify(o))); }
  ping() { this.frame(0x9, Buffer.alloc(0)); }
  close(code = 1000) {
    if (!this.open) return;
    this.frame(0x8, Buffer.from([code >> 8, code & 255]));
    this.socket.end();
    this.closed();
  }
  closed() {
    if (!this.open) return;
    this.open = false;
    this.socket.destroy();
    this.onClose();
  }
}

/**
 * 接到 HTTP 服务上：`/mp` 的升级请求变成联机连接。`nameOf(g, pid, token)` 回显示的名字（登录的账号名或游客编号）。
 * 回一个 `stats()`（看板、测试用：房间数、人数）。
 */
export function attachMp(server, nameOf) {
  const rooms = new Map();   // 房间号 → { code, peers: Map<id, {id, name, conn}>, next }
  const newCode = () => {
    for (let i = 0; i < 200; i++) {
      const c = String(1000 + Math.floor(Math.random() * 9000));
      if (!rooms.has(c)) return c;
    }
    return null;
  };
  const others = (room, id, msg) => { const s = JSON.stringify(msg); for (const p of room.peers.values()) if (p.id !== id) p.conn.send(s); };

  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, 'http://x');
    const key = req.headers['sec-websocket-key'];
    if (url.pathname !== '/mp' || !key || String(req.headers.upgrade).toLowerCase() !== 'websocket') { socket.destroy(); return; }
    const accept = createHash('sha1').update(key + '258EAFA5-E914-47DA-95CA-C5AB0DC85B11').digest('base64');
    socket.write(`HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: ${accept}\r\n\r\n`);
    const conn = new Conn(socket);
    let room = null, me = null, busy = false, sec = 0, n = 0;
    conn.onText = async (text) => {
      let m;
      try { m = JSON.parse(text); } catch { return; }
      if (!m || typeof m !== 'object') return;
      const now = Date.now();
      if (now - sec > 1000) { sec = now; n = 0; }
      if (++n > PER_SEC) return;
      if (!me) {
        if (busy || (m.t !== 'create' && m.t !== 'join')) return;
        if (!GAMES.has(m.g)) { conn.send({ t: 'err', e: 'bad' }); return; }
        busy = true;
        const name = await nameOf(m.g, String(m.p ?? ''), typeof m.tk === 'string' ? m.tk : '');
        busy = false;
        if (!conn.open) return;
        if (m.t === 'create') {
          if (rooms.size >= MAX_ROOMS) { conn.send({ t: 'err', e: 'busy' }); return; }
          const code = newCode();
          if (!code) { conn.send({ t: 'err', e: 'busy' }); return; }
          room = { code, peers: new Map(), next: 1, born: now };
          rooms.set(code, room);
        } else {
          room = rooms.get(String(m.room ?? '').replace(/\D/g, '')) ?? null;
          if (!room) { conn.send({ t: 'err', e: 'noroom' }); return; }
          if (room.peers.size >= MAX_PEERS) { room = null; conn.send({ t: 'err', e: 'full' }); return; }
        }
        me = { id: room.next++, name, conn };
        room.peers.set(me.id, me);
        conn.send({ t: 'joined', room: room.code, id: me.id, name, max: MAX_PEERS, peers: [...room.peers.values()].filter((p) => p !== me).map((p) => ({ id: p.id, name: p.name })) });
        others(room, me.id, { t: 'peer', id: me.id, name });
        return;
      }
      if (m.t === 's' || m.t === 'e') { m.id = me.id; others(room, me.id, m); return; }
      if (m.t === 'leave') conn.close(1000);
    };
    conn.onClose = () => {
      if (!room || !me) return;
      room.peers.delete(me.id);
      if (room.peers.size) others(room, me.id, { t: 'gone', id: me.id });
      else rooms.delete(room.code);
    };
    if (head?.length) conn.feed(head);
    conns.add(conn);
    conn.socket.on('close', () => conns.delete(conn));
  });

  const conns = new Set();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const c of conns) { if (now - c.seen > DEAD_MS) c.closed(); else c.ping(); }
  }, PING_MS);
  timer.unref();
  return { stats: () => ({ rooms: rooms.size, players: [...rooms.values()].reduce((s, r) => s + r.peers.size, 0) }) };
}
