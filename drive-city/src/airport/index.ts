import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { EnvUniforms, PlayerApi, RenderApi, VehicleApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import type { StuntApi } from '../stunts';
import { t } from '../core/I18n';
import type { TravelApi } from '../travel';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { buildBridges } from './Bridges';
import { Airside } from './Airside';
import { AIRPORT_BOX, loadAirfield, type AirfieldData } from './Data';
import { Fleet } from './Fleet';
import { Flights, type FlightPose, type Runway } from './Flights';
import { fieldLights, lightMaterial, PlaneLights } from './Lights';
import { buildMarks } from './Marks';
import { occupied, stands, type Stand } from './Parked';
import { dims, type PlaneKind } from './Plane';

/**
 * 首都机场（设计见 docs/airport-design.md，笔记 docs/notes/airport.md）。地面（跑道、滑行道、机坪、空侧草地）、围界、航站楼都在
 * 城市地块里（scripts/city/airfield.mjs）；这里是地块以外的东西：
 * - 第一批（2026-11-16）：跑道和滑行道上的漆（`Marks.ts`）。
 * - 第二批（2026-11-16）：停着的飞机（`Parked.ts`，实例网格 `Fleet.ts`，近处有碰撞体）、起降的飞机（`Flights.ts`，确定性时刻表、
 *   跑道上有人就复飞、地面上的有运动学碰撞体）、廊桥（`Bridges.ts`）、夜里的跑道和滑行道灯、飞机的灯（`Lights.ts`），
 *   发动机的声音由 audio/ 按 `nearestJet` 合成。
 *
 * airfield.json 等镜头进到机场 `LOAD_R` 以内才取。漆只画在地块加载范围以内；飞机和灯在 12 公里内都画（天上的飞机、夜里的灯带
 * 远远就看得见）。`?airport=0` 关掉，`?planes=0` 只关飞机。
 */
export interface AirportApi extends System {
  readonly data: AirfieldData | null;
  /** 现在就取（probe、要去机场的任务）。 */
  load(): Promise<void>;
  /** 离 (x, y, z) 最近的一架在飞（或在跑道上跑）的飞机：距离、推力 0–1、朝着这里的速度（米/秒，正的是在靠近）。没有就是 null。 */
  nearestJet(x: number, y: number, z: number): { d: number; thrust: number; closing: number } | null;
  /** 这一帧在飞的飞机（probe 用）。 */
  readonly flights: readonly FlightPose[];
  /** 停着飞机的机位数（按钟点哈希的那些，不算滑进来的）。 */
  readonly parkedCount: number;
  /** 归时刻表管的机位（`stands()` 的下标）：停着的飞机的哈希跳过它们，有没有飞机看 `flights` 里 `parked` 的。 */
  readonly poolStands: ReadonlySet<number>;
  /** 把飞行时刻表的时钟拨到 t 秒（probe、截图用）。 */
  seek(t: number): void;
  /** (x, z) 在空侧（围界里）。airfield.json 还没取到时是 false。 */
  airside(x: number, z: number): boolean;
  /** (x, z) 在哪条跑道上（两边各外扩 `pad` 米、两头 60 米）：跑道号（如 `18L/36R`）、从南头量起的米数、跑道长。 */
  runwayAt(x: number, z: number, pad?: number): { ref: string; s: number; len: number } | null;
}

const LOAD_R = 3000;
/** 近档：停着的、在飞的各多远以内用细模型。 */
const NEAR_PARKED = 420, NEAR_FLIGHT = 700;
/** 停着的飞机多远以内给碰撞体、最多几架。 */
const COLLIDE_R = 220, COLLIDE_MAX = 14;
/** 玩家离机场范围多远以外，滑行的飞机不再等人（被挡住耽误的时间清零）。 */
const FAR_R = 6000;

type Body = ReturnType<Engine['physics']['world']['createRigidBody']>;

export function install(engine: Engine): void {
  const qs = new URLSearchParams(location.search);
  if (qs.get('airport') === '0') return;
  const planesOn = qs.get('planes') !== '0';
  let data: AirfieldData | null = null;
  let loading: Promise<void> | null = null;
  const group = new THREE.Group();
  group.name = 'airport';
  const cells: THREE.Mesh[] = [];
  // 漆只在地块范围以内：片元离镜头（水平）超过 uFar 就丢掉
  const uFar = { value: engine.quality.tileRadius * 256 };
  const prepare = (o: THREE.Object3D) => (engine.get('render') as unknown as { prepare?(o: THREE.Object3D): void } | undefined)?.prepare?.(o);
  const env = (engine.get('render') as unknown as { uniforms?: EnvUniforms } | undefined)?.uniforms;
  const uNight = env?.uNight ?? { value: 0 };
  const lite = () => !!(engine as unknown as { lite?: boolean }).lite;

  let parkedFleet: Fleet | null = null, flightFleet: Fleet | null = null, flights: Flights | null = null;
  let fieldMat: THREE.ShaderMaterial | null = null, planeMat: THREE.ShaderMaterial | null = null, planeLights: PlaneLights | null = null;
  let st: Stand[] = [];
  let tugs: THREE.InstancedMesh | null = null;
  let airsideMap: Airside | null = null;
  let poses: FlightPose[] = [];
  let parkedCount = 0, parkedT = 0, parkedHour = -1;
  const parkedAt = new THREE.Vector3(1e9, 0, 0);
  let clock = 0;
  // 碰撞体：停着的飞机（固定刚体，按机位编号）、在地上跑的飞机（运动学刚体，复用）
  const { R, world } = engine.physics;
  const parkedBodies = new Map<number, Body>();
  const flightBodies: { b: Body; kind: number }[] = [];
  const q = new THREE.Quaternion(), eul = new THREE.Euler(0, 0, 0, 'YXZ'), UP = new THREE.Vector3(0, 1, 0), ONE = new THREE.Vector3(1, 1, 1);

  /** 一架飞机的碰撞体（相对机身中点正下方）：机身、机翼、两台发动机、主起落架、前起落架、垂尾。车能从机身底下钻过去。 */
  const planeColliders = (b: Body, kind: PlaneKind) => {
    const D = dims(kind), g = groups(CG.WORLD, CG.ALL);
    const add = (d: ReturnType<typeof R.ColliderDesc.cuboid>) => engine.physics.tag(world.createCollider(d.setCollisionGroups(g), b), { surface: 'metal', tag: 'plane' });
    add(R.ColliderDesc.cuboid(D.r * 0.9, D.r * 0.95, D.len / 2 * 0.92).setTranslation(0, D.h, 0));
    add(R.ColliderDesc.cuboid(D.span / 2 * 0.92, 0.25, D.chord / 2).setTranslation(0, D.h - 1.1 * D.r / 1.98, D.wingZ));
    for (const s of [1, -1]) {
      add(R.ColliderDesc.cuboid(D.eng[3], D.eng[3], D.eng[3] * 2.1).setTranslation(s * D.eng[0], D.eng[1], D.eng[2]));
      add(R.ColliderDesc.cuboid(0.35, D.h / 2, 0.6).setTranslation(s * 3.0 * D.span / 34, D.h / 2, -1.6 * D.len / 38));
    }
    add(R.ColliderDesc.cuboid(0.3, 0.6, 0.3).setTranslation(0, 0.6, 14.6 * D.len / 38));
    add(R.ColliderDesc.cuboid(0.3, (D.top - D.h) / 2, D.len * 0.07).setTranslation(0, (D.top + D.h) / 2, -D.len * 0.4));
  };
  const dropBody = (b: Body) => { for (let k = 0; k < b.numColliders(); k++) engine.physics.untag(b.collider(k)); world.removeRigidBody(b); };

  const build = (d: AirfieldData) => {
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, metalness: 0 });
    mat.userData.wet = 'surface';
    mat.polygonOffset = true; mat.polygonOffsetFactor = -6; mat.polygonOffsetUnits = -6;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uFar = uFar;
      sh.vertexShader = sh.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vAirXZ;')
        .replace('#include <begin_vertex>', '#include <begin_vertex>\nvAirXZ = (modelMatrix * vec4(position, 1.0)).xz;');
      sh.fragmentShader = sh.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec2 vAirXZ;\nuniform float uFar;')
        .replace('void main() {', 'void main() {\n  if (distance(vAirXZ, cameraPosition.xz) > uFar) discard;');
    };
    mat.customProgramCacheKey = () => 'airport-marks';
    // 一公里一块（视锥剔除）；跑道最高一层地面在 1.6 厘米（city/Areas.ts），路面在 3 厘米
    for (const geo of buildMarks(d)) {
      const marks = new THREE.Mesh(geo, mat);
      marks.name = 'airport-marks';
      marks.position.y = 0.022;
      marks.receiveShadow = true;
      group.add(marks);
      cells.push(marks);
    }
    st = stands(d);
    flights = new Flights(d, st);
    airsideMap = new Airside(d, flights.rws);
    // 廊桥
    const br = buildBridges(d);
    if (br.geo) {
      const m = new THREE.Mesh(br.geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.2 }));
      m.name = 'airport-bridges'; m.castShadow = true; m.receiveShadow = true;
      group.add(m);
      const body = world.createRigidBody(R.RigidBodyDesc.fixed());
      for (const [x, z, hx, hz, h, yaw] of br.colliders) {
        q.setFromAxisAngle(UP, yaw);
        engine.physics.tag(world.createCollider(R.ColliderDesc.cuboid(hx, h / 2, hz).setTranslation(x, h / 2, z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }).setCollisionGroups(groups(CG.WORLD, CG.ALL)), body), { surface: 'metal', tag: 'jetbridge' });
      }
    }
    // 地上的灯
    fieldMat = lightMaterial(uNight, 0);
    const field = new THREE.Points(fieldLights(d, flights.rws), fieldMat);
    field.name = 'airport-lights'; field.frustumCulled = false;
    group.add(field);
    if (planesOn) {
      parkedFleet = new Fleet([lite() ? 24 : 70, 640], engine.quality.tier !== 'low', 'parked-planes');
      // 起降的、滑行的、停在时刻表机位上的：同时最多五十来架
      flightFleet = new Fleet([28, 64], engine.quality.tier !== 'low', 'flights');
      group.add(parkedFleet.group, flightFleet.group);
      planeMat = lightMaterial(uNight, 0.75);
      planeLights = new PlaneLights(64 * 10);
      // 推出用的推车：矮矮的一个车身加一个小驾驶室（程序拼的，最多同时 8 辆）
      const tugGeo = (() => {
        const parts = [new THREE.BoxGeometry(2.6, 1.1, 5.6).translate(0, 0.75, 0), new THREE.BoxGeometry(1.2, 1.0, 1.4).translate(-0.6, 1.8, -1.9)];
        const cols = [new THREE.Color('#d9a21b'), new THREE.Color('#2b3036')];
        const ps = parts.map((g, k) => { const n = g.toNonIndexed(); const c = new Float32Array(n.getAttribute('position').count * 3); for (let i = 0; i < c.length; i += 3) c.set([cols[k].r, cols[k].g, cols[k].b], i); n.setAttribute('color', new THREE.BufferAttribute(c, 3)); n.deleteAttribute('uv'); return n; });
        return mergeGeometries(ps)!;
      })();
      tugs = new THREE.InstancedMesh(tugGeo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.6 }), 8);
      tugs.name = 'airport-tugs'; tugs.count = 0; tugs.castShadow = true; tugs.frustumCulled = false;
      group.add(tugs);
      const pl = new THREE.Points(planeLights.geo, planeMat);
      pl.name = 'plane-lights'; pl.frustumCulled = false;
      group.add(pl);
    }
    prepare(group);
    engine.scene.add(group);
  };

  const load = (): Promise<void> => {
    loading ??= loadAirfield().then((d) => { data = d; build(d); }).catch((e) => { console.warn('[airport] did not load', e); loading = null; });
    return loading;
  };

  // 快速前往「首都机场 T3」（travel/ 装得比这里晚：开局以后再登记）：车停在 T3C 楼前的到达层车道，人在交通中心门口的地铁口旁边
  engine.events.on('game:start', () => {
    const tr = engine.get<TravelApi>('travel');
    tr?.register({ id: 'airport', group: 'play', label: 'travel.airport', x: 18103, z: -16050, go: () => {
      void tr.land({ road: { x: 18160, z: -16062, yaw: -1.46 }, foot: { x: 18085, z: -16040, yaw: Math.PI }, caption: t('travel.airportArrived'), look: 0.3 });
    } });
  });

  const playerPos = () => engine.get<PlayerApi>('player')?.position ?? engine.camera.position;
  const blocker = { x: 0, z: 0, r: 1 };

  /**
   * 尾流（第三批）：大推力的发动机（起飞滑跑、对正后加油门、停下以后重新起步）后面一个锥形区域，车被往后吹、打转，人被吹倒。
   * 推力 1 时锥长 90 米、口子 3 米、每边张开约 10°；风力按离喷口的距离线性减弱、按推力平方。车停在起飞滑跑的飞机后面 50 米，
   * 会被吹出七八十米、最快六十来公里每小时（2026-11-16 探针 `.scratch/airport/blast.mjs`）。
   */
  const BLAST_FWD = new THREE.Vector3();
  const blast = (dt: number) => {
    if (!poses.length) return;
    const veh = engine.get<VehicleApi>('vehicle'), pl = engine.get<PlayerApi>('player');
    const targets: { body: { mass(): number; applyImpulseAtPoint(i: { x: number; y: number; z: number }, p: { x: number; y: number; z: number }, w: boolean): void; translation(): { x: number; y: number; z: number } } }[] = [];
    const p0 = playerPos();
    let near = false;
    for (const f of poses) if (f.ground && !f.parked && f.thrust >= 0.55 && Math.hypot(f.x - p0.x, f.z - p0.z) < 160) { near = true; break; }
    if (!near) return;
    if (pl?.mode === 'driving' && veh) targets.push({ body: veh.car.body as never });
    const tr = engine.get<TrafficApi>('traffic');
    if (tr) for (const c of tr.cars()) if (c !== veh?.car && Math.hypot(c.pos.x - p0.x, c.pos.z - p0.z) < 200) targets.push({ body: c.body as never });
    for (const f of poses) {
      if (!f.ground || f.parked || f.thrust < 0.55) continue;
      const D = dims(f.kind), L = 90 * Math.min(1, (f.thrust - 0.4) / 0.6);
      const fx = Math.sin(f.yaw), fz = Math.cos(f.yaw);
      BLAST_FWD.set(fx, 0, fz);
      for (const side of [1, -1]) {
        // 喷口：发动机后缘（机头朝 +Z 时左手是 +X）
        const ex = f.x + fz * side * D.eng[0] + fx * (D.eng[2] - D.eng[3] * 2.2), ez = f.z - fx * side * D.eng[0] + fz * (D.eng[2] - D.eng[3] * 2.2);
        const hit = (x: number, z: number): [number, number, number] | null => {
          const dx = x - ex, dz = z - ez, a = -(dx * fx + dz * fz), l = dx * fz - dz * fx;
          if (a <= 0 || a > L || Math.abs(l) > 3 + a * 0.18) return null;
          return [a, l, (1 - a / L) * f.thrust * f.thrust];
        };
        for (const t of targets) {
          const pos = t.body.translation(), h = hit(pos.x, pos.z);
          if (!h) continue;
          // 往后吹、往上掀一点；作用点偏到靠喷口中线的那一侧上方，车会打转、侧翻
          const acc = 18 * h[2], m = t.body.mass(), J = m * acc * dt;
          t.body.applyImpulseAtPoint({ x: -fx * J, y: J * 0.18, z: -fz * J }, { x: pos.x - Math.sign(h[1] || 1) * fz * 0.9, y: pos.y + 0.6, z: pos.z + Math.sign(h[1] || 1) * fx * 0.9 }, true);
        }
        if (pl?.mode === 'onfoot' && !pl.riding && hit(p0.x, p0.z)) {
          const h = hit(p0.x, p0.z)!;
          if (h[2] > 0.25) pl.struck?.(ex, ez, true);
        }
      }
    }
  };

  /** 钻飞机（第三批）：开车从飞机机身底下穿过去（在地上的，滑行的分高、停着的分低），算一次特技进连击。 */
  const under = new Map<number, number>();
  const underPlane = (dt: number) => {
    for (const [k, v] of under) { if (v - dt <= 0) under.delete(k); else under.set(k, v - dt); }
    const pl = engine.get<PlayerApi>('player'), veh = engine.get<VehicleApi>('vehicle');
    if (pl?.mode !== 'driving' || !veh || veh.car.speed < 6) return;
    const p = veh.car.pos;
    const check = (id: number, x: number, z: number, yaw: number, kind: PlaneKind, moving: boolean) => {
      if (under.has(id)) return;
      const D = dims(kind), fx = Math.sin(yaw), fz = Math.cos(yaw), dx = p.x - x, dz = p.z - z;
      const a = dx * fx + dz * fz, l = dx * fz - dz * fx;
      if (Math.abs(a) < D.len * 0.38 && Math.abs(l) < D.r * 0.9 && p.y < D.h - D.r) {
        under.set(id, 8);
        engine.get<StuntApi>('stunts')?.score('underplane', moving ? 300 : 120);
      }
    };
    for (const f of poses) if (f.ground && Math.abs(f.x - p.x) < 60 && Math.abs(f.z - p.z) < 60) check(f.id, f.x, f.z, f.yaw, f.kind, !f.parked);
    const hour = engine.get<RenderApi>('render')?.timeOfDay ?? 12, pool = flights?.poolSet;
    for (let i = 0; i < st.length; i++) {
      const s = st[i];
      if (Math.abs(s.x - p.x) > 40 || Math.abs(s.z - p.z) > 40 || pool?.has(i) || !occupied(i, hour)) continue;
      check(-1 - i, s.x, s.z, s.yaw, s.kind, false);
    }
  };
  const onRunway = (rw: Runway) => {
    const p = playerPos();
    const s = (p.x - rw.sx) * rw.ux + (p.z - rw.sz) * rw.uz, o = Math.abs((p.x - rw.sx) * -rw.uz + (p.z - rw.sz) * rw.ux);
    return s > -60 && s < rw.len + 60 && o < rw.w / 2 + 12 && p.y < 6;
  };

  /** 停着的飞机：镜头挪了 20 米以上（每 0.5 秒看一次）或钟点变了才重排（近档跟着镜头）。 */
  const placeParked = (hour: number) => {
    if (!parkedFleet) return;
    const c = engine.camera.position;
    parkedFleet.begin();
    let n = 0;
    const pool = flights?.poolSet;
    st.forEach((s, i) => {
      if (pool?.has(i) || !occupied(i, hour)) return;
      n++;
      const d = Math.hypot(s.x - c.x, s.z - c.z);
      if (d > 11000) return;
      parkedFleet!.add(s.kind, s.x, 0, s.z, s.yaw, 0, 0, s.livery, d < NEAR_PARKED ? 0 : 1, true);
    });
    parkedFleet.end();
    parkedCount = n;
  };

  const LAND = PlaneLights.LAND, RED = PlaneLights.RED, GREEN = PlaneLights.GREEN, WHITE = PlaneLights.WHITE;
  const tmp = new THREE.Vector3(), m4 = new THREE.Matrix4();
  /** 一架飞机的灯（机体坐标 → 世界）。 */
  const lightsOf = (f: FlightPose) => {
    if (f.parked) return;
    const D = dims(f.kind);
    eul.set(-f.pitch, f.yaw, 0, 'YXZ'); q.setFromEuler(eul);
    m4.compose(tmp.set(f.x, f.y, f.z), q, ONE);
    const put = (x: number, y: number, z: number, c: THREE.Color, size: number, flash: number, seed: number) => {
      tmp.set(x, y, z).applyMatrix4(m4); planeLights!.add(tmp.x, tmp.y, tmp.z, c, size, flash, seed);
    };
    const sp = D.span / 2, wy = D.h - 0.3 * D.r, tz = -5 * D.len / 38, seed = (f.id % 97) / 97;
    put(sp, wy, tz, RED, 1.4, 0, 0);          // 左翼尖（+X）红
    put(-sp, wy, tz, GREEN, 1.4, 0, 0);       // 右翼尖绿
    put(sp, wy, tz - 0.4, WHITE, 2.4, 3, seed);
    put(-sp, wy, tz - 0.4, WHITE, 2.4, 3, seed);
    put(0, D.h + D.r * 1.05, 0, RED, 2.0, 2, seed);          // 背上防撞灯
    put(0, D.h - D.r * 1.05, 2, RED, 2.0, 2, seed + 0.5);    // 肚子底下
    put(0, D.h, -D.len / 2, WHITE, 1.2, 0, 0);               // 尾灯
    if (f.landing) { put(1.5, D.h - D.r * 0.9, D.len * 0.3, LAND, 5.5, 0, 0); put(-1.5, D.h - D.r * 0.9, D.len * 0.3, LAND, 5.5, 0, 0); }
  };

  const api: AirportApi = {
    name: 'airport',
    get data() { return data; },
    get flights() { return poses; },
    get parkedCount() { return parkedCount; },
    get poolStands() { return flights?.poolSet ?? new Set<number>(); },
    load,
    seek(t) { clock = t; },
    airside(x, z) { return !!airsideMap?.inside(x, z); },
    runwayAt(x, z, pad = 0) { const r = airsideMap?.runwayAt(x, z, pad); return r ? { ref: r.rw.ref, s: r.s, len: r.rw.len } : null; },
    nearestJet(x, y, z) {
      let best: { d: number; thrust: number; closing: number } | null = null;
      for (const f of poses) {
        if (f.parked) continue;
        const dx = f.x - x, dy = f.y + dims(f.kind).h - y, dz = f.z - z, d = Math.hypot(dx, dy, dz);
        if (best && d >= best.d) continue;
        best = { d, thrust: f.thrust, closing: -(dx * f.vx + dy * f.vy + dz * f.vz) / Math.max(1, d) };
      }
      return best;
    },
    fixedUpdate(dt) {
      clock += dt;
      if (!data || !planesOn) return;
      const p = playerPos();
      // 停着的飞机：玩家附近最近的几架给碰撞体
      const hour = engine.get<RenderApi>('render')?.timeOfDay ?? 12;
      const near: [number, number][] = [];
      const pool = flights?.poolSet;
      for (let i = 0; i < st.length; i++) { const s = st[i], d = Math.abs(s.x - p.x) + Math.abs(s.z - p.z); if (d < COLLIDE_R * 1.4 && Math.hypot(s.x - p.x, s.z - p.z) < COLLIDE_R && !pool?.has(i) && occupied(i, hour)) near.push([d, i]); }
      near.sort((a, b) => a[0] - b[0]);
      const want = new Set(near.slice(0, COLLIDE_MAX).map(([, i]) => i));
      for (const [i, b] of parkedBodies) if (!want.has(i)) { dropBody(b); parkedBodies.delete(i); }
      for (const i of want) if (!parkedBodies.has(i)) {
        const s = st[i];
        q.setFromAxisAngle(UP, s.yaw);
        const b = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(s.x, 0, s.z).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
        planeColliders(b, s.kind);
        parkedBodies.set(i, b);
      }
      // 在地上（或刚离地）的飞机：玩家 250 米内的跟着动
      let k = 0;
      for (const f of poses) {
        if (f.y > 12 || Math.hypot(f.x - p.x, f.z - p.z) > 250) continue;
        while (flightBodies.length <= k) flightBodies.push({ b: world.createRigidBody(R.RigidBodyDesc.kinematicPositionBased().setTranslation(0, -600, 0)), kind: -1 });
        const fb = flightBodies[k++];
        if (fb.kind !== f.kind) {
          for (let c = fb.b.numColliders() - 1; c >= 0; c--) { const col = fb.b.collider(c); engine.physics.untag(col); world.removeCollider(col, false); }
          planeColliders(fb.b, f.kind); fb.kind = f.kind;
        }
        eul.set(-f.pitch, f.yaw, 0, 'YXZ'); q.setFromEuler(eul);
        fb.b.setNextKinematicTranslation({ x: f.x, y: f.y, z: f.z });
        fb.b.setNextKinematicRotation({ x: q.x, y: q.y, z: q.z, w: q.w });
      }
      for (let i = k; i < flightBodies.length; i++) flightBodies[i].b.setNextKinematicTranslation({ x: 0, y: -600 - i * 50, z: 0 });
      blast(dt);
      underPlane(dt);
    },
    update(dt) {
      const c = engine.camera.position;
      if (!loading) {
        const dx = Math.max(AIRPORT_BOX.x0 - c.x, 0, c.x - AIRPORT_BOX.x1), dz = Math.max(AIRPORT_BOX.z0 - c.z, 0, c.z - AIRPORT_BOX.z1);
        if (Math.hypot(dx, dz) < LOAD_R) void load();
      }
      uFar.value = engine.quality.tileRadius * 256;
      // 整块都在加载范围以外的漆不画
      for (const m of cells) {
        const b = m.geometry.boundingSphere!;
        m.visible = Math.hypot(b.center.x - c.x, b.center.z - c.z) < uFar.value + b.radius;
      }
      if (!data) return;
      const cam = engine.camera;
      const scale = engine.renderer.domElement.height / (2 * Math.tan(cam.fov * Math.PI / 360));
      for (const mt of [fieldMat, planeMat]) if (mt) { mt.uniforms.uTime.value = clock; mt.uniforms.uScale.value = scale; }
      if (!planesOn || !flights || !flightFleet || !planeLights) return;
      const hour = engine.get<RenderApi>('render')?.timeOfDay ?? 12;
      parkedT -= dt;
      if (Math.floor(hour) !== parkedHour || (parkedT <= 0 && c.distanceTo(parkedAt) > 20)) { parkedHour = Math.floor(hour); parkedT = 0.5; parkedAt.copy(c); placeParked(hour); }
      // 挡滑行的飞机：玩家（开车是车、走路是人）
      const pl = engine.get<PlayerApi>('player');
      const pp = playerPos();
      blocker.x = pp.x; blocker.z = pp.z; blocker.r = pl?.mode === 'driving' ? 2.4 : 0.6;
      const bx = Math.max(AIRPORT_BOX.x0 - pp.x, 0, pp.x - AIRPORT_BOX.x1), bz = Math.max(AIRPORT_BOX.z0 - pp.z, 0, pp.z - AIRPORT_BOX.z1);
      flights.far = Math.hypot(bx, bz) > FAR_R;
      poses = flights.poses(clock, hour, c.x, c.z, onRunway, pp.y < 8 && !flights.far ? blocker : null);
      // 省电档：停在机位上的都画（不动，便宜），动着的只画离镜头最近的四架
      const shown = lite() ? [...poses.filter((f) => f.parked), ...poses.filter((f) => !f.parked).sort((a, b) => Math.hypot(a.x - c.x, a.z - c.z) - Math.hypot(b.x - c.x, b.z - c.z)).slice(0, 4)] : poses;
      flightFleet.begin(); planeLights.begin();
      for (const f of shown) {
        const d = Math.hypot(f.x - c.x, f.y - c.y, f.z - c.z);
        if (d > 12000) continue;
        flightFleet.add(f.kind, f.x, f.y, f.z, f.yaw, f.pitch, 0, f.livery, d < NEAR_FLIGHT ? 0 : 1, f.gear);
        lightsOf(f);
      }
      flightFleet.end(); planeLights.end();
      // 推车：推出时拖杆连着前轮，车在机头底下
      if (tugs) {
        let n = 0;
        for (const f of shown) {
          if (!f.push || n >= 8 || Math.hypot(f.x - c.x, f.z - c.z) > 900) continue;
          const D = dims(f.kind), fx = Math.sin(f.yaw), fz = Math.cos(f.yaw), k = 14.6 * D.len / 38 + 5.5;
          q.setFromAxisAngle(UP, f.yaw + Math.PI);
          m4.compose(tmp.set(f.x + fx * k, 0, f.z + fz * k), q, ONE);
          tugs.setMatrixAt(n++, m4);
        }
        tugs.count = n; tugs.visible = n > 0;
        if (n) tugs.instanceMatrix.needsUpdate = true;
      }
    },
  };
  engine.add(api);
}
