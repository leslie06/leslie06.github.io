import * as THREE from 'three';
import { t } from '../../core/I18n';
import { Rng } from '../../core/Rng';
import type { Speaker } from '../../game/Contracts';
import { randomLook, type Look } from '../../character/Body';
import { project } from '../../city/Geo';
import { Banner } from '../../ui/Banner';
import { ScriptCar } from '../Cars';
import { Hijack } from '../Hijack';
import { call, cutscene, drive, Gang, getIn, wait, type Chapter, type Env, type Line, type V3 } from '../Kit';
import type { Scope } from '../Runner';
import type { Livery } from '../../vehicle/CarModel';

/**
 * Chapter 3 《账本》 (docs/gta-plan.md §7): Panther's men wrecked 大刘's garage in the night and took the ledger back; it
 * went to their bookkeeper, 钱会计, who is running north up the East 3rd Ring for the airport road in a black Mercedes
 * built from the very parts Chen Ye took off them - steel in the doors, no use ramming. Chen Ye takes 大刘's car (with
 * nitro), catches it, draws alongside and leaps across (campaign/Hijack.ts: the chapter's new move), throws 钱会计 out,
 * shakes off Panther's SUVs and brings the ledger back to 大刘's, where it turns out to name a traffic cop on Panther's
 * payroll. Checkpoints: getting in 大刘's car, the chase (in it at the kerb, the Mercedes set off again), the getaway (in
 * the Mercedes where it was taken). Fails if 钱会计 gets past 四元桥 or the player falls 900 m behind.
 */
interface S {
  /** Where the Mercedes was taken (the getaway's checkpoint puts it back there). */
  cp: { x: number; z: number; yaw: number } | null;
  wrecked: number;
  stars: number;
  /** Leaps tried (one is the gold medal's). */
  leaps: number;
}
export type M3 = Chapter<S>;

const LIU_LIVERY: Livery = { upper: '#c3372b', lower: '#17181a', roofSign: null, plate: { text: '京B·L6606', bg: '#1d49b5', fg: '#ffffff' }, doorText: '刘记', doorColor: '#ffffff' };
const QIAN: Livery = { upper: '#0a0a0b', lower: '#0a0a0b', roofSign: null, plate: { text: '京N·0A001', bg: '#1d49b5', fg: '#ffffff' } };
const PANTHER: Livery = { upper: '#0b0b0c', lower: '#0b0b0c', roofSign: null, plate: { text: '京N·8B4T7', bg: '#1d49b5', fg: '#ffffff' }, doorText: '豹', doorColor: '#b8862b' };

/** Where 钱会计 is running to: 四元桥, where the airport expressway leaves the 4th ring. Past it he is gone. */
const [FLEE_X, FLEE_Z] = project(39.9705, 116.4815);
const FLEE = { x: FLEE_X, z: FLEE_Z };
/** How far up his route he is when the chase begins, metres (a search on from here for flat road). */
const HEAD_START = 260;
/** His top speed (a car in town traffic: the player's nitro is what catches him). */
const QIAN_TOP = 21;

