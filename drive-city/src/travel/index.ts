import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t, type TKey } from '../core/I18n';
import type { CameraApi, HudApi, MissionApi, PlayerApi, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import { Fade } from '../campaign/Screens';

/**
 * 快速前往 (2026-11-04, docs/gta-plan.md §13, 「我现在把车开到了5环，想去南锣鼓巷太远……以后这种瞬移的场景还会有，设计一下」):
 * one table of the places the player can jump to, in three groups, each registered by the system it belongs to -
 *   home      我家 (home/)
 *   district  南锣鼓巷's mouths, 后海 (district/)
 *   play      where a kind of play starts: 藤原豆腐店 and 妙峰山脚 (missions/' 送豆腐), 欢乐谷 (park/)
 * Driving there is the game, so only places you get out at, or where a kind of play begins, are here: no landmark, no
 * 兔儿爷, no ramp, no race, no chapter or contact, no point on the map. The map's 快速前往 card, the pause screen's button
 * and the map's destination card all read this table; why one cannot go now (police, a job on...) is checked here.
 */
export type TravelGroup = 'home' | 'district' | 'play';
export const GROUPS: readonly TravelGroup[] = ['home', 'district', 'play'];

export interface TravelSpot {
  /** Kept in tests and probes: 'home', 'nanluo', 'nanluoN', 'houhai', 'tofu', 'miaofeng', 'park'. */
  id: string;
  group: TravelGroup;
  label: TKey;
  /** Where it is on the map (the distance shown, the destination card's match). */
  x: number; z: number;
  /** Go there now (the checks are done). */
  go(): void;
  /** Its own reason not to go now, or null. */
  why?(): string | null;
}

export interface TravelApi extends System {
  register(s: TravelSpot): void;
  readonly spots: readonly TravelSpot[];
  /** Go to spot `id`: null when on the way, else why not (shown under the buttons). */
  go(id: string): string | null;
  /** The spot within `r` m of (x, z), if any (the map's destination card). */
  near(x: number, z: number, r: number): TravelSpot | null;
  /**
   * Somewhere to land: a fade to black, the streets there loaded, the car (driving: on `car`, or on the nearest lane to
   * `road`) or the player on foot at `foot`, the camera turned, a caption. For a system whose place needs nothing more.
   */
  land(p: { foot: { x: number; z: number; yaw: number }; car?: { x: number; z: number; yaw: number }; road?: { x: number; z: number; yaw: number }; caption: string; footCaption?: string; look?: number }): Promise<void>;
}

/** Already this close: nothing to do. */
const HERE = 60;
/** Told once a save, the first time the player is this far from every spot (and not busy). */
const HINT_FAR = 5000;
const HINT_KEY = 'drivecity.travelHint.v1';

export async function install(engine: Engine): Promise<void> {
  const spots: TravelSpot[] = [];
  const pl = () => engine.get<PlayerApi>('player');
  const missions = () => engine.get<MissionApi>('missions');
  let fade: Fade | null = null, landing = false;
  let hinted = false;
  try { hinted = localStorage.getItem(HINT_KEY) === '1'; } catch { /* private mode */ }
  let hintT = 0;

  /** Why nobody can go anywhere now, or null. */
  const blocked = (): string | null => {
    if ((engine.get<WantedApi>('wanted')?.level ?? 0) > 0) return t('travel.wanted');
    if (landing || missions()?.travelBlocked?.() || pl()?.riding) return t('travel.busy');
    return null;
  };

  const api: TravelApi = {
    name: 'travel',
    get spots() { return spots; },
    register(s) { const i = spots.findIndex((q) => q.id === s.id); if (i >= 0) spots[i] = s; else spots.push(s); spots.sort((a, b) => GROUPS.indexOf(a.group) - GROUPS.indexOf(b.group)); },
    go(id) {
      const s = spots.find((q) => q.id === id);
      if (!s) return t('travel.none');
      const why = blocked() ?? s.why?.() ?? null;
      if (why) return why;
      const p = pl()?.position;
      if (p && Math.hypot(p.x - s.x, p.z - s.z) < HERE) return t('travel.here');
      engine.events.emit('travel:jump', { x: s.x, z: s.z, id: s.id });
      s.go();
      return null;
    },
    near(x, z, r) {
      let best: TravelSpot | null = null, bd = r;
      for (const s of spots) { const d = Math.hypot(s.x - x, s.z - z); if (d < bd) { bd = d; best = s; } }
      return best;
    },
    async land(q) {
      if (landing) return;
      landing = true;
      const v = engine.get<VehicleApi>('vehicle')!, player = pl()!, driving = player.mode === 'driving';
      fade ??= new Fade();
      fade.to(true);
      let ok = false;
      try {
        await new Promise((r) => setTimeout(r, 0));
        v.inputEnabled = false;
        await new Promise((r) => setTimeout(r, 700));
        const at = driving ? q.car ?? q.road ?? q.foot : q.foot;
        await engine.get<WorldApi>('world')?.preload?.(at.x, at.z);
        if (driving) {
          let pose: { pos: THREE.Vector3 | { x: number; y: number; z: number }; yaw: number } | null = null;
          if (q.car) pose = { pos: { x: q.car.x, y: 0.6, z: q.car.z }, yaw: q.car.yaw };
          else if (q.road) {
            const lane = v.roadPoseNear?.(q.road.x, 0.5, q.road.z);
            // the lane's way, or turned round if it runs the other way from the one wanted
            if (lane) pose = { pos: lane.pos, yaw: lane.yaw };
          }
          if (pose) { v.reset(pose.pos, pose.yaw); ok = true; }
        }
        if (!ok) { player.setRiding(null, { x: q.foot.x, y: 0.3, z: q.foot.z, yaw: q.foot.yaw }); ok = true; }
        engine.get<CameraApi>('camera')?.snap(driving ? q.look : undefined);
      } finally {
        v.inputEnabled = true;
        fade.to(false, ok ? (driving ? q.caption : q.footCaption ?? q.caption) : undefined);
        landing = false;
      }
    },
    fixedUpdate(dt) {
      // the first time far from everything (driving slowly or on foot, nothing on): say where the jumps are
      if (hinted || !spots.length) return;
      if ((hintT += dt) < 2) return;
      hintT = 0;
      const p = pl(), v = engine.get<VehicleApi>('vehicle');
      if (!p || blocked() || missions()?.story || (p.mode === 'driving' && v && Math.abs(v.car.speed) > 3)) return;
      const far = spots.every((s) => Math.hypot(s.x - p.position.x, s.z - p.position.z) > HINT_FAR);
      if (!far) return;
      hinted = true;
      try { localStorage.setItem(HINT_KEY, '1'); } catch { /* ignore */ }
      engine.get<HudApi>('hud')?.toast(t(document.body.classList.contains('dc-touch') ? 'travel.hintTouch' : 'travel.hint'), 6);
    },
  };
  engine.add(api);
}
