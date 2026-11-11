import type { Engine, System } from '../core/Engine';
import { lang, t, type TKey } from '../core/I18n';
import { Rng } from '../core/Rng';
import { CG, groups } from '../core/Physics';
import type { Actor, Blip, HudApi, MissionApi, NavApi, PeopleApi, PlayerApi, RaceApi, RenderApi, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import type { Place } from '../nav/Places';
import type { UiApi } from '../ui';
import type { Row } from '../district/Panel';
import type { NpcApi } from '../npc';
import { randomLook } from '../character/Body';
import { nearestKerb, type Kerb } from '../people/Pavement';
import { clearOfWorld } from '../life/Props';
import { Marker } from '../missions/Marker';
import { pickAddress, type Stop } from '../missions/Address';
import { kerbReach, placeLabel, rankPlaces } from '../missions/Dest';
import { shotMode } from '../debug/ShotMode';
import {
  daijiaHour, DAIJIA_TRADES, DOOR_ALONG, doorTries, PARCEL_BONUS, PARCEL_FAR, PARCEL_LIMIT, PARCEL_NEAR, PARCEL_PAY, PARCELS, parcelsPay,
  TAKEOUT_GIVE_UP, TAKEOUT_MAX, TAKEOUT_MIN, takeoutLimit, takeoutPay, takeoutWeights,
} from './Errand';

/**
 * 活儿的最后一百米（2026-11-11，docs/street-level-design.md C5，「下车之后，几乎没事可做」）：从沿街店面的柜台上接的活，
 * 最后一段都得下车走。柜台面板（street/）最下面多出「接活」一栏，行由这里给（`rows`）：
 *   外卖    任何吃的店都能接一单：送到一两公里内的一个小区、写字楼、学校、医院、宾馆（`places.json`，钟点决定哪类多）。
 *           先到门口（车、自行车、走着都行），再走进去送到楼门——楼门是到了门口才定的（那时周围的墙和楼才有碰撞体）：
 *           从人行道往院里找一处走得通的空地，最深 55 米；临街就是楼的地方，楼门在沿人行道 32 米外。按时到多给，
 *           超时只给六成，超过时限 2.2 倍单子取消。
 *   派件    快递驿站（新柜台 `courier`）：一趟三件，收件人都在 380 米内的路边等着，挨个走到跟前交给他，哪个先送都行。
 *           每件 15 块，五分钟内三件送完再加 30。
 *   代驾    夜里（19:30–3:00）喝酒的店：接一单，npc/ 的那位老板和他的车就出现在附近路边（`NpcApi.daijia`），后面是
 *           原来那套——跟他说话、开他的车送回家。原来只能在街上碰运气。
 * 一次一件，占着 `MissionApi.story`，所以乘客、街头遭遇、街头事件、路人的委托都等着。系统名 `errands`；shot mode 不装，
 * 除非 `?errands=1`。探针：`.scratch/streetlevel/errandprobe.mjs`。
 */
export interface ShopRef { x: number; z: number; name: string; trade: string; service: string }
export interface ErrandsApi extends System {
  readonly active: 'takeout' | 'parcels' | null;
  /** 这家店的柜台上能接的活（street/ 接在自己的行后面）；`close` 关掉柜台面板。 */
  rows(shop: ShopRef, close: () => void): Row[];
  debug: {
    state(): Record<string, unknown>;
    /** (x, z) 最近的人行道当门口，楼门定在哪、离门口多远（探针看往院里找不找得到）。 */
    door(x: number, z: number): { x: number; z: number; d: number } | null;
  };
}

const C = { gate: '#ff8a3d', door: '#3ccf72', who: '#7fc8ff' };

interface Takeout {
  kind: 'takeout'; shop: string; place: string; gate: Kerb; door: { x: number; z: number } | null; len: number; limit: number; clock: number; who: Actor | null;
}
interface Parcels {
  kind: 'parcels'; stops: (Stop & { done: boolean; who: Actor | null })[]; n: number; clock: number; next: number;
}

export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search);
  if ((shotMode && q.get('errands') !== '1') || q.get('errands') === '0') return;
  const tr = engine.get<TrafficApi>('traffic'), pl = engine.get<PlayerApi>('player'), people = engine.get<PeopleApi>('people');
  if (!tr || !pl) return;
  const g = tr.graph;
  const rng = new Rng(4417), rnd = () => rng.next();
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const wallGroups = groups(CG.PED, CG.WORLD);

  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const missions = () => engine.get<MissionApi>('missions');
  const nav = () => engine.get<NavApi>('nav');
  const toast = (s: string, secs?: number) => engine.get<HudApi>('hud')?.toast(s, secs);
  const story = (s: string | null) => { const m = missions(); if (m) m.story = s; };
  const hour = () => engine.get<RenderApi>('render')?.timeOfDay ?? 15;
  const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);

  let job: Takeout | Parcels | null = null, done = 0;
  const marker = new Marker(engine.scene);
  const later: { t: number; fn: () => void }[] = [];
  const after = (secs: number, fn: () => void) => later.push({ t: secs, fn });

  /** 手上有别的事，这会儿接不了：给柜台那一行的理由，没有是 null。 */
  const blocked = (): string | null => {
    const v = vehicle(), m = missions();
    if (job || m?.busy || m?.story || engine.get<RaceApi>('races')?.active || engine.get<{ name: string; active: unknown }>('npc')?.active
      || engine.get<{ name: string; active: unknown }>('events')?.active || engine.get<{ name: string; active: unknown }>('favours')?.active
      || engine.get<{ name: string; running?: boolean }>('campaign')?.running || !v.inputEnabled) return t('err.busy');
    if ((engine.get<WantedApi>('wanted')?.level ?? 0) > 0) return t('err.wanted');
    return null;
  };

  const end = (msg?: string | null) => {
    if (msg) toast(msg, 3);
    if (job?.kind === 'takeout' && job.who?.alive) job.who.release('walk');
    if (job?.kind === 'parcels') for (const s of job.stops) if (s.who?.alive) s.who.release('walk');
    job = null;
    story(null); nav()?.clearTarget('mission'); marker.hide();
  };
  const paid = (kind: 'takeout' | 'parcels', n: number, key: TKey) => {
    missions()?.addCash(n);
    toast(t(key, { n }), 3);
    done++;
    engine.events.emit('job:done', { kind });
    engine.events.emit('errand:done', { kind, pay: n });
  };

  // ---------------------------------------------------------------- 外卖

  /** 这家店的下一单送去哪：算一次留一分钟（面板每买一样东西都重画）。 */
  const orders = new Map<string, { at: number; order: { place: string; gate: Kerb; len: number } | null }>();
  const orderFor = (shop: ShopRef) => {
    const key = `${Math.round(shop.x)}_${Math.round(shop.z)}`, now = performance.now(), had = orders.get(key);
    if (had && now - had.at < 60000) return had.order;
    let order: { place: string; gate: Kerb; len: number } | null = null;
    const all = engine.get<{ name: string; places?: readonly Place[] }>('nav')?.places, n = nav(), zh = lang() === 'zh';
    if (all && n) {
      for (const p of rankPlaces(all, shop.x, shop.z, 250, 1500, hour(), rnd, zh, 10, undefined, takeoutWeights(hour()))) {
        const k = nearestKerb(g, p.x, p.z, kerbReach(p), 0.8);
        if (!k) continue;
        const len = n.route(shop.x, shop.z, NaN, k.x, k.z)?.len ?? Math.hypot(k.x - shop.x, k.z - shop.z) * 1.35;
        if (len < TAKEOUT_MIN || len > TAKEOUT_MAX) continue;
        order = { place: placeLabel(p, zh), gate: k, len };
        break;
      }
    }
    orders.set(key, { at: now, order });
    return order;
  };
  const startTakeout = (shop: ShopRef, o: { place: string; gate: Kerb; len: number }) => {
    orders.delete(`${Math.round(shop.x)}_${Math.round(shop.z)}`);
    job = { kind: 'takeout', shop: shop.name, place: o.place, gate: o.gate, door: null, len: o.len, limit: takeoutLimit(o.len), clock: 0, who: null };
    nav()?.setTarget({ x: o.gate.x, z: o.gate.z, kind: 'mission', label: o.place });
    marker.show(o.gate.x, o.gate.z, C.gate, 0.6);
    toast(t('err.takeout.got', { shop: shop.name, place: o.place }), 3.5);
    engine.events.emit('errand:taken', { kind: 'takeout' });
  };
  /** 点 (x, z) 在不在哪条路的路面上。 */
  const onRoad = (x: number, z: number): boolean => {
    for (const id of g.near(x, z, 30)) { const l = g.links[id]; if (g.nearestOn(l, x, z).d < l.hw + 1) return true; }
    return false;
  };
  /** 楼门：从门口的人行道往院里找头一处走得通的空地（Errand.ts 的 `doorTries`）；没有就在沿人行道 32 米外。 */
  const resolveDoor = (k: Kerb): { x: number; z: number } => {
    const nx = k.side * k.dz, nz = -k.side * k.dx;   // 背着马路的方向
    for (const { along, deep } of doorTries()) {
      const sx = k.x + k.dx * along, sz = k.z + k.dz * along;
      if (engine.physics.raycast({ x: sx, y: 1, z: sz }, { x: nx, y: 0, z: nz }, deep + 1.5, wallGroups, true)) continue;
      const x = sx + nx * deep, z = sz + nz * deep;
      if (onRoad(x, z) || !clearOfWorld(engine.physics, x, z, 0, 0.6, 0.6)) continue;
      return { x, z };
    }
    const dir = rnd() < 0.5 ? 1 : -1;
    return { x: k.x + k.dx * DOOR_ALONG * dir + nx * 0.8, z: k.z + k.dz * DOOR_ALONG * dir + nz * 0.8 };
  };
  const stepTakeout = (j: Takeout, dt: number): void => {
    const P = pl.position, foot = pl.foot, left = j.limit - j.clock;
    j.clock += dt;
    if (j.clock > j.limit * TAKEOUT_GIVE_UP) { end(t('err.takeout.gone')); return; }
    if (!j.door) {
      story(t('err.obj.takeout', { place: j.place, time: fmt(left) }));
      if (dist(P, j.gate) > 45) return;
      // 到门口了：这时候周围的楼和墙都有碰撞体，定楼门，顾客出来等
      j.door = resolveDoor(j.gate);
      nav()?.setTarget({ x: j.door.x, z: j.door.z, kind: 'mission', label: j.place });
      marker.show(j.door.x, j.door.z, C.door, 0.35);
      const a = people?.spawnActor?.(j.door.x, j.door.z, { look: randomLook(rnd), yaw: Math.atan2(j.gate.x - j.door.x, j.gate.z - j.door.z) }) ?? null;
      a?.act('wave');
      j.who = a;
      return;
    }
    const d = dist(P, j.door);
    story(foot ? t('err.obj.takeoutWalk', { m: Math.round(d), time: fmt(left) }) : t('err.obj.takeoutCar', { time: fmt(left) }));
    if (j.who?.alive) j.who.face(P.x, P.z);
    if (!foot || d > 2.6) return;
    const late = left < 0, n = takeoutPay(j.len, late), a = j.who;
    if (a?.alive) {
      a.act('talk');
      a.say(t(late ? 'npc.err.takeout.late' : pick(['npc.err.takeout.thanks1', 'npc.err.takeout.thanks2'] as const)), 3, t('npc.who.customer'));
      after(3, () => { if (a.alive) a.release('walk'); });
      j.who = null;
    }
    paid('takeout', n, late ? 'err.takeout.paidLate' : 'err.takeout.paid');
    end(null);
  };

  // ---------------------------------------------------------------- 派件

  /**
   * 收件人在哪：驿站周围 70–380 米的一块人行道，和别的收件人隔开 60 米。哪种路的人行道都行（`pickAddress` 只要双向的
   * 有名字的小街，大街边上的驿站三家都凑不齐）；胡同没有人行道，退回 `pickAddress`（它认 living_street）。
   */
  const pickDoor = (x: number, z: number, taken: Stop[]): Stop | null => {
    for (let k = 0; k < 40; k++) {
      const a = rnd() * Math.PI * 2, d = PARCEL_NEAR + rnd() * (PARCEL_FAR - PARCEL_NEAR);
      const kb = nearestKerb(g, x + Math.sin(a) * d, z + Math.cos(a) * d, 45, 1);
      if (!kb) continue;
      const dk = Math.hypot(kb.x - x, kb.z - z);
      if (dk < PARCEL_NEAR || dk > PARCEL_FAR || taken.some((s) => Math.hypot(s.x - kb.x, s.z - kb.z) < 60)) continue;
      const name = g.links[kb.link].name ?? engine.get<WorldApi>('world')?.placeName?.(kb.x, kb.z) ?? '', no = 2 + Math.floor(rnd() * 60) * 2;
      return { x: kb.x, z: kb.z, label: lang() === 'zh' ? `${name}${no}号` : name ? `${no} ${name}` : `No. ${no}` };
    }
    return pickAddress(g, nav() ?? undefined, rnd, x, z, PARCEL_NEAR, PARCEL_FAR, taken, 60, false);
  };
  const startParcels = (shop: ShopRef): boolean => {
    const stops: Parcels['stops'] = [];
    for (let i = 0; i < PARCELS; i++) {
      const s = pickDoor(shop.x, shop.z, stops);
      if (!s) break;
      stops.push({ ...s, done: false, who: null });
    }
    if (stops.length < PARCELS) return false;
    job = { kind: 'parcels', stops, n: 0, clock: 0, next: -1 };
    toast(t('err.parcel.got', { n: PARCELS }), 3.5);
    engine.events.emit('errand:taken', { kind: 'parcels' });
    return true;
  };
  const stepParcels = (j: Parcels, dt: number): void => {
    const P = pl.position, foot = pl.foot, left = PARCEL_LIMIT - j.clock;
    j.clock += dt;
    if (j.clock > PARCEL_LIMIT * TAKEOUT_GIVE_UP) {
      // 没送完的退回驿站：送了几件给几件的钱
      if (j.n > 0) paid('parcels', parcelsPay(j.n, false), 'err.parcel.paidSome'); else toast(t('err.parcel.gone'), 3);
      end(null);
      return;
    }
    // 最近的一件没送的：导航指它；收件人在 70 米内才出来等
    let near = -1, nd = Infinity;
    for (let i = 0; i < j.stops.length; i++) {
      const s = j.stops[i];
      if (s.done) continue;
      const d = dist(P, s);
      if (d < nd) { nd = d; near = i; }
      if (!s.who && d < 70) { s.who = people?.spawnActor?.(s.x, s.z, { look: randomLook(rnd) }) ?? null; s.who?.act('wave'); }
      else if (s.who?.alive && d > 120) { s.who.release('vanish'); s.who = null; }
      if (s.who?.alive) s.who.face(P.x, P.z);
    }
    if (near < 0) { end(null); return; }
    const s = j.stops[near];
    if (j.next !== near) { j.next = near; nav()?.setTarget({ x: s.x, z: s.z, kind: 'mission', label: s.label }); marker.show(s.x, s.z, C.door, 0.35); }
    story(foot || nd > 16 ? t('err.obj.parcel', { i: j.n + 1, of: PARCELS, place: s.label, m: Math.round(nd), time: fmt(left) }) : t('err.obj.parcelCar', { place: s.label }));
    if (!foot || nd > 2.6) return;
    s.done = true; j.n++; j.next = -1;
    const a = s.who;
    if (a?.alive) {
      a.act('talk');
      a.say(t(pick(['npc.err.parcel.thanks1', 'npc.err.parcel.thanks2', 'npc.err.parcel.thanks3'] as const)), 2.8, t('npc.who.receiver'));
      after(2.8, () => { if (a.alive) a.release('walk'); });
      s.who = null;
    }
    if (j.n >= PARCELS) { paid('parcels', parcelsPay(j.n, left >= 0), left >= 0 ? 'err.parcel.paidAll' : 'err.parcel.paidSome'); end(null); }
    else toast(t('err.parcel.one', { i: j.n, of: PARCELS, n: PARCEL_PAY }), 2.2);
  };

  // ---------------------------------------------------------------- 柜台上的行

  const rows = (shop: ShopRef, close: () => void): Row[] => {
    const out: Row[] = [], why = blocked();
    if (shop.service === 'eat') {
      const o = orderFor(shop);
      if (o) out.push({ label: t('err.takeout.row'), detail: t('err.takeout.detail', { place: o.place, km: (o.len / 1000).toFixed(1), time: fmt(takeoutLimit(o.len)) }),
        price: why ?? `+¥${takeoutPay(o.len, false)}`, disabled: !!why, buy: () => { close(); if (!blocked()) startTakeout(shop, o); } });
      if (DAIJIA_TRADES.has(shop.trade)) {
        const night = daijiaHour(hour()), w2 = why ?? (night ? null : t('err.daijia.day'));
        out.push({ label: t('err.daijia.row'), detail: t('err.daijia.detail'), price: w2 ?? '+¥260', disabled: !!w2, buy: () => {
          close();
          // 面板关掉的下一步再叫人：npc/ 要等界面回到「玩着」
          after(0.2, () => { if (engine.get<NpcApi>('npc')?.daijia()) { toast(t('err.daijia.got'), 3.5); engine.events.emit('errand:taken', { kind: 'daijia' }); } else toast(t('err.daijia.none'), 3); });
        } });
      }
    }
    if (shop.service === 'courier') {
      out.push({ label: t('err.parcel.row', { n: PARCELS }), detail: t('err.parcel.detail', { n: PARCEL_PAY, bonus: PARCEL_BONUS, time: fmt(PARCEL_LIMIT) }),
        price: why ?? `+¥${parcelsPay(PARCELS, true)}`, disabled: !!why, buy: () => { close(); if (!blocked() && !startParcels(shop)) toast(t('err.parcel.none'), 3); } });
    }
    if (out.length) out[0].section = t('err.sec');
    return out;
  };

  const blips: Blip[] = [];
  nav()?.addBlips(() => {
    blips.length = 0;
    if (job?.kind === 'takeout') { const p = job.door ?? job.gate; blips.push({ kind: 'dropoff', x: p.x, z: p.z, label: job.place, flash: !!job.door }); }
    if (job?.kind === 'parcels') for (const s of job.stops) if (!s.done) blips.push({ kind: 'dropoff', x: s.x, z: s.z, label: s.label });
    return blips;
  });
  engine.events.on('wanted:busted', () => { if (job) end(t('err.dropped')); });

  const api: ErrandsApi = {
    name: 'errands',
    get active() { return job?.kind ?? null; },
    rows,
    debug: {
      door: (x, z) => { const k = nearestKerb(g, x, z, 30, 0.8); if (!k) return null; const d = resolveDoor(k); return { ...d, d: Math.hypot(d.x - k.x, d.z - k.z) }; },
      state: () => ({ kind: job?.kind ?? null, done, clock: job?.clock ?? 0,
        ...(job?.kind === 'takeout' ? { place: job.place, gate: { x: job.gate.x, z: job.gate.z }, door: job.door, len: job.len, limit: job.limit } : {}),
        ...(job?.kind === 'parcels' ? { n: job.n, stops: job.stops.map((s) => ({ x: s.x, z: s.z, label: s.label, done: s.done, who: !!s.who?.alive })) } : {}) }),
    },
    fixedUpdate(dt) {
      for (let i = later.length - 1; i >= 0; i--) { const l = later[i]; l.t -= dt; if (l.t <= 0) { later.splice(i, 1); l.fn(); } }
      if (!job) return;
      if (engine.get<UiApi>('ui')?.state !== 'playing') return;
      if (pl.health <= 0) { end(t('err.dropped')); return; }
      if (job.kind === 'takeout') stepTakeout(job, dt); else stepParcels(job, dt);
    },
    update(dt) { marker.update(dt); },
  };
  engine.add(api);
}
