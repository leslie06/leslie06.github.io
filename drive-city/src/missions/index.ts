import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { lang, t } from '../core/I18n';
import { Rng } from '../core/Rng';
import { project } from '../city/Geo';
import { LANDMARKS } from '../city/landmarks';
import type { Blip, DialogueApi, HudApi, MissionApi, NavApi, PeopleApi, PlayerApi, RaceApi, RenderApi, VehicleApi, WantedApi } from '../game/Contracts';
import { paxLook, pickPax, PaxRide, type PaxKind } from './Passengers';
import { STAR_TIME, STAR_TIP, starText } from './Comfort';
import { kerbReach, placeLabel, rankPlaces, usable } from './Dest';
import { AIR_MAX, AIR_MIN, airChance, airFare, airLimit, AIRPORT_NEAR, atDepartures, IN_MAX, IN_MIN, inboundWeights, RANK_R, RANK_STILL, RANKS, rankWait, T3_DEP } from './AirFares';
import { Luggage } from './Luggage';
import { redAhead } from './RedLight';
import type { Place } from '../nav/Places';
import { journalOf } from '../npc/Journal';
import type { TrafficApi } from '../traffic';
import { Gait } from '../character/Animator';
import { randomLook, type Look } from '../character/Body';
import { nearestKerb, SIDEWALK, type Kerb } from '../people/Pavement';
import type { ParkingApi } from '../parking';
import { Marker } from './Marker';
import { Jobs } from './Jobs';
import { Tofu } from './Tofu';
import type { CampaignApi } from '../campaign';
import type { UndergroundApi } from '../underground';
import type { AdventureApi } from '../game/Contracts';
import { pickAddress } from './Address';
import { Banner } from '../ui/Banner';
import { MissionHud } from './MissionHud';
import type { TravelApi } from '../travel';

/** 'pickup': hailers are out and the taxi is empty; 'wait': a moment after a drop-off. */
type Stage = 'off' | 'wait' | 'pickup' | 'boarding' | 'ride' | 'alight';

/**
 * A fare's colour says how far it goes (Crazy Taxi's code): green a short hop, yellow across the
 * district, red a long haul. Ranges are road metres; `weight` is how often each is hailing.
 */
const TIERS = [
  { color: '#58d26a', min: 300, max: 800, weight: 0.45 },
  { color: '#ffc21f', min: 800, max: 1500, weight: 0.35 },
  { color: '#ff5a4a', min: 1500, max: 2600, weight: 0.2 },
  // 首都机场（2026-11-16，第三批）：3 城里接的去机场的长单（AirFares.ts 的 `airChance` 定谁去），4 蓄车池接的进城大单；
  // 都不按 `weight` 抽，蓝色，拖着箱子
  { color: '#3fa9ff', min: AIR_MIN, max: AIR_MAX, weight: 0 },
  { color: '#3fa9ff', min: IN_MIN, max: AIR_MAX, weight: 0 },
];
/** 机场的两档（TIERS 的下标）。 */
const AIR_OUT = 3, AIR_IN = 4;
/** A street event's rush fare: its colour, and how long it waits for you (s). */
const URGENT_COLOR = '#ff2d55', URGENT_WAIT = 40;
/** People hailing at once, and how far out they stand (m). */
const HAILERS = 4, HAIL_MIN = 45, HAIL_MAX = 260;
/** Seconds a shift starts with; each delivery adds some back. */
const SHIFT = 60;
/** The arcade meter: flag fall plus yuan per km, so a long haul pays for itself (Beijing's tariff paid ¥13 for anything under 3 km). */
const payFor = (km: number) => Math.round(8 + 14 * km);
/** How much of the passenger's time was left on arrival -> speed bonus (share of the fare) and shift seconds. */
const RATINGS = [{ min: 0.45, bonus: 0.6, time: 12, key: 'taxi.rate.fast' }, { min: 0.2, bonus: 0.25, time: 8, key: 'taxi.rate.ok' }, { min: -1, bonus: 0, time: 4, key: 'taxi.rate.slow' }] as const;
/** A shift's grade by what it earned. */
const GRADES: [number, string][] = [[400, 'S'], [250, 'A'], [130, 'B'], [50, 'C'], [0, 'D']];


/** Beijing taxi meter: ¥13 covers the first 3 km, then ¥2.3 per km. */
export const fare = (km: number) => Math.round(13 + Math.max(0, km - 3) * 2.3);

/**
 * Well-known places besides the modelled landmarks. Each is anchored to its OSM street (`road`),
 * so the fare stops on the right street whatever the datum of the rough lat/lon hint.
 */
export const PLACES: { zh: string; en: string; road: string; lat: number; lon: number }[] = [
  { zh: '王府井', en: 'Wangfujing', road: '王府井大街', lat: 39.9149, lon: 116.4108 },
  // 首都机场（2026-11-16）：航站楼前车道边的路 OSM 没名字，按点找最近的路边；城里打车单最长 2.6 公里，只有在机场附近才会去
  { zh: '首都机场T3航站楼', en: 'Capital Airport Terminal 3', road: '', lat: 40.05418, lon: 116.6079 },
  { zh: '首都机场T2航站楼', en: 'Capital Airport Terminal 2', road: '', lat: 40.0761, lon: 116.58518 },
  { zh: '东单', en: 'Dongdan', road: '东单北大街', lat: 39.9083, lon: 116.418 },
  { zh: '建国门', en: 'Jianguomen', road: '建国门内大街', lat: 39.9079, lon: 116.4344 },
  { zh: '前门大街', en: 'Qianmen Street', road: '前门大街', lat: 39.896, lon: 116.3975 },
  { zh: '崇文门', en: 'Chongwenmen', road: '崇文门外大街', lat: 39.901, lon: 116.417 },
  { zh: '天坛东门', en: 'Temple of Heaven, East Gate', road: '天坛东路', lat: 39.883, lon: 116.419 },
  { zh: '珠市口', en: 'Zhushikou', road: '珠市口东大街', lat: 39.892, lon: 116.399 },
  { zh: '广渠门', en: 'Guangqumen', road: '广渠门内大街', lat: 39.895, lon: 116.445 },
  { zh: '光华路', en: 'Guanghua Road', road: '光华路', lat: 39.915, lon: 116.455 },
  { zh: '南池子', en: 'Nanchizi', road: '南池子大街', lat: 39.911, lon: 116.398 },
  { zh: '东华门', en: 'Donghuamen', road: '东华门大街', lat: 39.914, lon: 116.401 },
  { zh: '金宝街', en: 'Jinbao Street', road: '金宝街', lat: 39.917, lon: 116.421 },
  { zh: '祈年大街', en: 'Qinian Avenue', road: '祈年大街', lat: 39.887, lon: 116.411 },
  { zh: '永定门', en: 'Yongdingmen', road: '永定门内大街', lat: 39.876, lon: 116.397 },
];

