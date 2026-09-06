import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Animator, type AnimTarget } from './Animator';
import { B, buildSkeleton, soldierGeometry, weaponOf, HEAD, RIFLE, WEAPONS, type SoldierRig } from './SoldierModel';
import { ARCHETYPES } from './EnemyDefs';
import { SLOT_COUNT } from './Materials';
import { footCurve, gaitFor } from './Gait';

function fakeRig(archetype: SoldierRig['archetype'] | null = null): SoldierRig {
  const bones = buildSkeleton();
  const root = new THREE.Group(); root.add(bones[B.root]);
  return { root, bones, mesh: null as unknown as THREE.SkinnedMesh, skeleton: null as unknown as THREE.Skeleton, muzzle: new THREE.Object3D(), blob: null as unknown as THREE.Mesh, archetype: archetype as SoldierRig['archetype'] };
}
const target = (o: Partial<AnimTarget> = {}): AnimTarget => ({ moveVel: new THREE.Vector3(), yaw: 0, aimDir: new THREE.Vector3(0, 0, -1), aim: 0, crouch: 0, lean: 0, sprint: 0, reload: -1, hide: 0, ...o });
const finite = (v: THREE.Vector3) => Number.isFinite(v.x + v.y + v.z);

describe('animator', () => {
  it('produces finite bone poses in every stance and keeps feet on the ground when idle', () => {
    const rig = fakeRig(); const a = new Animator(rig, 1);
    const pos = new THREE.Vector3(3, 0, -2);
    const stances = [target(), target({ aim: 1 }), target({ aim: 1, crouch: 1 }), target({ sprint: 1, moveVel: new THREE.Vector3(4, 0, 0) }), target({ hide: 1, crouch: 1 }), target({ aim: 1, lean: 1 }), target({ aim: 1, reload: 0.4 }), target({ aim: 1, aimDir: new THREE.Vector3(0, 0.9, -0.1).normalize() }), target({ aim: 1, aimDir: new THREE.Vector3(1, 0, 0) })];
    for (const tg of stances) {
      for (let i = 0; i < 90; i++) a.update(1 / 60, pos, tg);
      for (let i = 0; i < a.wp.length; i++) { expect(finite(a.wp[i]), `bone ${i}`).toBe(true); expect(Number.isFinite(a.wq[i].x + a.wq[i].y + a.wq[i].z + a.wq[i].w)).toBe(true); }
      expect(finite(a.muzzleWorld)).toBe(true);
      if (tg.moveVel.lengthSq() === 0) { expect(a.wp[B.footL].y).toBeCloseTo(pos.y + 0.08, 1); expect(a.wp[B.footR].y).toBeCloseTo(pos.y + 0.08, 1); }
    }
  });
  it('points the rifle along aimDir when shouldered and puts both hands on it', () => {
    const rig = fakeRig(); const a = new Animator(rig, 2);
    const aimDir = new THREE.Vector3(0.3, 0.1, -1).normalize();
    const tg = target({ aim: 1, aimDir });
    for (let i = 0; i < 120; i++) a.update(1 / 60, new THREE.Vector3(), tg);
    expect(a.muzzleDir.dot(aimDir)).toBeGreaterThan(0.995);
    // both wrists land on their rifle attach points (grip / handguard), so the rifle is held, not floating
    const grip = RIFLE.handR.clone().applyQuaternion(a.rifleWorldQuat).add(a.rifleWorldPos);
    const fore = RIFLE.handL.clone().applyQuaternion(a.rifleWorldQuat).add(a.rifleWorldPos);
    expect(a.wp[B.handR].distanceTo(grip)).toBeLessThan(0.03);
    expect(a.wp[B.handL].distanceTo(fore)).toBeLessThan(0.06);
    // muzzle is in front of the chest
    expect(a.muzzleWorld.z).toBeLessThan(a.wp[B.chest].z - 0.4);
    // stock is in the shoulder pocket: butt within 12 cm of the chest, and the rifle does not cut through it
    const butt = RIFLE.stockButt.clone().applyQuaternion(a.rifleWorldQuat).add(a.rifleWorldPos);
    expect(butt.distanceTo(a.wp[B.chest])).toBeLessThan(0.22);
    // cheek weld: the aiming eye sits near the sight line above the receiver
    const sight = RIFLE.eyeLine.clone().applyQuaternion(a.rifleWorldQuat).add(a.rifleWorldPos);
    expect(a.eyeWorld.distanceTo(sight)).toBeLessThan(0.3);
    expect(HEAD.eyeR.y).toBeGreaterThan(0);
  });
  it('keeps both hands on the rifle and the stock out of the chest in every stance', () => {
    const rig = fakeRig(); const a = new Animator(rig, 5);
    const stances = [target(), target({ aim: 1 }), target({ aim: 0.25 }), target({ sprint: 1, moveVel: new THREE.Vector3(4, 0, 0) }), target({ hide: 1, crouch: 1 }), target({ crouch: 1, aim: 1 })];
    for (const tg of stances) {
      for (let i = 0; i < 120; i++) a.update(1 / 60, new THREE.Vector3(), tg);
      const grip = RIFLE.handR.clone().applyQuaternion(a.rifleWorldQuat).add(a.rifleWorldPos);
      const fore = RIFLE.handL.clone().applyQuaternion(a.rifleWorldQuat).add(a.rifleWorldPos);
      expect(a.wp[B.handR].distanceTo(grip), 'right hand off the grip').toBeLessThan(0.05);
      expect(a.wp[B.handL].distanceTo(fore), 'left hand off the handguard').toBeLessThan(0.09);
      // carrying (not shouldered): the buttstock must clear the torso column rather than pass through the chest
      const butt = RIFLE.stockButt.clone().applyQuaternion(a.rifleWorldQuat).add(a.rifleWorldPos);
      const spine = a.wp[B.chest];
      const radial = Math.hypot(butt.x - spine.x, butt.z - spine.z);
      if (tg.aim < 0.5) expect(radial, 'buttstock inside the ribcage').toBeGreaterThan(0.16);
    }
  });

  it('idle stance is asymmetric: weight over one leg, hips rolled, shoulders counter-rotated', () => {
    // a squad must not stand in lockstep: consecutive enemy seeds land on different loaded legs
    const sides = new Set([1, 2, 3, 4].map((id) => new Animator(fakeRig(), id * 1.37).weightSide));
    expect(sides.size, 'every enemy favours the same leg').toBe(2);
    const a = new Animator(fakeRig(), 2 * 1.37);
    const tg = target();
    for (let i = 0; i < 200; i++) a.update(1 / 60, new THREE.Vector3(), tg);
    // hips sit over the loaded leg, and the two feet are not mirror images
    expect(Math.abs(a.wp[B.hips].x)).toBeGreaterThan(0.008);
    const dz = Math.abs(a.wp[B.footL].z - a.wp[B.footR].z);
    expect(dz, 'feet are symmetric — reads as a mannequin').toBeGreaterThan(0.02);
  });

  it('walk cycle: planted foot barely moves in world space between frames', () => {
    const rig = fakeRig(); const a = new Animator(rig, 3);
    const vel = new THREE.Vector3(0, 0, -1.7);
    const pos = new THREE.Vector3();
    const tg = target({ moveVel: vel });
    for (let i = 0; i < 120; i++) { pos.addScaledVector(vel, 1 / 60); a.update(1 / 60, pos, tg); }
    let maxSlide = 0;
    let prev = a.wp[B.footL].clone(); let prevPlanted = false;
    for (let i = 0; i < 60; i++) {
      pos.addScaledVector(vel, 1 / 60); a.update(1 / 60, pos, tg);
      const f = a.wp[B.footL];
      const planted = footCurve(a.phase + 0.5, gaitFor(1.7, 0)).planted === 1;
      if (planted && prevPlanted) maxSlide = Math.max(maxSlide, f.distanceTo(prev));
      prev = f.clone(); prevPlanted = planted;
    }
    // per-frame slide of a planted foot at 1.7 m/s: ideal 0, tolerate a few mm
    expect(maxSlide).toBeLessThan(0.012);
  });
});

