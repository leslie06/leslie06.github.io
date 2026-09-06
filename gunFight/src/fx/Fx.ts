import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { SurfaceType } from '../core/Events';
import { CG, groups, type RayHit } from '../core/Physics';
import { Rng } from '../core/Rng';
import type { FxApi, LevelApi, PlayerApi, RenderPostApi } from '../game/Contracts';
import { buildAtlas, CELL, type Atlas } from './Atlas';
import { ParticlePool, STRIDE, type PoolLighting } from './ParticlePool';
import { Decals } from './Decals';
import { LightPool } from './Lights';
import { Shells } from './Shells';
import { Ambient } from './Ambient';
import type { FxContext } from './Context';
import { spawnImpact, spawnBlood } from './ImpactFx';
import { spawnExplosion } from './Explosion';
import { spawnMuzzleFlash, spawnTracer, type FlashSlots } from './MuzzleFx';
import { NO_FLOOR, type V3 } from './math';

/**
 * The fx system: implements FxApi, subscribes to gameplay events, and owns every pool.
 * Draw calls: world particle pool (1) + viewmodel flash pool (1) + decals (1) + shells (1) = 4.
 * Direct API calls and bus events can both fire for the same hit (weapons call impact() AND emit
 * hit:surface; Grenades call explosion() AND emit explosion), so every spawner dedupes on
 * (frame, position).
 */
// see ImpactFx: blood is dimmed with per-decal `exposure`, never with a dark tint (that crushes it to black)
const BLOOD_DECAL_TINT: [number, number, number] = [1, 0.95, 0.95];

export class Fx implements FxApi {
  name = 'fx';
  readonly atlas: Atlas;
  readonly pool: ParticlePool;
  readonly viewPool: ParticlePool;
  readonly decals: Decals;
  readonly lights: LightPool;
  readonly shells: Shells;
  readonly ambient: Ambient;
  readonly ctx: FxContext;
  readonly rng: Rng;
  /** Point lights inside the viewmodel scene: muzzle flashes and nearby blasts light the gun and glove. */
  private viewLights: LightPool;
  /** Cached viewmodel `muzzle` socket of whichever weapon is currently drawn (see muzzleSocket()). */
  private socket: THREE.Object3D | null = null;
  /**
   * The live flash, held in the muzzle socket's frame. Emitting at the socket is not enough on its
   * own: the gun recoils during the flash's ~4 frames and the particles, which integrate from a
   * fixed spawn point, get left behind - measured at 7 cm (~95 px) on the shotgun, i.e. the same
   * "detached flash" artifact in miniature. So the flash is genuinely parented: each frame its
   * position and bore axis are rebuilt from the socket's current transform.
   */
  private flashSlots: FlashSlots = { first: 0, count: 0, t0: -1 };
  private attach: { slot: number; lx: number; ly: number; lz: number; ax: number; ay: number; az: number }[] = [];
  private attachSocket: THREE.Object3D | null = null;
  private attachUntil = -1;
  private _inv = new THREE.Matrix4(); private _v = new THREE.Vector3(); private _n = new THREE.Vector3();
  /**
   * World-pass depth for soft particles (render/'s RenderPostApi.sceneDepth). Optional: absent when
   * the post chain is off, and the pool simply keeps its hard edges in that case. Re-queried only
   * when the drawing buffer or the camera planes change, since the call allocates.
   */
  private depth: { texture: THREE.Texture; near: number; far: number; width: number; height: number } | null = null;
  /** Drawing-buffer size and camera planes the depth params were last fetched for. */
  private depthFor = { w: -1, h: -1, near: -1, far: -1 };
  private lighting: PoolLighting = { sunDir: new THREE.Vector3(0.45, 0.6, 0.35).normalize(), sunColor: new THREE.Color(3, 2.9, 2.7), hemiSky: new THREE.Color(0.35, 0.4, 0.5), hemiGround: new THREE.Color(0.18, 0.16, 0.14) };
  private sun: THREE.DirectionalLight | null = null;
  private hemi: THREE.HemisphereLight | null = null;
  private shotCount = 0;
  private enemyShotCount = 0;
  private dedupe = new Map<string, { frame: number; x: number; y: number; z: number }[]>();
  private _a = new THREE.Vector3(); private _b = new THREE.Vector3(); private _c = new THREE.Vector3(); private _d = new THREE.Vector3(); private _col = new THREE.Color();
  private rayOrigin = { x: 0, y: 0, z: 0 }; private rayDir = { x: 0, y: -1, z: 0 };
  ambientEnabled = true;

