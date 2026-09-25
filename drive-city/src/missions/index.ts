import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { lang, t } from '../core/I18n';
import { Rng } from '../core/Rng';
import { project } from '../city/Geo';
import { LANDMARKS } from '../city/landmarks';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi, RaceApi, VehicleApi, WantedApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import { Gait } from '../character/Animator';
import { randomLook, type Look } from '../character/Body';
import { nearestKerb, SIDEWALK, type Kerb } from '../people/Pavement';
import { Marker } from './Marker';
import { Jobs } from './Jobs';
import { pickAddress } from './Address';
import { Banner } from '../ui/Banner';
import { MissionHud } from './MissionHud';

/** 'pickup': hailers are out and the taxi is empty; 'wait': a moment after a drop-off. */
type Stage = 'off' | 'wait' | 'pickup' | 'boarding' | 'ride' | 'alight';

/**
 * A fare's colour says how far it goes (Crazy Taxi's code): green a short hop, yellow across the
 * district, red a long haul. Ranges are road metres; `weight` is how often each is hailing.
 */
const TIERS = [
  { color: '#58d26a', min: 300, max: 800, weight: 0.45 },
  { color: '#ffc21f', min: 800, max: 1500, weight: 0.35 },
  { color: '#ff5a4a', min: 1500, max: 2600, weight: 0.2 },
];
/** A street event's rush fare: its colour, and how long it waits for you (s). */
const URGENT_COLOR = '#ff2d55', URGENT_WAIT = 40;
/** People hailing at once, and how far out they stand (m). */
const HAILERS = 4, HAIL_MIN = 45, HAIL_MAX = 260;
/** Seconds a shift starts with; each delivery adds some back. */
const SHIFT = 60;
/** The arcade meter: flag fall plus yuan per km, so a long haul pays for itself (Beijing's tariff paid ¥13 for anything under 3 km). */
const payFor = (km: number) => Math.round(8 + 14 * km);
/** How much of the passenger's time was left on arrival -> speed bonus (share of the fare) and shift seconds. */
const RATINGS = [{ min: 0.45, bonus: 0.6, time: 12, key: 'taxi.rate.fast' }, { min: 0.2, bonus: 0.25, time: 8, key: 'taxi.rate.ok' }, { min: -1, bonus: 0, time: 4, key: 'taxi.rate.slow' }] as const;
/** A shift's grade by what it earned. */
const GRADES: [number, string][] = [[400, 'S'], [250, 'A'], [130, 'B'], [50, 'C'], [0, 'D']];


/** Beijing taxi meter: ¥13 covers the first 3 km, then ¥2.3 per km. */
export const fare = (km: number) => Math.round(13 + Math.max(0, km - 3) * 2.3);

/**
 * Well-known places besides the modelled landmarks. Each is anchored to its OSM street (`road`),
 * so the fare stops on the right street whatever the datum of the rough lat/lon hint.
 */
const PLACES: { zh: string; en: string; road: string; lat: number; lon: number }[] = [
  { zh: '王府井', en: 'Wangfujing', road: '王府井大街', lat: 39.9149, lon: 116.4108 },
  { zh: '东单', en: 'Dongdan', road: '东单北大街', lat: 39.9083, lon: 116.418 },
  { zh: '建国门', en: 'Jianguomen', road: '建国门内大街', lat: 39.9079, lon: 116.4344 },
  { zh: '前门大街', en: 'Qianmen Street', road: '前门大街', lat: 39.896, lon: 116.3975 },
  { zh: '崇文门', en: 'Chongwenmen', road: '崇文门外大街', lat: 39.901, lon: 116.417 },
  { zh: '天坛东门', en: 'Temple of Heaven, East Gate', road: '天坛东路', lat: 39.883, lon: 116.419 },
  { zh: '珠市口', en: 'Zhushikou', road: '珠市口东大街', lat: 39.892, lon: 116.399 },
  { zh: '广渠门', en: 'Guangqumen', road: '广渠门内大街', lat: 39.895, lon: 116.445 },
  { zh: '光华路', en: 'Guanghua Road', road: '光华路', lat: 39.915, lon: 116.455 },
  { zh: '南池子', en: 'Nanchizi', road: '南池子大街', lat: 39.911, lon: 116.398 },
  { zh: '东华门', en: 'Donghuamen', road: '东华门大街', lat: 39.914, lon: 116.401 },
  { zh: '金宝街', en: 'Jinbao Street', road: '金宝街', lat: 39.917, lon: 116.421 },
  { zh: '祈年大街', en: 'Qinian Avenue', road: '祈年大街', lat: 39.887, lon: 116.411 },
  { zh: '永定门', en: 'Yongdingmen', road: '永定门内大街', lat: 39.876, lon: 116.397 },
];

