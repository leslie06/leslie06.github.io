import * as THREE from 'three';
import { randomLook, type Look } from '../character/Body';
import type { Crowd } from '../character/Crowd';
import { Gait } from '../character/Animator';
import type { Engine, System } from '../core/Engine';
import type { PlayerApi, RenderApi } from '../game/Contracts';
import { FAMOUS, alongLine, busyAt, lineLength, pointOn, type FamousStreet } from '../city/Famous';

interface Stroller {
  s: number; u: number; dir: number; speed: number; pause: number; lookT: number;
  pos: THREE.Vector3; prev: THREE.Vector3; yaw: number; gait: Gait; look: Look; seed: number;
}

/** 镜头附近多长一段街上放人（沿街前后各 WIN 米）。 */
const WIN = 120;
const CAP = { low: 10, medium: 18, high: 26 } as const, LITE = 7;

/**
 * 名片街上逛街的人（2026-11-11，docs/street-level-design.md B7，city/Famous.ts）：不在车道图里的步行街（烟袋斜街，`walk`）
 * 路人系统走不到，这里自己放一群人沿街来回逛，走走停停、对着橱窗站一会，到街头掉头，给玩家让路。人数按钟点（`busyAt`）。
 * 南锣鼓巷的那群人（district/index.ts）是同一个意思。画进玩家的人群（Crowd），装在路人前面：人群满了先丢远处的路人。
 */
export function installStrollers(engine: Engine, crowd: Crowd): void {
  const streets = FAMOUS.filter((f) => f.walk);
  if (!streets.length) return;
  const pl = engine.get<PlayerApi>('player');
  const lens = new Map<FamousStreet, number>(streets.map((f) => [f, lineLength(f.pts)]));
  const list: Stroller[] = [];
  let on: FamousStreet | null = null, clock = 0, seedN = 1;
  const rnd = () => { seedN = (seedN * 16807) % 2147483647; return seedN / 2147483647; };
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  const camDir = new THREE.Vector3(), draw = new THREE.Vector3();
  const place = (w: Stroller, f: FamousStreet) => { pointOn(f.pts, w.s, w.u, at); w.pos.set(at.x, 0.03, at.z); };
  const face = (w: Stroller, f: FamousStreet, sideways = 0) => {
    pointOn(f.pts, w.s, 0, at);
    // 顺着走：(dx, dz)·dir；转向橱窗：左手 (dz, -dx) 乘以在哪一边
    w.yaw = sideways ? Math.atan2(at.dz * sideways, -at.dx * sideways) : Math.atan2(at.dx * w.dir, at.dz * w.dir);
  };
  const cap = (f: FamousStreet) => Math.round((engine.lite ? LITE : CAP[engine.quality.tier]) * busyAt(f, engine.get<RenderApi>('render')?.timeOfDay ?? 15));
  const add = (f: FamousStreet, cs: number) => {
    const len = lens.get(f)!, lo = 2, hi = len - 2;
    const s0 = Math.max(lo, cs - WIN), s1 = Math.min(hi, cs + WIN);
    if (s1 <= s0) return false;
    const w: Stroller = { s: s0 + rnd() * (s1 - s0), u: (rnd() - 0.5) * 2 * f.walk!, dir: rnd() < 0.5 ? 1 : -1, speed: 0.75 + rnd() * 0.5, pause: 0, lookT: 3 + rnd() * 12,
      pos: new THREE.Vector3(), prev: new THREE.Vector3(), yaw: 0, gait: new Gait(), look: randomLook(rnd), seed: rnd() };
    place(w, f); w.prev.copy(w.pos); face(w, f);
    list.push(w);
    return true;
  };
  const sys: System & { debug: () => { street: string | null; n: number } } = {
    name: 'strollers',
    debug: () => ({ street: on?.id ?? null, n: list.length }),
    fixedUpdate(dt) {
      clock += dt;
      const cam = engine.camera.position;
      // 镜头在哪条街上（走廊外 80 米内都算：远远走过来就有人）
      let f: FamousStreet | null = null, a = { d: Infinity, s: 0, u: 0 };
      for (const q of streets) { const b = alongLine(q.pts, cam.x, cam.z); if (b.d < q.r + 80 && b.d < a.d) { f = q; a = b; } }
      if (f !== on) { list.length = 0; on = f; }
      if (!f) return;
      const cs = a.s, n = cap(f);
      for (let i = list.length - 1; i >= 0; i--) if (Math.abs(list[i].s - cs) > WIN + 30) list.splice(i, 1);
      while (list.length < n) if (!add(f, cs)) break;
      while (list.length > n) list.pop();
      const len = lens.get(f)!, foot = pl?.foot;
      const p = foot ? alongLine(f.pts, foot.pos.x, foot.pos.z) : null;
      for (const w of list) {
        w.prev.copy(w.pos);
        if (w.pause > 0) {
          w.pause -= dt;
          if (w.pause <= 0) face(w, f);
        } else {
          w.s += w.dir * w.speed * dt;
          w.lookT -= dt;
          // 走到门口看一眼：靠边的人转向近的那边的店，站一会
          if (w.lookT <= 0 && Math.abs(w.u) > f.walk! * 0.55) {
            w.pause = 2 + rnd() * 5; w.lookT = 7 + rnd() * 16;
            face(w, f, w.u > 0 ? 1 : -1);
          }
          if (w.s > len - 2 || w.s < 2) { w.dir = w.s > len - 2 ? -1 : 1; w.pause = 0.6 + rnd() * 1.2; face(w, f); }
        }
        // 给玩家让路：往旁边挪
        if (p && p.d < f.walk! + 2) {
          const du = w.u - p.u, ds = w.s - p.s, d = Math.hypot(du, ds);
          if (d < 1.1) w.u = Math.max(-f.walk!, Math.min(f.walk!, w.u + Math.sign(du || 1) * (1.1 - d) * 4 * dt));
        }
        place(w, f);
      }
    },
    update(dt, alpha) {
      if (!list.length) return;
      const cam = engine.camera.position;
      engine.camera.getWorldDirection(camDir);
      for (const w of list) {
        const dx = w.pos.x - cam.x, dz = w.pos.z - cam.z, d = Math.hypot(dx, dz);
        if (d > 160 || (d > 8 && dx * camDir.x + dz * camDir.z < -0.2 * d)) continue;
        w.gait.update({ speed: w.pause > 0 ? 0 : w.speed, action: 'move', t: clock }, dt, w.seed);
        draw.lerpVectors(w.prev, w.pos, alpha);
        crowd.add(draw, w.yaw, w.gait, w.look);
      }
    },
  };
  engine.add(sys);
}
