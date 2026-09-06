import * as THREE from 'three';
import { CELL } from './Atlas';
import { LIT_NORMAL, LIT_SPHERE, MODE_ALIGNED, MODE_STRETCH } from './ParticlePool';
import { budgetCount, coneDir, integrate, type V3 } from './math';
import type { FxContext } from './Context';

/**
 * Explosion, layered the way a CoD frag reads. NOTE ON ORDER: every particle lives in one pool
 * with depthWrite off, so emit order is the compositing order. Emit back-to-front by role —
 * ground dust / smoke column / debris, then the fireball over them, then the soot crown that
 * occludes the fire, then additive sparks on top.
 *  0.00 s  HDR flash (2 frames), ground shock disc, point light + screen flash, camera shake
 *  0.00 s  7-9 fireball flipbook sprites (64 frames each, sphere-lit so the smoke phase has a sun
 *          side), staggered in size/offset so the ball has volume and no single silhouette
 *  0.00 s  fire tongues shooting up, sparks/embers, 30 debris chunks each towing a baked smoke trail
 *  0.00 s  dust ring rushing out along the ground (lit, brown-grey, big)
 *  0.15 s+ lingering smoke column lit by the sun, 3-5 s
 *  scorch decal on whatever is below. Everything scales with radius (grenade r~5, barrel r~8).
 */
const _c = new THREE.Vector3(), _p = new THREE.Vector3(), _up = new THREE.Vector3(0, 1, 0), _col = new THREE.Color();
const _p0: V3 = { x: 0, y: 0, z: 0 }, _v0: V3 = { x: 0, y: 0, z: 0 }, _pt: V3 = { x: 0, y: 0, z: 0 }, _vt: V3 = { x: 0, y: 0, z: 0 };

