import * as THREE from 'three';
import { PartBuilder, decalPlanes, socket, contactShadows, type V3 } from '../Build';
import { countTriangles, type ModelCtx, type WeaponModel, type Clip } from '../Model';

/**
 * M870-style pump shotgun: rounded steel receiver, 18.5" barrel over a mag tube, ribbed pump forend
 * that cycles, loading port, bead front sight, polymer stock with a recoil pad. Shells load one at a time.
 * Origin: bore axis above the grip. Muzzle at -Z.
 */
export function buildShotgun(ctx: ModelCtx): WeaponModel {
  const b = new PartBuilder(ctx.mats);
  const B = 'body';

  // ---- receiver (rounded top), ejection port, loading port, safety
  b.profileZ(B, 'metal', [[-0.021, -0.034], [0.021, -0.034], [0.021, 0.012], [0.016, 0.026], [0.006, 0.033], [-0.006, 0.033], [-0.016, 0.026], [-0.021, 0.012]], 0.20, [0, 0, -0.02], 0.003);
  b.shade(0.3).box(B, 'polymer', [0.005, 0.02, 0.06], [0.0205, 0.0, -0.06], 0.001);
  b.box(B, 'polymer', [0.02, 0.004, 0.06], [0, -0.033, -0.05], 0.001).endShade();
  b.box(B, 'metalDark', [0.026, 0.02, 0.012], [0, -0.03, 0.03], 0.002);
  b.cylX(B, 'metalDark', 0.0045, 0.03, [0, -0.052, 0.045], 10);
  b.cylX(B, 'metalDark', 0.0045, 0.052, [0, -0.005, 0.06], 12);
  b.cylX(B, 'metalDark', 0.0045, 0.052, [0, -0.005, -0.1], 12);
  const sheet = ctx.mats.engravingSheet([{ lines: ['MODEL 870  12 GA', '2 3/4" or 3" SHELLS'], font: 44 }]);
  b.attach(B, decalPlanes([{ w: 0.09, h: 0.028, pos: [-0.0212, -0.005, -0.03], rot: [0, -Math.PI / 2, 0], rect: sheet.rects[0] }], sheet.mat));
  // ---- trigger group, guard, trigger
  b.profileX(B, 'polymer', [[0.07, -0.03], [0.07, -0.055], [-0.02, -0.06], [-0.06, -0.06], [-0.07, -0.034]], 0.036, [0, 0, 0], 0.003);
  b.box(B, 'metalDark', [0.012, 0.004, 0.06], [0, -0.084, 0.0], 0.001);
  b.box(B, 'metalDark', [0.012, 0.028, 0.004], [0, -0.07, -0.03], 0.001);
  b.box(B, 'metalDark', [0.007, 0.022, 0.006], [0, -0.066, 0.0], 0.0015, [0.15, 0, 0]);
  // ---- barrel + mag tube + clamp + bead
  b.cylZ(B, 'metalDark', 0.011, 0.0125, 0.47, [0, 0.012, -0.355], 22);
  b.cylZ(B, 'metalDark', 0.0115, 0.0115, 0.36, [0, -0.018, -0.30], 20);
  b.latheZ(B, 'metalDark', [[0.0115, 0], [0.013, 0.002], [0.013, 0.014], [0.0115, 0.016], [0, 0.016]], [0, -0.018, -0.48], 18);
  b.box(B, 'metalDark', [0.03, 0.05, 0.012], [0, -0.003, -0.44], 0.002);
  b.screw(B, [0.0155, -0.003, -0.44], 'x', 0.003);
  b.cylY(B, 'metalDark', 0.003, 0.004, 0.006, [0, 0.026, -0.575], 10);
  b.add(B, 'brass', new THREE.SphereGeometry(0.0028, 10, 8), [0, 0.0305, -0.575]);
  // rear ghost ring on the receiver
  b.tubeZ(B, 'metalDark', 0.008, 0.006, 0.004, [0, 0.043, 0.02], 16);
  b.box(B, 'metalDark', [0.006, 0.008, 0.008], [0, 0.036, 0.02], 0.001);
  const aim: V3 = [0, 0.0435, 0.02];
  // ---- pump forend (ribbed polymer around the mag tube)
  const P = 'pump';
  b.profileZ(P, 'polymer', [[-0.026, -0.05], [0.026, -0.05], [0.028, -0.01], [0.02, 0.0], [-0.02, 0.0], [-0.028, -0.01]], 0.15, [0, 0, -0.30], 0.004);
  for (let i = 0; i < 9; i++) { const z = -0.24 - i * 0.015; b.box(P, 'polymer', [0.06, 0.004, 0.006], [0, -0.05, z], 0.0008, [0, 0, 0], 1); b.box(P, 'polymer', [0.004, 0.03, 0.006], [0.029, -0.03, z], 0.0008, [0, 0, 0], 1); b.box(P, 'polymer', [0.004, 0.03, 0.006], [-0.029, -0.03, z], 0.0008, [0, 0, 0], 1); }
  b.cylZ(P, 'metalDark', 0.015, 0.015, 0.03, [0, -0.018, -0.215], 18, 0.002);
  // ---- stock (polymer, pistol-grip style) + recoil pad
  b.profileX(B, 'polymer', [[0.07, 0.028], [0.20, 0.03], [0.34, 0.02], [0.35, -0.03], [0.34, -0.09], [0.31, -0.10], [0.22, -0.08], [0.11, -0.145], [0.085, -0.15], [0.065, -0.13], [0.07, -0.07]], 0.04, [0, 0, 0], 0.005);
  b.box(B, 'rubber', [0.042, 0.115, 0.014], [0, -0.038, 0.355], 0.005);
  b.cylX(B, 'metalDark', 0.005, 0.044, [0, -0.02, 0.24], 12);
  // ---- a shell held in the hand during reload (own group)
  b.cylZ('shell', 'red', 0.0095, 0.0095, 0.05, [0, 0, 0], 16, 0.001);
  b.cylZ('shell', 'brass', 0.01, 0.01, 0.012, [0, 0, 0.028], 16, 0.001);

  const groups = b.build();
  const root = new THREE.Group(); root.name = 'm870';
  for (const g of Object.values(groups)) root.add(g);
  groups.shell.visible = false;
  const muzzle = socket('muzzle', [0, 0.012, -0.595]); root.add(muzzle);
  const eject = socket('eject', [0.024, 0.0, -0.06]); root.add(eject);
  const aimS = socket('aim', aim); root.add(aimS);

  // left hand wraps the pump from below-left, thumb along the left rib
  const L0: V3 = [-0.080, -0.082, -0.313];
  const LF: V3 = [0.55, 0.80, -0.24], LB: V3 = [-0.80, 0.42, 0.42], LE: V3 = [-0.62, -0.66, 0.42];
  b.darken(P, [-0.02, -0.04, -0.30], 0.07, 0.4);
  b.darken(B, [0.012, -0.10, 0.075], 0.07, 0.4);
  b.attach(P, contactShadows([
    { pos: [-0.0282, -0.03, -0.30], normal: [-1, 0, 0], radius: 0.028, stretch: 1.5 },
    { pos: [-0.004, -0.0502, -0.31], normal: [0, -1, 0], radius: 0.028, stretch: 1.4 },
  ], ctx.mats.shadow));
  b.attach(B, contactShadows([
    { pos: [0.0202, -0.10, 0.09], normal: [1, 0, 0.1], radius: 0.03, stretch: 1.2 },
    { pos: [-0.0202, -0.105, 0.08], normal: [-1, 0, 0.1], radius: 0.028, stretch: 1.2 },
  ], ctx.mats.shadow));
  // pump cycle after each shot: hand + forend back, shell out, forward
  const cycle: Clip = {
    duration: 0.72,
    gunRot: [[0, [0, 0, 0]], [0.22, [0.04, -0.02, -0.06]], [0.45, [-0.02, 0.01, 0.03]], [0.72, [0, 0, 0]]],
    gunPos: [[0, [0, 0, 0]], [0.22, [0.0, 0.0, 0.015]], [0.45, [0, 0, -0.005]], [0.72, [0, 0, 0]]],
    left: { pos: [[0.05, L0], [0.25, [L0[0], L0[1], L0[2] + 0.085]], [0.45, L0]], fingers: [[0, LF]], back: [[0, LB]], elbow: [[0, LE]], pose: [[0, 'pump']] },
    parts: { pump: [[0.05, 0], [0.25, 1], [0.45, 0]] },
    events: [{ t: 0.2, sound: 'pump' }, { t: 0.22, action: 'shell' }, { t: 0.42, sound: 'pump_fwd' }],
  };
  // one shell per clip
  const reload: Clip = {
    duration: 0.62,
    gunRot: [[0, [0, 0, 0]], [0.2, [0.12, 0.2, 0.4]], [0.5, [0.12, 0.2, 0.4]], [0.62, [0.1, 0.18, 0.35]]],
    gunPos: [[0, [0, 0, 0]], [0.2, [-0.04, 0.04, 0.03]], [0.62, [-0.04, 0.04, 0.03]]],
    left: {
      pos: [[0, [-0.05, -0.18, -0.02]], [0.3, [-0.03, -0.09, -0.06]], [0.42, [-0.03, -0.085, -0.055]], [0.62, [-0.05, -0.18, -0.02]]],
      fingers: [[0, [0.6, 0.9, -0.3]], [0.3, [0.4, 1, -0.2]], [0.62, [0.6, 0.9, -0.3]]],
      back: [[0, [-1, 0.2, 0]], [0.62, [-1, 0.2, 0]]],
      elbow: [[0, [-0.4, -1, 0.5]], [0.62, [-0.4, -1, 0.5]]],
      pose: [[0, 'pinch'], [0.45, 'open'], [0.55, 'pinch']],
    },
    parts: { shell: [[0, 0], [0.3, 0.8], [0.42, 1.0]] },
    magVisible: [[0, 1]],
    events: [{ t: 0.05, action: 'magOut' }, { t: 0.4, sound: 'reload_shell', action: 'magIn' }],
  };
  const inspect: Clip = {
    duration: 4.2,
    gunPos: [[0, [0, 0, 0]], [0.8, [-0.06, 0.0, 0.03]], [2.0, [-0.05, 0.01, 0.03]], [2.8, [0.02, -0.02, 0.04]], [3.6, [0.02, -0.02, 0.04]], [4.2, [0, 0, 0]]],
    gunRot: [[0, [0, 0, 0]], [0.8, [0.15, 0.9, 0.4]], [2.0, [0.05, 1.05, 0.45]], [2.8, [-0.25, -0.7, -0.5]], [3.6, [-0.2, -0.8, -0.55]], [4.2, [0, 0, 0]]],
    left: { pos: [[0, L0], [1.2, [L0[0], L0[1], L0[2] + 0.085]], [1.6, L0]], fingers: [[0, LF]], back: [[0, LB]], elbow: [[0, LE]], pose: [[0, 'pump']] },
    parts: { pump: [[1.0, 0], [1.2, 1], [1.6, 0]] },
    events: [{ t: 1.15, sound: 'pump' }, { t: 1.5, sound: 'pump_fwd' }],
  };
  const melee: Clip = {
    duration: 0.8,
    gunPos: [[0, [0, 0, 0]], [0.14, [0.06, 0.02, 0.12]], [0.32, [-0.12, -0.06, -0.16]], [0.8, [0, 0, 0]]],
    gunRot: [[0, [0, 0, 0]], [0.14, [0.25, 0.5, 0.2]], [0.32, [-0.35, -0.9, -0.6]], [0.8, [0, 0, 0]]],
    events: [{ t: 0.3, action: 'hit' }],
  };
  const draw: Clip = { duration: 0.5, gunPos: [[0, [0.05, -0.3, 0.05]], [0.5, [0, 0, 0]]], gunRot: [[0, [0.9, -0.3, 0.4]], [0.5, [0, 0, 0]]] };

  return {
    root, groups,
    sockets: { muzzle, eject, aim: aimS },
    ejectDir: [1, 0.6, 0.1],
    parts: {
      pump: { obj: groups.pump, pos: [0, 0, 0.085] },
      shell: { obj: groups.shell, pos: [0, 0, 0] },
    },
    hands: {
      right: { pos: [0.044, -0.082, 0.132], fingers: [-0.25, -0.4, -0.88], back: [0.95, -0.05, 0.3], elbow: [0.30, -0.92, 0.26], pose: 'grip', contact: 'grip' },
      left: { pos: L0, fingers: LF, back: LB, elbow: LE, pose: 'pump', contact: 'pump' },
    },
    // The forend is the ribbed polymer sleeve (x +-0.028, y -0.05..0) around the mag tube, z -0.375..-0.225.
    // It travels 85 mm on the pump stroke, so its solid follows the `pump` part. The grip is the
    // pistol-grip section of the stock, (z 0.075, y -0.075) to (z 0.098, y -0.142), 40 mm across.
    grips: {
      pump: { a: [0, -0.026, -0.362], b: [0, -0.026, -0.238], hw: 0.0275, hh: 0.0245, r: 0.0180, part: 'pump' },
      grip: { a: [0, -0.078, 0.076], b: [0, -0.142, 0.098], hw: 0.0200, hh: 0.0250, r: 0.0180, skip: ['index'] },
    },
    clips: { reload, reloadEmpty: reload, cycle, inspect, melee, draw },
    firePose: 'gripFire',
    muzzleLightPos: [0, 0.02, -0.62],
    roundsPerReload: 1,
    triangles: countTriangles(root),
  };
}
