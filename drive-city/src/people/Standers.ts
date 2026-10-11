import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import type { Actor, PeopleApi, RenderApi } from '../game/Contracts';
import type { Action } from '../character/Animator';
import { randomLook } from '../character/Body';
import { loadCity } from '../city/Data';
import type { CityStreamer } from '../city/Streamer';
import { tileOf } from '../city/Geo';
import { SHOP_STRIDE } from '../city/Buildings';
import { hashU, h01 } from '../city/visual/hash';
import type { TrafficApi } from '../traffic';

/**
 * People standing where Beijing's people stand (2026-10-11, the fourth item of the 「街道太空」 plan): the passers-by
 * walk the pavements, but nobody waited anywhere - a bus stop was an empty bench, a subway entrance a doorway. Near
 * the camera (25-110 m) each spot gets a few scripted people (PeopleApi.spawnActor: cars knock them over, a shove
 * puts them down, like anyone): two to four waiting at a bus shelter facing the road (some on the bench, some on the
 * phone) who walk to a bus that stops there and get on; a few standing about outside a subway entrance's open end;
 * a pair chatting or one on the phone outside some open shops. Which spots and how many come from a hash of the
 * spot, so the same people are there when you come back, fewer late at night. A budget by tier (`BUDGET`); new ones
 * only out of view or over 45 m away, and they go out of view past 130 m. Off in shot mode unless `?standers=1`.
 */
const BUDGET = { low: 6, medium: 11, high: 16 } as const;
const NEAR = 25, FAR = 110, GONE = 130;
const SHELTER_SPOTS = 4;

interface Spot { key: string; x: number; z: number; kind: 'stop' | 'subway' | 'shop'; people: { a: Actor | null; dx: number; dz: number; face: number; act: Action | null; seat: boolean }[]; bus: number }

