import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { Rng } from '../core/Rng';
import { CG, groups } from '../core/Physics';
import type { CarLook, SharedBike, PeopleApi, PlayerApi, RenderApi, TrafficCars, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { Routes } from '../city/Routes';
import { Vehicle } from '../vehicle/Vehicle';
import { SPEC_OF } from '../vehicle/Spec';
import { bodyOfSpec, bodySettled, readyBodies, specLength, type BodySource, type BodyType } from '../vehicle/Bodies';
import { defaultLivery } from '../vehicle/CarModel';
import { ControlFilter } from '../vehicle/ControlFilter';
import { LaneGraph } from './LaneGraph';
import { Signals, SignalHeads } from './Signals';
import { CarKit } from './CarKit';
import { readyKitLod } from '../vehicle/KitLod';
import { AiDriver, lineStats, type Leader } from './AiDriver';
import { GhostTraffic, type Handover } from './Ghosts';
import { Gait, type Motion } from '../character/Animator';
import { randomLook, SKELETON, J, type Look } from '../character/Body';
import { SEAT } from '../vehicle/TwoWheelers';

interface Npc {
  car: Vehicle;
  /** 玩家在等它或者坐在上面（`FareCar.keep`）：不回收、不变回轻量车。 */
  fare?: FareCar | null;
  /** Seconds a parked one has stood still (it is put to sleep after one: `nap`). */
  rest?: number;
  driver: AiDriver | null;
  filter: ControlFilter;
  active: boolean;
  prevPos: THREE.Vector3; curPos: THREE.Vector3; prevQuat: THREE.Quaternion; curQuat: THREE.Quaternion;
  upper: THREE.Color; lower: THREE.Color; taxi: boolean;
  body: BodyType;
  flipped: number;
  /** Left by the player: no driver, handbrake on, kept until far away. */
  parked: boolean;
  /** A motorcycle or bicycle the city left at the kerb for the taking (not a car the player left). */
  bike: boolean;
  /** Seconds until this driver may lean on the horn again. */
  hornT: number;
  /** The chase job's getaway car: not despawned for distance, released by the job. */
  runner: boolean;
  /** The person on an electric scooter (drawn in the crowd), or null. */
  rider: { gait: Gait; look: Look } | null;
  /** Stopped where it is, handbrake on, kept however far away (its driver got out: npc/'s road rage). */
  held: boolean;
}

/** A car drawn by `addExternalDraw`. */
export type ExternalPut = (body: BodyType, pos: THREE.Vector3, quat: THREE.Quaternion, car: Vehicle | null, upper: THREE.Color, lower: THREE.Color) => void;
/** Cars another system simulates: the player can take them; `blocking` (optional) are the ones drivers must not run into. */
export interface ExternalCars { cars(): Vehicle[]; canTake(car: Vehicle): boolean; take(car: Vehicle): CarLook | null; park(car: Vehicle): boolean; blocking?(): readonly Vehicle[] }
/** Parked cars a traffic kit can draw on top of traffic's own (parking/ draws the near ones in traffic's kits). */
export const PARKED_DRAW = 64;

/**
 * 能坐的车（2026-11-11，travel/Ride.ts，docs/street-level-design.md C3）：进站的公交、招手叫停的出租车。车还是车流里的
 * 那辆，司机照常开；这里只给乘客要的几样：叫它靠边、给它一条路线、留着别回收。
 */
export interface FareCar {
  readonly car: Vehicle;
  readonly kind: 'bus' | 'taxi';
  /** 还在车流里、司机还在好好开（没被撞晕、没翻、没被收走、没被抢）。 */
  readonly alive: boolean;
  /** 靠边停稳了（公交进站，或者 `stop` 叫停的）。 */
  readonly stopped: boolean;
  /** 司机在哪段路（车道图的有向路段）的多少米处。 */
  readonly link: number; readonly s: number;
  /** `go(links)` 的路线还剩几段没开到（0：在最后一段上，或者没有路线）。 */
  readonly left: number;
  /** 靠边停下等着：尽快，或者停在现在这段路的 `s` 米处（得在前面）。停稳以前每步都叫；停稳以后等到 `go`。 */
  stop(s?: number): void;
  /** 接着开；给了路线（`NavApi.routeFrom` 的 `links`）就照着走。 */
  go(links?: readonly number[]): void;
  /** 留着这辆车（等它、坐在上面的时候）；用完要放（false）。离玩家 150 米外的自己会放。 */
  keep(on: boolean): void;
  /** 画出来的位姿（两个固定步之间插值）。 */
  pose(alpha: number, pos: THREE.Vector3, quat: THREE.Quaternion): void;
  /** 司机觉得前面没东西挡着（不是红灯、不是前车、不是进站）可车就是不动，已经多少秒。 */
  readonly stuck: number;
  /** 这段路尽头是红灯。 */
  readonly red: boolean;
  /**
   * 卡死了（汇入口的护栏尖、互相别住的车）：把车沿它要走的路往前挪二三十米，落在空着的车道上。坐在车上的乘客没法自己
   * 绕过去，所以有这一手；挪不了（前面没空地、桥面还没加载）返回 false。
   */
  hop(): boolean;
}

export interface TrafficApi extends TrafficCars {
  /** Cars simulated by a persistent event rather than the distance-limited traffic pool. */
  addExternalCars(provider: ExternalCars): void;
  /**
   * Draw extra cars in traffic's kits each frame (parking/: the parked cars near the camera share the kits'
   * draw calls): `draw` is called inside traffic's update, before the kits are committed, with `put` - a body,
   * an interpolated pose, the Vehicle (null: a car at rest with its lamps off, `CarKit.setStill`) and its colours.
   * Each body's kit holds `PARKED_DRAW` such cars on top of traffic's own.
   */
  addExternalDraw(draw: (put: ExternalPut, alpha: number) => void): void;
  readonly graph: LaneGraph;
  readonly signals: Signals;
  /** Active traffic cars (physics objects). */
  cars(): Vehicle[];
  /** Signal clock, seconds (for `signals.state`). */
  readonly time: number;
  /** Stop lines traffic has crossed, and how many on red (diagnostics: `.scratch/order.mjs`). */
  readonly lineStats: { crossed: number; onRed: number; yields: number };
  /** A getaway car for the chase job: spawned on the road 90-200 m from (x, z), fast and blind to red lights, until released. */
  spawnRunner(x: number, z: number, hx: number, hz: number, opts?: { calm?: boolean }): { car: Vehicle; release(): void; bolt(): void } | null;
  /** Riders on electric scooters at most (they take places in the player's crowd before the pedestrians). */
  readonly riderCap: number;
  /**
   * Stop a traffic car where it is and keep it (true), or let its driver drive on (false). False when
   * `car` is not a driven traffic car (parked, a scooter, a getaway car, the police).
   */
  hold?(car: Vehicle, on: boolean): boolean;
  /**
   * Take the driven traffic within `r` of (x, z) off the road at once (chapter 5's toll gate, a scene played on an
   * expressway): returns how many. Parked cars and riders stay.
   */
  clearNear?(x: number, z: number, r: number): number;
  /**
   * (x, z) 周围 `r` 米内最近的一辆能坐的车：'bus' 是正停在站上的公交，'taxi' 是司机好好开着的出租车（停着走着都算；`ok` 再挑）。
   */
  fareNear?(x: number, z: number, r: number, kind: 'bus' | 'taxi', ok?: (car: Vehicle) => boolean): FareCar | null;
}

// Beijing traffic: white, black and silver dominate, then grey, dark blue, red, champagne.
export const PRIVATE = ['#f2f2ef', '#f2f2ef', '#161718', '#161718', '#b9bcbf', '#b9bcbf', '#6c7075', '#26344f', '#8c1d1d', '#c9b48f', '#3d4a3f'];
// Taxi companies share the golden top and vary the lower colour.
const TAXI_LOWER = ['#1f5e3c', '#1d49b5', '#6b1f22', '#4a2d6b', '#7a4a1e'];
const TRUCK_CAB = ['#eceeed', '#e5e8e8', '#2f5aa8', '#8c1d1d'];
const BUS_LOWER = ['#c3232b', '#c3232b', '#c3232b', '#2f7d4f'];
/**
 * The Beijing mix: mostly saloons - many of them taxis - then SUVs and hatchbacks, a few MPVs,
 * buses (main roads only) and light box trucks. Shares of the car pool; the rest are saloons.
 */
const MIX: [BodyType, number][] = [['suv', 0.16], ['hatch', 0.14], ['mpv', 0.08], ['bus', 0.09], ['truck', 0.07]];
/**
 * 车流里的豪车（2026-10-18 只在高画质各一辆；2026-10-19 用户「做的豪车和跑车在哪，我怎么没有看见」：大多数玩家是手机、
 * 不是高画质，一辆也看不到），现在每档都有：跑车和豪华轿车各一辆，高画质跑车两辆。两套车模只在有豪车在近处时才画
 * （CarKit 空着就不画，不占绘制调用）。
 * 2026-10-19 加了蛮牛（兰博基尼风格），每档一辆。2026-10-22 加了 AE86（车行有卖），每档一辆，白车身黑下半截。
 */
const LUX: BodyType[] = ['coupe', 'limo', 'super', 'ae86'];
const LUX_POOL = (tier: string): [BodyType, number][] => [['coupe', tier === 'high' ? 2 : 1], ['limo', 1], ['super', 1], ['ae86', 1]];
/** 跑车的颜色要扎眼（普通私家车那套黑白灰太低调），豪华轿车还是黑、白、银、深蓝。 */
const COUPE_PAINT = ['#c41e1e', '#c41e1e', '#8c1d1d', '#f0b400', '#e2571a', '#1d49b5', '#f2f2ef', '#161718'];
const LIMO_PAINT = ['#161718', '#161718', '#161718', '#f2f2ef', '#b9bcbf', '#26344f'];
/** 蛮牛（2026-10-19）的颜色更张扬：荧光绿、橙、黄、紫，加黑白。 */
const SUPER_PAINT = ['#9bd21c', '#9bd21c', '#f07b12', '#f2c200', '#6a2c91', '#f2f2ef', '#161718'];
/** Electric scooters: mostly white, black, red and blue, a few silver and pastel. */
const EBIKE_BODY = ['#f0f0ec', '#f0f0ec', '#18191a', '#18191a', '#b3242a', '#2a5bb0', '#b9bcbf', '#9ec9d6', '#e3b8c4'];
/** The delivery companies' colours (美团 yellow, 饿了么 blue), on the box, the jacket and the helmet. */
const DELIVERY = ['#f6c300', '#f6c300', '#f6c300', '#1b8ff0', '#1b8ff0'];
/** Riders keep off the expressways and their ramps. */
const NO_RIDERS = new Set(['motorway', 'motorway_link', 'trunk', 'trunk_link']);
/** Buses only spawn on these road classes. */
const BUS_ROADS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'busway']);
/** The bodies parked along the kerbs (city/visual/Parking.ts `PARK_BODIES`): their kits get room for `PARKED_DRAW`. */
const PARKED_BODIES = new Set<BodyType>(['sedan', 'suv', 'hatch', 'mpv']);

