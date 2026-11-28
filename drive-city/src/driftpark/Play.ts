import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { CameraApi, CarLook, VehicleApi, WorldApi } from '../game/Contracts';
import type { UiApi } from '../ui';
import { TOUCH } from '../ui/Touch';
import { C, F, css, el } from '../ui/theme';
import { readyBodies, type BodySource, type BodyType } from '../vehicle/Bodies';
import { defaultLivery } from '../vehicle/CarModel';
import { SPEC_OF } from '../vehicle/Spec';
import { Vehicle } from '../vehicle/Vehicle';
import { COURSE, courseLine, ENTRY_SPEEDS, STATIONS, TEST_LANE, GRID, type StationId } from './Layout';

/**
 * 漂移练习场's practice (2026-11-28, 「给我单独做一个场地，可以练习漂移和测试漂移的地方」): 练习点 1..5 and R back to it (at a
 * standing start or 60 / 80 / 100 km/h), the car to practise in, and for testing, the readings of every drift - how
 * long, the speeds, the body's angle, how far the travel and the nose turned, how far on and aside it went, where a 90°
 * turn was done, how far before the test junction's stop line it began - with the line the car took painted on the
 * ground, coloured by the angle. The 连续弯 course is timed by the lap, scored by its drift.
 */

const SAVE = 'drivecity.driftpark.v1';
const BODIES: BodyType[] = ['sedan', 'hatch', 'coupe', 'ae86', 'super', 'suv', 'limo'];
const BODY_NAME: Partial<Record<BodyType, () => string>> = {
  sedan: () => t('dp.sedan'), hatch: () => t('dp.hatch'), coupe: () => t('car.coupe'), ae86: () => t('car.ae86'), super: () => t('car.super'), suv: () => t('dp.suv'), limo: () => t('car.limo'),
};
const TAXI_LOOK: CarLook = { upper: new THREE.Color('#f3b50f'), lower: new THREE.Color('#1f5e3c'), taxi: true, body: 'sedan' };

/** A drift being measured: from the car starting to slide to it running straight again. */
interface Seg {
  t: number; v0: number; x0: number; z0: number; h0: number;
  tv: number; nv: number; lastTv: number; lastNv: number; len: number; lastX: number; lastZ: number;
  maxSlip: number; sumSlip: number; samples: number; mode: Mode; to90: number | null; stop: number | null; hit: boolean; calm: number;
}
type Mode = 'phone' | 'hold' | 'handbrake' | 'slide';
interface Reading { s: number; v0: number; v1: number; avg: number; max: number; tv: number; nv: number; fwd: number; side: number; to90: number | null; stop: number | null; hit: boolean; mode: Mode }

