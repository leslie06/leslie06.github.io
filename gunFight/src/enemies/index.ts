import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { registerPose } from '../debug/Poses';
import type { PlayerApi } from '../game/Contracts';
import { EnemySystem } from './EnemySystem';
import { materialsFor } from './Materials';

/** Entry point for the enemies module. Called from main.ts after level + sky are loaded and the player is initialized. */
export async function install(engine: Engine): Promise<void> {
  const sys = new EnemySystem(engine);
  engine.add(sys);
  // build shared textures/materials now so the first spawn doesn't stall the frame
  for (const a of ['rifleman', 'assault', 'marksman', 'grunt']) materialsFor(engine, a);
  (window as unknown as { __enemies?: EnemySystem }).__enemies = sys;

  const player = () => engine.get<PlayerApi>('player')!;
  const fwd = (yaw: number) => new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
  const right = (yaw: number) => new THREE.Vector3(Math.cos(yaw), 0, -Math.sin(yaw));
  /** Open ground north of the arena centre, looking north (-Z). */
  const stage = () => ({ pos: new THREE.Vector3(-4, 1, 24), yaw: 0.0 });

  /** Body yaw that makes an enemy at `from` face `to` (optionally rotated for a three-quarter view). */
  const yawToward = (from: THREE.Vector3, to: THREE.Vector3, offset = 0) => {
    const d = new THREE.Vector3().subVectors(to, from);
    return Math.atan2(-d.x, -d.z) + offset;
  };

  /**
   * Spawn an enemy that ignores its brain and holds a scripted pose. The archetype is always named:
   * spawn() otherwise cycles by enemy id, so which soldier a pose showed depended on how many had
   * been spawned earlier in the run and the frames were not comparable between rounds.
   */
  const scripted = (pos: THREE.Vector3, yaw: number, edit: (e: ReturnType<EnemySystem['get']> & object) => void, archetype = 'rifleman') => {
    const id = sys.spawn(pos, { archetype });
    const e = sys.get(id)!;
    e.brain.scripted = true;
    e.face(yaw);
    e.target.yaw = yaw;
    e.target.aimDir.copy(fwd(yaw));
    edit(e);
    e.anim.snap(e.pos, e.target);
    e.syncHitboxes(true);
    return e;
  };

  registerPose({
    name: 'enemy_closeup', description: 'One soldier 2.5m in front of the camera, idle-aiming, to judge the model', settleFrames: 30, animateFrames: 20,
    apply: () => {
      sys.killAll();
      const s = stage(); const p = player();
      p.teleport(s.pos, s.yaw, -0.09);
      const ep = s.pos.clone().addScaledVector(fwd(s.yaw), 2.5).addScaledVector(right(s.yaw), -0.55); ep.y = 0;
      // aim past the camera's left shoulder so the rifle reads in three-quarter view
      const lookAt = s.pos.clone().add(new THREE.Vector3(0, 0.6, 0)).addScaledVector(right(s.yaw), 1.6).addScaledVector(fwd(s.yaw), -1.0);
      const eyeDir = new THREE.Vector3().subVectors(lookAt, ep.clone().setY(1.5)).normalize();
      scripted(ep, yawToward(ep, s.pos, -0.5), (e) => { e.target.aim = 0.85; e.target.aimDir.copy(eyeDir); }, 'rifleman');
    },
  });

  registerPose({
    name: 'enemy_face', description: 'Head and shoulders at 1.1m to judge the face, helmet and gear', settleFrames: 30, animateFrames: 10,
    apply: () => {
      sys.killAll();
      const s = stage(); const p = player();
      // sit the head left of frame centre: the first-person viewmodel owns the centre-right of the screen
      const ep = s.pos.clone().addScaledVector(fwd(s.yaw), 1.2).addScaledVector(right(s.yaw), -0.18); ep.y = 0;
      p.teleport(s.pos, yawToward(s.pos, ep) - 0.12, 0.1);
      // face the camera in a slight three-quarter, rifle held low so nothing crosses the face
      // three-quarter turned toward open frame (away from the viewmodel), eyes past the lens
      const lookAt = s.pos.clone().add(new THREE.Vector3(0, 0.7, 0)).addScaledVector(right(s.yaw), -0.7);
      const dir = new THREE.Vector3().subVectors(lookAt, ep.clone().setY(1.55)).normalize();
      // an open-face mask under a helmet: this pose exists to judge a face, so nothing may cover it
      scripted(ep, yawToward(ep, s.pos, -0.3), (e) => { e.target.aim = 0; e.target.aimDir.copy(dir); }, 'shotgunner');
    },
  });

  registerPose({
    name: 'enemy_squad', description: 'Four soldiers at 6-15m: running, crouched in cover, firing, low-ready', settleFrames: 24, animateFrames: 36,
    apply: () => {
      sys.killAll();
      const s = stage(); const p = player();
      p.teleport(s.pos, s.yaw, -0.03);
      const f = fwd(s.yaw), r = right(s.yaw);
      const eye = s.pos.clone().add(new THREE.Vector3(0, 0.78, 0));
      const aimAtCam = (from: THREE.Vector3) => new THREE.Vector3().subVectors(eye, from.clone().setY(1.45)).normalize();
      // running across, left to right, 7m out
      const a = s.pos.clone().addScaledVector(f, 7).addScaledVector(r, -3); a.y = 0;
      const runYaw = Math.atan2(-r.x, -r.z);
      // jogging, not sprinting: the full sprint pose reads as a fencing lunge from the side
      scripted(a, runYaw, (e) => { e.target.sprint = 0; e.target.aim = 0.55; e.vel.copy(r).multiplyScalar(0.95); e.target.moveVel.copy(e.vel); e.desiredVel.copy(e.vel); e.speedCap = 1.1; e.target.aimDir.copy(r).addScaledVector(f, -0.5).normalize(); }, 'marksman');
      // crouched behind the low wall at (0,0.5,4) — from the stage that's ~20m; use a nearer crouch instead
      const b = s.pos.clone().addScaledVector(f, 9).addScaledVector(r, 1.5); b.y = 0;
      scripted(b, s.yaw + Math.PI, (e) => { e.target.crouch = 1; e.target.hide = 0.8; e.target.aim = 0; e.target.aimDir.copy(aimAtCam(b)); }, 'assault');
      // firing at the camera, 6m
      const c = s.pos.clone().addScaledVector(f, 6).addScaledVector(r, 3.2); c.y = 0;
      scripted(c, s.yaw + Math.PI + 0.3, (e) => { e.target.aim = 1; e.target.aimDir.copy(aimAtCam(c)); }, 'grunt');
      // walking toward the camera at 14m, low ready
      const d = s.pos.clone().addScaledVector(f, 14).addScaledVector(r, -0.5); d.y = 0;
      const towardYaw = s.yaw + Math.PI;
      scripted(d, towardYaw, (e) => { e.target.aim = 0.2; const v = f.clone().multiplyScalar(-1.6); e.vel.copy(v); e.target.moveVel.copy(v); e.desiredVel.copy(v); e.speedCap = 1.7; e.target.aimDir.copy(f).negate(); }, 'rifleman');
      // keep them animating during animateFrames: velocities are re-applied each tick by the scripted hook
      for (const e of sys.enemies) { const v = e.desiredVel.clone(); const sc = e.speedCap; (e as unknown as { _hold: () => void })._hold = () => { e.desiredVel.copy(v); e.speedCap = sc; }; }
      holdVelocities(sys);
    },
  });

  registerPose({
    name: 'enemy_head', description: 'Head and hands at 0.75m: face under the helmet, grip on the rifle', settleFrames: 30, animateFrames: 10,
    apply: () => {
      sys.killAll();
      const s = stage(); const p = player();
      p.teleport(s.pos, s.yaw, 0.02);
      const ep = s.pos.clone().addScaledVector(fwd(s.yaw), 1.05).addScaledVector(right(s.yaw), 0.12); ep.y = 0;
      // three-quarter front: shouldered, aiming across the frame so the face, cheek weld and both hands read
      const dir = right(s.yaw).clone().multiplyScalar(-1).addScaledVector(fwd(s.yaw), -0.55).normalize();
      scripted(ep, yawToward(ep, s.pos, 0.5), (e) => { e.target.aim = 1; e.target.aimDir.copy(dir); }, 'assault');
    },
  });

  registerPose({
    name: 'enemy_variants', description: 'The four archetypes side by side at 5m to check squad variety', settleFrames: 30, animateFrames: 10,
    apply: () => {
      sys.killAll();
      const s = stage(); const p = player();
      // yawed left and pulled back: at the old spacing the third soldier sat behind the receiver
      p.teleport(s.pos, s.yaw - 0.19, -0.04);
      const f = fwd(s.yaw), r = right(s.yaw);
      const eye = s.pos.clone().add(new THREE.Vector3(0, 0.78, 0));
      const kinds = ['rifleman', 'assault', 'marksman', 'grunt'];
      // Deliberately NO per-soldier pose overrides. Round 3's lineup put one man at ADS, one at
      // low-ready and one in a crouch, so what the frame showed was the *script's* variety, not the
      // ladder's — and the critic correctly called the archetypes recolours. Every soldier here now
      // stands in his own idle: whatever separates them (height, build, ruck, weapon, resting
      // stance) is the only thing that can be separating them.
      kinds.forEach((kind, i) => {
        const at = s.pos.clone().addScaledVector(f, 6.2).addScaledVector(r, (i - 1.5) * 1.5 - 0.45); at.y = 0;
        const id = sys.spawn(at, { archetype: kind });
        const e = sys.get(id)!;
        e.brain.scripted = true;
        const yaw = yawToward(at, s.pos, (i - 1.5) * 0.22);
        e.face(yaw); e.target.yaw = yaw;
        e.target.aim = 0; e.target.crouch = 0; e.target.hide = 0;
        e.target.aimDir.subVectors(eye, at.clone().setY(1.45)).normalize();
        e.anim.snap(e.pos, e.target);
        e.syncHitboxes(true);
      });
    },
  });

  // Ragdolls are checked across the whole fall, not at one instant: `enemy_ragdoll` is the settled
  // corpse (the frame that ends up in a screenshot, and the one ref_03 shows — a flat low mass of
  // gear on the road), with two extra poses catching the collapse and the impact.
  const ragdollPose = (name: string, frames: number, desc: string) => registerPose({
    name, description: desc, settleFrames: 12, animateFrames: frames,
    apply: () => {
      sys.killAll();
      const s = stage(); const p = player();
      // left of frame centre and close: the first-person viewmodel owns the centre-right, and a
      // corpse hidden behind the receiver — or 5 m away — is not a corpse anyone can judge
      p.teleport(s.pos, s.yaw - 0.22, -0.3);
      const f = fwd(s.yaw);
      const ep = s.pos.clone().addScaledVector(f, 3.0).addScaledVector(right(s.yaw), -0.85); ep.y = 0;
      // Face across the camera, not straight at it: shot from the front the body falls directly
      // away and the corpse is seen end-on down its own axis — the least readable angle there is,
      // and the reason the head sat in the shadow of the plate carrier in round 3. Turned 70 deg
      // the same death lays the body across the frame, head at one end, boots at the other.
      const e = scripted(ep, s.yaw + Math.PI - 1.25, (en) => { en.target.aim = 1; }, 'rifleman');
      // die from a chest shot coming from the camera
      const dir = f.clone(); dir.y = -0.1; dir.normalize();
      const point = e.anim.wp[4].clone();
      e.applyDamage(500, point, dir.clone().negate(), dir, 'torso');
    },
  });
  ragdollPose('enemy_ragdoll', 168, 'Soldier shot in the chest, settled corpse ~2.8s after the hit');
  ragdollPose('enemy_ragdoll_fall', 22, 'Same death 0.37s in: the collapse');
  ragdollPose('enemy_ragdoll_impact', 60, 'Same death 1.0s in: the body hitting the road');

  registerPose({
    name: 'enemy_firing', description: 'Soldier firing a burst at the camera from 5m, muzzle flash visible', settleFrames: 2, animateFrames: 14,
    apply: () => {
      sys.killAll();
      const s = stage(); const p = player();
      p.teleport(s.pos, s.yaw, -0.03);
      const f = fwd(s.yaw);
      const ep = s.pos.clone().addScaledVector(f, 5).addScaledVector(right(s.yaw), 0.8); ep.y = 0;
      const eye = s.pos.clone().add(new THREE.Vector3(0, 0.78, 0));
      const e = scripted(ep, s.yaw + Math.PI + 0.15, (en) => { en.target.aim = 1; en.target.aimDir.subVectors(eye, ep.clone().setY(1.45)).normalize(); }, 'rifleman');
      // script: fire a burst every tick during animateFrames
      const target = eye.clone().sub(new THREE.Vector3(0, 0.25, 0));
      (e as unknown as { _hold: () => void })._hold = () => { e.target.aimDir.subVectors(target, e.anim.muzzleWorld).normalize(); e.fireAt(target, 1 / 60, 30, false); e.burstPause = 0; };
      holdVelocities(sys);
    },
  });
}

/** Poses install a per-enemy `_hold` hook that re-asserts scripted intent every fixed tick. */
function holdVelocities(sys: EnemySystem): void {
  for (const e of sys.enemies) {
    const hold = (e as unknown as { _hold?: () => void })._hold;
    if (!hold) continue;
    const orig = e.brain.think.bind(e.brain);
    e.brain.think = (dt: number) => { orig(dt); hold(); };
  }
}