export function chapter3(env: Env): M3 {
  const rng = new Rng(20261014), r = () => rng.next();
  const banner = new Banner();
  const lcar = new ScriptCar(env.engine, 'sedan', LIU_LIVERY);
  // 大刘's own: quicker, grippier, a bottle of nitro
  lcar.car.tune.torque = 1.22; lcar.car.tune.grip = 1.08; lcar.car.tune.nitro = 5;
  env.cars.add(lcar);
  const qian = new ScriptCar(env.engine, 'sedan', QIAN);
  env.cars.add(qian);
  const gang = new Gang(env);
  const chen: Look = { ...randomLook(r), fem: 0, age: 0.3, top: 'jacket', shirt: new THREE.Color('#1b1d21'), inner: new THREE.Color('#d8d4cc'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#22252b'), hairStyle: 'short', glasses: false, beard: false, cap: null, mask: null, print: false };
  const qianLook: Look = { ...randomLook(r), fem: 0, age: 0.55, build: 0.3, top: 'jacket', shirt: new THREE.Color('#3a3f47'), inner: new THREE.Color('#e8e6df'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#2a2d33'), hairStyle: 'short', glasses: true, beard: false, cap: null, mask: null, print: false } as Look;
  const who = {
    chen: (): Speaker => ({ name: t('cmp.who.chenye'), color: '#e8e4da', look: chen, voice: { pitch: 104, rate: 1, bright: 0.85, fem: 0, age: 0.3, character: 'chenye' }, at: null }),
    k: (): Speaker => ({ name: t('who.laok'), color: '#f3b50f', look: env.contacts?.appearance('laok'), voice: { pitch: 98, rate: 0.92, bright: 0.8, fem: 0, age: 0.62, character: 'laok' }, at: null }),
    yu: (): Speaker => ({ name: t('who.xiaoyu'), color: '#5ac8fa', look: env.contacts?.appearance('xiaoyu'), voice: { pitch: 215, rate: 1.05, bright: 1.1, fem: 1, age: 0.18, character: 'xiaoyu' }, at: null }),
    liu: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('who.daliu'), color: '#ff6b5a', look: env.contacts?.appearance('daliu'), voice: { pitch: 100, rate: 1, bright: 0.9, fem: 0, age: 0.45, character: 'daliu' }, at }),
    qian: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('cmp.who.qian'), color: '#9aa6b8', look: qianLook, voice: { pitch: 118, rate: 1.1, bright: 0.9, fem: 0, age: 0.55 }, at }),
  };
  const L = (s: Speaker, key: Parameters<typeof t>[0]): Line => ({ who: s, text: t(key) });

  // --- where things are -----------------------------------------------------------------------------------------
  const liuSpot = () => env.contacts?.spot('daliu') ?? null;
  /**
   * A pose `from` metres up the GPS route from (x, z) towards 四元桥, on a flat stretch of a proper road (no deck, no
   * slip road), facing the way the route goes: at the kerb (right of travel) or in the nearside lane.
   */
  const onRoute = (x: number, z: number, heading: number, from: number, kerb: boolean) => {
    const g = env.tr.graph, route = env.nav.route(x, z, heading, FLEE.x, FLEE.z), at = { x: 0, z: 0, dx: 0, dz: 0 };
    if (!route) return null;
    const p = route.pts;
    let s = 0;
    for (let i = 2; i < p.length; i += 2) {
      const sx = p[i] - p[i - 2], sz = p[i + 1] - p[i - 1], len = Math.hypot(sx, sz);
      s += len;
      if (s < from || len < 1e-3) continue;
      const ux = sx / len, uz = sz / len;
      for (const id of g.near(p[i], p[i + 1], 12)) {
        const l = g.links[id];
        if (l.hmax > 0.3 || l.len < 30 || ['service', 'living_street', 'footway'].includes(l.cls)) continue;
        const pr = g.project(l, p[i], p[i + 1], 0);
        if (pr.d > 6 || pr.s < 8 || pr.s > l.len - 8) continue;
        g.at(l, pr.s, 0, at);
        if (at.dx * ux + at.dz * uz < 0.85) continue;
        g.at(l, pr.s, kerb ? -Math.max(0.9, l.kerbR - 1.1) : g.laneOffset(l, 0), at);
        return { x: at.x, z: at.z, yaw: Math.atan2(at.dx, at.dz) };
      }
    }
    return null;
  };
  let liuPark: { x: number; z: number; yaw: number } | null = null;
  /**
   * 大刘's car at a kerb by his garage, already facing the way the chase goes (the nearest kerb was the far carriageway
   * of the 3rd Ring: the chase began with a U-turn while 钱会计 ran the other way).
   */
  const kerbForLiu = () => {
    if (liuPark) return liuPark;
    const s = liuSpot()!, g = env.tr.graph, at = { x: 0, z: 0, dx: 0, dz: 0 };
    // every kerb within 70 m, scored by the drive from it to 四元桥 plus three times the walk to it
    let best: { x: number; z: number; yaw: number } | null = null, bs = Infinity;
    for (const id of g.near(s.x, s.z, 70)) {
      const l = g.links[id];
      if (l.hmax > 0.3 || l.len < 30 || ['service', 'living_street', 'footway'].includes(l.cls)) continue;
      const pr = g.project(l, s.x, s.z, 0), ss = Math.max(8, Math.min(l.len - 8, pr.s));
      g.at(l, ss, -Math.max(0.9, l.kerbR - 1.1), at);
      const walk = Math.hypot(at.x - s.x, at.z - s.z), yaw = Math.atan2(at.dx, at.dz);
      if (walk > 70) continue;
      const r = env.nav.route(at.x, at.z, yaw, FLEE.x, FLEE.z);
      const score = (r?.len ?? Infinity) + walk * 3;
      if (score < bs) { bs = score; best = { x: at.x, z: at.z, yaw }; }
    }
    return liuPark = best ?? env.kerbPose(s.x, s.z, 8, FLEE) ?? { x: s.x + Math.sin(s.yaw) * 5, z: s.z + Math.cos(s.yaw) * 5, yaw: s.yaw + Math.PI / 2 };
  };
  /** Where the delivery ends: by the garage, a little along from where the car was picked up. */
  let dropPark: { x: number; z: number; yaw: number } | null = null;
  const kerbForDrop = () => { const s = liuSpot()!; return dropPark ??= env.kerbPose(s.x, s.z, 2) ?? { x: s.x, z: s.z, yaw: s.yaw }; };

  /**
   * 钱会计's start: HEAD_START m up the route from 大刘's kerb towards 四元桥, on a flat stretch of a road (no deck, no
   * slip road), in its lane, facing the way the route goes.
   */
  let qStart: { x: number; z: number; yaw: number } | null = null;
  const qianStart = () => {
    if (qStart) return qStart;
    const k = kerbForLiu();
    return qStart = onRoute(k.x, k.z, k.yaw, HEAD_START, false) ?? { x: k.x + Math.sin(k.yaw) * 120, z: k.z + Math.cos(k.yaw) * 120, yaw: k.yaw };
  };

  // --- mission-wide watch ---------------------------------------------------------------------------------------
  /** What the player must not lose once taken: the Mercedes (the ledger is in it). */
  let phase: 'none' | 'qian' = 'none';
  let away = 0, busted = false, frameDt = 0, quip = 0, spawned = false, rammed = false, hitT = 0;
  let escort: ScriptCar | null = null;
  env.engine.events.on('wanted:busted', () => { busted = true; });
  env.engine.events.on('vehicle:impact', (e: { strength?: number }) => {
    if (!chasing || rammed || hitT > 0 || (e.strength ?? 0) < 3 || !qian.on) return;
    const c = env.v.car.pos, q = qian.car.pos;
    if (Math.hypot(c.x - q.x, c.z - q.z) < 8) { rammed = true; hitT = 1; env.dialogue?.say(who.chen(), t('cmp.m3.c4'), { prio: 3 }); }
  });
  const resetWatch = () => { away = 0; busted = false; };
  const heal = () => { env.pl.heal(100); env.wanted?.clear(); };
  let chasing = false, aimT = 0, missT = -1;

  /** 钱会计 at his start, under way, and his escort behind him coming for the player. */
  const setOff = (scope: Scope) => {
    const q = qianStart();
    qian.place(q.x, q.z, q.yaw);
    qian.hp = 1e6;   // steel in the doors: rams spin him, nothing stops him
    qian.takeable = false;
    qian.chase(env.nav, () => ({ x: FLEE.x, z: FLEE.z, vx: 0, vz: 0 }), { top: QIAN_TOP });
    qian.car.setMoving(12);
    if (!escort) {
      escort = new ScriptCar(env.engine, 'suv', PANTHER);
      env.cars.add(escort);
      const e = escort;
      scope.defer(() => { e.remove(); env.cars.delete(e); if (escort === e) escort = null; });
    }
    escort.place(q.x - Math.sin(q.yaw) * 14, q.z - Math.cos(q.yaw) * 14, q.yaw);
    escort.car.setMoving(12);
    // it keeps behind him, and turns on the player once they close in
    const esc = escort;
    escort.chase(env.nav, () => {
      const c = env.v.car, es = esc.car, qc = qian.car;
      if (env.v.car !== qc && Math.hypot(c.pos.x - es.pos.x, c.pos.z - es.pos.z) < 70) return { x: c.pos.x, z: c.pos.z, vx: c.vel.x, vz: c.vel.z };
      return { x: qc.pos.x - qc.fwd.x * 14, z: qc.pos.z - qc.fwd.z * 14, vx: qc.vel.x, vz: qc.vel.z };
    }, { ram: true, top: 26 });
    scope.defer(() => qian.remove());
  };

  const hijack = new Hijack(env, {
    target: () => (chasing ? qian : null),
    label: () => t('cmp.m3.leapPrompt'),
    landed: () => { leapt = true; },
    missed: () => { missT = 0; env.dialogue?.say(who.yu(), t('cmp.m3.y4'), { prio: 3 }); },
  });
  let leapt = false;

  const def: M3 = {
    id: 'm3',
    title: t('cmp.m3.title'), kick: t('cmp.m3.kick'), who: t('cmp.m3.who'), blip: t('cmp.m3.blip'), giver: t('who.daliu'), glyph: '刘',
    start: () => { const s = liuSpot(); return s ? { x: s.x + Math.sin(s.yaw) * 1.8, z: s.z + Math.cos(s.yaw) * 1.8 } : null; },
    init: () => ({ cp: null, wrecked: 0, stars: 0, leaps: 0 }),
    tick(dt, st) {
      frameDt = dt; quip -= dt; hitT -= dt;
      if (st) { st.stars = Math.max(st.stars, env.wanted?.level ?? 0); st.leaps = Math.max(st.leaps, hijack.tries); }
    },
    guard() {
      if (env.pl.health <= 0) return t('cmp.why.wasted');
      if (busted) { busted = false; return t('cmp.why.busted'); }
      if (phase === 'qian') {
        const qc = qian.car;
        if ((env.damage?.health(qc) ?? 100) <= 0) return t('cmp.why.qianCar');
        if (env.v.car !== qc || env.pl.mode !== 'driving') {
          away += frameDt;
          if (away > 25 || Math.hypot(env.pl.position.x - qc.pos.x, env.pl.position.z - qc.pos.z) > 120) return t('cmp.why.leftQian');
        } else away = 0;
      } else away = 0;
      return null;
    },
    result(clock, st) {
      // ~7 km of driving (the 2-3 km chase, the getaway, ~4 back) and a minute of cutscenes: 10 minutes is brisk, 14 easy
      const hp = Math.round(env.damage?.health(qian.car) ?? 100), mins = clock / 60;
      const medal = mins < 10 && st.leaps <= 1 && st.stars === 0 ? 'gold' : mins < 14 && st.leaps <= 2 ? 'silver' : 'bronze';
      const pay = 2500 + (medal === 'gold' ? 700 : medal === 'silver' ? 300 : 0);
      const time = `${Math.floor(clock / 60)}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;
      return { rows: [[t('cmp.row.time'), time], [t('cmp.row.leaps'), String(Math.max(1, st.leaps))], [t('cmp.row.car'), `${hp}%`], [t('cmp.row.wrecked'), `${st.wrecked} / 3`], [t('cmp.row.stars'), st.stars ? '★'.repeat(st.stars) : '—']], medal, pay };
    },
    steps: [],
    debug: {
      lcar: () => lcar.car, qian: () => qian.car, escort: () => escort?.car ?? null, flee: () => FLEE, start: () => qianStart(),
      hijack: () => ({ tries: hijack.tries, busy: hijack.busy, aligned: hijack.aligned }),
      gang: () => gang.cars.map((c) => ({ on: c.on, hp: Math.round(c.hp), wreck: c.wreck >= 0, d: Math.round(c.car.pos.distanceTo(env.v.car.pos)), kmh: Math.round(c.car.speed * 3.6) })),
    },
  };

  /** The camera relative to a contact's spot: `side` metres across their facing, `out` along it, `up` high. */
  const around = (s: { x: number; z: number; yaw: number }, side: number, out: number, up: number): V3 => {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    return [s.x + fx * out + fz * side, up, s.z + fz * out - fx * side];
  };
  const contact = (scope: Scope, s: { x: number; z: number; yaw: number }) => {
    let a = env.contacts?.actor('daliu') ?? null;
    if (!a) {
      a = env.people?.spawnActor?.(s.x, s.z, { look: env.contacts?.appearance('daliu'), yaw: s.yaw }) ?? null;
      if (a) { const x = a; scope.defer(() => x.release('vanish')); }
    }
    return a;
  };
  /**
   * Chen Ye standing before 大刘, who turns to face him: on the garage side, away from the road (a lamp post stands a
   * metre in front of 大刘 on the kerb side and filled m2's over-the-shoulder shots), so the cameras look in off the road.
   */
  const ME = { side: 0.6, out: -1.8 };
  const atLiu = (scope: Scope, act: 'talk' | 'angry' | null) => {
    const s = liuSpot()!, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    const me = { x: s.x + fx * ME.out + fz * ME.side, z: s.z + fz * ME.out - fx * ME.side };
    env.putOnFoot(me.x, me.z, Math.atan2(s.x - me.x, s.z - me.z));
    const liu = contact(scope, s);
    liu?.face(me.x, me.z); if (act) liu?.act(act);
  };

  def.steps = [
    // 1. at 大刘's wrecked garage
    cutscene<S>(env, {
      id: 'intro',
      setup(ctx) {
        resetWatch(); phase = 'none'; leapt = false; hijack.tries = 0;
        atLiu(ctx.step, 'angry');
        const k = kerbForLiu();
        if (env.v.car !== lcar.car) lcar.place(k.x, k.z, k.yaw);
        ctx.mission.defer(() => lcar.remove());
      },
      shots: () => {
        const s = liuSpot()!, k = kerbForLiu();
        return [
          { from: around(s, 4, -7, 3), to: around(s, 3, -5, 2.4), look: around(s, 0.3, -0.9, 1.2), secs: 6 },
          { from: around(s, -0.3, -2.8, 1.65), look: around(s, 0, 0, 1.5), secs: 7, fov: 42 },
          { from: around(s, 0.5, 0.7, 1.4), look: around(s, ME.side, ME.out, 1.55), secs: 7, fov: 40 },
          { from: [s.x + (k.x - s.x) * 0.4 + 2, 2.4, s.z + (k.z - s.z) * 0.4 + 2], look: [k.x, 0.8, k.z], secs: 5 },
        ];
      },
      lines: () => {
        const at = liuSpot();
        return [L(who.liu(at), 'cmp.m3.d1'), L(who.chen(), 'cmp.m3.c1'), L(who.liu(at), 'cmp.m3.d2'), L(who.liu(at), 'cmp.m3.d3'), L(who.chen(), 'cmp.m3.c2'), L(who.liu(at), 'cmp.m3.d4')];
      },
    }),
    // 2. 大刘's car (checkpoint: at the kerb by the garage)
    getIn<S>(env, {
      id: 'getIn', checkpoint: true, car: () => lcar, line: t('cmp.m3.getIn'),
      restore(ctx) {
        resetWatch(); phase = 'none';
        const k = kerbForLiu(), s = liuSpot()!;
        lcar.place(k.x, k.z, k.yaw); env.damage?.repair(lcar.car); lcar.car.nitroFill = 1;
        ctx.mission.defer(() => lcar.remove());
        env.putOnFoot(s.x + Math.sin(s.yaw) * 1.8, s.z + Math.cos(s.yaw) * 1.8, s.yaw + Math.PI);
        heal();
      },
    }),
    call<S>('inCar', () => { lcar.takeable = false; lcar.car.nitroFill = 1; }),
    // 3. after 钱会计 (checkpoint: in 大刘's car at the kerb, the Mercedes set off up the road again)
    {
      id: 'chase', checkpoint: true,
      restore(ctx) {
        resetWatch(); phase = 'none';
        const k = kerbForLiu();
        env.putIn(lcar, k.x, k.z, k.yaw); env.damage?.repair(lcar.car); lcar.car.nitroFill = 1;
        ctx.mission.defer(() => lcar.remove());
        heal();
      },
      enter(ctx) {
        setOff(ctx.mission);
        chasing = true; rammed = false; aimT = 0; missT = -1; leapt = false;
        ctx.step.defer(() => { chasing = false; env.nav.clearTarget('mission'); });
        env.objective(t('cmp.m3.catch'));
        for (const l of [L(who.yu(), 'cmp.m3.y1'), L(who.yu(), 'cmp.m3.y2'), L(who.chen(), 'cmp.m3.c3')]) env.dialogue?.say(l.who, l.text, { prio: 3 });
      },
      update(ctx, dt) {
        const qc = qian.car, me = env.pl.position;
        if (leapt) return 'done';
        env.blips.push({ kind: 'suspect', x: qc.pos.x, z: qc.pos.z, heading: Math.atan2(qc.fwd.x, qc.fwd.z), flash: true });
        if (escort?.on && escort.wreck < 0) env.blips.push({ kind: 'suspect', x: escort.car.pos.x, z: escort.car.pos.z, heading: Math.atan2(escort.car.fwd.x, escort.car.fwd.z) });
        if ((aimT -= dt) <= 0) { aimT = 0.5; env.nav.setTarget({ x: qc.pos.x, z: qc.pos.z, kind: 'mission', label: t('cmp.m3.qianCar') }); }
        const d = Math.hypot(me.x - qc.pos.x, me.z - qc.pos.z);
        hijack.update();
        // what to do now: catch him, line up, or (down on the road after a miss) find a car
        const onFoot = env.pl.mode === 'onfoot';
        if (missT >= 0) missT += dt;
        env.objective(onFoot ? t('cmp.m3.missObj') : d < 45 ? t('cmp.m3.alongside') : t('cmp.m3.catch'));
        if (escort?.on && escort.wreck < 0 && quip <= 0 && escort.car.pos.distanceTo(env.v.car.pos) < 18 && !onFoot) { env.dialogue?.say(who.yu(), t('cmp.m3.y3'), { prio: 2 }); quip = 14; }
        if (Math.hypot(qc.pos.x - FLEE.x, qc.pos.z - FLEE.z) < 60 || (ctx.t > 25 && d > 900)) return { fail: t('cmp.why.qianGone') };
        return 'run';
      },
    },
    // 4. in the Mercedes: 钱会计 out on the road, the ledger on the seat
    call<S>('jacked', (ctx) => {
      phase = 'qian';
      const c = qian.car;
      ctx.state.cp = { x: c.pos.x, z: c.pos.z, yaw: Math.atan2(c.fwd.x, c.fwd.z) };
      banner.show(t('cmp.m3.jacked'), '#ffc21f'); setTimeout(() => banner.hide(), 1500);
      env.dialogue?.say(who.qian({ x: c.pos.x, z: c.pos.z }), t('cmp.m3.g1'), { prio: 3 });
      env.dialogue?.say(who.chen(), t('cmp.m3.c5'), { prio: 3 });
    }),
    // 5. Panther's SUVs (checkpoint: in the Mercedes where it was taken)
    {
      id: 'escape', checkpoint: true,
      restore(ctx) {
        resetWatch();
        const p = ctx.state.cp ?? { ...qianStart() };
        qian.place(p.x, p.z, p.yaw); qian.driver = null;
        env.putIn(qian, p.x, p.z, p.yaw);
        env.damage?.repair(qian.car);
        ctx.mission.defer(() => qian.remove());
        phase = 'qian';
        heal();
      },
      enter(ctx) {
        ctx.mission.defer(() => gang.remove());
        // the escort, if it is still running, joins them
        if (escort?.on && escort.wreck < 0 && !gang.cars.includes(escort)) {
          const e = escort; escort = null; gang.cars.push(e);
          e.chase(env.nav, () => { const c = env.v.car; return { x: c.pos.x, z: c.pos.z, vx: c.vel.x, vz: c.vel.z }; }, { ram: true, top: 27 });
        }
        env.objective(t('cmp.m2.lose'));
        quip = 8; spawned = false;
      },
      update(ctx, dt) {
        if (!spawned) {
          const want = 3 - gang.cars.filter((c) => c.on && c.wreck < 0).length;
          if ((want <= 0 || gang.spawn(() => new ScriptCar(env.engine, 'suv', PANTHER), want, 27) && gang.cars.length >= 3) || ctx.t > 6 && gang.cars.length) {
            spawned = true;
            banner.show(t('cmp.m1.ambush'), '#ff5a4a'); setTimeout(() => banner.hide(), 1800);
            env.dialogue?.say(who.yu(), t('cmp.m3.y5'), { prio: 3 });
          }
          return ctx.t > 12 ? 'done' : 'run';
        }
        const before = ctx.state.wrecked;
        // the Mercedes is quick: they have to be 260 m back for 8 s, not m2's truck's 220 for 6
        const res = gang.update(dt, 260, 8);
        ctx.state.wrecked = gang.wrecked;
        // give up after a minute: a heavy car does not shake an SUV on its tail for ever
        if (res === 'run' && ctx.t > 60) {
          for (const c of gang.cars) c.driver = null;
          env.dialogue?.say(who.yu(), t('cmp.m3.y6'), { prio: 3 });
          return 'done';
        }
        if (ctx.state.wrecked > before) env.dialogue?.say(who.yu(), t('cmp.m2.y5'), { prio: 2 });
        else if (quip <= 0 && gang.cars.some((c) => c.on && c.wreck < 0 && c.car.pos.distanceTo(env.v.car.pos) < 25)) {
          env.dialogue?.say(who.yu(), t(Math.random() < 0.5 ? 'cmp.m1.y4' : 'cmp.m1.y6'), { prio: 2 }); quip = 9;
        }
        return res;
      },
    },
    // 6. back to 大刘's
    drive<S>(env, { id: 'toLiu', line: t('cmp.m3.toLiu'), label: t('cmp.m2.liu'), r: 12, stop: true, to: () => kerbForDrop() }),
    // 7. the ledger names a cop
    cutscene<S>(env, {
      id: 'outro',
      setup(ctx) { phase = 'none'; atLiu(ctx.step, 'talk'); },
      shots: () => {
        const s = liuSpot()!;
        return [
          { from: around(s, 4, -7, 3), to: around(s, 3, -5, 2.4), look: around(s, 0.3, -0.9, 1.3), secs: 5 },
          { from: around(s, 0.5, 0.7, 1.4), look: around(s, ME.side, ME.out, 1.55), secs: 7, fov: 40 },
          { from: around(s, -0.3, -2.8, 1.65), look: around(s, 0, 0, 1.5), secs: 7, fov: 42 },
          { from: around(s, 3, -6, 2.6), to: around(s, 5, -9, 3.8), look: around(s, 0.3, -0.9, 1.2), secs: 7 },
        ];
      },
      lines: () => {
        const at = liuSpot();
        return [L(who.liu(at), 'cmp.m3.d5'), L(who.chen(), 'cmp.m3.c6'), L(who.liu(at), 'cmp.m3.d6'), L(who.k(), 'cmp.m3.k1'), L(who.chen(), 'cmp.m3.c7')];
      },
    }),
    wait<S>('end', 0.2),
  ];
  return def;
}