  constructor(private engine: Engine) {
    const q = engine.quality;
    this.rng = new Rng(4242);
    // 16x16 grid: 128 px cells keep the atlas at 2048^2 (~16 MB, same as the old 8x8 @ 256) and
    // quarter the startup paint cost; 128 px is ample for flipbook frames and hole decals.
    this.atlas = buildAtlas(q.textureRes >= 2048 ? 128 : 96);
    const budget = q.particleBudget;
    this.pool = new ParticlePool(this.atlas, budget, 20);
    this.viewPool = new ParticlePool(this.atlas, 64, 20);
    this.decals = new Decals(this.atlas, q.decalBudget);
    this.lights = new LightPool(engine.scene, q.dynamicLights);
    this.shells = new Shells(Math.max(24, Math.min(96, q.decalBudget >> 1)));
    engine.scene.add(this.pool.mesh, this.decals.mesh, this.shells.mesh);
    engine.viewmodelScene.add(this.viewPool.mesh);
    this.viewLights = new LightPool(engine.viewmodelScene, 2);
    engine.scene.traverse((o) => {
      if (!this.sun && (o as THREE.DirectionalLight).isDirectionalLight) this.sun = o as THREE.DirectionalLight;
      if (!this.hemi && (o as THREE.HemisphereLight).isHemisphereLight) this.hemi = o as THREE.HemisphereLight;
    });
    const self = this;
    this.ctx = {
      pool: this.pool, decals: this.decals, lights: this.lights, rng: this.rng,
      scale: THREE.MathUtils.clamp(budget / 12000, 0.35, 1.6), time: engine.time,
      floorAt(p: V3): number { return self.floorAt(p); },
      raycast(o: V3, d: V3, max: number): RayHit | null { return self.raycast(o, d, max); },
      shake(x: number, y: number, z: number, radius: number): void { self.shakeFrom(x, y, z, radius); },
    };
    this.ambient = new Ambient(this.ctx, engine.scene);
    this.initSoftParticles();
    this.subscribe();
  }

  /**
   * Opt in to render/'s world-depth copy. Only the world pool gets it: the viewmodel scene is drawn
   * after a depth clear and is not in the copy, so a viewmodel particle sampling it would fade the
   * muzzle flash against whatever geometry happens to sit behind the gun.
   */
  private initSoftParticles(): void {
    const post = this.engine.get<RenderPostApi>('postfx');
    const d = post?.sceneDepth?.() ?? null;
    if (!d?.texture) return;
    this.depth = d;
    this.applyDepth(d);
  }
  /**
   * Re-fetch the depth params after a resize or a camera-plane change (the call allocates, so only
   * then). Also the retry for the case that made soft particles land on some frames and not others:
   * `postfx` may not have built its depth copy yet when fx installs, and before this the pool then
   * ran with hard edges for the rest of the session. Retried once a second until it takes.
   */
  private softRetryAt = 0;
  private syncDepth(): void {
    if (!this.depth) {
      if (this.engine.time < this.softRetryAt) return;
      this.softRetryAt = this.engine.time + 1;
      this.initSoftParticles();
      return;
    }
    const cam = this.engine.camera as THREE.PerspectiveCamera;
    this.engine.renderer.getDrawingBufferSize(this._size);
    const f = this.depthFor;
    if (this._size.x === f.w && this._size.y === f.h && cam.near === f.near && cam.far === f.far) return;
    const d = this.engine.get<RenderPostApi>('postfx')?.sceneDepth?.() ?? null;
    if (!d?.texture) return;
    this.depth = d;
    this.applyDepth(d);
  }
  private applyDepth(d: { texture: THREE.Texture; near: number; far: number; width: number; height: number }): void {
    const cam = this.engine.camera as THREE.PerspectiveCamera;
    this.engine.renderer.getDrawingBufferSize(this._size);
    this.pool.enableSoftParticles(d.texture);
    // uResolution converts gl_FragCoord to a UV, so it is the size of the target the pool draws
    // into, not the size of the depth copy (which is sampled with a normalised UV either way).
    this.pool.setDepthParams(d.near, d.far, this._size.x, this._size.y);
    this.depthFor = { w: this._size.x, h: this._size.y, near: cam.near, far: cam.far };
  }
  private _size = new THREE.Vector2();