export function spawnExplosion(ctx: FxContext, center: THREE.Vector3, radius: number, age = 0): void {
  const t0 = ctx.time - age;
  const { pool, rng, scale } = ctx;
  const fr = THREE.MathUtils.clamp(radius / 5, 0.5, 2);
  const floorY = ctx.floorAt(center);
  const groundY = floorY > -1e5 ? floorY : center.y - 0.5;
  const cx = center.x, cy = Math.max(center.y, groundY + 0.25), cz = center.z;

  // core flash: white-hot, 2 frames, then a warm afterglow that dies inside the fireball
  {
    const d = pool.begin(t0);
    d.pos(cx, cy + 0.4 * fr, cz); d.size(1.4 * fr, 3.2 * fr); d.life = 0.09; d.additive = 1; d.cell = CELL.GLOW;
    d.color(7, 5.5, 3.5, 1); d.colorEnd(2.5, 1.0, 0.3, 0); d.fadeIn = 0; d.fadeOut = 0.8; d.curve = 0.45;
    pool.emit();
  }
  {
    const d = pool.begin(t0);
    d.pos(cx, cy + 0.6 * fr, cz); d.size(1.0 * fr, 2.0 * fr); d.life = 0.35; d.additive = 1; d.cell = CELL.GLOW;
    d.color(2.2, 1.1, 0.35, 0.8); d.colorEnd(0.8, 0.25, 0.05, 0); d.fadeIn = 0; d.fadeOut = 0.9; d.curve = 0.5;
    pool.emit();
  }
  // dirt/soot plume thrown up with the fireball: dark lit dust that hides the sprite silhouettes
  const np = budgetCount(12, scale);
  for (let i = 0; i < np; i++) {
    const d = pool.begin(t0 + rng.range(0, 0.04));
    coneDir(_up, 0.8, rng.next(), rng.next(), _c);
    const sp = rng.range(3, 7) * fr;
    d.pos(cx + _c.x * 0.3 * fr, cy + 0.1 * fr, cz + _c.z * 0.3 * fr);
    d.vel(_c.x * sp, _c.y * sp, _c.z * sp);
    d.gravity = 0.25; d.drag = 2.0; d.floorY = groundY + 0.05;
    d.size(rng.range(0.5, 0.8) * fr, rng.range(1.8, 2.8) * fr); d.curve = 0.4;
    d.life = rng.range(1.2, 2.0);
    d.lit = LIT_NORMAL; d.cell = CELL.DUST + rng.int(0, CELL.DUST_N - 1);
    d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-1, 1);
    const k = rng.range(0.8, 1.2);
    d.color(0.2 * k, 0.17 * k, 0.14 * k, 0.7); d.colorEnd(0.3 * k, 0.27 * k, 0.24 * k, 0); d.fadeIn = 0.08; d.fadeOut = 0.55;
    pool.emit();
  }
  // fire tongues shooting up and out
  const nw = budgetCount(9, scale);
  for (let i = 0; i < nw; i++) {
    const d = pool.begin(t0 + rng.range(0, 0.04));
    coneDir(_up, 0.85, rng.next(), rng.next(), _c);
    const sp = rng.range(4, 9) * fr;
    d.pos(cx + _c.x * 0.2 * fr, cy + 0.1 * fr, cz + _c.z * 0.2 * fr);
    d.vel(_c.x * sp, _c.y * sp, _c.z * sp);
    d.gravity = -0.05; d.drag = 2.4;
    d.size(rng.range(0.3, 0.5) * fr, rng.range(0.9, 1.4) * fr); d.curve = 0.6;
    d.life = rng.range(0.28, 0.5);
    d.cell = CELL.FLAME + rng.int(0, CELL.FLAME_N - 1); d.additive = 0.6;
    d.rot = rng.range(-0.4, 0.4); d.rotSpeed = rng.range(-1, 1);
    d.color(3.2, 1.9, 0.8, 1); d.colorEnd(1.0, 0.3, 0.06, 0); d.fadeIn = 0.05; d.fadeOut = 0.6;
    pool.emit();
  }
  // ground shock disc + bright ring
  if (floorY > -1e5) {
    const d = pool.begin(t0);
    d.pos(cx, floorY + 0.05, cz); d.mode = MODE_ALIGNED; d.normal(0, 1, 0);
    d.size(0.8 * fr, radius * 2.2); d.life = 0.42; d.curve = 0.5; d.additive = 0.85; d.cell = CELL.SHOCK;
    d.color(1.6, 1.3, 1.0, 0.7); d.colorEnd(0.5, 0.35, 0.25, 0); d.fadeIn = 0.02; d.fadeOut = 0.75;
    pool.emit();
  }
  // dust ring rushing outward at ground level (big, lit, brown-grey, per-particle tint variation)
  const nd = budgetCount(26, scale);
  for (let i = 0; i < nd; i++) {
    const d = pool.begin(t0 + rng.range(0.01, 0.06));
    const a = (i + rng.range(0, 0.8)) / nd * Math.PI * 2;
    const ox = Math.cos(a), oz = Math.sin(a);
    const r0 = rng.range(0.4, 0.9) * fr;
    d.pos(cx + ox * r0, groundY + 0.15 * fr, cz + oz * r0);
    const sp = rng.range(8, 14) * fr;
    d.vel(ox * sp, rng.range(1.0, 2.4) * fr, oz * sp);
    d.gravity = 0.12; d.drag = 2.8;
    d.size(rng.range(0.9, 1.3) * fr, rng.range(2.4, 3.4) * fr); d.curve = 0.3;
    d.life = rng.range(1.4, 2.4);
    d.lit = LIT_NORMAL; d.cell = CELL.DUST + rng.int(0, CELL.DUST_N - 1);
    d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-0.8, 0.8);
    const k = rng.range(0.85, 1.15);
    d.color(0.28 * k, 0.24 * k, 0.19 * k, 0.58); d.colorEnd(0.38 * k, 0.34 * k, 0.3 * k, 0); d.fadeIn = 0.03; d.fadeOut = 0.6;
    d.floorY = groundY + 0.05;
    pool.emit();
  }
  // ground burst skirt: wide low dust hemisphere at the seat of the blast
  const ng = budgetCount(14, scale);
  for (let i = 0; i < ng; i++) {
    const d = pool.begin(t0 + rng.range(0.005, 0.05));
    const a = rng.range(0, Math.PI * 2);
    const ox = Math.cos(a), oz = Math.sin(a);
    d.pos(cx + ox * rng.range(0.2, 0.7) * fr, groundY + rng.range(0.1, 0.5) * fr, cz + oz * rng.range(0.2, 0.7) * fr);
    const sp = rng.range(3, 6) * fr;
    d.vel(ox * sp, rng.range(1.5, 3.5) * fr, oz * sp);
    d.gravity = 0.1; d.drag = 2.4; d.floorY = groundY + 0.05;
    d.size(rng.range(1.1, 1.7) * fr, rng.range(2.8, 3.8) * fr); d.curve = 0.26;
    d.life = rng.range(1.6, 2.6);
    d.lit = LIT_NORMAL; d.cell = CELL.DUST + rng.int(0, CELL.DUST_N - 1);
    d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-0.7, 0.7);
    const k = rng.range(0.85, 1.15);
    d.color(0.24 * k, 0.21 * k, 0.17 * k, 0.62); d.colorEnd(0.36 * k, 0.32 * k, 0.28 * k, 0); d.fadeIn = 0.03; d.fadeOut = 0.6;
    pool.emit();
  }
  // lingering smoke column: dark, sun-lit on one side, rises and thins over 3-5 s
  const ns = budgetCount(16, scale);
  for (let i = 0; i < ns; i++) {
    const d = pool.begin(t0 + rng.range(0.02, 0.4));
    coneDir(_up, 0.45, rng.next(), rng.next(), _c);
    d.pos(cx + rng.range(-0.45, 0.45) * fr, cy + rng.range(0.3, 1.4) * fr, cz + rng.range(-0.45, 0.45) * fr);
    const sp = rng.range(1.0, 2.6) * fr;
    d.vel(_c.x * sp, _c.y * sp, _c.z * sp);
    d.gravity = -0.02; d.drag = 1.0;
    d.size(rng.range(1.0, 1.5) * fr, rng.range(2.8, 4.0) * fr); d.curve = 0.4;
    d.life = rng.range(3.0, 5.0);
    d.lit = LIT_NORMAL; d.cell = CELL.SMOKE + rng.int(0, CELL.SMOKE_N - 1);
    d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-0.4, 0.4);
    const k = rng.range(0.8, 1.2);
    d.color(0.16 * k, 0.15 * k, 0.14 * k, 0.85); d.colorEnd(0.3 * k, 0.29 * k, 0.28 * k, 0); d.fadeIn = 0.1; d.fadeOut = 0.55;
    pool.emit();
  }
  // Debris chunks, each towing a short baked smoke trail (positions sampled from the same analytic
  // trajectory the GPU integrates, so the trail sits exactly behind the chunk).
  //
  // Two classes, because one sprite mode cannot do both jobs: the grit is velocity-stretched, so a
  // fragment doing 18 m/s smears along its path (motion blur) and settles back to its own size as
  // it slows, while the handful of real chunks stay tumbling billboards - at that size the
  // silhouette is worth more than the blur - and every one of them tows a trail. Round-2 read them
  // as "identical clean boxes with no rotation blur and no trails"; this is both halves of that.
  const nb = budgetCount(34, scale);
  const trailN = Math.max(3, Math.round(6 * scale));
  for (let i = 0; i < nb; i++) {
    coneDir(_up, 1.1, rng.next(), rng.next(), _c);
    const sp = rng.range(6, 18) * fr;
    const vx = _c.x * sp, vy = _c.y * sp, vz = _c.z * sp;
    const gravity = 1, drag = 0.2;
    const d = pool.begin(t0);
    d.pos(cx, cy, cz);
    d.vel(vx, vy, vz);
    d.gravity = gravity; d.drag = drag; d.floorY = groundY + 0.01;
    // log-ish size distribution: mostly grit, a few real chunks
    const u = rng.next(); const sz = (0.016 + u * u * u * 0.085) * fr; d.size(sz, sz * rng.range(0.7, 1.0));
    d.life = rng.range(2.2, 3.8);
    d.lit = LIT_NORMAL; d.cell = (rng.next() < 0.25 ? CELL.CLOD + rng.int(0, CELL.CLOD_N - 1) : CELL.DEBRIS + rng.int(0, CELL.DEBRIS_N - 1));
    const chunk = sz >= 0.038 * fr;
    if (chunk) { d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-26, 26); }
    else { d.mode = MODE_STRETCH; d.stretch = rng.range(0.010, 0.018); }
    const k = rng.range(0.55, 1.05);
    d.color(0.17 * k, 0.155 * k, 0.14 * k, 1); d.fadeIn = 0; d.fadeOut = 0.1;
    pool.emit();
    if (!chunk) continue; // only real chunks tow a trail
    _p0.x = cx; _p0.y = cy; _p0.z = cz; _v0.x = vx; _v0.y = vy; _v0.z = vz;
    for (let k2 = 0; k2 < trailN; k2++) {
      const ta = 0.04 + k2 * rng.range(0.07, 0.11);
      integrate(_p0, _v0, gravity, drag, ta, _pt, _vt);
      if (_pt.y < groundY + 0.05) break;
      const s = pool.begin(t0 + ta);
      s.pos(_pt.x, _pt.y, _pt.z);
      s.vel(_vt.x * 0.15 + rng.range(-0.3, 0.3), _vt.y * 0.15 + 0.4, _vt.z * 0.15 + rng.range(-0.3, 0.3));
      s.gravity = -0.02; s.drag = 3;
      s.size(0.05 * fr, rng.range(0.2, 0.35) * fr); s.curve = 0.5;
      s.life = rng.range(0.4, 0.7);
      s.lit = LIT_NORMAL; s.cell = CELL.SMOKE + rng.int(0, CELL.SMOKE_N - 1);
      s.rot = rng.range(0, 6.28); s.rotSpeed = rng.range(-1, 1);
      s.color(0.22, 0.2, 0.18, 0.28); s.colorEnd(0.3, 0.28, 0.26, 0); s.fadeIn = 0.12; s.fadeOut = 0.6;
      pool.emit();
    }
  }
  // fireballs: two big central + a ring of smaller lobes, all running the 64-frame flipbook
  const nf = budgetCount(17, scale); // 2 core lobes + a spread of smaller ones filling the gaps
  for (let i = 0; i < nf; i++) {
    const big = i < 2;
    const d = pool.begin(t0 - (big ? 0 : rng.range(0, 0.05)));
    coneDir(_up, big ? 0.35 : 0.95, rng.next(), rng.next(), _c);
    const off = (big ? rng.range(0, 0.3) : rng.range(0.25, 0.95)) * fr;
    // lobe 0 is the seat of the blast; lobe 1 stacks above and behind it so the mass rises
    const lift = (i === 1 ? 1.15 : 0) * fr + (big ? 0.3 : rng.range(0.1, 1.3)) * fr;
    d.pos(cx + _c.x * off, cy + lift + Math.abs(_c.y) * off * 0.5, cz + _c.z * off);
    const sp = rng.range(0.5, 1.3) * fr;
    d.vel(_c.x * sp, rng.range(2.2, 3.8) * fr, _c.z * sp);
    d.gravity = -0.1; d.drag = 1.4;
    const bigK = i === 1 ? 0.72 : 1; // second core lobe is clearly smaller, so they never twin
    const s0 = (big ? rng.range(2.1, 2.6) * bigK : rng.range(0.8, 1.7)) * fr, s1 = (big ? rng.range(4.2, 5.0) * bigK : rng.range(2.2, 3.6)) * fr;
    d.size(s0, s1); d.curve = 0.42;
    d.life = big ? rng.range(1.25, 1.75) : rng.range(0.8, 1.5);
    const off2 = rng.int(0, 10); // start each lobe at a different point in the flipbook
    d.cell = CELL.FIREBALL + off2; d.frames = CELL.FIREBALL_N - off2; d.lit = LIT_SPHERE;
    d.rot = rng.range(-0.85, 0.85); d.rotSpeed = rng.range(-0.35, 0.35);
    const h = rng.range(1.9, 2.3);
    // Alpha well under 1 so the lobes *sum* into a volume. At 0.95 each lobe simply occluded the
    // one behind it and the ball read as a cluster of discs; the density comes from the count and
    // the overlap instead, which is also how the smoke phase gets its internal structure.
    const av = (big ? rng.range(0.8, 0.9) : rng.range(0.5, 0.68));
    d.color(h, h * 0.92, h * 0.85, av); d.colorEnd(1.0, 1.0, 1.0, av * 0.92); d.fadeIn = 0.0; d.fadeOut = 0.22;
    pool.emit();
  }
  // dust veil in front of the fire (emitted after it, so it composites over): breaks the lobe
  // silhouettes and keeps the fireball from reading as a cluster of discs
  const nv = budgetCount(7, scale);
  for (let i = 0; i < nv; i++) {
    const d = pool.begin(t0 + rng.range(0.01, 0.05));
    coneDir(_up, 1.3, rng.next(), rng.next(), _c);
    const off3 = rng.range(0.5, 1.5) * fr;
    d.pos(cx + _c.x * off3, cy + rng.range(-0.2, 0.9) * fr, cz + _c.z * off3);
    const sp = rng.range(2.5, 5) * fr;
    d.vel(_c.x * sp, rng.range(0.8, 2.2) * fr, _c.z * sp);
    d.gravity = 0.08; d.drag = 2.2;
    d.size(rng.range(0.8, 1.3) * fr, rng.range(2.2, 3.2) * fr); d.curve = 0.32;
    d.life = rng.range(1.0, 1.8);
    d.lit = LIT_NORMAL; d.cell = CELL.DUST + rng.int(0, CELL.DUST_N - 1);
    d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-0.9, 0.9);
    const k = rng.range(0.85, 1.15);
    d.color(0.3 * k, 0.26 * k, 0.21 * k, 0.3); d.colorEnd(0.36 * k, 0.32 * k, 0.28 * k, 0); d.fadeIn = 0.05; d.fadeOut = 0.6;
    pool.emit();
  }
  // soot crown: dark, dense smoke lobes riding the top of the fireball. Spawned with the fire
  // (not after it) but sized/curved so soot dominates the upper silhouette from ~0.12s onward.
  const nc = budgetCount(9, scale);
  for (let i = 0; i < nc; i++) {
    const d = pool.begin(t0 + rng.range(0, 0.03));
    coneDir(_up, 1.0, rng.next(), rng.next(), _c);
    const front = i === 0; // one lobe rides low and wide, wrapping a flank of the fire
    const off = (front ? rng.range(0.7, 1.3) : rng.range(0.2, 0.8)) * fr;
    d.pos(cx + _c.x * off, cy + (front ? rng.range(0.35, 0.8) : rng.range(0.8, 1.6)) * fr + Math.abs(_c.y) * off, cz + _c.z * off);
    const sp = rng.range(1.4, 3.0) * fr;
    d.vel(_c.x * sp, (front ? rng.range(1.2, 2.2) : rng.range(2.4, 4.2)) * fr, _c.z * sp);
    d.gravity = -0.08; d.drag = 1.5;
    const cs = rng.range(0.6, 1.15);
    d.size(rng.range(1.0, 1.8) * cs * fr, rng.range(2.8, 4.6) * cs * fr); d.curve = 0.34;
    d.life = rng.range(1.8, 2.6);
    d.cell = CELL.SOOT; d.frames = CELL.SOOT_N; d.lit = LIT_SPHERE;
    d.rot = rng.range(-0.7, 0.7); d.rotSpeed = rng.range(-0.4, 0.4);
    const k = rng.range(0.55, 0.9), av = (front ? 0.5 : 0.88) * rng.range(0.8, 1.0);
    d.color(k, k, k, av); d.colorEnd(0.8 * k, 0.8 * k, 0.8 * k, 0.8 * av); d.fadeIn = 0.03; d.fadeOut = 0.3;
    pool.emit();
  }
  // embers / sparks: HDR, velocity-stretched, bounce on the ground
  const ne = budgetCount(60, scale);
  for (let i = 0; i < ne; i++) {
    const d = pool.begin(t0);
    coneDir(_up, 1.3, rng.next(), rng.next(), _c);
    const sp = rng.range(5, 22) * fr;
    d.pos(cx, cy, cz);
    d.vel(_c.x * sp, _c.y * sp, _c.z * sp);
    d.gravity = 1; d.drag = rng.range(0.5, 1.3); d.floorY = groundY + 0.005;
    d.mode = MODE_STRETCH; d.stretch = rng.range(0.01, 0.02);
    const sz = rng.range(0.008, 0.02); d.size(sz, sz * 0.6);
    d.life = rng.range(0.5, 1.8);
    d.additive = 1; d.cell = rng.next() < 0.6 ? CELL.STREAK : CELL.EMBER;
    const h = rng.range(2.5, 5);
    d.color(h, h * 0.6, h * 0.25, 1); d.colorEnd(h * 0.25, h * 0.06, 0.01, 1); d.fadeIn = 0; d.fadeOut = 0.4;
    pool.emit();
  }
  // scorch (+ a wider faint soot halo)
  _c.set(0, -1, 0);
  const hit = ctx.raycast(_p.set(cx, cy, cz), _c, 3);
  if (hit) {
    _p.set(hit.point[0], hit.point[1], hit.point[2]); _c.set(hit.normal[0], hit.normal[1], hit.normal[2]);
    ctx.decals.place(_p, _c, CELL.SCORCH + rng.int(0, CELL.SCORCH_N - 1), radius * 0.36, { rot: rng.range(0, 6.28), alpha: 0.95 });
    ctx.decals.place(_p, _c, CELL.SCORCH + rng.int(0, CELL.SCORCH_N - 1), radius * 0.7, { rot: rng.range(0, 6.28), alpha: 0.45 });
  }
  // Light. A blast that does not light its surroundings reads as a decal of a blast, so this is
  // three lights with a hold plateau (see LightPool.envelope) rather than one that has already
  // decayed by the time anyone looks at it:
  //   core   - inside the fireball, hot enough to blow out anything within ~3 m
  //   ground - low at the seat of the blast, which is what puts the bright pool on the floor
  //   glow   - dim, wide and long-lived: the warm wash that keeps the whole area lit while the
  //            smoke climbs, and the one that reaches the far walls and the ground at the camera
  const e2 = fr * fr; // radiated energy goes with the area of the fireball, not its radius
  ctx.lights.flash(_p.set(cx, cy + 0.9 * fr, cz), _col.setRGB(1, 0.66, 0.34), 1050 * e2, 0.30, radius * 3, 0.25, 0.45);
  ctx.lights.flash(_p.set(cx, groundY + 0.35 * fr, cz), _col.setRGB(1, 0.54, 0.22), 560 * e2, 0.45, radius * 2.0, 0.30, 0.40);
  ctx.lights.flash(_p.set(cx, cy + 1.7 * fr, cz), _col.setRGB(1, 0.46, 0.18), 190 * e2, 1.10, radius * 4.5, 0.35, 0.25);
  ctx.shake?.(cx, cy, cz, radius);
}
