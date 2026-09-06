import * as THREE from 'three';
import { CELL } from './Atlas';
import { LIT_NORMAL, MODE_ALIGNED, MODE_AXIS } from './ParticlePool';
import type { FxContext } from './Context';

/**
 * Always-on ambience. The job of this file is to make the air itself readable: without it a frame
 * of a street is a frame of geometry, and the three-layer depth read the reference frames get for
 * free from atmosphere (ref_04's ash, ref_07's petals, ref_01's backlit haze) never happens.
 *
 * What is in the air, near to far:
 *  - motes: two depth bands. A near band at 0.6-3 m with sprites large enough to actually resolve
 *    (a 5 mm mote at 6 m is a third of a pixel - which is why the previous single band read as
 *    nothing) and a far band out to 9 m. The size gap between the bands is what produces parallax.
 *  - embers: same two-band treatment, rising and wobbling, HDR so bloom catches them.
 *  - haze sheets: big, slow, sun-lit dust sheets drifting through the shot. These carry the frame.
 *    The pool's lit path has a strong forward-scatter term, so a sheet between the camera and the
 *    sun lights up - that is the "catches the sun" read, and it is why they are seeded across a
 *    wide arc rather than only in front of the camera.
 *  - shafts: elongated additive sheets aligned to the sun direction, high up, so the light has
 *    visible direction in the air rather than only on surfaces.
 *  - smoke columns near landmarks, and the odd sheet of paper tumbling along the ground.
 *
 * QUAD EDGES. A big billboard that intersects a wall shows a dead-straight seam where the quad
 * cuts the geometry (the critic caught one over the red building). There is no scene depth texture
 * available to this pool, so instead every large sprite is placed with a clearance raycast from the
 * camera and pulled in front of whatever it would have intersected, with its own half-extent
 * subtracted. Sprites that cannot fit are skipped rather than clipped.
 *
 * Cost: everything here goes into the shared world pool, so it stays inside the module's one
 * particle draw call.
 */
const _f = new THREE.Vector3(), _r = new THREE.Vector3(), _u = new THREE.Vector3(0, 1, 0), _p = new THREE.Vector3(), _dir = new THREE.Vector3();
const WIND = new THREE.Vector3(0.9, 0, 0.35);

export class Ambient {
  private moteAcc = 0; private smokeAcc = 0; private emberAcc = 0; private paperAcc = 0; private columnAcc = 0; private hazeAcc = 0; private shaftAcc = 0; private flameAcc = 0;
  private moteRate: number;
  /** World positions of persistent smoke columns (set by Fx from level landmarks). */
  columns: THREE.Vector3[] = [];
  /** Unit vector towards the sun; kept up to date by Fx so the haze knows which way is backlit. */
  readonly sunDir = new THREE.Vector3(0.45, 0.6, 0.35).normalize();

  constructor(private ctx: FxContext, private scene: THREE.Scene) {
    this.moteRate = 58 * ctx.scale; // motes per second; ~5.5 s life -> ~250 alive at high
  }

  /** Pre-populate for screenshots: spawn `seconds` worth of ambience with spawn times in the past. */
  prewarm(camera: THREE.Camera, seconds: number): void {
    const n = Math.floor(this.moteRate * seconds);
    for (let i = 0; i < n; i++) this.mote(camera, -this.ctx.rng.range(0, seconds));
    for (let i = 0; i < 3; i++) this.paper(camera, -this.ctx.rng.range(0, 3));
    for (let i = 0; i < 3; i++) this.smoke(camera, -this.ctx.rng.range(0, 6));
    for (let i = 0; i < 110; i++) this.ember(camera, -this.ctx.rng.range(0, 5));
    for (let i = 0; i < 80; i++) this.column(-this.ctx.rng.range(0, 12));
    for (let i = 0; i < 10; i++) this.flame(-this.ctx.rng.range(0, 0.8));
    for (let i = 0; i < 30; i++) this.haze(camera, -this.ctx.rng.range(0, 12));
    for (let i = 0; i < 26; i++) this.shaft(camera, -this.ctx.rng.range(0, 8));
  }

