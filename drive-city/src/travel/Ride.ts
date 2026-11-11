import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { lang, t } from '../core/I18n';
import { project } from '../city/Geo';
import { LANDMARKS } from '../city/landmarks';
import type { CameraApi, HudApi, Interaction, MissionApi, NavApi, PlayerApi, RenderApi, VehicleApi, WantedApi } from '../game/Contracts';
import { ShopPanel, type Row } from '../district/Panel';
import { shotMode } from '../debug/ShotMode';
import { fare as meter, PLACES } from '../missions';
import { placeLabel, usable } from '../missions/Dest';
import type { Place } from '../nav/Places';
import type { FareCar, TrafficApi } from '../traffic';
import type { UiApi } from '../ui';
import { specLength } from '../vehicle/Bodies';
import type { TravelApi } from './index';

/**
 * 坐公交、打车（2026-11-11，docs/street-level-design.md C3，「下车之后，几乎没事可做」「把第二批剩的：坐公交、打车 做完」）。
 *
 * 坐的就是车流里那辆车（`TrafficApi.fareNear` 给的 `FareCar`），司机照常开、照常等红灯；玩家用 `PlayerApi.setRiding` 坐在里面
 * （人不画），镜头贴在右边车窗上往外看，或者跟在车后面（镜头键换）。自己的车留在原地。被通缉、任务不让走的时候不能坐。
 *
 * 公交：进站停稳的公交旁边按 F，¥2。车往哪开它说了算（车流里的公交没有线路），差不多站站停；到站按 F 下车，路上按 F 是
 * 「下一站下」，45 秒还没到站就让司机就近靠边。玩家站在站台上（8 米内）时，路过的公交都会进这一站（traffic/）。
 *
 * 打车：出租车开过来时按 F 招手，它靠边停在玩家旁边等 20 秒；走过去按 F 坐进去，选去哪——地图上标的点、任务地点、我的车、
 * 快速前往表里的地方、地标。司机照 `NavApi.routeFrom` 的路线开，到了靠边，按北京的表收钱（¥13 起步含 3 公里，之后每公里
 * ¥2.3，`missions/` 的 `fare`）。路上按 F 提前下车（按已经走的路算），按跳跃键直接到（黑一下屏，钟跟着走）。
 * 停着没招手的出租车，F 还是抢车：开出租拉活是主要的活儿，不能多一步。
 */
export interface TransitApi extends System {
  /** 现在坐在什么车上。 */
  readonly on: 'bus' | 'taxi' | null;
}

const BUS_FARE = 2;
/** 打车面板「附近」一栏列几个地方。 */
const NEARBY = 14;
/** 招手够得着的出租车：前后和横向，米。 */
const HAIL_AHEAD = 45, HAIL_BEHIND = 8, HAIL_SIDE = 13;
/** 叫停的出租车等多久。 */
const HAIL_WAIT = 20;
/** 按了铃这么久还没进站：就近靠边。 */
const BELL_MAX = 45;
/** 出租车卡死多久往前挪（`FareCar.hop`）：司机没在等什么可车不动的秒数，和不管为什么原地不动的秒数。 */
const JAM = 4, STILL_HOP = 35, STILL_RED = 75;
/** 挪也挪不了，原地不动这么久：这趟算了。 */
const TAXI_STILL = 150;

interface Dest { x: number; z: number; label: string }
interface Trip { dest: Dest; last: number; endS: number; len: number; time: number; pay: number }
type State =
  | { k: 'hail'; fare: FareCar; t: number; waited: number }
  | { k: 'bus'; fare: FareCar; bell: boolean; bellT: number; stops: number; at: boolean; m: number; forced: boolean }
  | { k: 'taxi'; fare: FareCar; trip: Trip | null; m: number; out: boolean; still: number; mark: number; jam: number; tried: number; canSkip: boolean };

const _e = new THREE.Euler(), _q = new THREE.Quaternion();

