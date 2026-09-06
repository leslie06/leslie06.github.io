import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { AudioApi, EnemiesApi, FxApi, PlayerApi } from './Contracts';
import { GRENADE } from './GameDefs';
import { grenadeTextures, ribbon } from './PropArt';
import { explosionFalloff } from './GameLogic';
import type { Resuppliable } from './GameMode';

interface Grenade {
  body: RAPIER.RigidBody;
  collider: RAPIER.Collider;
  mesh: THREE.Group;
  fuse: number;
  prev: THREE.Vector3; cur: THREE.Vector3;
  prevQ: THREE.Quaternion; curQ: THREE.Quaternion;
}

/**
 * Frag grenades: G throws a Rapier dynamic sphere that bounces, cooks for 3.5s and explodes with
 * radial damage to enemies and the player, an fx explosion, and camera shake. The visual is a
 * small PBR M67-style body (dark green) with a steel spoon and pull ring, drawn in the world scene.
 */
export class Grenades implements System, Resuppliable {
  name = 'grenades';
  count = GRENADE.maxCarried;
  readonly max = GRENADE.maxCarried;
  private live: Grenade[] = [];
  private meshPool: THREE.Group[] = [];
  private cooldown = 0;
  private geo: { body: THREE.BufferGeometry; olive: THREE.BufferGeometry; steel: THREE.BufferGeometry } | null = null;
  private mats: { body: THREE.MeshStandardMaterial; olive: THREE.MeshStandardMaterial; steel: THREE.MeshStandardMaterial } | null = null;
  private tmp = new THREE.Vector3();
  /** Set while the game is running; grenades can't be thrown from the menu / while dead. */
  canThrow: () => boolean = () => true;

  constructor(private engine: Engine) {}

  private get player(): PlayerApi | undefined { return this.engine.get<PlayerApi>('player'); }
  private get enemies(): EnemiesApi | undefined { return this.engine.get<EnemiesApi>('enemies'); }
  private get fx(): FxApi | undefined { return this.engine.get<FxApi>('fx'); }
  private get audio(): AudioApi | undefined { return this.engine.get<AudioApi>('audio'); }

  resupply(): void { this.count = this.max; }
  clear(): void { for (const g of [...this.live]) this.remove(g); this.live.length = 0; }

  fixedUpdate(dt: number): void {
    this.cooldown = Math.max(0, this.cooldown - dt);
    const inp = this.engine.input.state;
    if (inp.grenadePressed && this.cooldown <= 0 && this.count > 0 && this.canThrow() && this.player?.alive) this.throwFromPlayer();
    for (const g of [...this.live]) {
      g.fuse -= dt;
      g.prev.copy(g.cur); g.prevQ.copy(g.curQ);
      const t = g.body.translation(); g.cur.set(t.x, t.y, t.z);
      const q = g.body.rotation(); g.curQ.set(q.x, q.y, q.z, q.w);
      if (g.fuse <= 0 || g.cur.y < -50) this.explode(g);
    }
  }

  update(_dt: number, alpha: number): void {
    for (const g of this.live) {
      g.mesh.position.lerpVectors(g.prev, g.cur, alpha);
      g.mesh.quaternion.slerpQuaternions(g.prevQ, g.curQ, alpha);
    }
  }

  /** Throw along the player's view. */
  throwFromPlayer(): boolean {
    const pl = this.player; if (!pl) return false;
    const yaw = pl.yaw, pitch = pl.pitch;
    const cp = Math.cos(pitch);
    const dir = new THREE.Vector3(-Math.sin(yaw) * cp, Math.sin(pitch), -Math.cos(yaw) * cp);
    const ok = this.throwGrenade(dir, GRENADE.throwSpeed);
    if (ok) { this.count--; this.cooldown = GRENADE.cooldown; this.safe(() => this.audio?.play('grenade_throw', { position: pl.eye })); }
    return ok;
  }

