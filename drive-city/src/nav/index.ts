import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import type { Blip, HudApi, LandmarkDef, NavApi, NavTarget, PlayerApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { Manifest } from '../city/Data';
import type { Routes } from '../city/Routes';
import { project } from '../city/Geo';
import type { TrafficApi } from '../traffic';
import { LaneGraph } from '../traffic/LaneGraph';
import { Router } from './Router';
import { MapData } from './MapData';

/** The live GPS route and where the player is along it. */
export interface Gps {
  pts: Float32Array;
  /** Arc length at each point. */
  cum: Float32Array;
  len: number;
  /** The player's projection on the route: segment index, point, arc length. */
  i: number; x: number; z: number; s: number;
  /** How far the player was from the route's start when it was computed (off-road starts are not strays). */
  snap: number;
}

export interface LandmarkPin { id: string; name: { zh: string; en: string }; x: number; z: number }

/** What the minimap and the map screen read on top of the public NavApi. */
export interface NavSystem extends NavApi {
  readonly router: Router;
  readonly map: MapData;
  readonly graph: LaneGraph;
  readonly gps: Gps | null;
  readonly landmarks: readonly LandmarkPin[];
  readonly bounds: { x0: number; z0: number; x1: number; z1: number };
  readonly attribution: string;
  /** Every provider's blips, in a reused array. */
  blips(): readonly Blip[];
  setMapOpen(open: boolean): void;
  /** Where the player is (interpolated while driving) and which way they face, atan2(x, z). */
  player(out: { x: number; z: number; heading: number }): { x: number; z: number; heading: number };
}

/** Recompute when the player is this far off the route (beyond the start's own off-road distance)... */
const STRAY = 25;
/** ...but no more often than this (seconds of game time). Also the retry interval when no route was found. */
const REROUTE_S = 2;
const ARRIVE = 20;

// Optional like the city's own loader: a landmark module mid-edit must not take the GPS down.
const landmarkModules = import.meta.glob('../city/landmarks/index.ts');

async function loadLandmarks(): Promise<LandmarkPin[]> {
  const loader = landmarkModules['../city/landmarks/index.ts'];
  if (!loader) return [];
  try {
    const defs = ((await loader()) as { LANDMARKS?: LandmarkDef[] }).LANDMARKS ?? [];
    return defs.map((d) => { const [x, z] = project(d.lat, d.lon); return { id: d.id, name: d.name, x, z }; });
  } catch (e) { console.warn('[nav] landmarks unavailable', e); return []; }
}

/**
 * Navigation: GPS routing over the traffic lane graph, the player's target (a map waypoint or a
 * mission's), the live route to it, blip providers and the police search area. The minimap and
 * the full-screen map (ui/) draw from this.
 */
export async function install(engine: Engine): Promise<void> {
  const world = engine.get<WorldApi & { routes?: Routes; manifest?: Manifest }>('world');
  const graph = engine.get<TrafficApi>('traffic')?.graph ?? (world?.routes ? new LaneGraph(world.routes.net) : null);
  if (!world || !graph) return;
  const router = new Router(graph);
  const map = new MapData(graph);
  const landmarks = await loadLandmarks();
  const m = world.manifest;
  const bounds = m?.bounds ?? { x0: -1000, z0: -1000, x1: 1000, z1: 1000 };
  const shot = new URLSearchParams(location.search).has('shot');

  let target: NavTarget | null = null;
  const slots: Record<NavTarget['kind'], NavTarget | null> = { waypoint: null, mission: null };
  /** The GPS follows the waypoint while there is one, else the mission; a change reroutes. */
  const retarget = () => {
    const next = slots.waypoint ?? slots.mission;
    const same = next && target && next.x === target.x && next.z === target.z;
    target = next;
    if (same) return;
    gps = null;
    routeLeft = Infinity;
    if (target) reroute();
  };
  let gps: Gps | null = null;
  let routeLeft = Infinity;
  let lastRoute = -Infinity;
  let mapOpen = false;
  const providers: (() => Iterable<Blip>)[] = [];
  const blipsOut: Blip[] = [];
  const me = { x: 0, z: 0, heading: 0 };

  const where = (out: { x: number; z: number; heading: number }, render: boolean) => {
    const pl = engine.get<PlayerApi>('player'), v = engine.get<VehicleApi>('vehicle');
    const foot = pl?.foot;
    if (foot) { out.x = foot.pos.x; out.z = foot.pos.z; out.heading = foot.yaw; return out; }
    if (!v) return out;
    const car = v.car, p = render ? v.renderPos : car.pos;
    out.x = p.x; out.z = p.z;
    out.heading = Math.atan2(car.fwd.x, car.fwd.z);
    return out;
  };

  const reroute = () => {
    lastRoute = engine.time;
    if (!target) { gps = null; return; }
    where(me, false);
    // Route the way the car is going: its velocity in a slide or when reversing fast, else its nose.
    // On foot either direction will do.
    const pl = engine.get<PlayerApi>('player'), car = engine.get<VehicleApi>('vehicle')?.car;
    let heading = pl?.mode === 'onfoot' ? NaN : me.heading;
    if (car && pl?.mode !== 'onfoot' && car.speed > 3) heading = Math.atan2(car.vel.x, car.vel.z);
    const r = router.route(me.x, me.z, heading, target.x, target.z);
    if (!r) { gps = null; routeLeft = Math.hypot(target.x - me.x, target.z - me.z); return; }
    const n = r.pts.length / 2, cum = new Float32Array(n);
    for (let k = 1; k < n; k++) cum[k] = cum[k - 1] + Math.hypot(r.pts[k * 2] - r.pts[k * 2 - 2], r.pts[k * 2 + 1] - r.pts[k * 2 - 1]);
    gps = { pts: r.pts, cum, len: r.len, i: 0, x: r.pts[0], z: r.pts[1], s: 0, snap: Math.hypot(r.pts[0] - me.x, r.pts[1] - me.z) };
    routeLeft = r.len;
  };

  /** Move the player's projection along the route, searching near the last one. Returns the distance off it. */
  const track = (g: Gps, x: number, z: number): number => {
    const n = g.pts.length / 2;
    const scan = (from: number, to: number) => {
      let bd = Infinity;
      for (let k = Math.max(0, from); k < Math.min(n - 1, to); k++) {
        const ax = g.pts[k * 2], az = g.pts[k * 2 + 1], vx = g.pts[k * 2 + 2] - ax, vz = g.pts[k * 2 + 3] - az, L2 = vx * vx + vz * vz;
        const u = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)) : 0;
        const px = ax + vx * u, pz = az + vz * u, d = Math.hypot(x - px, z - pz);
        if (d < bd) { bd = d; g.i = k; g.x = px; g.z = pz; g.s = g.cum[k] + Math.sqrt(L2) * u; }
      }
      return bd;
    };
    if (n < 2) return Math.hypot(x - g.x, z - g.z);
    let d = scan(g.i - 3, g.i + 60);
    if (d > 60) d = scan(0, n);
    return d;
  };

  const api: NavSystem = {
    name: 'nav',
    router, map, graph, landmarks, bounds,
    attribution: m?.attribution ?? '© OpenStreetMap contributors (ODbL)',
    searchArea: null,
    get target() { return target; },
    get routeLeft() { return routeLeft; },
    get gps() { return gps; },
    get mapOpen() { return mapOpen; },
    setMapOpen(open) { mapOpen = open; if (open) startCrawl(); },
    route(fromX, fromZ, heading, toX, toZ) {
      const r = router.route(fromX, fromZ, heading, toX, toZ);
      return r ? { pts: r.pts, len: r.len } : null;
    },
    setTarget(tg) {
      if (!tg) { slots.waypoint = null; slots.mission = null; }
      else slots[tg.kind] = { ...tg };
      retarget();
    },
    clearTarget(kind) {
      slots[kind] = null;
      retarget();
    },
    addBlips(provider) { providers.push(provider); },
    blips() {
      blipsOut.length = 0;
      for (const p of providers) {
        try { for (const b of p()) blipsOut.push(b); } catch (e) { console.error('[nav] blip provider threw', e); }
      }
      return blipsOut;
    },
    player(out) { return where(out, true); },
    update() {
      if (!target) return;
      where(me, false);
      if (target.kind === 'waypoint' && Math.hypot(target.x - me.x, target.z - me.z) < ARRIVE) {
        api.clearTarget('waypoint');
        engine.get<HudApi>('hud')?.toast(t('nav.arrived'));
        return;
      }
      if (gps) {
        const off = track(gps, me.x, me.z);
        routeLeft = Math.max(0, gps.len - gps.s);
        if (off > STRAY + gps.snap && engine.time - lastRoute >= REROUTE_S) reroute();
      } else {
        routeLeft = Math.hypot(target.x - me.x, target.z - me.z);
        if (engine.time - lastRoute >= REROUTE_S) reroute();
      }
    },
    dispose() { map.dispose(); },
  };
  engine.add(api);

  // Parks, water and buildings for the maps: crawl the tiles in the background once the start-up
  // streaming has settled (at once for screenshots, which wait on map.ready).
  let crawled = false;
  const startCrawl = () => {
    if (crawled || !m) return;
    crawled = true;
    where(me, false);
    // Phones get two lanes, desktops three: the crawl must never starve the streamer or textures.
    const lanes = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches ? 2 : 3;
    map.load(m, me.x, me.z, lanes);
  };
  if (shot) startCrawl();
  else {
    // Not during boot: it used to start 4 s in and queue 718 files against the loading textures.
    engine.events.on('game:start', () => setTimeout(startCrawl, 20000));
    setTimeout(startCrawl, 90000);
  }
}