export interface MissionSystem extends MissionApi {
  /** Shots and testing: put a fare on the kerb near the player now. */
  debug: {
    /** `pax`: who it is (Passengers.ts), else as chance has it. */
    startFare(pax?: PaxKind): boolean;
    /** The short jobs: where they start, start one by name, which one runs. */
    jobPosts(): { kind: string; x: number; z: number; ready: boolean }[];
    startJob(kind: 'delivery' | 'chase' | 'trial'): boolean;
    job(): string | null;
    /** 送豆腐: its state (null before the first step), and starting it as if walked into. */
    tofu(): { shop: { x: number; z: number }; stage: string; level: number; dest: { x: number; z: number } | null; left: number; t: number; best: number } | null;
    startTofu(): boolean;
    ride(): { kind: PaxKind; smooth: number; viewers: number; heat: string; vomited: boolean; told: string[]; comfort: number | null; stars: number; atRed: boolean } | null;
    /** 首都机场：在出租车旁边放一位去机场的客（城里的长单），true 是放出来了。 */
    startAir(): boolean;
    /** 蓄车池：排在哪个池子、前面还有几辆、还等几秒（没在排是 null）；这一单是哪一档（3 去机场、4 进城）。 */
    air(): { rank: string | null; cars: number; left: number; tier: number; bags: number };
    state(): { stage: string; pickup: { x: number; z: number } | null; dest: { x: number; z: number; label: string } | null; limit: number; jam: number; elapsed: number;
      shift: { on: boolean; clock: number; fares: number; earned: number }; hailers: { x: number; z: number; tier: number; urgent: boolean }[] };
  };
}

/**
 * Taxi fares, the game's core job, played like Crazy Taxi. While the player drives a taxi, up to
 * four people hail from the kerbs around, each marked in the colour of how far they are going
 * (TIERS). Stop by one and they get in; the first fare starts a shift of SHIFT seconds on the clock.
 * Every passenger has their own clock too: get there with time to spare for a speed bonus and more
 * shift time, too late and they get out; stunts on the way (stunts/) earn tips. When the shift
 * clock runs out it is over - earnings, fares and a grade - and the next fare starts a new one.
 * Police, abandoning the car or a job/race starting lose the fare. Cash persists in localStorage.
 */
