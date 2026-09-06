import * as THREE from 'three';
import { PartBuilder, decalPlanes, socket, contactShadows, type V3 } from '../Build';
import { countTriangles, type ModelCtx, type WeaponModel, type Clip } from '../Model';

/**
 * MP5-style SMG: tubular receiver, cocking tube with the famous slap-able handle, slim ribbed handguard,
 * tri-lug muzzle, drum rear sight + hooded front post, curved 30-rd steel mag, collapsible stock.
 * Origin: bore axis above the pistol grip. Muzzle at -Z.
 */
export function buildSmg(ctx: ModelCtx): WeaponModel {
  const b = new PartBuilder(ctx.mats);
  const B = 'body';

  // ---- receiver (upper tube + flat lower box), rear cap, ejection port
  b.cylZ(B, 'metal', 0.0205, 0.0205, 0.29, [0, 0.0, -0.06], 26, 0.002);
  b.profileX(B, 'metal', [[0.085, -0.02], [0.085, -0.045], [-0.07, -0.05], [-0.075, -0.02]], 0.042, [0, 0, 0], 0.003);
  b.cylZ(B, 'metalDark', 0.021, 0.021, 0.02, [0, 0, 0.095], 24, 0.002);
  b.shade(0.3).box(B, 'polymer', [0.005, 0.016, 0.05], [0.0205, 0.002, -0.03], 0.001).endShade();
  b.box(B, 'metalDark', [0.006, 0.02, 0.016], [0.021, 0.0, 0.0], 0.002, [0, 0.5, 0]);
  // ---- cocking tube + handle (locks back on empty; the HK slap)
  b.cylZ(B, 'metal', 0.0125, 0.0125, 0.20, [0, 0.026, -0.19], 20, 0.0015);
  b.cylZ(B, 'metalDark', 0.0145, 0.0145, 0.018, [0, 0.026, -0.10], 18, 0.0015);
  b.box('charge', 'metalDark', [0.034, 0.012, 0.014], [-0.018, 0.026, -0.215], 0.002, [0, 0, 0.25]);
  b.cylX('charge', 'metalDark', 0.007, 0.012, [-0.038, 0.03, -0.215], 12);
  // ---- handguard (slim, ribbed polymer)
  b.profileX(B, 'polymer', [[-0.075, 0.012], [-0.075, -0.045], [-0.24, -0.038], [-0.245, 0.005]], 0.046, [0, 0, 0], 0.004);
  for (let i = 0; i < 7; i++) { const z = -0.10 - i * 0.02; b.box(B, 'polymer', [0.049, 0.004, 0.006], [0, -0.045, z], 0.0008, [0, 0, 0], 1); b.box(B, 'polymer', [0.004, 0.03, 0.006], [0.024, -0.02, z], 0.0008, [0, 0, 0], 1); b.box(B, 'polymer', [0.004, 0.03, 0.006], [-0.024, -0.02, z], 0.0008, [0, 0, 0], 1); }
  // ---- barrel + tri-lug muzzle
  b.cylZ(B, 'metalDark', 0.0085, 0.0085, 0.10, [0, 0, -0.30], 18);
  b.latheZ(B, 'metalDark', [[0.0085, 0], [0.012, 0.004], [0.012, 0.018], [0.0105, 0.02], [0.0105, 0.03], [0.006, 0.03], [0.006, 0]], [0, 0, -0.325], 18);
  for (let i = 0; i < 3; i++) { const a = (i / 3) * Math.PI * 2 + Math.PI / 2; b.box(B, 'metalDark', [0.008, 0.005, 0.014], [Math.cos(a) * 0.013, Math.sin(a) * 0.013, -0.335], 0.001, [0, 0, a]); }
  // ---- sights: hooded front post, drum rear
  b.tubeZ(B, 'metalDark', 0.0135, 0.0115, 0.016, [0, 0.044, -0.30], 20);
  b.box(B, 'metalDark', [0.0022, 0.012, 0.0022], [0, 0.038, -0.30], 0.0005, [0, 0, 0], 1);
  b.box(B, 'metalDark', [0.022, 0.012, 0.02], [0, 0.028, -0.30], 0.002);
  b.cylZ(B, 'metalDark', 0.0125, 0.0125, 0.022, [0, 0.042, 0.03], 20, 0.002);
  b.box(B, 'metalDark', [0.026, 0.014, 0.024], [0, 0.025, 0.03], 0.002);
  b.box(B, 'metalDark', [0.012, 0.012, 0.006], [0, 0.046, 0.042], 0.001);
  b.screw(B, [0.0135, 0.042, 0.03], 'x', 0.003);
  const aim: V3 = [0, 0.0445, 0.03];
  // ---- lower: trigger group housing, trigger guard, trigger, selector, grip
  b.profileX(B, 'polymer', [[0.09, -0.04], [0.09, -0.06], [0.005, -0.06], [-0.005, -0.08], [-0.07, -0.08], [-0.075, -0.05], [-0.07, -0.04]], 0.038, [0, 0, 0], 0.003);
  b.box(B, 'metalDark', [0.012, 0.004, 0.05], [0, -0.092, -0.02], 0.001);
  b.box(B, 'metalDark', [0.007, 0.022, 0.006], [0, -0.07, 0.0], 0.0015, [0.15, 0, 0]);
  b.cylX(B, 'metalDark', 0.006, 0.005, [-0.02, -0.055, 0.03], 12);
  b.box(B, 'metalDark', [0.004, 0.005, 0.02], [-0.022, -0.055, 0.042], 0.001);
  b.profileX(B, 'polymer', [[0.035, -0.055], [0.085, -0.055], [0.10, -0.135], [0.09, -0.15], [0.06, -0.15], [0.045, -0.12], [0.038, -0.08]], 0.03, [0, 0, 0], 0.004);
  // ---- magwell + curved steel mag
  b.box(B, 'metal', [0.03, 0.04, 0.045], [0, -0.055, -0.04], 0.002);
  const M = 'mag';
  b.profileX(M, 'metalDark', [[-0.018, -0.06], [0.014, -0.06], [0.016, -0.12], [0.03, -0.22], [0.03, -0.235], [-0.012, -0.235], [-0.016, -0.22], [-0.024, -0.13]], 0.021, [0, 0, -0.04], 0.002);
  b.profileX(M, 'polymer', [[-0.014, -0.225], [0.032, -0.225], [0.034, -0.24], [-0.016, -0.24]], 0.024, [0, 0, -0.04], 0.002);
  b.box(M, 'brass', [0.014, 0.008, 0.03], [0, -0.058, -0.045], 0.003);
  const sheet = ctx.mats.engravingSheet([{ lines: ['MP5A3  Kal. 9mm x 19', 'GUNFIGHT  ARMORY'], font: 42 }]);
  b.attach(B, decalPlanes([{ w: 0.07, h: 0.026, pos: [-0.0192, -0.05, -0.01], rot: [0, -Math.PI / 2, 0], rect: sheet.rects[0] }], sheet.mat));
  // ---- collapsible stock: two rails + butt
  b.box(B, 'metalDark', [0.007, 0.014, 0.21], [0.018, 0.0, 0.2], 0.0015);
  b.box(B, 'metalDark', [0.007, 0.014, 0.21], [-0.018, 0.0, 0.2], 0.0015);
  b.box(B, 'polymer', [0.048, 0.085, 0.016], [0, -0.02, 0.31], 0.004);
  b.box(B, 'polymer', [0.048, 0.02, 0.03], [0, 0.0, 0.29], 0.003);
  b.cylX(B, 'metalDark', 0.006, 0.046, [0, 0.0, 0.09], 12);

  const groups = b.build();
  const root = new THREE.Group(); root.name = 'mp5';
  for (const g of Object.values(groups)) root.add(g);
  const muzzle = socket('muzzle', [0, 0, -0.36]); root.add(muzzle);
  const eject = socket('eject', [0.024, 0.004, -0.03]); root.add(eject);
  const aimS = socket('aim', aim); root.add(aimS);

  // left hand: C-clamp on the left face of the slim handguard
  const L0: V3 = [-0.078, -0.048, -0.194];
  const LF: V3 = [0.55, 0.80, -0.24], LB: V3 = [-0.80, 0.42, 0.42], LE: V3 = [-0.62, -0.66, 0.42];
  b.darken(B, [-0.020, -0.008, -0.198], 0.08, 0.45);
  b.darken(B, [0.012, -0.10, 0.075], 0.07, 0.4);
  b.attach(B, contactShadows([
    { pos: [-0.0232, -0.020, -0.174], normal: [-1, 0, 0], radius: 0.030, stretch: 1.5 },
    { pos: [-0.006, -0.0452, -0.180], normal: [0, -1, 0], radius: 0.028, stretch: 1.5 },
    { pos: [0.0232, -0.018, -0.174], normal: [1, 0, 0], radius: 0.022, stretch: 1.3 },
    { pos: [0.0152, -0.10, 0.078], normal: [1, 0, 0.1], radius: 0.03, stretch: 1.2 },
    { pos: [-0.0152, -0.105, 0.068], normal: [-1, 0, 0.1], radius: 0.028, stretch: 1.2 },
  ], ctx.mats.shadow));
  const reload = (empty: boolean): Clip => {
    const T = empty ? 2.4 : 1.85;
    const magGrab: V3 = [-0.03, -0.11, -0.03];
    return {
      duration: T,
      gunRot: [[0, [0, 0, 0]], [0.28, [0.2, 0.25, -0.5]], [1.05, [0.18, 0.22, -0.45]], [1.2, [0.08, 0.12, -0.3]], [T, [0, 0, 0]]],
      gunPos: [[0, [0, 0, 0]], [0.28, [-0.05, 0.04, 0.03]], [1.15, [-0.045, 0.04, 0.03]], [T, [0, 0, 0]]],
      left: {
        pos: [[0, L0], [0.28, magGrab], [0.55, [-0.03, -0.36, 0.06]], [0.65, [-0.04, -0.4, 0.06]], [1.02, magGrab], [1.1, [-0.02, -0.14, -0.03]], [1.22, [-0.03, -0.15, -0.04]],
          ...(empty ? [[1.5, [-0.075, 0.07, -0.20]] as [number, V3], [1.7, [-0.075, 0.075, -0.18]] as [number, V3], [1.8, [-0.06, 0.03, -0.22]] as [number, V3], [2.3, L0] as [number, V3]] : [[1.7, L0] as [number, V3]])],
        fingers: [[0, LF], [0.28, [0.35, -1, -0.15]], [1.22, [0.3, -1, 0]], ...(empty ? [[1.5, [0.9, -0.2, -0.4]] as [number, V3], [1.8, [0.9, -0.5, -0.3]] as [number, V3], [2.3, LF] as [number, V3]] : [[1.7, LF] as [number, V3]])],
        back: [[0, LB], [0.28, [-1, 0, 0.3]], [1.22, [-0.9, -0.2, 0.2]], ...(empty ? [[1.5, [-0.2, 1, -0.3]] as [number, V3], [2.3, LB] as [number, V3]] : [[1.7, LB] as [number, V3]])],
        elbow: [[0, LE], [0.28, [-0.7, -0.6, 0.4]], [1.22, [-0.7, -0.6, 0.4]], ...(empty ? [[1.5, [-0.7, -0.5, 0.6]] as [number, V3], [2.3, LE] as [number, V3]] : [[1.7, LE] as [number, V3]])],
        pose: [[0, 'foregrip'], [0.12, 'open'], [0.26, 'magHold'], [1.05, 'flat'], [1.22, 'open'], ...(empty ? [[1.45, 'flat'] as [number, 'flat'], [2.0, 'foregrip'] as [number, 'foregrip']] : [[1.55, 'foregrip'] as [number, 'foregrip']])],
      },
      parts: { mag: [[0, 0], [0.3, 0], [0.55, 1], [0.68, 1], [1.02, 0.02], [1.07, -0.02], [1.14, 0]], charge: empty ? [[0, 1], [1.72, 1], [1.8, 0]] : [] },
      magVisible: [[0, 1], [0.58, 0], [0.66, 1]],
      events: [{ t: 0.32, sound: 'reload_magout', action: 'magOut' }, { t: 1.02, sound: 'reload_magin', action: 'magIn' }, ...(empty ? [{ t: 1.78, sound: 'reload_rack' }, { t: 1.8, action: 'chamber' as const }] : [])],
    };
  };
  const inspect: Clip = {
    duration: 4.0,
    gunPos: [[0, [0, 0, 0]], [0.7, [-0.05, 0.0, 0.03]], [1.9, [-0.04, 0.01, 0.03]], [2.6, [0.02, -0.02, 0.04]], [3.4, [0.02, -0.02, 0.04]], [4.0, [0, 0, 0]]],
    gunRot: [[0, [0, 0, 0]], [0.7, [0.15, 1.0, -0.45]], [1.9, [0.05, 1.15, -0.5]], [2.6, [-0.25, -0.75, 0.5]], [3.4, [-0.2, -0.85, 0.55]], [4.0, [0, 0, 0]]],
    left: { pose: [[0, 'foregrip'], [1.0, 'pinch'], [1.6, 'foregrip']], pos: [[0, L0], [1.0, [-0.07, 0.06, -0.20]], [1.4, [-0.07, 0.06, -0.15]], [1.6, L0]] },
    parts: { charge: [[1.0, 0], [1.3, 1], [1.5, 0]] },
    events: [{ t: 1.3, sound: 'reload_rack' }],
  };
  const melee: Clip = {
    duration: 0.7,
    gunPos: [[0, [0, 0, 0]], [0.1, [0.06, 0.02, 0.1]], [0.28, [-0.12, -0.06, -0.15]], [0.7, [0, 0, 0]]],
    gunRot: [[0, [0, 0, 0]], [0.1, [0.25, 0.5, 0.2]], [0.28, [-0.35, -0.9, -0.6]], [0.7, [0, 0, 0]]],
    events: [{ t: 0.26, action: 'hit' }],
  };
  const draw: Clip = { duration: 0.36, gunPos: [[0, [0.05, -0.25, 0.05]], [0.36, [0, 0, 0]]], gunRot: [[0, [0.8, -0.3, 0.4]], [0.36, [0, 0, 0]]] };

  return {
    root, groups,
    sockets: { muzzle, eject, aim: aimS },
    ejectDir: [1, 0.5, 0.2],
    parts: {
      mag: { obj: groups.mag, pos: [0.0, -0.28, 0.05], rot: [0.25, 0, -0.2] },
      charge: { obj: groups.charge, pos: [0, 0.004, 0.05], rot: [0, 0, 0.5], pivot: [0, 0.026, -0.215] },
    },
    hands: {
      right: { pos: [0.040, -0.080, 0.122], fingers: [-0.25, -0.4, -0.88], back: [0.95, -0.05, 0.3], elbow: [0.30, -0.92, 0.26], pose: 'grip', contact: 'grip' },
      left: { pos: L0, fingers: LF, back: LB, elbow: LE, pose: 'foregrip', contact: 'handguard' },
    },
    // Handguard: the polymer profile spanning z -0.245..-0.075, y -0.045..+0.012, 46 mm across.
    // Grip: the profile from (z 0.06, y -0.06) to (z 0.075, y -0.145), 30 mm across.
    grips: {
      handguard: { a: [0, -0.0175, -0.232], b: [0, -0.0175, -0.088], hw: 0.0235, hh: 0.0260, r: 0.0110 },
      grip: { a: [0, -0.062, 0.060], b: [0, -0.142, 0.076], hw: 0.0150, hh: 0.0280, r: 0.0150, skip: ['index'] },
    },
    clips: { reload: reload(false), reloadEmpty: reload(true), inspect, melee, draw },
    firePose: 'gripFire',
    muzzleLightPos: [0, 0.01, -0.40],
    triangles: countTriangles(root),
  };
}