  // ---------- FxApi ----------
  impact(point: THREE.Vector3, normal: THREE.Vector3, surface: SurfaceType, dir: THREE.Vector3): void {
    if (this.isDupe('impact', point, 0.05)) return;
    this.ctx.time = this.engine.time;
    spawnImpact(this.ctx, point, normal, surface, dir);
  }
  bloodHit(point: THREE.Vector3, normal: THREE.Vector3, dir: THREE.Vector3, big: boolean): void {
    if (this.isDupe('blood', point, 0.05)) return;
    this.ctx.time = this.engine.time;
    spawnBlood(this.ctx, point, normal, dir, big);
  }
  muzzleFlash(worldPos: THREE.Vector3, dir: THREE.Vector3, scale: number): void {
    if (this.isDupe('muzzle', worldPos, 0.3)) return;
    this.ctx.time = this.engine.time;
    const socket = this.muzzleSocket();
    spawnMuzzleFlash(this.ctx, this.viewPool, this.viewLights, this.engine.camera, this.engine.viewmodelCamera, worldPos, dir, scale, socket, socket ? this.flashSlots : null);
    if (socket) this.holdFlash(socket);
    if (import.meta.env.DEV && socket) this.assertOnMuzzle(socket, worldPos);
  }

  /**
   * The `muzzle` socket of the weapon that is actually being drawn, looked up in the viewmodel
   * scene rather than computed. Every weapon model parents an Object3D named 'muzzle' at the bore
   * exit; only the equipped weapon's subtree is visible, so "named muzzle + visible all the way to
   * the root" identifies it unambiguously. Cached, and revalidated whenever the cached one stops
   * being the visible one (weapon swap, model rebuild).
   */
  private muzzleSocket(): THREE.Object3D | null {
    if (this.socket && this.isLive(this.socket)) return this.socket;
    this.socket = null;
    this.engine.viewmodelScene.traverse((o) => {
      if (this.socket || o.name !== 'muzzle') return;
      if (this.isLive(o)) this.socket = o;
    });
    return this.socket;
  }
  /** Record the just-emitted flash in socket-local space so update() can follow the muzzle. */
  private holdFlash(socket: THREE.Object3D): void {
    const { first, count, t0 } = this.flashSlots;
    this.attach.length = 0;
    if (count <= 0) { this.attachSocket = null; return; }
    socket.updateWorldMatrix(true, false);
    this._inv.copy(socket.matrixWorld).invert();
    const a = this.viewPool.data, cap = this.viewPool.capacity;
    let maxLife = 0;
    for (let i = 0; i < count; i++) {
      const slot = (first + i) % cap, o = slot * STRIDE;
      if (Math.abs(a[o + 3] - t0) > 1e-4) continue;        // recycled (float32 store, so compare loosely)
      maxLife = Math.max(maxLife, a[o + 7]);
      this._v.set(a[o], a[o + 1], a[o + 2]).applyMatrix4(this._inv);
      this._n.set(a[o + 32], a[o + 33], a[o + 34]).transformDirection(this._inv);
      this.attach.push({ slot, lx: this._v.x, ly: this._v.y, lz: this._v.z, ax: this._n.x, ay: this._n.y, az: this._n.z });
    }
    this.attachSocket = this.attach.length ? socket : null;
    this.attachUntil = t0 + maxLife;
  }
  /** Rebuild the held flash from the socket's current transform (called every frame while alive). */
  private followMuzzle(time: number): void {
    const socket = this.attachSocket; if (!socket) return;
    if (time > this.attachUntil || !this.isLive(socket)) { this.attachSocket = null; this.attach.length = 0; return; }
    socket.updateWorldMatrix(true, false);
    const m = socket.matrixWorld, a = this.viewPool.data;
    for (let i = 0; i < this.attach.length; i++) {
      const e = this.attach[i], o = e.slot * STRIDE;
      if (Math.abs(a[o + 3] - this.flashSlots.t0) > 1e-4) continue;  // recycled under us
      this._v.set(e.lx, e.ly, e.lz).applyMatrix4(m);
      this._n.set(e.ax, e.ay, e.az).transformDirection(m);
      this.viewPool.repoint(e.slot, this._v.x, this._v.y, this._v.z, this._n.x, this._n.y, this._n.z);
    }
  }