export async function install(engine: Engine): Promise<void> {
  const tr = engine.get<TrafficApi>('traffic');
  const pl = engine.get<PlayerApi>('player');
  if (!tr || !pl) return;
  const g = tr.graph;
  const rng = new Rng(8866);
  const rnd = () => rng.next();
  const marker = new Marker(engine.scene);
  const hud = new MissionHud();
  const banner = new Banner();
  // Every landmark is a fare destination except the player's own house: nobody hails a taxi to be
  // driven to your garage.
  const RAIL = new Set(['station', 'southstation', 'weststation']);
  const places = [...LANDMARKS.filter((l) => l.id !== 'home' && !l.partOf)
    .map((l) => ({ lat: l.lat, lon: l.lon, zh: l.name.zh, en: l.name.en, road: '', id: l.id })), ...PLACES.map((p) => ({ ...p, id: '' }))].map((p) => {
    const [x, z] = project(p.lat, p.lon);
    return { x, z, zh: p.zh, en: p.en, road: p.road, id: p.id, rail: RAIL.has(p.id), kerb: undefined as Kerb | null | undefined };
  });
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  const byRoad = new Map<string, number[]>();
  for (const l of g.links) if (l.name) { const a = byRoad.get(l.name) ?? []; a.push(l.id); byRoad.set(l.name, a); }
  /** Where to stop for a place: on its street (the piece nearest the hint), else the kerb nearest the anchor. */
  const resolve = (p: (typeof places)[number]): Kerb | null => {
    const ids = p.road ? byRoad.get(p.road) : undefined;
    if (ids?.length) {
      let best = ids[0], bd = Infinity;
      for (const id of ids) { const l = g.links[id]; g.at(l, l.len / 2, 0, at); const d = Math.hypot(at.x - p.x, at.z - p.z); if (d < bd) { bd = d; best = id; } }
      const l = g.links[best];
      g.at(l, l.len / 2, 0, at);
      return nearestKerb(g, at.x, at.z, 40, 0.8);
    }
    return nearestKerb(g, p.x, p.z, 300, 0.8);
  };

  let cash = 0;
  try { cash = Math.max(0, Number(localStorage.getItem('drivecity.cash') ?? 0) || 0); } catch { /* private mode */ }
  const saveCash = () => { try { localStorage.setItem('drivecity.cash', String(cash)); } catch { /* ignore */ } };
  let best = 0;
  try { best = Number(localStorage.getItem('drivecity.taxi.best') ?? 0) || 0; } catch { /* private mode */ }
  let jobs: Jobs | null = null;
  let tofu: Tofu | null = null;

  let stage: Stage = 'off', timer = 0, objective: string | null = null, blipsOn = false;
  /** `y`、`air`：去 T3 出发层（高架上，底下是到达层：到没到按 AirFares.ts 的 `atDepartures` 看车的高度）。 */
  let dest: { x: number; z: number; label: string; y?: number; air?: boolean } | null = null;
  // ---- 首都机场（2026-11-16，第三批）----
  const luggage = new Luggage(engine.scene);
  /** 蓄车池：在哪个池子排着（RANKS 的下标）、前面几辆、还等几秒；停稳了多久；池子的光圈。 */
  let queue: { i: number; total: number; secs0: number; left: number } | null = null, rankStill = 0, rankOffer = -1;
  const rankMark = new Marker(engine.scene);
  /** 前面还有几辆车：按等过的时间一辆一辆少。 */
  const queueCars = () => (queue ? Math.max(1, Math.ceil(queue.total * queue.left / Math.max(1, queue.secs0))) : 0);
  const joinRank = (i: number) => {
    const w = rankWait(rnd);
    queue = { i, total: w.cars, secs0: w.secs, left: w.secs };
    rankStill = 0;
    clearHailers();
    toast(t('air.rank.join', { n: w.cars }));
  };
  /** 上车的乘客带着箱子：走得慢，到车门还要放行李（秒）。 */
  let stowT = 0;
  /** 「路边有人拖着箱子」一会儿只说一次；在到达层（出发层底下）停着时提醒一次走高架。 */
  let spottedT = 0, upstairsT = 0, tollSaid = false;
  /** 城里的酒店（离酒店门口近的客去机场的多）：用到才挑。 */
  let hotels: Place[] | null = null;
  const nearHotel = (x: number, z: number): boolean => {
    if (!hotels) {
      const all = engine.get<{ name: string; places?: readonly Place[] }>('nav')?.places;
      if (!all?.length) return false;
      hotels = all.filter((p) => p.cat === 'hotel' && usable(p, true));
    }
    for (const p of hotels) if (Math.abs(p.x - x) < 150 && Math.abs(p.z - z) < 150 && Math.hypot(p.x - x, p.z - z) < 150) return true;
    return false;
  };
  /** 今天的每日任务要「送一位乘客去机场」（daily/）：去机场的客多一些。 */
  const dailyWantsAir = () => !!engine.get<{ name: string; wants?(id: string): boolean }>('daily')?.wants?.('airport');
  let tripLen = 0, limit = 0, elapsed = 0, crashes = 0, careT = 0, tips = 0, tier = 0, spawnT = 0, scaredT = 0, summaryT = 0;
  let summary = '';
  const shift = { on: false, clock: 0, fares: 0, earned: 0, away: 0, five: 0 };
  /** 等红灯不走表（RedLight.ts）：出租车停在一盏没绿的灯前面，乘客的表和班上的表都停；赶火车的不等。每 0.25 秒看一次。 */
  let atRed = false, redT = 0;
  /**
   * 班上的表这会儿停着：在等红灯，或者车上评星的乘客还是五星。班只有 60 秒，是给飙车定的；不停的话好好开的人
   * 第一单没送到就收班了（实测 729 米带一个掉头，不堵不等灯也要 63 秒）。
   */
  // 机场的长单（去机场、蓄车池进城）一路都停着班上的表：二十公里怎么开都过了 60 秒，收班会把客人扔在高速上
  const held = () => atRed || (stage === 'ride' && (!!ride?.calm || tier === AIR_OUT || tier === AIR_IN));
  /** 头两回拉到评星的乘客，说一遍规矩。 */
  let hinted = 0;
  try { hinted = Number(localStorage.getItem('drivecity.hint.stars') ?? 0) || 0; } catch { /* private mode */ }
  /** `places.json` 里的地方停在哪个路边：用到才找，找过的记着（找不到记 null）。 */
  const kerbs = new Map<Place, Kerb | null>();
  const landmarkNames = new Set(places.map((p) => p.zh));

  /** `urgent`: a street event's rush fare - red, flashing, gone in URGENT_WAIT s, double pay on a tighter clock. */
  interface Hailer { id: number; pos: THREE.Vector3; yaw: number; look: Look; gait: Gait; t: number; tier: number; marker: Marker; urgent: boolean; pax: PaxKind; seed: number;
    /** 拖着箱子（机场的客）：箱子的颜色，0 没有。 */
    bags: number }
  let hailerIds = 0;
  /** Fares won from the pirate cab: hailer id -> multiplier; the one aboard now. */
  const contested = new Map<number, number>();
  let fareMult = 1;
  /** Who is aboard (Passengers.ts) and how the ride is going for them. */
  let pax: PaxKind = 'normal', paxSeed = 0, ride: PaxRide | null = null, rideT = 0, lmT = 0;
  /** 这一单因为路上堵多给的秒数（开头几秒在目标行里说一声）。 */
  let jam = 0;
  /** A second toast after the fare's (how the passenger rated the ride), on the game clock. */
  let lateToast = '', lateT = 0;
  const laters: { t: number; fn: () => void }[] = [];
  const after = (fn: () => void, secs: number) => laters.push({ t: secs, fn });
  const dlg = () => engine.get<DialogueApi>('dialogue');
  const journal = journalOf(engine);
  let urgentRide = false;
  const hailers: Hailer[] = [];
  const spareMarkers = Array.from({ length: HAILERS + 1 }, () => new Marker(engine.scene));
  const client = { pos: new THREE.Vector3(), prev: new THREE.Vector3(), draw: new THREE.Vector3(), yaw: 0, gait: new Gait(), look: randomLook(rnd), visible: false,
    from: new THREE.Vector3(), to: new THREE.Vector3(), walkT: 0, walkDur: 1, speed: 0, bags: 0, pace: 1.5 };
  const blips: Blip[] = [];
  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const nav = () => engine.get<NavApi>('nav');
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const inTaxi = () => { const v = vehicle(); return pl.mode === 'driving' && v.occupied && v.look.taxi; };
  const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  const busy = () => (engine.get<WantedApi>('wanted')?.level ?? 0) > 0 || !!engine.get<RaceApi>('races')?.active || !!jobs?.busy;

  const walk = (from: THREE.Vector3, to: THREE.Vector3) => {
    client.from.copy(from); client.to.copy(to); client.walkT = 0;
    // 拖着箱子的走得慢
    client.pace = client.bags ? 1.0 : 1.5;
    client.walkDur = Math.max(0.6, from.distanceTo(to) / client.pace);
    client.yaw = Math.atan2(to.x - from.x, to.z - from.z);
  };

  const dropHailer = (h: Hailer) => { h.marker.hide(); spareMarkers.push(h.marker); hailers.splice(hailers.indexOf(h), 1); };
  const clearHailers = () => { while (hailers.length) dropHailer(hailers[0]); };

  /** Someone on a kerb HAIL_MIN-HAIL_MAX m from the taxi, facing the road, going as far as their colour says. */
  const spawnHailer = (min = HAIL_MIN, max = HAIL_MAX, urgent = false, air = false): boolean => {
    const car = vehicle().car;
    const ids = g.near(car.pos.x, car.pos.z, max);
    for (let attempt = 0; attempt < 24 && ids.length; attempt++) {
      const l = g.links[ids[Math.floor(rnd() * ids.length)]];
      if (!SIDEWALK[l.cls] || l.len < 20 || l.hmax > 0.3) continue;
      const s = 6 + rnd() * (l.len - 12), side = l.oneway ? -1 : rnd() < 0.5 ? 1 : -1;
      g.at(l, s, side * (l.hw + 0.8), at);
      const d = Math.hypot(at.x - car.pos.x, at.z - car.pos.z);
      if (d < min || d > max || hailers.some((h) => Math.hypot(h.pos.x - at.x, h.pos.z - at.z) < 40)) continue;
      // Not on a job's post: stopping for the fare would start the job and lose them both.
      if (jobs?.postList.some((p) => Math.hypot(p.x - at.x, p.z - at.z) < 30)) continue;
      const r = rnd();
      let tr0 = urgent ? 2 : r < TIERS[0].weight ? 0 : r < TIERS[0].weight + TIERS[1].weight ? 1 : 2;
      // 首都机场（2026-11-16）：城里东北部、酒店门口的客有的要去机场（AirFares.ts `airChance`）；一次最多一位，路程要像个长单
      if (air || (!urgent && !hailers.some((q) => q.tier === AIR_OUT) && Math.hypot(at.x - T3_DEP.x, at.z - T3_DEP.z) > AIRPORT_NEAR)) {
        const p = air ? 1 : airChance(at.x, at.z, nearHotel(at.x, at.z), dailyWantsAir());
        if (p > 0 && (air || rnd() < p)) {
          const len = nav()?.route(at.x, at.z, NaN, T3_DEP.x, T3_DEP.z)?.len ?? 0;
          if (len >= AIR_MIN && len <= AIR_MAX) tr0 = AIR_OUT;
          else if (air) continue;
        }
      }
      const m = spareMarkers.pop()!;
      // The rush fare is the one with a train to catch.
      const kind: PaxKind = urgent ? 'rush' : tr0 === AIR_OUT ? (rnd() < 0.25 ? 'chatty' : 'normal')
        : pickPax(rnd, engine.get<RenderApi>('render')?.timeOfDay ?? 15, engine.get<{ name: string; specialPax: number }>('contacts')?.specialPax ?? 1);
      // 去机场的穿得像出差的（赶火车那位的打扮），拖着箱子
      const look = tr0 === AIR_OUT && kind === 'normal' ? paxLook('rush', rnd) : paxLook(kind, rnd);
      const h: Hailer = { id: ++hailerIds, pos: new THREE.Vector3(at.x, 0.045, at.z), yaw: Math.atan2(-side * at.dz, side * at.dx), look, gait: new Gait(), t: rnd() * 3, tier: tr0, marker: m, urgent, pax: kind, seed: rnd(),
        bags: tr0 === AIR_OUT ? 1 + Math.floor(rnd() * 6) : 0 };
      if (tr0 === AIR_OUT && spottedT <= 0) { spottedT = 120; toast(t('air.taxi.spotted')); }
      m.show(at.x, at.z, urgent ? URGENT_COLOR : TIERS[tr0].color, urgent ? 0.8 : 0.5);
      // Room at the kerb to pull in: no parked car in front of them (they would stand in its bonnet too).
      engine.get<ParkingApi>('parking')?.clearAround(at.x, at.z, 4, 120);
      hailers.push(h);
      return true;
    }
    return false;
  };

  /** 蓄车池轮到了：一位拖着箱子的客站在车旁的路边（右手边 3 米；有人行道就站在人行道上），要进城。 */
  const spawnRankHailer = (): void => {
    const car = vehicle().car;
    let x = car.pos.x - car.left.x * 3.2, z = car.pos.z - car.left.z * 3.2;
    const k = nearestKerb(g, x, z, 9, 0.8);
    if (k) { x = k.x; z = k.z; }
    const kind: PaxKind = rnd() < 0.2 ? 'chatty' : 'normal';
    const m = spareMarkers.pop()!;
    m.show(x, z, TIERS[AIR_IN].color, 0.5);
    hailers.push({ id: ++hailerIds, pos: new THREE.Vector3(x, 0.045, z), yaw: Math.atan2(car.pos.x - x, car.pos.z - z), look: kind === 'normal' ? paxLook('rush', rnd) : paxLook(kind, rnd),
      gait: new Gait(), t: rnd() * 3, tier: AIR_IN, marker: m, urgent: false, pax: kind, seed: rnd(), bags: 1 + Math.floor(rnd() * 6) });
  };

  const endFare = (msg: string | null, wait = 1.5) => {
    if (msg) toast(msg);
    stage = 'wait'; timer = wait; dest = null; ride = null;
    if (client.walkT >= client.walkDur) client.visible = false;
    nav()?.clearTarget('mission');
    marker.hide();
  };

  /** The passenger gets out here, on the kerb side, and walks off. */
  const alight = (toX: number, toZ: number) => {
    const car = vehicle().car, tmp = new THREE.Vector3(), door = new THREE.Vector3();
    const side = Math.sign((toX - car.pos.x) * car.left.x + (toZ - car.pos.z) * car.left.z) || 1;
    // T3 出发层在高架上：人下在桥面上，不是底下的到达层
    tmp.copy(car.pos).addScaledVector(car.left, side * 1.15).addScaledVector(car.fwd, -0.45); tmp.y = dest?.y !== undefined && car.pos.y > dest.y - 2.5 ? dest.y + 0.05 : 0.045;
    door.copy(tmp).addScaledVector(tmp.clone().sub(car.pos).setY(0).normalize(), 2.5);
    client.visible = true; client.pos.copy(tmp); client.prev.copy(tmp);
    walk(tmp, door);
    stage = 'alight';
    nav()?.clearTarget('mission'); marker.hide();
  };

  const endShift = () => {
    if (!shift.on) return;
    shift.on = false;
    if (stage === 'ride') { alight(vehicle().car.pos.x, vehicle().car.pos.z); dest = null; }
    const grade = GRADES.find(([n]) => shift.earned >= n)![1];
    const record = shift.earned > best;
    if (record) { best = shift.earned; try { localStorage.setItem('drivecity.taxi.best', String(best)); } catch { /* ignore */ } }
    summary = t(record ? 'taxi.shiftRecord' : 'taxi.shiftEnd', { n: shift.fares, cash: shift.earned, grade }) + (shift.five ? `  ·  ${t('taxi.fiveStars', { n: shift.five })}` : '');
    engine.events.emit('taxi:shift', { earned: shift.earned, fares: shift.fares });
    summaryT = 7;
    banner.show(t('taxi.shiftOver', { grade }), grade === 'S' || grade === 'A' ? '#ffc21f' : '#f4f4f1');
    setTimeout(() => banner.hide(), 2200);
    toast(summary);
  };

  /** Where this passenger goes: a named place in their range if one fits, else a street address. */
  const chooseDestination = (tr0: number): boolean => {
    const car = vehicle().car, T = TIERS[tr0], heading = Math.atan2(car.fwd.x, car.fwd.z);
    const airy = tr0 === AIR_OUT || tr0 === AIR_IN;
    const set = (x: number, z: number, label: string, len: number, y?: number) => {
      dest = { x, z, label, y, air: tr0 === AIR_OUT }; tripLen = len;
      // 路上缓行、拥堵的路段按开得动的速度补时（traffic/Flow.ts `jamSlack`；早晚高峰的环路全车道 17 km/h，不补就送不到）
      const pace = urgentRide ? 12 : airy ? 12 : 10.5, links = nav()?.route(car.pos.x, car.pos.z, heading, x, z)?.links;
      jam = links ? Math.round(tr?.jamSlack?.(links, pace) ?? 0) : 0;
      limit = (urgentRide ? tripLen / 12 + 6 : airy ? airLimit(tripLen) : tripLen / 10.5 + 10) + jam; elapsed = 0; crashes = 0; tips = 0; tier = tr0;
      nav()?.setTarget({ x, z, kind: 'mission', label });
      marker.show(x, z, TIERS[tr0].color, 1, y ?? 0);
      ride = new PaxRide(pax, client.look, paxSeed, (who, text) => dlg()?.say(who, text, { prio: 1 }), rnd);
      rideT = 0; lmT = 1; tollSaid = false;
      // 机场的客：去机场的说一句「不着急，稳着点」，进城的报个地方；别的照旧
      if (tr0 === AIR_OUT) { ride.line('pax.air.board'); after(() => { if (stage === 'ride' && tier === AIR_OUT) toast(t('air.taxi.hint')); }, 5); }
      else if (tr0 === AIR_IN) ride.line('pax.in.board', { place: label });
      else ride.board(label, rnd);
      if (fareMult > 1) after(() => ride && ride.line('pax.legit'), 3.5);
      return true;
    };
    // 去机场：T3 出发层的高架上（导航目标在桥面中线上，最近的路段就是那幅高架）
    if (tr0 === AIR_OUT) {
      const len = nav()?.route(car.pos.x, car.pos.z, heading, T3_DEP.x, T3_DEP.z)?.len;
      if (len) return set(T3_DEP.x, T3_DEP.z, t('air.t3dep'), len, T3_DEP.y);
      return false;
    }
    // 蓄车池的进城大单：小区、酒店、写字楼，直线 11–26 公里，按真路程试
    if (tr0 === AIR_IN) {
      const all = engine.get<{ name: string; places?: readonly Place[] }>('nav')?.places;
      if (!all?.length) return false;
      const zh = lang() === 'zh', hour = engine.get<RenderApi>('render')?.timeOfDay ?? 15;
      for (const p of rankPlaces(all, car.pos.x, car.pos.z, IN_MIN, IN_MAX, hour, rnd, zh, 12, (q) => kerbs.get(q) === null, inboundWeights(hour))) {
        let k = kerbs.get(p);
        if (k === undefined) { k = nearestKerb(g, p.x, p.z, kerbReach(p), 0.8); kerbs.set(p, k); }
        if (!k) continue;
        const len = nav()?.route(car.pos.x, car.pos.z, heading, k.x, k.z)?.len;
        if (!len || len < T.min || len > T.max) continue;
        return set(k.x, k.z, placeLabel(p, zh), len);
      }
      return false;
    }
    // A train to catch: the nearest station by road, whatever the colour said.
    if (pax === 'rush') {
      let bestP: (typeof places)[number] | null = null, bestLen = Infinity;
      for (const p of places) {
        if (!p.rail) continue;
        if (p.kerb === undefined) p.kerb = resolve(p);
        if (!p.kerb) continue;
        const len = nav()?.route(car.pos.x, car.pos.z, heading, p.kerb.x, p.kerb.z)?.len ?? Infinity;
        if (len >= 300 && len <= 6500 && len < bestLen) { bestLen = len; bestP = p; }
      }
      if (bestP) return set(bestP.kerb!.x, bestP.kerb!.z, lang() === 'zh' ? bestP.zh : bestP.en, bestLen);
      pax = 'normal';
    }
    // 地标和那张手工表（认得出的地方），三成先从这里挑；
    const famous = (): boolean => {
      for (const i of places.map((_, k) => k).sort(() => rnd() - 0.5)) {
        const p = places[i], d = Math.hypot(p.x - car.pos.x, p.z - car.pos.z);
        if (d > T.max || d < T.min * 0.4) continue;
        if (p.kerb === undefined) p.kerb = resolve(p);
        if (!p.kerb) continue;
        const len = nav()?.route(car.pos.x, car.pos.z, heading, p.kerb.x, p.kerb.z)?.len ?? d * 1.35;
        if (len < T.min || len > T.max) continue;
        return set(p.kerb.x, p.kerb.z, lang() === 'zh' ? p.zh : p.en, len);
      }
      return false;
    };
    // 其余的从 places.json 的小区、医院、学校、商场……里挑（Dest.ts：按钟点的口味排好，挨个按真路程试）。
    const named = (): boolean => {
      const all = engine.get<{ name: string; places?: readonly Place[] }>('nav')?.places;
      if (!all?.length) return false;
      const zh = lang() === 'zh', hour = engine.get<RenderApi>('render')?.timeOfDay ?? 15;
      // 真路程多半是直线的 1.2–1.6 倍，所以按直线先收窄一圈，十个候选里大多数路程合适
      // 车头前面的先试：乘客站在右手路边，往回走的地方在大路上要绕一大圈掉头，路程多半不合适。
      const ahead = (p: Place) => (p.x - car.pos.x) * car.fwd.x + (p.z - car.pos.z) * car.fwd.z > 0;
      const cand = rankPlaces(all, car.pos.x, car.pos.z, T.min / 1.6, T.max / 1.15, hour, rnd, zh, 16, (q) => landmarkNames.has(q.name.zh) || kerbs.get(q) === null);
      for (const p of [...cand.filter(ahead), ...cand.filter((q) => !ahead(q))]) {
        let k = kerbs.get(p);
        if (k === undefined) { k = nearestKerb(g, p.x, p.z, kerbReach(p), 0.8); kerbs.set(p, k); }
        if (!k) continue;
        const len = nav()?.route(car.pos.x, car.pos.z, heading, k.x, k.z)?.len ?? Math.hypot(k.x - car.pos.x, k.z - car.pos.z) * 1.35;
        if (len < T.min || len > T.max) continue;
        return set(k.x, k.z, placeLabel(p, zh), len);
      }
      return false;
    };
    if (rnd() < 0.3 ? famous() || named() : named() || famous()) return true;
    const a = pickAddress(g, nav(), rnd, car.pos.x, car.pos.z, T.min, T.max);
    if (!a) return false;
    const len = nav()?.route(car.pos.x, car.pos.z, heading, a.x, a.z)?.len ?? Math.hypot(a.x - car.pos.x, a.z - car.pos.z) * 1.35;
    return set(a.x, a.z, a.label, len);
  };

  engine.events.on('vehicle:impact', (e) => {
    if (stage !== 'ride' || e.strength < 3) return;
    crashes++;
    ride?.rough(e.strength >= 8 ? 'hard' : 'crash');
    if (careT <= 0) { ride?.react('crash'); careT = 6; }
  });
  engine.events.on('vehicle:land', ({ airTime }) => { if (stage === 'ride' && airTime > 0.3) { ride?.rough('air'); ride?.react('air'); } });
  engine.events.on('people:hit', (e) => { if (stage === 'ride' && e.byPlayer && !e.fair) { ride?.rough('ped'); if (careT <= 0) { ride?.react('crash'); careT = 6; } } });
  // Stunts with a passenger aboard are tipped (Crazy Taxi's "crazy through"), and they have something to say.
  engine.events.on('stunt:event', ({ kind, points }) => {
    if (stage !== 'ride') return;
    tips += Math.max(1, Math.round(points / 12));
    const m = kind === 'near' || kind === 'oncoming' ? 'near' : kind === 'drift' ? 'drift' : kind === 'redlight' ? 'redlight' : kind === 'smash' ? 'crash' : null;
    if (m) { ride?.rough(kind === 'oncoming' ? 'oncoming' : m); ride?.react(m, points); }
  });
  engine.events.on('vehicle:reset', () => { if (stage === 'boarding' || stage === 'ride' || stage === 'alight') { client.visible = false; client.walkT = client.walkDur; endFare(null, 2); } });

  const door = new THREE.Vector3();
  const api: MissionSystem = {
    name: 'missions',
    get cash() { return cash; },
    addCash(n) { cash = Math.max(0, cash + Math.round(n)); saveCash(); if (n > 0) hud.earned(Math.round(n)); },
    story: null,
    get busy() { return !!jobs?.busy || !!tofu?.busy || stage === 'boarding' || stage === 'ride'; },
    urgentFare() {
      if (!inTaxi() || stage !== 'pickup' || hailers.some((h) => h.urgent)) return false;
      // Room for it: the farthest ordinary hailer makes way.
      const car = vehicle().car;
      if (hailers.length >= HAILERS) dropHailer(hailers.reduce((a, b) => (a.pos.distanceTo(car.pos) > b.pos.distanceTo(car.pos) ? a : b)));
      if (!spawnHailer(50, 160, true)) return false;
      toast(t('taxi.urgent'));
      return true;
    },
    get objective() { return api.story ?? jobs?.objective ?? tofu?.objective ?? objective; },
    // 送豆腐's starts (npc/ keeps its encounters away from them); the jumps themselves are travel/'s table
    travelSpots: () => tofu?.starts.map((s, id) => ({ id, label: s.name, x: s.x, z: s.z })) ?? [],
    travel(id) { return engine.get<TravelApi>('travel')?.go(id === 0 ? 'tofu' : 'miaofeng') ?? t('travel.none'); },
    travelBlocked() {
      const pl = engine.get<PlayerApi>('player');
      return !!tofu?.travelling || api.busy || !!api.story || stage === 'alight' || !!engine.get<RaceApi>('races')?.active || !!engine.get<CampaignApi>('campaign')?.running
        || !!engine.get<AdventureApi>('adventure')?.active || !!engine.get<UndergroundApi>('underground')?.inside || !!pl?.riding
        || !!engine.get<{ name: string; onJob?: boolean }>('district')?.onJob;
    },
    hailers: () => hailers.map((h) => ({ id: h.id, x: h.pos.x, z: h.pos.z })),
    contest(id, mult) { contested.set(id, mult); },
    taken(id, x, z) {
      const h = hailers.find((q) => q.id === id);
      if (!h) return;
      // They walk over to the other car and are gone.
      const a = engine.get<PeopleApi>('people')?.spawnActor?.(h.pos.x, h.pos.z, { look: h.look, yaw: h.yaw });
      if (a) { a.goTo(x, z, 1.6); setTimeout(() => a.alive && a.release('vanish'), 4000); }
      dropHailer(h);
    },
    debug: {
      startFare: (kind) => {
        if (!inTaxi()) return false;
        stage = 'pickup'; clearHailers();
        const ok = spawnHailer(12, 60) || spawnHailer();
        if (ok && kind) { const h = hailers[hailers.length - 1]; h.pax = kind; h.look = paxLook(kind, rnd); }
        return ok;
      },
      ride: () => (ride ? { kind: ride.kind, smooth: ride.smooth, viewers: ride.viewers, heat: ride.heat, vomited: ride.vomited, told: [...ride.told], comfort: ride.comfort?.value ?? null, stars: ride.stars, atRed } : null),
      startAir: () => {
        if (!inTaxi()) return false;
        stage = 'pickup'; clearHailers();
        return spawnHailer(12, 80, false, true) || spawnHailer(HAIL_MIN, HAIL_MAX, false, true);
      },
      air: () => ({ rank: queue ? RANKS[queue.i].id : null, cars: queueCars(), left: queue?.left ?? 0, tier, bags: client.bags }),
      jobPosts: () => jobs?.postList ?? [],
      startJob: (kind) => jobs?.startKind(kind) ?? false,
      job: () => jobs?.kind ?? null,
      tofu: () => tofu?.debug ?? null,
      startTofu: () => { tofu?.start(); return !!tofu?.busy; },
      state: () => {
        const car = vehicle().car;
        const near = hailers.reduce<Hailer | null>((b, h) => (!b || h.pos.distanceTo(car.pos) < b.pos.distanceTo(car.pos) ? h : b), null);
        const pickup = stage === 'boarding' ? { x: client.pos.x, z: client.pos.z } : stage === 'pickup' && near ? { x: near.pos.x, z: near.pos.z } : null;
        return { stage, pickup, dest, limit, jam, elapsed, shift: { ...shift }, hailers: hailers.map((h) => ({ x: h.pos.x, z: h.pos.z, tier: h.tier, urgent: h.urgent })) };
      },
    },
    fixedUpdate(dt) {
      if (engine.get<{ name: string; active: boolean }>('adventure')?.active) return;
      const v = vehicle(), car = v.car;
      careT -= dt; scaredT -= dt; summaryT -= dt;
      if (lateT > 0 && (lateT -= dt) <= 0 && lateToast) { toast(lateToast); lateToast = ''; }
      for (let i = laters.length - 1; i >= 0; i--) if ((laters[i].t -= dt) <= 0) { const l = laters[i]; laters.splice(i, 1); l.fn(); }
      // The short jobs (Jobs.ts): while one runs, no fare is offered and a running fare is dropped.
      if (!jobs) jobs = new Jobs(engine, { places, resolve, addCash: (n) => api.addCash(n), toast, rnd });
      // 送豆腐 (Tofu.ts): starts at the tofu shop when nothing else is on, and holds the jobs' posts while it runs
      if (!tofu) {
        const tf = tofu = new Tofu(engine, { addCash: (n) => api.addCash(n), toast, rnd, lang: () => (lang() === 'en' ? 'en' : 'zh') });
        // its two starts in 快速前往's table (travel/): play, where 送豆腐 begins
        const tr = engine.get<TravelApi>('travel'), st = tf.starts;
        if (st[0]) tr?.register({ id: 'tofu', group: 'play', label: 'travel.shop', x: st[0].x, z: st[0].z, go: () => { void tf.travel(0); } });
        if (st[1]) tr?.register({ id: 'miaofeng', group: 'play', label: 'travel.foot', x: st[1].x, z: st[1].z, go: () => { void tf.travel(1); } });
      }
      jobs.hold = tofu.busy;
      jobs.fixedUpdate(dt);
      tofu.fixedUpdate(dt, !jobs.busy && stage !== 'boarding' && stage !== 'ride' && !api.story && !engine.get<RaceApi>('races')?.active
        && (engine.get<WantedApi>('wanted')?.level ?? 0) === 0);
      // The client's walk is gameplay (boarding ends when they reach the door): stepped here, drawn in update.
      client.prev.copy(client.pos);
      if (client.visible) {
        if (client.walkT < client.walkDur) {
          client.walkT = Math.min(client.walkDur, client.walkT + dt);
          client.pos.lerpVectors(client.from, client.to, client.walkT / client.walkDur);
          client.speed = client.pace;
        } else { client.speed = 0; if (stage === 'alight') client.walkT += dt; }
      }
      if (!v.inputEnabled) return;
      const wanted = (engine.get<WantedApi>('wanted')?.level ?? 0) > 0;
      // 车里坐着搭车的路人（favours/ 的 lift）也算：这一趟不拉招手的
      const other = !!engine.get<RaceApi>('races')?.active || !!jobs.busy || !!tofu?.busy || engine.get<{ name: string; active: string | null }>('favours')?.active === 'lift'
        || !!engine.get<{ name: string; active: string | null }>('errands')?.active   // 手上有外卖、包裹（errands/）也不拉
        || !!engine.get<{ name: string; airActive?: string | null }>('contacts')?.airActive;   // 熟人的赶飞机、接机（contacts/AirRuns.ts）也不拉
      spottedT -= dt; upstairsT -= dt;
      // The shift: its clock runs while you drive the taxi; out of it for long, or into a race or a job, it ends.
      // 等红灯不走表：停在没绿的灯前面（赶火车的那位除外）。
      if ((redT -= dt) <= 0) {
        redT = 0.25;
        atRed = inTaxi() && car.speed < 1.5 && !(stage === 'ride' && pax === 'rush') && redAhead(g, tr.signals, tr.time, car.pos.x, car.pos.z, car.fwd.x, car.fwd.z);
      }
      if (shift.on) {
        if (!held()) shift.clock -= dt;
        shift.away = inTaxi() ? 0 : shift.away + dt;
        if (shift.clock <= 0 || shift.away > 5 || other) endShift();
      }
      if (other && (stage === 'boarding' || stage === 'ride')) { client.visible = false; client.walkT = client.walkDur; endFare(null, 3); }
      switch (stage) {
        case 'off':
          if (inTaxi()) { stage = 'pickup'; spawnT = 0; }
          break;
        case 'wait':
          timer -= dt;
          if (timer <= 0) stage = inTaxi() ? 'pickup' : 'off';
          break;
        case 'pickup': {
          if (!inTaxi() && pl.mode === 'driving') { clearHailers(); queue = null; stage = 'off'; break; }
          // Keep four out, none too far behind; none while something else is going on.
          for (const h of [...hailers]) if (h.pos.distanceTo(car.pos) > HAIL_MAX + 120 || other || (h.urgent && h.t > URGENT_WAIT + 3)) dropHailer(h);
          // 首都机场的蓄车池（AirFares.ts `RANKS`）：开进光圈停稳 2 秒（或者按 F）就排上队，前面几辆车走完轮到你，一位拖着箱子
          // 的客要进城；排着队时路边不出别的招手的
          rankOffer = -1;
          if (!other && pl.mode === 'driving') {
            rankOffer = queue ? -1 : RANKS.findIndex((r) => Math.hypot(r.x - car.pos.x, r.z - car.pos.z) < 150 && car.pos.y < 3);
            const ri = rankOffer >= 0 && Math.hypot(RANKS[rankOffer].x - car.pos.x, RANKS[rankOffer].z - car.pos.z) < RANK_R ? rankOffer : -1;
            if (queue) {
              const rk = RANKS[queue.i];
              if (Math.hypot(rk.x - car.pos.x, rk.z - car.pos.z) > RANK_R * 2) { queue = null; toast(t('air.rank.left')); }
              else if ((queue.left -= dt) <= 0) { queue = null; clearHailers(); spawnRankHailer(); toast(t('air.rank.turn')); }
            } else if (ri >= 0) {
              rankStill = car.speed < 2.5 ? rankStill + dt : 0;   // 和上客一个标准：车会怠速往前蹭，1 米/秒以下等不到
              if (rankStill > RANK_STILL) joinRank(ri);
            } else rankStill = 0;
          } else if (queue) queue = null;
          spawnT -= dt;
          if (spawnT <= 0 && !other && !queue && hailers.length < HAILERS) { spawnT = 0.4; spawnHailer(); }
          if (pl.mode !== 'driving' || car.speed > 3) break;
          const h = hailers.find((q) => Math.hypot(car.pos.x - q.pos.x, car.pos.z - q.pos.z) < 7.5);
          if (!h) break;
          if (wanted) { if (scaredT <= 0) { toast(t('taxi.noBoard')); scaredT = 5; } break; }
          // They walk to the rear door on the kerb side.
          client.pos.copy(h.pos); client.prev.copy(h.pos); client.look = h.look; client.visible = true;
          // 带着箱子的走得慢，到了车门还得把箱子放进后备箱
          client.bags = h.bags; stowT = h.bags ? 3.5 : 0;
          const side = Math.sign((client.pos.x - car.pos.x) * car.left.x + (client.pos.z - car.pos.z) * car.left.z) || 1;
          door.copy(car.pos).addScaledVector(car.left, side * 1.15).addScaledVector(car.fwd, -0.45); door.y = client.pos.y;
          walk(client.pos, door);
          tier = h.tier; urgentRide = h.urgent; pax = h.pax; paxSeed = h.seed;
          fareMult = contested.get(h.id) ?? 1; contested.clear();
          engine.events.emit('taxi:board', { id: h.id });
          dropHailer(h);
          stage = 'boarding';
          break;
        }
        case 'boarding':
          if (car.speed > 3 || pl.mode !== 'driving') { client.visible = false; client.walkT = client.walkDur; endFare(null); break; }
          if (client.walkT >= client.walkDur && (stowT -= dt) <= 0) {
            client.visible = false; client.bags = 0;
            if (!chooseDestination(tier)) { endFare(null); break; }
            if (!shift.on) { shift.on = true; shift.clock = SHIFT; shift.fares = 0; shift.earned = 0; shift.away = 0; shift.five = 0; toast(t('taxi.shiftStart', { s: SHIFT })); }
            stage = 'ride';
            if (ride?.comfort && hinted < 2) {
              hinted++;
              try { localStorage.setItem('drivecity.hint.stars', String(hinted)); } catch { /* ignore */ }
              after(() => { if (stage === 'ride') toast(t('taxi.starsHint')); }, 4);
            }
          }
          break;
        case 'ride': {
          if (!atRed) elapsed += dt;
          rideT += dt;
          if (ride) {
            ride.step(dt, car.vel.x, car.vel.z, car.speed, rnd);
            // The old Beijinger has a story for every landmark passed.
            if ((ride.kind === 'chatty' || ride.kind === 'normal') && (lmT -= dt) <= 0) {
              lmT = 1;
              for (const p of places) if (p.id && !ride.told.has(p.id) && Math.hypot(p.x - car.pos.x, p.z - car.pos.z) < 160) { ride.landmark(p.id, lang() === 'zh' ? p.zh : p.en, rnd); break; }
            }
            // The mystery passenger brings the police with him; lose them and he pays triple.
            if (ride.kind === 'mystery') {
              const w = engine.get<WantedApi>('wanted');
              if (ride.heat === 'calm' && rideT > 4) { ride.heat = 'hot'; w?.crime('report', car.pos.x, car.pos.z); ride.line('pax.mystery.wanted'); }
              else if (ride.heat === 'hot' && (w?.level ?? 0) === 0 && rideT > 8) { ride.heat = 'lost'; ride.line('pax.mystery.lost', { place: dest!.label }); }
            }
          }
          if (wanted && ride?.kind !== 'mystery') { alight(car.pos.x, car.pos.z); toast(t('taxi.scared')); dest = null; break; }
          if (pl.mode !== 'driving' || !v.look.taxi) { endFare(t('taxi.left')); break; }
          if (elapsed > limit) { alight(car.pos.x, car.pos.z); toast(t('taxi.late')); dest = null; break; }
          // 去 T3 出发层：在高架上才算到（底下的到达层平面上同一个地方，停在那儿提醒一句走高架）
          const there = dest!.y !== undefined ? atDepartures(car.pos.x, car.pos.y, car.pos.z) : Math.hypot(car.pos.x - dest!.x, car.pos.z - dest!.z) < 12;
          if (dest!.y !== undefined && !there && upstairsT <= 0 && car.speed < 2.5 && Math.hypot(car.pos.x - dest!.x, car.pos.z - dest!.z) < 120) { upstairsT = 12; toast(t('air.taxi.upstairs')); }
          // 过了机场高速的收费站（离 T3 约 6 公里），去机场的客说一句
          if (tier === AIR_OUT && !tollSaid && ride && Math.hypot(car.pos.x - dest!.x, car.pos.z - dest!.z) < 6500) { tollSaid = true; ride.line('pax.air.toll'); }
          if (there && car.speed < 2.5) {
            const left = 1 - elapsed / limit, r = RATINGS.find((q) => left >= q.min)!;
            const kind = ride?.kind ?? 'normal';
            const triple = kind === 'mystery' && ride?.heat === 'lost';
            const airy = tier === AIR_OUT || tier === AIR_IN;
            const base = Math.round((airy ? airFare(tripLen / 1000) : payFor(tripLen / 1000)) * (urgentRide ? 2 : 1) * (triple ? 3 : 1) * fareMult), bonus = Math.round(base * r.bonus * (kind === 'rush' ? 2 : 1));
            // 评星的乘客（普通、话痨）：星多了加小费、给班上加秒（Comfort.ts）；只加不扣。
            const stars = ride?.stars ?? 0, starTip = stars ? Math.round(base * STAR_TIP[stars - 1]) : 0, starTime = stars ? STAR_TIME[stars - 1] : 0;
            const stuntTip = Math.max(0, tips - crashes * 3), tip = (ride ? ride.tip(stuntTip) : stuntTip) + starTip;
            const cleaning = ride?.vomited ? 30 : 0;
            // 老张's word at the rank (contacts/): fares +20%.
            const total = Math.max(0, Math.round((base + bonus + tip - cleaning) * (engine.get<{ name: string; fareScale: number }>('contacts')?.fareScale ?? 1)));
            engine.events.emit('taxi:fare', { pay: total, kind, stars });
            if (airy) engine.events.emit('airjob:done', { kind: tier === AIR_OUT ? 'fare' : 'rank', toAirport: tier === AIR_OUT, pay: total });
            api.addCash(total);
            shift.fares++; shift.earned += total; shift.clock += r.time + starTime;
            if (stars === 5) shift.five++;
            toast(t('taxi.paidArcade', { rating: t(r.key), pay: base + bonus, tip, s: r.time + starTime }));
            if (ride) {
              ride.line(tier === AIR_OUT && kind === 'normal' ? 'pax.air.arrive' : `pax.${kind}.arrive`);
              // 到了机场的客拖着箱子走进航站楼
              if (tier === AIR_OUT) client.bags = 1 + Math.floor(paxSeed * 6);
              if (kind !== 'normal') journal.meet(`pax.${kind}`);
              const extra = triple ? t('pax.mystery.triple', { n: base }) : cleaning ? t('pax.drunk.cleaning', { n: cleaning })
                : kind === 'queasy' ? t('pax.queasy.tip', { n: Math.round(ride.smooth), tip }) : kind === 'streamer' ? t('pax.streamer.tip', { n: ride.viewers, tip })
                : stars ? t(stars === 5 ? 'pax.stars.five' : stars >= 3 ? 'pax.stars.some' : 'pax.stars.low', { stars: starText(stars), tip: starTip }) : '';
              if (extra) { lateToast = extra; lateT = 1.7; }
            }
            ride = null;
            alight(dest!.x, dest!.z);
            dest = null;
          }
          break;
        }
        case 'alight':
          if (client.walkT >= client.walkDur + 1.2) { client.visible = false; client.bags = 0; stage = 'wait'; timer = 1; }
          break;
      }
      // The objective line.
      const clock = shift.on ? fmt(shift.clock) : '', clockKey = held() && !atRed ? 'taxi.clockHeld' : 'taxi.clock';   // 等红灯时后面另有一句，不用两处都写
      if (stage === 'ride' && dest) {
        objective = t('taxi.rideLine', { place: dest.label, time: fmt(limit - elapsed) }) + (shift.on ? `  ·  ${t(clockKey, { t: clock })}` : '') + (tips > 0 && ride?.kind !== 'queasy' ? `  ·  ${t('taxi.tips', { n: tips })}` : '')
          + (ride?.kind === 'queasy' ? `  ·  ${t('pax.obj.smooth', { n: Math.round(ride.smooth) })}` : ride?.kind === 'streamer' ? `  ·  ${t('pax.obj.viewers', { n: ride.viewers })}`
            : ride?.stars ? `  ·  ${t('pax.obj.stars', { stars: starText(ride.stars) })}` : '') + (atRed ? `  ·  ${t('taxi.redWait')}` : '')
          + (jam >= 15 && rideT < 8 ? `  ·  ${t('taxi.hintJam', { t: fmt(jam) })}` : '');
      } else if (stage === 'boarding') objective = t(client.walkT >= client.walkDur && stowT > 0 ? 'air.taxi.bags' : 'taxi.boarding');
      else if (summaryT > 0) objective = summary;
      else if (queue && stage === 'pickup') objective = t('air.rank.obj', { n: queueCars(), t: fmt(queue.left) });
      else if (rankOffer >= 0 && stage === 'pickup' && inTaxi()) objective = t('air.rank.hint');
      else if ((stage === 'pickup' || stage === 'wait') && inTaxi() && !other) {
        objective = shift.on ? t('taxi.shiftLine', { t: clock, n: shift.fares, cash: shift.earned }) + (atRed ? `  ·  ${t('taxi.redWait')}` : '') : t('taxi.find');
      } else objective = null;
    },
    update(dt, alpha) {
      marker.update(dt);
      for (const h of hailers) h.marker.update(dt);
      // Blips on the minimap once navigation exists.
      const n = nav();
      if (n && !blipsOn) {
        blipsOn = true;
        n.addBlips(() => jobs?.provideBlips() ?? []);
        n.addBlips(() => tofu?.provideBlips() ?? []);
        n.addBlips(() => {
          blips.length = 0;
          if (stage === 'pickup') for (const h of hailers) blips.push({ kind: 'pickup', x: h.pos.x, z: h.pos.z, flash: h.urgent });
          else if (stage === 'ride' && dest) blips.push({ kind: 'dropoff', x: dest.x, z: dest.z, label: dest.label });
          // 开着出租车、空车时，机场的蓄车池在地图上
          if (inTaxi() && (stage === 'pickup' || stage === 'wait')) for (const r of RANKS) blips.push({ kind: 'pickup', x: r.x, z: r.z, label: t('air.rank.label') });
          return blips;
        });
      }
      luggage.begin();
      for (const h of hailers) {
        h.t += dt;
        h.gait.update({ speed: 0, action: 'wave', t: h.t }, dt, 0.7);
        pl.crowd.add(h.pos, h.yaw, h.gait, h.look);
        if (h.bags) luggage.add(h.pos.x, h.pos.z, h.yaw, false, h.pos.y, h.bags);
      }
      if (client.visible) {
        client.gait.update({ speed: client.speed, action: 'move', t: 0 }, dt, 0.7);
        client.draw.lerpVectors(client.prev, client.pos, alpha);
        pl.crowd.add(client.draw, client.yaw, client.gait, client.look);
        if (client.bags) luggage.add(client.draw.x, client.draw.z, client.yaw, client.speed > 0, client.draw.y, client.bags);
      }
      luggage.commit();
      // 蓄车池的光圈：开着空出租车走近了才亮，排上队就灭
      rankMark.update(dt);
      const rk = inTaxi() && stage === 'pickup' && !queue ? RANKS.find((r) => Math.hypot(r.x - pl.position.x, r.z - pl.position.z) < 500) : undefined;
      if (rk) rankMark.show(rk.x, rk.z, TIERS[AIR_IN].color, 1.6); else rankMark.hide();
      // 在光圈里也可以按 F 排队（不用等停稳两秒）
      if (rk && rankOffer >= 0 && !queue && Math.hypot(rk.x - pl.position.x, rk.z - pl.position.z) < RANK_R) {
        const i = rankOffer;
        pl.offer?.({ x: rk.x, z: rk.z, r: RANK_R, label: t('air.rank.offer'), use: () => { if (!queue && stage === 'pickup') joinRank(i); } });
      }
      hud.update(dt, cash, api.objective);
      tofu?.update(dt);
    },
  };
  engine.add(api);
}
