import * as THREE from 'three';
import type RAPIER from '@dimforge/rapier3d-compat';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { AudioApi, HudApi, LevelApi, PlayerApi, WeaponsApi } from './Contracts';
import { CRATE, buildCrateGeometry, crateMaterials, glowMaterial, statusMaterial } from './CrateMesh';
import { PICKUPS } from './GameDefs';
import { t, onLangChange } from '../core/I18n';

interface Crate {
  pos: THREE.Vector3;
  yaw: number;
  /** LED strip + beacon dome (one material per crate so states animate independently). */
  status: THREE.Mesh;
  statusMat: THREE.MeshStandardMaterial;
  /** Additive charge ring drawn over the painted floor marking. */
  glow: THREE.Mesh;
  glowMat: THREE.ShaderMaterial;
  cooldown: number;
  body: RAPIER.RigidBody | null;
  collider: RAPIER.Collider | null;
}

const READY = new THREE.Color(0x74e089);
const SPENT = new THREE.Color(0xff5320);
const READY_GLOW = new THREE.Color(0xffb050);
const SPENT_GLOW = new THREE.Color(0xff6a30);

/**
 * Ammo crates at fixed level positions.
 *
 * The resupply point is signposted the way a modern military shooter does it: a weathered painted
 * floor marking (broken ring + inward chevrons + "AMMO RESUPPLY"), a thin additive charge ring on
 * top of it that doubles as the cooldown readout, and a recessed green LED strip plus a small
 * beacon on the crate itself. No floating gem, nothing spins, nothing bobs. Emissive levels stay
 * under the render module's 1.2 bloom threshold apart from the 16 mm beacon dome.
 *
 * Walk up and press E to refill every weapon's reserve; the crate then cools down for 30 s while
 * the ring fills back around.
 */
export class Pickups implements System {
  name = 'pickups';
  private crates: Crate[] = [];
  private root = new THREE.Group();
  private nearIndex = -1;
  private time = 0;
  private tmp = new THREE.Vector3();
  /** Written by the game mode so the HUD can show the hint. */
  onPrompt: (text: string) => void = () => {};

  constructor(private engine: Engine) {
    // The prompt is only re-published when the nearest crate changes; force one after a language switch.
    onLangChange(() => { this.nearIndex = -2; });
  }

  private get player(): PlayerApi | undefined { return this.engine.get<PlayerApi>('player'); }
  private get weapons(): WeaponsApi | undefined { return this.engine.get<WeaponsApi>('weapons'); }
  private get hud(): HudApi | undefined { return this.engine.get<HudApi>('hud'); }
  private get audio(): AudioApi | undefined { return this.engine.get<AudioApi>('audio'); }

  /** World placement of every crate (poses frame them). */
  placements(): { pos: THREE.Vector3; yaw: number }[] { return this.crates.map((c) => ({ pos: c.pos.clone(), yaw: c.yaw })); }

  /** Place crates: level landmarks named `ammo*` win, else GameDefs.PICKUPS.crates. */
  build(): void {
    const lv = this.engine.get<LevelApi>('level');
    const defs: { x: number; y: number; z: number; yaw: number }[] = [];
    for (const [k, v] of Object.entries(lv?.landmarks ?? {})) if (k.startsWith('ammo')) defs.push({ x: v.position.x, y: v.position.y, z: v.position.z, yaw: v.yaw });
    if (defs.length === 0) defs.push(...PICKUPS.crates);

    // Drop each crate to the ground before anything is built so the instanced transforms are final.
    const placed = defs.map((d) => {
      const pos = new THREE.Vector3(d.x, d.y, d.z);
      try {
        const hit = this.engine.physics.raycast({ x: pos.x, y: pos.y + 3, z: pos.z }, { x: 0, y: -1, z: 0 }, 10, groups(CG.PROJECTILE, CG.WORLD));
        if (hit) pos.y = hit.point[1];
      } catch { /* physics not ready */ }
      return { pos, yaw: d.yaw };
    });
    if (placed.length === 0) return;

    const geo = buildCrateGeometry();
    const mats = crateMaterials(this.engine.assets.anisotropy);
    this.engine.scene.add(this.root);

    // One instanced draw per material for the whole set of crates.
    const m4 = new THREE.Matrix4();
    const shells: [THREE.BufferGeometry, THREE.MeshStandardMaterial][] = [[geo.paint, mats.paint], [geo.metal, mats.metal], [geo.dark, mats.dark]];
    for (const [g, m] of shells) {
      const im = new THREE.InstancedMesh(g, m, placed.length);
      im.castShadow = im.receiveShadow = true;
      placed.forEach((p, i) => { m4.makeRotationY(p.yaw); m4.setPosition(p.pos.x, p.pos.y, p.pos.z); im.setMatrixAt(i, m4); });
      im.instanceMatrix.needsUpdate = true;
      im.computeBoundingSphere();
      this.root.add(im);
    }

    const markGeo = new THREE.PlaneGeometry(CRATE.markSize, CRATE.markSize).rotateX(-Math.PI / 2);
    const glowGeo = new THREE.PlaneGeometry(CRATE.markSize * 1.06, CRATE.markSize * 1.06).rotateX(-Math.PI / 2);

    for (const p of placed) {
      const status = new THREE.Mesh(geo.status, statusMaterial());
      status.position.copy(p.pos); status.rotation.y = p.yaw;
      this.root.add(status);

      const marking = new THREE.Mesh(markGeo, mats.marking);
      marking.position.set(p.pos.x, p.pos.y + 0.012, p.pos.z);
      marking.rotation.y = p.yaw;
      marking.receiveShadow = true; marking.renderOrder = 2;
      this.root.add(marking);

      const glowMat = glowMaterial();
      const glow = new THREE.Mesh(glowGeo, glowMat);
      glow.position.set(p.pos.x, p.pos.y + 0.016, p.pos.z);
      glow.rotation.y = p.yaw;
      glow.renderOrder = 3;
      this.root.add(glow);

      let body: RAPIER.RigidBody | null = null, collider: RAPIER.Collider | null = null;
      try {
        const ph = this.engine.physics; const R = ph.R;
        body = ph.world.createRigidBody(R.RigidBodyDesc.fixed()
          .setTranslation(p.pos.x, p.pos.y + CRATE.top / 2, p.pos.z)
          .setRotation({ x: 0, y: Math.sin(p.yaw / 2), z: 0, w: Math.cos(p.yaw / 2) }));
        collider = ph.world.createCollider(R.ColliderDesc.cuboid(CRATE.w / 2 + 0.02, CRATE.top / 2, CRATE.d / 2 + 0.02).setCollisionGroups(groups(CG.WORLD, CG.ALL)), body);
        ph.tag(collider, { surface: 'metal', tag: 'ammo_crate' });
        // the spare can beside the crate gets its own box so the player can't walk through it
        const c = CRATE.can;
        const cosY = Math.cos(p.yaw), sinY = Math.sin(p.yaw);
        const cb = ph.world.createRigidBody(R.RigidBodyDesc.fixed()
          .setTranslation(p.pos.x + c.dx * cosY + c.dz * sinY, p.pos.y + c.h / 2, p.pos.z - c.dx * sinY + c.dz * cosY)
          .setRotation({ x: 0, y: Math.sin((p.yaw + c.yaw) / 2), z: 0, w: Math.cos((p.yaw + c.yaw) / 2) }));
        ph.tag(ph.world.createCollider(R.ColliderDesc.cuboid(c.w / 2, c.h / 2, c.d / 2).setCollisionGroups(groups(CG.WORLD, CG.ALL)), cb), { surface: 'metal', tag: 'ammo_crate' });
      } catch { /* physics not ready */ }

      this.crates.push({ pos: p.pos.clone(), yaw: p.yaw, status, statusMat: status.material as THREE.MeshStandardMaterial, glow, glowMat, cooldown: 0, body, collider });
    }
  }

