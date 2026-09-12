import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { Rng } from '../core/Rng';
import type { PeopleApi, PlayerApi, VehicleApi, WantedApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import type { Link } from '../traffic/LaneGraph';
import type { Vehicle } from '../vehicle/Vehicle';
import { Gait, type Action } from '../character/Animator';
import { randomLook, type Look } from '../character/Body';
import { CROWD_CAP } from '../character/Crowd';

import { SIDEWALK } from './Pavement';
const GROUND = 0.045;
/** Longest walk across a junction. Wider roads are not crossed at street level (Beijing has underpasses). */
const MAX_CROSS = 30;
/** Spawn and despawn distances from the camera: people further than ~100 m are a few pixels tall. */
const SPAWN_R = 100, DESPAWN_R = 125;
const RUN = 4.3;

type Mode = 'walk' | 'wait' | 'flee' | 'knocked' | 'down' | 'getup' | 'lost';

interface Ped {
  on: boolean;
  mode: Mode;
  /** Seconds in the current mode, and how long it may last (wait, down, lost). */
  t: number; hold: number;
  fear: number;
  /** On the pavement of `link`: arc length, side of the road (+1 left of the link), place across the pavement (0 kerb .. 1 wall). */
  link: number; s: number; side: number; frac: number; fracT: number; dir: number;
  /** Walking a straight line (a crossing, or back to the pavement), `road` when it is on the carriageway. */
  cross: boolean; road: boolean; c0x: number; c0z: number; c1x: number; c1z: number; cl: number; ct: number;
  /** Signalised junction and phase this crossing waits for (-1: just looking both ways). */
  waitJ: number; waitPhase: number;
  pos: THREE.Vector3; prev: THREE.Vector3; vel: THREE.Vector3; vy: number;
  yaw: number; want: number; pace: number; cur: number; moved: number;
  gait: Gait; look: Look; seed: number;
}

const wrap = (a: number) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/**
 * Pedestrians on the pavements of the drivable network, spawned around the camera. They walk the
 * pavement lines, cross at junctions (with the parallel green at signalised ones), idle, run from
 * fast cars and horns, and get knocked flying by cars (then lie, get up and run). Kinematic: no
 * Rapier bodies, only a ray to stop a flying body at walls. Drawn through the player's crowd.
 * Emits `people:hit` { x, z, speed, byPlayer } for the wanted level.
 */
export async function install(engine: Engine): Promise<void> {
  const tr = engine.get<TrafficApi>('traffic');
  const pl = engine.get<PlayerApi>('player');
  if (!tr || !pl) return;
  const g = tr.graph, sig = tr.signals;
  // The crowd also draws the player and a taxi fare.
  const cap = new URLSearchParams(location.search).has('nopeople') ? 0 : CROWD_CAP[engine.quality.tier] - 2;
  const rng = new Rng(9001);
  const rnd = () => rng.next();
  const wallGroups = groups(CG.PED, CG.WORLD);

  // Links ending at each node (LaneGraph keeps the ones leaving it).
  const inn: number[][] = g.out.map(() => []);
  for (const l of g.links) inn[l.to].push(l.id);
  const walkW = (l: Link) => SIDEWALK[l.cls] ?? 0;
  const edgeOf = (id: number) => { const r = g.links[id].rev; return r >= 0 ? Math.min(id, r) : id; };
  /** How far short of `node` the pavement of `l` stops: the widest other road there plus the kerb; 0 where the road just continues. */
  const kerbAt = (l: Link, node: number): number => {
    const mine = edgeOf(l.id);
    let hw = 0, first = -1, many = false;
    const look = (c: number) => {
      const e = edgeOf(c);
      if (e === mine) return;
      if (first < 0) first = e; else if (e !== first) many = true;
      hw = Math.max(hw, g.links[c].hw);
    };
    for (const c of g.out[node]) look(c);
    for (const c of inn[node]) look(c);
    return many ? hw + 1.2 : 0;
  };
  const kerb = new Float32Array(g.links.length * 2).fill(-1);
  const span = { a: 0, b: 0, ka: 0, kb: 0 };
  const spanOf = (l: Link) => {
    if (kerb[l.id * 2] < 0) { kerb[l.id * 2] = kerbAt(l, l.from); kerb[l.id * 2 + 1] = kerbAt(l, l.to); }
    let a = kerb[l.id * 2], b = l.len - kerb[l.id * 2 + 1];
    if (a > b) a = b = l.len / 2;
    span.a = a; span.b = b; span.ka = kerb[l.id * 2]; span.kb = kerb[l.id * 2 + 1];
    return span;
  };
  const offOf = (l: Link, p: Ped) => p.side * (l.hw + p.frac * walkW(l));

  const peds: Ped[] = Array.from({ length: cap }, () => ({
    on: false, mode: 'walk' as Mode, t: 0, hold: 0, fear: 0,
    link: 0, s: 0, side: 1, frac: 0.5, fracT: 0.5, dir: 1,
    cross: false, road: false, c0x: 0, c0z: 0, c1x: 0, c1z: 0, cl: 1, ct: 0,
    waitJ: -1, waitPhase: 0,
    pos: new THREE.Vector3(), prev: new THREE.Vector3(), vel: new THREE.Vector3(), vy: 0,
    yaw: 0, want: 0, pace: 1.3, cur: 1.3, moved: 0,
    gait: new Gait(), look: randomLook(rnd), seed: rnd(),
  }));
  let active = 0, spawnT = 0, frame = 0;
  const road: THREE.Vector3[] = [];
  const at = { x: 0, z: 0, dx: 0, dz: 0 }, at2 = { x: 0, z: 0, dx: 0, dz: 0 };
  const camDir = new THREE.Vector3(), draw = new THREE.Vector3();
  const vehicle = () => engine.get<VehicleApi>('vehicle')!;

  const place = (p: Ped) => {
    const l = g.links[p.link];
    g.at(l, p.s, offOf(l, p), at);
    p.pos.set(at.x, GROUND, at.z);
    p.want = Math.atan2(at.dx * p.dir, at.dz * p.dir);
  };

  /** End of the pavement: pick the next one at this node (short hops preferred) and walk over to it. */
  const arrive = (p: Ped) => {
    const l = g.links[p.link];
    const node = p.dir > 0 ? l.to : l.from;
    const sp = spanOf(l), atJunction = (p.dir > 0 ? sp.kb : sp.ka) > 0;
    g.at(l, p.s, offOf(l, p), at);
    const ex = at.x, ez = at.z, mine = edgeOf(l.id);
    let bestScore = -Infinity, bl = -1, bs = 0, bdir = 1, bside = 1, bx = 0, bz = 0, bd = 0;
    const tryLink = (c: number, dir: number) => {
      const o = g.links[c], w = walkW(o);
      if (!w || o.len < 4 || edgeOf(c) === mine) return;
      const so = spanOf(o), s = dir > 0 ? so.a : so.b;
      for (let k = 0; k < (o.oneway ? 1 : 2); k++) {
        const side = o.oneway || k === 1 ? -1 : 1;
        g.at(o, s, side * (o.hw + p.frac * w), at2);
        const d = Math.hypot(at2.x - ex, at2.z - ez);
        if (d > MAX_CROSS) continue;
        const score = -d * 0.1 + rnd() * 1.6;
        if (score > bestScore) { bestScore = score; bl = c; bs = s; bdir = dir; bside = side; bx = at2.x; bz = at2.z; bd = d; }
      }
    };
    for (const c of g.out[node]) tryLink(c, 1);
    for (const c of inn[node]) tryLink(c, -1);
    if (bl < 0) { p.dir = -p.dir; return; }   // dead end, or only roads too wide to cross: turn back
    p.link = bl; p.s = bs; p.dir = bdir; p.side = bside;
    if (bd < 1) return;
    p.cross = true; p.road = atJunction;
    p.c0x = ex; p.c0z = ez; p.c1x = bx; p.c1z = bz; p.cl = bd; p.ct = 0;
    if (!atJunction || p.mode !== 'walk') return;
    // At the kerb: wait for the green of the traffic running alongside, or look both ways.
    const j = sig.junctionOf(node);
    if (j >= 0) { p.mode = 'wait'; p.t = 0; p.hold = 40; p.waitJ = j; p.waitPhase = sig.phaseAlong(j, bx - ex, bz - ez); }
    else if (rnd() < 0.35) { p.mode = 'wait'; p.t = 0; p.hold = 0.5 + rnd() * 1.8; p.waitJ = -1; }
    p.want = Math.atan2(bx - ex, bz - ez);
  };

  /** Back to the nearest pavement after a fall; `lost` if there is none nearby. */
  const reattach = (p: Ped) => {
    let bd = 40, bl = -1, bs = 0, bside = 1;
    for (const id of g.near(p.pos.x, p.pos.z, 40)) {
      const l = g.links[id], w = walkW(l);
      if (!w || (l.rev >= 0 && l.rev < id)) continue;
      for (let k = 1; k < l.cum.length; k++) {
        const ax = l.pts[k * 2 - 2], az = l.pts[k * 2 - 1], vx = l.pts[k * 2] - ax, vz = l.pts[k * 2 + 1] - az;
        const L2 = vx * vx + vz * vz || 1, L = Math.sqrt(L2);
        const u = Math.max(0, Math.min(1, ((p.pos.x - ax) * vx + (p.pos.z - az) * vz) / L2));
        const cx = ax + vx * u, cz = az + vz * u;
        const lat = ((p.pos.x - cx) * vz - (p.pos.z - cz) * vx) / L;
        const side = l.oneway ? -1 : lat >= 0 ? 1 : -1;
        const s = l.cum[k - 1] + u * L;
        g.at(l, s, side * (l.hw + p.frac * w), at2);
        const d = Math.hypot(at2.x - p.pos.x, at2.z - p.pos.z);
        if (d < bd) { bd = d; bl = id; bs = s; bside = side; }
      }
    }
    if (bl < 0) { p.mode = 'lost'; p.t = 0; p.hold = 20; return; }
    const l = g.links[bl], sp = spanOf(l);
    p.link = bl; p.s = Math.max(sp.a, Math.min(sp.b, bs)); p.side = bside; p.dir = rnd() < 0.5 ? 1 : -1;
    g.at(l, p.s, offOf(l, p), at2);
    p.cross = true; p.road = true; p.c0x = p.pos.x; p.c0z = p.pos.z; p.c1x = at2.x; p.c1z = at2.z;
    p.cl = Math.max(0.05, Math.hypot(at2.x - p.pos.x, at2.z - p.pos.z)); p.ct = 0;
    p.mode = 'flee'; p.fear = 4 + rnd() * 3; p.cur = 0; p.pos.y = GROUND;
  };

  const calm = (p: Ped) => p.mode === 'walk' || p.mode === 'wait' || p.mode === 'flee';

  /** Run from a threat at (fx, fz): along the pavement away from it (or on across the road). */
  const scare = (p: Ped, fx: number, fz: number, secs: number) => {
    if (!calm(p)) return;
    if (p.mode !== 'flee' && !p.cross) {
      g.at(g.links[p.link], p.s, 0, at2);
      p.dir = (p.pos.x - fx) * at2.dx + (p.pos.z - fz) * at2.dz >= 0 ? 1 : -1;
      p.fracT = 0.92;   // away from the kerb
    }
    if (p.mode === 'wait' && !p.cross) p.mode = 'walk';
    p.mode = 'flee'; p.fear = Math.max(p.fear, secs);
  };

  const knock = (p: Ped, vx: number, vz: number, byPlayer: boolean) => {
    const speed = Math.hypot(vx, vz);
    p.mode = 'knocked'; p.t = 0; p.cross = false;
    p.vel.set(vx, 0, vz); p.vy = Math.max(2.2, speed * 0.3);
    p.want = p.yaw = Math.atan2(-vx, -vz);   // face what hit them, fly backwards
    engine.events.emit('people:hit', { x: p.pos.x, z: p.pos.z, speed, byPlayer });
    for (const q of peds) {
      if (!q.on || q === p) continue;
      const dx = q.pos.x - p.pos.x, dz = q.pos.z - p.pos.z;
      if (dx * dx + dz * dz < 26 * 26) scare(q, p.pos.x, p.pos.z, 4 + rnd() * 3);
    }
  };

  /** Cars sweep people out of their footprint. */
  const carHits = (car: Vehicle, byPlayer: boolean) => {
    if (car.speed < 2.5) return;
    for (const p of peds) {
      if (!p.on || p.mode === 'knocked') continue;
      const dx = p.pos.x - car.pos.x, dz = p.pos.z - car.pos.z;
      if (dx * dx + dz * dz > 9) continue;
      const lx = dx * car.left.x + dz * car.left.z, lz = dx * car.fwd.x + dz * car.fwd.z, dy = p.pos.y - car.pos.y;
      if (Math.abs(lx) > 1.1 || Math.abs(lz) > 2.45 || dy < -1.6 || dy > 1) continue;
      if ((p.mode === 'down' || p.mode === 'getup') && car.speed < 4) continue;
      const side = Math.sign(lx) || 1;
      knock(p, car.vel.x * 0.85 + car.left.x * side * 2.2, car.vel.z * 0.85 + car.left.z * side * 2.2, byPlayer);
      if (byPlayer) {
        // A person weighs something: the car loses a little speed and the player feels it.
        const m = 55;
        car.body.applyImpulse({ x: -car.vel.x * m, y: 0, z: -car.vel.z * m }, true);
        engine.events.emit('vehicle:impact', { strength: Math.min(4, car.speed * 0.22), point: [p.pos.x, p.pos.y + 1, p.pos.z] });
      }
    }
  };

  const trySpawn = (burst: boolean) => {
    const p = peds.find((q) => !q.on);
    if (!p) return;
    const cam = engine.camera.position;
    const ids = g.near(cam.x, cam.z, SPAWN_R);
    if (!ids.length) return;
    for (let attempt = 0; attempt < 8; attempt++) {
      const l = g.links[ids[Math.floor(rnd() * ids.length)]];
      const w = walkW(l);
      if (!w || l.len < 8 || (l.rev >= 0 && l.rev < l.id)) continue;
      if (rnd() > w / 4.5) continue;   // busier on the big roads
      const sp = spanOf(l);
      p.link = l.id; p.s = sp.a + rnd() * (sp.b - sp.a);
      p.side = l.oneway ? -1 : rnd() < 0.5 ? 1 : -1; p.dir = rnd() < 0.5 ? 1 : -1;
      p.frac = p.fracT = 0.15 + rnd() * 0.7;
      g.at(l, p.s, offOf(l, p), at);
      const dx = at.x - cam.x, dz = at.z - cam.z, d = Math.hypot(dx, dz);
      if (d < 12 || d > SPAWN_R) continue;
      engine.camera.getWorldDirection(camDir);
      if (!burst && d < 55 && (dx * camDir.x + dz * camDir.z) / d > 0.25) continue;   // no popping in view up close
      p.on = true; p.mode = 'walk'; p.t = 0; p.fear = 0; p.cross = false; p.road = false;
      p.pace = 1.05 + rnd() * 0.55; p.cur = p.pace; p.moved = p.pace;
      place(p); p.prev.copy(p.pos); p.yaw = p.want;
      const nl = randomLook(rnd); p.look = nl; p.seed = rnd();
      active++;
      return;
    }
  };
  const despawn = (p: Ped) => { p.on = false; active--; };

  const stepPed = (p: Ped, dt: number) => {
    p.t += dt;
    if (p.mode === 'knocked' || p.mode === 'down' || p.mode === 'getup') {
      const hs = Math.hypot(p.vel.x, p.vel.z);
      if (hs > 0.3) {
        const hit = engine.physics.raycast({ x: p.pos.x, y: p.pos.y + 0.7, z: p.pos.z }, { x: p.vel.x / hs, y: 0, z: p.vel.z / hs }, hs * dt + 0.35, wallGroups, true);
        if (hit) p.vel.multiplyScalar(-0.15);
      }
      p.pos.x += p.vel.x * dt; p.pos.z += p.vel.z * dt; p.pos.y += p.vy * dt; p.vy -= 9.81 * dt;
      let grounded = false;
      if (p.pos.y <= GROUND) { p.pos.y = GROUND; grounded = true; p.vy = p.vy < -3 ? -p.vy * 0.25 : 0; p.vel.multiplyScalar(Math.exp(-dt * 5)); }
      if (p.mode === 'knocked' && p.t > 0.45 && grounded && p.vy === 0 && hs < 2.5) { p.mode = 'down'; p.t = 0; p.hold = 1.8 + rnd() * 2.5; }
      else if (p.mode === 'down') { p.vel.multiplyScalar(Math.exp(-dt * 8)); if (p.t > p.hold) { p.mode = 'getup'; p.t = 0; } }
      else if (p.mode === 'getup' && p.t > 0.9) reattach(p);
      p.moved = 0;
      return;
    }
    if (p.mode === 'lost') { p.moved = 0; return; }
    if (p.mode === 'wait') {
      p.moved = 0; p.cur = 0;
      const go = p.waitJ >= 0 ? sig.greenLeft(p.waitJ, p.waitPhase, tr.time) > 7 : false;
      if (go || p.t > p.hold) { p.mode = 'walk'; p.t = 0; }
      return;
    }
    if (p.mode === 'flee') { p.fear -= dt; if (p.fear <= 0) { p.mode = 'walk'; p.t = 0; p.fracT = 0.15 + rnd() * 0.7; } }
    else if (!p.cross && rnd() < dt * 0.012) { p.mode = 'wait'; p.t = 0; p.hold = 1.5 + rnd() * 3.5; p.waitJ = -1; return; }
    const target = p.mode === 'flee' ? RUN : p.cross ? p.pace * 1.15 : p.pace;
    p.cur += (target - p.cur) * (1 - Math.exp(-dt * 3));
    p.frac += Math.max(-dt * 0.8, Math.min(dt * 0.8, p.fracT - p.frac));
    const adv = p.cur * dt;
    if (p.cross) {
      p.ct += adv;
      const k = Math.min(1, p.ct / p.cl);
      p.pos.set(p.c0x + (p.c1x - p.c0x) * k, GROUND, p.c0z + (p.c1z - p.c0z) * k);
      p.want = Math.atan2(p.c1x - p.c0x, p.c1z - p.c0z);
      if (k >= 1) p.cross = false;
    } else {
      const sp = spanOf(g.links[p.link]);
      p.s += adv * p.dir;
      if (p.dir > 0 ? p.s >= sp.b : p.s <= sp.a) { p.s = p.dir > 0 ? sp.b : sp.a; arrive(p); }
      if (!p.cross) place(p);
    }
    // arrive() may have stopped them at a kerb.
    p.moved = (p.mode as Mode) === 'wait' ? 0 : p.cur;
  };

  const api: PeopleApi & { debug: { knocked(): number; nearest(x: number, z: number, r: number): { x: number; z: number } | null } } = {
    name: 'people',
    get count() { return active; },
    inRoad: () => road,
    debug: {
      knocked: () => peds.reduce((n, p) => n + (p.on && !calm(p) ? 1 : 0), 0),
      nearest: (x: number, z: number, r: number) => {
        let best: Ped | null = null, bd = r;
        for (const p of peds) { if (!p.on) continue; const d = Math.hypot(p.pos.x - x, p.pos.z - z); if (d < bd) { bd = d; best = p; } }
        return best ? { x: best.pos.x, z: best.pos.z } : null;
      },
    },
    shove(x, z, dirX, dirZ) {
      let best: Ped | null = null, bd = 2.2;
      for (const p of peds) {
        if (!p.on || !calm(p)) continue;
        const ex = p.pos.x - x, ez = p.pos.z - z, d = Math.hypot(ex, ez);
        if (d > bd) continue;
        if ((ex * dirX + ez * dirZ) / (d || 1) < 0.2) continue;   // has to be roughly in front
        bd = d; best = p;
      }
      if (!best) return false;
      knock(best, dirX * 4.6, dirZ * 4.6, true);
      return true;
    },
    spawnFleeing(x, z) {
      let p = peds.find((q) => !q.on);
      if (p) active++;
      else {
        // Full: reuse whoever is furthest from the camera.
        const cam = engine.camera.position;
        let bd = -1;
        for (const q of peds) { const d = Math.hypot(q.pos.x - cam.x, q.pos.z - cam.z); if (d > bd) { bd = d; p = q; } }
      }
      if (!p) return;
      p.on = true; p.mode = 'getup'; p.t = 0; p.cross = false; p.fear = 0;
      p.pos.set(x, GROUND, z); p.prev.copy(p.pos); p.vel.set(0, 0, 0); p.vy = 0;
      p.look = randomLook(rnd); p.seed = rnd(); p.pace = 1.2 + rnd() * 0.4; p.frac = p.fracT = 0.5;
    },
    fixedUpdate(dt) {
      if (!cap) return;
      frame++;
      spawnT -= dt;
      if (spawnT <= 0) { spawnT = 0.05; if (active < cap) trySpawn(active < cap * 0.35); }
      const v = vehicle(), pc = v.car;
      const horn = v.occupied && v.inputEnabled && engine.input.state.horn;
      const foot = pl.foot;
      const cam = engine.camera.position;
      engine.camera.getWorldDirection(camDir);
      road.length = 0;
      for (let i = 0; i < peds.length; i++) {
        const p = peds[i];
        if (!p.on) continue;
        p.prev.copy(p.pos);
        stepPed(p, dt);
        const cdx = p.pos.x - cam.x, cdz = p.pos.z - cam.z, cd = Math.hypot(cdx, cdz);
        if (cd > DESPAWN_R || (p.mode === 'lost' && (p.t > p.hold || (cdx * camDir.x + cdz * camDir.z) < 0))) { despawn(p); continue; }
        if ((p.cross && p.road) || p.mode === 'down' || p.mode === 'getup') road.push(p.pos);
        if (!calm(p)) continue;
        // Threats, a third of the crowd per step.
        if ((i + frame) % 3 === 0) {
          const dx = p.pos.x - pc.pos.x, dz = p.pos.z - pc.pos.z, d2 = dx * dx + dz * dz;
          if (v.occupied && pc.speed > 5 && d2 < 400) {
            const ahead = (dx * pc.vel.x + dz * pc.vel.z) / pc.speed, lat = Math.abs(dx * pc.vel.z - dz * pc.vel.x) / pc.speed;
            if (ahead > -2 && ahead < 5 + pc.speed * 0.8 && lat < 3.5) scare(p, pc.pos.x, pc.pos.z, 3 + rnd() * 2);
          }
          if (horn && d2 < 20 * 20) scare(p, pc.pos.x, pc.pos.z, 2 + rnd() * 2);
        }
        // Walking into someone only makes them step aside and stop for a moment; it takes a
        // deliberate shove (see `shove`) to put anyone on the ground.
        if (foot) {
          const dx = p.pos.x - foot.pos.x, dz = p.pos.z - foot.pos.z;
          if (dx * dx + dz * dz < 0.6 && !p.cross) {
            p.fracT = p.frac < 0.5 ? 0.92 : 0.08;
            if (p.mode === 'walk' && rnd() < dt * 1.5) { p.mode = 'wait'; p.t = 0; p.hold = 0.4 + rnd() * 0.6; p.waitJ = -1; }
          }
        }
      }
      carHits(pc, v.occupied);
      for (const c of tr.cars()) carHits(c, false);
      for (const c of engine.get<WantedApi>('wanted')?.policeCars() ?? []) carHits(c, false);
    },
    update(dt, alpha) {
      if (!cap) return;
      const cam = engine.camera.position;
      engine.camera.getWorldDirection(camDir);
      const crowd = pl.crowd;
      for (const p of peds) {
        if (!p.on) continue;
        p.yaw += wrap(p.want - p.yaw) * Math.min(1, dt * (p.mode === 'flee' ? 12 : 7));
        const dx = p.pos.x - cam.x, dz = p.pos.z - cam.z, d = Math.hypot(dx, dz);
        if (d > 8 && dx * camDir.x + dz * camDir.z < -0.2 * d) continue;   // behind the camera
        const action: Action = p.mode === 'knocked' || p.mode === 'down' || p.mode === 'getup' ? p.mode : 'move';
        p.gait.update({ speed: p.moved, action, t: p.t }, dt, p.seed);
        draw.lerpVectors(p.prev, p.pos, alpha);
        crowd.add(draw, p.yaw, p.gait, p.look);
      }
    },
  };
  engine.add(api);
}
