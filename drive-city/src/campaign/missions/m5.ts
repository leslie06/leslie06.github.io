import * as THREE from 'three';
import { t } from '../../core/I18n';
import { Rng } from '../../core/Rng';
import type { Actor, RenderApi, Speaker } from '../../game/Contracts';
import { randomLook, type Look } from '../../character/Body';
import { castModel, CAST_ON } from '../../character/Cast';
import { Banner } from '../../ui/Banner';
import { ScriptCar } from '../Cars';
import { fight } from '../Fight';
import { Hijack } from '../Hijack';
import { call, cutscene, drive, Gang, jump, wait, type Chapter, type Env, type Line, type V3 } from '../Kit';
import type { Scope } from '../Runner';
import { POLICE_LIVERY, type Livery } from '../../vehicle/CarModel';
import type { BodyType } from '../../vehicle/Bodies';

/**
 * Chapter 5 《白鹿》 (docs/gta-plan.md §9), the end of the first act: Friday night, Panther's last load leaves Beijing by
 * the 京哈 expressway - a scout SUV, the armoured box truck, Panther himself behind in a black limousine. 老K and 大刘 go
 * ahead to block the 白鹿 toll gate; Chen Ye, in a sports coupe 大刘 took off Panther's people (nitro full), runs the
 * convoy down on the expressway, leaps onto the truck (campaign/Hijack.ts) and drives it to the gate with Panther's
 * cars on him. At the gate Panther gets out with three men: the last fight (combat/'s boss), and 王队 takes him away.
 * Checkpoints: the convoy (in the coupe on the expressway, the convoy set off again), the truck (in it where it was
 * taken), the fight (on foot by the truck). Fails if the convoy reaches the gate with the truck, or the player falls
 * 900 m behind it.
 */
interface S {
  /** Where the truck was taken (its checkpoint puts it back there). */
  cp: { x: number; z: number; yaw: number } | null;
  wrecked: number;
  ko: number;
  leaps: number;
  stars: number;
}
export type M5 = Chapter<S>;

const LIU_COUPE: Livery = { upper: '#2a2c30', lower: '#c3372b', roofSign: null, plate: { text: '京B·L6607', bg: '#1d49b5', fg: '#ffffff' } };
const K_LIVERY: Livery = { upper: '#111214', lower: '#111214', roofSign: null, plate: { text: '京A·K8888', bg: '#1d49b5', fg: '#ffffff' }, doorText: 'K', doorColor: '#f3b50f' };
const LIU_LIVERY: Livery = { upper: '#c3372b', lower: '#17181a', roofSign: null, plate: { text: '京B·L6606', bg: '#1d49b5', fg: '#ffffff' }, doorText: '刘记', doorColor: '#ffffff' };
const PANTHER: Livery = { upper: '#0b0b0c', lower: '#0b0b0c', roofSign: null, plate: { text: '京N·8B4T7', bg: '#1d49b5', fg: '#ffffff' }, doorText: '豹', doorColor: '#b8862b' };
const BOSS_CAR: Livery = { upper: '#0a0a0b', lower: '#0a0a0b', roofSign: null, plate: { text: '京N·88888', bg: '#1d49b5', fg: '#ffffff' } };
const TRUCK: Livery = { upper: '#ecebe6', lower: '#ecebe6', roofSign: null, plate: { text: '京N·5H2P9', bg: '#d8b31c', fg: '#111111' }, doorText: '豹', doorColor: '#b8862b' };

/** The toll gate (manifest.named 北京白鹿收费站) and the road the convoy runs on to it. */
const GATE_NAME = '北京白鹿收费站', ROAD = '京哈高速';
/**
 * Where the chase begins: on the expressway about this x, and how far ahead the convoy is. Past the 1.4 km viaduct east
 * of 四方桥 (8830-10240): a deck's colliders are only built near the camera, and the convoy 400 m ahead of a first
 * start at 8500 drove off the end of what was solid and fell to the road beneath (see `deckGuard` for the short bridges
 * still ahead).
 */
const START_X = 10420, AHEAD = 380;
/** The convoy's pace: the truck's top speed (the coupe's nitro is what catches it), its escorts' when they turn. */
const TRUCK_TOP = 23, ESCORT_TOP = 31;
/** How far before the gate the truck stops (and the convoy is through if it gets this near untaken). */
const STOP_BEFORE = 55, THROUGH = 120;