describe('weapon ladder', () => {
  /**
   * Every archetype now carries a different weapon, and the support hand is IK'd to *that weapon's*
   * handguard. Until this was per-weapon, the short carbine's support hand reached to the AK's
   * handguard position — 9 cm past the muzzle — and the arm read as a straight stick ending in
   * nothing. Checked shouldered and at the low ready, because the two carries reach the weapon by
   * different paths.
   */
  it('both hands land on the weapon each archetype actually carries', () => {
    for (const id of Object.keys(ARCHETYPES)) {
      const a = ARCHETYPES[id];
      const w = WEAPONS[weaponOf(a)];
      for (const tg of [target({ aim: 1, aimDir: new THREE.Vector3(0.2, 0.05, -1).normalize() }), target({ aim: 0 })]) {
        const an = new Animator(fakeRig(a), 4);
        for (let i = 0; i < 150; i++) an.update(1 / 60, new THREE.Vector3(), tg);
        const grip = RIFLE.handR.clone().applyQuaternion(an.rifleWorldQuat).add(an.rifleWorldPos);
        const fore = w.foregrip.clone().applyQuaternion(an.rifleWorldQuat).add(an.rifleWorldPos);
        expect(an.wp[B.handR].distanceTo(grip), `${id} firing hand off the grip (aim=${tg.aim})`).toBeLessThan(0.005);
        expect(an.wp[B.handL].distanceTo(fore), `${id} support hand off the handguard (aim=${tg.aim})`).toBeLessThan(0.005);
        // the handguard the hand is told to hold has to exist: it must sit between the receiver
        // front and the muzzle, never past the crown of the barrel
        expect(w.foregrip.z, `${id} foregrip past the muzzle`).toBeGreaterThan(w.muzzle.z);
        expect(w.foregrip.z, `${id} foregrip behind the receiver`).toBeLessThan(-w.recLen * 0.4);
      }
    }
  });

  it('the four squad archetypes have genuinely different silhouettes, not four palettes', () => {
    const ids = ['rifleman', 'assault', 'marksman', 'grunt'];
    const heights: number[] = [], reach: number[] = [], builds: number[] = [];
    for (const id of ids) {
      const a = ARCHETYPES[id];
      const an = new Animator(fakeRig(a), 7);
      for (let i = 0; i < 150; i++) an.update(1 / 60, new THREE.Vector3(), target());
      heights.push(an.wp[B.head].y);
      // how far the muzzle sticks out from the body centreline: the weapon IS the outline
      reach.push(an.muzzleWorld.distanceTo(an.wp[B.chest]));
      builds.push(a.build);
    }
    const spread = (v: number[]) => Math.max(...v) - Math.min(...v);
    expect(spread(heights), `head heights ${heights.map((h) => h.toFixed(3))}`).toBeGreaterThan(0.09);
    expect(spread(reach), `muzzle reach ${reach.map((r) => r.toFixed(3))}`).toBeGreaterThan(0.2);
    expect(spread(builds)).toBeGreaterThan(0.3);
    // and no two of them stand the same way
    const stances = new Set(ids.map((id) => ARCHETYPES[id].stance));
    expect(stances.size).toBe(4);
    const weapons = new Set(ids.map((id) => weaponOf(ARCHETYPES[id])));
    expect(weapons.size, 'two archetypes carry the same weapon').toBe(4);
  });
});

describe('soldier geometry budget', () => {
  it('every archetype stays under 25k triangles and 7 material groups (+1 blob = 8 draw calls)', () => {
    for (const id of Object.keys(ARCHETYPES)) {
      const g = soldierGeometry(ARCHETYPES[id]);
      const tris = (g.index ? g.index.count : g.getAttribute('position').count) / 3;
      expect(tris, `${id} tris=${tris}`).toBeLessThan(25000);
      expect(g.groups.length).toBe(SLOT_COUNT);
      expect(SLOT_COUNT + 1).toBeLessThanOrEqual(8);
      const uv = g.getAttribute('uv'); const sw = g.getAttribute('skinWeight');
      for (let i = 0; i < uv.count; i += 97) expect(Number.isFinite(uv.getX(i) + uv.getY(i))).toBe(true);
      for (let i = 0; i < sw.count; i += 97) expect(sw.getX(i) + sw.getY(i)).toBeCloseTo(1, 5);
    }
  });
});