export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search);
  if (q.get('standers') === '0' || (q.has('shot') && q.get('standers') !== '1')) return;
  const people = engine.get<PeopleApi>('people');
  const streamer = (engine.get('world') as unknown as { streamer?: CityStreamer } | undefined)?.streamer;
  if (!people?.spawnActor || !streamer) return;
  const budget = BUDGET[engine.quality.tier];
  let kiosks: number[][] = [];
  void loadCity<{ e: number[][] }>('entrances.json').then((e) => { kiosks = e.e; }).catch(() => {});
  const spots = new Map<string, Spot>();
  /** Bus stops a bus left from recently: their people got on (key -> seconds). */
  const boarded = new Map<string, number>();
  let t = 0, scanT = 0, live = 0;
  const camDir = new THREE.Vector3();
  const hr = (k: string, salt: number) => { let h = salt >>> 0; for (let i = 0; i < k.length; i++) h = hashU((h ^ k.charCodeAt(i)) >>> 0); return h01(h); };

  /** How busy a spot is now: the rush hours most, a little late in the evening, hardly anyone after midnight. */
  const busy = () => {
    const h = engine.get<RenderApi>('render')?.timeOfDay ?? 12;
    return h < 5.5 ? 0.15 : h < 7 ? 0.5 : h < 9.5 ? 1 : h < 17 ? 0.75 : h < 19.5 ? 1 : h < 22.5 ? 0.6 : 0.3;
  };

  /** The spots near (x, z), each with the people it would hold (not yet spawned). */
  const candidates = (x: number, z: number): Spot[] => {
    const out: Spot[] = [], b = busy();
    const sh = streamer.shelterPoses(x, z, FAR);
    for (let i = 0; i < sh.length; i += 3) {
      const key = `s${Math.round(sh[i])},${Math.round(sh[i + 1])}`, yaw = sh[i + 2];
      const n = Math.round((1 + 3 * hr(key, 1)) * b);
      if (!n || (boarded.get(key) ?? 0) > t) continue;
      // in the shelter's frame: x along the kerb, +z towards the road (StreetFurniture: road at +z, bench at the back)
      const c = Math.cos(yaw), s = Math.sin(yaw), people: Spot['people'] = [];
      for (let k = 0; k < Math.min(n, SHELTER_SPOTS); k++) {
        // the bench runs from -1.3 to +0.85 m along the shelter (its two seats); the rest stand along the kerb side
        const seat = k < 2 && hr(key, 10 + k) < 0.45;
        const lx = seat ? (k === 0 ? -0.85 : 0.35) : -3 + k * 1.9 + (hr(key, 20 + k) - 0.5) * 0.6, lz = seat ? -0.35 : 0.6 + hr(key, 30 + k) * 0.7;
        // facing the road, or half turned the way the bus comes
        const turn = seat ? 0 : (hr(key, 40 + k) - 0.5) * 1.6;
        people.push({ a: null, dx: lx * c + lz * s, dz: -lx * s + lz * c, face: yaw + turn, act: seat ? 'sit' : hr(key, 50 + k) < 0.35 ? 'phone' : null, seat });
      }
      out.push({ key, x: sh[i], z: sh[i + 1], kind: 'stop', people, bus: 0 });
    }
    for (const e of kiosks) {
      const d = Math.hypot(e[0] - x, e[1] - z);
      if (d > FAR) continue;
      const key = `k${Math.round(e[0])},${Math.round(e[1])}`, n = Math.round((1 + 2.5 * hr(key, 2)) * b);
      if (!n) continue;
      const fx = Math.sin(e[2]), fz = Math.cos(e[2]), out0 = e[3] / 2 + 2, people: Spot['people'] = [];
      for (let k = 0; k < n; k++) {
        const along = out0 + hr(key, 60 + k) * 3, across = (hr(key, 70 + k) - 0.5) * 6;
        people.push({ a: null, dx: fx * along + fz * across, dz: fz * along - fx * across, face: hr(key, 80 + k) * Math.PI * 2, act: hr(key, 90 + k) < 0.5 ? 'phone' : null, seat: false });
      }
      out.push({ key, x: e[0], z: e[1], kind: 'subway', people, bus: 0 });
    }
    const [ix, iz] = tileOf(x, z);
    for (const [tk, list] of streamer.shops) {
      const [tx, tz] = tk.split('_').map(Number);
      if (Math.abs(tx - ix) > 1 || Math.abs(tz - iz) > 1) continue;
      for (let i = 0; i < list.length; i += SHOP_STRIDE) {
        const sx = list[i], sz = list[i + 1];
        if (list[i + 7] & 1 || list[i + 6] < 0 || list[i + 9] < 2.5 || Math.hypot(sx - x, sz - z) > FAR) continue;   // open, signed, room in front
        const key = `h${Math.round(sx)},${Math.round(sz)}`;
        if (hr(key, 3) > 0.12 * b) continue;
        const nx = list[i + 2], nz = list[i + 3], out1 = 1.1 + hr(key, 4) * 0.6, pair = hr(key, 5) < 0.6;
        const tx2 = -nz, tz2 = nx, people: Spot['people'] = [];
        if (pair) {
          // two facing each other, side on to the shop
          people.push({ a: null, dx: nx * out1 - tx2 * 0.45, dz: nz * out1 - tz2 * 0.45, face: Math.atan2(tx2, tz2), act: 'talk', seat: false });
          people.push({ a: null, dx: nx * out1 + tx2 * 0.45, dz: nz * out1 + tz2 * 0.45, face: Math.atan2(-tx2, -tz2), act: hr(key, 6) < 0.5 ? 'talk' : null, seat: false });
        } else people.push({ a: null, dx: nx * out1, dz: nz * out1, face: Math.atan2(nx, nz) + (hr(key, 7) - 0.5), act: 'phone', seat: false });
        out.push({ key, x: sx, z: sz, kind: 'shop', people, bus: 0 });
      }
    }
    return out;
  };

  const leave = (s: Spot, how: 'vanish' | 'walk') => {
    for (const p of s.people) if (p.a) { if (p.a.alive) { p.a.release(how); } p.a = null; live--; }
    spots.delete(s.key);
  };

  const stats = { live: 0, spots: 0, boardings: 0 };
  const system: System & { stats: typeof stats } = {
    name: 'standers',
    stats,
    update(dt) {
      t += dt;
      const cam = engine.camera.position;
      engine.camera.getWorldDirection(camDir);
      const inView = (x: number, z: number) => { const dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz) || 1; return (dx * camDir.x + dz * camDir.z) / d > 0.2; };
      // The people already out: knocked down (they get up as passers-by), seated, boarding, or gone too far.
      for (const s of spots.values()) {
        const d = Math.hypot(s.x - cam.x, s.z - cam.z);
        if (d > GONE + 40 || (d > GONE && !inView(s.x, s.z))) { leave(s, 'vanish'); continue; }
        for (const p of s.people) {
          if (!p.a) continue;
          if (!p.a.alive) { p.a = null; live--; continue; }
          if (p.a.state === 'down' || p.a.hits > 0) { p.a.release('walk'); p.a = null; live--; continue; }
          if (s.bus && p.a.arrived) { p.a.release('vanish'); p.a = null; live--; }
        }
        if (s.bus && s.people.every((p) => !p.a)) { boarded.set(s.key, t + 90); spots.delete(s.key); }
      }
      stats.live = live; stats.spots = spots.size;
      scanT -= dt;
      if (scanT > 0) return;
      scanT = 0.8;
      // A bus standing at a shelter: its people walk to the door and get on.
      const tr = engine.get<TrafficApi>('traffic');
      if (tr) for (const c of tr.cars()) {
        if (c.spec.name !== 'bus' || c.speed > 0.4) continue;
        for (const s of spots.values()) {
          if (s.kind !== 'stop' || s.bus || Math.hypot(s.x - c.pos.x, s.z - c.pos.z) > 14) continue;
          s.bus = 1; stats.boardings++;
          // the front door: a third of the way back from the nose, on the kerb side (the bus's right)
          const doorX = c.pos.x + c.fwd.x * 3.5 - c.left.x * 1.6, doorZ = c.pos.z + c.fwd.z * 3.5 - c.left.z * 1.6;
          for (const p of s.people) if (p.a) { p.a.act(null); p.a.goTo(doorX, doorZ, 1.25 + Math.random() * 0.3); }
        }
      }
      // New spots, nearest first, as the budget allows.
      if (live >= budget) return;
      const cand = candidates(cam.x, cam.z).filter((s) => !spots.has(s.key)).map((s) => ({ s, d: Math.hypot(s.x - cam.x, s.z - cam.z) }))
        .filter(({ d }) => d > NEAR && d < FAR).sort((a, b) => a.d - b.d);
      for (const { s, d } of cand) {
        if (live + s.people.length > budget) continue;
        if (d < 45 && inView(s.x, s.z)) continue;
        let n = 0;
        for (const p of s.people) {
          const x = s.x + p.dx, z = s.z + p.dz;
          const a = people.spawnActor!(x, z, { look: randomLook(() => Math.random()), yaw: p.face });
          if (!a) break;
          if (p.act) a.act(p.act, { t: Math.random() * 4, seat: p.seat ? 0.46 : undefined });
          p.a = a; n++; live++;
        }
        if (n) spots.set(s.key, s); else break;
        if (live >= budget) break;
      }
    },
  };
  engine.add(system);
}