/** 乘客的镜头：贴在右边车窗外沿往外看（看不到车身，街从眼前过），或者跟在车后面。 */
class PassengerCam {
  view: 'window' | 'out' = 'window';
  private fare: FareCar | null = null;
  private pos = new THREE.Vector3(); private quat = new THREE.Quaternion(); private fwd = new THREE.Vector3();
  private look = new THREE.Vector3(); private at = new THREE.Vector3(); private dir = new THREE.Vector3();
  private head = 0; private pitch = 0; private since = 99;
  private yaw = 0; private y = 0; private orbit = 0; private orbitPitch = 0; private fresh = true;
  private hw = 1; private len = 4.6; private bus = false;
  /** 镜头的射线最后撞到了什么（探针看）。 */
  lastHit = '';
  private readonly rayGroups = groups(CG.CAR, CG.WORLD);
  constructor(private engine: Engine) {}

  attach(f: FareCar, view: 'window' | 'out'): void {
    this.fare = f; this.view = view; this.fresh = true; this.head = 0; this.pitch = 0; this.orbit = 0; this.orbitPitch = 0;
    this.bus = f.kind === 'bus';
    this.hw = 0; for (const c of f.car.spec.chassis) this.hw = Math.max(this.hw, Math.abs(c.at[0]) + c.half[0]);
    this.len = specLength(f.car.spec);
  }

  readonly update = (cam: THREE.PerspectiveCamera, dt: number): void => {
    const f = this.fare;
    if (!f) return;
    const inp = this.engine.input.state;
    const live = this.engine.get<UiApi>('ui')?.state === 'playing' && !this.engine.paused && !this.engine.get<NavApi>('nav')?.mapOpen;
    if (live && inp.cameraPressed) { this.view = this.view === 'window' ? 'out' : 'window'; this.fresh = true; }
    f.pose(this.engine.alpha, this.pos, this.quat);
    const turned = live && (inp.lookDX !== 0 || inp.lookDY !== 0);
    this.since = turned ? 0 : this.since + dt;
    let fov: number;
    if (this.view === 'window') {
      // 眼睛在右边车窗外沿（公交坐得高，在车身中段靠前；出租车在后座）
      this.at.set(-(this.hw + 0.14), this.bus ? 1.6 : 0.84, this.bus ? 1.5 : -0.45).applyQuaternion(this.quat).add(this.pos);
      fov = 62;
      // 头往右前方偏：视野的左边缘刚好擦着车身；鼠标、右摇杆转头，停一会儿转回来
      const half = Math.atan(Math.tan(fov * Math.PI / 360) * cam.aspect), lo = half + 0.06, hi = Math.PI - half - 0.06;
      if (turned) { this.head += inp.lookDX * 0.0032; this.pitch = THREE.MathUtils.clamp(this.pitch - inp.lookDY * 0.0025, -0.4, 0.4); }
      else if (this.since > 2.5) { const k = 1 - Math.exp(-dt * 2); this.head -= this.head * k; this.pitch -= this.pitch * k; }
      const a = THREE.MathUtils.clamp(lo + 0.05 + this.head, lo, hi);
      this.head = a - lo - 0.05;
      cam.position.copy(this.at);
      _e.set(this.pitch, Math.PI - a, 0, 'YXZ');
      cam.quaternion.copy(this.quat).multiply(_q.setFromEuler(_e));
    } else {
      this.fwd.set(0, 0, 1).applyQuaternion(this.quat);
      const carYaw = Math.atan2(this.fwd.x, this.fwd.z), speed = f.car.speed;
      if (turned) { this.orbit -= inp.lookDX * 0.0032; this.orbitPitch = THREE.MathUtils.clamp(this.orbitPitch + inp.lookDY * 0.0025, -0.2, 0.9); }
      else if (this.since > 1.5 && speed > 2) { const k = 1 - Math.exp(-dt * 2.5); this.orbit -= this.orbit * k; this.orbitPitch -= this.orbitPitch * k; }
      if (this.fresh) { this.yaw = carYaw; this.y = this.pos.y; }
      let d = carYaw - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * (1 - Math.exp(-dt * 3.5));
      this.y += (this.pos.y - this.y) * (1 - Math.exp(-dt * 5));
      const grow = Math.max(0, this.len - 4.6) * 0.55, rise = this.bus ? 1.1 : 0;
      const dist = 6.8 + grow + speed * 0.02, yaw = this.yaw + this.orbit, pitch = 0.12 + this.orbitPitch;
      this.look.set(this.pos.x, this.y + 1.3 + rise * 0.5, this.pos.z);
      const horiz = dist * Math.cos(pitch);
      this.at.set(this.look.x - Math.sin(yaw) * horiz, this.look.y + 0.2 + rise * 0.5 + dist * Math.sin(pitch), this.look.z - Math.cos(yaw) * horiz);
      // 墙挡住了就拉近
      this.dir.subVectors(this.at, this.look);
      const len = this.dir.length();
      this.dir.divideScalar(len);
      const hit = this.engine.physics.raycast(this.look, this.dir, len, this.rayGroups, true, f.car.body);
      this.lastHit = hit ? `${String(hit.userData.tag)} ${hit.distance.toFixed(1)}/${len.toFixed(1)}` : '';
      if (hit && hit.userData.tag !== 'prop') this.at.copy(this.look).addScaledVector(this.dir, Math.max(1.2, hit.distance - 0.3));
      this.at.y = Math.max(this.at.y, this.pos.y < -1 ? this.pos.y + 0.2 : 0.45);
      cam.position.copy(this.at);
      cam.lookAt(this.look.x + this.fwd.x * 1.6, this.look.y + 0.15, this.look.z + this.fwd.z * 1.6);
      fov = 55;
    }
    if (cam.fov !== fov) { cam.fov = fov; cam.updateProjectionMatrix(); }
    this.fresh = false;
  };
}

