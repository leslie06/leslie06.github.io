import * as THREE from 'three';
import { randomLook, type Look } from '../character/Body';
import type { Crowd } from '../character/Crowd';
import { Gait } from '../character/Animator';
import type { Engine, System } from '../core/Engine';
import { loadCity } from '../city/Data';
import type { FootbridgesFile } from '../city/visual/Footbridges';
import type { EntrancesFile } from '../city/visual/SubwayEntrances';

/** The subway kiosk's length before its per-entrance scale, its roof's reach past the open end (city/visual/SubwayEntrances.ts). */
const KIOSK_L = 10.5;

interface Walker {
  /** Points [x, y, z] and arc lengths of the path, walked from 0 to its end. */
  P: number[]; S: number[]; len: number;
  s: number; speed: number; lat: number;
  pos: THREE.Vector3; prev: THREE.Vector3; yaw: number;
  gait: Gait; look: Look; seed: number;
}

/** A path from points [x, y, z, ...]. */
function pathOf(P: number[]): { P: number[]; S: number[]; len: number } {
  const S = [0];
  for (let i = 3; i < P.length; i += 3) S.push(S[S.length - 1] + Math.hypot(P[i] - P[i - 3], P[i + 1] - P[i - 2], P[i + 2] - P[i - 1]));
  return { P, S, len: S[S.length - 1] };
}

/**
 * People on the paths the pavements do not have (2026-10-03, 「让城市动起来」): out of a subway entrance -
 * from the foot of its stair, up and out of the open end and away along the pavement - or the other way,
 * into it and down; and over a footbridge, up one stair, across the deck and down the other. Spawned near
 * the camera (a few a source at most, up to `cap` in all), walked along their path at a stroll and
 * dropped at its end; drawn through the player's crowd like the pedestrians (installed after them, so
 * after the crowd's reset each frame). No car hits: the paths keep off the carriageways.
 */
