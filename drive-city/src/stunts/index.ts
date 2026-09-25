import type { Engine, System } from '../core/Engine';
import type { GameEvents } from '../core/Events';
import type { MissionApi, PlayerApi, VehicleApi, WantedApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import { STOP_LINE } from '../traffic/AiDriver';
import type { Link } from '../traffic/LaneGraph';
import type { Vehicle } from '../vehicle/Vehicle';
import { StuntHud } from './StuntHud';
import { installJumps } from './Jumps';
import { installShortcuts } from './Shortcuts';

export type StuntKind = GameEvents['stunt:event']['kind'];

/** Seconds to the next move before a combo banks. */
const WINDOW = 4;
/** Yuan per banked point (after the multiplier). */
const CASH_PER_POINT = 1 / 15;
/** Metres of daylight between the two bodies that still count as a near miss. */
const NEAR_GAP = 0.8;
/** A crash this hard (unexplained m/s in one step) loses the combo. */
const CRASH = 5;
/** A full nitro bottle takes this many seconds to refill on its own; moves refill it faster. */
const NITRO_REFILL = 90;

interface Half { hw: number; front: number; back: number }
interface Pass { gap: number; rel: number; hit: boolean; stamp: number }

export interface StuntApi extends System {
  /** The running combo: points before the multiplier, the multiplier, moves in it, seconds left. */
  readonly combo: { points: number; mult: number; count: number; timer: number };
  readonly best: number;
  /** A move scored from outside (a hutong shortcut): into the combo like any other. */
  score(kind: StuntKind, points: number): void;
  debug: { event(kind: StuntKind, points: number): void; wrongWay(): boolean; state(): { passes: { gap: number; rel: number; hit: boolean }[]; line: { link: number; toEnd: number } | null } };
}

/**
 * The street combo: near misses, drifts, jumps, driving into oncoming traffic, running red lights,
 * knocking street furniture flying and losing the police all score. Moves chained within WINDOW
 * seconds build a multiplier (x1 for the first two, x2 for the next two, up to x5); when the chain
 * runs out it banks as cash, and a hard crash loses it. Every move also tops up the nitro bottle.
 *
 * Near misses are read from the two bodies' footprints while they overlap along the player's
 * heading: the smallest gap between them, if the other car was passed without touching it at more
 * than 7 m/s of closing speed. Oncoming is measured against the lane graph (right-hand traffic):
 * on a two-way road, moving along a link on its left side; on a one-way, against it.
 */
export async function install(engine: Engine): Promise<void> {
  const tr = engine.get<TrafficApi>('traffic');
  const pl = engine.get<PlayerApi>('player');
  if (!tr || !pl) return;
  const g = tr.graph, sig = tr.signals;
  const hud = new StuntHud();
  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const halves = new WeakMap<object, Half>();
  const half = (car: Vehicle): Half => {
    let h = halves.get(car.spec);
    if (!h) {
      h = { hw: 0, front: -9, back: 9 };
      for (const c of car.spec.chassis) { h.hw = Math.max(h.hw, Math.abs(c.at[0]) + c.half[0]); h.front = Math.max(h.front, c.at[2] + c.half[2]); h.back = Math.min(h.back, c.at[2] - c.half[2]); }
      halves.set(car.spec, h);
    }
    return h;
  };

  const combo = { points: 0, mult: 1, count: 0, timer: 0 };
  let best = 0;
  try { best = Number(localStorage.getItem('drivecity.combo.best') ?? 0) || 0; } catch { /* private mode */ }
  const passes = new Map<Vehicle, Pass>();
  let stamp = 0, wrongT = 0, wrongOff = 0, wrongPts = 0, roadT = 0, wanted = 0;
  let line: { link: number; toEnd: number } | null = null;

  const driving = () => { const v = vehicle(); return v.occupied && v.inputEnabled && !v.autopilot && pl.mode === 'driving'; };

  const reset = () => { combo.points = 0; combo.mult = 1; combo.count = 0; combo.timer = 0; wrongT = 0; wrongPts = 0; hud.clearLive(); };
  const bank = () => {
    if (!combo.count) return;
    const total = Math.round(combo.points * combo.mult), cash = Math.round(total * CASH_PER_POINT);
    if (cash > 0) engine.get<MissionApi>('missions')?.addCash(cash);
    if (total > best) { best = total; try { localStorage.setItem('drivecity.combo.best', String(best)); } catch { /* ignore */ } }
    engine.events.emit('stunt:bank', { points: total, cash, lost: false });
    hud.bank(total, cash);
    reset();
  };
  const lose = () => {
    if (!combo.count) return;
    engine.events.emit('stunt:bank', { points: Math.round(combo.points * combo.mult), cash: 0, lost: true });
    hud.lost();
    reset();
  };

  const event = (kind: StuntKind, points: number) => {
    if (!driving() || points <= 0) return;
    combo.count++;
    combo.points += points;
    combo.mult = Math.min(5, 1 + Math.floor((combo.count - 1) / 2));
    combo.timer = WINDOW;
    const car = vehicle().car;
    if (car.tune.nitro > 0) car.nitroFill = Math.min(1, car.nitroFill + points / 800);
    hud.line(kind, points);
    engine.events.emit('stunt:event', { kind, points });
  };

  /** The nearest link segment to (x, z) among those passing within 24 m, and where the point is on it. */
  const seg = { l: null as Link | null, s: 0, lat: 0, d: Infinity, dx: 0, dz: 0 };
  const nearest = (x: number, z: number, keep: (l: Link, dx: number, dz: number) => boolean) => {
    seg.l = null; seg.d = Infinity;
    for (const id of g.near(x, z, 24)) {
      const l = g.links[id];
      for (let k = 1; k < l.cum.length; k++) {
        const ax = l.pts[k * 2 - 2], az = l.pts[k * 2 - 1], vx = l.pts[k * 2] - ax, vz = l.pts[k * 2 + 1] - az;
        const L = Math.hypot(vx, vz) || 1, dx = vx / L, dz = vz / L;
        if (!keep(l, dx, dz)) continue;
        const u = Math.max(0, Math.min(L, (x - ax) * dx + (z - az) * dz));
        const px = ax + dx * u, pz = az + dz * u, d = Math.hypot(x - px, z - pz);
        if (d < seg.d) { seg.l = l; seg.d = d; seg.s = l.cum[k - 1] + u; seg.dx = dx; seg.dz = dz; seg.lat = (x - px) * dz - (z - pz) * dx; }
      }
    }
    return seg.l;
  };

  /** On the wrong side of the road: into the oncoming lanes of a two-way road, or against a one-way. */
  const wrongWay = (): boolean => {
    const car = vehicle().car;
    if (car.speed < 8) return false;
    const vx = car.vel.x / car.speed, vz = car.vel.z / car.speed;
    const l = nearest(car.pos.x, car.pos.z, () => true);
    if (!l || seg.d > l.hw + 0.5) return false;
    const along = vx * seg.dx + vz * seg.dz;
    if (Math.abs(along) < 0.6) return false;   // across it, at a junction
    return l.oneway ? along < 0 : Math.sign(along) * seg.lat > 0.8;
  };

  engine.events.on('drift:end', ({ score, crashed }) => { if (!crashed && score >= 80) event('drift', Math.round(score * 0.5)); });
  engine.events.on('vehicle:land', ({ airTime }) => { if (airTime > 0.55) event('air', Math.round(80 * airTime + 60 * airTime * airTime)); });
  engine.events.on('prop:hit', ({ kind }) => event('smash', kind === 'rail' ? 25 : kind === 'bike' ? 15 : 20));
  engine.events.on('wanted:level', ({ level, up }) => {
    if (!up && level === 0 && wanted > 0) event('evade', 250 * wanted);
    wanted = level;
  });
  engine.events.on('vehicle:impact', ({ strength }) => {
    // Anything touched while alongside is not a near miss, and a real crash loses the chain.
    for (const p of passes.values()) p.hit = true;
    if (strength > CRASH && vehicle().occupied) lose();
  });
  engine.events.on('wanted:busted', () => lose());
  engine.events.on('player:mode', ({ mode }) => { if (mode === 'onfoot') bank(); });
  engine.events.on('vehicle:reset', () => { bank(); passes.clear(); line = null; });

  const api: StuntApi = {
    name: 'stunts',
    combo,
    get best() { return best; },
    score: (kind, points) => event(kind, points),
    debug: { event, wrongWay, state: () => ({ passes: [...passes.values()].map((p) => ({ gap: p.gap, rel: p.rel, hit: p.hit })), line }) },

    postStep(dt) {
      stamp++;
      const v = vehicle(), me = v.car;
      if (!driving()) { passes.clear(); line = null; wrongT = 0; return; }
      // Near misses: every other car within 12 m, tracked while it is alongside.
      const mh = half(me);
      const others = [tr.cars(), engine.get<WantedApi>('wanted')?.policeCars() ?? []];
      for (const list of others) for (const o of list) {
        if (o === me) continue;
        const dx = o.pos.x - me.pos.x, dz = o.pos.z - me.pos.z;
        let p = passes.get(o);
        if (dx * dx + dz * dz > 144) { if (p) passes.delete(o); continue; }
        const oh = half(o);
        const along = dx * me.fwd.x + dz * me.fwd.z, side = dx * me.left.x + dz * me.left.z;
        const c = Math.abs(o.fwd.x * me.fwd.x + o.fwd.z * me.fwd.z), sn = Math.sqrt(Math.max(0, 1 - c * c));
        const oLen = (oh.front - oh.back) / 2;
        const across = oh.hw * c + oLen * sn, len = oLen * c + oh.hw * sn;
        const overlap = along < mh.front + len && along > mh.back - len;
        const gap = Math.abs(side) - mh.hw - across;
        const rel = Math.hypot(me.vel.x - o.vel.x, me.vel.z - o.vel.z);
        if (overlap && gap < 2) {
          if (!p) { p = { gap, rel, hit: false, stamp }; passes.set(o, p); }
          p.gap = Math.min(p.gap, gap); p.rel = Math.max(p.rel, rel); p.stamp = stamp;
        } else if (p) {
          passes.delete(o);
          if (!p.hit && p.gap < NEAR_GAP && p.gap > -0.05 && p.rel > 6 && me.speed > 6) {
            const close = (NEAR_GAP - Math.max(0, p.gap)) / NEAR_GAP;
            event('near', Math.round((40 + 110 * close) * Math.min(2, p.rel / 15)));
          }
        }
      }
      for (const [o, p] of passes) if (p.stamp !== stamp) passes.delete(o);   // despawned

      // Oncoming and red lights, ten times a second.
      roadT -= dt;
      if (roadT <= 0) {
        roadT = 0.1;
        const wrong = wrongWay();
        if (wrong) { wrongT += 0.1; wrongOff = 0; }
        else if (wrongT > 0) { wrongOff += 0.1; if (wrongOff > 0.6) { if (wrongPts >= 10) event('oncoming', Math.round(wrongPts)); wrongT = 0; wrongPts = 0; hud.clearLive(); } }
        if (wrong && wrongT > 0.3) { wrongPts += 0.1 * (10 + me.speed * 1.5); combo.timer = Math.max(combo.timer, WINDOW); hud.live('oncoming', Math.round(wrongPts)); }
        // The stop line of the link the car is driving along, crossed on red.
        if (me.speed > 5) {
          const vx = me.vel.x / me.speed, vz = me.vel.z / me.speed;
          const l = nearest(me.pos.x, me.pos.z, (_l, dx, dz) => dx * vx + dz * vz > 0.7);
          if (l && seg.d < l.hw + 1) {
            const toEnd = l.len - seg.s;
            if (line && line.link === l.id && line.toEnd > STOP_LINE && toEnd <= STOP_LINE && sig.junctionOf(l.to) >= 0 && sig.state(l, tr.time) === 2) event('redlight', 60);
            line = { link: l.id, toEnd };
          } else line = null;
        } else line = null;
      }

      // The chain runs out (not while still driving against the traffic).
      if (combo.count > 0 && wrongT <= 0.3) { combo.timer -= dt; if (combo.timer <= 0) bank(); }
      // The bottle refills slowly on its own.
      if (me.tune.nitro > 0 && !v.nitroActive) me.nitroFill = Math.min(1, me.nitroFill + dt / NITRO_REFILL);
    },

    update(dt) {
      hud.update(dt, combo);
    },
  };
  engine.add(api);
  installJumps(engine);
  installShortcuts(engine);
}