  fixedUpdate(dt: number): void {
    this.time += dt;
    const pl = this.player;
    let near = -1;
    for (const c of this.crates) if (c.cooldown > 0) c.cooldown = Math.max(0, c.cooldown - dt);
    for (let i = 0; i < this.crates.length; i++) {
      const c = this.crates[i];
      if (c.cooldown > 0) continue;
      if (pl && pl.alive && pl.position.distanceTo(c.pos) <= PICKUPS.reach) near = i;
    }
    if (near !== this.nearIndex) {
      this.nearIndex = near;
      this.onPrompt(near >= 0 ? t('msg.resupplyPrompt') : '');
      if (near >= 0) this.safe(() => this.hud?.showMessage?.(t('msg.resupplyPrompt'), 1200));
    }
    if (near >= 0 && this.engine.input.state.interact) this.take(this.crates[near]);
  }

  update(dt: number): void {
    void dt;
    const cam = this.engine.camera.position;
    // Gentle 0.5 Hz breathing so the strip reads as powered kit rather than a static decal.
    const breathe = 0.86 + 0.14 * Math.sin(this.time * 3.1);
    for (let i = 0; i < this.crates.length; i++) {
      const c = this.crates[i];
      const ready = c.cooldown <= 0;
      const charge = ready ? 1 : 1 - c.cooldown / PICKUPS.cooldown;
      const d = this.tmp.copy(cam).sub(c.pos).length();

      c.statusMat.emissive.copy(ready ? READY : SPENT);
      // The strip is only 11 mm tall, so at range it needs to push past the 1.2 bloom threshold to
      // survive as a findable glint; up close it stays under it and reads as a plain lit strip.
      const reach = 1.3 + 0.95 * THREE.MathUtils.smoothstep(d, 6, 24);
      c.statusMat.emissiveIntensity = ready ? reach * breathe * (i === this.nearIndex ? 1.12 : 1) : 0.34;

      // The ring fades in with distance so it guides at range and stays out of the way up close.
      const far = THREE.MathUtils.smoothstep(d, 3.5, 15);
      const cull = 1 - THREE.MathUtils.smoothstep(d, 48, 68);
      c.glowMat.uniforms.uAlpha.value = (0.26 + 0.5 * far) * cull;
      c.glowMat.uniforms.uCharge.value = charge;
      c.glowMat.uniforms.uTime.value = this.time;
      (c.glowMat.uniforms.uColor.value as THREE.Color).copy(ready ? READY_GLOW : SPENT_GLOW);
      c.glow.visible = cull > 0.01;
    }
  }

  private take(c: Crate): void {
    const w = this.weapons;
    this.safe(() => {
      if (!w) return;
      const slots = w.slots?.length ? w.slots : (w.current ? [w.current] : []);
      for (const s of slots) if (s) w.addAmmo(s.kind, Math.max(1, (s.magSize || 30) * PICKUPS.magsPerSlot));
    });
    c.cooldown = PICKUPS.cooldown;
    this.safe(() => this.hud?.showMessage?.(t('msg.resupplied'), 1500));
    this.safe(() => this.audio?.play('pickup_ammo', { position: c.pos }));
    this.nearIndex = -1; this.onPrompt('');
  }

  private safe(fn: () => void): void { try { fn(); } catch (e) { console.error('[pickups]', e); } }
}