  update(dt: number, camera: THREE.Camera): void {
    if (dt <= 0) return;
    this.moteAcc += dt * this.moteRate;
    while (this.moteAcc >= 1) { this.moteAcc -= 1; this.mote(camera, 0); }
    this.smokeAcc += dt; if (this.smokeAcc > 2.5) { this.smokeAcc = 0; this.smoke(camera, 0); }
    this.emberAcc += dt; if (this.emberAcc > 0.28) { this.emberAcc = 0; this.ember(camera, 0); }
    this.paperAcc += dt; if (this.paperAcc > 5) { this.paperAcc = 0; this.paper(camera, 0); }
    this.hazeAcc += dt; if (this.hazeAcc > 0.5) { this.hazeAcc = 0; this.haze(camera, 0); }
    this.shaftAcc += dt; if (this.shaftAcc > 0.7) { this.shaftAcc = 0; this.shaft(camera, 0); }
    if (this.columns.length) {
      this.columnAcc += dt;
      if (this.columnAcc > 0.25) { this.columnAcc = 0; this.column(0); }
      this.flameAcc += dt; if (this.flameAcc > 0.16) { this.flameAcc = 0; this.flame(0); }
    }
    void this.scene;
  }

  private camBasis(camera: THREE.Camera): void {
    camera.getWorldDirection(_f); _f.y = 0; if (_f.lengthSq() < 1e-4) _f.set(0, 0, -1); _f.normalize();
    _r.crossVectors(_f, _u);
  }

  /**
   * Reject a haze sheet whose centre is behind world geometry (i.e. inside a building we are not
   * in). It used to also drag the sheet forward until its whole quad cleared any surface, which was
   * a workaround for the hard seam a clipped quad draws; the pool does depth-based soft particles
   * now, so a sheet may straddle a wall and dissolve into it, and the sheets can sit where they
   * actually belong instead of being bunched in front of the nearest surface.
   */
  private clear(camera: THREE.Camera, half: number): boolean {
    _dir.subVectors(_p, camera.position);
    const want = _dir.length(); if (want < 1e-3) return false;
    _dir.divideScalar(want);
    const hit = this.ctx.raycast(camera.position, _dir, want);
    return !hit || hit.distance > want - half * 0.35;
  }

  /**
   * Airborne dust. Two bands: `near` sprites are 4-8x bigger and sit 0.6-3 m out, so they sweep
   * across the frame against the slow far band and the air gets depth.
   */
  private mote(camera: THREE.Camera, age: number): void {
    const { pool, rng } = this.ctx;
    this.camBasis(camera);
    const near = rng.next() < 0.4;
    const d = pool.begin(this.ctx.time + age);
    const fwd = near ? rng.range(0.6, 3.0) : rng.range(3.0, 9.0);
    const spread = near ? 1.6 : 4.5;
    _p.copy(camera.position).addScaledVector(_f, fwd).addScaledVector(_r, rng.range(-spread, spread));
    _p.y += rng.range(-1.8, 2.8);
    d.pos(_p.x, _p.y, _p.z);
    d.vel(rng.range(-0.06, 0.06) + WIND.x * 0.03, rng.range(-0.05, 0.03), rng.range(-0.06, 0.06) + WIND.z * 0.03);
    d.gravity = 0; d.drag = 0; d.wobble = rng.range(0.02, 0.07);
    const s = near ? rng.range(0.016, 0.038) : rng.range(0.006, 0.016); d.size(s, s);
    d.life = rng.range(4, 7);
    d.cell = CELL.MOTE; d.additive = 0.8;
    // a minority catch the light strongly (backlit motes), the rest stay near-invisible
    const b = rng.next() < 0.42 ? rng.range(2.2, 3.6) : rng.range(0.35, 0.9);
    d.color(1.0 * b, 0.9 * b, 0.72 * b, near ? 0.5 : 0.42); d.fadeIn = 0.25; d.fadeOut = 0.35;
    pool.emit();
  }