export function chapter5(env: Env): M5 {
  const rng = new Rng(20261018), r = () => rng.next();
  const banner = new Banner();
  // The cars are made when the chapter runs, not now: the coupe's and the limousine's models come after the title,
  // and a ScriptCar made before its body is in is a saloon for good.
  const made = new Map<string, ScriptCar>();
  const car = (key: string, body: BodyType, lv: Livery) => {
    let c = made.get(key);
    if (!c) { c = new ScriptCar(env.engine, body, lv); made.set(key, c); env.cars.add(c); }
    return c;
  };
  const coupe = () => car('coupe', 'coupe', LIU_COUPE);
  const truck = () => car('truck', 'truck', TRUCK);
  const scout = () => car('scout', 'suv', PANTHER);
  const limo = () => car('limo', 'limo', BOSS_CAR);
  const kcar = () => car('kcar', 'sedan', K_LIVERY);
  const lcar = () => car('lcar', 'sedan', LIU_LIVERY);
  const cop = () => car('cop', 'sedan', POLICE_LIVERY);
  const gang = new Gang(env);

  const chen: Look = { ...randomLook(r), fem: 0, age: 0.3, top: 'jacket', shirt: new THREE.Color('#1b1d21'), inner: new THREE.Color('#d8d4cc'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#22252b'), hairStyle: 'short', glasses: false, beard: false, cap: null, mask: null, print: false };
  const bossLook: Look = { ...randomLook(r), fem: 0, age: 0.48, build: 0.75, top: 'jacket', shirt: new THREE.Color('#2a1d16'), inner: new THREE.Color('#141416'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#121214'), hairStyle: 'buzz', glasses: false, beard: false, cap: null, mask: null, print: false } as Look;
  const driverLook: Look = { ...randomLook(r), fem: 0, age: 0.35, top: 'jacket', shirt: new THREE.Color('#141416'), inner: new THREE.Color('#141416'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#121214'), hairStyle: 'buzz', glasses: false, cap: null, mask: null, print: false } as Look;
  const thugLook = (): Look => ({ ...randomLook(r), fem: 0, age: 0.25 + r() * 0.3, top: r() < 0.6 ? 'jacket' : 'tee', shirt: new THREE.Color(['#141416', '#1b1c1f', '#2a2d33'][Math.floor(r() * 3)]), inner: new THREE.Color('#141416'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: new THREE.Color('#121214'), hairStyle: r() < 0.6 ? 'buzz' : 'short', glasses: false, cap: null, mask: null, print: false } as Look);
  const who = {
    chen: (): Speaker => ({ name: t('cmp.who.chenye'), color: '#e8e4da', look: chen, voice: { pitch: 104, rate: 1, bright: 0.85, fem: 0, age: 0.3, character: 'chenye' }, at: null }),
    k: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('who.laok'), color: '#f3b50f', look: env.contacts?.appearance('laok'), voice: { pitch: 98, rate: 0.92, bright: 0.8, fem: 0, age: 0.62, character: 'laok' }, at }),
    yu: (): Speaker => ({ name: t('who.xiaoyu'), color: '#5ac8fa', look: env.contacts?.appearance('xiaoyu'), voice: { pitch: 215, rate: 1.05, bright: 1.1, fem: 1, age: 0.18, character: 'xiaoyu' }, at: null }),
    liu: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('who.daliu'), color: '#ff6b5a', look: env.contacts?.appearance('daliu'), voice: { pitch: 100, rate: 1, bright: 0.9, fem: 0, age: 0.45, character: 'daliu' }, at }),
    boss: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('cmp.who.baoge'), color: '#b8862b', look: bossLook, voice: { pitch: 90, rate: 0.95, bright: 0.75, fem: 0, age: 0.48, character: 'baoge' }, at }),
    driver: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('cmp.who.trucker'), color: '#9aa6b8', look: driverLook, voice: { pitch: 112, rate: 1.1, bright: 0.9, fem: 0, age: 0.35 }, at }),
    wang: (at: { x: number; z: number } | null = null): Speaker => ({ name: t('who.wang'), color: '#6f9dff', look: env.contacts?.appearance('wang'), voice: { pitch: 102, rate: 0.98, bright: 0.85, fem: 0, age: 0.5, character: 'wang' }, at }),
  };
  const L = (s: Speaker, key: Parameters<typeof t>[0]): Line => ({ who: s, text: t(key) });

  // --- where things are -----------------------------------------------------------------------------------------
  const kSpot = () => env.contacts?.spot('laok') ?? null;
  /** The gate's point (manifest.named), and the eastbound carriageway at it: its centre and the way it runs. */
  let gateCache: { x: number; z: number; dx: number; dz: number } | null = null;
  const gate = () => {
    if (gateCache) return gateCache;
    const world = env.engine.get<{ name: string; manifest?: { named: Record<string, [number, number]> } }>('world');
    const [gx, gz] = world?.manifest?.named[GATE_NAME] ?? [15044.7, 4706.2];
    // the canopy may have been moved along the road off the station's office (city/visual/TollPlazas)
    const tp = env.engine.get<{ name: string; plazas: { name: string; x: number; z: number }[] }>('tollPlazas')?.plazas.find((p) => p.name === GATE_NAME);
    const px = tp?.x ?? gx, pz = tp?.z ?? gz;
    const g = env.tr.graph, at = { x: 0, z: 0, dx: 0, dz: 0 };
    let best: { x: number; z: number; dx: number; dz: number } | null = null, bd = Infinity;
    for (const id of g.near(px, pz, 90)) {
      const l = g.links[id];
      if (l.name !== ROAD) continue;
      const pr = g.project(l, px, pz, 0);
      g.at(l, pr.s, 0, at);
      if (at.dx < 0.5 || pr.d >= bd) continue;
      bd = pr.d; best = { x: at.x, z: at.z, dx: at.dx, dz: at.dz };
    }
    return gateCache = best ?? { x: px, z: pz + 20, dx: 1, dz: 0 };
  };
  /** A point on the eastbound carriageway `back` metres before the gate, `side` metres across (right of travel +). */
  const atGate = (back: number, side = 0) => { const G = gate(); return { x: G.x - G.dx * back - G.dz * side, z: G.z - G.dz * back + G.dx * side }; };
  const gateYaw = () => Math.atan2(gate().dx, gate().dz);
  const STOP = () => atGate(STOP_BEFORE);
  /** The coupe's start: the expressway eastbound near START_X, on the flat, in the second lane. */
  let startCache: { x: number; z: number; yaw: number } | null = null;
  const start = () => {
    if (startCache) return startCache;
    const g = env.tr.graph, at = { x: 0, z: 0, dx: 0, dz: 0 };
    let best: { x: number; z: number; yaw: number } | null = null, bd = Infinity;
    for (const l of g.links) {
      if (l.name !== ROAD || l.hmax > 0.3 || l.len < 60) continue;
      g.at(l, l.len / 2, 0, at);
      if (at.dx < 0.8 || Math.abs(at.x - START_X) >= bd) continue;
      bd = Math.abs(at.x - START_X);
      g.at(l, l.len / 2, g.laneOffset(l, Math.min(1, l.lanes - 1)), at);
      best = { x: at.x, z: at.z, yaw: Math.atan2(at.dx, at.dz) };
    }
    return startCache = best ?? { x: START_X, z: 4420, yaw: Math.PI / 2 };
  };
  /**
   * A pose `from` metres up the GPS route from (x, z) to the gate, in lane `lane`, facing along it, with the road's height
   * there (the expressway east of 四方桥 is a viaduct for 2 km: the convoy is placed up on it).
   */
  const onRoute = (x: number, z: number, heading: number, from: number, lane: number) => {
    const g = env.tr.graph, S0 = STOP(), route = env.nav.route(x, z, heading, S0.x, S0.z), at = { x: 0, z: 0, dx: 0, dz: 0 };
    if (!route) return null;
    // every 10 m along the route, not only at its points: on a straight expressway those are kilometres apart (the first
    // cut put the convoy 4 km ahead)
    const p = route.pts;
    let s = 0;
    for (let i = 2; i < p.length; i += 2) {
      const sx = p[i] - p[i - 2], sz = p[i + 1] - p[i - 1], len = Math.hypot(sx, sz);
      if (len < 1e-3) continue;
      const ux = sx / len, uz = sz / len;
      for (let u = Math.max(0, from - s); u <= len; u += 10) {
        const x = p[i - 2] + ux * u, z = p[i - 1] + uz * u;
        for (const id of g.near(x, z, 12)) {
          const l = g.links[id];
          if (l.len < 30) continue;
          const pr = g.project(l, x, z, 0);
          if (pr.d > 8 || pr.s < 8 || pr.s > l.len - 8) continue;
          g.at(l, pr.s, 0, at);
          if (at.dx * ux + at.dz * uz < 0.85) continue;
          g.at(l, pr.s, g.laneOffset(l, Math.min(lane, l.lanes - 1)), at);
          return { x: at.x, z: at.z, yaw: Math.atan2(at.dx, at.dz), y: g.heightAt(l, pr.s) };
        }
      }
      s += len;
    }
    return null;
  };

  // --- mission-wide watch ---------------------------------------------------------------------------------------
  let phase: 'none' | 'truck' = 'none';
  let away = 0, busted = false, frameDt = 0, quip = 0, hitT = 0, rammed = false, spawned = false, aimT = 0;
  let chasing = false, leapt = false, spotted = false, near3k = false, near1k = false;
  env.engine.events.on('wanted:busted', () => { busted = true; });
  env.engine.events.on('vehicle:impact', (e: { strength?: number }) => {
    if (!chasing || rammed || hitT > 0 || (e.strength ?? 0) < 3 || !truck().on) return;
    const c = env.v.car.pos, q = truck().car.pos;
    if (Math.hypot(c.x - q.x, c.z - q.z) < 9) { rammed = true; hitT = 1; env.dialogue?.say(who.chen(), t('cmp.m5.c3'), { prio: 3 }); }
  });
  const resetWatch = () => { away = 0; busted = false; };
  const heal = () => { env.pl.heal(100); env.wanted?.clear(); };
  /** Friday night: from day or dusk the clock goes to half past nine (after midnight it is left alone). */
  const night = () => { const rd = env.engine.get<RenderApi>('render'); if (rd && rd.timeOfDay > 5 && rd.timeOfDay < 21) rd.timeOfDay = 21.5; };

  /** The convoy at its start ahead of the coupe, under way: the scout before the truck, Panther behind it. */
  const setOff = (scope: Scope, from: { x: number; z: number; yaw: number }) => {
    const T = onRoute(from.x, from.z, from.yaw, AHEAD, 1) ?? { x: from.x + Math.sin(from.yaw) * AHEAD, z: from.z + Math.cos(from.yaw) * AHEAD, yaw: from.yaw, y: 0 };
    const fx = Math.sin(T.yaw), fz = Math.cos(T.yaw);
    const tr = truck(), sc = scout(), lm = limo();
    // the escorts at the same height (a viaduct's grade over 28 m is well under a metre)
    tr.place(T.x, T.z, T.yaw, T.y); tr.hp = 1e6; tr.takeable = false;
    sc.place(T.x + fx * 28, T.z + fz * 28, T.yaw, T.y + 0.3);
    lm.place(T.x - fx * 24, T.z - fz * 24, T.yaw, T.y + 0.3); lm.hp = 160;
    const S0 = STOP();
    tr.chase(env.nav, () => ({ x: S0.x, z: S0.z, vx: 0, vz: 0 }), { top: TRUCK_TOP });
    // The escorts keep station on the truck and turn on the player once they come close - not one already ahead of
    // them (a first cut rammed, missed, ran on far past the truck and then tried to turn round on the expressway for
    // its place behind it, and stuck). Off station they aim down the road past their slot and set their pace by it:
    // behind it they hurry, ahead of it they ease off and let the truck come up.
    const escort = (c: ScriptCar, off: number, turn: number) => {
      let pace = ESCORT_TOP;
      c.chase(env.nav, () => {
        const p = env.v.car, tc = tr.car, cc = c.car, d = Math.hypot(p.pos.x - cc.pos.x, p.pos.z - cc.pos.z);
        const ahead = (p.pos.x - cc.pos.x) * cc.fwd.x + (p.pos.z - cc.pos.z) * cc.fwd.z;
        if (env.v.car !== tc && d < turn && ahead > -12) {
          if (!spotted) { spotted = true; env.dialogue?.say(who.yu(), t('cmp.m5.y2'), { prio: 3 }); }
          pace = ESCORT_TOP;
          return { x: p.pos.x, z: p.pos.z, vx: p.vel.x, vz: p.vel.z };
        }
        const sx = tc.pos.x + tc.fwd.x * off, sz = tc.pos.z + tc.fwd.z * off;
        const past = (cc.pos.x - sx) * tc.fwd.x + (cc.pos.z - sz) * tc.fwd.z;   // > 0: ahead of its slot
        pace = Math.max(6, Math.min(ESCORT_TOP, tc.speed - past * 0.3));
        return { x: sx + tc.fwd.x * 60, z: sz + tc.fwd.z * 60, vx: tc.vel.x, vz: tc.vel.z };
      }, { ram: true, top: () => pace });
    };
    escort(sc, 28, 70); escort(lm, -24, 90);
    for (const c of [tr, sc, lm]) c.car.setMoving(20);
    // all three go when the mission does (a failed chase left the truck driving on for good); one the player is in stays
    scope.defer(() => { for (const c of [tr, sc, lm]) if (env.v.car !== c.car) c.remove(); });
  };

  /**
   * After the truck: a hunter rams the player, then drops back 30 m for 2.5 s before it comes again. Driving straight
   * at them (Pursuit's ram) the first cut stayed glued to the truck's tail at full throttle, two cars pushing it along:
   * the player could not brake and ran past the gate. Within 300 m of the gate they give up and roll to a stop.
   */
  const hunted = new Set<ScriptCar>();
  const hunt = (c: ScriptCar) => {
    if (hunted.has(c)) return;
    hunted.add(c);
    let back = 0;
    c.chase(env.nav, () => {
      const p = env.v.car, d = Math.hypot(p.pos.x - c.car.pos.x, p.pos.z - c.car.pos.z);
      if (d < 6.5) back = 150;
      if (back > 0) { back--; return { x: p.pos.x - p.fwd.x * 30, z: p.pos.z - p.fwd.z * 30, vx: p.vel.x, vz: p.vel.z }; }
      return { x: p.pos.x, z: p.pos.z, vx: p.vel.x, vz: p.vel.z };
    }, { ram: true, top: () => (back > 0 ? Math.max(8, env.v.car.speed - 5) : ESCORT_TOP) });
  };

  const hijack = new Hijack(env, {
    target: () => (chasing ? truck() : null),
    label: () => t('cmp.m5.leapPrompt'),
    landed: () => { leapt = true; },
    missed: () => { env.dialogue?.say(who.yu(), t('cmp.m5.y3'), { prio: 3 }); },
  });

  // --- people at the gate ---------------------------------------------------------------------------------------
  /** A scripted person who goes when `scope` does, in a cast model if there is one. */
  const extra = (scope: Scope, x: number, z: number, look: Look | undefined, yaw: number, model?: string): Actor | null => {
    const a = env.people?.spawnActor?.(x, z, { look, yaw }) ?? null;
    if (!a) return null;
    if (model && CAST_ON && look) void castModel(env.engine, model, look).then((h) => { if (a.alive) a.model = h; else h.hide(); }).catch(() => {});
    scope.defer(() => { if (a.alive) a.release('vanish'); });
    return a;
  };
  /** The block across the carriageway (老K's car and 大刘's), and traffic round the gate held where it is. */
  const block = (scope: Scope) => {
    const y = gateYaw() + Math.PI / 2;
    for (const [c, side] of [[kcar(), 2.9], [lcar(), -2.9]] as const) {
      const p = atGate(18, side);
      if (!c.on || Math.hypot(c.car.pos.x - p.x, c.car.pos.z - p.z) > 3) c.place(p.x, p.z, y + (side > 0 ? 0.12 : -0.1));
      c.driver = null; c.takeable = false;
      scope.defer(() => c.remove());
    }
    // the road round the gate kept clear of traffic while the scene plays (cars held where they were stood in the
    // shots, one bus right through the camera): every half second, anything driving in is taken off
    clearing = true; clearT = 0;
    scope.defer(() => { clearing = false; });
  };
  let clearing = false, clearT = 0;
  const keepClear = (dt: number) => {
    if (!clearing || (clearT -= dt) > 0) return;
    clearT = 0.5;
    const c = atGate(STOP_BEFORE / 2);
    env.tr.clearNear?.(c.x, c.z, 170);
  };
  /** The truck stopped where it ends its run, Panther's car behind it, everyone's engine off. */
  const settleCars = (scope: Scope) => {
    const S0 = STOP(), y = gateYaw(), G = gate();
    const tr = truck();
    if (env.v.car !== tr.car) { tr.place(S0.x, S0.z, y); scope.defer(() => tr.remove()); }
    tr.driver = null;
    const lp = atGate(STOP_BEFORE + 16, 1.2), lm = limo();
    lm.place(lp.x, lp.z, y + 0.08); lm.driver = null; lm.hp = 1e4;
    scope.defer(() => lm.remove());
    for (const c of gang.cars) c.driver = null;
    void G;
  };
  /** The camera: `back` m before the gate along the road, `side` across, `up` high. */
  const V = (back: number, side: number, up: number): V3 => { const p = atGate(back, side); return [p.x, up, p.z]; };

  /**
   * Mission cars far from the camera on a deck: the lane under them says the road is up there, the physics has nothing
   * (colliders are built near the camera only). Held at the deck's height so they cross the bridges ahead whole.
   */
  const deckLink = new Map<ScriptCar, number>();
  const deckGuard = (sc: ScriptCar) => {
    if (!sc.on || env.v.car === sc.car) return;
    const c = sc.car, cam = env.engine.camera.position;
    if (Math.hypot(c.pos.x - cam.x, c.pos.z - cam.z) < 220) return;
    const g = env.tr.graph, at = { x: 0, z: 0, dx: 0, dz: 0 };
    const id = deckLink.get(sc);
    let best = -1, bd = 8, bs = 0, dx = 0, dz = 0;
    for (const lid of [...(id !== undefined ? [id] : []), ...g.near(c.pos.x, c.pos.z, 10)]) {
      const l = g.links[lid], pr = g.project(l, c.pos.x, c.pos.z, 0);
      if (pr.d >= bd) continue;
      g.at(l, pr.s, 0, at);
      if (at.dx * c.fwd.x + at.dz * c.fwd.z < 0.7) continue;
      bd = pr.d; best = lid; bs = pr.s; dx = at.dx; dz = at.dz;
    }
    if (best < 0) return;
    deckLink.set(sc, best);
    const h = g.heightAt(g.links[best], bs), y = h + c.spec.wheelRadius + 0.05;
    if (h < 0.5 || c.pos.y > y - 0.3) return;
    // its wheels touch nothing up here, so it can neither drive nor steer: carried on along the lane at its speed
    const v = c.body.linvel(), sp = Math.max(12, Math.hypot(v.x, v.z));
    c.body.setTranslation({ x: c.pos.x, y, z: c.pos.z }, true);
    c.body.setLinvel({ x: dx * sp, y: 0, z: dz * sp }, true);
  };

  const def: M5 = {
    id: 'm5',
    title: t('cmp.m5.title'), kick: t('cmp.m5.kick'), who: t('cmp.m5.who'), blip: t('cmp.m5.blip'), giver: t('who.laok'), glyph: 'K',
    start: () => { const s = kSpot(); return s ? { x: s.x + Math.sin(s.yaw) * 1.7, z: s.z + Math.cos(s.yaw) * 1.7 } : null; },
    init: () => ({ cp: null, wrecked: 0, ko: 0, leaps: 0, stars: 0 }),
    tick(dt, st) {
      frameDt = dt; quip -= dt; hitT -= dt;
      for (const c of made.values()) deckGuard(c);
      keepClear(dt);
      for (const c of gang.cars) deckGuard(c);
      if (st) { st.stars = Math.max(st.stars, env.wanted?.level ?? 0); st.leaps = Math.max(st.leaps, hijack.tries); }
    },
    guard() {
      if (env.pl.health <= 0) return t('cmp.why.wasted');
      if (busted) { busted = false; return t('cmp.why.busted'); }
      if (phase === 'truck') {
        const tc = truck().car;
        if ((env.damage?.health(tc) ?? 100) <= 0) return t('cmp.why.truck');
        if (env.v.car !== tc || env.pl.mode !== 'driving') {
          away += frameDt;
          if (away > 25 || Math.hypot(env.pl.position.x - tc.pos.x, env.pl.position.z - tc.pos.z) > 120) return t('cmp.why.leftTruck');
        } else away = 0;
      } else away = 0;
      return null;
    },
    result(clock, st) {
      // ~5 km of expressway (the chase and the run to the gate), a fight and two minutes of cutscenes: 10 is quick, 14 easy
      const hp = Math.round(env.damage?.health(truck().car) ?? 100), mins = clock / 60;
      const medal = mins < 10 && st.leaps <= 1 && hp >= 60 ? 'gold' : mins < 14 && st.leaps <= 2 ? 'silver' : 'bronze';
      const pay = 3800 + (medal === 'gold' ? 1200 : medal === 'silver' ? 500 : 0);
      const time = `${Math.floor(clock / 60)}:${String(Math.floor(clock % 60)).padStart(2, '0')}`;
      return { rows: [[t('cmp.row.time'), time], [t('cmp.row.leaps'), String(Math.max(1, st.leaps))], [t('cmp.row.truck'), `${hp}%`], [t('cmp.row.wrecked'), String(st.wrecked)], [t('cmp.row.ko'), `${st.ko} / 4`]], medal, pay };
    },
    steps: [],
    debug: {
      coupe: () => coupe().car, truck: () => truck().car, scout: () => scout().car, limo: () => limo().car,
      gate: () => gate(), stop: () => STOP(), start: () => start(),
      hijack: () => ({ tries: hijack.tries, busy: hijack.busy, aligned: hijack.aligned }),
      gang: () => gang.cars.map((c) => ({ on: c.on, hp: Math.round(c.hp), wreck: c.wreck >= 0, d: Math.round(c.car.pos.distanceTo(env.v.car.pos)), kmh: Math.round(c.car.speed * 3.6) })),
    },
  };

  /** The camera relative to a contact's spot: `side` metres across their facing, `out` along it, `up` high. */
  const around = (s: { x: number; z: number; yaw: number }, side: number, out: number, up: number): V3 => {
    const fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
    return [s.x + fx * out + fz * side, up, s.z + fz * out - fx * side];
  };

  def.steps = [
    // 1. 老K's stall at night, 大刘 with him
    cutscene<S>(env, {
      id: 'intro',
      setup(ctx) {
        resetWatch(); phase = 'none'; leapt = false; hijack.tries = 0; spotted = false; near3k = near1k = false;
        night();
        const s = kSpot()!, fx = Math.sin(s.yaw), fz = Math.cos(s.yaw);
        const me = { x: s.x + fx * 1.7, z: s.z + fz * 1.7 };
        env.putOnFoot(me.x, me.z, s.yaw + Math.PI);
        let k = env.contacts?.actor('laok') ?? null;
        if (!k) { k = extra(ctx.step, s.x, s.z, env.contacts?.appearance('laok'), s.yaw, 'laok'); k?.act('drink', { seat: 0.36 }); }
        k?.face(me.x, me.z);
        const lx = s.x + fx * 1.2 + fz * 1.6, lz = s.z + fz * 1.2 - fx * 1.6;
        const liu = extra(ctx.step, lx, lz, env.contacts?.appearance('daliu'), Math.atan2(me.x - lx, me.z - lz), 'daliu');
        liu?.act('talk');
      },
      shots: () => {
        const s = kSpot()!;
        return [
          { from: around(s, 4, 6, 3), to: around(s, 3, 4.5, 2.4), look: around(s, 0, 0.9, 1.2), secs: 6 },
          { from: around(s, 0.4, 3.4, 1.55), look: around(s, 0, 0, 1.2), secs: 7, fov: 42 },
          { from: around(s, -2.2, 0.8, 1.5), look: around(s, 1.4, 1.4, 1.4), secs: 7, fov: 42 },
          { from: around(s, -0.4, -0.6, 1.4), look: around(s, 0, 1.7, 1.55), secs: 6, fov: 40 },
        ];
      },
      lines: () => {
        const at = kSpot();
        return [L(who.k(at), 'cmp.m5.k1'), L(who.liu(at), 'cmp.m5.d1'), L(who.liu(at), 'cmp.m5.d2'), L(who.chen(), 'cmp.m5.c1'), L(who.k(at), 'cmp.m5.k2'), L(who.liu(at), 'cmp.m5.d3'), L(who.chen(), 'cmp.m5.c2')];
      },
    }),
    // 2. the cut to the expressway: 10 pm, the convoy ahead (checkpoint: the coupe there, the convoy set off again)
    jump<S>(env, {
      id: 'toRoad', checkpoint: true, car: coupe, caption: t('cmp.m5.cut'),
      restore() { resetWatch(); phase = 'none'; night(); heal(); },
      to: () => start(),
      then(ctx) {
        const c = coupe();
        c.takeable = false;
        c.car.tune.torque = 1.1; c.car.tune.nitro = 6; c.car.nitroFill = 1;
        env.damage?.repair(c.car);
        c.car.setMoving(22);
        ctx.mission.defer(() => c.remove());
      },
    }),
    // 3. run the convoy down and take the truck
    {
      id: 'convoy',
      enter(ctx) {
        setOff(ctx.mission, start());
        chasing = true; rammed = false; aimT = 0; leapt = false;
        ctx.step.defer(() => { chasing = false; env.nav.clearTarget('mission'); });
        env.objective(t('cmp.m5.catch'));
        env.dialogue?.say(who.yu(), t('cmp.m5.y1'), { prio: 3 });
      },
      update(ctx, dt) {
        const tc = truck().car, me = env.pl.position;
        if (leapt) return 'done';
        env.blips.push({ kind: 'suspect', x: tc.pos.x, z: tc.pos.z, heading: Math.atan2(tc.fwd.x, tc.fwd.z), flash: true });
        for (const c of [scout(), limo()]) if (c.on && c.wreck < 0) env.blips.push({ kind: 'suspect', x: c.car.pos.x, z: c.car.pos.z, heading: Math.atan2(c.car.fwd.x, c.car.fwd.z) });
        if ((aimT -= dt) <= 0) { aimT = 0.5; env.nav.setTarget({ x: tc.pos.x, z: tc.pos.z, kind: 'mission', label: t('cmp.m5.truck') }); }
        const d = Math.hypot(me.x - tc.pos.x, me.z - tc.pos.z);
        hijack.update();
        const onFoot = env.pl.mode === 'onfoot';
        env.objective(onFoot ? t('cmp.m3.missObj') : d < 45 ? t('cmp.m5.alongside') : t('cmp.m5.catch'));
        const S0 = STOP();
        if (Math.hypot(tc.pos.x - S0.x, tc.pos.z - S0.z) < THROUGH) return { fail: t('cmp.why.convoyThrough') };
        if (ctx.t > 25 && d > 900) return { fail: t('cmp.why.convoyGone') };
        return 'run';
      },
    },
    // 4. in the truck: its driver out on the road, Panther on the radio
    call<S>('jacked', (ctx) => {
      phase = 'truck';
      const c = truck().car;
      ctx.state.cp = { x: c.pos.x, z: c.pos.z, yaw: Math.atan2(c.fwd.x, c.fwd.z) };
      banner.show(t('cmp.m3.jacked'), '#ffc21f'); setTimeout(() => banner.hide(), 1500);
      env.dialogue?.say(who.driver({ x: c.pos.x, z: c.pos.z }), t('cmp.m5.g1'), { prio: 3 });
      env.dialogue?.say(who.chen(), t('cmp.m5.c4'), { prio: 3 });
      env.dialogue?.say(who.boss(), t('cmp.m5.b1'), { prio: 3 });
      env.dialogue?.say(who.chen(), t('cmp.m5.c5'), { prio: 3 });
    }),
    // 5. the truck to the gate with Panther's cars on it (checkpoint: in the truck where it was taken)
    drive<S>(env, {
      id: 'toGate', checkpoint: true, line: t('cmp.m5.toGate'), label: t('cmp.m5.gate'), r: 14, stop: true, to: () => STOP(),
      restore(ctx) {
        resetWatch();
        const p = ctx.state.cp ?? start();
        const tr = truck();
        tr.place(p.x, p.z, p.yaw); tr.driver = null; tr.hp = 1e6;
        env.putIn(tr, p.x, p.z, p.yaw);
        env.damage?.repair(tr.car);
        ctx.mission.defer(() => tr.remove());
        phase = 'truck'; night(); heal();
        // Panther's car behind, under way
        const lm = limo(), fx = Math.sin(p.yaw), fz = Math.cos(p.yaw);
        lm.place(p.x - fx * 40, p.z - fz * 40, p.yaw); lm.hp = 160; lm.car.setMoving(20);
        ctx.mission.defer(() => lm.remove());
      },
      enter(ctx) {
        ctx.mission.defer(() => gang.remove());
        // Panther and the scout, if still running, join the hunt; two more come out of the dark
        hunted.clear();
        for (const c of [limo(), scout()]) {
          if (!c.on || c.wreck >= 0 || gang.cars.includes(c)) continue;
          gang.cars.push(c);
          hunt(c);
        }
        spawned = false; quip = 8; near3k = near1k = false;
      },
      tick(ctx, dt) {
        if (!spawned) {
          const want = 4 - gang.cars.filter((c) => c.on && c.wreck < 0).length;
          if (want <= 0 || gang.spawn(() => new ScriptCar(env.engine, 'suv', PANTHER), Math.min(2, want), 30) || ctx.t > 6) spawned = true;
        }
        // the ones Gang put on the road hunt like the others; near the gate all of them give up
        const S1 = STOP(), dGate = Math.hypot(env.pl.position.x - S1.x, env.pl.position.z - S1.z);
        for (const c of gang.cars) { if (dGate < 300) c.driver = null; else hunt(c); }
        const before = ctx.state.wrecked;
        gang.update(dt, 260, 8);
        ctx.state.wrecked = gang.wrecked;
        if (ctx.state.wrecked > before) env.dialogue?.say(who.yu(), t('cmp.m2.y5'), { prio: 2 });
        const S0 = STOP(), d = Math.hypot(env.pl.position.x - S0.x, env.pl.position.z - S0.z);
        if (!near3k && d < 3000) { near3k = true; env.dialogue?.say(who.yu(), t('cmp.m5.y4'), { prio: 3 }); }
        if (!near1k && d < 900) { near1k = true; env.dialogue?.say(who.k(), t('cmp.m5.k3'), { prio: 3 }); }
        if (quip <= 0 && gang.cars.some((c) => c.on && c.wreck < 0 && c.car.pos.distanceTo(env.v.car.pos) < 25)) {
          env.dialogue?.say(who.yu(), t(Math.random() < 0.5 ? 'cmp.m1.y4' : 'cmp.m1.y6'), { prio: 2 }); quip = 10;
        }
      },
    }),
    // 6. at the gate: the road blocked, Panther gets out
    cutscene<S>(env, {
      id: 'gate',
      setup(ctx) {
        phase = 'none'; heal();
        block(ctx.mission); settleCars(ctx.mission);
        const S0 = STOP(), y = gateYaw();
        const me = atGate(STOP_BEFORE - 4, -3.2);
        env.putOnFoot(me.x, me.z, y + Math.PI);
        const kp = atGate(21, 5.5), lp = atGate(21, -5.6);
        extra(ctx.step, kp.x, kp.z, env.contacts?.appearance('laok'), y + Math.PI, 'laok')?.act('talk');
        extra(ctx.step, lp.x, lp.z, env.contacts?.appearance('daliu'), y + Math.PI, 'daliu');
        const bp = atGate(STOP_BEFORE + 9, 0.8);
        extra(ctx.step, bp.x, bp.z, bossLook, y, 'baoge')?.act('angry');
        for (let i = 0; i < 3; i++) { const p = atGate(STOP_BEFORE + 11 + i * 1.2, -2 + i * 2); extra(ctx.step, p.x, p.z, thugLook(), y); }
        void S0;
      },
      // over the carriageway, never off it (the station's office and the verges' buildings stood in the first cut)
      shots: () => [
        { from: V(STOP_BEFORE + 40, 2, 8), to: V(STOP_BEFORE + 30, 1.5, 6), look: V(20, 0, 2), secs: 6 },
        { from: V(STOP_BEFORE + 5, 3.5, 1.7), look: V(STOP_BEFORE + 9, 0.8, 1.6), secs: 7, fov: 42 },
        { from: V(26, 2.5, 1.8), look: V(21, 5.5, 1.6), secs: 6, fov: 42 },
        { from: V(STOP_BEFORE + 0.5, -4.6, 1.65), look: V(STOP_BEFORE - 4, -3.2, 1.6), secs: 6, fov: 40 },
      ],
      lines: () => {
        const bp = atGate(STOP_BEFORE + 9, 0.8), kp = atGate(21, 5.5);
        return [L(who.boss(bp), 'cmp.m5.b2'), L(who.k(kp), 'cmp.m5.k4'), L(who.boss(bp), 'cmp.m5.b3'), L(who.chen(), 'cmp.m5.c6'), L(who.boss(bp), 'cmp.m5.b4')];
      },
    }),
    // 7. the last fight (checkpoint: on foot by the truck)
    fight<S>(env, {
      id: 'fight', checkpoint: true, line: t('cmp.m5.fight'), n: 4, tough: 1.15, fled: t('cmp.why.fledFight'),
      boss: { id: 'baoge', look: bossLook, tough: 4 },
      at: () => atGate(STOP_BEFORE + 6, 0),
      restore(ctx) {
        resetWatch(); phase = 'none'; night();
        block(ctx.mission); settleCars(ctx.mission);
        const me = atGate(STOP_BEFORE - 4, -3.2);
        env.putOnFoot(me.x, me.z, gateYaw() + Math.PI);
        heal();
      },
      ko: (ctx, n) => { ctx.state.ko = n; },
    }),
    // 8. 王队, and the end of it
    cutscene<S>(env, {
      id: 'outro',
      setup(ctx) {
        const y = gateYaw();
        const cp = atGate(STOP_BEFORE + 22, -1.5), c = cop();
        c.place(cp.x, cp.z, y + 0.3); c.driver = null; c.takeable = false;
        ctx.mission.defer(() => c.remove());
        const me = atGate(STOP_BEFORE + 4, -1);
        env.putOnFoot(me.x, me.z, y + Math.PI);
        const wp = atGate(STOP_BEFORE + 8, -2.4), kp = atGate(STOP_BEFORE - 1, 2.6), lp = atGate(STOP_BEFORE - 1.5, 4.2);
        extra(ctx.step, wp.x, wp.z, env.contacts?.appearance('wang'), y + Math.PI, 'wang')?.act('talk');
        extra(ctx.step, kp.x, kp.z, env.contacts?.appearance('laok'), y + Math.PI * 0.5, 'laok');
        extra(ctx.step, lp.x, lp.z, env.contacts?.appearance('daliu'), y + Math.PI * 0.5, 'daliu');
        env.wanted?.clear();
      },
      shots: () => [
        { from: V(STOP_BEFORE + 30, 8, 5), to: V(STOP_BEFORE + 20, 6, 3.4), look: V(STOP_BEFORE + 6, 0, 1.2), secs: 6 },
        { from: V(STOP_BEFORE + 4.5, 1.6, 1.7), look: V(STOP_BEFORE + 8, -2.4, 1.6), secs: 7, fov: 42 },
        { from: V(STOP_BEFORE + 1, -1.8, 1.65), look: V(STOP_BEFORE - 1, 2.6, 1.55), secs: 7, fov: 42 },
        { from: V(STOP_BEFORE - 6, 3, 2), to: V(-40, 2, 14), look: V(0, 0, 4), look2: V(-40, 0, 2), secs: 9 },
      ],
      lines: () => {
        const wp = atGate(STOP_BEFORE + 8, -2.4), kp = atGate(STOP_BEFORE - 1, 2.6);
        return [L(who.wang(wp), 'cmp.m5.w1'), L(who.boss(), 'cmp.m5.b5'), L(who.wang(wp), 'cmp.m5.w2'), L(who.k(kp), 'cmp.m5.k5'), L(who.chen(), 'cmp.m5.c7'), L(who.k(kp), 'cmp.m5.k6')];
      },
    }),
    wait<S>('end', 0.2),
  ];
  return def;
}
