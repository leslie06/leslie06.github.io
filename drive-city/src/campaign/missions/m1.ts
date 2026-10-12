import * as THREE from 'three';
import { t } from '../../core/I18n';
import type { Actor, Speaker } from '../../game/Contracts';
import { randomLook, type Look } from '../../character/Body';
import { Rng } from '../../core/Rng';
import { Banner } from '../../ui/Banner';
import { ScriptCar } from '../Cars';
import { call, cutscene, drive, Gang, getIn, talk, wait, type Env, type Line, type V3 } from '../Kit';
import type { MissionDef } from '../Runner';
import type { Livery } from '../../vehicle/CarModel';

/**
 * Chapter 1 《回京》 (docs/gta-plan.md §5): 老K at his tea stall off 东单 gives Chen Ye a run - his car, Xiaoyu and a
 * bag from 永安里 (by 国贸) back to the stall; two Black Panther SUVs come after them on the way back. (A first cut
 * delivered to the underground garage: 150 m from Xiaoyu's spot, the ambush fired as she got in and the last leg was
 * nothing.) Checkpoints: getting in the car (at the kerb by the stall), and the ambush (in the car with Xiaoyu where it
 * began).
 */
interface S {
  /** Xiaoyu is in the car. */
  aboard: boolean;
  /** Where the ambush began (the checkpoint puts the car back there). */
  cp: { x: number; z: number; yaw: number } | null;
  wrecked: number;
  stars: number;
}
export interface M1 extends MissionDef<S> {
  title: string; kick: string; who: string; blip: string;
  /** Where the mission is picked up (老K's stall), or null until the contacts are placed. */
  start(): { x: number; z: number } | null;
  /** The results card's rows and medal, at the end. */
  result(clock: number, s: S): { rows: [string, string][]; medal: 'gold' | 'silver' | 'bronze'; pay: number };
  /** Every frame while running, before the runner (the guard's clocks, the most stars). */
  tick(dt: number, s: S | null): void;
}

const K_LIVERY: Livery = { upper: '#111214', lower: '#111214', roofSign: null, plate: { text: '京A·K8888', bg: '#1d49b5', fg: '#ffffff' }, doorText: 'K', doorColor: '#f3b50f' };
const PANTHER: Livery = { upper: '#0b0b0c', lower: '#0b0b0c', roofSign: null, plate: { text: '京N·8B4T7', bg: '#1d49b5', fg: '#ffffff' }, doorText: '豹', doorColor: '#b8862b' };