  /** Still parented to the viewmodel scene and visible all the way up. */
  private isLive(o: THREE.Object3D): boolean {
    let n: THREE.Object3D | null = o;
    while (n) { if (!n.visible) return false; if (n === this.engine.viewmodelScene) return true; n = n.parent; }
    return false;
  }
  /**
   * Dev guard for the defect this replaced: a flash that renders detached from the gun. The
   * viewmodel flash is emitted at the socket, so the only way it can separate is if the socket we
   * found is not the one the weapon is firing from - which shows up as the socket and the weapon's
   * reported muzzle disagreeing once both are in world space.
   */
  private assertOnMuzzle(socket: THREE.Object3D, reported: THREE.Vector3): void {
    const vc = this.engine.viewmodelCamera as THREE.PerspectiveCamera, wc = this.engine.camera as THREE.PerspectiveCamera;
    if (!vc.isPerspectiveCamera || !wc.isPerspectiveCamera) return;
    socket.updateWorldMatrix(true, false);
    this._d.setFromMatrixPosition(socket.matrixWorld).applyMatrix4(vc.matrixWorldInverse);
    const k = Math.tan(vc.fov * 0.5 * THREE.MathUtils.DEG2RAD) / Math.tan(wc.fov * 0.5 * THREE.MathUtils.DEG2RAD);
    this._d.x *= k; this._d.y *= k;
    this._d.applyMatrix4(wc.matrixWorld);
    const off = this._d.distanceTo(reported);
    if (off > 0.02 && !this.socketWarned) { this.socketWarned = true; console.warn(`[fx] muzzle flash is ${off.toFixed(3)}m off the muzzle socket`); }
  }
  private socketWarned = false;