export interface MissionSystem extends MissionApi {
  /** Shots and testing: put a fare on the kerb near the player now. */
  debug: {
    startFare(): boolean;
    /** The short jobs: where they start, start one by name, which one runs. */
    jobPosts(): { kind: string; x: number; z: number; ready: boolean }[];
    startJob(kind: 'delivery' | 'chase' | 'trial'): boolean;
    job(): string | null;
    state(): { stage: string; pickup: { x: number; z: number } | null; dest: { x: number; z: number; label: string } | null; limit: number; elapsed: number;
      shift: { on: boolean; clock: number; fares: number; earned: number }; hailers: { x: number; z: number; tier: number; urgent: boolean }[] };
  };
}

/**
 * Taxi fares, the game's core job, played like Crazy Taxi. While the player drives a taxi, up to
 * four people hail from the kerbs around, each marked in the colour of how far they are going
 * (TIERS). Stop by one and they get in; the first fare starts a shift of SHIFT seconds on the clock.
 * Every passenger has their own clock too: get there with time to spare for a speed bonus and more
 * shift time, too late and they get out; stunts on the way (stunts/) earn tips. When the shift
 * clock runs out it is over - earnings, fares and a grade - and the next fare starts a new one.
 * Police, abandoning the car or a job/race starting lose the fare. Cash persists in localStorage.
 */
