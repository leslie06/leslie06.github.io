import * as THREE from 'three';
import { t } from '../../core/I18n';
import { CG, groups } from '../../core/Physics';
import { Rng } from '../../core/Rng';
import type { Actor, Speaker } from '../../game/Contracts';
import { randomLook, type Look } from '../../character/Body';
import { castModel, CAST_ON } from '../../character/Cast';
import { clearOfWorld } from '../../life/Props';
import { Banner } from '../../ui/Banner';
import { ScriptCar } from '../Cars';
import { call, cutscene, drive, Gang, getIn, talk, wait, type Chapter, type Env, type Line, type V3 } from '../Kit';
import { fight } from '../Fight';
import type { Scope } from '../Runner';
import type { Livery } from '../../vehicle/CarModel';
import type { ParkingApi } from '../../parking';

/**
 * Chapter 2 《讨货》 (docs/gta-plan.md §6): 老K's truckload is held at Black Panther's car wash past the East 4th Ring,
 * on the 四惠 hub's south road at (7790, 450). Chen Ye drives there in 老K's car, fights the three at the door and the
 * four who come out, 豹哥 shows himself and sends the truck off west into town; Chen Ye catches it (three rams or boxed to a
 * stop), takes it, loses the two SUVs that come after it and delivers it to 大刘's garage, where the load turns out
 * to hold Panther's ledger. Checkpoints: getting in the car at the stall, each fight (on foot by the wash), the chase
 * (in 老K's car at the kerb) and the getaway (in the truck where it was taken).
 */
interface S {
  /** Where the truck was taken (the getaway's checkpoint puts it back there). */
  cp: { x: number; z: number; yaw: number } | null;
  ko: number;
  wrecked: number;
  stars: number;
}
export type M2 = Chapter<S>;

const K_LIVERY: Livery = { upper: '#111214', lower: '#111214', roofSign: null, plate: { text: '京A·K8888', bg: '#1d49b5', fg: '#ffffff' }, doorText: 'K', doorColor: '#f3b50f' };
const PANTHER: Livery = { upper: '#0b0b0c', lower: '#0b0b0c', roofSign: null, plate: { text: '京N·8B4T7', bg: '#1d49b5', fg: '#ffffff' }, doorText: '豹', doorColor: '#b8862b' };
const TRUCK: Livery = { upper: '#ecebe6', lower: '#ecebe6', roofSign: null, plate: { text: '京N·5H2P9', bg: '#d8b31c', fg: '#111111' }, doorText: '豹', doorColor: '#b8862b' };

/**
 * The car wash: a point on 四惠枢纽南路's centre line (it runs east a touch north, (7696, 463) to (7884, 438), one lane
 * each way; the lot is the open paving of the 四惠 hub on its north side, clear 1.5-11 m past the kerb from x 7710 to
 * 7870 - `.scratch/m2/site.mjs`), the way along it (east) and across it into the lot (north). The frame is fixed, not
 * taken from the nearest link (a first cut by the canal took a lane running off it and turned the wash 90 degrees).
 * The truck flees to FLEE: from this pocket south of 建国路 the only way west is east to x 8550, round onto 建国路's
 * westbound side and on into town - a 3.6 km run towards 大刘's (fleeing east it was caught past 高碑店, 5 km from
 * the delivery; the canal road's only way out was a bridge the truck stuck on).
 */
const SITE = { x: 7790, z: 450.5, ax: 0.991, az: -0.132, nx: -0.132, nz: -0.991, hw: 4 };
const FLEE = { x: 6000, z: 200 };