  /**
   * Spawn a grenade from the player's hand travelling along `dir` (world) at `speed` m/s.
   * Does not consume inventory (used directly by poses); returns false when the pool is full.
     * `opts.fuse` overrides the fuse (poses pass a huge value so nothing detonates during later captures);
   * `opts.spin` / `opts.orient` let a pose freeze the tumble and present the hero side to camera.
   */
  throwGrenade(dir: THREE.Vector3, speed: number, opts: { fuse?: number; spin?: number; orient?: THREE.Quaternion } = {}): boolean {
    const pl = this.player; const phys = this.engine.physics;
    if (!pl || !phys.world) return false;
    if (this.live.length >= GRENADE.poolSize) this.explode(this.live[0]);
    const eye = pl.eye.lengthSq() > 0 ? pl.eye.clone() : pl.position.clone().add(new THREE.Vector3(0, 0.8, 0));
    const d = dir.clone().normalize();
    const right = new THREE.Vector3(-d.z, 0, d.x).normalize();
    let origin = eye.clone().addScaledVector(d, 0.45).addScaledVector(right, 0.22).add(new THREE.Vector3(0, -0.12, 0));
    // Don't spawn inside a wall: pull back to the first world hit between the eye and the hand.
    try {
      const toHand = origin.clone().sub(eye); const len = toHand.length();
      const hit = phys.raycast(eye, toHand.divideScalar(len), len + 0.1, groups(CG.PROJECTILE, CG.WORLD));
      if (hit) origin = eye.clone().addScaledVector(toHand, Math.max(0, hit.distance - 0.15));
    } catch { /* physics not ready */ }
    const vel = d.clone().add(new THREE.Vector3(0, GRENADE.throwLift, 0)).normalize().multiplyScalar(speed).add(pl.velocity ?? new THREE.Vector3());
    const R = phys.R;
    const spin = opts.spin ?? 1;
    const desc = R.RigidBodyDesc.dynamic()
      .setTranslation(origin.x, origin.y, origin.z)
      .setLinvel(vel.x, vel.y, vel.z)
      .setAngvel({ x: right.x * 14 * spin, y: 3 * spin, z: right.z * 14 * spin })
      .setLinearDamping(GRENADE.linearDamping).setAngularDamping(GRENADE.angularDamping)
      .setCcdEnabled(true);
    if (opts.orient) desc.setRotation({ x: opts.orient.x, y: opts.orient.y, z: opts.orient.z, w: opts.orient.w });
    const body = phys.world.createRigidBody(desc);
    const collider = phys.world.createCollider(R.ColliderDesc.ball(GRENADE.colliderRadius)
      .setRestitution(GRENADE.restitution).setFriction(GRENADE.friction).setMass(GRENADE.mass)
      .setCollisionGroups(groups(CG.PROJECTILE, CG.WORLD | CG.ENEMY | CG.DEBRIS)), body);
    phys.tag(collider, { surface: 'metal', tag: 'grenade' });
    const mesh = this.acquireMesh();
    mesh.position.copy(origin); mesh.visible = true;
    const q0 = opts.orient ? opts.orient.clone() : new THREE.Quaternion();
    mesh.quaternion.copy(q0);
    const g: Grenade = { body, collider, mesh, fuse: opts.fuse ?? GRENADE.fuse, prev: origin.clone(), cur: origin.clone(), prevQ: q0.clone(), curQ: q0.clone() };
    this.live.push(g);
    return true;
  }

  /** World position of the most recently thrown live grenade (poses aim the camera at it). */
  latestPosition(): THREE.Vector3 | null {
    const g = this.live[this.live.length - 1];
    return g ? g.cur.clone() : null;
  }

  /** Ballistic estimate (no bounces) of where a grenade thrown now along `dir` at `speed` will be after `t` seconds. */
  predict(dir: THREE.Vector3, speed: number, t: number): THREE.Vector3 {
    const pl = this.player;
    const eye = pl ? (pl.eye.lengthSq() > 0 ? pl.eye.clone() : pl.position.clone().add(new THREE.Vector3(0, 0.8, 0))) : new THREE.Vector3();
    const d = dir.clone().normalize();
    const right = new THREE.Vector3(-d.z, 0, d.x).normalize();
    const origin = eye.addScaledVector(d, 0.45).addScaledVector(right, 0.22).add(new THREE.Vector3(0, -0.12, 0));
    const vel = d.clone().add(new THREE.Vector3(0, GRENADE.throwLift, 0)).normalize().multiplyScalar(speed);
    return origin.addScaledVector(vel, t).add(new THREE.Vector3(0, -0.5 * 9.81 * t * t, 0));
  }