export function chapter1(env: Env): M1 {
  const rng = new Rng(20261012), r = () => rng.next();
  const banner = new Banner();
  const kcar = new ScriptCar(env.engine, 'sedan', K_LIVERY);
  kcar.car.tune.torque = 1.12; kcar.car.tune.grip = 1.05;
  env.cars.add(kcar);
  const gang = new Gang(env);
  const chen: Look = { ...randomLook(r), fem: 0, age: 0.3, top: 'jacket', shirt: new THREE.Color('#1b1d21'), inner: new THREE.Color('#d8d4cc'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#22252b'), hairStyle: 'short', glasses: false, beard: false, cap: null, mask: null, print: false };
  const who = {
    chen: (): Speaker => ({ name: t('cmp.who.chenye'), color: '#e8e4da', look: chen, voice: { pitch: 104, rate: 1, bright: 0.85, fem: 0, age: 0.3 }, at: null }),
    k: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('who.laok'), color: '#f3b50f', look: env.contacts?.appearance('laok'), voice: { pitch: 98, rate: 0.92, bright: 0.8, fem: 0, age: 0.62, character: 'laok' }, at }),
    yu: (): Speaker => ({ name: t('who.xiaoyu'), color: '#5ac8fa', look: env.contacts?.appearance('xiaoyu'), voice: { pitch: 215, rate: 1.05, bright: 1.1, fem: 1, age: 0.18, character: 'xiaoyu' }, at: null }),
  };
  const L = (s: Speaker, key: Parameters<typeof t>[0]): Line => ({ who: s, text: t(key) });

  // where things are
  const kSpot = () => env.contacts?.spot('laok') ?? null;
  const yuSpot = () => env.contacts?.spot('xiaoyu') ?? null;
  let kPark: { x: number; z: number; yaw: number } | null = null;
  /**
   * Where Xiaoyu waits: the kerb within 150 m of her stall that is the shortest drive from 老K's (her stall itself is on
   * a one-way going the wrong way: 4.1 km round from the stall, against 2.3 km in a straight line).
   */
  let yuWait: { x: number; z: number; yaw: number } | null = null;
  const pickupPoint = () => {
    if (yuWait) return yuWait;
    const y = yuSpot()!, k = kerbForK(), g = env.tr.graph, at = { x: 0, z: 0, dx: 0, dz: 0 };
    let best = Infinity;
    for (const id of g.near(y.x, y.z, 150)) {
      const l = g.links[id];
      if (l.len < 20 || l.hmax > 0.3 || ['service', 'living_street', 'motorway', 'motorway_link', 'trunk', 'trunk_link'].includes(l.cls)) continue;
      for (let s = 8; s < l.len - 8; s += 25) {
        g.at(l, s, -Math.max(0.9, l.kerbR - 1.1), at);   // the right-hand kerb of this direction
        if (Math.hypot(at.x - y.x, at.z - y.z) > 150) continue;
        const r = env.nav.route(k.x, k.z, k.yaw, at.x, at.z);
        if (r && r.len + Math.hypot(r.pts[r.pts.length - 2] - at.x, r.pts[r.pts.length - 1] - at.z) < best) {
          best = r.len; yuWait = { x: at.x, z: at.z, yaw: Math.atan2(at.dx, at.dz) };
        }
      }
    }
    return yuWait ??= env.kerbPose(y.x, y.z, 0) ?? y;
  };
  const kerbForK = () => {
    const s = kSpot()!;
    kPark ??= env.kerbPose(s.x, s.z, 9, yuSpot() ?? undefined) ?? { x: s.x + Math.sin(s.yaw) * 4, z: s.z + Math.cos(s.yaw) * 4, yaw: s.yaw + Math.PI / 2 };
    return kPark;
  };

  // mission-wide watch
  let away = 0, busted = false, driven = 0, frame = 0, mustDrive = false, yuActor: Actor | null = null, quip = 0, spawned = false;
  const last = new THREE.Vector3();
  env.engine.events.on('wanted:busted', () => { busted = true; });
  const resetWatch = () => { away = 0; busted = false; };

  const def: M1 = {
    id: 'm1',
    title: t('cmp.m1.title'), kick: t('cmp.m1.kick'), who: t('cmp.m1.who'), blip: t('cmp.m1.blip'),
    start: () => { const s = kSpot(); return s ? { x: s.x + Math.sin(s.yaw) * 1.8, z: s.z + Math.cos(s.yaw) * 1.8 } : null; },
    init: () => ({ aboard: false, cp: null, wrecked: 0, stars: 0 }),
    tick(dt, st) {
      frame = dt;
      if (st) st.stars = Math.max(st.stars, env.wanted?.level ?? 0);
      quip -= dt;
    },
    guard(ctx) {
      if (env.pl.health <= 0) return t('cmp.why.wasted');
      if (busted) { busted = false; return t('cmp.why.busted'); }
      const inK = env.v.car === kcar.car && env.pl.mode === 'driving';
      if ((env.v.car === kcar.car || kcar.on) && (env.damage?.health(kcar.car) ?? 100) <= 0) return t('cmp.why.car');
      // once in the car: walking away from it (or driving off in another) for long is giving up the job
      const has = ctx.state.aboard;
      if (mustDrive && !inK) {
        away += frame;
        const d = Math.hypot(env.pl.position.x - kcar.car.pos.x, env.pl.position.z - kcar.car.pos.z);
        if (away > (has ? 15 : 30) || d > 120) return t(has ? 'cmp.why.abandoned' : 'cmp.why.leftCar');
      } else away = 0;
      return null;
    },
    result(clock, st) {
      // ~5.2 km of driving and a minute of cutscenes: 9 minutes is a brisk run, 13 an easy one
      const hp = Math.round(env.damage?.health(kcar.car) ?? 100), mins = clock / 60;
      const medal = mins < 9 && hp > 70 && st.stars === 0 ? 'gold' : mins < 13 && hp > 40 ? 'silver' : 'bronze';
      const pay = 1500 + (medal === 'gold' ? 500 : medal === 'silver' ? 200 : 0);
      const time = `${Math.floor(clock / 60)}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;
      return { rows: [[t('cmp.row.time'), time], [t('cmp.row.car'), `${hp}%`], [t('cmp.row.wrecked'), `${st.wrecked} / 2`], [t('cmp.row.stars'), st.stars ? '★'.repeat(st.stars) : '—']], medal, pay };
    },
    steps: [],
  };
  const inCar = (on: boolean) => { mustDrive = on; };

  /** The camera relative to 老K's spot: `side` metres across his facing, `out` along it, `up` high. */
  const around = (side: number, out: number, up: number): V3 => {
    const s = kSpot()!, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    return [s.x + fx * out + fz * side, up, s.z + fz * out - fx * side];
  };

  def.steps = [
    // 1. at 老K's stall
    cutscene<S>(env, {
      id: 'intro',
      setup(ctx) {
        resetWatch(); inCar(false);
        const s = kSpot()!, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
        env.putOnFoot(s.x + fx * 1.7, s.z + fz * 1.7, s.yaw + Math.PI);
        // 老K at his table (the contacts' own figure; a stand-in if he is not out, as in shot mode)
        let laok = env.contacts?.actor('laok') ?? null;
        if (!laok) {
          laok = env.people?.spawnActor?.(s.x, s.z, { look: env.contacts?.appearance('laok'), yaw: s.yaw }) ?? null;
          if (laok) { laok.act('drink', { seat: 0.36 }); const a = laok; ctx.mission.defer(() => a.release('vanish')); }
        }
        laok?.face(s.x + fx * 1.7, s.z + fz * 1.7);
        const k = kerbForK();
        if (env.v.car !== kcar.car) kcar.place(k.x, k.z, k.yaw);
        env.contacts?.reserve('xiaoyu', false);
      },
      shots: () => {
        const k = kerbForK(), s = kSpot()!;
        return [
          { from: around(5, 6, 2.4), to: around(3.2, 4.8, 2.1), look: around(0, 0.6, 1.1), secs: 6 },
          // over Chen Ye's shoulder onto 老K, then from beside 老K onto Chen Ye
          { from: around(-0.95, 3.0, 1.68), look: around(0, 0, 1.0), look2: around(0.15, 0, 1.0), secs: 7, fov: 38 },
          { from: around(0.75, -0.6, 1.3), look: around(0, 1.7, 1.55), secs: 5, fov: 40 },
          { from: [s.x + (k.x - s.x) * 0.4 + 2, 2.6, s.z + (k.z - s.z) * 0.4 + 2], look: [k.x, 0.8, k.z], secs: 5 },
        ];
      },
      lines: () => {
        const at = kSpot();
        return [L(who.k(at), 'cmp.m1.k1'), L(who.chen(), 'cmp.m1.c1'), L(who.k(at), 'cmp.m1.k2'), L(who.chen(), 'cmp.m1.c2'), L(who.k(at), 'cmp.m1.k3'), L(who.k(at), 'cmp.m1.k4')];
      },
    }),
    // 2. get in his car (checkpoint: back at the kerb by the stall)
    getIn<S>(env, {
      id: 'getIn', checkpoint: true, car: () => kcar, line: t('cmp.m1.getIn'),
      restore() { resetWatch(); const k = kerbForK(), s = kSpot()!; kcar.place(k.x, k.z, k.yaw); env.putOnFoot(s.x + Math.sin(s.yaw) * 1.7, s.z + Math.cos(s.yaw) * 1.7, s.yaw + Math.PI); env.damage?.repair(kcar.car); },
    }),
    call<S>('inCar', () => { inCar(true); kcar.takeable = false; }),
    // 3. to 国贸 for Xiaoyu, 老K on the phone
    talk<S>(env, 'kCall', () => [L(who.k(), 'cmp.m1.k5'), L(who.chen(), 'cmp.m1.c3')]),
    drive<S>(env, {
      id: 'toYu', line: t('cmp.m1.toYu'), label: t('cmp.m1.yuLabel'), r: 9, stop: true,
      to: () => pickupPoint(),
      enter(ctx) {
        // Xiaoyu waits on the pavement by the pickup point with the bag (her stall's own figure stands down meanwhile)
        env.contacts?.reserve('xiaoyu', true);
        ctx.mission.defer(() => env.contacts?.reserve('xiaoyu', false));
        const p = pickupPoint(), g = env.tr.graph, side = { x: -Math.cos(p.yaw), z: Math.sin(p.yaw) };   // the kerb side: right of travel (left is (dz, -dx))
        const wx = p.x + side.x * 2.6, wz = p.z + side.z * 2.6;
        yuActor = env.people?.spawnActor?.(wx, wz, { look: env.contacts?.appearance('xiaoyu'), yaw: p.yaw + Math.PI / 2 }) ?? null;
        if (yuActor) { yuActor.act('phone'); const a = yuActor; ctx.mission.defer(() => { if (a.alive) a.release('vanish'); }); }
        void g;
      },
    }),
    // 4. she walks over and gets in
    {
      id: 'pickup',
      enter(ctx) {
        const c = kcar.car, door = { x: c.pos.x - c.left.x * 1.3, z: c.pos.z - c.left.z * 1.3 };
        // the kerb side is the car's right (or its left on the far side): whichever is nearer her
        const y = yuActor?.pos ?? yuSpot()!;
        const other = { x: c.pos.x + c.left.x * 1.3, z: c.pos.z + c.left.z * 1.3 };
        const pt = Math.hypot(y.x - door.x, y.z - door.z) < Math.hypot(y.x - other.x, y.z - other.z) ? door : other;
        yuActor?.act(null); yuActor?.goTo(pt.x, pt.z, 1.6);
        ctx.step.defer(() => { yuActor?.release('vanish'); yuActor = null; });
        env.objective(null);
      },
      update(ctx) {
        if (env.v.car.speed > 4) return 'run';
        if (!yuActor || !yuActor.alive || yuActor.arrived || ctx.t > 12) { ctx.state.aboard = true; return 'done'; }
        return 'run';
      },
    },
    talk<S>(env, 'yuIn', () => [L(who.yu(), 'cmp.m1.y1'), L(who.chen(), 'cmp.m1.c4'), L(who.yu(), 'cmp.m1.y2')]),
    // 5. back towards 老K's stall until the ambush: 22 s on, 350 m driven, or 600 m from the stall
    drive<S>(env, {
      id: 'toStall1', line: t('cmp.m1.toGarage'), label: t('cmp.m1.garage'), r: 12, corona: false,
      to: () => kerbForK(),
      enter() { driven = 0; last.copy(env.pl.position); },
      tick(ctx) {
        driven += env.pl.position.distanceTo(last); last.copy(env.pl.position);
        const k = kerbForK(), dk = Math.hypot(env.pl.position.x - k.x, env.pl.position.z - k.z);
        if (ctx.t > 22 || driven > 350 || dk < 600) {
          const c = env.v.car;
          ctx.state.cp = { x: c.pos.x, z: c.pos.z, yaw: Math.atan2(c.fwd.x, c.fwd.z) };
          return 'done';
        }
      },
    }),
    // 6. the ambush (checkpoint: in the car with Xiaoyu where it began)
    {
      id: 'ambush', checkpoint: true,
      restore(ctx) {
        resetWatch(); inCar(true); ctx.state.aboard = true;
        const p = ctx.state.cp ?? kerbForK();
        env.putIn(kcar, p.x, p.z, p.yaw); env.damage?.repair(kcar.car);
        env.wanted?.clear();
      },
      enter(ctx) {
        ctx.mission.defer(() => gang.remove());
        env.objective(t('cmp.m1.lose'));
        quip = 8; spawned = false;
      },
      update(ctx, dt) {
        // the two SUVs come from behind: tried each frame until there is road for them (an empty chase is no escape)
        if (!spawned) {
          if (gang.spawn(() => new ScriptCar(env.engine, 'suv', PANTHER), 2 - gang.cars.length, 29) && gang.cars.length >= 2 || ctx.t > 6 && gang.cars.length) {
            spawned = true;
            banner.show(t('cmp.m1.ambush'), '#ff5a4a'); setTimeout(() => banner.hide(), 1800);
            for (const l of [L(who.yu(), 'cmp.m1.y3'), L(who.chen(), 'cmp.m1.c5')]) env.dialogue?.say(l.who, l.text, { prio: 3 });
          }
          return ctx.t > 12 ? 'done' : 'run';
        }
        const before = ctx.state.wrecked;
        const r = gang.update(dt);
        ctx.state.wrecked = gang.wrecked;
        if (ctx.state.wrecked > before) env.dialogue?.say(who.yu(), t('cmp.m1.y5'), { prio: 2 });
        else if (quip <= 0) {
          const near = gang.cars.some((c) => c.on && c.wreck < 0 && c.car.pos.distanceTo(env.v.car.pos) < 25);
          if (near) { env.dialogue?.say(who.yu(), t(Math.random() < 0.5 ? 'cmp.m1.y4' : 'cmp.m1.y6'), { prio: 2 }); quip = 9; }
        }
        return r;
      },
      exit() { env.dialogue?.say(who.yu(), t('cmp.m1.y7'), { prio: 3 }); },
    },
    // 7. on to the stall and stop by it
    drive<S>(env, { id: 'toStall2', line: t('cmp.m1.park'), label: t('cmp.m1.garage'), r: 9, stop: true, to: () => kerbForK() }),
    // 8. at the stall: Xiaoyu hands 老K the bag
    cutscene<S>(env, {
      id: 'outro',
      setup(ctx) {
        inCar(false);
        const s = kSpot()!, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw), sx = fz, sz = -fx;
        env.putOnFoot(s.x + fx * 1.9 + sx * 0.9, s.z + fz * 1.9 + sz * 0.9, s.yaw + Math.PI);
        const yu = env.people?.spawnActor?.(s.x + fx * 1.6 - sx * 0.8, s.z + fz * 1.6 - sz * 0.8, { look: env.contacts?.appearance('xiaoyu'), yaw: s.yaw + Math.PI });
        if (yu) { yu.act('talk'); ctx.step.defer(() => yu.release('walk')); }
        let laok = env.contacts?.actor('laok') ?? null;
        if (!laok) {
          laok = env.people?.spawnActor?.(s.x, s.z, { look: env.contacts?.appearance('laok'), yaw: s.yaw }) ?? null;
          if (laok) { laok.act('drink', { seat: 0.36 }); const a = laok; ctx.step.defer(() => a.release('vanish')); }
        }
        laok?.face(s.x + fx * 1.7, s.z + fz * 1.7);
      },
      shots: () => [
        { from: around(4, 5, 2.2), to: around(3, 4.2, 2), look: around(0, 0.9, 1.1), secs: 7 },
        { from: around(0.8, -0.6, 1.35), look: around(0, 1.8, 1.55), secs: 6, fov: 42 },
        { from: around(-2.5, 6, 2.6), to: around(-3.5, 8, 3.4), look: around(0, 1, 1.2), secs: 7 },
      ],
      lines: () => { const at = kSpot(); return [L(who.yu(), 'cmp.m1.y8'), L(who.k(at), 'cmp.m1.k6'), L(who.chen(), 'cmp.m1.c6')]; },
    }),
    wait<S>('end', 0.2),
  ];
  return def;
}