  /**
   * World position of the drawn muzzle, or null if no weapon is up. Uses the same FOV correction
   * the viewmodel is drawn with, so this is where the muzzle *appears*, which is where world-space
   * effects (tracer origin, wall light) have to start from if they are to line up with the gun.
   */
  muzzleWorld(out: THREE.Vector3): THREE.Vector3 | null {
    const socket = this.muzzleSocket(); if (!socket) return null;
    const vc = this.engine.viewmodelCamera as THREE.PerspectiveCamera, wc = this.engine.camera as THREE.PerspectiveCamera;
    socket.updateWorldMatrix(true, false);
    out.setFromMatrixPosition(socket.matrixWorld);
    if (!vc.isPerspectiveCamera || !wc.isPerspectiveCamera) return out;
    vc.updateMatrixWorld(); wc.updateMatrixWorld();
    out.applyMatrix4(vc.matrixWorldInverse);
    const k = Math.tan(vc.fov * 0.5 * THREE.MathUtils.DEG2RAD) / Math.tan(wc.fov * 0.5 * THREE.MathUtils.DEG2RAD);
    out.x *= k; out.y *= k;
    return out.applyMatrix4(wc.matrixWorld);
  }
  tracer(from: THREE.Vector3, to: THREE.Vector3): void {
    if (this.isDupe('tracer', from, 0.05)) return;
    this.ctx.time = this.engine.time;
    spawnTracer(this.ctx, from, to);
  }
  shell(worldPos: THREE.Vector3, vel: THREE.Vector3, kind: 'rifle' | 'pistol' | 'shotgun'): void {
    const floor = this.floorAt(worldPos);
    this.shells.spawn(worldPos, vel, kind, floor > NO_FLOOR + 1 ? floor : worldPos.y - 1.5);
  }
  explosion(center: THREE.Vector3, radius: number): void {
    if (this.isDupe('explosion', center, 0.6)) return;
    this.ctx.time = this.engine.time;
    spawnExplosion(this.ctx, center, radius);
    // The viewmodel is its own scene with its own lights, so the world blast light does not touch
    // the gun. Mirror it: the viewmodel camera is pinned to the world camera, so the blast's world
    // position is also its viewmodel-scene position.
    const fr = THREE.MathUtils.clamp(radius / 5, 0.5, 2);
    this._d.copy(center); this._d.y += 0.7 * fr;
    this.viewLights.flash(this._d, this._col.setRGB(1, 0.6, 0.3), 620 * fr * fr, 0.55, radius * 3.5, 0.3, 0.4);
  }
  /** Distance-attenuated camera trauma + screen flash for an explosion (called by the recipe). */
  private shakeFrom(x: number, y: number, z: number, radius: number): void {
    const pl = this.engine.get<PlayerApi>('player');
    const eye = pl?.eye ?? this.engine.camera.position;
    const dist = Math.sqrt((eye.x - x) ** 2 + (eye.y - y) ** 2 + (eye.z - z) ** 2);
    const k = THREE.MathUtils.clamp(1.25 - dist / (radius * 3), 0, 1);
    if (k <= 0) return;
    try { pl?.addShake?.(0.25 + 0.75 * k); } catch { /* optional */ }
    const post = this.engine.get<{ name: string; flash?: (strength?: number) => void }>('postfx');
    try { post?.flash?.(0.2 + 0.7 * k * k); } catch { /* optional */ }
  }
  dustPuff(point: THREE.Vector3, amount: number): void {
    this.ctx.time = this.engine.time;
    const { pool, rng } = this.ctx;
    const n = Math.max(1, Math.round(amount * 4 * this.ctx.scale));
    const floor = this.floorAt(point);
    for (let i = 0; i < n; i++) {
      const d = pool.begin(this.ctx.time);
      d.pos(point.x + rng.range(-0.1, 0.1), point.y + 0.03, point.z + rng.range(-0.1, 0.1));
      d.vel(rng.range(-0.5, 0.5) * amount, rng.range(0.2, 0.5) * amount, rng.range(-0.5, 0.5) * amount);
      d.drag = 2.5; d.gravity = 0.05; d.floorY = floor;
      d.size(0.08 * amount, rng.range(0.3, 0.5) * amount); d.curve = 0.45;
      d.life = rng.range(0.6, 1.1);
      d.lit = 1; d.cell = CELL.DUST + rng.int(0, CELL.DUST_N - 1);
      d.rot = rng.range(0, 6.28); d.rotSpeed = rng.range(-1, 1);
      d.color(0.5, 0.47, 0.42, 0.35 * Math.min(1, amount)); d.colorEnd(0.5, 0.47, 0.42, 0); d.fadeIn = 0.05; d.fadeOut = 0.7;
      d.normal(0, 1, 0);
      pool.emit();
    }
  }
  decal(point: THREE.Vector3, normal: THREE.Vector3, kind: 'bullet' | 'blood' | 'scorch', size: number): void {
    if (this.isDupe('decal:' + kind, point, 0.1)) return;
    const r = this.rng;
    if (kind === 'bullet') this.decals.place(point, normal, CELL.HOLE_CONCRETE + r.int(0, CELL.HOLE_CONCRETE_N - 1), size, { rot: r.range(-0.35, 0.35), alignDown: true });
    else if (kind === 'blood') {
      // wall (normal mostly horizontal) -> a splat with drips running down; ground -> a pool
      const onWall = Math.abs(normal.y) < 0.6;
      const cell = onWall ? CELL.BLOOD_DRIP + r.int(0, CELL.BLOOD_DRIP_N - 1) : CELL.BLOOD_POOL + r.int(0, CELL.BLOOD_POOL_N - 1);
      this.decals.place(point, normal, cell, size, { rot: onWall ? r.range(-0.2, 0.2) : r.range(0, 6.28), alignDown: onWall, roughness: 0.3, alpha: 0.95, tint: BLOOD_DECAL_TINT, exposure: 0.7 });
    }
    else this.decals.place(point, normal, CELL.SCORCH + r.int(0, CELL.SCORCH_N - 1), size, { rot: r.range(0, 6.28), alpha: 0.95 });
  }
  addLight(pos: THREE.Vector3, color: THREE.Color, intensity: number, life: number): void {
    if (this.isDupe('light', pos, 0.3)) return;
    // Range, not brightness, is what decides whether a flash lights the *world*: three.js windows a
    // point light to zero at `distance`, so the old sqrt(I)*1.5 (5.2 m for a muzzle flash) had the
    // light dead before it reached anything but the shooter's own feet. Inverse-square already does
    // the falloff; `distance` only exists to bound the shader cost, so put it well out of frame.
    this.lights.flash(pos, color, intensity, life, Math.max(8, Math.sqrt(intensity) * 3.2));
  }

