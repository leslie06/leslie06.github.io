import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { lang, t } from '../core/I18n';
import { Rng } from '../core/Rng';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi, RaceApi, VehicleApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import { CarKit } from '../traffic/CarKit';
import { ControlFilter, type DriveInput } from '../vehicle/ControlFilter';
import { TAXI, type VehicleSpec } from '../vehicle/Spec';
import { Vehicle } from '../vehicle/Vehicle';
import { Pursuit } from '../police/Pursuit';
import { Marker } from '../missions/Marker';
import { Banner } from '../ui/Banner';

/** Rivals: the taxi chassis with a tuned engine. */
const RACER: VehicleSpec = { ...TAXI, engine: { ...TAXI.engine, torque: TAXI.engine.torque.map(([r, n]) => [r, n * 1.3] as [number, number]), limiterKmh: 220 } };
const RIVALS = 3;
const PRIZE = [300, 120, 50, 0];
const LENGTH = 2400, CP_EVERY = 300;
const COLORS = ['#c8102e', '#1d1f22', '#2a5bd7'].map((c) => new THREE.Color(c));
const STOP: DriveInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: true };
/** Start lines on big roads, found by their OSM street names. */
const STARTS = [
  { road: '建国门外大街', zh: '建国门外大街', en: 'Jianguomenwai Avenue' },
  { road: '东三环中路', zh: '东三环中路', en: 'East 3rd Ring Road' },
  { road: '崇文门外大街', zh: '崇文门外大街', en: 'Chongwenmenwai Street' },
  { road: '广渠门内大街', zh: '广渠门内大街', en: 'Guangqumennei Street' },
];

interface Rival {
  car: Vehicle; driver: Pursuit; filter: ControlFilter; active: boolean;
  prevPos: THREE.Vector3; curPos: THREE.Vector3; prevQuat: THREE.Quaternion; curQuat: THREE.Quaternion;
  path: Float32Array; pathLen: number; s: number; hint: number; finished: number;
}

export interface RaceSystem extends RaceApi {
  debug: { start(i: number): boolean; state(): { stage: string; next: number; checkpoints: { x: number; z: number }[]; place: number } };
}

/**
 * Street races. Stop in a start marker (on the map as a blip) and three rivals line up; after a
 * 3-2-1 the race runs ~2.4 km along real streets with checkpoints every 300 m, traffic and all.
 * Rivals follow their own lane with the police pursuit driver, rubber-banded to keep it close.
 * Prize money by place. Getting out, wrecking the car or leaving the course abandons the race.
 */