/**
 * City traffic. A fixed pool of taxi-spec Vehicles (disabled when idle) is kept filled in a ring
 * 90-260 m around the camera, spawning out of sight; each car is driven by an AiDriver on the lane
 * graph and runs the same physics as the player's car, so collisions are real collisions and any
 * of them can later be taken by the player.
 */
export async function install(engine: Engine): Promise<void> {
  await readyKitLod();
  const world = engine.get<WorldApi & { routes?: Routes }>('world');
  if (!world?.routes) return;
  const g = new LaneGraph(world.routes.net);
  const sig = new Signals(g);
  const heads = new SignalHeads(engine.scene, g, sig);
  const tier = engine.quality.tier;
  const max = new URLSearchParams(location.search).has('notraffic') ? 0 : tier === 'low' ? 12 : tier === 'medium' ? 26 : 42;
  /**
   * 「轻量车」（2026-11-11，docs/street-level-design.md A2 第二步；`?lightcars=0` 关，回到原来的做法）：实体车只留玩家身边的
   * （`hotR`：55 米起，车速越快越远），再远的都是 Ghosts.ts 的远景车——它们现在一直开到玩家身边才变成实体车，170 米以内的用近处
   * 车模画。实体车开出 `hotR + 25` 米又变回去。所以这里不再自己往路上放车（`spawn`），车的型号也不再受名额表限制。
   */
  const light = max > 0 && new URLSearchParams(location.search).get('ghosts') !== '0' && new URLSearchParams(location.search).get('lightcars') !== '0';
  /** 每种车模多留的位置：给近处的轻量车画。 */
  const NEAR_DRAW = !light ? 0 : tier === 'low' ? 28 : tier === 'medium' ? 44 : 70;
  const MAX_PARKED = 6;
  /**
   * Motorcycles standing at kerbs within reach of the player (bicycles are the shared bikes in the
   * street racks: `rentBike`). Three were too few to ever come across one.
   */
  const BIKES = tier === 'low' ? 5 : 8;
  const BIKE_ROADS = new Set(['residential', 'tertiary', 'secondary', 'unclassified', 'living_street']);
  /**
   * Electric scooters ridden along the kerb (2026-10-03): Beijing's streets are full of them, delivery riders
   * (a yellow or blue box, jacket and helmet) and everyone else. Same physics as the player's scooter.
   */
  const RIDERS = max === 0 ? 0 : tier === 'low' ? 4 : tier === 'medium' ? 7 : 10;
  /**
   * 省电档（`engine.lite`，弱手机）：路上的车和骑手少一半。每辆车每个固定步要打 4 条车轮射线，帧率越低每帧补跑的固定步
   * 越多，模拟 CPU 降速 6 倍时交通占了每帧 47 ms 里的约 15 ms。只管生成：多出来的车开远了照常回收。
   */
  const carCap = () => (engine.lite ? Math.ceil(max / 2) : max);
  const riderCap = () => (engine.lite ? Math.ceil(RIDERS / 2) : RIDERS);
  const crowdOf = () => engine.get<PlayerApi>('player')?.crowd;
  const riderMotion: Motion = { speed: 0, action: 'ride', t: 0, ride: 'ebike', lean: 0 };
  const seatAt = new THREE.Vector3(), seatFwd = new THREE.Vector3();
  const PELVIS_Y = SKELETON[J.pelvis].offset[1];
  // How many of each body the pool holds, and one instanced kit per body (each its own livery).
  const counts = new Map<BodyType, number>();
  let rest = max;
  for (const [b, share] of MIX) { const n = Math.min(rest, Math.round(max * share)); counts.set(b, n); rest -= n; }
  for (const [b, n] of LUX_POOL(tier)) { const k = Math.min(rest, n); counts.set(b, k); rest -= k; }
  counts.set('sedan', Math.max(0, rest));
  const kits = new Map<BodyType, CarKit>();
  const kitFor = (b: BodyType): CarKit => {
    let k = kits.get(b);
    // the luxury bodies have no slot body of their own on the kerb, but parking/ puts some in others' (LUXURY_AT): room for 16
    if (!k) {
      const lux = b === 'coupe' || b === 'limo' || b === 'super' || b === 'ae86', two = b === 'ebike' || b === 'moto' || b === 'bike';
      // 轻量车模式下哪种车都可能占满名额（型号跟着远景车来），近处的轻量车也画在这里
      const own = light && !two ? (lux ? (counts.get(b) ?? 0) + 8 : max + NEAR_DRAW) : (counts.get(b) ?? 0);
      k = new CarKit(engine.scene, own + (b === 'ebike' ? RIDERS : 0) + MAX_PARKED + 2 + (PARKED_BODIES.has(b) ? PARKED_DRAW : lux ? 16 : 0), defaultLivery(b), b); kits.set(b, k);
    }
    return k;
  };
  const rng = new Rng(4242);
  const rnd = () => rng.next();
  const pool: Npc[] = [];
  const externalCars: ExternalCars[] = [];
  const externalDraws: ((put: ExternalPut, alpha: number) => void)[] = [];
  const putExternal: ExternalPut = (body, pos, quat, car, upper, lower) => {
    const kit = kitFor(body), k = written.get(body) ?? 0;
    if (k >= kit.cap) return;
    if (car) kit.set(k, pos, quat, car, upper, lower, false); else kit.setStill(pos, quat, upper, lower);
    written.set(body, k + 1);
  };
  // Cars the pool let go of (a parked car took their slot), reused before building new ones:
  // removing Rapier bodies would free collider handles that stale tags could then point at.
  const spares = new Map<BodyType, Vehicle[]>();
  const newCar = (body: BodyType): Vehicle => {
    const car = spares.get(body)?.pop() ?? new Vehicle(engine.physics, SPEC_OF[body], { x: 0, y: -300, z: 0 }, 0);
    car.body.setEnabled(false);
    return car;
  };
  const recycle = (n: Npc) => { const l = spares.get(n.body) ?? []; l.push(n.car); spares.set(n.body, l); };
  /**
   * The ground height to drop a car at on link `l` at `s`: 0 on the flat; on an interchange's deck or
   * ramp (or down in an underpass) its height, but only once the collider is in (the tile has a body), else NaN - a car
   * put there too early fell through to the road underneath.
   */
  const deckAt = (l: { h: Float32Array | null }, s: number, x: number, z: number): number => {
    if (!l.h) return 0;
    const h = g.heightAt(l as Parameters<typeof g.heightAt>[0], s);
    if (Math.abs(h) < 0.3) return h;
    const hit = engine.physics.raycast({ x, y: h + 1.5, z }, { x: 0, y: -1, z: 0 }, 3, groups(CG.CAR, CG.WORLD));
    return hit && Math.abs(hit.point[1] - h) < 0.6 ? hit.point[1] : NaN;
  };
  const makeNpc = (car: Vehicle, body: BodyType): Npc => ({ car, driver: null, filter: new ControlFilter(), active: false, bike: false, hornT: 0, runner: false, prevPos: new THREE.Vector3(), curPos: new THREE.Vector3(), prevQuat: new THREE.Quaternion(), curQuat: new THREE.Quaternion(),
    upper: new THREE.Color(), lower: new THREE.Color(), taxi: false, body, flipped: 0, parked: false, rider: null, held: false });
  // Each body's cars once its model is in (readyBodies in main.ts loads the saloon first, the rest after the
  // spawn's tiles): until then the pool's places go to saloons, which give theirs back as the others arrive.
  const fill = (b: BodyType, n: number) => {
    kitFor(b);
    for (let i = 0; i < n; i++) {
      const npc = makeNpc(newCar(b), b);
      npc.car.body.setTranslation({ x: 0, y: -300 - pool.length * 8, z: 0 }, false);
      pool.push(npc);
    }
  };
  let sedanExtra = 0;
  for (const [b, n] of counts) {
    if (n <= 0) continue;
    if (b === 'sedan' || bodySettled(b as BodySource)) fill(b, n);
    else {
      sedanExtra += n;
      void readyBodies([b as BodySource]).then(() => {
        fill(b, n);
        // as many idle stand-in saloons leave the pool (their bodies stay, as spares)
        let k = n;
        for (let i = pool.length - 1; i >= 0 && k > 0; i--) { const p = pool[i]; if (p.body === 'sedan' && !p.active && !p.parked && sedanExtra > 0) { recycle(p); pool.splice(i, 1); sedanExtra--; k--; } }
      });
    }
  }
  if (sedanExtra) fill('sedan', sedanExtra);
  /**
   * 路边停着的车和摩托（2026-10-18，手机帧率）：原来每个固定步都跑完整的车辆物理（4 条车轮射线加轮胎模型），低画质下
   * 路边最多 6 辆车加 5 辆摩托，占交通载具的一半。站稳一秒后让刚体睡下、不再 step；撞上来、推一下，Rapier 自己把它
   * 叫醒（`isSleeping` 变 false），下一步照常跑物理。冲量和 reset 都带 wake，所以抢车、回收再用都不受影响。
   */
  const nap = (n: Npc, dt: number): boolean => {
    const b = n.car.body;
    if (b.isSleeping()) return true;
    // 水平速度：靠冲量托着的车静止时竖直速度报 -0.375·g·dt（约 0.06），`speed` 永远到不了 0
    if (Math.hypot(n.car.vel.x, n.car.vel.z) < 0.05 && n.car.grounded === 4) {
      n.rest = (n.rest ?? 0) + dt;
      if (n.rest > 1) { n.rest = 0; b.sleep(); return true; }
    } else n.rest = 0;
    return false;
  };
  const driving = () => { let k = 0; for (const n of pool) if (n.active && !n.parked && !n.rider) k++; return k; };
  const riding = () => { let k = 0; for (const n of pool) if (n.active && n.rider) k++; return k; };
  const parkedInput = { forward: 0, back: 0, steer: 0, analog: true, handbrake: true };
  const player = () => engine.get<VehicleApi>('vehicle');
  const tmp = { x: 0, z: 0, dx: 0, dz: 0 }, tmp2 = { x: 0, z: 0, dx: 0, dz: 0 };
  const settled = (b: BodyType) => b === 'sedan' || bodySettled(b as BodySource);
  const camDir = new THREE.Vector3();
  const renderPos = new THREE.Vector3(), renderQuat = new THREE.Quaternion();
  let t = 0, spawnT = 0, busT = 0, roomT = 0;
  /** Cars written to each kit this frame. */
  const written = new Map<BodyType, number>();

  // Taxi liveries only on saloons; buses and trucks keep their own two-tone and their lettering
  // (`taxi` is what the kit calls the livery-only parts: roof sign, door and box lettering).
  const paint = (n: Npc) => {
    if (n.body === 'bus') { n.taxi = true; n.upper.set('#f2f1ea'); n.lower.set(BUS_LOWER[Math.floor(rnd() * BUS_LOWER.length)]); return; }
    if (n.body === 'truck') { n.taxi = true; n.upper.set(TRUCK_CAB[Math.floor(rnd() * TRUCK_CAB.length)]); n.lower.set(rnd() < 0.75 ? '#f2f3f2' : '#dde1e4'); return; }
    if (n.body === 'ae86') { n.taxi = false; n.upper.set('#f2f2ef'); n.lower.copy(n.upper); return; }
    if (n.body === 'coupe' || n.body === 'limo' || n.body === 'super') { const c = n.body === 'coupe' ? COUPE_PAINT : n.body === 'super' ? SUPER_PAINT : LIMO_PAINT; n.taxi = false; n.upper.set(c[Math.floor(rnd() * c.length)]); n.lower.copy(n.upper); return; }
    n.taxi = n.body === 'sedan' && rnd() < 0.45;
    if (n.taxi) { n.upper.set('#f3b50f'); n.lower.set(TAXI_LOWER[Math.floor(rnd() * TAXI_LOWER.length)]); }
    else { n.upper.set(PRIVATE[Math.floor(rnd() * PRIVATE.length)]); n.lower.copy(n.upper); }
  };

  /**
   * The distant traffic past the physics ring (Ghosts.ts): budget and reach by tier, `?ghosts=0` off. On low only
   * saloons (taxis among them), SUVs and buses are drawn there (three kits); the bodies hand over as they are.
   */
  const ghostOn = max > 0 && new URLSearchParams(location.search).get('ghosts') !== '0';
  const ghostPaint = (cls: string): { body: BodyType; upper: THREE.Color; lower: THREE.Color; taxi: boolean } => {
    let body: BodyType = 'sedan', u = rnd();
    for (const [b, share] of MIX) { if (u < share) { body = b; break; } u -= share; }
    if ((body === 'bus' && !BUS_ROADS.has(cls)) || (body === 'truck' && cls === 'residential')) body = 'sedan';
    // 轻量车模式下路上的车都从这里来：豪车和跑车也要有（「做的豪车和跑车在哪，我怎么没有看见」），二十辆里一辆
    if (light && rnd() < 0.05) { const lux = LUX[Math.floor(rnd() * LUX.length)]; if (settled(lux)) body = lux; }
    const n = { body, upper: new THREE.Color(), lower: new THREE.Color(), taxi: false } as unknown as Npc;
    paint(n);
    return { body, upper: n.upper, lower: n.lower, taxi: n.taxi };
  };
  /** 玩家在哪（车里或徒步；没有就用镜头）。 */
  const playerAt = (): { x: number; z: number } => engine.get<PlayerApi>('player')?.position ?? engine.camera.position;
  /** 这辆实体车现在能不能变回远景车接着开：好好开着的，没被撞、没翻、没在进站、没被扣住，车头顺着路。 */
  const canGhost = (n: Npc): boolean => {
    const dr = n.driver;
    if (!n.active || n.parked || n.rider || n.runner || n.held || n.fare || n.bike || n.body === 'ebike' || !dr || dr.mode !== 'drive' || dr.busStop || dr.yieldT > 0) return false;
    if (n.car.up.y < 0.9 || n.car.impact > 1 || n.flipped > 0) return false;
    const l = g.links[dr.link];
    g.at(l, dr.s, 0, tmp2);
    return n.car.fwd.x * tmp2.dx + n.car.fwd.z * tmp2.dz > 0.9;
  };
  /** 名额满了：让一辆比 (x, z) 离玩家更远的实体车变回远景车。 */
  const evict = (x: number, z: number): boolean => {
    const pp = playerAt(), d0 = Math.hypot(x - pp.x, z - pp.z) + 4;
    let worst: Npc | null = null, wd = d0;
    for (const n of pool) {
      if (!n.active || n.parked || n.rider) continue;
      const d = Math.hypot(n.car.pos.x - pp.x, n.car.pos.z - pp.z);
      if (d > wd && canGhost(n)) { wd = d; worst = n; }
    }
    if (!worst) return false;
    toGhost(worst);
    despawn(worst);
    return true;
  };
  const adoptGhost = (h: Handover): boolean => {
    if (!light && driving() >= carCap()) return false;
    const body: BodyType = light && !settled(h.body) ? 'sedan' : h.body;
    let n = pool.find((p) => !p.active && !p.parked && p.body === body);
    if (!n && !light) return false;
    const l = g.links[h.link];
    if (l.len - h.s < 3) return false;
    if (h.x !== undefined) { tmp.x = h.x; tmp.z = h.z!; tmp.dx = Math.sin(h.yaw!); tmp.dz = Math.cos(h.yaw!); }
    else g.at(l, h.s, g.laneOffset(l, h.lane), tmp);
    if (light) {
      // 并排的两条车道只隔三米多：只有真叠在一起才不放（高架上下两层的不算）
      const len = specLength(SPEC_OF[body]), lift0 = l.h ? g.heightAt(l, h.s) : 0;
      const over = (c: Vehicle): boolean => {
        const rx = c.pos.x - tmp.x, rz = c.pos.z - tmp.z;
        if (rx * rx + rz * rz > 196) return false;
        return Math.abs(c.pos.y - lift0) < 3 && Math.abs(rx * tmp.dz - rz * tmp.dx) < 2.1 && Math.abs(rx * tmp.dx + rz * tmp.dz) < (specLength(c.spec) + len) / 2 + 0.8;
      };
      const pv = player();
      if ((pv && over(pv.car)) || pool.some((o) => o.active && over(o.car))) return false;
    } else if (pool.some((o) => o.active && Math.hypot(o.car.pos.x - tmp.x, o.car.pos.z - tmp.z) < 9)) return false;
    const lift = deckAt(l, h.s, tmp.x, tmp.z);
    if (Number.isNaN(lift)) return false;
    if (light) {
      const x = tmp.x, z = tmp.z, dx = tmp.dx, dz = tmp.dz;
      if (driving() >= carCap() && !evict(x, z)) return false;
      if (!n) { n = makeNpc(newCar(body), body); pool.push(n); kitFor(body); }
      tmp.x = x; tmp.z = z; tmp.dx = dx; tmp.dz = dz;
    }
    n = n!;
    n.car.body.setEnabled(true);
    n.car.reset({ x: tmp.x, y: lift + 0.03 + n.car.spec.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
    n.car.setMoving(h.v);
    n.driver = new AiDriver(g, sig, h.link, h.s, h.lane, rnd);
    if (body === 'bus') { n.driver.kerbside = true; n.driver.lane = g.laneOn(l, 7); }
    if (h.next !== undefined) n.driver.seed(h.next);
    n.filter.reset();
    n.upper.copy(h.upper); n.lower.copy(h.lower); n.taxi = h.taxi;
    n.prevPos.copy(n.car.pos); n.curPos.copy(n.car.pos); n.prevQuat.copy(n.car.quat); n.curQuat.copy(n.car.quat);
    n.active = true; n.flipped = 0; n.parked = false; n.bike = false; n.runner = false; n.rider = null; n.held = false; n.fare = null; n.hornT = 0;
    return true;
  };
  const ghosts = ghostOn ? new GhostTraffic(engine.scene, g, sig, rnd,
    tier === 'low' ? 140 : tier === 'medium' ? 260 : 420, tier === 'low' ? 450 : tier === 'medium' ? 600 : 750,
    new Set<BodyType>(tier === 'low' ? ['sedan', 'suv', 'bus'] : ['sedan', 'suv', 'hatch', 'mpv', 'bus', 'truck']), ghostPaint, adoptGhost) : null;
  if (ghosts && light) {
    ghosts.light = true;
    // 低画质的近处车模少画一点（手机的 GPU），预算也少往近处偏一点（远处的路不能空）
    ghosts.rNear = tier === 'low' ? 130 : tier === 'medium' ? 150 : 170;
    ghosts.nearBoost = tier === 'low' ? 1.5 : tier === 'medium' ? 1.8 : 2.2;
    // 近处的轻量车画在实体车的车模里（一种车一个 kit，不多占绘制调用）
    ghosts.nearDraw = (c, pos, quat) => {
      const body = settled(c.body) ? c.body : 'sedan', kit = kitFor(body);
      pos.y += kit.spec.wheelRadius;
      if (!kit.sees(pos)) return true;
      const k = written.get(body) ?? 0;
      if (k >= kit.cap) return false;
      kit.setRail(pos, quat, c.upper, c.lower, c.taxi, c.brake, c.spin, c.steer, c.plate);
      written.set(body, k + 1);
      return true;
    };
  }

  /** A free car of the pool, from a random place in it: from the front, the cars at its end (the saloons, the late-loaded
   * luxury bodies) only drove when every other was out - on a 省电档 phone (half the cars) never. */
  const idle = (ok: (p: Npc) => boolean): Npc | undefined => {
    const k = Math.floor(rnd() * pool.length);
    for (let i = 0; i < pool.length; i++) { const p = pool[(k + i) % pool.length]; if (!p.active && !p.parked && ok(p)) return p; }
    return undefined;
  };
  const spawn = () => {
    // a kerbside motorcycle's freed slot only when no car is free, as before (they sit at the pool's end)
    let n = idle((p) => p.body !== 'ebike' && p.body !== 'moto') ?? idle((p) => p.body !== 'ebike');
    if (!n) { if (driving() >= carCap()) return; n = makeNpc(newCar('sedan'), 'sedan'); pool.push(n); }
    const len = specLength(n.car.spec);
    const cam = engine.camera.position;
    engine.camera.getWorldDirection(camDir);
    const ids = g.near(cam.x, cam.z, 240);
    if (!ids.length) return;
    const pv = player();
    for (let attempt = 0; attempt < 14; attempt++) {
      const id = ids[Math.floor(rnd() * ids.length)];
      const l = g.links[id];
      if (l.len < 24 || l.cls === 'service' || l.cls === 'living_street' || g.avoid.has(id)) continue;
      // Not on a road that ends: the car would only drive to its end and stand there.
      if (g.endsAfter(id)) continue;
      if (n.body === 'bus' && !BUS_ROADS.has(l.cls)) continue;
      if (n.body === 'truck' && l.cls === 'residential') continue;
      const s = 6 + rnd() * (l.len - 12);
      const lane = g.laneOn(l, l.lanes > 1 ? Math.floor(rnd() * l.lanes) : 0);
      g.at(l, s, g.laneOffset(l, lane), tmp);
      const d = Math.hypot(tmp.x - cam.x, tmp.z - cam.z);
      if (d < 70 || d > 240) continue;
      if (d < 190 && ((tmp.x - cam.x) * camDir.x + (tmp.z - cam.z) * camDir.z) / d > 0.3) continue;
      // Long vehicles need more room than a saloon to drop in.
      const clear = 14 + len * 0.5;
      if (pool.some((o) => o.active && Math.hypot(o.car.pos.x - tmp.x, o.car.pos.z - tmp.z) < clear)) continue;
      if (pv && Math.hypot(pv.car.pos.x - tmp.x, pv.car.pos.z - tmp.z) < 25) continue;
      const lift = deckAt(l, s, tmp.x, tmp.z);
      if (Number.isNaN(lift)) continue;
      launch(n, id, s, lane, lift, l.speed * (0.75 + 0.2 * rnd()));
      return;
    }
  };
  /** Car `n` driving off from `tmp` (the lane point at `s` on link `id`). */
  const launch = (n: Npc, id: number, s: number, lane: number, lift: number, v: number) => {
    n.car.body.setEnabled(true);
    n.car.reset({ x: tmp.x, y: lift + 0.03 + n.car.spec.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
    n.car.setMoving(v);
    n.driver = new AiDriver(g, sig, id, s, lane, rnd);
    if (n.body === 'bus') n.driver.kerbside = true;
    n.filter.reset();
    paint(n);
    n.prevPos.copy(n.car.pos); n.curPos.copy(n.car.pos); n.prevQuat.copy(n.car.quat); n.curQuat.copy(n.car.quat);
    n.active = true; n.flipped = 0;
  };
  /**
   * 进城几秒后一辆跑车从对面车道迎面开过来（2026-10-19，「做的豪车和跑车在哪，我怎么没有看见」：出生点的建国门外大街
   * 没有路边车位，最近的豪车停在 110 多米外）：镜头前方 110-170 m、反方向的车道里离镜头那条线最近的一条，路面上的。
   * 放得下就 true；跑车在近处开着、前面没有对向车道就 false（过一秒再试）。
   */
  const showcase = (): boolean => {
    const cam = engine.camera.position;
    // the pool's coupe often went out already (under the title screen): a far one, just driving, is called back
    const n = idle((p) => p.body === 'coupe') ?? pool.find((p) => p.active && p.body === 'coupe' && p.driver && !p.parked && !p.runner && !p.held && !p.rider
      && Math.hypot(p.car.pos.x - cam.x, p.car.pos.z - cam.z) > 120);
    if (!n) return false;
    engine.camera.getWorldDirection(camDir);
    const fl = Math.hypot(camDir.x, camDir.z);
    if (fl < 0.3) return false;
    const fx = camDir.x / fl, fz = camDir.z / fl;
    let best: { id: number; s: number; lane: number; side: number } | null = null;
    for (const id of g.near(cam.x, cam.z, 200)) {
      const l = g.links[id];
      if (l.len < 24 || l.cls === 'service' || l.cls === 'living_street' || l.hmax > 0.3 || g.endsAfter(id)) continue;
      for (let lane = 0; lane < Math.max(1, l.lanes); lane++) for (let s = 6; s < l.len - 6; s += 8) {
        g.at(l, s, g.laneOffset(l, lane), tmp);
        if ((tmp.dx * fx + tmp.dz * fz) / Math.hypot(tmp.dx, tmp.dz) > -0.85) continue;
        const rx = tmp.x - cam.x, rz = tmp.z - cam.z, ahead = rx * fx + rz * fz, side = Math.abs(rx * fz - rz * fx);
        if (ahead < 110 || ahead > 170 || side > 14 || (best && side >= best.side)) continue;
        best = { id, s, lane, side };
      }
    }
    if (!best) return false;
    const l = g.links[best.id];
    g.at(l, best.s, g.laneOffset(l, best.lane), tmp);
    if (pool.some((o) => o.active && Math.hypot(o.car.pos.x - tmp.x, o.car.pos.z - tmp.z) < 14)) return false;
    if (n.active) despawn(n);
    launch(n, best.id, best.s, best.lane, 0, l.speed * 0.95);
    n.upper.set(COUPE_PAINT[0]); n.lower.copy(n.upper);   // red, to be seen
    return true;
  };
  /** 跑车迎面开来：进城后几秒；放不下就每秒再试，最多 30 次。每个页面一次。 */
  let showT = -1, showTries = 0, shown = false;
  if (max > 0 && !new URLSearchParams(location.search).has('shot')) engine.events.on('game:start', () => { if (!shown) { shown = true; showT = 4; } });

  /** A motorcycle left at a kerb 30-200 m from the camera, out of the road, for the player to take. */
  const spawnBike = () => {
    const cam = engine.camera.position;
    engine.camera.getWorldDirection(camDir);
    const ids = g.near(cam.x, cam.z, 200);
    if (!ids.length) return;
    const pv = player();
    for (let attempt = 0; attempt < 12; attempt++) {
      const id = ids[Math.floor(rnd() * ids.length)];
      const l = g.links[id];
      if (l.len < 30 || !BIKE_ROADS.has(l.cls) || l.hmax > 0.3) continue;
      const s = 8 + rnd() * (l.len - 16);
      // On the pavement, a metre in from the kerb on the right of travel (or from the parked cars up on it), pointing along the road.
      g.at(l, s, -(l.hw + 1.1 + l.parkOut), tmp);
      const d = Math.hypot(tmp.x - cam.x, tmp.z - cam.z);
      if (d < 30 || d > 200) continue;
      // 不在镜头里的近处凭空出现（2026-11-11：探针里看到 41 米、79 米处冒出来）
      if (d < 150 && ((tmp.x - cam.x) * camDir.x + (tmp.z - cam.z) * camDir.z) / d > 0.3) continue;
      if (pool.some((o) => o.active && Math.hypot(o.car.pos.x - tmp.x, o.car.pos.z - tmp.z) < 7)) continue;
      if (pv && Math.hypot(pv.car.pos.x - tmp.x, pv.car.pos.z - tmp.z) < 12) continue;
      const body: BodyType = 'moto';
      // A free slot of this body keeps its own vehicle. It must not also go to `spares`: newCar would
      // hand it out again while this slot still drives it (the bike the player took with F kept being
      // parked at another kerb, handbrake on, by the slot that took over from it).
      let n = pool.find((p) => !p.active && !p.parked && p.body === body);
      if (!n) { n = makeNpc(newCar(body), body); pool.push(n); }
      kitFor(body);
      n.car.body.setEnabled(true);
      n.car.reset({ x: tmp.x, y: 0.03 + n.car.spec.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
      n.driver = null; n.filter.reset(); paint(n); n.taxi = false;
      n.prevPos.copy(n.car.pos); n.curPos.copy(n.car.pos); n.prevQuat.copy(n.car.quat); n.curQuat.copy(n.car.quat);
      n.active = true; n.parked = true; n.bike = true; n.flipped = 0;
      return;
    }
  };

  /** A delivery rider's look: the company's jacket and helmet (a cap in its colour), dark trousers, mostly men. */
  const riderLook = (delivery: string | null): Look => {
    const l = randomLook(rnd);
    if (!delivery) { if (l.top === 'tee' && rnd() < 0.5) l.top = 'jacket'; return l; }
    const c = new THREE.Color(delivery);
    if (rnd() < 0.85) l.fem = 0;
    l.top = 'jacket'; l.shirt = c; l.inner = c.clone(); l.sleeve = 0.53; l.cap = c.clone(); l.print = false;
    l.bottom = 'trousers'; l.hem = 0.8; l.pants = new THREE.Color(rnd() < 0.5 ? '#1d1f24' : '#2c3036');
    l.hairStyle = rnd() < 0.5 ? 'short' : 'buzz'; l.mask = rnd() < 0.25 ? new THREE.Color('#e9eef2') : null;
    return l;
  };

  /** Someone on an electric scooter, along the right-hand kerb of a street 70-240 m away, out of sight. */
  const spawnRider = () => {
    const cam = engine.camera.position;
    engine.camera.getWorldDirection(camDir);
    const ids = g.near(cam.x, cam.z, 240);
    if (!ids.length) return;
    const pv = player();
    for (let attempt = 0; attempt < 10; attempt++) {
      const id = ids[Math.floor(rnd() * ids.length)];
      const l = g.links[id];
      if (l.len < 24 || NO_RIDERS.has(l.cls) || g.endsAfter(id) || g.avoid.has(id)) continue;
      const s = 6 + rnd() * (l.len - 12);
      g.at(l, s, -l.kerbR + 0.8, tmp);   // inside the cars parked along the kerb, where there are any
      const d = Math.hypot(tmp.x - cam.x, tmp.z - cam.z);
      if (d < 70 || d > 240) continue;
      if (d < 190 && ((tmp.x - cam.x) * camDir.x + (tmp.z - cam.z) * camDir.z) / d > 0.3) continue;
      if (pool.some((o) => o.active && Math.hypot(o.car.pos.x - tmp.x, o.car.pos.z - tmp.z) < 10)) continue;
      if (pv && Math.hypot(pv.car.pos.x - tmp.x, pv.car.pos.z - tmp.z) < 25) continue;
      const lift = deckAt(l, s, tmp.x, tmp.z);
      if (Number.isNaN(lift)) continue;
      const body: BodyType = 'ebike';
      let n = pool.find((p) => !p.active && !p.parked && p.body === body);   // a free slot keeps its own scooter (see spawnBike)
      if (!n) { n = makeNpc(newCar(body), body); pool.push(n); }
      kitFor(body);
      n.car.body.setEnabled(true);
      n.car.reset({ x: tmp.x, y: lift + 0.03 + n.car.spec.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
      const delivery = rnd() < 0.55 ? DELIVERY[Math.floor(rnd() * DELIVERY.length)] : null;
      const vmax = delivery ? 8 + rnd() * 3 : 5.5 + rnd() * 3;
      n.car.setMoving(Math.min(vmax, l.speed) * 0.8);
      n.driver = new AiDriver(g, sig, id, s, 0, rnd);
      n.driver.vmax = vmax; n.driver.kerb = 0.75 + rnd() * 0.4;
      n.filter.reset();
      n.taxi = false; n.upper.set(EBIKE_BODY[Math.floor(rnd() * EBIKE_BODY.length)]);
      n.lower.set(delivery ?? (rnd() < 0.6 ? '#2a2b2d' : '#d9d9d4'));
      n.rider = { gait: n.rider?.gait ?? new Gait(), look: riderLook(delivery) };
      n.prevPos.copy(n.car.pos); n.curPos.copy(n.car.pos); n.prevQuat.copy(n.car.quat); n.curQuat.copy(n.car.quat);
      n.active = true; n.parked = false; n.bike = false; n.runner = false; n.flipped = 0;
      return;
    }
  };

  /** A rider knocked off (a crash, a fall): they get up and run for the pavement, the scooter lies where it fell. */
  const unseat = (n: Npc) => {
    if (!n.rider) return;
    n.rider = null; n.driver = null; n.parked = true;
    const c = n.car;
    // A scooter rider thrown off speaks as a courier (voice/): most of them are delivery riders.
    engine.get<PeopleApi>('people')?.spawnFleeing(c.pos.x + c.left.x * 1.2, c.pos.z + c.left.z * 1.2, { voice: 'courier', say: 'hit' });
  };

  // The player hit a car: its driver leans on the horn (the player's impact reading is the reliable
  // one; the heavier car being hit reads a much smaller change of velocity).
  engine.events.on('vehicle:impact', ({ point }) => {
    for (const n of pool) {
      if (!n.active || n.parked || n.hornT > 0 || n.rider) continue;
      if (Math.hypot(n.car.pos.x - point[0], n.car.pos.z - point[2]) < 5) { n.hornT = 3 + rnd() * 3; engine.events.emit('traffic:horn', { x: n.car.pos.x, z: n.car.pos.z, car: n.car }); break; }
    }
  });

  /** A physics car carries on as distant traffic (Ghosts.ts), where it is and as it is. */
  const toGhost = (n: Npc) => {
    const dr = n.driver;
    if (!ghosts || !dr || n.runner || n.rider || n.body === 'ebike') return;
    const h: Handover = { link: dr.link, s: dr.s, lane: dr.lane, v: Math.max(0, n.car.forwardSpeed), body: n.body, upper: n.upper, lower: n.lower, taxi: n.taxi };
    // 轻量车就在镜头附近接手：从这辆车现在的位置和朝向接着画，下一段路也照司机选好的走
    if (light) { h.next = dr.nextLink; h.x = n.car.pos.x; h.z = n.car.pos.z; h.yaw = Math.atan2(n.car.fwd.x, n.car.fwd.z); }
    ghosts.take(h);
  };
  /**
   * 车流集中到眼前（2026-11-10，docs/street-level-design.md A2，「只是在地图上开车」）：实体车的名额原来谁先占谁用，一辆停在
   * 平行小街红灯前、镜头看不到的车能占着名额到 330 米外；名额满了，前方开过来的远景车到 120 米只能消失，所以近处比远处还稀
   * （实测 150 米内高画质 13-40 辆、低画质 5-12 辆）。现在名额满时，镜头里有远景车开进了交接圈，就让最不值的一辆实体车让位：
   * 镜头外 90 米以上的，或者镜头里比那辆远景车还远 60 米以上的；玩家身边 70 米内的、公交进站的、被撞停的都不动。
   */
  const makeRoom = () => {
    const cam = engine.camera.position;
    const dg = ghosts!.waitingInView(cam);
    if (!(dg < Infinity)) return;
    engine.camera.getWorldDirection(camDir);
    const pv = player();
    let worst: Npc | null = null, ws = 0;
    for (const n of pool) {
      if (!n.active || n.parked || n.rider || n.runner || n.held || n.fare || n.bike || !n.driver || n.driver.busStop || n.driver.mode !== 'drive') continue;
      const dx = n.car.pos.x - cam.x, dz = n.car.pos.z - cam.z, d = Math.hypot(dx, dz);
      const seen = d < 1 || (dx * camDir.x + dz * camDir.z) / d > 0.2;
      if (seen ? d < dg + 60 : d < 90) continue;
      if (pv && Math.hypot(pv.car.pos.x - n.car.pos.x, pv.car.pos.z - n.car.pos.z) < 70) continue;
      const score = d * (seen ? 1 : 2.5);
      if (score > ws) { ws = score; worst = n; }
    }
    if (!worst) return;
    toGhost(worst);
    despawn(worst);
  };
  const despawn = (n: Npc) => {
    n.active = false; n.driver = null; n.parked = false; n.bike = false; n.runner = false; n.rider = null; n.held = false; n.fare = null;
    n.car.body.setTranslation({ x: 0, y: -300, z: 0 }, false);
    n.car.body.setEnabled(false);
  };

  /** 玩家徒步站在哪（坐在公交、出租车里的不算：人在车里，不在路上）。 */
  const footOf = () => { const pl = engine.get<PlayerApi>('player'); return pl && !pl.riding ? pl.foot : null; };
  /** 一辆能坐的车的把手（`FareCar`）：`n` 这个名额换了车、被收走以后就不作数了。 */
  const fares = new WeakMap<AiDriver, FareCar>();
  const fareOf = (n: Npc, kind: 'bus' | 'taxi'): FareCar => {
    const car = n.car, dr0 = n.driver;
    const live = () => n.active && n.car === car && n.driver === dr0 && !!dr0 && !n.parked && pool.includes(n);
    const f: FareCar = {
      car, kind,
      // 被蹭了一下愣两秒（'shaken'）不算完；'lost' 是开不了了
      get alive() { return live() && dr0!.mode !== 'lost' && car.up.y > 0.6; },
      get stopped() { return live() && dr0!.atStop; },
      get link() { return dr0!.link; },
      get s() { return dr0!.s; },
      get left() { return dr0!.planLeft; },
      stop(s) {
        if (!live() || dr0!.busStop) return;
        const l = g.links[dr0!.link], v = Math.max(0, car.forwardSpeed);
        // 刹得住的地方起算；这段路快到头了就停在头上（过了路口这里会再叫一次）
        const soon = dr0!.s + v * v / (2 * 1.8) + 2;
        dr0!.busStop = { s: Math.min(l.len - 1.5, s !== undefined && s > soon ? s : soon), dwell: 1e9 };
      },
      go(links) {
        if (!live()) return;
        dr0!.busStop = null;
        // 有客的出租车开得快一点（红灯照等）
        if (links) { dr0!.follow(links); dr0!.boost = links.length ? 1.15 : 1; }
      },
      keep(on) { if (live()) n.fare = on ? f : null; else if (!on && n.fare === f) n.fare = null; },
      pose(alpha, pos, quat) { pos.lerpVectors(n.prevPos, n.curPos, alpha); quat.slerpQuaternions(n.prevQuat, n.curQuat, alpha); },
      get stuck() { return live() ? dr0!.stuck : 0; },
      get red() { return live() && dr0!.red; },
      hop() {
        if (!live()) return false;
        const pv = player(), len = specLength(car.spec);
        for (const ahead of [16, 24, 32, 42, 54, 68]) {
          let lift = 0;
          const done = dr0!.hop(ahead, (at, link, s) => {
            const l = g.links[link];
            lift = deckAt(l, s, at.x, at.z);
            if (Number.isNaN(lift)) return false;
            // 那儿的车道上得空着：和别的车不叠（并排车道上的不算，上下两层的不算）
            const clear = (x: number, y: number, z: number, olen: number) => {
              const rx = x - at.x, rz = z - at.z;
              return Math.abs(y - lift) > 3 || Math.abs(rx * at.dz - rz * at.dx) > 2.1 || Math.abs(rx * at.dx + rz * at.dz) > (olen + len) / 2 + 1.5;
            };
            if (pv && !clear(pv.car.pos.x, pv.car.pos.y, pv.car.pos.z, specLength(pv.car.spec))) return false;
            for (const o of pool) if (o !== n && o.active && !clear(o.car.pos.x, o.car.pos.y, o.car.pos.z, specLength(o.car.spec))) return false;
            if (ghosts) for (const o of ghosts.nearList) if (!clear(o.qx, o.y, o.qz, o.len)) return false;
            return true;
          });
          if (!done) continue;
          const at = tmp;
          g.at(g.links[dr0!.link], dr0!.s, g.laneOffset(g.links[dr0!.link], dr0!.lane), at);
          car.reset({ x: at.x, y: lift + 0.03 + car.spec.wheelRadius + 0.04, z: at.z }, Math.atan2(at.dx, at.dz));
          car.setMoving(3);
          n.filter.reset(); n.flipped = 0;
          n.prevPos.copy(car.pos); n.curPos.copy(car.pos); n.prevQuat.copy(car.quat); n.curQuat.copy(car.quat);
          return true;
        }
        return false;
      },
    };
    return f;
  };

  const leaderFor = (n: Npc): Leader | null => {
    const c = n.car;
    let best: Leader | null = null, bestAlong = Infinity;
    // Centre-to-centre distance corrected for both bodies: AiDriver takes one car length (4.6 m)
    // off itself, so a 12 m bus in front is not followed as if it were a saloon.
    const selfLen = specLength(c.spec), selfHw = c.spec.single ? 0.4 : 0.95;
    const consider = (px: number, py: number, pz: number, vx: number, vz: number, len = 4.6, hw = 0.95) => {
      const rx = px - c.pos.x, rz = pz - c.pos.z;
      const along = rx * c.fwd.x + rz * c.fwd.z;
      if (along < 1 || along > 60) return;
      const lat = Math.abs(rx * c.left.x + rz * c.left.z);
      if (lat > selfHw + hw + along * 0.03) return;
      // Not a car on the deck above or the road below (an interchange stacks them in plan).
      if (Math.abs(py - c.pos.y) > 3) return;
      if (along < bestAlong) { bestAlong = along; best = { gap: Math.max(0.5, along - (len + selfLen) / 2 + 4.6), speed: Math.max(0, vx * c.fwd.x + vz * c.fwd.z) }; }
    };
    for (const o of pool) if (o !== n && o.active) consider(o.car.pos.x, o.car.pos.y, o.car.pos.z, o.car.vel.x, o.car.vel.z, specLength(o.car.spec), o.car.spec.single ? 0.4 : 0.95);
    const pv = player();
    if (pv) consider(pv.car.pos.x, pv.car.pos.y, pv.car.pos.z, pv.car.vel.x, pv.car.vel.z, specLength(pv.car.spec));
    // People in the road: drivers brake for the player on foot and for crossing pedestrians.
    const foot = footOf();
    if (foot) consider(foot.pos.x, foot.pos.y, foot.pos.z, 0, 0, 0.6, 0.4);
    const people = engine.get<PeopleApi>('people');
    if (people) for (const q of people.inRoad()) consider(q.x, 0.5, q.z, 0, 0, 0.6, 0.4);
    for (const c of engine.get<WantedApi>('wanted')?.policeCars() ?? []) consider(c.pos.x, c.pos.y, c.pos.z, c.vel.x, c.vel.z);
    for (const p of externalCars) if (p.blocking) for (const c of p.blocking()) consider(c.pos.x, c.pos.y, c.pos.z, c.vel.x, c.vel.z, specLength(c.spec));
    // The distant traffic on the same lane ahead (the band where both kinds drive, 220-330 m out).
    const dr = n.driver;
    if (ghosts && dr) {
      // 近处的轻量车也按位置看（同向的：横着过来的由它让，见 Ghosts.ts；骑手从路边挤过排队的车时不再穿过去）
      if (light) for (const o of ghosts.nearList) {
        const rx = o.qx - c.pos.x;
        if (rx > 62 || rx < -62) continue;
        const rz = o.qz - c.pos.z;
        if (rz > 62 || rz < -62 || o.hx * c.fwd.x + o.hz * c.fwd.z < 0.3) continue;
        consider(o.qx, o.y + c.spec.wheelRadius, o.qz, o.hx * o.v, o.hz * o.v, o.len);
      }
      const o = ghosts.leaderFor(dr.link, dr.s, dr.lane, dr.nextLink);
      if (o && o.ds < 60) {
        const gap = Math.max(0.5, o.ds - (o.len + selfLen) / 2 + 4.6);
        if (!best || gap < (best as Leader).gap) best = { gap, speed: o.v };
      }
    }
    return best;
  };

  /** The rider in the saddle, as the player sits on theirs (player/index.ts): the pelvis on SEAT, upright. */
  const drawRider = (n: Npc, dt: number) => {
    const crowd = crowdOf(), r = n.rider!;
    if (!crowd) return;
    const d = Math.hypot(renderPos.x - engine.camera.position.x, renderPos.z - engine.camera.position.z);
    if (d > 160) return;
    const seat = SEAT.ebike;
    seatAt.set(seat[0], seat[1], seat[2]).applyQuaternion(renderQuat).add(renderPos);
    seatFwd.set(0, 0, 1).applyQuaternion(renderQuat);
    riderMotion.speed = n.car.forwardSpeed;
    r.gait.update(riderMotion, dt, 0.3);
    seatAt.y -= PELVIS_Y * r.gait.scale;
    crowd.add(seatAt, Math.atan2(seatFwd.x, seatFwd.z), r.gait, r.look);
  };

  const api: TrafficApi & { ghosts: GhostTraffic | null; debugPool(): readonly Npc[]; debugLeader(n: Npc): Leader | null } = {
    name: 'traffic',
    ghosts,
    /** The pool as it is (probes: `.scratch/streetlevel/lightdiag.mjs`). */
    debugPool: () => pool,
    debugLeader: (n) => leaderFor(n),
    graph: g, signals: sig, lineStats, riderCap: RIDERS,
    get time() { return t; },
    addExternalCars: (provider) => { externalCars.push(provider); },
    addExternalDraw: (draw) => { externalDraws.push(draw); },
    cars: () => [...pool.filter((n) => n.active).map((n) => n.car), ...externalCars.flatMap((p) => p.cars())],
    nearestCar(x, z, r) {
      let best: Vehicle | null = null, bd = r;
      for (const n of pool) {
        if (!n.active) continue;
        const d = Math.hypot(n.car.pos.x - x, n.car.pos.z - z);
        if (d < bd) { bd = d; best = n.car; }
      }
      for (const provider of externalCars) for (const car of provider.cars()) {
        if (!provider.canTake(car)) continue;
        const d = Math.hypot(car.pos.x - x, car.pos.z - z);
        if (d < bd) { bd = d; best = car; }
      }
      return best;
    },
    takeCar(car) {
      for (const provider of externalCars) { const look = provider.take(car); if (look) return look; }
      const i = pool.findIndex((n) => n.active && n.car === car);
      if (i < 0) return null;
      const n = pool[i];
      const look: CarLook = { upper: n.upper.clone(), lower: n.lower.clone(), taxi: n.taxi, parked: n.parked, body: n.body };
      // The Vehicle now belongs to the player; its pool slot gets another of the same kind.
      pool[i] = makeNpc(newCar(n.body), n.body);
      return look;
    },
    clearNear(x, z, r) {
      let k = 0;
      for (const n of pool) {
        if (!n.active || n.parked || n.rider) continue;
        if (Math.hypot(n.car.pos.x - x, n.car.pos.z - z) > r) continue;
        if (engine.get<VehicleApi>('vehicle')?.car === n.car) continue;
        despawn(n); k++;
      }
      if (light && ghosts) k += ghosts.clearNear(x, z, r);
      return k;
    },
    fareNear(x, z, r, kind, ok) {
      let best: Npc | null = null, bd = r;
      for (const n of pool) {
        const dr = n.driver;
        if (!n.active || n.parked || n.runner || n.held || n.rider || !dr || dr.mode !== 'drive' || n.car.up.y < 0.8) continue;
        if (kind === 'bus' ? n.body !== 'bus' || !dr.atStop : n.body !== 'sedan' || !n.taxi) continue;
        const d = Math.hypot(n.car.pos.x - x, n.car.pos.z - z);
        if (d < bd && (!ok || ok(n.car))) { bd = d; best = n; }
      }
      if (!best) return null;
      let f = best.fare ?? fares.get(best.driver!);
      if (!f) { f = fareOf(best, kind); fares.set(best.driver!, f); }
      return f;
    },
    hold(car, on) {
      const n = pool.find((p) => p.active && p.car === car);
      if (!n || n.parked || n.runner || n.rider || !n.driver) return false;
      n.held = on;
      if (!on) { n.filter.reset(); n.driver.shake(); }
      return true;
    },
    spawnRunner(x, z, hx, hz, opts) {
      // On the player's own road, the way they are facing, 60-90 m ahead: a chase that starts with
      // the quarry in sight, not a 2 km detour round the one-ways to where it was.
      let best = -1, bd = 40, bs = 0;
      for (const id of g.near(x, z, 60)) {
        const l = g.links[id];
        if (l.cls === 'service' || l.cls === 'living_street') continue;
        const pr = g.project(l, x, z, l.len / 2);
        g.at(l, pr.s, 0, tmp);
        if (tmp.dx * hx + tmp.dz * hz < 0.4 || pr.d >= bd) continue;
        bd = pr.d; best = id; bs = pr.s;
      }
      if (best < 0) return null;
      for (let attempt = 0; attempt < 6; attempt++) {
        let id = best, s = bs + 60 + rnd() * 30;
        while (s > g.links[id].len - 8) { const n = g.next(id, rnd); if (n < 0) break; s -= g.links[id].len; id = n; }
        const l = g.links[id];
        s = Math.min(s, l.len - 8);
        g.at(l, s, g.laneOffset(l, 0), tmp);
        if (pool.some((o) => o.active && Math.hypot(o.car.pos.x - tmp.x, o.car.pos.z - tmp.z) < 8)) { bs += 12; continue; }
        const lift = deckAt(l, s, tmp.x, tmp.z);
        if (Number.isNaN(lift)) { bs += 12; continue; }
        const body: BodyType = rnd() < 0.5 && bodySettled('hatch') ? 'hatch' : 'sedan';
        let n = pool.find((p) => !p.active && !p.parked && p.body === body);
        if (!n) { n = makeNpc(newCar(body), body); pool.push(n); }   // a free slot keeps its own car (see spawnBike)
        kitFor(body);
        n.car.body.setEnabled(true);
        n.car.reset({ x: tmp.x, y: lift + 0.03 + n.car.spec.wheelRadius + 0.04, z: tmp.z }, Math.atan2(tmp.dx, tmp.dz));
        n.car.setMoving(l.speed);
        n.driver = new AiDriver(g, sig, id, s, 0, rnd);
        // `calm`: an ordinary driver (a car to follow), until `bolt` makes it a getaway.
        if (!opts?.calm) { n.driver.boost = 1.3; n.driver.reckless = true; }
        n.filter.reset(); paint(n); n.taxi = false; n.upper.set('#161718'); n.lower.set('#161718');
        n.prevPos.copy(n.car.pos); n.curPos.copy(n.car.pos); n.prevQuat.copy(n.car.quat); n.curQuat.copy(n.car.quat);
        n.active = true; n.parked = false; n.bike = false; n.runner = true; n.flipped = 0;
        const npc = n;
        return { car: npc.car, release: () => { if (npc.active && npc.runner) despawn(npc); }, bolt: () => { if (npc.driver) { npc.driver.boost = 1.35; npc.driver.reckless = true; } } };
      }
      return null;
    },
    rentBike(b: SharedBike) {
      const car = newCar('bike');
      car.body.setEnabled(true);
      car.reset({ x: b.x, y: b.y + car.spec.wheelRadius + 0.04, z: b.z }, b.heading);
      return car;
    },
    parkCar(car, look) {
      if (externalCars.some((provider) => provider.park(car))) return;
      const parked = pool.filter((n) => n.parked && !n.bike);
      if (parked.length >= MAX_PARKED) despawn(parked[0]);
      const body = look.body ?? bodyOfSpec(car.spec);
      let n = pool.find((p) => !p.active && !p.parked);
      if (n) recycle(n); else { n = makeNpc(car, body); pool.push(n); }
      Object.assign(n, { car, active: true, parked: true, driver: null, flipped: 0, body, bike: false, held: false });
      n.filter.reset();
      kitFor(body);
      n.upper.copy(look.upper); n.lower.copy(look.lower); n.taxi = look.taxi;
      n.prevPos.copy(car.pos); n.curPos.copy(car.pos); n.prevQuat.copy(car.quat); n.curQuat.copy(car.quat);
      // Already in the pool either way (a reused slot, or pushed above): pushing it again stepped the
      // car twice a frame, and a second entry survived `takeCar`, so the player's own car, taken back,
      // stood with its handbrake on.
    },
    fixedUpdate(dt) {
      t += dt;
      spawnT -= dt;
      if (showT > 0 && (showT -= dt) <= 0) showT = showcase() || ++showTries >= 30 ? -1 : 1;
      // Police with their sirens on: drivers they are coming up behind (or meeting head-on) pull over.
      const wanted = engine.get<WantedApi>('wanted');
      if (wanted && wanted.level > 0) {
        for (const c of wanted.policeCars()) {
          if (c.speed < 6) continue;
          for (const n of pool) {
            if (!n.active || n.parked || !n.driver) continue;
            const rx = c.pos.x - n.car.pos.x, rz = c.pos.z - n.car.pos.z;
            if (rx * rx + rz * rz > 55 * 55 || Math.abs(c.pos.y - n.car.pos.y) > 3) continue;
            const along = rx * n.car.fwd.x + rz * n.car.fwd.z, lat = Math.abs(rx * n.car.left.x + rz * n.car.left.z);
            const closing = c.vel.x * n.car.fwd.x + c.vel.z * n.car.fwd.z;
            if (lat < 8 && ((along < -2 && closing > n.car.forwardSpeed + 2) || (along > 4 && closing < -4))) { if (n.driver.yieldT <= 0) lineStats.yields++; n.driver.yieldT = 2.5; }
          }
        }
      }
      // The pool is full and a distant car the camera looks at is about to reach the ring where it must go: a physics
      // car nobody is looking at gives up its place (it drives on as a distant one, or is gone if that is out of view too).
      roomT -= dt;
      if (roomT <= 0) { roomT = 0.4; if (ghosts && !light && driving() >= carCap()) makeRoom(); }
      if (spawnT <= 0) { spawnT = 0.2; if (!light && driving() < carCap() && !ghosts?.adoptWaiting(engine.camera.position)) spawn(); if (pool.filter((n) => n.active && n.bike).length < BIKES) spawnBike(); if (riding() < riderCap()) spawnRider(); }
      // Buses look for a shelter ahead on their side once a second (at the kerb of the link they are on).
      busT -= dt;
      if (busT <= 0) {
        busT = 1;
        const streamer = (engine.get('world') as unknown as { streamer?: { sheltersNear(x: number, z: number, r: number): number[] } } | undefined)?.streamer;
        // 玩家徒步站在站台上等车（8 米内）：这一站每辆公交都停，刚停过别的站的也停，离得近一点也来得及就停
        const wait = footOf();
        if (streamer) for (const n of pool) {
          if (!n.active || n.parked || n.body !== 'bus' || !n.driver || n.driver.busStop || n.driver.mode !== 'drive') continue;
          // 车上有玩家：差不多站站停（歇 8 秒就找下一站），好让人下车
          const cool = n.driver.busCool > (n.fare ? 22 : 0);
          if (cool && !wait) continue;
          const sh = streamer.sheltersNear(n.car.pos.x, n.car.pos.z, 90);
          for (let i = 0; i < sh.length; i += 2) {
            const mine = !!wait && Math.hypot(sh[i] - wait.pos.x, sh[i + 1] - wait.pos.z) < 8;
            if (cool && !mine) continue;
            const v = Math.max(0, n.car.forwardSpeed);
            const s = n.driver.stopAhead(sh[i], sh[i + 1], mine ? Math.min(15, 4 + v * v / 7) : 15, 85);
            if (s >= 0) { n.driver.busStop = { s, dwell: 8 + rnd() * 4 }; break; }
          }
        }
      }
      for (const n of pool) {
        if (!n.active) continue;
        if (n.parked && nap(n, dt)) continue;
        const inp = n.parked || n.held ? parkedInput : n.driver!.update(n.car, dt, t, leaderFor(n));
        const c = n.filter.update(inp, n.car.forwardSpeed, dt);
        n.prevPos.copy(n.curPos); n.prevQuat.copy(n.curQuat);
        n.car.step(c, dt);
      }
    },
    postStep(dt) {
      const cam = engine.camera.position;
      engine.camera.getWorldDirection(camDir);
      for (const n of pool) {
        if (!n.active) continue;
        n.car.afterStep(dt);
        n.curPos.copy(n.car.pos); n.curQuat.copy(n.car.quat);
        const d = Math.hypot(n.car.pos.x - cam.x, n.car.pos.z - cam.z);
        if (n.parked) { if (d > 420) despawn(n); continue; }
        if (n.held) { if (d > 800) despawn(n); continue; }
        // A rider comes off in anything harder than a nudge, or when the scooter goes over.
        if (n.rider && (n.car.impact > 4 || n.car.up.y < 0.6)) { unseat(n); continue; }
        if (n.car.impact > 3) n.driver!.shake();
        // 公交进站、起步：audio/ 放报站（只报镜头附近的）
        if (n.driver!.busEvent) { if (d < 60 && n.body === 'bus') engine.events.emit('traffic:bus', { x: n.car.pos.x, z: n.car.pos.z, arrive: n.driver!.busEvent === 1 }); n.driver!.busEvent = 0; }
        // Drivers lean on the horn when the player hits them or sits in their way.
        n.hornT -= dt;
        if (n.hornT <= 0 && !n.parked) {
          const pv = player();
          const pd = pv ? Math.hypot(pv.car.pos.x - n.car.pos.x, pv.car.pos.z - n.car.pos.z) : 99;
          if (n.driver!.stuck > 1.8 && pd < 14) { n.hornT = 3 + rnd() * 3; engine.events.emit('traffic:horn', { x: n.car.pos.x, z: n.car.pos.z, car: n.car }); }
        }
        n.flipped = n.car.up.y < 0.5 ? n.flipped + dt : 0;
        // 玩家等着的、坐着的车留着（travel/Ride.ts 自己看它还行不行）；玩家走远了就不留了
        if (n.fare) {
          const pp = playerAt();
          if (Math.hypot(n.car.pos.x - pp.x, n.car.pos.z - pp.z) < 150) continue;
          n.fare = null;
          if (n.driver!.busStop && n.driver!.busStop.dwell > 1e6) n.driver!.busStop = null;   // 叫停了没人管的：接着开
        }
        // 轻量车模式：开出玩家身边（也不在警车、任务车旁边）的，变回远景车接着开
        if (light && ghosts && !n.runner) {
          const hx = n.car.pos.x - ghosts.hot.x, hz = n.car.pos.z - ghosts.hot.z, out = ghosts.hot.r + 25;
          if (hx * hx + hz * hz > out * out) {
            let far = true;
            const hs = ghosts.hots;
            for (let q = 0; far && q < hs.length; q += 3) far = Math.hypot(n.car.pos.x - hs[q], n.car.pos.z - hs[q + 1]) > hs[q + 2] + 18;
            if (far && canGhost(n)) { toGhost(n); despawn(n); continue; }
          }
        }
        const inView = d < 1 || ((n.car.pos.x - cam.x) * camDir.x + (n.car.pos.z - cam.z) * camDir.z) / d > 0.2;
        const dead = n.driver!.mode === 'lost' || n.flipped > 4 || n.driver!.stuck > 15 || n.car.pos.y < -5;
        // A getaway car is measured from the player, not the camera, and only lost when far gone.
        const pv = n.runner ? player() : null;
        if (n.runner ? (pv ? Math.hypot(n.car.pos.x - pv.car.pos.x, n.car.pos.z - pv.car.pos.z) : d) > 900 : (d > 330 || (dead && (d > 90 || !inView)))) {
          // Driving away past the ring: it carries on as distant traffic.
          if (!dead) toGhost(n);
          despawn(n);
        }
      }
    },
    update(_dt, alpha) {
      // Traffic updates before police, races and events: set the view every kit culls against.
      CarKit.view(engine.camera);
      for (const b of kits.keys()) written.set(b, 0);
      for (const n of pool) {
        if (!n.active) continue;
        renderPos.lerpVectors(n.prevPos, n.curPos, alpha);
        renderQuat.slerpQuaternions(n.prevQuat, n.curQuat, alpha);
        const kit = kitFor(n.body), k = written.get(n.body) ?? 0;
        if (k >= kit.cap) continue;
        kit.set(k, renderPos, renderQuat, n.car, n.upper, n.lower, n.taxi);
        written.set(n.body, k + 1);
        if (n.rider) drawRider(n, _dt);
      }
      for (const draw of externalDraws) draw(putExternal, alpha);
      if (ghosts && light) {
        const pl = engine.get<PlayerApi>('player'), pp = playerAt(), pv = player(), cam = engine.camera.position;
        ghosts.hot.x = pp.x; ghosts.hot.z = pp.z;
        // 坐在公交、出租车里：按那辆车的车速算
        let sp = pv && pl?.mode !== 'onfoot' ? pv.car.speed : 0;
        if (pl?.riding) for (const n of pool) if (n.active && n.fare) sp = Math.max(sp, n.car.speed);
        ghosts.hot.r = (engine.lite ? 45 : 55) + Math.min(35, 1.3 * sp);
        const hs = ghosts.hots, bl = ghosts.blockers, mv = ghosts.movers;
        hs.length = 0; bl.length = 0; mv.length = 0;
        const solid = (c: Vehicle, hot: boolean) => {
          if (Math.hypot(c.pos.x - cam.x, c.pos.z - cam.z) > 230) return;
          mv.push(c.pos.x, c.pos.z, c.pos.y - c.spec.wheelRadius, c.vel.x, c.vel.z, specLength(c.spec), c.spec.single ? 0.4 : 0.95);
          if (hot) hs.push(c.pos.x, c.pos.z, 22);
        };
        if (pv) solid(pv.car, false);
        for (const c of engine.get<WantedApi>('wanted')?.policeCars() ?? []) solid(c, true);
        for (const p of externalCars) if (p.blocking) for (const c of p.blocking()) solid(c, true);
        // 实体车：有司机的在车道的队列里（`drivers`），但骑手贴着路边、被撞歪的车横在路上，都要按位置让
        for (const n of pool) if (n.active) solid(n.car, false);
        const foot = footOf();
        if (foot) bl.push(foot.pos.x, foot.pos.z, 0.4);
        const people = engine.get<PeopleApi>('people');
        if (people) for (const q of people.inRoad()) bl.push(q.x, q.z, 0.4);
      }
      if (ghosts) {
        const ds = ghosts.drivers;
        ds.length = 0;
        for (const n of pool) if (n.active && n.driver && !n.parked) ds.push(n.driver.link, n.driver.s, n.driver.lane, Math.max(0, n.car.forwardSpeed), specLength(n.car.spec));
        ghosts.update(_dt, t, engine.camera.position, camDir.set(0, 0, -1).applyQuaternion(engine.camera.quaternion), (engine.get<RenderApi>('render')?.night ?? 0) > 0.35, driving() < carCap());
      }
      const night = (engine.get<RenderApi>('render')?.night ?? 0) > 0.35;
      for (const [b, kit] of kits) { kit.commit(written.get(b) ?? 0); kit.setHeadlights(night); }
      const cam = engine.camera.position;
      heads.update(cam.x, cam.z, t);
    },
  };
  engine.add(api);
}