export function chapter2(env: Env): M2 {
  const rng = new Rng(20261013), r = () => rng.next();
  const banner = new Banner();
  const kcar = new ScriptCar(env.engine, 'sedan', K_LIVERY);
  kcar.car.tune.torque = 1.12; kcar.car.tune.grip = 1.05;
  env.cars.add(kcar);
  const gang = new Gang(env);
  const chen: Look = { ...randomLook(r), fem: 0, age: 0.3, top: 'jacket', shirt: new THREE.Color('#1b1d21'), inner: new THREE.Color('#d8d4cc'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#22252b'), hairStyle: 'short', glasses: false, beard: false, cap: null, mask: null, print: false };
  const bossLook: Look = { ...randomLook(r), fem: 0, age: 0.48, build: 0.75, top: 'jacket', shirt: new THREE.Color('#2a1d16'), inner: new THREE.Color('#141416'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#121214'), hairStyle: 'buzz', glasses: false, beard: false, cap: null, mask: null, print: false } as Look;
  const thugLook = (): Look => ({ ...randomLook(r), fem: 0, age: 0.25 + r() * 0.3, top: r() < 0.6 ? 'jacket' : 'tee', shirt: new THREE.Color(['#141416', '#1b1c1f', '#2a2d33'][Math.floor(r() * 3)]), inner: new THREE.Color('#141416'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#121214'), hairStyle: r() < 0.6 ? 'buzz' : 'short', glasses: false, cap: null, mask: null, print: false } as Look);
  const who = {
    chen: (): Speaker => ({ name: t('cmp.who.chenye'), color: '#e8e4da', look: chen, voice: { pitch: 104, rate: 1, bright: 0.85, fem: 0, age: 0.3, character: 'chenye' }, at: null }),
    k: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('who.laok'), color: '#f3b50f', look: env.contacts?.appearance('laok'), voice: { pitch: 98, rate: 0.92, bright: 0.8, fem: 0, age: 0.62, character: 'laok' }, at }),
    yu: (): Speaker => ({ name: t('who.xiaoyu'), color: '#5ac8fa', look: env.contacts?.appearance('xiaoyu'), voice: { pitch: 215, rate: 1.05, bright: 1.1, fem: 1, age: 0.18, character: 'xiaoyu' }, at: null }),
    liu: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('who.daliu'), color: '#ff6b5a', look: env.contacts?.appearance('daliu'), voice: { pitch: 100, rate: 1, bright: 0.9, fem: 0, age: 0.45, character: 'daliu' }, at }),
    boss: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('cmp.who.baoge'), color: '#b8862b', look: bossLook, voice: { pitch: 90, rate: 0.95, bright: 0.75, fem: 0, age: 0.48, character: 'baoge' }, at }),
    thug: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('cmp.who.panther'), color: '#ff5a4a', look: thugLook(), voice: { pitch: 112, rate: 1.05, bright: 0.9, fem: 0, age: 0.35 }, at }),
  };
  const L = (s: Speaker, key: Parameters<typeof t>[0]): Line => ({ who: s, text: t(key) });

  // --- where things are -----------------------------------------------------------------------------------------
  const kSpot = () => env.contacts?.spot('laok') ?? null;
  const liuSpot = () => env.contacts?.spot('daliu') ?? null;
  let kPark: { x: number; z: number; yaw: number } | null = null;
  const kerbForK = () => {
    const s = kSpot()!;
    kPark ??= env.kerbPose(s.x, s.z, 9, SITE) ?? { x: s.x + Math.sin(s.yaw) * 4, z: s.z + Math.cos(s.yaw) * 4, yaw: s.yaw + Math.PI / 2 };
    return kPark;
  };
  let liuPark: { x: number; z: number; yaw: number } | null = null;
  const kerbForLiu = () => { const s = liuSpot()!; return liuPark ??= env.kerbPose(s.x, s.z, 6) ?? { x: s.x, z: s.z, yaw: s.yaw }; };

  /**
   * The wash's frame: `o` on the road's centre line nearest SITE, `a` along it (east), `n` across it into the lot.
   * L(a, b, h) is a point `a` m along, `b` m into the lot, `h` up.
   */
  const F = () => ({ ox: SITE.x, oz: SITE.z, ax: SITE.ax, az: SITE.az, nx: SITE.nx, nz: SITE.nz, hw: SITE.hw });
  const P = (a: number, b: number) => { const f = F(); return { x: f.ox + f.ax * a + f.nx * b, z: f.oz + f.az * a + f.nz * b }; };
  const V = (a: number, b: number, h: number): V3 => { const p = P(a, b); return [p.x, h, p.z]; };
  const yawAlong = () => Math.atan2(F().ax, F().az);
  const yawInto = () => Math.atan2(F().nx, F().nz);
  /** Across the road from the lot, the eastbound lane (right-hand traffic: south of the centre line) where the cars stand. */
  const LANE = -2;

  // --- the wash's things: built for the mission (again after a failure: the mission scope is cleared) -------------
  let site: { truck: ScriptCar; suvs: ScriptCar[]; deco: THREE.Group; body: import('@dimforge/rapier3d-compat').RigidBody } | null = null;
  const buildSite = (scope: Scope) => {
    if (site) { placeTruck(); return site; }
    const truck = new ScriptCar(env.engine, 'truck', TRUCK);
    env.cars.add(truck);
    const suvs: ScriptCar[] = [];
    for (const [a, b] of [[-9, 17], [8, 18]]) {
      const p = P(a, b);
      if (!clearOfWorld(env.engine.physics, p.x, p.z, yawInto(), 1.2, 2.6)) continue;
      const sc = new ScriptCar(env.engine, 'suv', PANTHER);
      sc.place(p.x, p.z, yawInto() + Math.PI + (a < 0 ? 0.25 : -0.3));
      env.cars.add(sc); suvs.push(sc);
    }
    const deco = signBoard(), sp = P(-10, F().hw + 2.2);
    deco.position.set(sp.x, 0, sp.z); deco.rotation.y = yawInto() + Math.PI;
    env.engine.scene.add(deco);
    // the sign's posts are solid
    const { R, world } = env.engine.physics;
    const body = world.createRigidBody(R.RigidBodyDesc.fixed());
    for (const s of [-1.5, 1.5]) {
      const pp = P(-10 + s, F().hw + 2.2);
      world.createCollider(R.ColliderDesc.cylinder(1.3, 0.09).setTranslation(pp.x, 1.3, pp.z).setCollisionGroups(groups(CG.WORLD, CG.ALL)), body);
    }
    site = { truck, suvs, deco, body };
    // the kerbs here are lined with parked cars: clear the stretch where the truck and 老K's car stand
    env.engine.get<ParkingApi>('parking')?.clearAround(SITE.x, SITE.z, 42, 900);
    placeTruck();
    scope.defer(() => {
      const s = site;
      if (!s) return;
      site = null;
      for (const c of [s.truck, ...s.suvs]) { c.remove(); env.cars.delete(c); }
      env.engine.scene.remove(s.deco);
      world.removeRigidBody(s.body);
      s.deco.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mt of Array.isArray(m.material) ? m.material : [m.material]) { (mt as THREE.MeshStandardMaterial).map?.dispose(); mt.dispose(); }
      });
    });
    return site;
  };
  /** The truck at the kerb just past the lot, facing east, standing. */
  const placeTruck = () => {
    if (!site || env.v.car === site.truck.car) return;
    const p = P(16, LANE);
    site.truck.driver = null; site.truck.takeable = false;
    site.truck.place(p.x, p.z, yawAlong());
    site.truck.hp = 1e4;
    env.damage?.repair(site.truck.car);
  };

  // --- mission-wide watch ---------------------------------------------------------------------------------------
  /** What the player must not lose: 老K's car on the drive out, the truck once taken. */
  let phase: 'none' | 'kcar' | 'truck' = 'none';
  let away = 0, busted = false, frameDt = 0, quip = 0, spawned = false;
  let chasing = false, hits = 0, hitT = 0;
  env.engine.events.on('wanted:busted', () => { busted = true; });
  env.engine.events.on('vehicle:impact', (e: { strength?: number }) => {
    if (!chasing || !site || hitT > 0 || (e.strength ?? 0) < 3) return;
    const c = env.v.car.pos, tp = site.truck.car.pos;
    if (Math.hypot(c.x - tp.x, c.z - tp.z) < 8) { hits++; hitT = 0.7; env.objective(t('cmp.m2.chase', { n: Math.min(3, hits) })); }
  });
  const resetWatch = () => { away = 0; busted = false; };
  const heal = () => { env.pl.heal(100); env.wanted?.clear(); };

  /** Chen Ye on foot by the wash, 老K's car at the kerb behind him. */
  const atWash = (scope: Scope) => {
    buildSite(scope);
    if (env.pl.mode === 'driving') env.pl.getOut();
    const k = P(-17, LANE);
    kcar.place(k.x, k.z, yawAlong()); env.damage?.repair(kcar.car);
    const p = P(-3, F().hw + 2);
    env.putOnFoot(p.x, p.z, yawInto());
    heal();
  };

  const def: M2 = {
    id: 'm2',
    title: t('cmp.m2.title'), kick: t('cmp.m2.kick'), who: t('cmp.m2.who'), blip: t('cmp.m2.blip'),
    start: () => { const s = kSpot(); return s ? { x: s.x + Math.sin(s.yaw) * 1.8, z: s.z + Math.cos(s.yaw) * 1.8 } : null; },
    init: () => ({ cp: null, ko: 0, wrecked: 0, stars: 0 }),
    tick(dt, st) {
      frameDt = dt; hitT -= dt; quip -= dt;
      if (st) st.stars = Math.max(st.stars, env.wanted?.level ?? 0);
    },
    guard() {
      if (env.pl.health <= 0) return t('cmp.why.wasted');
      if (busted) { busted = false; return t('cmp.why.busted'); }
      if (phase === 'kcar') {
        if ((env.damage?.health(kcar.car) ?? 100) <= 0) return t('cmp.why.car');
        if (env.v.car !== kcar.car || env.pl.mode !== 'driving') {
          away += frameDt;
          if (away > 30 || Math.hypot(env.pl.position.x - kcar.car.pos.x, env.pl.position.z - kcar.car.pos.z) > 120) return t('cmp.why.leftCar');
        } else away = 0;
      } else if (phase === 'truck' && site) {
        const tc = site.truck.car;
        if ((env.damage?.health(tc) ?? 100) <= 0) return t('cmp.why.truck');
        if (env.v.car !== tc || env.pl.mode !== 'driving') {
          away += frameDt;
          if (away > 25 || Math.hypot(env.pl.position.x - tc.pos.x, env.pl.position.z - tc.pos.z) > 120) return t('cmp.why.leftTruck');
        } else away = 0;
      } else away = 0;
      return null;
    },
    result(clock, st) {
      // ~9 km of driving (5.4 out, the chase, 2.5 to 大刘's), two fights and a minute and a half of cutscenes: 13 minutes
      // is brisk, 18 easy (the probe's autopilot, at 55-95 km/h, took 8 from the first fight on)
      const hp = Math.round(site ? env.damage?.health(site.truck.car) ?? 100 : 100), mins = clock / 60;
      const medal = mins < 13 && hp > 70 && st.stars === 0 ? 'gold' : mins < 18 && hp > 40 ? 'silver' : 'bronze';
      const pay = 2000 + (medal === 'gold' ? 600 : medal === 'silver' ? 250 : 0);
      const time = `${Math.floor(clock / 60)}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;
      return { rows: [[t('cmp.row.time'), time], [t('cmp.row.truck'), `${hp}%`], [t('cmp.row.ko'), `${st.ko} / 7`], [t('cmp.row.wrecked'), `${st.wrecked} / 2`], [t('cmp.row.stars'), st.stars ? '★'.repeat(st.stars) : '—']], medal, pay };
    },
    steps: [],
    debug: { kcar: () => kcar.car, truck: () => site?.truck.car ?? null, site: () => site, gang: () => gang.cars.map((c) => ({ on: c.on, hp: Math.round(c.hp), wreck: c.wreck >= 0, d: Math.round(c.car.pos.distanceTo(env.v.car.pos)), kmh: Math.round(c.car.speed * 3.6) })) },
  };

  /** The camera relative to a contact's spot: `side` metres across their facing, `out` along it, `up` high. */
  const around = (s: { x: number; z: number; yaw: number }, side: number, out: number, up: number): V3 => {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    return [s.x + fx * out + fz * side, up, s.z + fz * out - fx * side];
  };
  /** A scripted person who goes when the step (or mission) scope does. */
  const extra = (scope: Scope, x: number, z: number, look: Look, yaw: number, model?: string): Actor | null => {
    const a = env.people?.spawnActor?.(x, z, { look, yaw }) ?? null;
    if (!a) return null;
    if (model && CAST_ON) void castModel(env.engine, model, look).then((h) => { if (a.alive) a.model = h; else h.hide(); }).catch(() => {});
    scope.defer(() => { if (a.alive) a.release('vanish'); });
    return a;
  };
  const contact = (scope: Scope, id: 'laok' | 'daliu', s: { x: number; z: number; yaw: number }) => {
    let a = env.contacts?.actor(id) ?? null;
    if (!a) {
      a = env.people?.spawnActor?.(s.x, s.z, { look: env.contacts?.appearance(id), yaw: s.yaw }) ?? null;
      if (a && id === 'laok') a.act('drink', { seat: 0.36 });
      if (a) { const x = a; scope.defer(() => x.release('vanish')); }
    }
    return a;
  };

  def.steps = [
    // 1. at 老K's stall
    cutscene<S>(env, {
      id: 'intro',
      setup(ctx) {
        resetWatch(); phase = 'none';
        const s = kSpot()!, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
        env.putOnFoot(s.x + fx * 1.7, s.z + fz * 1.7, s.yaw + Math.PI);
        contact(ctx.mission, 'laok', s)?.face(s.x + fx * 1.7, s.z + fz * 1.7);
        const k = kerbForK();
        if (env.v.car !== kcar.car) kcar.place(k.x, k.z, k.yaw);
        ctx.mission.defer(() => kcar.remove());
      },
      shots: () => {
        const s = kSpot()!, k = kerbForK();
        return [
          { from: around(s, 5, 6, 2.4), to: around(s, 3.2, 4.8, 2.1), look: around(s, 0, 0.6, 1.1), secs: 6 },
          { from: around(s, -0.95, 3.0, 1.68), look: around(s, 0, 0, 1.0), look2: around(s, 0.15, 0, 1.0), secs: 7, fov: 38 },
          { from: around(s, 0.75, -0.6, 1.3), look: around(s, 0, 1.7, 1.55), secs: 6, fov: 40 },
          { from: [s.x + (k.x - s.x) * 0.4 + 2, 2.6, s.z + (k.z - s.z) * 0.4 + 2], look: [k.x, 0.8, k.z], secs: 5 },
        ];
      },
      lines: () => {
        const at = kSpot();
        return [L(who.k(at), 'cmp.m2.k1'), L(who.chen(), 'cmp.m2.c1'), L(who.k(at), 'cmp.m2.k2'), L(who.chen(), 'cmp.m2.c2'), L(who.k(at), 'cmp.m2.k3'), L(who.k(at), 'cmp.m2.k4')];
      },
    }),
    // 2. 老K's car (checkpoint: at the kerb by the stall)
    getIn<S>(env, {
      id: 'getIn', checkpoint: true, car: () => kcar, line: t('cmp.m2.getIn'),
      restore(ctx) {
        resetWatch(); phase = 'none';
        const k = kerbForK(), s = kSpot()!;
        kcar.place(k.x, k.z, k.yaw); env.damage?.repair(kcar.car);
        ctx.mission.defer(() => kcar.remove());
        env.putOnFoot(s.x + Math.sin(s.yaw) * 1.7, s.z + Math.cos(s.yaw) * 1.7, s.yaw + Math.PI);
        heal();
      },
    }),
    call<S>('inCar', () => { phase = 'kcar'; kcar.takeable = false; }),
    // 3. out to the wash; Xiaoyu on the phone
    talk<S>(env, 'yuCall', () => [L(who.yu(), 'cmp.m2.y1'), L(who.chen(), 'cmp.m2.c3'), L(who.yu(), 'cmp.m2.y2')]),
    drive<S>(env, {
      id: 'toWash', line: t('cmp.m2.toWash'), label: t('cmp.m2.wash'), r: 16, stop: true,
      to: () => P(-6, LANE),
      tick(ctx) { if (Math.hypot(env.pl.position.x - SITE.x, env.pl.position.z - SITE.z) < 400) buildSite(ctx.mission); },
    }),
    // 4. the three at the door
    cutscene<S>(env, {
      id: 'arrive',
      setup(ctx) {
        phase = 'none';
        buildSite(ctx.mission);
        if (env.pl.mode === 'driving') env.pl.getOut();
        const p = P(-3, F().hw + 2);
        env.putOnFoot(p.x, p.z, yawInto());
        const face = (a: Actor | null) => a?.face(p.x, p.z);
        for (const [i, [a, b]] of [[-2, 12.5], [0.5, 14], [3, 12]].entries()) {
          const q = P(a, b);
          const act = extra(ctx.step, q.x, q.z, thugLook(), yawInto() + Math.PI, ['thug1', 'thug2', 'thug3'][i]);
          face(act);
          if (i === 1) act?.act('angry');
        }
      },
      shots: () => [
        { from: V(-14, -2, 3.2), to: V(-9, 1, 2.6), look: V(0, 12, 1.2), secs: 5 },
        { from: V(-4.2, F().hw + 0.6, 1.7), look: V(0.5, 14, 1.4), secs: 5, fov: 40 },
        { from: V(1.5, 11, 1.5), look: V(-3, F().hw + 2, 1.55), secs: 4, fov: 42 },
      ],
      lines: () => [L(who.thug(P(0.5, 14)), 'cmp.m2.g1'), L(who.chen(), 'cmp.m2.c4'), L(who.thug(P(0.5, 14)), 'cmp.m2.g2')],
    }),
    // 5. the fights (checkpoints: on foot by the wash)
    fight<S>(env, {
      id: 'fight1', checkpoint: true, line: t('cmp.m2.fight1'), n: 3, tough: 1, fled: t('cmp.why.fled'),
      at: () => P(0, 12.5),
      restore(ctx) { resetWatch(); phase = 'none'; atWash(ctx.mission); ctx.state.ko = 0; },
      ko(ctx, n) { ctx.state.ko = n; },
    }),
    talk<S>(env, 'shout', () => [L(who.thug(P(2, 20)), 'cmp.m2.g3')]),
    fight<S>(env, {
      id: 'fight2', checkpoint: true, line: t('cmp.m2.fight2'), n: 4, tough: 1.3, fled: t('cmp.why.fled'),
      at: () => P(2, 16),
      restore(ctx) { resetWatch(); phase = 'none'; atWash(ctx.mission); ctx.state.ko = 3; },
      ko(ctx, n) { ctx.state.ko = 3 + n; },
    }),
    // 6. 豹哥 shows himself and sends the truck off
    cutscene<S>(env, {
      id: 'boss',
      setup(ctx) {
        buildSite(ctx.mission);
        const b = P(6, 13.5), ft = env.pl.position;
        const boss = extra(ctx.step, b.x, b.z, bossLook, yawInto() + Math.PI, 'baoge');
        boss?.face(ft.x, ft.z); boss?.act('point');
      },
      shots: () => {
        const ft = env.pl.position, b = P(6, 13.5);
        return [
          { from: [ft.x - F().nx * 2.4 + F().ax * 1.2, 1.75, ft.z - F().nz * 2.4 + F().az * 1.2], look: [b.x, 1.5, b.z], secs: 5, fov: 40 },
          { from: V(4.4, 11, 1.45), look: V(6, 13.5, 1.6), secs: 5, fov: 36 },
          { from: V(10, 9, 2.4), to: V(12, 7, 2.6), look: V(16, LANE, 1.4), secs: 5 },
        ];
      },
      lines: () => { const b = P(6, 13.5); return [L(who.boss(b), 'cmp.m2.b1'), L(who.chen(), 'cmp.m2.c5'), L(who.boss(b), 'cmp.m2.b2'), L(who.boss(b), 'cmp.m2.b3')]; },
    }),
    // 7. after the truck (checkpoint: in 老K's car at the kerb, the truck setting off)
    {
      id: 'chase', checkpoint: true,
      restore(ctx) {
        resetWatch(); phase = 'none';
        buildSite(ctx.mission);
        const k = P(-17, LANE);
        env.putIn(kcar, k.x, k.z, yawAlong()); env.damage?.repair(kcar.car);
        heal();
      },
      enter(ctx) {
        const s = buildSite(ctx.mission), tr = s.truck;
        tr.hp = 1e4;
        tr.chase(env.nav, () => ({ x: FLEE.x, z: FLEE.z, vx: 0, vz: 0 }), { top: 19 });
        tr.car.setMoving(6);
        chasing = true; hits = 0; hitT = 0; still = 0; aimT = 0;
        // on foot by the wash: 老K's car at the kerb is the way after it (F, as at the start)
        kcar.takeable = env.v.car !== kcar.car;
        ctx.step.defer(() => { chasing = false; kcar.takeable = false; env.nav.clearTarget('mission'); });
        env.objective(t('cmp.m2.chase', { n: 0 }));
        for (const l of [L(who.yu(), 'cmp.m2.y3'), L(who.chen(), 'cmp.m2.c6')]) env.dialogue?.say(l.who, l.text, { prio: 3 });
      },
      update(ctx, dt) {
        const tr = site!.truck, tc = tr.car, me = env.pl.position;
        if (env.v.car === kcar.car) kcar.takeable = false;
        env.blips.push({ kind: 'car', x: tc.pos.x, z: tc.pos.z, heading: Math.atan2(tc.fwd.x, tc.fwd.z), flash: true });
        if ((aimT -= dt) <= 0) { aimT = 0.5; env.nav.setTarget({ x: tc.pos.x, z: tc.pos.z, kind: 'mission', label: t('cmp.m2.truck') }); }
        const d = Math.hypot(me.x - tc.pos.x, me.z - tc.pos.z);
        still = env.pl.mode === 'driving' && d < 9 && tc.speed < 2.5 && ctx.t > 4 ? still + dt : 0;
        if (hits >= 3 || still > 1.5) {
          // it stops; the driver jumps out and runs
          tr.driver = null;
          const door = { x: tc.pos.x + tc.left.x * 1.6, z: tc.pos.z + tc.left.z * 1.6 };
          const man = env.people?.spawnActor?.(door.x, door.z, { look: thugLook(), yaw: Math.atan2(tc.left.x, tc.left.z) });
          if (man) { man.fair = true; man.release('flee'); }
          banner.show(t('cmp.m2.stopped'), '#ffc21f'); setTimeout(() => banner.hide(), 1600);
          return 'done';
        }
        if (Math.hypot(tc.pos.x - FLEE.x, tc.pos.z - FLEE.z) < 40 || (ctx.t > 25 && d > 900)) return { fail: t('cmp.why.truckGone') };
        return 'run';
      },
    },
    // 8. take it
    getIn<S>(env, { id: 'takeTruck', car: () => site!.truck, line: t('cmp.m2.take') }),
    call<S>('inTruck', (ctx) => {
      phase = 'truck'; site!.truck.takeable = false;
      const c = site!.truck.car;
      ctx.state.cp = { x: c.pos.x, z: c.pos.z, yaw: Math.atan2(c.fwd.x, c.fwd.z) };
    }),
    // 9. two more SUVs (checkpoint: in the truck where it was taken)
    {
      id: 'escape', checkpoint: true,
      restore(ctx) {
        resetWatch();
        const s = buildSite(ctx.mission), p = ctx.state.cp ?? { ...P(16, LANE), yaw: yawAlong() };
        env.putIn(s.truck, p.x, p.z, p.yaw);
        env.damage?.repair(s.truck.car);
        phase = 'truck';
        heal();
      },
      enter(ctx) {
        ctx.mission.defer(() => gang.remove());
        env.objective(t('cmp.m2.lose'));
        quip = 8; spawned = false;
      },
      update(ctx, dt) {
        if (!spawned) {
          if (gang.spawn(() => new ScriptCar(env.engine, 'suv', PANTHER), 2 - gang.cars.length, 27) && gang.cars.length >= 2 || ctx.t > 6 && gang.cars.length) {
            spawned = true;
            banner.show(t('cmp.m1.ambush'), '#ff5a4a'); setTimeout(() => banner.hide(), 1800);
            for (const l of [L(who.yu(), 'cmp.m2.y4'), L(who.chen(), 'cmp.m2.c7')]) env.dialogue?.say(l.who, l.text, { prio: 3 });
          }
          return ctx.t > 12 ? 'done' : 'run';
        }
        const before = ctx.state.wrecked;
        const res = gang.update(dt);
        ctx.state.wrecked = gang.wrecked;
        // a truck cannot shake an SUV sitting on its tail: after 70 s they give up and pull over
        if (res === 'run' && ctx.t > 70) {
          for (const c of gang.cars) c.driver = null;
          env.dialogue?.say(who.yu(), t('cmp.m2.y6'), { prio: 3 });
          return 'done';
        }
        if (ctx.state.wrecked > before) env.dialogue?.say(who.yu(), t('cmp.m2.y5'), { prio: 2 });
        else if (quip <= 0 && gang.cars.some((c) => c.on && c.wreck < 0 && c.car.pos.distanceTo(env.v.car.pos) < 25)) {
          env.dialogue?.say(who.yu(), t(Math.random() < 0.5 ? 'cmp.m1.y4' : 'cmp.m1.y6'), { prio: 2 }); quip = 9;
        }
        return res;
      },
    },
    // 10. to 大刘's
    drive<S>(env, { id: 'toLiu', line: t('cmp.m2.toLiu'), label: t('cmp.m2.liu'), r: 10, stop: true, to: () => kerbForLiu() }),
    // 11. 大刘 opens the box
    cutscene<S>(env, {
      id: 'outro',
      setup(ctx) {
        phase = 'none';
        const s = liuSpot()!, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), sx = fz, sz = -fx;
        env.putOnFoot(s.x + fx * 1.8 + sx * 0.8, s.z + fz * 1.8 + sz * 0.8, s.yaw + Math.PI);
        const liu = contact(ctx.step, 'daliu', s);
        liu?.face(s.x + fx * 1.8, s.z + fz * 1.8); liu?.act('talk');
      },
      shots: () => {
        const s = liuSpot()!, tc = site?.truck.car.pos ?? new THREE.Vector3(s.x, 0, s.z);
        return [
          { from: around(s, 4, 6, 2.6), to: around(s, 3, 5, 2.2), look: [tc.x * 0.5 + s.x * 0.5, 1.2, tc.z * 0.5 + s.z * 0.5], secs: 6 },
          { from: around(s, 0.8, -0.6, 1.35), look: around(s, 0, 1.8, 1.55), secs: 7, fov: 42 },
          { from: around(s, -1, 3, 1.7), look: around(s, 0, 0, 1.5), secs: 6, fov: 40 },
          { from: around(s, -3, 7, 3), to: around(s, -4, 9, 3.8), look: around(s, 0, 1, 1.2), secs: 6 },
        ];
      },
      lines: () => {
        const at = liuSpot();
        return [L(who.liu(at), 'cmp.m2.d1'), L(who.liu(at), 'cmp.m2.d2'), L(who.chen(), 'cmp.m2.c8'), L(who.liu(at), 'cmp.m2.d3'), L(who.k(), 'cmp.m2.k5'), L(who.chen(), 'cmp.m2.c9'), L(who.k(), 'cmp.m2.k6')];
      },
    }),
    wait<S>('end', 0.2),
  ];
  let still = 0, aimT = 0;
  return def;
}

/** 「豹记洗车」 on a lightbox between two posts (canvas text, lit at night). */
function signBoard(): THREE.Group {
  const g = new THREE.Group();
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#101418'; c.fillRect(0, 0, 512, 160);
  c.fillStyle = '#b8862b'; c.fillRect(0, 0, 512, 10); c.fillRect(0, 150, 512, 10);
  c.fillStyle = '#f2c94c'; c.font = 'bold 84px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('豹记洗车', 256, 70);
  c.fillStyle = '#e6e6e6'; c.font = '28px "PingFang SC","Noto Sans SC",sans-serif'; c.fillText('精洗 · 打蜡 · 改装', 256, 128);
  const tex = new THREE.CanvasTexture(cv); tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
  const face = new THREE.MeshStandardMaterial({ map: tex, emissive: new THREE.Color('#ffffff'), emissiveMap: tex, emissiveIntensity: 0.35, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: '#2a2d33', roughness: 0.7, metalness: 0.3 });
  const board = new THREE.Mesh(new THREE.BoxGeometry(3.4, 1.06, 0.18), [dark, dark, dark, dark, face, face]);
  board.position.y = 2.3; board.castShadow = true;
  g.add(board);
  for (const s of [-1.5, 1.5]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.08, 2.6, 8), dark);
    post.position.set(s, 1.3, 0); post.castShadow = true;
    g.add(post);
  }
  return g;
}