  private explode(g: Grenade): void {
    const center = g.cur.clone();
    this.remove(g);
    const i = this.live.indexOf(g); if (i >= 0) this.live.splice(i, 1);
    const radius = GRENADE.radius;
    this.engine.events.emit('explosion', { position: [center.x, center.y, center.z], radius });
    this.safe(() => this.fx?.explosion(center, radius));
    this.safe(() => this.audio?.play('explosion', { position: center }));
    // scorch on whatever is under the blast
    this.safe(() => {
      const hit = this.engine.physics.raycast(center, { x: 0, y: -1, z: 0 }, 2.5, groups(CG.PROJECTILE, CG.WORLD));
      if (hit) this.fx?.decal(new THREE.Vector3(...hit.point), new THREE.Vector3(...hit.normal), 'scorch', radius * 0.45);
    });
    this.safe(() => this.fx?.addLight?.(center.clone().add(new THREE.Vector3(0, 0.6, 0)), new THREE.Color(1, 0.6, 0.25), 60, 0.35));
    this.safe(() => this.enemies?.applyExplosion(center, radius, GRENADE.damage));
    const pl = this.player;
    if (pl) {
      const d = this.tmp.copy(pl.position).sub(center).length();
      const f = explosionFalloff(d, radius, GRENADE.edgeFraction);
      if (f > 0 && pl.alive) this.safe(() => pl.damage(Math.round(GRENADE.damage * f * GRENADE.selfDamageScale), center));
      const shake = GRENADE.shake * Math.max(0, 1 - d / (radius * GRENADE.shakeRange));
      if (shake > 0) this.safe(() => pl.addShake?.(shake));
    }
  }

  private remove(g: Grenade): void {
    const phys = this.engine.physics;
    try { phys.untag(g.collider); phys.world.removeRigidBody(g.body); } catch { /* already removed */ }
    g.mesh.visible = false;
    this.meshPool.push(g.mesh);
  }