  /**
   * Slow sun-lit dust sheet drifting past the camera. Seeded across a wide arc (not just in front)
   * so that whichever way the camera faces, some sheets sit between it and the sun and light up
   * through the pool's forward-scatter term.
   */
  private haze(camera: THREE.Camera, age: number): void {
    const { pool, rng } = this.ctx;
    this.camBasis(camera);
    const near = rng.next() < 0.45;
    const dist = near ? rng.range(3, 9) : rng.range(11, 34);
    const a = rng.range(-2.4, 2.4);
    _p.copy(camera.position).addScaledVector(_f, Math.cos(a) * dist).addScaledVector(_r, Math.sin(a) * dist);
    _p.y += near ? rng.range(-0.9, 2.2) : rng.range(-0.5, 5.5);
    const w = near ? rng.range(1.8, 3.6) : rng.range(6, 15);
    const h = near ? rng.range(1.4, 2.8) : rng.range(4, 10);
    if (!this.clear(camera, Math.max(w, h) * 0.5)) return;
    const d = pool.begin(this.ctx.time + age);
    d.pos(_p.x, _p.y, _p.z);
    d.vel(WIND.x * rng.range(0.15, 0.45), rng.range(0.03, 0.16), WIND.z * rng.range(0.15, 0.45));
    d.gravity = -0.004; d.drag = 0.3; d.wobble = 0.06;
    d.size(w * 0.7, h); d.curve = 0.6;
    d.life = rng.range(9, 14);
    d.lit = LIT_NORMAL; d.cell = CELL.DUST + rng.int(0, CELL.DUST_N - 1);
    d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-0.08, 0.08);
    const k = rng.range(0.9, 1.15);
    const al = near ? rng.range(0.10, 0.17) : rng.range(0.06, 0.11);
    d.color(0.56 * k, 0.51 * k, 0.44 * k, al); d.colorEnd(0.56 * k, 0.51 * k, 0.44 * k, 0); d.fadeIn = 0.3; d.fadeOut = 0.5;
    pool.emit();
  }

  /**
   * A shaft of lit air: an additive sheet stretched along the sun direction, high enough to clear
   * the props. Cheap stand-in for volumetrics - it is real 3-D geometry, so it parallaxes with the
   * camera and reads as light in the air rather than a screen-space smear.
   */
  private shaft(camera: THREE.Camera, age: number): void {
    const { pool, rng } = this.ctx;
    if (this.sunDir.y < 0.08) return; // sun on the horizon: shafts would lie flat across the frame
    this.camBasis(camera);
    const len = rng.range(7, 15);
    const a = rng.range(-1.2, 1.2);
    const dist = rng.range(5, 26);
    // Aim the shaft at a point near the ground in front of the camera, then start it `len` back up
    // the sun ray, so what is in frame is the lower half of a beam coming down out of the sky. The
    // point has to be able to see the sun: a beam landing on ground that is in shadow is a beam
    // that is passing through the building above it, and reads as exactly that.
    _p.copy(camera.position).addScaledVector(_f, Math.cos(a) * dist).addScaledVector(_r, Math.sin(a) * dist);
    const floor = this.ctx.floorAt(_p);
    _p.y = (floor > -1e5 ? floor : camera.position.y - 1.6) + rng.range(0.2, 2.5);
    _dir.copy(this.sunDir);
    if (this.ctx.raycast(_p, _dir, len)) return;
    _p.addScaledVector(this.sunDir, len);
    const d = pool.begin(this.ctx.time + age);
    d.pos(_p.x, _p.y, _p.z);
    d.vel(WIND.x * 0.12, 0, WIND.z * 0.12);
    d.gravity = 0; d.drag = 0.2;
    d.mode = MODE_AXIS; d.normal(-this.sunDir.x, -this.sunDir.y, -this.sunDir.z); d.stretch = len;
    // GLOW, not DUST: the dust cells store a normal map in rgb, which an additive sprite would
    // draw as a blue-grey smear instead of light.
    d.size(rng.range(1.6, 3.4), rng.range(2.0, 4.4)); d.curve = 0.8;
    d.life = rng.range(7, 12);
    d.cell = CELL.GLOW; d.additive = 1;
    const b = rng.range(0.045, 0.10);
    d.color(b, b * 0.94, b * 0.82, 1); d.colorEnd(b * 0.4, b * 0.36, b * 0.3, 1); d.fadeIn = 0.3; d.fadeOut = 0.45;
    pool.emit();
  }

  private smoke(camera: THREE.Camera, age: number): void {
    const { pool, rng } = this.ctx;
    this.camBasis(camera);
    _p.copy(camera.position).addScaledVector(_f, rng.range(18, 45)).addScaledVector(_r, rng.range(-25, 25));
    const floor = this.ctx.floorAt(_p); _p.y = (floor > -1e5 ? floor : 0) + rng.range(0.5, 2);
    const d = pool.begin(this.ctx.time + age);
    d.pos(_p.x, _p.y, _p.z);
    d.vel(WIND.x * 0.4 + rng.range(-0.2, 0.2), rng.range(0.4, 0.8), WIND.z * 0.4);
    d.gravity = -0.01; d.drag = 0.6;
    d.size(rng.range(1.2, 2.2), rng.range(4, 7)); d.curve = 0.6;
    d.life = rng.range(7, 11);
    d.lit = LIT_NORMAL; d.cell = CELL.SMOKE + rng.int(0, CELL.SMOKE_N - 1);
    d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-0.15, 0.15);
    d.color(0.42, 0.4, 0.37, 0.28); d.colorEnd(0.42, 0.4, 0.37, 0); d.fadeIn = 0.2; d.fadeOut = 0.5;
    pool.emit();
  }

  /** One puff of a persistent, wind-bent smoke column (dark base thinning to grey as it rises). */
  private column(age: number): void {
    if (!this.columns.length) return;
    const { pool, rng } = this.ctx;
    const src = this.columns[rng.int(0, this.columns.length - 1)];
    const d = pool.begin(this.ctx.time + age);
    d.pos(src.x + rng.range(-0.4, 0.4), src.y + rng.range(0, 0.5), src.z + rng.range(-0.4, 0.4));
    d.vel(WIND.x * rng.range(0.8, 1.4) + rng.range(-0.3, 0.3), rng.range(1.6, 2.6), WIND.z * rng.range(0.8, 1.4) + rng.range(-0.3, 0.3));
    d.gravity = -0.015; d.drag = 0.45;
    d.size(rng.range(0.8, 1.3), rng.range(4.5, 7)); d.curve = 0.55;
    d.life = rng.range(9, 13);
    d.lit = LIT_NORMAL; d.cell = CELL.SMOKE + rng.int(0, CELL.SMOKE_N - 1);
    d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-0.12, 0.12);
    const k = rng.range(0.85, 1.15);
    d.color(0.10 * k, 0.093 * k, 0.086 * k, 0.9); d.colorEnd(0.4 * k, 0.39 * k, 0.38 * k, 0); d.fadeIn = 0.05; d.fadeOut = 0.45;
    pool.emit();
  }

  /**
   * Fire at the foot of a smoke column. Without it a column is a grey smear with no cause, and the
   * embers coming off it have nothing to come off. Additive HDR so bloom catches the core.
   */
  private flame(age: number): void {
    if (!this.columns.length) return;
    const { pool, rng } = this.ctx;
    const src = this.columns[rng.int(0, this.columns.length - 1)];
    const n = 3 + rng.int(0, 3);
    for (let i = 0; i < n; i++) {
      const d = pool.begin(this.ctx.time + age - i * 0.05);
      d.pos(src.x + rng.range(-0.7, 0.7), src.y + rng.range(-0.1, 0.35), src.z + rng.range(-0.7, 0.7));
      d.vel(WIND.x * 0.35 + rng.range(-0.25, 0.25), rng.range(1.4, 2.6), WIND.z * 0.35 + rng.range(-0.25, 0.25));
      d.gravity = -0.06; d.drag = 2.0;
      d.size(rng.range(0.45, 0.8), rng.range(1.2, 2.1)); d.curve = 0.6;
      d.life = rng.range(0.45, 0.85);
      d.cell = CELL.FLAME + rng.int(0, CELL.FLAME_N - 1); d.additive = 0.75;
      d.rot = rng.range(-0.3, 0.3); d.rotSpeed = rng.range(-0.8, 0.8);
      d.color(3.0, 1.7, 0.6, 1); d.colorEnd(1.0, 0.28, 0.05, 0); d.fadeIn = 0.08; d.fadeOut = 0.55;
      pool.emit();
    }
  }

  /** Rising ember, in the same two depth bands as the motes so the two read against each other. */
  private ember(camera: THREE.Camera, age: number): void {
    const { pool, rng } = this.ctx;
    this.camBasis(camera);
    // Half of them come off whatever is burning (the smoke columns), which is what turns a column
    // from a grey smudge into a fire; the rest drift up from the ground around the camera.
    const near = rng.next() < 0.4;
    const src = !near && this.columns.length && rng.next() < 0.6 ? this.columns[rng.int(0, this.columns.length - 1)] : null;
    if (src) {
      _p.set(src.x + rng.range(-0.9, 0.9), src.y + rng.range(0, 0.8), src.z + rng.range(-0.9, 0.9));
    } else {
      // near embers stay inside the view cone - a mote 100 deg off the view axis is not parallax,
      // it is a particle nobody will ever see
      const a = near ? rng.range(-0.75, 0.75) : rng.range(-1.9, 1.9);
      const dist = near ? rng.range(1.2, 5) : rng.range(6, 26);
      _p.copy(camera.position).addScaledVector(_f, Math.cos(a) * dist).addScaledVector(_r, Math.sin(a) * dist);
      const floor = this.ctx.floorAt(_p); _p.y = (floor > -1e5 ? floor : camera.position.y - 1.5) + rng.range(0.2, 2.2);
    }
    const d = pool.begin(this.ctx.time + age);
    d.pos(_p.x, _p.y, _p.z);
    d.vel(WIND.x * (src ? 1.1 : 0.6) + rng.range(-0.35, 0.35), src ? rng.range(1.6, 3.4) : rng.range(0.5, 1.4), WIND.z * (src ? 1.1 : 0.6) + rng.range(-0.35, 0.35));
    d.gravity = -0.03; d.drag = src ? 0.5 : 0.3; d.wobble = near ? 0.22 : 0.14;
    const s = near ? rng.range(0.026, 0.055) : rng.range(0.01, 0.024); d.size(s, s * 0.6);
    d.life = src ? rng.range(2.5, 5.5) : rng.range(4, 8);
    d.cell = CELL.EMBER; d.additive = 1;
    const h = near ? rng.range(3.0, 5.2) : rng.range(2.0, 4.2);
    d.color(h, h * 0.45, h * 0.12, 1); d.colorEnd(h * 0.3, h * 0.08, 0, 1); d.fadeIn = 0.1; d.fadeOut = 0.5;
    pool.emit();
  }

  private paper(camera: THREE.Camera, age: number): void {
    const { pool, rng } = this.ctx;
    this.camBasis(camera);
    _p.copy(camera.position).addScaledVector(_f, rng.range(3, 14)).addScaledVector(_r, rng.range(-8, 8));
    const floor = this.ctx.floorAt(_p); if (floor <= -1e5) return;
    _p.y = floor + rng.range(0.1, 0.8);
    const d = pool.begin(this.ctx.time + age);
    d.pos(_p.x, _p.y, _p.z);
    d.vel(WIND.x * rng.range(1, 2), rng.range(0.2, 0.7), WIND.z * rng.range(1, 2));
    d.gravity = 0.12; d.drag = 0.9; d.wobble = 0.25; d.floorY = floor + 0.01;
    const s = rng.range(0.18, 0.28); d.size(s, s);
    d.life = rng.range(4, 6);
    d.lit = LIT_NORMAL; d.cell = CELL.PAPER; d.mode = MODE_ALIGNED;
    d.normal(rng.range(-1, 1), rng.range(0.3, 1), rng.range(-1, 1));
    d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-3, 3);
    d.color(0.8, 0.78, 0.72, 1); d.fadeIn = 0.05; d.fadeOut = 0.15;
    pool.emit();
  }
}
