import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { Blip, CameraApi, HudApi, NavApi, PlayerApi, RaceApi, RenderApi, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { CampaignApi } from '../campaign';
import type { IntroApi } from '../intro';
import { Fade } from '../campaign/Screens';
import { bodyOfSpec } from '../vehicle/Bodies';
import { statsEndpoint } from './Leaderboard';
import { cleanState, RemotePeer, type NetState } from './Remote';

/**
 * Playing with friends (2026-10-29, 「做成可以和朋友联机，可以同时开车，朋友也能上自己的车，做联机版」; the user chose a
 * room code or invite link, everyone in their own car, players and cars only, at most 4): a room on the stats
 * service's WebSocket relay (`stats/mp.mjs`, `wss://…/mp`). One player creates it and gets a 4-digit code and a link
 * (`?room=1234`); friends type the code or open the link. Each one sends themselves ~10 times a second (`NetState`:
 * driving or on foot, the pose, the car's body, paint, wheels and lights) and draws the others (online/Remote.ts).
 * Everything else stays each player's own: the traffic, people and police each game runs are not the others'.
 *
 * Cars hit each other: a friend's car is a body of its own mass here, pulled after where they are by a car's force
 * (online/Remote.ts), so each game works the crash out with its own car - pushed by its share, or slowed by it - and it
 * is a crash on both sides (the thump, the shake, the hit-stop, the damage). Nothing about it is sent. (Before
 * 2026-10-30 their car was kinematic here, an immovable wall, and the push was sent: the car hit was shoved before the
 * other was drawn reaching it, and the one hitting stopped dead.) A horn is sent and sounded where they are.
 * One clock (2026-10-30, 「两个联机的车辆时间不一致，一个可能是白天，一个可能是夜晚」): the room's first player's time of
 * day is everyone's - the others' follow it (not in a story chapter, which sets its own hour).
 * `goTo(id)` takes you beside a friend (a fade, the world there loaded, the nearest lane), as the 快速前往 does.
 * Joining a room does it by itself (2026-10-30, 「进入房间的车辆还在它自己的地点，应该和创建房间的车辆离的不远」): once in
 * the city, you are taken to the room's first player (its maker, while they are in it) - after the police, a race,
 * a chapter or the opening getaway, if one is on.
 * A dropped link reconnects into the same room (if anyone is still in it). Off where the leaderboards are.
 */
export interface MpPeerView { id: number; name: string; x: number; z: number; foot: boolean; dist: number }
export type MpStatus = 'off' | 'connecting' | 'in' | 'error';
export interface MultiplayerApi extends System {
  readonly enabled: boolean;
  readonly status: MpStatus;
  /** Why the last try failed ('noroom', 'full', 'net', 'closed'), or null. */
  readonly error: string | null;
  readonly room: string | null;
  readonly me: { id: number; name: string } | null;
  readonly peers: readonly MpPeerView[];
  /** The most a room takes. */
  readonly max: number;
  create(): void;
  join(code: string): void;
  leave(): void;
  /** Take the player beside this friend; what went wrong, or null. */
  goTo(id: number): string | null;
  /** The link a friend opens to join this room. */
  inviteLink(): string;
  /** Called when the room, its people or the status change. */
  listen(fn: () => void): void;
  /** Probes: each friend's car body here. */
  debug: { bodies(): ({ v: number[]; coast: boolean; solid: boolean } | null)[] };
}

const GAME = 'bcity', SEND_MS = 100, IDLE_SEND_MS = 1000;
/** Joining: nearer than this to the room's maker already, you stay where you are. */
const MEET_NEAR = 80;
const read = <T>(k: string, d: T): T => { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v) as T; } catch { return d; } };
const r2 = (x: number) => Math.round(x * 100) / 100;
const r3 = (x: number) => Math.round(x * 1000) / 1000;
const hex = (c: THREE.Color) => `#${c.getHexString()}`;