const STYLE = `
.dp-panel{position:absolute;right:calc(14px + env(safe-area-inset-right,0px));top:calc(96px + env(safe-area-inset-top,0px));width:300px;z-index:40;
  background:${C.inkGlass};border-left:3px solid ${C.yellow};border-radius:6px;padding:9px 12px 10px;color:${C.paper};font:500 12.5px/1.55 ${F.ui};pointer-events:auto;user-select:none}
.dp-panel[hidden]{display:none}
.dp-panel .hd{display:flex;align-items:center;gap:6px;margin-bottom:4px}
.dp-panel .hd b{flex:1;min-width:0;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font:800 13px/1.2 ${F.ui};color:${C.yellow};letter-spacing:.06em}
.dp-panel button{font:700 12px/1 ${F.ui};color:${C.paper};background:rgba(244,241,232,.12);border:1px solid ${C.line};border-radius:5px;padding:6px 9px;cursor:pointer}
.dp-panel button:active{background:${C.yellowDim}}
.dp-panel .live{font:700 14px/1.4 ${F.num};font-variant-numeric:tabular-nums}
.dp-panel .mode{color:${C.muted}}
.dp-panel .mode i{font-style:normal;display:inline-block;margin-left:4px;padding:0 5px;border-radius:3px;background:rgba(244,241,232,.1);color:${C.muted}}
.dp-panel .mode i.on{background:${C.yellow};color:${C.ink}}
.dp-panel .sec{margin-top:6px;padding-top:5px;border-top:1px solid ${C.line};font-variant-numeric:tabular-nums}
.dp-panel .sec div:first-child{color:${C.yellow};font-weight:700}
.dp-panel .bad{color:${C.red}}
.dp-menu{position:absolute;inset:0;z-index:60;display:flex;align-items:center;justify-content:center;background:rgba(8,10,12,.45);pointer-events:auto}
.dp-menu[hidden]{display:none}
.dp-menu .card{width:min(560px,calc(100vw - 32px));max-height:calc(100vh - 32px);overflow:auto;background:${C.inkGlass};backdrop-filter:blur(8px);border-top:3px solid ${C.yellow};
  border-radius:8px;padding:16px 18px;color:${C.paper};font:500 14px/1.5 ${F.ui}}
.dp-menu h2{margin:0 0 10px;font:800 20px/1.2 ${F.ui};letter-spacing:.08em}
.dp-menu .lab{margin:10px 0 5px;color:${C.muted};font-size:12px;letter-spacing:.1em}
.dp-menu .opts{display:flex;flex-wrap:wrap;gap:6px}
.dp-menu .opts button{font:700 13px/1 ${F.ui};color:${C.paper};background:rgba(244,241,232,.1);border:1px solid ${C.line};border-radius:6px;padding:9px 12px;cursor:pointer}
.dp-menu .opts button.on{background:${C.yellow};color:${C.ink};border-color:${C.yellow}}
.dp-menu .tip{margin-top:8px;color:${C.muted};font-size:13px;min-height:2.6em}
.dp-menu .foot{display:flex;gap:8px;margin-top:14px}
.dp-menu .foot button{flex:1;font:800 15px/1 ${F.ui};padding:12px;border-radius:6px;border:0;cursor:pointer}
.dp-menu .foot .go{background:${C.yellow};color:${C.ink}}
.dp-menu .foot .city{background:rgba(244,241,232,.12);color:${C.paper}}
body.dc-touch .dp-panel{right:auto;left:calc(12px + env(safe-area-inset-left,0px));top:calc(64px + env(safe-area-inset-top,0px));width:236px;
  font-size:10.5px;line-height:1.4;padding:5px 8px 6px}
body.dc-touch .dp-panel .live{font-size:11.5px}
body.dc-touch .dp-panel .mode{display:none}
body.dc-touch .dp-panel button{padding:5px 8px;font-size:11px}
body.dc-touch .dp-panel .sec{margin-top:3px;padding-top:3px}
body.dc-touch .dp-menu .card{padding:10px 14px;max-height:calc(100vh - 12px);font-size:12px}
body.dc-touch .dp-menu h2{font-size:16px;margin-bottom:4px}
body.dc-touch .dp-menu .lab{margin:6px 0 4px}
body.dc-touch .dp-menu .opts button{padding:7px 10px;font-size:12px}
body.dc-touch .dp-menu .tip{margin-top:5px;font-size:11.5px;min-height:0}
body.dc-touch .dp-menu .foot{margin-top:8px}
body.dc-touch .dp-menu .foot button{padding:9px;font-size:14px}
`;

/** m:ss.s */
const clock = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const deg = (r: number) => r * 180 / Math.PI;
const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));

/** The ground line: the last `N` positions (30 a second), a ribbon coloured grey (gripping) to yellow to red (45°). */
class Trace {
  static readonly N = 900;
  readonly mesh: THREE.Mesh;
  private pos = new Float32Array(Trace.N * 2 * 3);
  private col = new Float32Array(Trace.N * 2 * 3);
  private count = 0;
  private lx = 0; private lz = 0;
  private geo = new THREE.BufferGeometry();
  constructor(scene: THREE.Scene) {
    const idx: number[] = [];
    for (let i = 0; i + 1 < Trace.N; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    this.geo.setIndex(idx);
    this.geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    this.mesh = new THREE.Mesh(this.geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 }));
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
    scene.add(this.mesh);
  }
  clear(): void { this.count = 0; this.geo.setDrawRange(0, 0); }
  add(x: number, z: number, slipDeg: number): void {
    if (this.count > 0) {
      const d = Math.hypot(x - this.lx, z - this.lz);
      if (d > 8) this.clear();
      else if (d < 0.05) return;
    }
    const dx = this.count > 0 ? x - this.lx : 0, dz = this.count > 0 ? z - this.lz : 1, l = Math.hypot(dx, dz) || 1;
    const nx = (dz / l) * 0.14, nz = (-dx / l) * 0.14;
    if (this.count === Trace.N) { this.pos.copyWithin(0, 6); this.col.copyWithin(0, 6); this.count--; }
    const o = this.count * 6;
    this.pos[o] = x + nx; this.pos[o + 1] = 0.035; this.pos[o + 2] = z + nz;
    this.pos[o + 3] = x - nx; this.pos[o + 4] = 0.035; this.pos[o + 5] = z - nz;
    const a = Math.min(1, Math.max(0, (Math.abs(slipDeg) - 5) / 40));
    // light blue (gripping: not to be taken for paint) -> yellow (a 0.5) -> red
    const r = a < 0.5 ? 0.3 + a * 1.4 : 1 - (a - 0.5) * 0.2, g = a < 0.5 ? 0.72 + a * 0.06 : 0.75 - (a - 0.5) * 1.3, b = a < 0.5 ? 1 - a * 1.8 : 0.1;
    for (const k of [0, 3]) { this.col[o + k] = r; this.col[o + k + 1] = g; this.col[o + k + 2] = b; }
    this.count++;
    this.lx = x; this.lz = z;
    (this.geo.attributes.position as THREE.BufferAttribute).needsUpdate = true;
    (this.geo.attributes.color as THREE.BufferAttribute).needsUpdate = true;
    this.geo.setDrawRange(0, Math.max(0, this.count - 1) * 6);
  }
}

