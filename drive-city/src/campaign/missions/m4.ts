import * as THREE from 'three';
import { t } from '../../core/I18n';
import { CG, groups } from '../../core/Physics';
import { Rng } from '../../core/Rng';
import type { Actor, Speaker } from '../../game/Contracts';
import { randomLook, type Look } from '../../character/Body';
import { castModel, CAST_ON } from '../../character/Cast';
import { Banner } from '../../ui/Banner';
import { ScriptCar } from '../Cars';
import { fight } from '../Fight';
import { call, cutscene, getIn, wait, type Chapter, type Env, type Line, type V3 } from '../Kit';
import type { Scope } from '../Runner';
import { Meter } from '../Screens';
import { TAIL, Tail } from '../Tail';
import type { Livery } from '../../vehicle/CarModel';
import type { ParkingApi } from '../../parking';

/**
 * Chapter 4 《老周》 (docs/gta-plan.md §8): the ledger named 老周, a traffic cop who runs a tow yard outside 广渠门. Chen Ye
 * takes a plain grey car from by 老K's stall and tails 老周 across town without being seen (campaign/Tail.ts: the
 * chapter's new play), watches him meet Panther's men at the yard, is spotted, fights four of them among the parked
 * wrecks (combat/'s finisher: kick one into a car or a wall), catches 老周 as he runs for his station with the police
 * he called on the way, gets the next thing out of him - Panther's last load leaves by the 京哈 expressway on Friday,
 * through the 白鹿 toll gate - and loses the police. Checkpoints: getting in the grey car, the tail (in it at the kerb,
 * 老周 setting off again), the fight (on foot at the yard), the chase (in the grey car by the yard) and losing the
 * police (in the grey car where 老周 was caught).
 */
interface S {
  /** Where 老周 was caught (losing the police starts there again). */
  cp: { x: number; z: number; yaw: number } | null;
  ko: number;
  /** Finishers landed in this chapter's fight. */
  fin: number;
  /** The tail's most suspicion, 0..1. */
  peak: number;
}
export type M4 = Chapter<S>;

const GREY: Livery = { upper: '#6c7076', lower: '#6c7076', roofSign: null, plate: { text: '京E·3Q258', bg: '#1d49b5', fg: '#ffffff' } };
const ZHOU: Livery = { upper: '#b9bdc2', lower: '#b9bdc2', roofSign: null, plate: { text: '京A·5J731', bg: '#1d49b5', fg: '#ffffff' } };
const PANTHER: Livery = { upper: '#0b0b0c', lower: '#0b0b0c', roofSign: null, plate: { text: '京N·8B4T7', bg: '#1d49b5', fg: '#ffffff' }, doorText: '豹', doorColor: '#b8862b' };
/** The yard's wrecks and impounded cars: dull colours, plates as they were towed in. */
const WRECKS: Livery[] = ['#7a2622', '#2b3b52', '#d9d6cf', '#3f4a3a', '#8a7a5a', '#23262b'].map((c, i) => ({ upper: c, lower: c, roofSign: null, plate: { text: `京${'BCFGHJ'[i]}·${['7Z113', '2K905', 'L6602', '9D371', '4M288', 'P0546'][i]}`, bg: '#1d49b5', fg: '#ffffff' } }));

/**
 * The tow yard: the open ground east of a tertiary road outside 广渠门 (centre line through (4274, 371), running north;
 * `.scratch/m4/frame.mjs 4494 4274 371`: clear from 10 to 40 m east of the centre line and from 30 m south to 15 m
 * north of the origin, the pavement's trees at 7 m; 3 km by road from 老K's - a first cut by 双井 was 6 km, seven
 * minutes of tailing). The frame: `a` along the road (north), `b` across it into the yard (east); the northbound
 * kerb lane is at b 2.9.
 */
const SITE = { x: 4274.2, z: 371, ax: 0.0163, az: -0.99987, nx: 0.99987, nz: 0.0163 };
const KERB = 2.9;
/** Where 老周 runs when he bolts: his station, out east past the East 3rd Ring (2.2 km by road). Reach it and he is gone. */
const FLEE = { x: 6200, z: 400 };
/**
 * Where he is when the tail begins: the first point up the route from the grey car at least HEAD_START m off as the
 * crow flies and no further from the yard by road than DIRECT times the crow's distance from the car (past any loop
 * the route begins with: from 老K's it runs west to turn round before heading east - he starts east-bound).
 */
const HEAD_START = 220, DIRECT = 1.2;
/** His pace in town (the player follows at a sane speed), until the player has caught up with him, and when he bolts. */
const ZHOU_TOP = 13, ZHOU_EASY = 8, ZHOU_RUN = 19;
/** Where he parks, and where to stop and watch from: within this of him, and not closer than TAIL.NEAR. */
const WATCH_R = 90;