export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search);
  if ((shotMode && q.get('ride') !== '1') || q.get('ride') === '0') return;
  const pl = engine.get<PlayerApi>('player'), tr = engine.get<TrafficApi>('traffic');
  if (!pl || !tr?.fareNear) return;
  const g = tr.graph;
  const missions = () => engine.get<MissionApi>('missions');
  const nav = () => engine.get<NavApi>('nav');
  const camApi = () => engine.get<CameraApi>('camera');
  const toast = (s: string, secs = 4) => engine.get<HudApi>('hud')?.toast(s, secs);
  const playing = () => engine.get<UiApi>('ui')?.state === 'playing' && !nav()?.mapOpen;
  const wanted = () => (engine.get<WantedApi>('wanted')?.level ?? 0) > 0;
  const skipKey = () => t(document.body.classList.contains('dc-touch') ? 'ride.key.touch' : 'ride.key');
  const km = (m: number) => (m < 950 ? (Math.max(100, Math.round(m / 100) * 100) / 1000).toFixed(1) : m < 9950 ? (m / 1000).toFixed(1) : String(Math.round(m / 1000)));

  const panel = new ShopPanel(engine);
  const cam = new PassengerCam(engine);
  const seat = { pos: new THREE.Vector3(), yaw: 0 };
  const tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  let st: State | null = null;
  /** 身边能坐的：停在站上的公交（够得着的），招手够得着的出租车。隔一会儿找一次。 */
  let nearBus: FareCar | null = null, nearTaxi: FareCar | null = null, scanT = 0;
  const boards = { bus: 0, taxi: 0 };
  /** 最近发生了什么（探针看）。 */
  const log: string[] = [];
  const note = (what: string) => { log.push(`${engine.time.toFixed(1)} ${what}`); if (log.length > 40) log.shift(); };

  const place = (f: FareCar) => { seat.pos.copy(f.car.pos); seat.yaw = Math.atan2(f.car.fwd.x, f.car.fwd.z); };
  const halfW = (f: FareCar) => { let w = 0; for (const c of f.car.spec.chassis) w = Math.max(w, Math.abs(c.at[0]) + c.half[0]); return w; };
  /** 人离车身（一个长方形）多远，米；在车的哪一侧（左正右负）。 */
  const beside = (f: FareCar, x: number, z: number): { d: number; side: number } => {
    const car = f.car, rx = x - car.pos.x, rz = z - car.pos.z;
    const lx = rx * car.left.x + rz * car.left.z, lz = rx * car.fwd.x + rz * car.fwd.z;
    return { d: Math.hypot(Math.max(0, Math.abs(lx) - halfW(f)), Math.max(0, Math.abs(lz) - specLength(car.spec) / 2)), side: lx };
  };

  const sit = (f: FareCar, view: 'window' | 'out') => {
    place(f);
    pl.setRiding(seat);
    cam.attach(f, view);
    const c = camApi();
    if (c) c.override = cam.update;
  };
  /** 下到车右边的路边（右边是墙就下左边）；公交从前门下。 */
  const getOut = (f: FareCar) => {
    const c = camApi();
    if (c && c.override === cam.update) c.override = null;
    if (!pl.riding) return;
    const car = f.car, out = halfW(f) + 0.9, ahead = f.kind === 'bus' ? specLength(car.spec) / 2 - 2.6 : 0;
    const ox = car.pos.x + car.fwd.x * ahead, oz = car.pos.z + car.fwd.z * ahead;
    const wall = engine.physics.raycast({ x: ox, y: car.pos.y + 0.4, z: oz }, { x: -car.left.x, y: 0, z: -car.left.z }, out + 0.6, groups(CG.PED, CG.WORLD), true, car.body);
    const side = wall ? 1 : -1;
    const x = ox + car.left.x * side * out, z = oz + car.left.z * side * out, top = car.pos.y + 1.5;
    const ground = engine.physics.raycast({ x, y: top, z }, { x: 0, y: -1, z: 0 }, 6, groups(CG.PED, CG.WORLD), true);
    pl.setRiding(null, { x, y: (ground ? top - ground.distance : car.pos.y - 0.5) + 0.05, z, yaw: Math.atan2(car.fwd.x, car.fwd.z) });
  };
  /** 这趟完了（下车以后）：车放回车流。 */
  const done = (go = true) => {
    const s = st;
    st = null;
    if (!s) return;
    note(`done ${s.k} go=${go} alive=${s.fare.alive}`);
    if (go) s.fare.go(s.k === 'taxi' ? [] : undefined);
    s.fare.keep(false);
  };

  // --- 公交 -------------------------------------------------------------------------------------
  const boardBus = (f: FareCar) => {
    if (st || !f.alive || !f.stopped) return;
    const m = missions();
    if (m && m.cash < BUS_FARE) { toast(t('ride.bus.poor', { n: BUS_FARE })); return; }
    m?.addCash(-BUS_FARE);
    f.keep(true);
    st = { k: 'bus', fare: f, bell: false, bellT: 0, stops: 0, at: true, m: 0, forced: false };
    sit(f, 'window');
    engine.events.emit('ride:board', { kind: 'bus', n: ++boards.bus });
    toast(t('ride.bus.on', { n: BUS_FARE }), 6);
  };
  const leaveBus = (msg?: string) => {
    if (st?.k !== 'bus') return;
    const s = st;
    getOut(s.fare);
    engine.events.emit('ride:end', { kind: 'bus', m: Math.round(s.m), pay: BUS_FARE, skipped: false });
    done(s.forced);   // 公交照自己的钟出站；让它就近靠边的要放它走
    if (msg) toast(msg);
  };

  // --- 出租车 -----------------------------------------------------------------------------------
  const hail = (f: FareCar) => {
    note(`hail st=${st?.k ?? '-'} alive=${f.alive}`);
    if (st || !f.alive) return;
    f.keep(true);
    st = { k: 'hail', fare: f, t: 0, waited: 0 };
    toast(t('ride.taxi.coming'), 3);
  };
  /** 去哪：地图上标的点、任务地点、我的车、快速前往表里的、地标（按远近）。 */
  const destinations = (x: number, z: number): { rows: (Dest & { section?: string; off?: string })[] } => {
    const rows: (Dest & { section?: string; off?: string })[] = [];
    const n = nav(), tg = n?.target, goal = n?.goal;
    if (tg?.kind === 'waypoint') rows.push({ x: tg.x, z: tg.z, label: t('ride.to.waypoint') });
    else rows.push({ x: 0, z: 0, label: t('ride.to.waypoint'), off: t('ride.to.nowaypoint') });
    if (goal) rows.push({ x: goal.x, z: goal.z, label: goal.label ? t('ride.to.goalAt', { name: goal.label }) : t('ride.to.goal') });
    const v = engine.get<VehicleApi>('vehicle');
    if (v && Math.hypot(v.car.pos.x - x, v.car.pos.z - z) > 150) rows.push({ x: v.car.pos.x, z: v.car.pos.z, label: t('ride.to.car') });
    let first = true;
    for (const s of engine.get<TravelApi>('travel')?.spots ?? []) {
      if (Math.hypot(s.x - x, s.z - z) < 300) continue;
      rows.push({ x: s.x, z: s.z, label: t(s.label), section: first ? t('ride.sec.spots') : undefined });
      first = false;
    }
    const zh = lang() === 'zh';
    const marks = [...LANDMARKS.filter((l) => l.id !== 'home' && !l.partOf).map((l) => ({ lat: l.lat, lon: l.lon, name: zh ? l.name.zh : l.name.en, road: '' })),
      ...PLACES.map((p) => ({ lat: p.lat, lon: p.lon, name: zh ? p.zh : p.en, road: p.road }))].map((p) => {
      let [px, pz] = project(p.lat, p.lon);
      // 一条街上的地方（王府井、前门大街）：落到那条街离它最近的一段上
      if (p.road) {
        let bd = 500;
        for (const id of g.near(px, pz, 500)) {
          const l = g.links[id];
          if (l.name !== p.road) continue;
          g.at(l, l.len / 2, 0, tmp);
          const d = Math.hypot(tmp.x - px, tmp.z - pz);
          if (d < bd) { bd = d; px = tmp.x; pz = tmp.z; }
        }
      }
      return { x: px, z: pz, label: p.name, d: Math.hypot(px - x, pz - z) };
    }).filter((p) => p.d > 300).sort((a, b) => a.d - b.d);
    // 附近叫得出名字的地方（places.json 的医院、商场、饭店、大学、公园……，和出租车活儿的乘客去的是同一批：missions/Dest.ts）
    const known = new Set(marks.map((m) => m.label));
    const around = (engine.get<{ name: string; places?: readonly Place[] }>('nav')?.places ?? [])
      .filter((p) => p.rank <= 2 && p.cat !== 'metro' && Math.abs(p.x - x) < 5000 && Math.abs(p.z - z) < 5000 && usable(p, zh) && !known.has(placeLabel(p, zh)))
      .map((p) => ({ x: p.x, z: p.z, label: placeLabel(p, zh), d: Math.hypot(p.x - x, p.z - z) }))
      .filter((p) => p.d > 300 && p.d < 5000).sort((a, b) => a.d - b.d).slice(0, NEARBY);
    first = true;
    for (const p of around) { rows.push({ x: p.x, z: p.z, label: p.label, section: first ? t('ride.sec.near') : undefined }); first = false; }
    first = true;
    for (const p of marks) { rows.push({ x: p.x, z: p.z, label: p.label, section: first ? t('ride.sec.landmarks') : undefined }); first = false; }
    return { rows };
  };
  const choose = (s: State & { k: 'taxi' }, d: Dest) => {
    const m = missions(), f = s.fare;
    const r = nav()?.routeFrom?.(f.link, f.s, d.x, d.z);
    if (!r || r.len < 60) { toast(t('ride.taxi.noway')); return; }
    const pay = meter(r.len / 1000);
    if (m && m.cash < pay) { toast(t('ride.taxi.short', { n: pay })); return; }
    s.trip = { dest: d, last: r.links[r.links.length - 1], endS: r.endS, len: r.len, time: r.time, pay };
    panel.close();
    f.go(r.links);
    engine.events.emit('ride:board', { kind: 'taxi', n: ++boards.taxi });
    toast(s.canSkip ? t('ride.taxi.go', { dest: d.label, km: km(r.len), n: pay, key: skipKey() }) : t('ride.taxi.goNoSkip', { dest: d.label, km: km(r.len), n: pay }), 7);
  };
  const boardTaxi = (f: FareCar) => {
    if (st?.k !== 'hail' || st.fare !== f || !f.alive) return;
    // 坐着车在街上走，什么时候都行（被通缉除外）；「直接到」是瞬移，手上有任务、有剧情的时候不给（和快速前往一个规矩）
    const s: State & { k: 'taxi' } = { k: 'taxi', fare: f, trip: null, m: 0, out: false, still: 0, mark: 0, jam: 0, tried: 0, canSkip: !missions()?.travelBlocked?.() };
    st = s;
    sit(f, 'out');
    const cash = missions()?.cash ?? 0, at = f.car.pos;
    const rows: Row[] = destinations(at.x, at.z).rows.map((d) => {
      // 直线的 1.35 倍当路程估个价；选了再按真路线算
      const est = Math.hypot(d.x - at.x, d.z - at.z) * 1.35, pay = meter(est / 1000);
      return d.off ? { label: d.label, detail: d.off, price: '', disabled: true, section: d.section, buy: () => {} }
        : { label: d.label, detail: t('ride.taxi.detail', { km: km(est) }), price: cash < pay ? t('nl.panel.short', { n: pay - cash }) : t('ride.taxi.about', { n: pay }), disabled: cash < pay,
          section: d.section, buy: () => choose(s, d) };
    });
    // 没选就关了（或者面板开不了）：下车，司机走了
    const closed = () => { if (st === s && !s.trip) { getOut(f); done(); } };
    if (!panel.render(t('ride.taxi.sign'), t('ride.taxi.greet'), cash, rows, closed)) closed();
  };
  /** 到了、提前下、车走不了了：付钱，下车。 */
  const leaveTaxi = (why: 'arrive' | 'early' | 'dead') => {
    if (st?.k !== 'taxi') return;
    const s = st, tp = s.trip, m = missions();
    getOut(s.fare);
    let pay = 0;
    if (tp && why !== 'dead') pay = Math.min(m?.cash ?? Infinity, why === 'arrive' ? tp.pay : Math.min(tp.pay, meter(s.m / 1000)));
    if (pay > 0) m?.addCash(-pay);
    if (tp) engine.events.emit('ride:end', { kind: 'taxi', m: Math.round(s.m), pay, skipped: false });
    done();
    if (tp) toast(why === 'arrive' ? t('ride.taxi.arrive', { dest: tp.dest.label, n: pay }) : why === 'early' ? t('ride.taxi.early', { n: pay }) : t('ride.taxi.dead'), 5);
  };
  /** 直接到：黑一下屏，落在终点的路边，钟按剩下的路走。 */
  const skip = () => {
    if (st?.k !== 'taxi' || !st.trip || st.out || !st.canSkip) return;
    const s = st, tp = s.trip!, m = missions(), travel = engine.get<TravelApi>('travel');
    if (!travel) return;
    const l = g.links[tp.last];
    g.at(l, tp.endS, -(l.hw + 1.2), tmp);
    const c = camApi();
    if (c && c.override === cam.update) c.override = null;
    const pay = Math.min(m?.cash ?? Infinity, tp.pay);
    m?.addCash(-pay);
    const r = engine.get<RenderApi>('render'), left = Math.max(0, 1 - s.m / Math.max(1, tp.len));
    if (r) r.timeOfDay = (r.timeOfDay + tp.time * left / 3600) % 24;
    engine.events.emit('ride:end', { kind: 'taxi', m: Math.round(tp.len), pay, skipped: true });
    done();
    void travel.land({ foot: { x: tmp.x, z: tmp.z, yaw: Math.atan2(tmp.dx, tmp.dz) }, caption: t('ride.taxi.arrive', { dest: tp.dest.label, n: pay }) });
  };

  const offer: Interaction = { x: 0, z: 0, r: 1, label: '', use: () => {} };
  const put = (label: string, use: () => void, opts: { far?: boolean; riding?: boolean; kind?: string } = {}) => {
    const p = pl.position;
    // `far`：排在别的 F 后面（柜台、路人、身边的车够得着就先给它们）
    offer.x = p.x + (opts.far ? 4.5 : 0); offer.z = p.z; offer.r = opts.far ? 5 : 1;
    offer.label = label; offer.use = use; offer.riding = !!opts.riding; offer.kind = opts.kind;
    pl.offer?.(offer);
  };

  const api: TransitApi & { debug: unknown } = {
    name: 'transit',
    get on() { return st?.k === 'bus' ? 'bus' : st?.k === 'taxi' ? 'taxi' : null; },
    fixedUpdate(dt) {
      const s = st;
      if (!s) return;
      const f = s.fare;
      if (s.k === 'hail') {
        s.t += dt;
        if (!f.alive) { done(false); toast(t('ride.taxi.gone')); return; }
        if (!f.stopped) {
          // 停在玩家旁边：玩家在这段路前面就停到那儿，不然尽快停
          const p = pl.position, l = g.links[f.link], pr = g.project(l, p.x, p.z, f.s + 20);
          f.stop(pr.d < 25 ? pr.s : undefined);
          if (s.t > 25) { done(); toast(t('ride.taxi.gone')); }
        } else if ((s.waited += dt) > HAIL_WAIT || pl.mode !== 'onfoot') { done(); if (pl.mode === 'onfoot') toast(t('ride.taxi.left')); }
        return;
      }
      // 坐在车上：人跟着车走
      if (!pl.riding) { const c = camApi(); if (c && c.override === cam.update) c.override = null; done(); return; }   // 被重置回自己车里了
      place(f);
      const v = Math.abs(f.car.forwardSpeed);
      s.m += v * dt;
      if (s.k === 'bus') {
        if (!f.alive) { leaveBus(t('ride.bus.end')); return; }
        const at = f.stopped;
        if (at && !s.at) {
          s.stops++;
          const road = g.links[f.link]?.name;
          if (s.bell) { leaveBus(road ? t('ride.bus.at', { road }) : t('ride.bus.atNo')); return; }
          toast(road ? t('ride.bus.at', { road }) : t('ride.bus.atNo'), 3);
        }
        s.at = at;
        if (s.bell && !at && (s.bellT += dt) > BELL_MAX) { s.forced = true; f.stop(); }
        return;
      }
      if (!s.trip) return;   // 还在选去哪（面板开着，世界停着）
      if (!f.alive) { leaveTaxi('dead'); return; }
      // 没往前走（8 米以内的蹭不算）多久了；等红灯的时候不算
      if (s.m - s.mark > 8 || s.out) { s.mark = s.m; s.still = 0; s.jam = 0; s.tried = 0; }
      else { s.still += dt; if (f.stuck > 0.5) s.jam += dt; }
      // 卡死了——司机说前面没东西可车不动（护栏尖、被别住），或者不是红灯却半分多钟没动（路口里互相别住），或者怎么都一分多钟
      // 没动：往前挪一段接着走（`FareCar.hop`）。挪不了过几秒再试。
      if ((s.jam > JAM || s.still > (f.red ? STILL_RED : STILL_HOP)) && !f.stopped && s.still - s.tried > 3) {
        const ok = f.hop();
        note(`hop jam=${s.jam.toFixed(1)} still=${s.still.toFixed(0)} red=${f.red} ok=${ok}`);
        if (ok) { s.m += 20; s.mark = s.m; s.still = 0; s.jam = 0; s.tried = 0; } else s.tried = s.still;
      }
      if (s.still > TAXI_STILL) { leaveTaxi('dead'); return; }
      if (s.out) { if (f.stopped) leaveTaxi('early'); else f.stop(); return; }
      if (f.left === 0) {
        // 最后一段：停在终点；路线走丢了（过了头）就近停
        const on = f.link === s.trip.last;
        if (f.stopped) leaveTaxi(on ? 'arrive' : 'early');
        else f.stop(on ? s.trip.endS : undefined);
      }
    },
    update(dt) {
      const s = st;
      if (!s) {
        // 身边有没有能坐的
        if (pl.mode !== 'onfoot' || pl.riding || !playing()) { nearBus = nearTaxi = null; return; }
        const p = pl.position;
        if ((scanT -= dt) <= 0) {
          scanT = 0.2;
          nearBus = nearTaxi = null;
          if (!wanted()) {
            nearBus = tr.fareNear!(p.x, p.z, 12, 'bus');
            nearTaxi = tr.fareNear!(p.x, p.z, HAIL_AHEAD, 'taxi', (c) => {
              const rx = p.x - c.pos.x, rz = p.z - c.pos.z, along = rx * c.fwd.x + rz * c.fwd.z;
              return Math.abs(c.pos.y - p.y) < 3 && along > -HAIL_BEHIND && Math.abs(rx * c.left.x + rz * c.left.z) < HAIL_SIDE;
            });
          }
        }
        if (nearBus && nearBus.alive && nearBus.stopped && beside(nearBus, p.x, p.z).d < 4) { const b = nearBus; put(t('ride.bus.offer', { n: BUS_FARE }), () => boardBus(b), { kind: 'bus' }); }
        else if (nearTaxi && nearTaxi.alive) { const c = nearTaxi; put(t('ride.taxi.hail'), () => hail(c), { far: true, kind: 'taxi' }); }
        return;
      }
      const f = s.fare;
      if (s.k === 'hail') {
        const p = pl.position;
        if (f.stopped && pl.mode === 'onfoot' && beside(f, p.x, p.z).d < 3.2) put(t('ride.taxi.in'), () => boardTaxi(f));
        return;
      }
      if (!playing()) return;
      if (s.k === 'bus') {
        // 车停着（进站、等红灯、堵着）就能下；开着的时候是按铃，下一站下
        if (f.stopped || Math.abs(f.car.forwardSpeed) < 0.5) put(t('ride.bus.off'), () => leaveBus(), { riding: true });
        else put(t(s.bell ? 'ride.bus.belled' : 'ride.bus.bell'), () => { s.bell = !s.bell; s.bellT = 0; }, { riding: true });
        return;
      }
      if (!s.trip) return;
      if (s.out) { put(t('ride.taxi.stopping'), () => {}, { riding: true }); return; }
      const left = Math.max(0, s.trip.len - s.m);
      put(s.canSkip ? t('ride.taxi.stop', { km: km(left), key: skipKey() }) : t('ride.taxi.stopNoSkip', { km: km(left) }), () => { s.out = true; }, { riding: true });
      if (engine.input.state.jumpPressed) skip();
    },
    debug: {
      state: () => (st ? { k: st.k, alive: st.fare.alive, stopped: st.fare.stopped, link: st.fare.link, s: Math.round(st.fare.s), left: st.fare.left, speed: +st.fare.car.speed.toFixed(1), m: 'm' in st ? Math.round(st.m) : 0,
        trip: st.k === 'taxi' && st.trip ? { dest: st.trip.dest.label, len: Math.round(st.trip.len), pay: st.trip.pay } : null, stops: st.k === 'bus' ? st.stops : 0, bell: st.k === 'bus' && st.bell,
        pos: [Math.round(st.fare.car.pos.x), Math.round(st.fare.car.pos.z)] } : null),
      near: () => ({ bus: !!nearBus, taxi: !!nearTaxi }),
      destinations: () => { const p = pl.position; return destinations(p.x, p.z).rows; },
      /** 探针用：直接选第 i 个目的地。 */
      choose: (i: number) => { if (st?.k !== 'taxi') return false; const p = st.fare.car.pos, d = destinations(p.x, p.z).rows.filter((r) => !r.off)[i]; if (!d) return false; choose(st, d); return !!st?.trip; },
      view: (v?: 'window' | 'out') => { if (v) cam.view = v; return cam.view; },
      log: () => log,
      camHit: () => cam.lastHit,
    },
  };
  engine.add(api);
}