export function installPlay(engine: Engine, container: HTMLElement): void {
  const world = engine.get<WorldApi>('world')!;
  const veh = () => engine.get<VehicleApi>('vehicle')!;
  const ui = () => engine.get<UiApi>('ui');
  css(STYLE);

  let save: { station: number; speed: number; body: BodyType; trace: boolean; best: { score: number; time: number } | null } = { station: 0, speed: 1, body: 'sedan', trace: true, best: null };
  try { save = { ...save, ...JSON.parse(localStorage.getItem(SAVE) ?? '{}') }; } catch { /* first visit */ }
  if (!BODIES.includes(save.body)) save.body = 'sedan';
  save.station = Math.min(STATIONS.length - 1, Math.max(0, save.station | 0));
  save.speed = Math.min(ENTRY_SPEEDS.length - 1, Math.max(0, save.speed | 0));
  const store = () => { try { localStorage.setItem(SAVE, JSON.stringify(save)); } catch { /* private mode */ } };

  const trace = new Trace(engine.scene);
  trace.mesh.visible = save.trace;

  // ---- the car ----------------------------------------------------------------------------------------------------
  const spare = new Map<BodyType, Vehicle>();
  let swapping = false;
  const setBody = async (b: BodyType) => {
    if (swapping) return;
    swapping = true;
    try {
      if (b !== 'sedan') await readyBodies([b as BodySource]);
      const v = veh();
      if ((v.look.body ?? 'sedan') === b) return;
      const cur = v.car;
      const next = spare.get(b) ?? new Vehicle(engine.physics, SPEC_OF[b], { x: 0, y: -600, z: 0 }, 0);
      spare.delete(b);
      next.body.setEnabled(true);
      next.reset({ x: cur.pos.x, y: cur.pos.y + 0.15, z: cur.pos.z }, Math.atan2(cur.fwd.x, cur.fwd.z));
      let look = TAXI_LOOK;
      if (b !== 'sedan') {
        const liv = defaultLivery(b);
        const own = b === 'coupe' ? '#c41e1e' : b === 'super' ? '#9bd21c' : b === 'ae86' ? '#f2f2ef' : null;
        const paint = new THREE.Color(own ?? liv.upper);
        look = { upper: paint, lower: own ? paint.clone() : new THREE.Color(liv.lower), taxi: false, body: b };
      }
      const prev = v.swapCar(next, look);
      prev.car.body.setTranslation({ x: 0, y: -600, z: 0 }, false);
      prev.car.body.setEnabled(false);
      spare.set(prev.look.body ?? 'sedan', prev.car);
      seg = null;
    } finally { swapping = false; }
  };

  // ---- 练习点 and R -------------------------------------------------------------------------------------------------
  const respawn = (): boolean => {
    const st = STATIONS[save.station], v = veh();
    v.reset({ x: st.x, y: v.car.spec.wheelRadius + 0.05, z: st.z }, st.yaw);
    const kmh = st.running ? ENTRY_SPEEDS[save.speed] : 0;
    if (kmh > 0) v.car.setMoving(kmh / 3.6);
    world.props?.reset();
    trace.clear();
    seg = null; lap = null;
    engine.get<CameraApi>('camera')?.snap();
    labels();
    return true;
  };
  world.respawn = respawn;
  engine.events.on('game:start', () => { respawn(); hint(); });
  const goStation = (i: number) => { save.station = i; store(); respawn(); };

  // ---- the panel --------------------------------------------------------------------------------------------------
  const panel = el('div', 'dp-panel', container);
  panel.hidden = true;
  const hd = el('div', 'hd', panel);
  const title = el('b', '', hd);
  const menuBtn = el('button', '', hd);
  const againBtn = el('button', '', hd);
  menuBtn.addEventListener('click', () => openMenu(true));
  againBtn.addEventListener('click', () => { if (ui()?.state === 'playing') respawn(); });
  const live = el('div', 'live', panel), mode = el('div', 'mode', panel);
  const lastBox = el('div', 'sec', panel), lapBox = el('div', 'sec', panel);
  const lastLines = [0, 1, 2, 3, 4].map(() => el('div', '', lastBox));
  const lapLines = [0, 1].map(() => el('div', '', lapBox));
  const labels = () => {
    const st = t(`dp.st.${STATIONS[save.station].id}` as 'dp.st.junction');
    title.textContent = TOUCH ? st : `${t('dp.title')} · ${st}`;
    menuBtn.textContent = t(TOUCH ? 'dp.menuBtnTouch' : 'dp.menuBtn');
    againBtn.textContent = t(TOUCH ? 'dp.againTouch' : 'dp.again');
  };
  const hint = () => {
    const hud = (engine.get<{ name: string; coach?(s: string, secs: number): void }>('hud'));
    hud?.coach?.(t(TOUCH ? 'dp.coachTouch' : 'dp.coach'), 8);
  };

  // ---- the menu ---------------------------------------------------------------------------------------------------
  const menu = el('div', 'dp-menu', container);
  menu.hidden = true;
  const card = el('div', 'card', menu);
  const h2 = el('h2', '', card);
  const labSt = el('div', 'lab', card), optSt = el('div', 'opts', card), tip = el('div', 'tip', card);
  const labSp = el('div', 'lab', card), optSp = el('div', 'opts', card);
  const labCar = el('div', 'lab', card), optCar = el('div', 'opts', card);
  const labTr = el('div', 'lab', card), optTr = el('div', 'opts', card);
  const foot = el('div', 'foot', card);
  const goBtn = el('button', 'go', foot), cityBtn = el('button', 'city', foot);
  goBtn.addEventListener('click', () => openMenu(false));
  cityBtn.addEventListener('click', () => { const u = new URL(location.href); u.searchParams.delete('world'); location.href = u.toString(); });
  const fillMenu = () => {
    h2.textContent = t('dp.title');
    labSt.textContent = t('dp.stations'); labSp.textContent = t('dp.speed'); labCar.textContent = t('dp.car'); labTr.textContent = t('dp.trace');
    goBtn.textContent = t('dp.close'); cityBtn.textContent = t('dp.toCity');
    optSt.replaceChildren(); optSp.replaceChildren(); optCar.replaceChildren(); optTr.replaceChildren();
    STATIONS.forEach((st, i) => {
      const b = el('button', i === save.station ? 'on' : '', optSt);
      b.textContent = `${i + 1} ${t(`dp.st.${st.id}` as 'dp.st.junction')}`;
      b.addEventListener('click', () => { save.station = i; store(); fillMenu(); respawn(); openMenu(false); });
    });
    tip.textContent = t(`dp.tip.${STATIONS[save.station].id}` as 'dp.tip.junction');
    ENTRY_SPEEDS.forEach((kmh, i) => {
      const b = el('button', i === save.speed ? 'on' : '', optSp);
      b.textContent = kmh ? t('dp.kmh', { n: kmh }) : t('dp.standing');
      b.addEventListener('click', () => { save.speed = i; store(); fillMenu(); });
    });
    const cur = veh().look.body ?? 'sedan';
    for (const body of BODIES) {
      const b = el('button', body === cur ? 'on' : '', optCar);
      b.textContent = BODY_NAME[body]?.() ?? body;
      b.addEventListener('click', () => { save.body = body; store(); void setBody(body).then(() => { fillMenu(); respawn(); }); });
    }
    for (const on of [true, false]) {
      const b = el('button', on === save.trace ? 'on' : '', optTr);
      b.textContent = t(on ? 'settings.on' : 'settings.off');
      b.addEventListener('click', () => { save.trace = on; trace.mesh.visible = on; store(); fillMenu(); });
    }
  };
  const openMenu = (on: boolean) => {
    const u = ui(); if (!u) return;
    if (on) { if (u.state !== 'playing') return; fillMenu(); u.overlay(true); menu.hidden = false; }
    else if (!menu.hidden) { menu.hidden = true; labels(); u.overlay(false); }
  };
  addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const st = ui()?.state;
    if (!menu.hidden) { if (e.code === 'Escape' || e.code === 'KeyX') { e.preventDefault(); openMenu(false); } return; }
    if (st !== 'playing') return;
    if (e.code === 'KeyX') openMenu(true);
    const d = /^(Digit|Numpad)([1-9])$/.exec(e.code);
    if (d && Number(d[2]) <= STATIONS.length) goStation(Number(d[2]) - 1);
  });

  // ---- measuring --------------------------------------------------------------------------------------------------
  let seg: Seg | null = null;
  let last: Reading | null = null;
  const line = courseLine(2), cps = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9].map((k) => line[Math.floor(k * line.length / 10)]);
  let lap: { t: number; score: number; next: number } | null = null;
  let lapMsg: { text: string; at: number } | null = null;
  let traceT = 0, prevZ = 0;
  const onTestLane = (x: number, z: number) => Math.abs(x - TEST_LANE.x) < GRID.width / 2 && z > TEST_LANE.z0 && z < TEST_LANE.zStop + 6;

  const finish = (s: Seg, v1: number) => {
    const car = veh().car;
    const dx = car.pos.x - s.x0, dz = car.pos.z - s.z0, fx = Math.sin(s.h0), fz = Math.cos(s.h0);
    last = {
      s: s.t, v0: s.v0, v1, avg: s.sumSlip / Math.max(1, s.samples), max: s.maxSlip, tv: deg(s.tv), nv: deg(s.nv),
      fwd: dx * fx + dz * fz, side: Math.abs(dx * fz - dz * fx), to90: s.to90, stop: s.stop, hit: s.hit, mode: s.mode,
    };
  };

  const sys: System = {
    name: 'driftpark',
    postStep(dt) {
      const v = veh(), car = v.car;
      if (!v.occupied || ui()?.state === 'title') return;
      const slip = car.bodySlip, sp = car.speed;
      const travel = Math.atan2(car.vel.x, car.vel.z), nose = Math.atan2(car.fwd.x, car.fwd.z);
      const ctl = v.controls;
      const m: Mode | null = car.driftPhase === 1 ? 'phone' : car.holdDir !== 0 ? 'hold' : ctl.handbrake && Math.abs(slip) > 0.1 ? 'handbrake' : null;
      const sliding = sp > 5 && (Math.abs(slip) > 0.17 || m !== null);
      if (!seg && sliding) {
        seg = { t: 0, v0: sp, x0: car.pos.x, z0: car.pos.z, h0: travel, tv: 0, nv: 0, lastTv: travel, lastNv: nose, len: 0, lastX: car.pos.x, lastZ: car.pos.z,
          maxSlip: 0, sumSlip: 0, samples: 0, mode: m ?? 'slide', to90: null, stop: onTestLane(car.pos.x, car.pos.z) ? TEST_LANE.zStop - car.pos.z : null, hit: false, calm: 0 };
      }
      if (seg) {
        seg.t += dt;
        if (sp > 1) { seg.tv += wrap(travel - seg.lastTv); seg.lastTv = travel; }
        seg.nv += wrap(nose - seg.lastNv); seg.lastNv = nose;
        seg.len += Math.hypot(car.pos.x - seg.lastX, car.pos.z - seg.lastZ); seg.lastX = car.pos.x; seg.lastZ = car.pos.z;
        const a = Math.abs(deg(slip)); seg.maxSlip = Math.max(seg.maxSlip, a); seg.sumSlip += a; seg.samples++;
        if (m && seg.mode === 'slide') seg.mode = m;
        if (car.impact > 3) seg.hit = true;
        if (seg.to90 === null && Math.abs(seg.tv) >= Math.PI / 2) seg.to90 = (car.pos.x - seg.x0) * Math.sin(seg.h0) + (car.pos.z - seg.z0) * Math.cos(seg.h0);
        seg.calm = Math.abs(slip) < 0.1 && !m ? seg.calm + dt : 0;
        if (seg.calm > 0.3 || sp < 2) {
          if (seg.t > 0.5) finish(seg, sp);
          seg = null;
        }
      }
      // the ground line
      traceT += dt;
      if (traceT >= 1 / 30 && sp > 0.5) { traceT = 0; trace.add(car.pos.x, car.pos.z, deg(slip)); }
      // the course: a lap from the start line through every checkpoint and back over it
      const onStart = Math.abs(car.pos.x - COURSE.corners[0][0]) < COURSE.width / 2 + 1;
      const crossed = onStart && prevZ < COURSE.startZ && car.pos.z >= COURSE.startZ && car.vel.z > 0;
      prevZ = car.pos.z;
      if (crossed) {
        if (lap && lap.next >= cps.length) {
          const time = engine.time - lap.t, score = Math.round(lap.score);
          const better = !save.best || score > save.best.score || (score === save.best.score && time < save.best.time);
          if (better) { save.best = { score, time }; store(); }
          lapMsg = { text: t(better ? 'dp.lapNew' : 'dp.lapDone', { time: clock(time), score: score.toLocaleString() }), at: engine.time };
        }
        lap = { t: engine.time, score: 0, next: 1 };
      } else if (lap) {
        const cp = cps[lap.next];
        if (cp && Math.hypot(car.pos.x - cp.x, car.pos.z - cp.z) < COURSE.width / 2 + 5) lap.next++;
        if (Math.abs(slip) > 0.17 && sp > 5) lap.score += dt * sp * Math.abs(slip) * 12;
        // gone off somewhere else for good
        if (engine.time - lap.t > 300) lap = null;
      }
    },
    update() {
      const st = ui()?.state;
      panel.hidden = !(st === 'playing' || st === 'overlay');
      if (panel.hidden) return;
      const v = veh(), car = v.car, ctl = v.controls;
      live.textContent = t('dp.live', { v: Math.round(car.speed * 3.6), a: Math.round(Math.abs(deg(car.bodySlip))), y: Math.round(Math.abs(deg(car.yawRate))) });
      const m: Mode | 'grip' = car.driftPhase === 1 ? 'phone' : car.holdDir !== 0 ? 'hold' : ctl.handbrake ? 'handbrake' : Math.abs(car.bodySlip) > 0.17 ? 'slide' : 'grip';
      const chip = (on: boolean, key: Parameters<typeof t>[0]) => `<i class="${on ? 'on' : ''}">${t(key)}</i>`;
      const steer = ctl.steer < -0.1 ? '◀' : ctl.steer > 0.1 ? '▶' : '·';
      mode.innerHTML = `${t(`dp.mode.${m}` as 'dp.mode.grip')} <i class="${steer !== '·' ? 'on' : ''}">${steer}</i>${chip(ctl.throttle > 0.1, 'dp.in.gas')}${chip(ctl.brake > 0.1, 'dp.in.brake')}${chip(!!ctl.drift, 'dp.in.drift')}${TOUCH ? '' : chip(ctl.handbrake, 'dp.in.hb')}`;
      const r = last;
      if (!r) { lastLines[0].textContent = t('dp.none'); for (let i = 1; i < 5; i++) lastLines[i].textContent = ''; }
      else {
        lastLines[0].textContent = t('dp.last', { s: r.s.toFixed(1), v0: Math.round(r.v0 * 3.6), v1: Math.round(r.v1 * 3.6), mode: t(`dp.mode.${r.mode}` as 'dp.mode.grip') });
        lastLines[1].textContent = t('dp.angles', { avg: Math.round(r.avg), max: Math.round(r.max) });
        lastLines[2].textContent = t('dp.turns', { tv: Math.round(Math.abs(r.tv)), nv: Math.round(Math.abs(r.nv)) });
        lastLines[3].textContent = t('dp.moved', { fwd: Math.round(r.fwd), side: Math.round(r.side) }) + (r.to90 !== null ? t('dp.to90', { d: Math.round(r.to90) }) : '');
        lastLines[4].textContent = r.stop !== null ? t('dp.junction', { d: Math.round(r.stop) }) + t(r.hit ? 'dp.hit' : 'dp.clean') : (r.hit ? t('dp.hit').replace(/^ · /, '') : '');
        lastLines[4].className = r.hit ? 'bad' : '';
      }
      const showLap = save.station === STATIONS.findIndex((s) => s.id === ('course' as StationId)) || lap || save.best;
      lapBox.hidden = !showLap;
      if (showLap) {
        lapLines[0].textContent = lapMsg && engine.time - lapMsg.at < 6 ? lapMsg.text : lap ? t('dp.lap', { time: clock(engine.time - lap.t), score: Math.round(lap.score).toLocaleString() }) : t('dp.lapIdle');
        lapLines[1].textContent = save.best ? t('dp.lapBest', { score: save.best.score.toLocaleString(), time: clock(save.best.time) }) : '';
      }
    },
  };
  engine.add(sys);
  labels();

  // the car chosen last time, once its body is in
  if (save.body !== 'sedan') void setBody(save.body);
}