export function install(engine: Engine): MultiplayerApi | null {
  const { base, enabled } = statsEndpoint();
  if (!enabled) return null;
  const wsUrl = `${base.replace(/^http/, 'ws')}/mp`;
  const listeners: (() => void)[] = [];
  const changed = () => { for (const fn of listeners) fn(); };
  const toast = (s: string, secs = 3) => engine.get<HudApi>('hud')?.toast(s, secs);
  const peers = new Map<number, RemotePeer>();
  let ws: WebSocket | null = null;
  let want: { kind: 'create' } | { kind: 'join'; room: string } | null = null;
  let retries = 0, retryTimer = 0, lastSend = 0, hornWas = false, stepClock = 0;
  let tagLayer: HTMLDivElement | null = null;
  const layer = () => {
    if (tagLayer) return tagLayer;
    tagLayer = document.createElement('div');
    tagLayer.className = 'mp-tags';
    document.body.appendChild(tagLayer);
    return tagLayer;
  };
  const style = document.createElement('style');
  style.textContent = `.mp-tags{position:fixed;inset:0;pointer-events:none;z-index:9;overflow:hidden}
.mp-tag{position:absolute;left:0;top:0;padding:3px 9px;border-radius:999px;background:rgba(9,11,13,.62);color:#35e0c2;font:700 13px/1.3 "PingFang SC","Microsoft YaHei",system-ui,sans-serif;white-space:nowrap;border:1px solid rgba(53,224,194,.55);will-change:transform}
.mp-tag .d{color:rgba(244,241,232,.7);font-weight:600}
.mp-tag[hidden]{display:none}
body:not(.dc-playing) .mp-tags{display:none}`;
  document.head.appendChild(style);

  const clearPeers = () => { for (const p of peers.values()) p.dispose(); peers.clear(); };
  const addPeer = (id: number, name: string) => { if (!peers.has(id)) peers.set(id, new RemotePeer(engine, id, name, layer())); };

  const open = () => {
    if (!want) return;
    api.status = 'connecting'; api.error = null; changed();
    const sock = new WebSocket(wsUrl);
    ws = sock;
    sock.onopen = () => {
      const first = want?.kind === 'join' ? { t: 'join', room: want.room } : { t: 'create' };
      sock.send(JSON.stringify({ ...first, g: GAME, p: read('drivecity.pid', ''), tk: read<{ token?: string } | null>('drivecity.acct.v1', null)?.token }));
    };
    sock.onmessage = (e) => {
      let m: Record<string, unknown>;
      try { m = JSON.parse(String(e.data)) as Record<string, unknown>; } catch { return; }
      onMessage(m);
    };
    sock.onclose = () => {
      if (ws !== sock) return;
      ws = null;
      clearPeers();
      // dropped while in a room: back into it (it lives while anyone is in it)
      if (want && api.status === 'in' && api.room && retries < 6) {
        want = { kind: 'join', room: api.room };
        api.status = 'connecting'; changed();
        retryTimer = window.setTimeout(open, Math.min(8000, 1000 * 2 ** retries++));
        return;
      }
      if (want) { api.status = 'error'; api.error = api.error ?? 'net'; want = null; api.room = null; api.me = null; changed(); }
    };
  };

  const onMessage = (m: Record<string, unknown>) => {
    if (m.t === 'joined') {
      const first = api.room === null;
      if (first && want?.kind === 'join') { meet = true; meetHinted = false; meetAt = 0; }
      api.room = String(m.room); api.me = { id: Number(m.id), name: String(m.name) };
      api.max = Number(m.max) || 4;
      api.status = 'in'; api.error = null; retries = 0;
      want = { kind: 'join', room: api.room };
      clearPeers();
      for (const p of (m.peers as { id: number; name: string }[]) ?? []) addPeer(p.id, String(p.name));
      if (first) toast(t('mp.joinedToast', { room: api.room }));
      changed();
    } else if (m.t === 'err') {
      api.error = String(m.e); want = null;
      if (api.status !== 'in') { api.status = 'error'; api.room = null; api.me = null; }
      ws?.close();
      changed();
    } else if (m.t === 'peer') {
      addPeer(Number(m.id), String(m.name));
      toast(t('mp.peerIn', { name: String(m.name) }));
      changed();
    } else if (m.t === 'gone') {
      const p = peers.get(Number(m.id));
      if (p) { toast(t('mp.peerOut', { name: p.name })); p.dispose(); peers.delete(p.id); changed(); }
    } else if (m.t === 's') {
      const p = peers.get(Number(m.id)), s = cleanState(m);
      if (p && s) {
        p.push(s);
        if (s.tm !== undefined && api.me && p.id < api.me.id && [...peers.keys()].every((k) => k >= p.id)) followClock(s.tm);
      }
    } else if (m.t === 'e') {
      const p = peers.get(Number(m.id));
      if (!p) return;
      if (m.k === 'horn') { p.sample(performance.now()); engine.events.emit('traffic:horn', { x: p.pos.x, z: p.pos.z }); }
    }
  };

  /** The room's first player's time of day, followed: a jump is taken at once, a drift eased. */
  const followClock = (tm: number) => {
    const r = engine.get<RenderApi>('render');
    if (!r || engine.get<CampaignApi>('campaign')?.running) return;
    let d = tm - r.timeOfDay;
    d -= 24 * Math.round(d / 24);
    if (Math.abs(d) > 0.25) { r.timeOfDay = tm; r.settle?.(); } else if (Math.abs(d) > 0.01) r.timeOfDay = (r.timeOfDay + d * 0.2 + 24) % 24;
  };

  const send = (o: object) => { if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(o)); };

  /** Ourselves, as the others draw us. */
  const myState = (): NetState | null => {
    const pl = engine.get<PlayerApi>('player'), v = engine.get<VehicleApi>('vehicle');
    if (!pl || !v) return null;
    const ts = Math.round(performance.now()), tm = r2(engine.get<RenderApi>('render')?.timeOfDay ?? 15);
    if (pl.mode === 'driving' || !pl.foot) {
      const car = v.car, p = v.renderPos, q = v.renderQuat, c = v.controls;
      const li = (c.brake > 0.1 ? 1 : 0) | (car.gear === -1 ? 2 : 0) | ((engine.get<RenderApi>('render')?.night ?? 0) > 0.35 ? 4 : 0);
      return {
        ts, m: 'd', p: [r2(p.x), r2(p.y), r2(p.z)], v: [r2(car.vel.x), r2(car.vel.y), r2(car.vel.z)],
        q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)], b: v.look.body ?? bodyOfSpec(car.spec), c: [hex(v.look.upper), hex(v.look.lower)], tx: v.look.taxi ? 1 : 0,
        ws: [r3(car.wheels[0]?.steer ?? 0), r3(car.wheels[1]?.steer ?? 0)],
        wl: [0, 1, 2, 3].map((i) => r3(car.wheels[i]?.springLen ?? 0)) as NetState['wl'],
        ln: [r3(v.lean.pitch), r3(v.lean.roll)], sp: r2(car.forwardSpeed), li, tm,
      };
    }
    const f = pl.foot;
    return { ts, m: 'f', p: [r2(f.pos.x), r2(f.pos.y), r2(f.pos.z)], v: [r2(f.vel.x), r2(f.vel.y), r2(f.vel.z)], y: r3(f.yaw), fs: r2(Math.hypot(f.vel.x, f.vel.z)), tm };
  };

  let fade: Fade | null = null, travelling = false;
  /** Just joined a room: still to be taken to its maker. */
  let meet = false, meetHinted = false, meetAt = 0;

  /** Why the player cannot be taken anywhere now (an i18n key), or null. */
  const busy = (): 'travel.wanted' | 'travel.busy' | null => {
    const pl = engine.get<PlayerApi>('player');
    if ((engine.get<WantedApi>('wanted')?.level ?? 0) > 0) return 'travel.wanted';
    if (travelling || engine.get<RaceApi>('races')?.active || engine.get<CampaignApi>('campaign')?.running || pl?.riding) return 'travel.busy';
    return null;
  };

  /** Joined a room: off to its first player once they show up in the city, as soon as nothing holds us here. */
  const meetUp = (now: number) => {
    if (now < meetAt) return;
    meetAt = now + 1000;
    let host: RemotePeer | null = null;
    for (const p of peers.values()) if (p.state && (!host || p.id < host.id)) host = p;
    const me = engine.get<PlayerApi>('player')?.position;
    if (!host || !me) return;
    if (Math.hypot(host.pos.x - me.x, host.pos.z - me.z) < MEET_NEAR) { meet = false; return; }
    const intro = engine.get<IntroApi>('intro')?.step;
    const why = busy() ?? (intro && intro !== 'off' && intro !== 'done' ? 'travel.busy' : null);
    if (why) {
      if (!meetHinted) { meetHinted = true; toast(t(why === 'travel.wanted' ? 'mp.meetWanted' : 'mp.meetBusy', { name: host.name }), 5); }
      return;
    }
    meet = false;
    api.goTo(host.id);
  };

  const api: MultiplayerApi & { status: MpStatus; error: string | null; room: string | null; me: { id: number; name: string } | null; max: number } = {
    name: 'mp',
    enabled,
    status: 'off',
    error: null,
    room: null,
    me: null,
    max: 4,
    get peers() {
      const me = engine.get<PlayerApi>('player')?.position;
      return [...peers.values()].map((p) => ({ id: p.id, name: p.name, x: p.pos.x, z: p.pos.z, foot: p.foot, dist: me && p.state ? Math.hypot(p.pos.x - me.x, p.pos.z - me.z) : -1 }));
    },
    listen(fn) { listeners.push(fn); },
    debug: { bodies: () => [...peers.values()].map((p) => p.debugBody) },
    create() { if (api.status === 'connecting') return; api.leave(); want = { kind: 'create' }; retries = 0; open(); },
    join(code) {
      const room = String(code).replace(/\D/g, '');
      if (room.length !== 4 || api.status === 'connecting') return;
      api.leave(); want = { kind: 'join', room }; retries = 0; open();
    },
    leave() {
      clearTimeout(retryTimer);
      want = null; meet = false;
      if (ws) { send({ t: 'leave' }); const s = ws; ws = null; s.close(); }
      clearPeers();
      const was = api.room !== null;
      api.status = 'off'; api.room = null; api.me = null; api.error = null;
      if (was) changed();
    },
    inviteLink() { return api.room ? `${location.origin}${location.pathname}?room=${api.room}` : ''; },
    goTo(id) {
      const p = peers.get(id), pl = engine.get<PlayerApi>('player'), v = engine.get<VehicleApi>('vehicle');
      if (!p || !p.state || !pl || !v) return t('mp.goNone');
      const why = busy();
      if (why) return t(why);
      if (Math.hypot(p.pos.x - pl.position.x, p.pos.z - pl.position.z) < 40) return t('mp.goHere');
      travelling = true;
      const driving = pl.mode === 'driving';
      fade ??= new Fade();
      fade.to(true);
      void (async () => {
        let ok = false;
        try {
          await new Promise((r) => setTimeout(r, 0));
          v.inputEnabled = false;
          await new Promise((r) => setTimeout(r, 700));
          await engine.get<WorldApi>('world')?.preload?.(p.pos.x, p.pos.z);
          p.sample(performance.now());
          // a lane 15 m behind them (so that you do not land on their car), else the nearest one to them
          const back = p.foot ? 6 : 15, yaw = p.foot ? p.yaw : Math.atan2(2 * (p.quat.x * p.quat.z + p.quat.w * p.quat.y), 1 - 2 * (p.quat.x * p.quat.x + p.quat.y * p.quat.y));
          const bx = p.pos.x - Math.sin(yaw) * back, bz = p.pos.z - Math.cos(yaw) * back;
          const lane = v.roadPoseNear?.(bx, p.pos.y + 0.5, bz) ?? v.roadPoseNear?.(p.pos.x, p.pos.y + 0.5, p.pos.z);
          if (lane) {
            if (driving) v.reset({ x: lane.pos.x, y: lane.pos.y + 0.3, z: lane.pos.z }, lane.yaw);
            else pl.setRiding(null, { x: bx, y: p.pos.y + 0.3, z: bz, yaw: Math.atan2(p.pos.x - bx, p.pos.z - bz) });
            engine.get<CameraApi>('camera')?.snap();
            ok = true;
          }
        } finally {
          v.inputEnabled = true;
          fade?.to(false, ok ? t('mp.arrived', { name: p.name }) : t('mp.goFail'));
          travelling = false;
        }
      })();
      return null;
    },
    fixedUpdate(dt) {
      if (api.status !== 'in') return;
      // the steps' own clock: a frame that runs several steps runs them at times dt apart, not all at the frame's
      // time (their cars, pulled after a target that stood still and then leapt, went half as fast again)
      const wall = performance.now();
      stepClock = Math.min(wall, Math.max(stepClock + dt * 1000, wall - 200));
      const now = stepClock;
      const car = engine.get<VehicleApi>('vehicle')?.car, mine = car?.pos, cols = car?.colliders ?? [];
      for (const p of peers.values()) {
        p.fixed(now, dt, cols);
        const at = p.carAt();
        if (mine && at) { const d = Math.hypot(at.x - mine.x, at.z - mine.z); p.clearOf(d); p.setNear(d); }
      }
    },
    postStep() {
      if (api.status !== 'in') return;
      for (const p of peers.values()) p.afterStep();
    },
    update(dt, alpha) {
      document.body.classList.toggle('dc-playing', engine.get<System & { state: string }>('ui')?.state === 'playing');
      if (api.status !== 'in') return;
      const now = performance.now();
      for (const p of peers.values()) p.update(dt, now, alpha);
      // send ourselves: 10 a second while playing, once a second behind a menu (so they still see us standing there)
      const playing = engine.get<System & { state: string }>('ui')?.state === 'playing' && !engine.paused;
      if (meet && playing) meetUp(now);
      if (now - lastSend >= (playing ? SEND_MS : IDLE_SEND_MS)) {
        lastSend = now;
        const s = myState();
        if (s) send({ t: 's', ...s });
      }
      const horn = playing && engine.get<PlayerApi>('player')?.mode === 'driving' && engine.input.state.horn;
      if (horn && !hornWas) send({ t: 'e', k: 'horn' });
      hornWas = !!horn;
    },
  };
  engine.add(api);

  // friends on the radar and the map
  const blips: Blip[] = [];
  let blipsOn = false;
  engine.events.on('game:start', () => {
    const nav = engine.get<NavApi>('nav');
    if (nav && !blipsOn) {
      blipsOn = true;
      nav.addBlips(() => {
        blips.length = 0;
        for (const p of peers.values()) {
          if (!p.state) continue;
          const yaw = p.foot ? p.yaw : Math.atan2(2 * (p.quat.x * p.quat.z + p.quat.w * p.quat.y), 1 - 2 * (p.quat.x * p.quat.x + p.quat.y * p.quat.y));
          blips.push({ kind: 'friend', x: p.pos.x, z: p.pos.z, heading: yaw, label: p.name });
        }
        return blips;
      });
    }
    // an invite link (?room=1234): into that room as the city starts
    const code = new URLSearchParams(location.search).get('room');
    if (code && /^\d{4}$/.test(code) && api.status === 'off') api.join(code);
  });
  addEventListener('pagehide', () => { if (ws) send({ t: 'leave' }); });
  return api;
}
