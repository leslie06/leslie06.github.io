import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { lang, t } from '../core/I18n';
import { Rng } from '../core/Rng';
import { project } from '../city/Geo';
import { LANDMARKS } from '../city/landmarks';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi, RaceApi, VehicleApi, WantedApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import { Gait } from '../character/Animator';
import { randomLook } from '../character/Body';
import { nearestKerb, SIDEWALK, type Kerb } from '../people/Pavement';
import { Marker } from './Marker';
import { MissionHud } from './MissionHud';

type Stage = 'off' | 'wait' | 'pickup' | 'boarding' | 'ride' | 'alight';

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
    state(): { stage: string; pickup: { x: number; z: number } | null; dest: { x: number; z: number; label: string } | null; limit: number; elapsed: number };
  };
}

/**
 * Taxi fares, the game's core job. While the player drives a taxi, someone hails a cab from a
 * kerb nearby; stop next to them and they get in and name a destination (a landmark or a
 * well-known place). Get there before they lose patience: the meter follows Beijing's tariff,
 * with a bonus for speed and a tip that crashes eat into. Police, abandoning the car or taking
 * too long lose the fare. Cash persists in localStorage.
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
  const places = [...LANDMARKS.map((l) => ({ lat: l.lat, lon: l.lon, zh: l.name.zh, en: l.name.en, road: '' })), ...PLACES].map((p) => {
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

  let stage: Stage = 'off', timer = 0, objective: string | null = null, blipsOn = false;
  let pickup: Kerb | null = null;
  let dest: { x: number; z: number; label: string } | null = null;
  let tripLen = 0, limit = 0, elapsed = 0, crashes = 0, careT = 0;
  const client = { pos: new THREE.Vector3(), prev: new THREE.Vector3(), draw: new THREE.Vector3(), yaw: 0, gait: new Gait(), look: randomLook(rnd), visible: false,
    from: new THREE.Vector3(), to: new THREE.Vector3(), walkT: 0, walkDur: 1, speed: 0 };
  const blips: Blip[] = [];
  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const nav = () => engine.get<NavApi>('nav');
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const inTaxi = () => { const v = vehicle(); return pl.mode === 'driving' && v.occupied && v.look.taxi; };
  const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;

  const walk = (from: THREE.Vector3, to: THREE.Vector3) => {
    client.from.copy(from); client.to.copy(to); client.walkT = 0;
    client.walkDur = Math.max(0.6, from.distanceTo(to) / 1.5);
    client.yaw = Math.atan2(to.x - from.x, to.z - from.z);
  };

  const end = (msg: string | null, wait = 6) => {
    if (msg) toast(msg);
    stage = 'wait'; timer = wait; objective = null; pickup = null; dest = null;
    if (client.walkT >= client.walkDur) client.visible = false;
    nav()?.clearTarget('mission');
    marker.hide();
  };

  /** Someone on a kerb 110-350 m away, facing the road. */
  const startFare = (): boolean => {
    const car = vehicle().car;
    const ids = g.near(car.pos.x, car.pos.z, 350);
    for (let attempt = 0; attempt < 30 && ids.length; attempt++) {
      const id = ids[Math.floor(rnd() * ids.length)], l = g.links[id];
      if (!SIDEWALK[l.cls] || l.len < 20) continue;
      const s = 6 + rnd() * (l.len - 12), side = l.oneway ? -1 : rnd() < 0.5 ? 1 : -1;
      g.at(l, s, side * (l.hw + 0.8), at);
      const d = Math.hypot(at.x - car.pos.x, at.z - car.pos.z);
      if (d < 110 || d > 350) continue;
      pickup = { x: at.x, z: at.z, link: id, s, side, dx: at.dx, dz: at.dz };
      client.pos.set(at.x, 0.045, at.z); client.prev.copy(client.pos);
      client.yaw = Math.atan2(-side * at.dz, side * at.dx);   // facing the road
      client.look = randomLook(rnd); client.visible = true; client.walkT = client.walkDur = 1;
      stage = 'pickup'; timer = 120;
      objective = t('taxi.pickup');
      nav()?.setTarget({ x: at.x, z: at.z, kind: 'mission', label: t('taxi.fare') });
      marker.show(at.x, at.z, '#3fb6ff');
      toast(t('taxi.hail'));
      return true;
    }
    return false;
  };

  /** A landmark or well-known place 0.6-3.2 km from here with a kerb to stop at. */
  const chooseDestination = (): boolean => {
    const car = vehicle().car;
    const order = places.map((_, i) => i).sort(() => rnd() - 0.5);
    for (const i of order) {
      const p = places[i];
      if (p.kerb === undefined) p.kerb = resolve(p);
      if (!p.kerb) continue;
      const d = Math.hypot(p.kerb.x - car.pos.x, p.kerb.z - car.pos.z);
      if (d < 600 || d > 3200) continue;
      const label = lang() === 'zh' ? p.zh : p.en;
      dest = { x: p.kerb.x, z: p.kerb.z, label };
      const r = nav()?.route(car.pos.x, car.pos.z, Math.atan2(car.fwd.x, car.fwd.z), dest.x, dest.z);
      tripLen = r?.len ?? d * 1.35;
      limit = tripLen / 11 + 35; elapsed = 0; crashes = 0;
      nav()?.setTarget({ x: dest.x, z: dest.z, kind: 'mission', label });
      marker.show(dest.x, dest.z, '#ffc21f');
      const say = (['taxi.say1', 'taxi.say2', 'taxi.say3'] as const)[Math.floor(rnd() * 3)];
      toast(t(say, { place: label }));
      return true;
    }
    return false;
  };

  engine.events.on('vehicle:impact', (e) => {
    if (stage !== 'ride' || e.strength < 3) return;
    crashes++;
    if (careT <= 0) { toast(t('taxi.careful')); careT = 6; }
  });
  engine.events.on('vehicle:reset', () => { if (stage !== 'off' && stage !== 'wait') { client.visible = false; client.walkT = client.walkDur; end(null, 4); } });

  const tmp = new THREE.Vector3(), door = new THREE.Vector3();
  const api: MissionSystem = {
    name: 'missions',
    get cash() { return cash; },
    addCash(n) { cash = Math.max(0, cash + Math.round(n)); saveCash(); if (n > 0) hud.earned(Math.round(n)); },
    get objective() { return objective; },
    debug: {
      startFare: () => { stage = 'wait'; return startFare(); },
      state: () => ({ stage, pickup: pickup && stage !== 'ride' ? { x: client.pos.x, z: client.pos.z } : null, dest, limit, elapsed }),
    },
    fixedUpdate(dt) {
      const v = vehicle(), car = v.car;
      careT -= dt;
      // The client's walk is gameplay (boarding ends when they reach the door): stepped here, drawn in update.
      client.prev.copy(client.pos);
      if (client.visible) {
        if (client.walkT < client.walkDur) {
          client.walkT = Math.min(client.walkDur, client.walkT + dt);
          client.pos.lerpVectors(client.from, client.to, client.walkT / client.walkDur);
          client.speed = 1.5;
        } else { client.speed = 0; if (stage === 'alight') client.walkT += dt; }
      }
      const wanted = (engine.get<WantedApi>('wanted')?.level ?? 0) > 0;
      if (!v.inputEnabled) return;
      switch (stage) {
        case 'off':
          if (inTaxi()) { stage = 'wait'; timer = 4; }
          break;
        case 'wait':
          if (!inTaxi() && pl.mode === 'driving') { stage = 'off'; break; }
          timer -= dt;
          if (timer <= 0 && inTaxi() && !wanted && !engine.get<RaceApi>('races')?.active && !startFare()) timer = 3;
          break;
        case 'pickup': {
          timer -= dt;
          if (timer <= 0) { end(t('taxi.gone')); break; }
          if (pl.mode === 'driving' && !v.look.taxi) { end(null, 2); break; }
          const d = Math.hypot(car.pos.x - client.pos.x, car.pos.z - client.pos.z);
          if (pl.mode === 'driving' && d < 8 && car.speed < 2.5) {
            // Walk to the rear door on the kerb side.
            const side = Math.sign((client.pos.x - car.pos.x) * car.left.x + (client.pos.z - car.pos.z) * car.left.z) || 1;
            door.copy(car.pos).addScaledVector(car.left, side * 1.15).addScaledVector(car.fwd, -0.45); door.y = client.pos.y;
            walk(client.pos, door);
            stage = 'boarding';
            objective = t('taxi.boarding');
          }
          break;
        }
        case 'boarding':
          if (car.speed > 3 || pl.mode !== 'driving') { client.walkT = client.walkDur; stage = 'pickup'; objective = t('taxi.pickup'); break; }
          if (client.walkT >= client.walkDur) {
            client.visible = false;
            if (!chooseDestination()) { end(null, 3); break; }
            stage = 'ride';
          }
          break;
        case 'ride': {
          elapsed += dt;
          if (wanted) { end(t('taxi.scared')); break; }
          if (pl.mode !== 'driving' || !v.look.taxi) { end(t('taxi.left')); break; }
          if (elapsed > limit + 30) { end(t('taxi.late')); break; }
          objective = `${t('taxi.to', { place: dest!.label })}  ·  ${fmt(limit - elapsed)}`;
          if (Math.hypot(car.pos.x - dest!.x, car.pos.z - dest!.z) < 12 && car.speed < 2) {
            const km = tripLen / 1000, base = fare(km);
            const bonus = elapsed < limit ? Math.round(base * 0.5 * (1 - elapsed / limit)) : 0;
            const tip = Math.max(0, Math.round(4 + rnd() * 8 - crashes * 3)) + bonus;
            api.addCash(base + tip);
            toast(t('taxi.paid', { fare: base, tip }));
            // Out on the kerb side and onto the pavement.
            const side = Math.sign((dest!.x - car.pos.x) * car.left.x + (dest!.z - car.pos.z) * car.left.z) || 1;
            tmp.copy(car.pos).addScaledVector(car.left, side * 1.15).addScaledVector(car.fwd, -0.45); tmp.y = 0.045;
            door.set(dest!.x, 0.045, dest!.z).addScaledVector(tmp.clone().sub(car.pos).setY(0).normalize(), 1.5);
            client.visible = true; client.pos.copy(tmp); client.prev.copy(tmp);
            walk(tmp, door);
            stage = 'alight'; objective = null;
            nav()?.clearTarget('mission'); marker.hide();
          }
          break;
        }
        case 'alight':
          if (client.walkT >= client.walkDur + 1.2) { client.visible = false; stage = 'wait'; timer = 5 + rnd() * 5; }
          break;
      }
    },
    update(dt, alpha) {
      marker.update(dt);
      // Blips on the minimap once navigation exists.
      const n = nav();
      if (n && !blipsOn) {
        blipsOn = true;
        n.addBlips(() => {
          blips.length = 0;
          if ((stage === 'pickup' || stage === 'boarding') && pickup) blips.push({ kind: 'pickup', x: client.pos.x, z: client.pos.z });
          else if (stage === 'ride' && dest) blips.push({ kind: 'dropoff', x: dest.x, z: dest.z, label: dest.label });
          return blips;
        });
      }
      if (client.visible) {
        client.gait.update({ speed: client.speed, action: 'move', t: 0 }, dt, 0.7);
        client.draw.lerpVectors(client.prev, client.pos, alpha);
        pl.crowd.add(client.draw, client.yaw, client.gait, client.look);
      }
      hud.update(dt, cash, objective);
    },
  };
  engine.add(api);
}