  // ---------- events ----------
  private subscribe(): void {
    const ev = this.engine.events;
    ev.on('weapon:fire', (p) => {
      this._a.set(p.origin[0], p.origin[1], p.origin[2]); this._b.set(p.dir[0], p.dir[1], p.dir[2]);
      this.muzzleFlash(this._a, this._b, 1);
      this.shotCount++;
      if (this.shotCount % 3 === 0) this.tracerFrom(this._a, this._b, 200);
    });
    ev.on('hit:surface', (p) => {
      this._a.set(p.point[0], p.point[1], p.point[2]); this._b.set(p.normal[0], p.normal[1], p.normal[2]); this._c.set(p.dir[0], p.dir[1], p.dir[2]);
      this.impact(this._a, this._b, p.surface, this._c);
    });
    ev.on('hit:enemy', (p) => {
      this._a.set(p.point[0], p.point[1], p.point[2]); this._b.set(p.normal[0], p.normal[1], p.normal[2]);
      const pl = this.engine.get<PlayerApi>('player');
      if (pl) this._c.subVectors(this._a, pl.eye).normalize(); else this._c.copy(this._b).negate();
      this.bloodHit(this._a, this._b, this._c, p.headshot);
    });
    ev.on('enemy:fire', (p) => {
      this._a.set(p.origin[0], p.origin[1], p.origin[2]); this._b.set(p.dir[0], p.dir[1], p.dir[2]);
      if (this.isDupe('muzzle', this._a, 0.3)) return;
      this.ctx.time = this.engine.time;
      spawnMuzzleFlash(this.ctx, null, null, this.engine.camera, this.engine.viewmodelCamera, this._a, this._b, 0.8, null);
      this.enemyShotCount++;
      if (this.enemyShotCount % 2 === 0) this.tracerFrom(this._a, this._b, 120);
    });
    ev.on('enemy:death', (p) => {
      this._a.set(p.position[0], p.position[1], p.position[2]);
      this.dustPuff(this._a, 0.8);
      // blood pool where the body comes to rest
      const floor = this.floorAt(this._a);
      if (floor > NO_FLOOR + 1) {
        this._b.set(this._a.x + this.rng.range(-0.2, 0.2), floor, this._a.z + this.rng.range(-0.2, 0.2));
        this._c.set(0, 1, 0);
        this.decals.place(this._b, this._c, CELL.BLOOD_POOL + this.rng.int(0, CELL.BLOOD_POOL_N - 1), p.headshot ? this.rng.range(0.8, 1.0) : this.rng.range(0.55, 0.75), { rot: this.rng.range(0, 6.28), alpha: 0.92, roughness: 0.25, tint: BLOOD_DECAL_TINT, exposure: 0.7 });
      }
    });
    ev.on('explosion', (p) => { this._a.set(p.position[0], p.position[1], p.position[2]); this.explosion(this._a, p.radius); });
    ev.on('player:footstep', (p) => {
      if (p.surface !== 'dirt' && p.surface !== 'sandbag' && p.speed < 6) return;
      const pl = this.engine.get<PlayerApi>('player'); if (!pl) return;
      this._a.copy(pl.position); this._a.y = this.floorAtOr(this._a, pl.position.y - 0.9) + 0.02;
      this.dustPuff(this._a, p.surface === 'dirt' || p.surface === 'sandbag' ? 0.5 : 0.25);
    });
    ev.on('player:land', (p) => {
      const pl = this.engine.get<PlayerApi>('player'); if (!pl) return;
      this._a.copy(pl.position); this._a.y = this.floorAtOr(this._a, pl.position.y - 0.9) + 0.02;
      this.dustPuff(this._a, THREE.MathUtils.clamp(p.speed / 6, 0.4, 1.4));
    });
    ev.on('player:slide', (p) => {
      if (!p.start) return;
      const pl = this.engine.get<PlayerApi>('player'); if (!pl) return;
      this._a.copy(pl.position); this._a.y = this.floorAtOr(this._a, pl.position.y - 0.9) + 0.02;
      this.dustPuff(this._a, 0.9);
    });
  }

