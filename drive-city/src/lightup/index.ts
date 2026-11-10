import type { Engine, System } from '../core/Engine';
import { t, type TKey } from '../core/I18n';
import type { HudApi, MissionApi, PlayerApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { Routes } from '../city/Routes';
import { CELL, ROUTE_DONE, Roads, cellOf, decodeKeys, encodeKeys, keyOf, keyX, keyZ, keyable, type District, type LightStats, type RouteId } from './Grid';

/**
 * 点亮北京（2026-11-10，docs/beijing-immersion-design.md E1，「这个游戏感觉大家还是喜欢跑图」）：开车经过的路在大地图上
 * 亮起来（`ui/MapScreen` 用 `Layer.ts` 画），没开过的暗着；地图右边一张卡片写「已点亮 xx 公里」、每个区的完成度、
 * 二环到五环和长安街开了多少。二环到五环各开一圈（粗格子的 85%）、长安街全程、点亮 100 公里，各送一种车漆
 * （车库里金圈的那排，和每日任务的放在一起）和一笔钱。
 * 存档 `drivecity.lightup.v1`（格子坐标，见 `Grid.ts`；跟着云存档走），`drivecity.lightup.done` 是拿过的奖励。
 * 开车（含两轮车）和走路经过的格子都记（2026-11-10 起走路也算：胡同和步行街车进不去）；shot mode 不记。
 * `fresh()`：刚点亮了没开过的路（docs/street-level-design.md A4）——HUD 在路名下面写「新点亮 · 东城区 35%」，跑图时不用开地图
 * 也知道这条路是新的。
 */
const KEY = 'drivecity.lightup.v1', DONE_KEY = 'drivecity.lightup.done', VIEW_KEY = 'drivecity.lightup.view';
/** Cells within this of the car's path light up (both carriageways of most roads). */
const REACH = 10;
const STEP = 8;

export interface LightReward { id: RouteId | 'km100'; paint: string; name: TKey; cash: number }
export const REWARDS: readonly LightReward[] = [
  { id: 'r2', paint: '#7a7570', name: 'lit.paint.r2', cash: 3000 },
  { id: 'r3', paint: '#c9a24a', name: 'lit.paint.r3', cash: 4000 },
  { id: 'r4', paint: '#2f5d9e', name: 'lit.paint.r4', cash: 5000 },
  { id: 'r5', paint: '#3f8f5a', name: 'lit.paint.r5', cash: 6000 },
  { id: 'changan', paint: '#b3262d', name: 'lit.paint.changan', cash: 3000 },
  { id: 'km100', paint: '#e3b53a', name: 'lit.paint.km100', cash: 5000 },
];

export interface LightupApi extends System {
  readonly visited: ReadonlySet<number>;
  /** Bumps whenever a cell lights. */
  readonly version: number;
  /** Per 512 m block: bumps when a cell in it lights (the map's cached paths). */
  readonly blockVer: ReadonlyMap<number, number>;
  /** The road cells (built on first use, null until the network and the districts are in). */
  roads(): Roads | null;
  stats(): LightStats | null;
  readonly districts: readonly District[];
  /** The rewards already won. */
  readonly done: ReadonlySet<string>;
  /** The big map shows the lit roads. */
  view: boolean;
  /** Paints won, for the garage. */
  readonly paints: readonly { color: string; name: string }[];
  /** A road cell not driven before lit within the last few seconds: its district and how much of that is lit now (null: no district there). */
  fresh(): { district: District | null; pct: number } | null;
}

const read = (k: string) => { try { return localStorage.getItem(k); } catch { return null; } };
const write = (k: string, v: string) => { try { localStorage.setItem(k, v); } catch { /* private mode */ } };

export function install(engine: Engine): void {
  const world = engine.get<WorldApi & { routes?: Routes }>('world');
  const net = world?.routes?.net;
  if (!net) return;
  const shot = new URLSearchParams(location.search).has('shot');
  const visited = new Set<number>(decodeKeys(read(KEY) ?? ''));
  const blockVer = new Map<number, number>();
  for (const k of visited) bump(k);
  const done = new Set<string>((read(DONE_KEY) ?? '').split(',').filter(Boolean));
  let districts: District[] | null = null;
  fetch(`${import.meta.env.BASE_URL}city/districts.json`).then((r) => (r.ok ? r.json() : { d: [] })).then((d: { d: District[] }) => { districts = d.d; })
    .catch(() => { districts = []; });
  let roads: Roads | null = null;
  let version = 0, dirty = false, saveT = 0, checkT = 0, checkedAt = -1, poll = 0;
  let lastX = NaN, lastZ = NaN;
  let view = read(VIEW_KEY) !== '0';
  /** Seconds since a new road cell lit, the district it is in, and the lit road cells per district (kept up once the roads are read). */
  let freshT = 99, freshD = 255, perDistrict: number[] | null = null;

  function bump(k: number): void {
    const b = keyOf(keyX(k) >> 4, keyZ(k) >> 4);
    blockVer.set(b, (blockVer.get(b) ?? 0) + 1);
  }
  const light = (x: number, z: number) => {
    for (const [dx, dz] of [[0, 0], [REACH, 0], [-REACH, 0], [0, REACH], [0, -REACH]]) {
      const cx = cellOf(x + dx), cz = cellOf(z + dz);
      if (!keyable(cx, cz)) continue;
      const k = keyOf(cx, cz);
      if (visited.has(k)) continue;
      visited.add(k); bump(k); version++; dirty = true;
      if (roads?.ready) {
        const d = roads.cells.get(k);
        if (d === undefined) continue;
        // counted once from the save (this cell in it), then kept up cell by cell
        if (!perDistrict) perDistrict = roads.stats(visited).perDistrict;
        else if (d !== 255) perDistrict[d]++;
        // the cell under the car, not the ones beside it (they are the other carriageway, or nothing)
        if (dx === 0 && dz === 0) { freshT = 0; freshD = d; }
      }
    }
  };
  const save = () => { if (dirty) { dirty = false; write(KEY, encodeKeys(visited)); } };
  addEventListener('pagehide', save);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') save(); });

  /** The road cells, read to the end (the map needs them all now). */
  const getRoads = () => {
    if (!roads && districts) roads = new Roads(net, districts);
    if (roads && !roads.ready) roads.build();
    return roads;
  };
  /** New rewards: a toast each, the paint and the cash. */
  const check = () => {
    const r = roads;
    if (!r?.ready) return;
    const s = r.stats(visited);
    for (const rw of REWARDS) {
      if (done.has(rw.id)) continue;
      const ok = rw.id === 'km100' ? s.km >= 100 : s.routes[rw.id] >= ROUTE_DONE;
      if (!ok) continue;
      done.add(rw.id);
      write(DONE_KEY, [...done].join(','));
      engine.get<MissionApi>('missions')?.addCash(rw.cash);
      engine.get<HudApi>('hud')?.toast(t('lit.reward', { what: t(`lit.done.${rw.id}` as TKey), paint: t(rw.name), cash: rw.cash.toLocaleString() }), 6);
      // one at a time: the next in a few seconds (a toast replaces the one on screen)
      checkedAt = -1;
      return;
    }
  };

  const api: LightupApi = {
    name: 'lightup',
    visited, blockVer,
    get version() { return version; },
    roads: getRoads,
    stats() { const r = getRoads(); return r ? r.stats(visited) : null; },
    get districts() { return districts ?? []; },
    done,
    get view() { return view; },
    set view(v) { view = v; write(VIEW_KEY, v ? '1' : '0'); },
    get paints() { return REWARDS.filter((r) => done.has(r.id)).map((r) => ({ color: r.paint, name: t(r.name) })); },
    fresh() {
      if (freshT > 4 || !roads?.ready) return null;
      const d = freshD === 255 ? null : roads.districts[freshD] ?? null, total = d ? roads.perDistrict[freshD] : 0;
      return { district: d, pct: d && total && perDistrict ? Math.min(100, perDistrict[freshD] / total * 100) : 0 };
    },
    update(dt) {
      if (shot || engine.paused) return;
      freshT += dt;
      // the road cells, 2 ms a frame once anything is lit (the rewards need them; the map finishes them if opened first)
      if (districts && visited.size && !roads?.ready) { roads ??= new Roads(net, districts); roads.build(engine.lite ? 1 : 2); }
      if ((saveT += dt) > 15) { saveT = 0; save(); }
      // the rewards: a few seconds after something new lit (the road cells are built the first time, ~0.15 s)
      if (version !== checkedAt && (checkT += dt) > 6) { checkT = 0; checkedAt = version; check(); }
      if ((poll -= dt) > 0) return;
      poll = 0.2;
      const v = engine.get<VehicleApi>('vehicle'), pl = engine.get<PlayerApi>('player');
      const foot = pl?.mode === 'onfoot' ? pl.foot : null;
      if (!foot && !v?.occupied) { lastX = NaN; return; }
      const p = foot ? foot.pos : v!.car.pos;
      const d = Math.hypot(p.x - lastX, p.z - lastZ);
      // a jump (快速前往, a reset): start again from here
      if (!(d < 150)) light(p.x, p.z);
      else if (d > CELL / 4) {
        const n = Math.ceil(d / STEP);
        for (let i = 1; i <= n; i++) light(lastX + (p.x - lastX) * i / n, lastZ + (p.z - lastZ) * i / n);
      } else return;
      lastX = p.x; lastZ = p.z;
    },
  };
  engine.add(api);
}