export async function installWalkers(engine: Engine, crowd: Crowd, cap: number): Promise<void> {
  if (cap <= 0) return;
  const [ent, fb] = await Promise.all([
    loadCity<EntrancesFile>('entrances.json').catch(() => null),
    loadCity<FootbridgesFile>('footbridges.json').catch(() => null),
  ]);
  type Source = { x: number; z: number; make: (rnd: () => number) => number[] };
  const sources: Source[] = [];
  // subway entrances: [x, z, yaw (local +z the open end), length, width, station, letter]
  for (const [x, z, yaw, len] of ent?.e ?? []) {
    const c = Math.cos(yaw), s = Math.sin(yaw), sc = len / KIOSK_L;
    const W = (lx: number, lz: number, y: number) => [x + lx * c + lz * s, y, z - lx * s + lz * c];
    sources.push({ x, z, make: (rnd) => {
      const lx = (rnd() - 0.5) * 1.8, far = 14 + rnd() * 16, turn = (rnd() - 0.5) * 6;
      // up the stair (from 1.6 m under the floor at the closed end to the floor at the landing), out, along
      const P = [...W(lx, -KIOSK_L / 2 * sc + 1.2, -1.6), ...W(lx, KIOSK_L / 2 * sc - 2, 0), ...W(lx * 0.5, KIOSK_L / 2 * sc + 2, 0), ...W(lx * 0.5 + turn, KIOSK_L / 2 * sc + far, 0)];
      if (rnd() < 0.5) return P;
      // or the other way: in and down
      const R: number[] = [];
      for (let i = P.length - 3; i >= 0; i -= 3) R.push(P[i], P[i + 1], P[i + 2]);
      return R;
    } });
  }
  // footbridges with a stair at each end: foot - mid landing - top - the landing past the deck's end - the deck - and down
  if (fb) {
    const Y = fb.y, half = (fb.run - 2) / 2;
    for (const b of fb.b) {
      if (b.s.length !== 2) continue;
      const n = b.p.length / 2, hw = b.w / 2;
      const endOf = (k: number) => {
        const i = k ? n - 1 : 0, j = k ? n - 2 : 1, ex = b.p[2 * i], ez = b.p[2 * i + 1];
        const L = Math.hypot(ex - b.p[2 * j], ez - b.p[2 * j + 1]) || 1;
        return { ex, ez, ox: (ex - b.p[2 * j]) / L, oz: (ez - b.p[2 * j + 1]) / L };
      };
      const stairUp = (st: number[]) => {
        const [k, sx, sz, fx, fz] = st, L = Math.hypot(fx - sx, fz - sz) || 1, dx = (fx - sx) / L, dz = (fz - sz) / L, e = endOf(k);
        return [fx, 0, fz, sx + dx * (half + 2), Y / 2, sz + dz * (half + 2), sx + dx * half, Y / 2, sz + dz * half, sx, Y, sz, e.ex + e.ox * hw, Y, e.ez + e.oz * hw];
      };
      const a = b.s.find((q) => q[0] === 0), z = b.s.find((q) => q[0] === 1);
      if (!a || !z) continue;
      const up = stairUp(a), down = stairUp(z), deck: number[] = [];
      for (let i = 0; i < n; i++) deck.push(b.p[2 * i], Y, b.p[2 * i + 1]);
      const P = [...up, ...deck];
      for (let i = down.length - 3; i >= 0; i -= 3) P.push(down[i], down[i + 1], down[i + 2]);
      sources.push({ x: b.p[0], z: b.p[1], make: (rnd) => {
        if (rnd() < 0.5) return P;
        const R: number[] = [];
        for (let i = P.length - 3; i >= 0; i -= 3) R.push(P[i], P[i + 1], P[i + 2]);
        return R;
      } });
    }
  }
  if (!sources.length) return;

  let seed = 97;
  const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const walkers: Walker[] = [];
  const near: Source[] = [];
  let nearAt = { x: Infinity, z: Infinity }, spawnT = 0, clock = 0;
  const camDir = new THREE.Vector3(), draw = new THREE.Vector3();
  const place = (w: Walker, out: THREE.Vector3) => {
    let i = 1;
    while (i < w.S.length - 1 && w.S[i] < w.s) i++;
    const a = (i - 1) * 3, b = i * 3, t = Math.max(0, Math.min(1, (w.s - w.S[i - 1]) / ((w.S[i] - w.S[i - 1]) || 1)));
    const dx = w.P[b] - w.P[a], dz = w.P[b + 2] - w.P[a + 2], L = Math.hypot(dx, dz) || 1;
    // a little to one side of the line, so two on one path do not walk in each other
    out.set(w.P[a] + dx * t - dz / L * w.lat, w.P[a + 1] + (w.P[b + 1] - w.P[a + 1]) * t, w.P[a + 2] + dz * t + dx / L * w.lat);
    return Math.atan2(dx, dz);
  };
  const sys: System & { count: () => number } = {
    name: 'walkers',
    count: () => walkers.length,
    fixedUpdate(dt) {
      clock += dt;
      const cam = engine.camera.position;
      // the sources within 160 m, listed again every 40 m of travel
      if (Math.hypot(cam.x - nearAt.x, cam.z - nearAt.z) > 40) {
        nearAt = { x: cam.x, z: cam.z };
        near.length = 0;
        for (const s of sources) if (Math.abs(s.x - cam.x) < 160 && Math.abs(s.z - cam.z) < 160) near.push(s);
      }
      spawnT -= dt;
      if (spawnT <= 0 && near.length && walkers.length < cap) {
        spawnT = 2.5 / Math.max(1, near.length) + 0.4;
        const src = near[Math.floor(rnd() * near.length)];
        const { P, S, len } = pathOf(src.make(rnd));
        if (len > 4) {
          const w: Walker = { P, S, len, s: 0, speed: 1.15 + rnd() * 0.35, lat: (rnd() - 0.5) * 1.2, pos: new THREE.Vector3(), prev: new THREE.Vector3(), yaw: 0, gait: new Gait(), look: randomLook(rnd), seed: rnd() };
          w.yaw = place(w, w.pos); w.prev.copy(w.pos);
          walkers.push(w);
        }
      }
      for (let i = walkers.length - 1; i >= 0; i--) {
        const w = walkers[i];
        w.prev.copy(w.pos);
        w.s += w.speed * dt;
        if (w.s >= w.len || Math.hypot(w.pos.x - cam.x, w.pos.z - cam.z) > 260) { walkers.splice(i, 1); continue; }
        w.yaw = place(w, w.pos);
      }
    },
    update(dt, alpha) {
      const cam = engine.camera.position;
      engine.camera.getWorldDirection(camDir);
      for (const w of walkers) {
        const dx = w.pos.x - cam.x, dz = w.pos.z - cam.z, d = Math.hypot(dx, dz);
        if (d > 8 && dx * camDir.x + dz * camDir.z < -0.2 * d) continue;
        w.gait.update({ speed: w.speed, action: 'move', t: clock }, dt, w.seed);
        draw.lerpVectors(w.prev, w.pos, alpha);
        crowd.add(draw, w.yaw, w.gait, w.look);
      }
    },
  };
  engine.add(sys);
}