export async function install(engine: Engine): Promise<void> {
  const tr = engine.get<TrafficApi>('traffic');
  const pl = engine.get<PlayerApi>('player');
  if (!tr || !pl) return;
  const g = tr.graph;
  const rng = new Rng(4040);
  const rnd = () => rng.next();
  const kit = new CarKit(engine.scene, RIVALS);
  const marker = new Marker(engine.scene);
  const banner = new Banner();
  const rivals: Rival[] = Array.from({ length: RIVALS }, (_, i) => {
    const car = new Vehicle(engine.physics, RACER, { x: 0, y: -500 - i * 6, z: 0 }, 0);
    car.body.setEnabled(false);
    return { car, driver: new Pursuit(), filter: new ControlFilter(), active: false, prevPos: new THREE.Vector3(), curPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(), curQuat: new THREE.Quaternion(),
      path: new Float32Array(0), pathLen: 0, s: 0, hint: 0, finished: 0 };
  });
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  const drawPos = new THREE.Vector3(), drawQuat = new THREE.Quaternion();

  // Start spots: 30% along the longest multi-lane piece of each road.
  const spots = STARTS.map((st) => {
    let best = -1, bl = 0;
    for (const l of g.links) if (l.name === st.road && l.len > bl && l.lanes >= 2) { bl = l.len; best = l.id; }
    if (best < 0) return null;
    const l = g.links[best], s = l.len * 0.3;
    g.at(l, s, g.laneOffset(l, 0), at);
    return { link: best, s, x: at.x, z: at.z, name: st };
  }).filter((s): s is NonNullable<typeof s> => !!s);

  type Stage = 'idle' | 'countdown' | 'racing' | 'done';
  let stage: Stage = 'idle', clock = 0, raceT = 0, next = 0, finishers = 0, place = 0, offT = 0, hintCd = 0, doneT = 0;
  let ref = new Float32Array(0), refCum = new Float32Array(0), refLen = 0, playerS = 0, playerHint = 0;
  let cps: { x: number; z: number }[] = [];
  let blipsOn = false;
  const blips: Blip[] = [];
  const veh = () => engine.get<VehicleApi>('vehicle')!;
  const nav = () => engine.get<NavApi>('nav');
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;

  /** Links from the start, mostly straight on, for LENGTH metres. */
  const buildRoute = (link: number, s0: number) => {
    const seq: { id: number; a: number; b: number }[] = [];
    let id = link, total = 0, a = s0;
    for (let hop = 0; hop < 60; hop++) {
      const l = g.links[id], b = Math.min(l.len, a + (LENGTH - total));
      seq.push({ id, a, b });
      total += b - a;
      if (total >= LENGTH - 1) break;
      const nx = g.next(id, rnd);
      if (nx === id) break;
      id = nx; a = 0;
    }
    return seq;
  };
  /** The route along one lane, a point every 8 m, plus cumulative lengths. */
  const pathFor = (seq: { id: number; a: number; b: number }[], lane: number, from = 0) => {
    const pts: number[] = [];
    let skip = from;
    for (const sg of seq) {
      const l = g.links[sg.id], off = g.laneOffset(l, Math.min(lane, l.lanes - 1));
      for (let s = sg.a; s < sg.b; s += 8) {
        if (skip > 0) { skip -= 8; continue; }
        g.at(l, s, off, at); pts.push(at.x, at.z);
      }
    }
    const last = seq[seq.length - 1], ll = g.links[last.id];
    g.at(ll, last.b, g.laneOffset(ll, Math.min(lane, ll.lanes - 1)), at); pts.push(at.x, at.z);
    const p = Float32Array.from(pts), cum = new Float32Array(p.length / 2);
    for (let i = 1; i < cum.length; i++) cum[i] = cum[i - 1] + Math.hypot(p[i * 2] - p[i * 2 - 2], p[i * 2 + 1] - p[i * 2 - 1]);
    return { p, cum, len: cum[cum.length - 1] };
  };
  /** Arc length along the reference path nearest (x, z), searched around `hint` (a point index). */
  const progress = (x: number, z: number, hint: number): { s: number; i: number } => {
    let bi = hint, bd = Infinity;
    const n = ref.length / 2;
    for (let i = Math.max(0, hint - 20); i < Math.min(n, hint + 40); i++) {
      const d = (ref[i * 2] - x) ** 2 + (ref[i * 2 + 1] - z) ** 2;
      if (d < bd) { bd = d; bi = i; }
    }
    return { s: refCum[bi], i: bi };
  };

  const release = () => {
    for (const r of rivals) if (r.active) { r.active = false; r.car.body.setTranslation({ x: 0, y: -500, z: 0 }, false); r.car.body.setEnabled(false); }
    marker.hide(); nav()?.clearTarget('mission');
  };
  const abandon = (msg: string) => { toast(msg); stage = 'idle'; release(); banner.hide(); veh().inputEnabled = true; };

  const start = (i: number): boolean => {
    const sp = spots[i];
    if (!sp) return false;
    const seq = buildRoute(sp.link, sp.s);
    const r0 = pathFor(seq, 0);
    ref = r0.p; refCum = r0.cum; refLen = r0.len; playerHint = 0;
    cps = [];
    for (let d = CP_EVERY; d < refLen - CP_EVERY * 0.5; d += CP_EVERY) { const k = refCum.findIndex((c) => c >= d); cps.push({ x: ref[k * 2], z: ref[k * 2 + 1] }); }
    cps.push({ x: ref[ref.length - 2], z: ref[ref.length - 1] });
    // Grid: the player on pole in the inside lane, rivals beside and behind.
    const l = g.links[sp.link], lanes = Math.min(2, l.lanes);
    const slot = (k: number) => ({ lane: lanes > 1 ? k % 2 : 0, back: lanes > 1 ? Math.floor(k / 2) * 9 : k * 9 });
    const place0 = (k: number) => { const q = slot(k); g.at(l, Math.max(2, sp.s - q.back), g.laneOffset(l, q.lane), at); return { x: at.x, z: at.z, yaw: Math.atan2(at.dx, at.dz), lane: q.lane, back: q.back }; };
    const v = veh(), p0 = place0(0);
    v.reset({ x: p0.x, y: 0.03 + TAXI.wheelRadius + 0.08, z: p0.z }, p0.yaw);
    v.inputEnabled = false;
    rivals.forEach((r, k) => {
      const q = place0(k + 1);
      r.car.body.setEnabled(true);
      r.car.reset({ x: q.x, y: 0.03 + TAXI.wheelRadius + 0.08, z: q.z }, q.yaw);
      const rp = pathFor(seq, q.lane, 0);
      r.path = rp.p; r.pathLen = rp.len; r.s = 0; r.hint = 0; r.finished = 0;
      r.driver.reset(); r.filter.reset();
      r.prevPos.copy(r.car.pos); r.curPos.copy(r.car.pos); r.prevQuat.copy(r.car.quat); r.curQuat.copy(r.car.quat);
      r.active = true;
    });
    stage = 'countdown'; clock = 0; raceT = 0; next = 0; finishers = 0; place = 0; offT = 0;
    nav()?.setTarget({ x: cps[0].x, z: cps[0].z, kind: 'mission', label: t('race.label') });
    marker.show(cps[0].x, cps[0].z, '#ffc21f');
    return true;
  };

  const api: RaceSystem = {
    name: 'races',
    get active() { return stage === 'countdown' || stage === 'racing'; },
    debug: { start, state: () => ({ stage, next, checkpoints: cps, place }) },
    fixedUpdate(dt) {
      const v = veh(), car = v.car;
      hintCd -= dt;
      if (stage === 'idle') {
        const busy = !!engine.get<MissionApi>('missions')?.objective;
        if (busy || pl.mode !== 'driving' || !v.inputEnabled) return;
        for (let i = 0; i < spots.length; i++) {
          const d = Math.hypot(spots[i].x - car.pos.x, spots[i].z - car.pos.z);
          if (d < 60 && hintCd <= 0) { toast(t('race.hint')); hintCd = 30; }
          if (d < 7 && car.speed < 6) { start(i); return; }
        }
        return;
      }
      if (stage === 'done') { doneT -= dt; if (doneT <= 0) { stage = 'idle'; release(); } }
      clock += dt;
      if (stage === 'countdown') {
        const n = 3 - Math.floor(clock);
        banner.show(n > 0 ? String(n) : t('race.go'), n > 0 ? '#f4f4f1' : '#ffc21f');
        if (clock >= 3) { stage = 'racing'; v.inputEnabled = true; }
      }
      if (stage === 'racing') {
        raceT += dt;
        if (clock > 4) banner.hide();
        const pr = progress(car.pos.x, car.pos.z, playerHint); playerS = pr.s; playerHint = pr.i;
        if (Math.hypot(car.pos.x - cps[next].x, car.pos.z - cps[next].z) < 16) {
          next++;
          if (next >= cps.length) {
            place = finishers + 1;
            const prize = PRIZE[place - 1] ?? 0;
            if (prize) engine.get<MissionApi>('missions')?.addCash(prize);
            toast(t('race.finish', { place, prize, time: fmt(raceT) }));
            banner.show(lang() === 'zh' ? `第${place}名` : `P${place}`, place === 1 ? '#ffc21f' : '#f4f4f1');
            stage = 'done'; doneT = 3; clock = 0;
            marker.hide(); nav()?.clearTarget('mission');
          } else {
            nav()?.setTarget({ x: cps[next].x, z: cps[next].z, kind: 'mission', label: t('race.label') });
            marker.show(cps[next].x, cps[next].z, next === cps.length - 1 ? '#f4f4f1' : '#ffc21f');
          }
        }
        if (stage === 'racing') {
          const off = Math.hypot(car.pos.x - cps[next].x, car.pos.z - cps[next].z) > CP_EVERY + 250;
          offT = pl.mode !== 'driving' || v.power <= 0 || off ? offT + dt : 0;
          if (offT > 6) abandon(t('race.fail'));
        }
      }
      // Rivals: hold on the grid, then race their lane, faster when behind the player and easing when well ahead.
      for (const r of rivals) {
        if (!r.active) continue;
        r.prevPos.copy(r.curPos); r.prevQuat.copy(r.curQuat);
        let inp: DriveInput = STOP;
        if (stage === 'racing' && !r.finished) {
          const pr = progress(r.car.pos.x, r.car.pos.z, r.hint); r.s = pr.s; r.hint = pr.i;
          r.driver.topSpeed = Math.max(22, Math.min(40, 31 + (playerS - r.s) * 0.04));
          const end = { x: r.path[r.path.length - 2], z: r.path[r.path.length - 1], vx: 0, vz: 0 };
          inp = r.driver.update(r.car, end, false, dt, () => ({ pts: r.path, len: r.pathLen }), false);
          if (r.s >= refLen - 12) r.finished = ++finishers;
        }
        r.car.step(r.filter.update(inp, r.car.forwardSpeed, dt), dt);
      }
    },
    postStep(dt) {
      for (const r of rivals) {
        if (!r.active) continue;
        r.car.afterStep(dt);
        r.curPos.copy(r.car.pos); r.curQuat.copy(r.car.quat);
      }
    },
    update(dt, alpha) {
      marker.update(dt);
      const n = nav();
      if (n && !blipsOn) {
        blipsOn = true;
        n.addBlips(() => {
          blips.length = 0;
          if (stage === 'idle' && !engine.get<MissionApi>('missions')?.objective) for (const sp of spots) blips.push({ kind: 'target', x: sp.x, z: sp.z, label: t('race.label') });
          return blips;
        });
      }
      // The nearest start line glows while roaming.
      if (stage === 'idle') {
        const car = veh().car;
        let best = -1, bd = 250;
        for (let i = 0; i < spots.length; i++) { const d = Math.hypot(spots[i].x - car.pos.x, spots[i].z - car.pos.z); if (d < bd) { bd = d; best = i; } }
        const busy = !!engine.get<MissionApi>('missions')?.objective;
        if (best >= 0 && !busy) marker.show(spots[best].x, spots[best].z, '#e8413a'); else marker.hide();
      }
      let k = 0;
      const pos = drawPos, quat = drawQuat;
      rivals.forEach((r, i) => {
        if (!r.active) return;
        pos.lerpVectors(r.prevPos, r.curPos, alpha); quat.slerpQuaternions(r.prevQuat, r.curQuat, alpha);
        kit.set(k++, pos, quat, r.car, COLORS[i], COLORS[i], false);
      });
      kit.commit(k);
      if (stage === 'racing') {
        const rank = 1 + rivals.filter((r) => r.active && (r.finished > 0 || r.s > playerS)).length;
        objective = t('race.status', { cp: next, n: cps.length, pos: rank, of: RIVALS + 1, time: fmt(raceT) });
      } else objective = null;
      hud(objective);
    },
  };

  // Objective line: shares the mission HUD's slot (top-centre) through its own element.
  let objective: string | null = null, objEl: HTMLDivElement | null = null, shown: string | null = '';
  const hud = (text: string | null) => {
    if (!objEl) {
      const root = document.querySelector('.hud');
      if (!root) return;
      objEl = document.createElement('div');
      objEl.className = 'objective race';
      root.appendChild(objEl);
    }
    if (text !== shown) { shown = text; objEl.hidden = !text; objEl.textContent = text ?? ''; }
  };
  engine.add(api);
}
