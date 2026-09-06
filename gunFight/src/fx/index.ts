import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { SurfaceType } from '../core/Events';
import { CG, groups } from '../core/Physics';
import type { EnemiesApi, LevelApi, PlayerApi, WeaponsApi } from '../game/Contracts';
import { registerPose } from '../debug/Poses';
import { Fx } from './Fx';
import { spawnImpact, spawnBlood } from './ImpactFx';
import { spawnExplosion } from './Explosion';

/** Entry point for the fx module. Creates the Fx system and registers the fx_* screenshot poses. */
export async function install(engine: Engine): Promise<void> {
  const fx = new Fx(engine);
  engine.add(fx);
  registerPoses(engine, fx);
}

/**
 * Poses start from a level landmark (falling back to fixed coordinates) and then raycast for the
 * wall ahead / behind so the camera ends up a known distance from a real surface. That way they
 * survive the map being rebuilt underneath them.
 */
function registerPoses(engine: Engine, fx: Fx): void {
  const player = () => engine.get<PlayerApi>('player');
  const level = () => engine.get<LevelApi>('level');
  const G = groups(CG.DEBRIS, CG.WORLD);
  const UP = new THREE.Vector3(0, 1, 0);
  const fwd = (yaw: number) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const floorAt = (x: number, z: number, yHint = 20): number => {
    const hit = engine.physics.raycast({ x, y: yHint, z }, { x: 0, y: -1, z: 0 }, 60, G);
    return hit ? hit.point[1] : 0;
  };
  const landmark = (name: string, fx_: number, fz: number, fyaw: number): { position: THREE.Vector3; yaw: number } => {
    const lm = level()?.landmarks?.[name];
    if (lm) return { position: lm.position.clone(), yaw: lm.yaw };
    return { position: new THREE.Vector3(fx_, 1, fz), yaw: fyaw };
  };
  /** Cast from `from` along `dir`; returns hit point + normal + distance (or a fallback plane `max` away). */
  const wallAt = (from: THREE.Vector3, dir: THREE.Vector3, max = 30) => {
    const hit = engine.physics.raycast(from, dir, max, G);
    if (hit) return { point: new THREE.Vector3(...hit.point), normal: new THREE.Vector3(...hit.normal), dist: hit.distance };
    return { point: from.clone().addScaledVector(dir, max), normal: dir.clone().negate(), dist: max };
  };
  /** Stand somewhere along the yaw axis through `start` so the wall ahead is ~wantDist away (bounded by the wall behind). */
  const findSpot = (start: THREE.Vector3, yaw: number, wantDist: number): THREE.Vector3 => {
    const f = fwd(yaw);
    const eye = start.clone(); eye.y = floorAt(start.x, start.z, start.y + 2) + 1.5;
    const df = wallAt(eye, f).dist, db = wallAt(eye, f.clone().negate()).dist;
    const target = Math.max(0.8, Math.min(wantDist, df + db - 0.8));
    return start.clone().addScaledVector(f, df - target);
  };
  /** Teleport the player, tick twice so the camera settles, wipe fx state, reseed. */
  const stand = (pos: THREE.Vector3, yaw: number, pitch: number): THREE.Vector3 => {
    const p = pos.clone(); p.y = floorAt(pos.x, pos.z, pos.y + 2) + 0.95;
    try { engine.get<EnemiesApi>('enemies')?.killAll(); } catch { /* optional */ }
    player()?.teleport(p, yaw, pitch);
    engine.tick(1 / 60); engine.tick(1 / 60);
    fx.clearAll(); fx.reseed(7);
    return p;
  };
  const eye = () => engine.camera.position.clone();
  const camFwd = () => engine.camera.getWorldDirection(new THREE.Vector3());

  registerPose({
    name: 'fx_impacts', description: 'One impact per surface type on a wall 3m ahead, captured at ~0.1s',
    animateFrames: 6, settleFrames: 4,
    apply: () => {
      const lm = landmark('alley', 0, -36.6, 0);
      const yaw = lm.yaw + Math.PI / 2; // alley side wall
      stand(findSpot(lm.position, yaw, 3.2), yaw, 0.04);
      const e = eye(), f = camFwd();
      const w = wallAt(e, f);
      const tangent = new THREE.Vector3().crossVectors(UP, w.normal).normalize();
      const surfaces: SurfaceType[] = ['concrete', 'metal', 'wood', 'dirt', 'brick', 'plaster', 'glass', 'sandbag', 'flesh'];
      const dir = f.clone().add(new THREE.Vector3(0, -0.08, 0)).normalize();
      const p = new THREE.Vector3();
      fx.ctx.time = engine.time;
      surfaces.forEach((s, i) => {
        // 1.9 m of wall, centred on the view axis and on the horizon. The old 3.4 m span with a
        // -0.5 m bias ran the first surfaces off the left edge of the wall (and their ejecta into
        // open sky) once the level was rebuilt around this pose.
        p.copy(w.point).addScaledVector(tangent, (i - 4) * 0.24).addScaledVector(UP, -0.3 + (i % 3) * 0.3);
        spawnImpact(fx.ctx, p, w.normal, s, dir, 0);
      });
    },
  });

  registerPose({
    name: 'fx_muzzle', description: 'Real weapon shot 2 frames in: flash cone/petals/star on the muzzle socket, flash light on a shaded wall, tracer, impact',
    animateFrames: 2, settleFrames: 2,
    apply: () => {
      // Stage the shot against a wall that is actually in shadow. The flash is additive and the
      // light it casts is the point of the frame; both are invisible against blown-out sunlit
      // plaster, which is what the previous framing gave (measured: the flash particles are
      // identical to weapon_ar_fire's, they just had nothing to read against). So: search a few
      // landmarks x a fan of bearings, shadow-test each candidate wall by casting from it towards
      // the sun, and take the darkest wall at a sensible range.
      const sun = fx.ambient.sunDir;
      // Score the whole view cone, not one ray: a bearing whose centre ray hits shadowed brick can
      // still put a blown-out sunlit wall across half the frame, and an additive flash cannot
      // compete with that either.
      const shade = (from: THREE.Vector3, y: number): number => {
        let sum = 0, n = 0;
        for (let k = -2; k <= 2; k++) {
          const w = wallAt(from, fwd(y + k * 0.28), 18);
          if (w.dist > 14) { sum += 0.35; n++; continue; }       // open sky: neutral
          if (w.dist < 1.2) return -1;                            // something in our face
          const lit = w.point.clone().addScaledVector(w.normal, 0.06);
          sum += engine.physics.raycast(lit, sun, 40, G) ? 1 : 0;
          n++;
        }
        return n ? sum / n : 0;
      };
      let lm = landmark('detail', 0, -35, 0), yaw = lm.yaw, bestScore = -Infinity;
      for (const nm of ['detail', 'alley', 'interior', 'rubble']) {
        const cand = landmark(nm, 0, -35, 0);
        const probe = cand.position.clone(); probe.y = floorAt(probe.x, probe.z, probe.y + 2) + 1.5;
        for (let i = 0; i < 12; i++) {
          const y = cand.yaw + i * Math.PI / 6;
          const w = wallAt(probe, fwd(y), 14);
          if (w.dist < 1.7 || w.dist > 7) continue;
          const sh = shade(probe, y);
          if (sh < 0) continue;
          const score = sh * 4 - w.normal.dot(sun) - Math.abs(w.dist - 3.4) * 0.25;
          if (score > bestScore) { bestScore = score; yaw = y; lm = cand; }
        }
      }
      stand(findSpot(lm.position, yaw, 3.6), yaw, -0.02);
      const weapons = engine.get<WeaponsApi>('weapons');
      weapons?.debugFire?.();  // real shot: socket-parented flash, shell, light, ballistics
      // Everything else in the frame hangs off the *real* muzzle. This used to spawn a second,
      // fx-owned flash at a hand-built offset "so the shape is legible", which is exactly the
      // quad the critic found floating 800 px from the gun over the doorway. There is only one
      // flash now and it is parented to the socket.
      const muzzle = fx.muzzleWorld(new THREE.Vector3());
      if (!muzzle) return;
      const dir = camFwd();
      const w = wallAt(muzzle, dir);
      fx.tracer(muzzle.clone().addScaledVector(dir, 0.3), w.point);
      fx.impact(w.point, w.normal, 'concrete', dir);
    },
  });

  registerPose({
    name: 'fx_explosion', description: 'Grenade explosion 6m ahead at ~0.2s: fireball flipbook, dust skirt, smoke crown, debris, sparks',
    animateFrames: 12, settleFrames: 4,
    apply: () => {
      const lm = landmark('rubble', 0, -28.6, 0);
      const yaw = lm.yaw + 0.28; // aim right of the blast so it lands left of the viewmodel
      const pos = stand(findSpot(lm.position, lm.yaw, 9), yaw, -0.05);
      const f = fwd(lm.yaw);
      const c = pos.clone().addScaledVector(f, 6.5);
      c.y = floorAt(c.x, c.z, pos.y + 2) + 0.3;
      fx.ctx.time = engine.time;
      spawnExplosion(fx.ctx, c, 5, 0);
    },
  });

  registerPose({
    name: 'fx_decals', description: 'Wall after 30 shots: decals + settling dust',
    animateFrames: 14, settleFrames: 4,
    apply: () => {
      const lm = landmark('alley', 0.4, -35.7, 0);
      const yaw = lm.yaw + Math.PI / 2;
      stand(findSpot(lm.position, yaw, 1.5), yaw, 0.06);
      const e = eye(), f = camFwd();
      const w = wallAt(e, f);
      const tangent = new THREE.Vector3().crossVectors(UP, w.normal).normalize();
      const kinds: SurfaceType[] = ['concrete', 'concrete', 'metal', 'concrete', 'plaster', 'brick', 'concrete', 'wood'];
      const p = new THREE.Vector3();
      fx.ctx.time = engine.time;
      const r = fx.rng;
      for (let i = 0; i < 30; i++) {
        p.copy(w.point).addScaledVector(tangent, r.gauss() * 0.3 - 0.35).addScaledVector(UP, 0.3 + r.gauss() * 0.25);
        const dir = f.clone().addScaledVector(tangent, r.range(-0.15, 0.15)).add(new THREE.Vector3(0, r.range(-0.1, 0.05), 0)).normalize();
        spawnImpact(fx.ctx, p, w.normal, kinds[i % kinds.length], dir, (29 - i) * 0.09 + 0.05);
      }
    },
  });

  registerPose({
    name: 'fx_blood', description: 'Headshot + body hit blood 1m in front of a sunlit wall',
    animateFrames: 5, settleFrames: 3,
    apply: () => {
      const lm = landmark('alley', 0, -36.6, 0);
      const yaw = lm.yaw + Math.PI / 2;
      stand(findSpot(lm.position.clone().addScaledVector(fwd(lm.yaw), 1.5), yaw, 3.4), yaw, 0.0);
      const e = eye(), f = camFwd();
      const w = wallAt(e, f);
      const tangent = new THREE.Vector3().crossVectors(UP, w.normal).normalize();
      const d = Math.min(1.0, Math.max(0.4, w.dist - 1.6));
      const head = w.point.clone().addScaledVector(w.normal, d).addScaledVector(tangent, -0.85).addScaledVector(UP, 0.6);
      const torso = w.point.clone().addScaledVector(w.normal, d).addScaledVector(tangent, -0.1).addScaledVector(UP, 0.05);
      const nrm = f.clone().negate();
      fx.ctx.time = engine.time;
      spawnBlood(fx.ctx, head, nrm, f.clone().addScaledVector(tangent, 0.1).normalize(), true, 0);
      spawnBlood(fx.ctx, torso, nrm, f.clone().addScaledVector(tangent, -0.08).normalize(), false, 0.04);
    },
  });

  registerPose({
    name: 'fx_ambient', description: 'Backlit air: drifting haze sheets catching the sun, sun shafts, near/far dust motes and embers, smoke column',
    animateFrames: 30, settleFrames: 4,
    apply: () => {
      const sunDir = fx.ambient.sunDir;
      const sunYaw = Math.atan2(-sunDir.x, -sunDir.z);
      // Look towards the sun down the longest open run we can find, and prefer a bearing with sky
      // in it. The haze and shafts only read against the air between the camera and the sun, the
      // far mote band needs somewhere to actually be far, and the smoke column needs bright sky
      // behind it or it is just a grey smear on a grey building.
      const skyScore = (from: THREE.Vector3, y: number): number => {
        let open = 0;
        const f = fwd(y);
        for (const el of [0.12, 0.28, 0.5]) {
          const dir = new THREE.Vector3(f.x, Math.tan(el), f.z).normalize();
          if (!engine.physics.raycast(from, dir, 60, G)) open++;
        }
        return open / 3;
      };
      let lm = landmark('street', -4.6, 23, -0.32), yaw = sunYaw, best = -1;
      for (const nm of ['alley', 'street', 'intersection', 'rubble', 'spawn', 'detail']) {
        const cand = landmark(nm, -4.6, 23, -0.32);
        const probe = cand.position.clone(); probe.y = floorAt(probe.x, probe.z, probe.y + 2) + 1.5;
        for (let i = -6; i <= 6; i++) {
          const y = sunYaw + i * 0.18;
          const open = Math.min(wallAt(probe, fwd(y), 70).dist, 45);
          const score = open + skyScore(probe, y) * 30 - Math.abs(i) * 1.6;
          if (score > best) { best = score; yaw = y; lm = cand; }
        }
      }
      // pitch up ~6 deg: puts the horizon low, so most of the frame is the lit air rather than road
      stand(findSpot(lm.position, yaw, 26), yaw, 0.09);
      // Something burning in the mid-ground, off the view axis. This is what gives the frame a
      // dark vertical mass and a fire to throw embers, i.e. a subject - a street full of evenly
      // lit haze has nothing for the eye to land on. Walk out along the bearing until the ground
      // is reachable, so the column never ends up inside a wall.
      // Put the fire where the camera can definitely see it: cast a ray out and slightly down and
      // take the first thing it hits. By construction nothing is in front of that point, which the
      // previous "pick a distance, then test visibility" version could not guarantee - it rejected
      // every candidate and silently fell back to the distant default columns.
      const cam = engine.camera.position.clone();
      let col: THREE.Vector3 | null = null, colScore = -Infinity;
      for (const off of [0.34, 0.46, 0.22, -0.34, -0.46, -0.22]) {
        for (const drop of [0.10, 0.07, 0.14]) {
          const b = fwd(yaw + off); b.y = -drop; b.normalize();
          const hit = engine.physics.raycast(cam, b, 40, G);
          if (!hit) continue;
          const p = new THREE.Vector3(hit.point[0], hit.point[1], hit.point[2]);
          if (Math.abs(hit.normal[1]) < 0.6) continue;              // landed on a wall, not the ground
          if (hit.distance < 8 || hit.distance > 26) continue;
          p.y += 0.25;
          if (engine.physics.raycast({ x: p.x, y: p.y + 1, z: p.z }, { x: 0, y: 1, z: 0 }, 26, G)) continue;
          const sc = -Math.abs(hit.distance - 14) - Math.abs(off) * 8 + (off > 0 ? 3 : 0); // left of the gun
          if (sc > colScore) { colScore = sc; col = p; }
        }
      }
      const keep = fx.ambient.columns;
      if (col) fx.ambient.columns = [col];
      fx.ambient.prewarm(engine.camera, 8);
      fx.ambient.columns = keep;
    },
  });
}