  private tracerFrom(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): void {
    const hit = this.raycast(origin, dir, maxDist);
    this._d.copy(origin).addScaledVector(dir, hit ? hit.distance : maxDist);
    this.ctx.time = this.engine.time;
    spawnTracer(this.ctx, origin, this._d);
  }

  // ---------- helpers ----------
  private isDupe(kind: string, p: THREE.Vector3, radius: number): boolean {
    let list = this.dedupe.get(kind);
    if (!list) { list = []; for (let i = 0; i < 8; i++) list.push({ frame: -1, x: 0, y: 0, z: 0 }); this.dedupe.set(kind, list); }
    const f = this.engine.frame; const r2 = radius * radius;
    let oldest = 0;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.frame === f) { const dx = e.x - p.x, dy = e.y - p.y, dz = e.z - p.z; if (dx * dx + dy * dy + dz * dz < r2) return true; }
      if (e.frame < list[oldest].frame) oldest = i;
    }
    const e = list[oldest]; e.frame = f; e.x = p.x; e.y = p.y; e.z = p.z;
    return false;
  }

  floorAt(p: V3): number {
    this.rayOrigin.x = p.x; this.rayOrigin.y = p.y + 0.05; this.rayOrigin.z = p.z;
    const hit = this.engine.physics.raycast(this.rayOrigin, this.rayDir, 30, groups(CG.DEBRIS, CG.WORLD));
    return hit ? hit.point[1] : NO_FLOOR;
  }
  private floorAtOr(p: V3, fallback: number): number { const f = this.floorAt(p); return f > NO_FLOOR + 1 ? f : fallback; }
  raycast(o: V3, d: V3, max: number): RayHit | null {
    return this.engine.physics.raycast(o, d, max, groups(CG.DEBRIS, CG.WORLD));
  }

  /** Wipe every effect (poses start from a clean slate). */
  clearAll(): void { this.attachSocket = null; this.attach.length = 0; this.flashSlots.count = 0; this.pool.clear(); this.viewPool.clear(); this.decals.clear(); this.lights.clear(); this.viewLights.clear(); this.shells.clear(); }
  reseed(seed: number): void { (this.rng as unknown as { s: number }).s = seed >>> 0; }

  /** Persistent distant smoke columns near level landmarks (lazy: the level may not be built at install). */
  private columnsReady = false;
  private setupColumns(): void {
    this.columnsReady = true;
    const level = this.engine.get<LevelApi>('level');
    const lm = level?.landmarks; if (!lm) return;
    const pick = ['rubble', 'intersection', 'rooftop'];
    for (const name of pick) {
      const l = lm[name]; if (!l) continue;
      const p = l.position.clone().add(new THREE.Vector3(Math.sin(l.yaw + 2.1) * 14, 0, Math.cos(l.yaw + 2.1) * 14));
      const floor = this.floorAt(p); p.y = (floor > NO_FLOOR + 1 ? floor : p.y) + 0.3;
      this.ambient.columns.push(p);
      if (this.ambient.columns.length >= 2) break;
    }
  }

  update(dt: number): void {
    const e = this.engine;
    this.ctx.time = e.time;
    e.camera.updateMatrixWorld();
    if (!this.columnsReady) this.setupColumns();
    if (this.sun) {
      this.lighting.sunDir.subVectors(this.sun.position, this.sun.target.position).normalize();
      this.lighting.sunColor.copy(this.sun.color).multiplyScalar(this.sun.intensity);
    }
    if (this.hemi) {
      this.lighting.hemiSky.copy(this.hemi.color).multiplyScalar(this.hemi.intensity + 0.35);
      this.lighting.hemiGround.copy(this.hemi.groundColor).multiplyScalar(this.hemi.intensity + 0.25);
    }
    this.ambient.sunDir.copy(this.lighting.sunDir);
    if (this.ambientEnabled) this.ambient.update(dt, e.camera);
    this.lights.update(dt, e.time);
    this.viewLights.update(dt, e.time);
    this.shells.update(dt);
    this.syncDepth();
    this.followMuzzle(e.time);
    this.pool.update(e.time, e.camera, this.lighting);
    this.viewPool.update(e.time, e.viewmodelCamera, this.lighting);
  }
}