  /**
   * M67 fragmentation grenade, built once and shared by the pool.
   *
   * Body is a lathed ovoid with a pressed-half seam at the equator, wrapped in a painted olive
   * texture carrying the yellow HE identification band and the lot stencils. On top sits the M213
   * fuze (nut, body, striker cap), the stamped sheet-metal safety lever swept down the side, and
   * the pull ring on its cotter pin.
   */
  private buildGeometry(): { body: THREE.BufferGeometry; olive: THREE.BufferGeometry; steel: THREE.BufferGeometry } {
    const R = GRENADE.visualRadius;          // 0.075 m equatorial radius
    const h = R * 1.14;                      // half height
    const TOP = 0.955;                       // profile is cut here for the fuze boss

    // --- body: an ovoid a touch fuller than a sphere, with a pressed-half ridge at the equator
    const N = 34;
    const pts: THREE.Vector2[] = [];
    for (let i = 0; i <= N; i++) {
      const sv = -1 + (1 + TOP) * (i / N);
      const base = Math.pow(Math.max(0, 1 - sv * sv), 0.42);
      const ridge = 1 + 0.022 * Math.exp(-(sv / 0.055) * (sv / 0.055));
      pts.push(new THREE.Vector2(R * base * ridge, h * sv));
    }
    const body = new THREE.LatheGeometry(pts, 36);
    body.computeVertexNormals();
    // LatheGeometry's v is the profile index, which bunches badly at the poles; make it linear in
    // height instead so the painted band and stencils land where they were authored.
    {
      const pos = body.getAttribute('position') as THREE.BufferAttribute;
      const uv = body.getAttribute('uv') as THREE.BufferAttribute;
      const span = h * (1 + TOP);
      for (let i = 0; i < uv.count; i++) uv.setY(i, (pos.getY(i) + h) / span);
      uv.needsUpdate = true;
    }
    body.setAttribute('uv1', new THREE.BufferAttribute((body.getAttribute('uv') as THREE.BufferAttribute).array.slice() as Float32Array, 2));

    // --- fuze assembly + safety lever (painted olive steel)
    const olive: THREE.BufferGeometry[] = [];
    const yTop = h * TOP;
    const nut = new THREE.CylinderGeometry(0.0245, 0.0268, 0.0090, 12);
    nut.translate(0, yTop + 0.0030, 0); olive.push(nut);
    const stem = new THREE.CylinderGeometry(0.0170, 0.0178, 0.0190, 12);
    stem.translate(0, yTop + 0.0165, 0); olive.push(stem);
    const cap = new THREE.CylinderGeometry(0.0205, 0.0180, 0.0062, 12);
    cap.translate(0, yTop + 0.0290, 0); olive.push(cap);
    // striker lug the lever pivots on
    const lug = new THREE.BoxGeometry(0.0078, 0.0115, 0.0185);
    lug.translate(0.0138, yTop + 0.0250, 0); olive.push(lug);

    // Safety lever: over the striker, then swept down the shoulder to just past the equator,
    // standing ~3 mm proud of the body so it breaks the silhouette and casts a shadow line.
    const surf = (sv: number, out: number) => new THREE.Vector3(R * Math.pow(Math.max(0, 1 - sv * sv), 0.42) + out, h * sv, 0);
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(0.0055, yTop + 0.0345, 0),
      new THREE.Vector3(0.0245, yTop + 0.0315, 0),
      new THREE.Vector3(0.0330, yTop + 0.0170, 0),
      new THREE.Vector3(0.0358, yTop + 0.0010, 0),
      surf(0.86, 0.0045), surf(0.70, 0.0042), surf(0.50, 0.0040),
      surf(0.28, 0.0042), surf(0.05, 0.0048), surf(-0.16, 0.0056),
      new THREE.Vector3(0.0830, -h * 0.34, 0),
    ], false, 'catmullrom', 0.35);
    const lever = ribbon(curve, 34, 0.0190, 0.0040, new THREE.Vector3(1, 0, 0));
    lever.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(lever.getAttribute('position').count * 2), 2));
    olive.push(lever);
    for (const g of olive) if (!g.getAttribute('uv')) g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(g.getAttribute('position').count * 2), 2));

    // --- pull ring + cotter pin (bare steel)
    const steel: THREE.BufferGeometry[] = [];
    const pin = new THREE.CylinderGeometry(0.0019, 0.0019, 0.0320, 8);
    pin.rotateX(Math.PI / 2); pin.translate(0.0138, yTop + 0.0250, 0); steel.push(pin);
    const ring = new THREE.TorusGeometry(0.0170, 0.0023, 6, 20);
    ring.rotateY(0.30); ring.translate(0.0120, yTop + 0.0115, 0.0185); steel.push(ring);

    return {
      body,
      olive: mergeGeometries(olive, false)!,
      steel: mergeGeometries(steel, false)!,
    };
  }

  private acquireMesh(): THREE.Group {
    const pooled = this.meshPool.pop();
    if (pooled) return pooled;
    if (!this.geo) this.geo = this.buildGeometry();
    if (!this.mats) {
      const t = grenadeTextures(this.engine.assets.anisotropy);
      this.mats = {
        body: new THREE.MeshStandardMaterial({
          map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, aoMap: t.aoMap,
          aoMapIntensity: 0.6, roughness: 1, metalness: 0.1, normalScale: new THREE.Vector2(0.95, 0.95),
        }),
        olive: new THREE.MeshStandardMaterial({ color: 0x7a8358, roughness: 0.46, metalness: 0.15 }),
        steel: new THREE.MeshStandardMaterial({ color: 0x9aa09c, roughness: 0.34, metalness: 0.95 }),
      };
    }
    const grp = new THREE.Group();
    for (const k of ['body', 'olive', 'steel'] as const) {
      const m = new THREE.Mesh(this.geo[k], this.mats[k]);
      m.castShadow = true;
      grp.add(m);
    }
    this.engine.scene.add(grp);
    return grp;
  }

  private safe(fn: () => void): void { try { fn(); } catch (e) { console.error('[grenades]', e); } }
}