export function chapter4(env: Env): M4 {
  const rng = new Rng(20261015), r = () => rng.next();
  const banner = new Banner();
  const meter = new Meter();
  const tail = new Tail();
  const gcar = new ScriptCar(env.engine, 'sedan', GREY);
  env.cars.add(gcar);
  const zcar = new ScriptCar(env.engine, 'sedan', ZHOU);
  env.cars.add(zcar);
  const chen: Look = { ...randomLook(r), fem: 0, age: 0.3, top: 'jacket', shirt: new THREE.Color('#1b1d21'), inner: new THREE.Color('#d8d4cc'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#22252b'), hairStyle: 'short', glasses: false, beard: false, cap: null, mask: null, print: false };
  const zhouLook: Look = { ...randomLook(r), fem: 0, age: 0.58, build: 0.6, top: 'jacket', shirt: new THREE.Color('#2f3a4c'), inner: new THREE.Color('#dfe3e8'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#1f2633'), hairStyle: 'short', glasses: false, beard: false, cap: null, mask: null, print: false } as Look;
  const scarLook: Look = { ...randomLook(r), fem: 0, age: 0.4, build: 0.7, top: 'jacket', shirt: new THREE.Color('#141416'), inner: new THREE.Color('#141416'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#121214'), hairStyle: 'buzz', glasses: false, beard: false, cap: null, mask: null, print: false } as Look;
  const thugLook = (): Look => ({ ...randomLook(r), fem: 0, age: 0.25 + r() * 0.3, top: r() < 0.6 ? 'jacket' : 'tee', shirt: new THREE.Color(['#141416', '#1b1c1f', '#2a2d33'][Math.floor(r() * 3)]), inner: new THREE.Color('#141416'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#121214'), hairStyle: r() < 0.6 ? 'buzz' : 'short', glasses: false, cap: null, mask: null, print: false } as Look);
  const who = {
    chen: (): Speaker => ({ name: t('cmp.who.chenye'), color: '#e8e4da', look: chen, voice: { pitch: 104, rate: 1, bright: 0.85, fem: 0, age: 0.3, character: 'chenye' }, at: null }),
    k: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('who.laok'), color: '#f3b50f', look: env.contacts?.appearance('laok'), voice: { pitch: 98, rate: 0.92, bright: 0.8, fem: 0, age: 0.62, character: 'laok' }, at }),
    yu: (): Speaker => ({ name: t('who.xiaoyu'), color: '#5ac8fa', look: env.contacts?.appearance('xiaoyu'), voice: { pitch: 215, rate: 1.05, bright: 1.1, fem: 1, age: 0.18, character: 'xiaoyu' }, at: null }),
    zhou: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('cmp.who.zhou'), color: '#8fb3e0', look: zhouLook, voice: { pitch: 108, rate: 1.05, bright: 0.85, fem: 0, age: 0.58, character: 'laozhou' }, at }),
    scar: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('cmp.who.scar'), color: '#ff5a4a', look: scarLook, voice: { pitch: 100, rate: 1, bright: 0.85, fem: 0, age: 0.4 }, at }),
  };
  const L = (s: Speaker, key: Parameters<typeof t>[0]): Line => ({ who: s, text: t(key) });

  // --- where things are -----------------------------------------------------------------------------------------
  const P = (a: number, b: number) => ({ x: SITE.x + SITE.ax * a + SITE.nx * b, z: SITE.z + SITE.az * a + SITE.nz * b });
  const V = (a: number, b: number, h: number): V3 => { const p = P(a, b); return [p.x, h, p.z]; };
  const yawAlong = Math.atan2(SITE.ax, SITE.az);
  const yawInto = Math.atan2(SITE.nx, SITE.nz);
  /** 老周's spot at the kerb by the yard, and the people at the meet. */
  const PARK = P(-12, KERB);
  const ZHOU_AT = P(-8, 11), SCAR_AT = P(-5, 12.5);
  /** Chen Ye walked up to them (the fight's checkpoint), and where the fight is: in the ring of cars. */
  const ME = P(-11, 15), ARENA = P(-8, 20);
  /** The grey car at the kerb behind 老周's (the chase's checkpoint). */
  const GREY_YARD = P(-34, KERB);

  const kSpot = () => env.contacts?.spot('laok') ?? null;
  /**
   * A pose on the GPS route from (x, z) to `to`, HEAD_START m off as the crow flies and within DIRECT of the direct
   * distance by road, on a flat stretch of a proper road (no deck, no slip road), facing the way the route goes, in
   * the nearside lane.
   */
  const onRoute = (x: number, z: number, heading: number, to: { x: number; z: number }) => {
    const g = env.tr.graph, route = env.nav.route(x, z, heading, to.x, to.z), at = { x: 0, z: 0, dx: 0, dz: 0 };
    if (!route) return null;
    const p = route.pts, crow = Math.hypot(to.x - x, to.z - z);
    let s = 0;
    for (let i = 2; i < p.length; i += 2) {
      const sx = p[i] - p[i - 2], sz = p[i + 1] - p[i - 1], len = Math.hypot(sx, sz);
      s += len;
      if (len < 1e-3 || Math.hypot(p[i] - x, p[i + 1] - z) < HEAD_START || route.len - s > crow * DIRECT) continue;
      const ux = sx / len, uz = sz / len;
      for (const id of g.near(p[i], p[i + 1], 12)) {
        const l = g.links[id];
        if (l.hmax > 0.3 || l.len < 30 || ['service', 'living_street', 'footway'].includes(l.cls)) continue;
        const pr = g.project(l, p[i], p[i + 1], 0);
        if (pr.d > 6 || pr.s < 8 || pr.s > l.len - 8) continue;
        g.at(l, pr.s, 0, at);
        if (at.dx * ux + at.dz * uz < 0.85) continue;
        g.at(l, pr.s, g.laneOffset(l, 0), at);
        return { x: at.x, z: at.z, yaw: Math.atan2(at.dx, at.dz) };
      }
    }
    return null;
  };
  /**
   * The grey car at a kerb by the stall, already facing the way to the yard: of every kerb within 70 m, the one with
   * the shortest drive to the yard plus three times the walk (the nearest kerb's route began with a loop round a block,
   * and 老周, set off up it, was seen driving away and doubling back).
   */
  let gPark: { x: number; z: number; yaw: number } | null = null;
  const kerbForGrey = () => {
    if (gPark) return gPark;
    const s = kSpot()!, g = env.tr.graph, at = { x: 0, z: 0, dx: 0, dz: 0 };
    let best: { x: number; z: number; yaw: number } | null = null, bs = Infinity;
    for (const id of g.near(s.x, s.z, 70)) {
      const l = g.links[id];
      if (l.hmax > 0.3 || l.len < 30 || ['service', 'living_street', 'footway'].includes(l.cls)) continue;
      const pr = g.project(l, s.x, s.z, 0), ss = Math.max(8, Math.min(l.len - 8, pr.s));
      for (const dir of [1, -1]) {
        if (dir < 0 && l.oneway) continue;
        // right of travel: along the link at -kerb, against it at +kerb
        g.at(l, ss, -dir * Math.max(0.9, l.kerbR - 1.1), at);
        const walk = Math.hypot(at.x - s.x, at.z - s.z), yaw = Math.atan2(at.dx * dir, at.dz * dir);
        if (walk > 70) continue;
        const r = env.nav.route(at.x, at.z, yaw, PARK.x, PARK.z);
        const score = (r?.len ?? Infinity) + walk * 3;
        if (score < bs) { bs = score; best = { x: at.x, z: at.z, yaw }; }
      }
    }
    return gPark = best ?? env.kerbPose(s.x, s.z, 9, PARK) ?? { x: s.x + Math.sin(s.yaw) * 4, z: s.z + Math.cos(s.yaw) * 4, yaw: s.yaw + Math.PI / 2 };
  };
  /** 老周 at the start of the tail, up the grey car's route to the yard. */
  let zStart: { x: number; z: number; yaw: number } | null = null;
  const zhouStart = () => {
    if (zStart) return zStart;
    const k = kerbForGrey();
    return zStart = onRoute(k.x, k.z, k.yaw, PARK) ?? { x: k.x + Math.sin(k.yaw) * 120, z: k.z + Math.cos(k.yaw) * 120, yaw: k.yaw };
  };

  // --- the yard: built for the mission (again after a failure: the mission scope is cleared) ----------------------
  let yard: { cars: ScriptCar[]; deco: THREE.Group; body: import('@dimforge/rapier3d-compat').RigidBody } | null = null;
  const buildYard = (scope: Scope) => {
    if (yard) return yard;
    const cars: ScriptCar[] = [];
    const put = (body: 'suv' | 'sedan' | 'hatch', lv: Livery, a: number, b: number, yaw: number) => {
      const sc = new ScriptCar(env.engine, body, lv), p = P(a, b);
      sc.place(p.x, p.z, yaw);
      env.cars.add(sc); cars.push(sc);
    };
    // Panther's two SUVs either side of the meet and a row of towed cars behind it: a ring 5-6 m round where the
    // fight is (ARENA), what it gets slammed into; another row further back
    put('suv', PANTHER, -1.5, 17, yawInto + 0.45);
    put('suv', PANTHER, -16, 16, yawAlong + 0.25);
    for (const [i, a] of [-15, -9, -3].entries()) put(i === 1 ? 'hatch' : 'sedan', WRECKS[i], a, 24.5, yawInto + (i - 1) * 0.06);
    for (const [i, a] of [-12, -5, 2].entries()) put(i === 2 ? 'hatch' : 'sedan', WRECKS[i + 3], a, 31.5, yawInto + Math.PI + (i - 1) * 0.08);
    const deco = signBoard(), sp = P(-26, 8.6);
    deco.position.set(sp.x, 0, sp.z); deco.rotation.y = yawInto + Math.PI;
    env.engine.scene.add(deco);
    const { R, world } = env.engine.physics;
    const body = world.createRigidBody(R.RigidBodyDesc.fixed());
    for (const s of [-1.5, 1.5]) {
      const pp = P(-26 + s, 8.6);
      world.createCollider(R.ColliderDesc.cylinder(1.3, 0.09).setTranslation(pp.x, 1.3, pp.z).setCollisionGroups(groups(CG.WORLD, CG.ALL)), body);
    }
    yard = { cars, deco, body };
    env.engine.get<ParkingApi>('parking')?.clearAround(SITE.x - 15, SITE.z, 40, 900);
    scope.defer(() => {
      const y = yard;
      if (!y) return;
      yard = null;
      for (const c of y.cars) { c.remove(); env.cars.delete(c); }
      env.engine.scene.remove(y.deco);
      world.removeRigidBody(y.body);
      y.deco.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const mt of Array.isArray(m.material) ? m.material : [m.material]) { (mt as THREE.MeshStandardMaterial).map?.dispose(); mt.dispose(); }
      });
    });
    return yard;
  };

  // --- people --------------------------------------------------------------------------------------------------
  /** A scripted person who goes when `scope` does. */
  const extra = (scope: Scope, x: number, z: number, look: Look, yaw: number, model?: string): Actor | null => {
    const a = env.people?.spawnActor?.(x, z, { look, yaw }) ?? null;
    if (!a) return null;
    if (model && CAST_ON) void castModel(env.engine, model, look).then((h) => { if (a.alive) a.model = h; else h.hide(); }).catch(() => {});
    scope.defer(() => { if (a.alive) a.release('vanish'); });
    return a;
  };
  /** 老周 on foot (the meet, the fight: on the phone by his car), and Panther's men at the meet. */
  let zhouMan: Actor | null = null;
  let cast: Actor[] = [];
  const zhouOnFoot = (scope: Scope, x: number, z: number, yaw: number) => {
    if (zhouMan?.alive) { zhouMan.puppet?.(null); return zhouMan; }
    zhouMan = extra(scope, x, z, zhouLook, yaw);
    if (zhouMan) zhouMan.fair = true;
    return zhouMan;
  };
  const dropZhou = () => { if (zhouMan?.alive) zhouMan.release('vanish'); zhouMan = null; };
  const dropCast = () => { for (const a of cast) if (a.alive) a.release('vanish'); cast = []; };

  // --- mission-wide watch ---------------------------------------------------------------------------------------
  let busted = false, quip = 0, hits = 0, hitT = 0, still = 0, aimT = 0;
  /** The tail's lines said once, 老周 pulling in / parked, seconds stopped watching him. */
  const said = new Set<string>();
  let parked = false, slowed = false, paced = false, watchT = 0;
  let caughtAt: { zp: { x: number; z: number }; me: { x: number; z: number } } | null = null;
  let phase: 'none' | 'tail' | 'chase' | 'fight' = 'none';
  env.engine.events.on('wanted:busted', () => { busted = true; });
  env.engine.events.on('vehicle:impact', (e: { strength?: number }) => {
    if ((e.strength ?? 0) < 3 || !zcar.on || hitT > 0) return;
    const c = env.v.car.pos, z = zcar.car.pos;
    if (Math.hypot(c.x - z.x, c.z - z.z) > 8) return;
    hitT = 0.8;
    if (phase === 'tail') tail.bump();
    else if (phase === 'chase') hits++;
  });
  let finSaid = false, finCount: ((n: number) => void) | null = null;
  env.engine.events.on('combat:finisher', () => {
    if (phase !== 'fight') return;
    finCount?.(1);
    if (!finSaid) { finSaid = true; env.dialogue?.say(who.chen(), t('cmp.m4.c6'), { prio: 3 }); }
  });
  const resetWatch = () => { busted = false; };
  const heal = () => { env.pl.heal(100); env.wanted?.clear(); };
  /** The police on the player, 老周's call, two stars (a report is a star at any level). */
  const callCops = () => { const w = env.wanted, p = env.pl.position; if (!w) return; for (let i = 0; i < 2 && w.level < 2; i++) w.crime('report', p.x, p.z); };

  /** 老周 driving off to `to` at `top`. */
  const drive = (to: { x: number; z: number }, top: number) => zcar.chase(env.nav, () => ({ x: to.x, z: to.z, vx: 0, vz: 0 }), { top });

  const def: M4 = {
    id: 'm4',
    title: t('cmp.m4.title'), kick: t('cmp.m4.kick'), who: t('cmp.m4.who'), blip: t('cmp.m4.blip'), giver: t('who.laok'), glyph: 'K',
    start: () => { const s = kSpot(); return s ? { x: s.x + Math.sin(s.yaw) * 1.7, z: s.z + Math.cos(s.yaw) * 1.7 } : null; },
    init: () => ({ cp: null, ko: 0, fin: 0, peak: 0 }),
    tick(dt, st) {
      quip -= dt; hitT -= dt;
      if (st) st.peak = Math.max(st.peak, tail.peak);
    },
    guard() {
      if (env.pl.health <= 0) return t('cmp.why.wasted');
      if (busted) { busted = false; return t('cmp.why.busted'); }
      return null;
    },
    result(clock, st) {
      // ~4 km of tailing at a town pace, a fight, a 1-3 km chase and losing two stars, and two minutes of cutscenes:
      // 12 minutes is good going, 16 easy
      const mins = clock / 60;
      const medal = mins < 12 && st.peak < 0.5 && st.fin >= 1 ? 'gold' : mins < 16 && st.peak < 0.8 ? 'silver' : 'bronze';
      const pay = 2800 + (medal === 'gold' ? 900 : medal === 'silver' ? 400 : 0);
      const time = `${Math.floor(clock / 60)}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;
      return { rows: [[t('cmp.row.time'), time], [t('cmp.row.alert'), `${Math.round(st.peak * 100)}%`], [t('cmp.row.ko'), `${st.ko} / 4`], [t('cmp.row.finishers'), String(st.fin)]], medal, pay };
    },
    steps: [],
    debug: {
      gcar: () => gcar.car, zcar: () => zcar.car, zhou: () => zhouMan, site: () => SITE, park: () => PARK, flee: () => FLEE, start: () => zhouStart(),
      tail: () => ({ alert: +tail.alert.toFixed(3), peak: +tail.peak.toFixed(3), farT: +tail.farT.toFixed(2) }),
      yard: () => yard?.cars.map((c) => c.car) ?? [],
    },
  };

  /** The camera relative to a contact's spot: `side` metres across their facing, `out` along it, `up` high. */
  const around = (s: { x: number; z: number; yaw: number }, side: number, out: number, up: number): V3 => {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    return [s.x + fx * out + fz * side, up, s.z + fz * out - fx * side];
  };
  const contactK = (scope: Scope, s: { x: number; z: number; yaw: number }) => {
    let a = env.contacts?.actor('laok') ?? null;
    if (!a) {
      a = env.people?.spawnActor?.(s.x, s.z, { look: env.contacts?.appearance('laok'), yaw: s.yaw }) ?? null;
      if (a) { a.act('drink', { seat: 0.36 }); const x = a; scope.defer(() => x.release('vanish')); }
    }
    return a;
  };
  /** 老周's car parked at the kerb by the yard, his engine off. */
  const parkZhou = () => { zcar.driver = null; zcar.takeable = false; zcar.place(PARK.x, PARK.z, yawAlong); zcar.hp = 1e4; };
  /** 老周 on the phone by his car, through the fight. */
  const zhouCalling = (scope: Scope) => {
    const zp = P(-13, 6.2), m = zhouOnFoot(scope, zp.x, zp.z, yawInto + Math.PI);
    m?.goTo(zp.x, zp.z, 1.6); m?.act('phone');
  };
  /** The player on foot at the yard's edge (the fight's retry). */
  const atYard = (scope: Scope) => {
    buildYard(scope);
    parkZhou();
    env.putOnFoot(ME.x, ME.z, Math.atan2(ZHOU_AT.x - ME.x, ZHOU_AT.z - ME.z));
    if (env.v.car !== gcar.car) { gcar.place(GREY_YARD.x, GREY_YARD.z, yawAlong); scope.defer(() => gcar.remove()); }
    zhouCalling(scope);
    heal();
  };

  def.steps = [
    // 1. at 老K's stall
    cutscene<S>(env, {
      id: 'intro',
      setup(ctx) {
        resetWatch(); phase = 'none'; tail.reset();
        const s = kSpot()!, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
        env.putOnFoot(s.x + fx * 1.7, s.z + fz * 1.7, s.yaw + Math.PI);
        contactK(ctx.mission, s)?.face(s.x + fx * 1.7, s.z + fz * 1.7);
        const k = kerbForGrey();
        if (env.v.car !== gcar.car) gcar.place(k.x, k.z, k.yaw);
        ctx.mission.defer(() => gcar.remove());
      },
      shots: () => {
        const s = kSpot()!, k = kerbForGrey();
        return [
          { from: around(s, 5, 6, 2.4), to: around(s, 3.2, 4.8, 2.1), look: around(s, 0, 0.6, 1.1), secs: 6 },
          { from: around(s, -0.95, 3.0, 1.68), look: around(s, 0, 0, 1.0), look2: around(s, 0.15, 0, 1.0), secs: 7, fov: 38 },
          { from: around(s, 0.75, -0.6, 1.3), look: around(s, 0, 1.7, 1.55), secs: 6, fov: 40 },
          { from: [s.x + (k.x - s.x) * 0.4 + 2, 2.6, s.z + (k.z - s.z) * 0.4 + 2], look: [k.x, 0.8, k.z], secs: 5 },
        ];
      },
      lines: () => {
        const at = kSpot();
        return [L(who.k(at), 'cmp.m4.k1'), L(who.chen(), 'cmp.m4.c1'), L(who.k(at), 'cmp.m4.k2'), L(who.k(at), 'cmp.m4.k3'), L(who.k(at), 'cmp.m4.k4'), L(who.chen(), 'cmp.m4.c2')];
      },
    }),
    // 2. the grey car (checkpoint: at the kerb by the stall)
    getIn<S>(env, {
      id: 'getIn', checkpoint: true, car: () => gcar, line: t('cmp.m4.getIn'),
      restore(ctx) {
        resetWatch(); phase = 'none'; tail.reset();
        const k = kerbForGrey(), s = kSpot()!;
        gcar.place(k.x, k.z, k.yaw); env.damage?.repair(gcar.car);
        ctx.mission.defer(() => gcar.remove());
        env.putOnFoot(s.x + Math.sin(s.yaw) * 1.7, s.z + Math.cos(s.yaw) * 1.7, s.yaw + Math.PI);
        heal();
      },
    }),
    call<S>('inCar', () => { gcar.takeable = false; }),
    // 3. after him, unseen (checkpoint: in the grey car at the kerb, 老周 setting off up the road again)
    {
      id: 'tail', checkpoint: true,
      restore(ctx) {
        resetWatch(); phase = 'none';
        const k = kerbForGrey();
        env.putIn(gcar, k.x, k.z, k.yaw); env.damage?.repair(gcar.car);
        ctx.mission.defer(() => gcar.remove());
        heal();
      },
      enter(ctx) {
        phase = 'tail'; tail.reset(); quip = 0;
        const z = zhouStart();
        zcar.place(z.x, z.z, z.yaw); zcar.hp = 1e4; zcar.takeable = false;
        drive(PARK, ZHOU_EASY);
        zcar.car.setMoving(8);
        ctx.mission.defer(() => zcar.remove());
        meter.show(t('cmp.m4.alert'));
        ctx.step.defer(() => { meter.hide(); env.nav.clearTarget('mission'); if (phase === 'tail') phase = 'none'; });
        env.objective(t('cmp.m4.tail'));
        for (const l of [L(who.yu(), 'cmp.m4.y1'), L(who.yu(), 'cmp.m4.y2')]) env.dialogue?.say(l.who, l.text, { prio: 3 });
        said.clear(); parked = false; slowed = false; watchT = 0; paced = false;
      },
      update(ctx, dt) {
        const zc = zcar.car, me = env.pl.position;
        if (zcar.wreck >= 0) return { fail: t('cmp.why.spotted') };
        env.blips.push({ kind: 'suspect', x: zc.pos.x, z: zc.pos.z, heading: Math.atan2(zc.fwd.x, zc.fwd.z) });
        if ((aimT -= dt) <= 0) { aimT = 0.5; env.nav.setTarget({ x: zc.pos.x, z: zc.pos.z, kind: 'mission', label: t('cmp.m4.zhouCar') }); }
        // pulling in: slow to the kerb, then the engine off
        const toPark = Math.hypot(zc.pos.x - PARK.x, zc.pos.z - PARK.z);
        if (!parked && toPark < 45 && zcar.driver) {
          if (toPark < 6) { zcar.driver = null; parked = true; env.objective(t('cmp.m4.watch')); env.dialogue?.say(who.yu(), t('cmp.m4.y5'), { prio: 3 }); }
          else if (!slowed) { slowed = true; drive(PARK, 5); }
        }
        const dx = me.x - zc.pos.x, dz = me.z - zc.pos.z, d = Math.hypot(dx, dz);
        const ahead = d > 1 && (dx * zc.fwd.x + dz * zc.fwd.z) / d > 0.3 && !parked;
        const st = tail.update(dt, d, ahead);
        // caught up: his own pace from here
        if (tail.caught && !paced && !slowed && !parked) { paced = true; drive(PARK, ZHOU_TOP); }
        const hot = st === 'near' || st === 'far' || tail.alert > 0.6;
        meter.set(tail.alert, hot && tail.caught, !tail.caught ? t('cmp.m4.catchUp') : st === 'near' ? t('cmp.m4.close') : st === 'far' ? t('cmp.m4.far') : '');
        if (st === 'spotted') { zcar.driver = null; return { fail: t('cmp.why.spotted') }; }
        if (st === 'lost') return { fail: t('cmp.why.lostZhou') };
        const once = (k: Parameters<typeof t>[0], s: Speaker, ok: boolean) => { if (ok && !said.has(k) && quip <= 0) { said.add(k); quip = 6; env.dialogue?.say(s, t(k), { prio: 3 }); } };
        once('cmp.m4.c3', who.chen(), tail.alert > 0.5);
        once('cmp.m4.y3', who.yu(), st === 'far' && tail.caught);
        once('cmp.m4.y4', who.yu(), ctx.t > 70 && !parked);
        // parked: stop somewhere within WATCH_R of him (and not on top of him) and watch
        if (parked) {
          const slow = env.pl.mode !== 'driving' || env.v.car.speed < 3;
          watchT = slow && d < WATCH_R && d > TAIL.NEAR ? watchT + dt : 0;
          if (watchT > 1) return 'done';
        }
        return 'run';
      },
    },
    // 4. the meet, watched from the car
    cutscene<S>(env, {
      id: 'meet',
      setup(ctx) {
        phase = 'none';
        buildYard(ctx.mission);
        parkZhou();
        dropCast(); dropZhou();
        zhouOnFoot(ctx.mission, ZHOU_AT.x, ZHOU_AT.z, Math.atan2(SCAR_AT.x - ZHOU_AT.x, SCAR_AT.z - ZHOU_AT.z));
        zhouMan?.act('talk');
        const scar = extra(ctx.mission, SCAR_AT.x, SCAR_AT.z, scarLook, Math.atan2(ZHOU_AT.x - SCAR_AT.x, ZHOU_AT.z - SCAR_AT.z), 'thug1');
        scar?.act('angry');
        const t1 = P(-1, 13.5), t2 = P(1.5, 19);
        const a1 = extra(ctx.mission, t1.x, t1.z, thugLook(), yawAlong + Math.PI, 'thug2');
        const a2 = extra(ctx.mission, t2.x, t2.z, thugLook(), yawInto + Math.PI, 'thug3');
        a2?.face(PARK.x, PARK.z);
        cast = [scar, a1, a2].filter((a): a is Actor => !!a);
        ctx.mission.defer(() => { dropCast(); });
      },
      shots: () => [
        { from: V(-42, -3.5, 3.4), to: V(-36, -2.5, 3), look: V(-6, 12, 1.2), secs: 6 },
        { from: V(-11.5, 15, 1.7), look: V(-6.5, 11.7, 1.5), secs: 7, fov: 40 },
        { from: V(-5.6, 9.2, 1.62), look: V(-8, 11, 1.58), secs: 7, fov: 38 },
        { from: V(3, 20.5, 1.75), look: V(-30, 2, 1.2), secs: 5, fov: 45 },
      ],
      lines: () => [L(who.scar(SCAR_AT), 'cmp.m4.g1'), L(who.zhou(ZHOU_AT), 'cmp.m4.z1'), L(who.zhou(ZHOU_AT), 'cmp.m4.z2'), L(who.scar(SCAR_AT), 'cmp.m4.g2'), L(who.zhou(ZHOU_AT), 'cmp.m4.z3'), L(who.scar(SCAR_AT), 'cmp.m4.g3'), L(who.zhou(ZHOU_AT), 'cmp.m4.z4'), L(who.chen(), 'cmp.m4.c4')],
    }),
    // 5. Chen Ye walks up
    cutscene<S>(env, {
      id: 'face',
      setup(ctx) {
        buildYard(ctx.mission);
        env.putOnFoot(ME.x, ME.z, Math.atan2(ZHOU_AT.x - ME.x, ZHOU_AT.z - ME.z));
        zhouMan?.face(ME.x, ME.z); zhouMan?.act('point');
        for (const a of cast) a.face(ME.x, ME.z);
      },
      shots: () => [
        { from: V(-14.5, 13, 1.85), look: V(-4, 11.5, 1.4), secs: 4, fov: 45 },
        { from: V(-6.4, 9.1, 1.62), look: V(-4, 11, 1.58), secs: 4, fov: 40 },
        { from: V(-6.8, 13.2, 1.7), look: V(-11, 15, 1.55), secs: 4, fov: 42 },
      ],
      lines: () => [L(who.chen(), 'cmp.m4.c5'), L(who.zhou(ZHOU_AT), 'cmp.m4.z5')],
    }),
    // 6. the fight among the wrecks (checkpoint: on foot at the yard's edge)
    fight<S>(env, {
      id: 'fight', checkpoint: true, line: t('cmp.m4.fight'), n: 4, tough: 1.15, fled: t('cmp.why.fledFight'),
      at: () => ARENA,
      restore(ctx) { resetWatch(); phase = 'none'; atYard(ctx.mission); ctx.state.ko = 0; ctx.state.fin = 0; },
      enter(ctx) {
        dropCast();
        phase = 'fight'; finSaid = false;
        finCount = (n) => { ctx.state.fin += n; };
        ctx.step.defer(() => { finCount = null; if (phase === 'fight') phase = 'none'; });
        zhouCalling(ctx.mission);
        env.dialogue?.say(who.zhou(P(-13, 6.2)), t('cmp.m4.z6'), { prio: 2 });
      },
      ko(ctx, n) { ctx.state.ko = n; },
    }),
    // 7. 老周 bolts, the police on the way (checkpoint: in the grey car behind his, 老周 setting off)
    {
      id: 'chase', checkpoint: true,
      restore(ctx) {
        resetWatch(); phase = 'none';
        buildYard(ctx.mission);
        parkZhou();
        env.putIn(gcar, GREY_YARD.x, GREY_YARD.z, yawAlong); env.damage?.repair(gcar.car);
        ctx.mission.defer(() => gcar.remove());
        heal();
      },
      enter(ctx) {
        dropZhou();
        if (!zcar.on || zcar.driver) parkZhou();
        zcar.hp = 1e4;
        drive(FLEE, ZHOU_RUN);
        zcar.car.setMoving(4);
        phase = 'chase'; hits = 0; still = 0; aimT = 0;
        // on foot at the yard: the grey car (or any) is the way after him
        gcar.takeable = env.v.car !== gcar.car && gcar.on;
        ctx.step.defer(() => { gcar.takeable = false; env.nav.clearTarget('mission'); if (phase === 'chase') phase = 'none'; });
        callCops();
        env.objective(t('cmp.m4.chase', { n: 0 }));
        env.dialogue?.say(who.yu(), t('cmp.m4.y6'), { prio: 3 });
      },
      update(ctx, dt) {
        const zc = zcar.car, me = env.pl.position;
        if (env.v.car === gcar.car) gcar.takeable = false;
        env.blips.push({ kind: 'suspect', x: zc.pos.x, z: zc.pos.z, heading: Math.atan2(zc.fwd.x, zc.fwd.z), flash: true });
        if ((aimT -= dt) <= 0) { aimT = 0.5; env.nav.setTarget({ x: zc.pos.x, z: zc.pos.z, kind: 'mission', label: t('cmp.m4.zhouCar') }); }
        env.objective(t('cmp.m4.chase', { n: Math.min(3, hits) }));
        const d = Math.hypot(me.x - zc.pos.x, me.z - zc.pos.z);
        still = env.pl.mode === 'driving' && d < 9 && zc.speed < 2.5 && ctx.t > 4 ? still + dt : 0;
        if (hits >= 3 || still > 1.5) {
          zcar.driver = null;
          const c = zc.pos;
          ctx.state.cp = { x: c.x, z: c.z, yaw: Math.atan2(zc.fwd.x, zc.fwd.z) };
          banner.show(t('cmp.m4.stopped'), '#ffc21f'); setTimeout(() => banner.hide(), 1600);
          return 'done';
        }
        if (Math.hypot(zc.pos.x - FLEE.x, zc.pos.z - FLEE.z) < 50 || (ctx.t > 25 && d > 900)) return { fail: t('cmp.why.zhouGone') };
        return 'run';
      },
    },
    // 8. caught: what 老周 knows
    cutscene<S>(env, {
      id: 'caught',
      setup(ctx) {
        phase = 'none';
        env.wanted?.clear();   // the police are on their way, not here yet: no arrest mid-scene
        // both cars brought to a stand where they are (rammed to a stop, they still coasted at 50 km/h and knocked
        // 老周 flying from beside his door)
        zcar.driver = null;
        const zc = zcar.car;
        zcar.place(zc.pos.x, zc.pos.z, Math.atan2(zc.fwd.x, zc.fwd.z), Math.max(0, zc.pos.y - zc.spec.wheelRadius - 0.07)); zcar.hp = 1e4;
        const mine = env.v.car.body;
        mine.setLinvel({ x: 0, y: 0, z: 0 }, true); mine.setAngvel({ x: 0, y: 0, z: 0 }, true);
        const c = zcar.car, f = c.fwd, l = c.left, p = c.pos;
        const zp = { x: p.x + l.x * 1.5 + f.x * 0.2, z: p.z + l.z * 1.5 + f.z * 0.2 }, me = { x: p.x + l.x * 2.7 - f.x * 0.4, z: p.z + l.z * 2.7 - f.z * 0.4 };
        if (env.pl.mode === 'driving') env.pl.getOut();
        env.putOnFoot(me.x, me.z, Math.atan2(zp.x - me.x, zp.z - me.z));
        dropZhou();
        zhouOnFoot(ctx.mission, zp.x, zp.z, Math.atan2(me.x - zp.x, me.z - zp.z));
        zhouMan?.act('stagger');
        caughtAt = { zp, me };
      },
      shots: () => {
        const c = zcar.car.pos, l = zcar.car.left, f = zcar.car.fwd, { zp, me } = caughtAt!;
        const ux = zp.x - me.x, uz = zp.z - me.z, ul = Math.hypot(ux, uz) || 1;
        return [
          { from: [c.x + l.x * 7 + f.x * 5, 3, c.z + l.z * 7 + f.z * 5], to: [c.x + l.x * 5.5 + f.x * 3.5, 2.4, c.z + l.z * 5.5 + f.z * 3.5], look: [zp.x, 1.2, zp.z], secs: 5 },
          { from: [me.x - ux / ul * 1.1 - uz / ul * 0.45, 1.7, me.z - uz / ul * 1.1 + ux / ul * 0.45], look: [zp.x, 1.5, zp.z], secs: 7, fov: 40 },
          { from: [zp.x + ux / ul * 1.2 + uz / ul * 0.5, 1.65, zp.z + uz / ul * 1.2 - ux / ul * 0.5], look: [me.x, 1.55, me.z], secs: 6, fov: 40 },
          { from: [c.x + l.x * 8 - f.x * 6, 4, c.z + l.z * 8 - f.z * 6], look: [me.x, 1.2, me.z], secs: 5 },
        ];
      },
      lines: () => { const zp = caughtAt?.zp ?? null; return [L(who.zhou(zp), 'cmp.m4.z7'), L(who.chen(), 'cmp.m4.c7'), L(who.zhou(zp), 'cmp.m4.z8'), L(who.chen(), 'cmp.m4.c8')]; },
    }),
    call<S>('sirens', () => {
      zhouMan?.act(null);
      if (zhouMan?.alive) { zhouMan.release('flee'); zhouMan = null; }
      callCops();
      env.dialogue?.say(who.yu(), t('cmp.m4.y7'), { prio: 3 });
    }),
    // 9. lose the police (checkpoint: in the grey car where 老周 was caught, two stars)
    {
      id: 'lose', checkpoint: true,
      restore(ctx) {
        resetWatch(); phase = 'none';
        const p = ctx.state.cp ?? { x: GREY_YARD.x, z: GREY_YARD.z, yaw: yawAlong };
        env.putIn(gcar, p.x, p.z, p.yaw); env.damage?.repair(gcar.car);
        ctx.mission.defer(() => gcar.remove());
        heal();
        callCops();
      },
      enter() { env.objective(t('cmp.m4.lose')); },
      update(ctx) {
        // a beat for the stars to show; then done once they are gone
        return ctx.t > 2 && (env.wanted?.level ?? 0) === 0 ? 'done' : 'run';
      },
    },
    // 10. 老K on the phone
    {
      id: 'outro',
      enter() {
        env.objective(null);
        for (const l of [L(who.yu(), 'cmp.m4.y8'), L(who.k(), 'cmp.m4.k5'), L(who.chen(), 'cmp.m4.c9'), L(who.k(), 'cmp.m4.k6')]) env.dialogue?.say(l.who, l.text, { prio: 3 });
      },
      update(ctx) { return ctx.t > 1 && !env.dialogue?.busy ? 'done' : 'run'; },
    },
    wait<S>('end', 0.2),
  ];
  return def;
}

/** 「顺达拖车」 on a lightbox between two posts (canvas text, lit at night). */
function signBoard(): THREE.Group {
  const g = new THREE.Group();
  const cv = document.createElement('canvas'); cv.width = 512; cv.height = 160;
  const c = cv.getContext('2d')!;
  c.fillStyle = '#0f2340'; c.fillRect(0, 0, 512, 160);
  c.fillStyle = '#e8eef5'; c.fillRect(0, 0, 512, 8); c.fillRect(0, 152, 512, 8);
  c.fillStyle = '#ffffff'; c.font = 'bold 76px "PingFang SC","Noto Sans SC","Microsoft YaHei",sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
  c.fillText('顺达拖车', 256, 66);
  c.fillStyle = '#ffd34d'; c.font = '27px "PingFang SC","Noto Sans SC",sans-serif'; c.fillText('事故车停放 · 交通队指定', 256, 126);
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