export async function install(engine: Engine): Promise<void> {
  const tr = engine.get<TrafficApi>('traffic');
  const pl = engine.get<PlayerApi>('player');
  if (!tr || !pl) return;
  const g = tr.graph;
  const rng = new Rng(8866);
  const rnd = () => rng.next();
  const marker = new Marker(engine.scene);
  const hud = new MissionHud();
  const banner = new Banner();
  // Every landmark is a fare destination except the player's own house: nobody hails a taxi to be
  // driven to your garage.
  const places = [...LANDMARKS.filter((l) => l.id !== 'home')
    .map((l) => ({ lat: l.lat, lon: l.lon, zh: l.name.zh, en: l.name.en, road: '' })), ...PLACES].map((p) => {
    const [x, z] = project(p.lat, p.lon);
    return { x, z, zh: p.zh, en: p.en, road: p.road, kerb: undefined as Kerb | null | undefined };
  });
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  const byRoad = new Map<string, number[]>();
  for (const l of g.links) if (l.name) { const a = byRoad.get(l.name) ?? []; a.push(l.id); byRoad.set(l.name, a); }
  /** Where to stop for a place: on its street (the piece nearest the hint), else the kerb nearest the anchor. */
  const resolve = (p: (typeof places)[number]): Kerb | null => {
    const ids = p.road ? byRoad.get(p.road) : undefined;
    if (ids?.length) {
      let best = ids[0], bd = Infinity;
      for (const id of ids) { const l = g.links[id]; g.at(l, l.len / 2, 0, at); const d = Math.hypot(at.x - p.x, at.z - p.z); if (d < bd) { bd = d; best = id; } }
      const l = g.links[best];
      g.at(l, l.len / 2, 0, at);
      return nearestKerb(g, at.x, at.z, 40, 0.8);
    }
    return nearestKerb(g, p.x, p.z, 300, 0.8);
  };

  let cash = 0;
  try { cash = Math.max(0, Number(localStorage.getItem('drivecity.cash') ?? 0) || 0); } catch { /* private mode */ }
  const saveCash = () => { try { localStorage.setItem('drivecity.cash', String(cash)); } catch { /* ignore */ } };
  let best = 0;
  try { best = Number(localStorage.getItem('drivecity.taxi.best') ?? 0) || 0; } catch { /* private mode */ }
  let jobs: Jobs | null = null;

  let stage: Stage = 'off', timer = 0, objective: string | null = null, blipsOn = false;
  let dest: { x: number; z: number; label: string } | null = null;
  let tripLen = 0, limit = 0, elapsed = 0, crashes = 0, careT = 0, tips = 0, tier = 0, spawnT = 0, scaredT = 0, summaryT = 0;
  let summary = '';
  const shift = { on: false, clock: 0, fares: 0, earned: 0, away: 0 };

  /** `urgent`: a street event's rush fare - red, flashing, gone in URGENT_WAIT s, double pay on a tighter clock. */
  interface Hailer { pos: THREE.Vector3; yaw: number; look: Look; gait: Gait; t: number; tier: number; marker: Marker; urgent: boolean }
  let urgentRide = false;
  const hailers: Hailer[] = [];
  const spareMarkers = Array.from({ length: HAILERS + 1 }, () => new Marker(engine.scene));
  const client = { pos: new THREE.Vector3(), prev: new THREE.Vector3(), draw: new THREE.Vector3(), yaw: 0, gait: new Gait(), look: randomLook(rnd), visible: false,
    from: new THREE.Vector3(), to: new THREE.Vector3(), walkT: 0, walkDur: 1, speed: 0 };
  const blips: Blip[] = [];
  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const nav = () => engine.get<NavApi>('nav');
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const inTaxi = () => { const v = vehicle(); return pl.mode === 'driving' && v.occupied && v.look.taxi; };
  const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  const busy = () => (engine.get<WantedApi>('wanted')?.level ?? 0) > 0 || !!engine.get<RaceApi>('races')?.active || !!jobs?.busy;

  const walk = (from: THREE.Vector3, to: THREE.Vector3) => {
    client.from.copy(from); client.to.copy(to); client.walkT = 0;
    client.walkDur = Math.max(0.6, from.distanceTo(to) / 1.5);
    client.yaw = Math.atan2(to.x - from.x, to.z - from.z);
  };

  const dropHailer = (h: Hailer) => { h.marker.hide(); spareMarkers.push(h.marker); hailers.splice(hailers.indexOf(h), 1); };
  const clearHailers = () => { while (hailers.length) dropHailer(hailers[0]); };

  /** Someone on a kerb HAIL_MIN-HAIL_MAX m from the taxi, facing the road, going as far as their colour says. */
  const spawnHailer = (min = HAIL_MIN, max = HAIL_MAX, urgent = false): boolean => {
    const car = vehicle().car;
    const ids = g.near(car.pos.x, car.pos.z, max);
    for (let attempt = 0; attempt < 24 && ids.length; attempt++) {
      const l = g.links[ids[Math.floor(rnd() * ids.length)]];
      if (!SIDEWALK[l.cls] || l.len < 20) continue;
      const s = 6 + rnd() * (l.len - 12), side = l.oneway ? -1 : rnd() < 0.5 ? 1 : -1;
      g.at(l, s, side * (l.hw + 0.8), at);
      const d = Math.hypot(at.x - car.pos.x, at.z - car.pos.z);
      if (d < min || d > max || hailers.some((h) => Math.hypot(h.pos.x - at.x, h.pos.z - at.z) < 40)) continue;
      // Not on a job's post: stopping for the fare would start the job and lose them both.
      if (jobs?.postList.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < 30)) continue;
      const r = rnd();
      const tr0 = urgent ? 2 : r < TIERS[0].weight ? 0 : r < TIERS[0].weight + TIERS[1].weight ? 1 : 2;
      const m = spareMarkers.pop()!;
      const h: Hailer = { pos: new THREE.Vector3(at.x, 0.045, at.z), yaw: Math.atan2(-side * at.dz, side * at.dx), look: randomLook(rnd), gait: new Gait(), t: rnd() * 3, tier: tr0, marker: m, urgent };
      m.show(at.x, at.z, urgent ? URGENT_COLOR : TIERS[tr0].color, urgent ? 0.8 : 0.5);
      hailers.push(h);
      return true;
    }
    return false;
  };

  const endFare = (msg: string | null, wait = 1.5) => {
    if (msg) toast(msg);
    stage = 'wait'; timer = wait; dest = null;
    if (client.walkT >= client.walkDur) client.visible = false;
    nav()?.clearTarget('mission');
    marker.hide();
  };

  /** The passenger gets out here, on the kerb side, and walks off. */
  const alight = (toX: number, toZ: number) => {
    const car = vehicle().car, tmp = new THREE.Vector3(), door = new THREE.Vector3();
    const side = Math.sign((toX - car.pos.x) * car.left.x + (toZ - car.pos.z) * car.left.z) || 1;
    tmp.copy(car.pos).addScaledVector(car.left, side * 1.15).addScaledVector(car.fwd, -0.45); tmp.y = 0.045;
    door.copy(tmp).addScaledVector(tmp.clone().sub(car.pos).setY(0).normalize(), 2.5);
    client.visible = true; client.pos.copy(tmp); client.prev.copy(tmp);
    walk(tmp, door);
    stage = 'alight';
    nav()?.clearTarget('mission'); marker.hide();
  };

  const endShift = () => {
    if (!shift.on) return;
    shift.on = false;
    if (stage === 'ride') { alight(vehicle().car.pos.x, vehicle().car.pos.z); dest = null; }
    const grade = GRADES.find(([n]) => shift.earned >= n)![1];
    const record = shift.earned > best;
    if (record) { best = shift.earned; try { localStorage.setItem('drivecity.taxi.best', String(best)); } catch { /* ignore */ } }
    summary = t(record ? 'taxi.shiftRecord' : 'taxi.shiftEnd', { n: shift.fares, cash: shift.earned, grade });
    summaryT = 7;
    banner.show(t('taxi.shiftOver', { grade }), grade === 'S' || grade === 'A' ? '#ffc21f' : '#f4f4f1');
    setTimeout(() => banner.hide(), 2200);
    toast(summary);
  };

  /** Where this passenger goes: a named place in their range if one fits, else a street address. */
  const chooseDestination = (tr0: number): boolean => {
    const car = vehicle().car, T = TIERS[tr0], heading = Math.atan2(car.fwd.x, car.fwd.z);
    const set = (x: number, z: number, label: string, len: number) => {
      dest = { x, z, label }; tripLen = len;
      limit = urgentRide ? tripLen / 12 + 6 : tripLen / 10.5 + 10; elapsed = 0; crashes = 0; tips = 0; tier = tr0;
      nav()?.setTarget({ x, z, kind: 'mission', label });
      marker.show(x, z, TIERS[tr0].color);
      const say = (['taxi.say1', 'taxi.say2', 'taxi.say3'] as const)[Math.floor(rnd() * 3)];
      toast(t(say, { place: label }));
      return true;
    };
    for (const i of places.map((_, k) => k).sort(() => rnd() - 0.5)) {
      const p = places[i], d = Math.hypot(p.x - car.pos.x, p.z - car.pos.z);
      if (d > T.max || d < T.min * 0.4) continue;
      if (p.kerb === undefined) p.kerb = resolve(p);
      if (!p.kerb) continue;
      const len = nav()?.route(car.pos.x, car.pos.z, heading, p.kerb.x, p.kerb.z)?.len ?? d * 1.35;
      if (len < T.min || len > T.max) continue;
      return set(p.kerb.x, p.kerb.z, lang() === 'zh' ? p.zh : p.en, len);
    }
    const a = pickAddress(g, nav(), rnd, car.pos.x, car.pos.z, T.min, T.max);
    if (!a) return false;
    const len = nav()?.route(car.pos.x, car.pos.z, heading, a.x, a.z)?.len ?? Math.hypot(a.x - car.pos.x, a.z - car.pos.z) * 1.35;
    return set(a.x, a.z, a.label, len);
  };

  engine.events.on('vehicle:impact', (e) => {
    if (stage !== 'ride' || e.strength < 3) return;
    crashes++;
    if (careT <= 0) { toast(t('taxi.careful')); careT = 6; }
  });
  // Stunts with a passenger aboard are tipped (Crazy Taxi's "crazy through").
  engine.events.on('stunt:event', ({ points }) => { if (stage === 'ride') tips += Math.max(1, Math.round(points / 12)); });
  engine.events.on('vehicle:reset', () => { if (stage === 'boarding' || stage === 'ride' || stage === 'alight') { client.visible = false; client.walkT = client.walkDur; endFare(null, 2); } });

  const door = new THREE.Vector3();
  const api: MissionSystem = {
    name: 'missions',
    get cash() { return cash; },
    addCash(n) { cash = Math.max(0, cash + Math.round(n)); saveCash(); if (n > 0) hud.earned(Math.round(n)); },
    story: null,
    get busy() { return !!jobs?.busy || stage === 'boarding' || stage === 'ride'; },
    urgentFare() {
      if (!inTaxi() || stage !== 'pickup' || hailers.some((h) => h.urgent)) return false;
      // Room for it: the farthest ordinary hailer makes way.
      const car = vehicle().car;
      if (hailers.length >= HAILERS) dropHailer(hailers.reduce((a, b) => (a.pos.distanceTo(car.pos) > b.pos.distanceTo(car.pos) ? a : b)));
      if (!spawnHailer(50, 160, true)) return false;
      toast(t('taxi.urgent'));
      return true;
    },
    get objective() { return api.story ?? jobs?.objective ?? objective; },
    debug: {
      startFare: () => { if (!inTaxi()) return false; stage = 'pickup'; clearHailers(); return spawnHailer(12, 60) || spawnHailer(); },
      jobPosts: () => jobs?.postList ?? [],
      startJob: (kind) => jobs?.startKind(kind) ?? false,
      job: () => jobs?.kind ?? null,
      state: () => {
        const car = vehicle().car;
        const near = hailers.reduce<Hailer | null>((b, h) => (!b || h.pos.distanceTo(car.pos) < b.pos.distanceTo(car.pos) ? h : b), null);
        const pickup = stage === 'boarding' ? { x: client.pos.x, z: client.pos.z } : stage === 'pickup' && near ? { x: near.pos.x, z: near.pos.z } : null;
        return { stage, pickup, dest, limit, elapsed, shift: { ...shift }, hailers: hailers.map((h) => ({ x: h.pos.x, z: h.pos.z, tier: h.tier, urgent: h.urgent })) };
      },
    },
    fixedUpdate(dt) {
      const v = vehicle(), car = v.car;
      careT -= dt; scaredT -= dt; summaryT -= dt;
      // The short jobs (Jobs.ts): while one runs, no fare is offered and a running fare is dropped.
      if (!jobs) jobs = new Jobs(engine, { places, resolve, addCash: (n) => api.addCash(n), toast, rnd });
      jobs.fixedUpdate(dt);
      // The client's walk is gameplay (boarding ends when they reach the door): stepped here, drawn in update.
      client.prev.copy(client.pos);
      if (client.visible) {
        if (client.walkT < client.walkDur) {
          client.walkT = Math.min(client.walkDur, client.walkT + dt);
          client.pos.lerpVectors(client.from, client.to, client.walkT / client.walkDur);
          client.speed = 1.5;
        } else { client.speed = 0; if (stage === 'alight') client.walkT += dt; }
      }
      if (!v.inputEnabled) return;
      const wanted = (engine.get<WantedApi>('wanted')?.level ?? 0) > 0;
      const other = !!engine.get<RaceApi>('races')?.active || !!jobs.busy;
      // The shift: its clock runs while you drive the taxi; out of it for long, or into a race or a job, it ends.
      if (shift.on) {
        shift.clock -= dt;
        shift.away = inTaxi() ? 0 : shift.away + dt;
        if (shift.clock <= 0 || shift.away > 5 || other) endShift();
      }
      if (other && (stage === 'boarding' || stage === 'ride')) { client.visible = false; client.walkT = client.walkDur; endFare(null, 3); }
      switch (stage) {
        case 'off':
          if (inTaxi()) { stage = 'pickup'; spawnT = 0; }
          break;
        case 'wait':
          timer -= dt;
          if (timer <= 0) stage = inTaxi() ? 'pickup' : 'off';
          break;
        case 'pickup': {
          if (!inTaxi() && pl.mode === 'driving') { clearHailers(); stage = 'off'; break; }
          // Keep four out, none too far behind; none while something else is going on.
          for (const h of [...hailers]) if (h.pos.distanceTo(car.pos) > HAIL_MAX + 120 || other || (h.urgent && h.t > URGENT_WAIT + 3)) dropHailer(h);
          spawnT -= dt;
          if (spawnT <= 0 && !other && hailers.length < HAILERS) { spawnT = 0.4; spawnHailer(); }
          if (pl.mode !== 'driving' || car.speed > 3) break;
          const h = hailers.find((q) => Math.hypot(car.pos.x - q.pos.x, car.pos.z - q.pos.z) < 7.5);
          if (!h) break;
          if (wanted) { if (scaredT <= 0) { toast(t('taxi.noBoard')); scaredT = 5; } break; }
          // They walk to the rear door on the kerb side.
          client.pos.copy(h.pos); client.prev.copy(h.pos); client.look = h.look; client.visible = true;
          const side = Math.sign((client.pos.x - car.pos.x) * car.left.x + (client.pos.z - car.pos.z) * car.left.z) || 1;
          door.copy(car.pos).addScaledVector(car.left, side * 1.15).addScaledVector(car.fwd, -0.45); door.y = client.pos.y;
          walk(client.pos, door);
          tier = h.tier; urgentRide = h.urgent;
          dropHailer(h);
          stage = 'boarding';
          break;
        }
        case 'boarding':
          if (car.speed > 3 || pl.mode !== 'driving') { client.visible = false; client.walkT = client.walkDur; endFare(null); break; }
          if (client.walkT >= client.walkDur) {
            client.visible = false;
            if (!chooseDestination(tier)) { endFare(null); break; }
            if (!shift.on) { shift.on = true; shift.clock = SHIFT; shift.fares = 0; shift.earned = 0; shift.away = 0; toast(t('taxi.shiftStart', { s: SHIFT })); }
            stage = 'ride';
          }
          break;
        case 'ride': {
          elapsed += dt;
          if (wanted) { alight(car.pos.x, car.pos.z); toast(t('taxi.scared')); dest = null; break; }
          if (pl.mode !== 'driving' || !v.look.taxi) { endFare(t('taxi.left')); break; }
          if (elapsed > limit) { alight(car.pos.x, car.pos.z); toast(t('taxi.late')); dest = null; break; }
          if (Math.hypot(car.pos.x - dest!.x, car.pos.z - dest!.z) < 12 && car.speed < 2.5) {
            const left = 1 - elapsed / limit, r = RATINGS.find((q) => left >= q.min)!;
            const base = payFor(tripLen / 1000) * (urgentRide ? 2 : 1), bonus = Math.round(base * r.bonus), tip = Math.max(0, tips - crashes * 3);
            const total = base + bonus + tip;
            api.addCash(total);
            shift.fares++; shift.earned += total; shift.clock += r.time;
            toast(t('taxi.paidArcade', { rating: t(r.key), pay: base + bonus, tip, s: r.time }));
            alight(dest!.x, dest!.z);
            dest = null;
          }
          break;
        }
        case 'alight':
          if (client.walkT >= client.walkDur + 1.2) { client.visible = false; stage = 'wait'; timer = 1; }
          break;
      }
      // The objective line.
      const clock = shift.on ? fmt(shift.clock) : '';
      if (stage === 'ride' && dest) {
        objective = t('taxi.rideLine', { place: dest.label, time: fmt(limit - elapsed) }) + (shift.on ? `  ·  ${t('taxi.clock', { t: clock })}` : '') + (tips > 0 ? `  ·  ${t('taxi.tips', { n: tips })}` : '');
      } else if (stage === 'boarding') objective = t('taxi.boarding');
      else if (summaryT > 0) objective = summary;
      else if ((stage === 'pickup' || stage === 'wait') && inTaxi() && !other) {
        objective = shift.on ? t('taxi.shiftLine', { t: clock, n: shift.fares, cash: shift.earned }) : t('taxi.find');
      } else objective = null;
    },
    update(dt, alpha) {
      marker.update(dt);
      for (const h of hailers) h.marker.update(dt);
      // Blips on the minimap once navigation exists.
      const n = nav();
      if (n && !blipsOn) {
        blipsOn = true;
        n.addBlips(() => jobs?.provideBlips() ?? []);
        n.addBlips(() => {
          blips.length = 0;
          if (stage === 'pickup') for (const h of hailers) blips.push({ kind: 'pickup', x: h.pos.x, z: h.pos.z, flash: h.urgent });
          else if (stage === 'ride' && dest) blips.push({ kind: 'dropoff', x: dest.x, z: dest.z, label: dest.label });
          return blips;
        });
      }
      for (const h of hailers) {
        h.t += dt;
        h.gait.update({ speed: 0, action: 'wave', t: h.t }, dt, 0.7);
        pl.crowd.add(h.pos, h.yaw, h.gait, h.look);
      }
      if (client.visible) {
        client.gait.update({ speed: client.speed, action: 'move', t: 0 }, dt, 0.7);
        client.draw.lerpVectors(client.prev, client.pos, alpha);
        pl.crowd.add(client.draw, client.yaw, client.gait, client.look);
      }
      hud.update(dt, cash, api.objective);
    },
  };
  engine.add(api);
}
