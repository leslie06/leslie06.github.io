import * as THREE from 'three';
import { PartBuilder, decalPlanes, socket, extrude, contactShadows, type V3 } from '../Build';
import { countTriangles, type ModelCtx, type WeaponModel, type Clip } from '../Model';

/**
 * M4A1-style carbine: flat-top upper with pic rail, charging handle, forward assist, dust cover,
 * brass deflector, lower with magwell + STANAG mag, M-LOK free-float handguard, A2 flash hider,
 * collapsible stock, micro red-dot on a riser with a glass lens and an emissive reticle.
 * Origin: bore axis directly above the pistol grip. Muzzle at -Z.
 */
export function buildAssaultRifle(ctx: ModelCtx): WeaponModel {
  const b = new PartBuilder(ctx.mats);
  const B = 'body';

  // ---- upper receiver
  b.profileX(B, 'metal', [[0.10, -0.03], [0.10, 0.026], [0.07, 0.031], [-0.118, 0.031], [-0.12, -0.03]], 0.05, [0, 0, 0], 0.003);
  b.rail(B, 'rail', 0.20, 0.021, [0, 0.031, -0.01]);
  // forward assist + brass deflector + dust cover (open) + ejection port cavity
  b.cylX(B, 'metalDark', 0.008, 0.016, [0.031, 0.004, 0.035], 14);
  b.cylX(B, 'metalDark', 0.0045, 0.02, [0.037, 0.004, 0.035], 10);
  b.box(B, 'metalDark', [0.008, 0.024, 0.014], [0.028, 0.002, 0.0], 0.002, [0, 0.6, 0]);
  b.shade(0.3).box(B, 'polymer', [0.005, 0.02, 0.062], [0.0245, 0.0, -0.045], 0.001).endShade();
  b.box(B, 'metal', [0.0025, 0.02, 0.064], [0.0268, -0.022, -0.045], 0.0008);
  // bolt carrier seen through the port (moves on fire)
  b.box('bolt', 'metal', [0.012, 0.016, 0.075], [0.019, 0.001, -0.045], 0.002);
  // charging handle (T + latch), moves back on empty reload
  b.box('charge', 'metalDark', [0.052, 0.011, 0.018], [0, 0.017, 0.118], 0.002);
  b.box('charge', 'metalDark', [0.014, 0.008, 0.06], [0, 0.020, 0.085], 0.0015);
  b.box('charge', 'metalDark', [0.006, 0.012, 0.03], [-0.026, 0.02, 0.105], 0.0015);
  // takedown / pivot pins, ejection port detail screws
  b.cylX(B, 'metalDark', 0.0038, 0.054, [0, -0.043, 0.078], 12);
  b.cylX(B, 'metalDark', 0.0038, 0.054, [0, -0.041, -0.108], 12);
  b.screw(B, [0.0255, 0.015, 0.065], 'x', 0.0025);
  b.screw(B, [-0.0255, 0.015, 0.065], '-x', 0.0025);

  // ---- lower receiver + magwell + trigger guard + grip
  b.profileX(B, 'metal', [[0.092, -0.028], [0.092, -0.052], [0.055, -0.06], [-0.032, -0.06], [-0.036, -0.088], [-0.104, -0.09], [-0.114, -0.05], [-0.12, -0.028]], 0.045, [0, 0, 0], 0.003);
  b.box(B, 'metalDark', [0.012, 0.004, 0.058], [0, -0.096, -0.005], 0.001);
  b.box(B, 'metalDark', [0.012, 0.03, 0.004], [0, -0.082, -0.036], 0.001);
  b.box(B, 'metalDark', [0.007, 0.024, 0.006], [0, -0.072, -0.012], 0.0015, [0.15, 0, 0]);
  b.profileX(B, 'polymer', [[0.03, -0.05], [0.08, -0.05], [0.097, -0.135], [0.092, -0.152], [0.062, -0.158], [0.046, -0.148], [0.038, -0.11], [0.032, -0.075]], 0.031, [0, 0, 0], 0.004);
  // selector, mag release, bolt catch
  b.cylX(B, 'metalDark', 0.0055, 0.006, [-0.0245, -0.04, 0.03], 12);
  b.box(B, 'metalDark', [0.004, 0.005, 0.024], [-0.027, -0.04, 0.042], 0.001);
  b.cylX(B, 'metalDark', 0.0055, 0.005, [0.0245, -0.046, -0.028], 12);
  b.box(B, 'metalDark', [0.0035, 0.022, 0.012], [-0.0245, -0.038, -0.022], 0.001);
  b.box(B, 'metalDark', [0.0035, 0.008, 0.02], [-0.0245, -0.055, -0.032], 0.001);
  // engraving on the left of the magwell + serial on the right
  const sheet = ctx.mats.engravingSheet([
    { lines: ['M4A1  CAL. 5.56 MM', 'SEMI    AUTO', 'GUNFIGHT ARMORY'], font: 40 },
    { lines: ['SN 2471-88-GF'], font: 64, color: '#c8c8c8', style: 'plate' },
    { lines: ['SAFE   SEMI   AUTO'], font: 60, color: '#e6e6e6' },
    { lines: ['WARNING  READ MANUAL', 'BEFORE USE  ·  5.56x45 NATO ONLY'], font: 34, color: '#e8e8e8', style: 'label', accent: '#e0b020' },
  ]);
  b.attach(B, decalPlanes([
    { w: 0.062, h: 0.03, pos: [-0.0232, -0.072, -0.07], rot: [0, -Math.PI / 2, 0], rect: sheet.rects[0] },
    { w: 0.05, h: 0.016, pos: [0.0232, -0.038, 0.03], rot: [0, Math.PI / 2, 0], rect: sheet.rects[1] },
    { w: 0.036, h: 0.009, pos: [-0.0232, -0.031, 0.045], rot: [0, -Math.PI / 2, 0], rect: sheet.rects[2] },
    { w: 0.05, h: 0.016, pos: [-0.0272, -0.004, -0.29], rot: [0, -Math.PI / 2, 0], rect: sheet.rects[3] },
    { w: 0.05, h: 0.016, pos: [0.0272, -0.004, -0.19], rot: [0, Math.PI / 2, 0], rect: sheet.rects[3] },
  ], sheet.mat));

  // ---- buffer tube, castle nut, stock
  b.cylZ(B, 'metalDark', 0.0165, 0.0165, 0.21, [0, 0.008, 0.215], 20);
  b.cylZ(B, 'metalDark', 0.021, 0.021, 0.012, [0, 0.008, 0.108], 18, 0.002);
  b.profileX(B, 'polymer', [[0.17, 0.028], [0.31, 0.031], [0.322, 0.02], [0.322, -0.072], [0.31, -0.082], [0.25, -0.076], [0.195, -0.032], [0.17, -0.03]], 0.04, [0, 0, 0], 0.004);
  b.box(B, 'polymer', [0.042, 0.11, 0.012], [0, -0.026, 0.33], 0.004);
  b.box(B, 'polymer', [0.02, 0.012, 0.05], [0, -0.035, 0.205], 0.002);
  b.box(B, 'polymer', [0.06, 0.003, 0.08], [0, -0.038, 0.26], 0.001);

  // ---- handguard (M-LOK free-float, octagonal) + top rail
  const oct: [number, number][] = [];
  for (let i = 0; i < 8; i++) { const a = Math.PI / 8 + (i / 8) * Math.PI * 2; oct.push([Math.cos(a) * 0.0272, Math.sin(a) * 0.0272]); }
  b.add(B, 'metalDark', extrude(oct, 0.225, 0.002), [0, 0.0055, -0.2325]);
  b.rail(B, 'rail', 0.215, 0.021, [0, 0.031, -0.2325]);
  for (let i = 0; i < 6; i++) {
    const z = -0.145 - i * 0.036;
    b.shade(0.45);
    b.box(B, 'polymer', [0.0025, 0.0075, 0.03], [0.0268, 0.005, z], 0.0006, [0, 0, 0], 1);
    b.box(B, 'polymer', [0.0025, 0.0075, 0.03], [-0.0268, 0.005, z], 0.0006, [0, 0, 0], 1);
    if (i < 5) b.box(B, 'polymer', [0.0075, 0.0025, 0.03], [0, -0.0215, z - 0.018], 0.0006);
    b.endShade();
  }
  b.cylZ(B, 'metalDark', 0.024, 0.024, 0.014, [0, 0.005, -0.125], 20, 0.002);
  b.screw(B, [0.0275, -0.012, -0.135], 'x', 0.003); b.screw(B, [-0.0275, -0.012, -0.135], '-x', 0.003);
  b.screw(B, [0.0275, -0.012, -0.335], 'x', 0.003); b.screw(B, [-0.0275, -0.012, -0.335], '-x', 0.003);

  // ---- barrel, gas block, flash hider
  b.cylZ(B, 'metalDark', 0.0085, 0.0085, 0.09, [0, 0, -0.385], 18);
  b.latheZ(B, 'metalDark', [[0.0085, 0], [0.0115, 0.004], [0.0115, 0.028], [0.0125, 0.03], [0.0125, 0.038], [0.011, 0.04], [0.0065, 0.04], [0.0065, 0.0]], [0, 0, -0.425], 18);
  b.shade(0.3);
  for (let i = 0; i < 5; i++) { const a = (i / 5) * Math.PI * 2 + 0.3; b.box(B, 'polymer', [0.0025, 0.0035, 0.022], [Math.cos(a) * 0.012, Math.sin(a) * 0.012, -0.447], 0.0005, [0, 0, a + Math.PI / 2]); }
  b.endShade();
  // folded front & rear back-up sights
  b.box(B, 'metalDark', [0.02, 0.009, 0.03], [0, 0.0445, -0.31], 0.002);
  b.box(B, 'metalDark', [0.02, 0.009, 0.026], [0, 0.0445, 0.075], 0.002);

  // ---- optic: riser + Picatinny clamp (cross-bolt) + hooded micro red dot with turrets, battery cap and LED
  const aim: V3 = [0, 0.081, 0.005];
  b.box(B, 'metalDark', [0.03, 0.017, 0.06], [0, 0.0485, 0.005], 0.002);
  b.box(B, 'metalDark', [0.037, 0.011, 0.02], [0, 0.0445, 0.022], 0.0015);
  b.cylX(B, 'metalDark', 0.0035, 0.041, [0, 0.0445, 0.022], 12);
  b.add(B, 'metalDark', new THREE.CylinderGeometry(0.0055, 0.0055, 0.004, 6), [0.0205, 0.0445, 0.022], [0, 0, Math.PI / 2]);
  b.screw(B, [0.0155, 0.049, -0.012], 'x', 0.003); b.screw(B, [-0.0155, 0.049, -0.012], '-x', 0.003);
  b.box(B, 'metalDark', [0.032, 0.02, 0.046], [0, 0.066, 0.005], 0.003);
  b.box(B, 'metalDark', [0.026, 0.006, 0.03], [0, 0.077, 0.005], 0.002);
  // hood: bevelled front lip, thicker rear ring
  b.latheZ(B, 'metalDark', [[0.0146, 0], [0.0195, 0], [0.0205, 0.004], [0.0205, 0.026], [0.0195, 0.031], [0.0178, 0.036], [0.0146, 0.036], [0.0146, 0]], [aim[0], aim[1], aim[2] + 0.017], 32);
  b.shade(0.35).tubeZ(B, 'metalDark', 0.0146, 0.0135, 0.034, [aim[0], aim[1], aim[2]], 28).endShade();
  // elevation turret (top), windage turret (right), battery cap (left), brightness rocker + LED
  b.cylY(B, 'metalDark', 0.0062, 0.0062, 0.007, [0, aim[1] + 0.021, 0.004], 16, 0.001);
  b.cylY(B, 'metalDark', 0.0035, 0.0035, 0.003, [0, aim[1] + 0.026, 0.004], 10, 0.0005);
  b.cylX(B, 'metalDark', 0.0062, 0.007, [0.0235, aim[1], 0.004], 16);
  b.cylX(B, 'metalDark', 0.0088, 0.006, [-0.0225, aim[1] - 0.002, 0.0], 18);
  b.screw(B, [-0.0258, aim[1] - 0.002, 0.0], '-x', 0.0025);
  b.box(B, 'metalDark', [0.006, 0.007, 0.014], [0.0185, aim[1] + 0.012, -0.002], 0.001);
  const led = new THREE.Mesh(new THREE.BoxGeometry(0.0015, 0.0022, 0.0022), ctx.mats.led);
  led.position.set(0.0218, aim[1] + 0.012, -0.002); led.frustumCulled = false; led.name = 'led'; b.attach(B, led);
  // glass: two discs (front tinted, rear) merged into one mesh
  const g1 = new THREE.CircleGeometry(0.0138, 28); g1.translate(aim[0], aim[1], aim[2] - 0.012);
  const g2 = new THREE.CircleGeometry(0.0138, 28); g2.translate(aim[0], aim[1], aim[2] + 0.015);
  const glass = new THREE.Mesh(mergeCircles([g1, g2]), ctx.mats.glass); glass.name = 'glass'; glass.renderOrder = 3; glass.frustumCulled = false;
  b.attach(B, glass);
  const ret = new THREE.Mesh(new THREE.PlaneGeometry(0.0034, 0.0034), ctx.mats.reticle);
  ret.position.set(aim[0], aim[1], aim[2] - 0.004); ret.renderOrder = 4; ret.frustumCulled = false; ret.name = 'reticle';
  b.attach(B, ret);

  // ---- hand contact: vertex darkening + soft decals where the palms wrap the handguard and grip
  b.darken(B, [-0.020, 0.006, -0.270], 0.08, 0.45);
  b.darken(B, [0.012, -0.10, 0.07], 0.07, 0.45);
  b.attach(B, contactShadows([
    { pos: [-0.0272, -0.004, -0.245], normal: [-1, 0, 0], radius: 0.032, stretch: 1.5 },
    { pos: [-0.010, -0.0225, -0.250], normal: [0, -1, 0], radius: 0.030, stretch: 1.5 },
    { pos: [0.0272, -0.002, -0.245], normal: [1, 0, 0], radius: 0.024, stretch: 1.3 },
    { pos: [0.000, 0.0332, -0.242], normal: [0, 1, 0.05], radius: 0.020, stretch: 1.2 },
    { pos: [0.0158, -0.095, 0.072], normal: [1, 0, 0.12], radius: 0.03, stretch: 1.2 },
    { pos: [-0.0158, -0.10, 0.062], normal: [-1, 0, 0.1], radius: 0.028, stretch: 1.2 },
    { pos: [0.0, -0.088, 0.099], normal: [0, -0.35, 1], radius: 0.022 },
  ], ctx.mats.shadow));

  // ---- magazine (STANAG 30, curved, with witness marks)
  const M = 'mag';
  const magPts: [number, number][] = [[-0.032, -0.055], [0.028, -0.055], [0.034, -0.10], [0.046, -0.20], [0.052, -0.245], [0.05, -0.252], [-0.010, -0.252], [-0.012, -0.245], [-0.020, -0.19], [-0.028, -0.10]];
  b.profileX(M, 'polymer', magPts, 0.024, [0, 0, -0.07], 0.003);
  b.profileX(M, 'polymer', [[-0.026, -0.235], [0.05, -0.235], [0.052, -0.256], [-0.02, -0.256]], 0.026, [0, 0, -0.07], 0.002);
  b.attach(M, decalPlanes([
    { w: 0.06, h: 0.14, pos: [-0.0122, -0.17, -0.058], rot: [0, -Math.PI / 2, 0.16] },
    { w: 0.06, h: 0.14, pos: [0.0122, -0.17, -0.058], rot: [0, Math.PI / 2, -0.16] },
  ], ctx.mats.witness()));
  b.box(M, 'brass', [0.02, 0.009, 0.05], [0, -0.052, -0.083], 0.003);

  const groups = b.build();
  const root = new THREE.Group(); root.name = 'm4';
  for (const g of Object.values(groups)) root.add(g);
  const muzzle = socket('muzzle', [0, 0, -0.465]); root.add(muzzle);
  const eject = socket('eject', [0.032, 0.006, -0.045]); root.add(eject);
  const aimS = socket('aim', aim); root.add(aimS);

  // left hand: C-clamp on the left face of the handguard, knuckles down-forward, thumb riding over the rail
  const L0: V3 = [-0.084, -0.052, -0.262];
  const LF: V3 = [0.55, 0.80, -0.24], LB: V3 = [-0.80, 0.42, 0.42], LE: V3 = [-0.62, -0.66, 0.42];
  const reloadBase = (empty: boolean): Clip => {
    const T = empty ? 2.65 : 2.05;
    const magGrab: V3 = [-0.028, -0.105, -0.045];
    const clip: Clip = {
      duration: T,
      gunRot: [[0, [0, 0, 0]], [0.3, [0.22, 0.28, -0.55]], [1.25, [0.2, 0.25, -0.5]], [1.35, [0.1, 0.15, -0.35]], [empty ? 1.7 : 1.6, empty ? [0.18, 0.1, 0.1] : [0.03, 0.06, -0.1]], [T, [0, 0, 0]]],
      gunPos: [[0, [0, 0, 0]], [0.3, [-0.05, 0.05, 0.03]], [1.2, [-0.05, 0.045, 0.03]], [1.27, [-0.045, 0.055, 0.025]], [T, [0, 0, 0]]],
      left: {
        pos: [[0, L0], [0.3, magGrab], [0.62, [-0.03, -0.36, 0.05]], [0.72, [-0.04, -0.40, 0.06]], [1.15, magGrab], [1.22, [-0.02, -0.14, -0.045]], [1.35, [-0.03, -0.16, -0.05]],
          ...(empty ? [[1.62, [-0.035, 0.07, 0.19]] as [number, V3], [1.75, [-0.035, 0.07, 0.19]] as [number, V3], [1.9, [-0.035, 0.07, 0.24]] as [number, V3], [1.98, [-0.035, 0.07, 0.19]] as [number, V3], [2.5, L0] as [number, V3]] : [[1.85, L0] as [number, V3]])],
        fingers: [[0, LF], [0.3, [0.35, -1, -0.15]], [1.35, [0.3, -1, 0.0]], ...(empty ? [[1.62, [0.2, -0.35, -1]] as [number, V3], [2.5, LF] as [number, V3]] : [[1.85, LF] as [number, V3]])],
        back: [[0, LB], [0.3, [-1, 0, 0.3]], [1.35, [-0.9, -0.2, 0.2]], ...(empty ? [[1.62, [-0.3, 1, 0]] as [number, V3], [2.5, LB] as [number, V3]] : [[1.85, LB] as [number, V3]])],
        elbow: [[0, LE], [0.3, [-0.7, -0.6, 0.4]], [1.35, [-0.7, -0.6, 0.4]], ...(empty ? [[1.62, [-0.6, -0.4, 0.7]] as [number, V3], [2.5, LE] as [number, V3]] : [[1.85, LE] as [number, V3]])],
        pose: [[0, 'foregrip'], [0.15, 'open'], [0.28, 'magHold'], [1.18, 'flat'], [1.35, 'open'], ...(empty ? [[1.6, 'pinch'] as [number, 'pinch'], [2.1, 'open'] as [number, 'open'], [2.4, 'foregrip'] as [number, 'foregrip']] : [[1.7, 'foregrip'] as [number, 'foregrip']])],
        contact: [[0, 'handguard'], [0.12, 'none'], ...(empty ? [[2.5, 'handguard'] as [number, string]] : [[1.85, 'handguard'] as [number, string]])],
      },
      parts: {
        mag: [[0, 0], [0.32, 0], [0.62, 1], [0.75, 1], [1.15, 0.02], [1.2, -0.02], [1.27, 0]],
        charge: empty ? [[1.75, 0], [1.9, 1], [1.97, 0]] : [],
        bolt: empty ? [[0, 1], [1.9, 1], [1.97, 0]] : [],
      },
      magVisible: [[0, 1], [0.66, 0], [0.74, 1]],
      events: [{ t: 0.34, sound: 'reload_magout', action: 'magOut' }, { t: 1.15, sound: 'reload_magin', action: 'magIn' }, ...(empty ? [{ t: 1.9, sound: 'reload_rack' }, { t: 1.97, action: 'chamber' as const }] : [])],
    };
    return clip;
  };

  const inspect: Clip = {
    duration: 4.6,
    gunPos: [[0, [0, 0, 0]], [0.8, [-0.06, 0.0, 0.03]], [2.2, [-0.05, 0.01, 0.03]], [3.0, [0.02, -0.02, 0.04]], [3.9, [0.02, -0.02, 0.04]], [4.6, [0, 0, 0]]],
    gunRot: [[0, [0, 0, 0]], [0.8, [0.15, 1.0, -0.45]], [2.2, [0.05, 1.15, -0.5]], [3.0, [-0.25, -0.75, 0.5]], [3.9, [-0.2, -0.85, 0.55]], [4.6, [0, 0, 0]]],
    left: { pose: [[0, 'foregrip'], [2.4, 'open'], [3.0, 'foregrip']], pos: [[0, L0], [2.6, [-0.05, 0.02, -0.16]], [3.2, L0]], fingers: [[0, LF], [2.4, [0.3, -0.2, -0.93]], [3.2, LF]], back: [[0, LB], [2.4, [-0.9, 0.3, 0.2]], [3.2, LB]], contact: [[0, 'handguard'], [2.2, 'none'], [3.2, 'handguard']] },
    parts: { charge: [[1.2, 0], [1.6, 1], [1.9, 0]], bolt: [[1.2, 0], [1.6, 1], [1.9, 0]] },
    events: [{ t: 1.6, sound: 'reload_rack' }],
  };
  const melee: Clip = {
    duration: 0.75,
    gunPos: [[0, [0, 0, 0]], [0.12, [0.06, 0.02, 0.12]], [0.3, [-0.12, -0.06, -0.16]], [0.75, [0, 0, 0]]],
    gunRot: [[0, [0, 0, 0]], [0.12, [0.25, 0.5, 0.2]], [0.3, [-0.35, -0.9, -0.6]], [0.75, [0, 0, 0]]],
    events: [{ t: 0.28, action: 'hit' }],
  };
  const draw: Clip = { duration: 0.42, gunPos: [[0, [0.05, -0.28, 0.05]], [0.42, [0, 0, 0]]], gunRot: [[0, [0.9, -0.3, 0.4]], [0.42, [0, 0, 0]]] };

  return {
    root, groups,
    sockets: { muzzle, eject, aim: aimS },
    ejectDir: [1, 0.55, 0.15],
    parts: {
      mag: { obj: groups.mag, pos: [0.0, -0.30, 0.06], rot: [0.3, 0, -0.25] },
      charge: { obj: groups.charge, pos: [0, 0, 0.036] },
      bolt: { obj: groups.bolt, pos: [0, 0, 0.04] },
    },
    hands: {
      right: { pos: [0.040, -0.080, 0.118], fingers: [-0.25, -0.4, -0.88], back: [0.95, -0.05, 0.3], elbow: [0.30, -0.92, 0.26], pose: 'grip', contact: 'grip' },
      left: { pos: L0, fingers: LF, back: LB, elbow: LE, pose: 'foregrip', contact: 'handguard' },
    },
    // What the hands hold, measured off the geometry above: the M-LOK handguard is the octagonal
    // extrusion at [0, 0.0055, -0.2325] (circumradius 0.0272, M-LOK panels out to 0.0268) and the
    // pistol grip is the polymer profile running from (z 0.055, y -0.055) down to (z 0.077, y -0.150),
    // 31 mm across and ~59 mm fore-aft. The grip solver puts the gloves on these.
    grips: {
      handguard: { a: [0, 0.0055, -0.335], b: [0, 0.0055, -0.140], hw: 0.0268, hh: 0.0268, r: 0.0268 },
      grip: { a: [0, -0.058, 0.0545], b: [0, -0.145, 0.0745], hw: 0.0155, hh: 0.0295, r: 0.0155, skip: ['index'] },
    },
    clips: { reload: reloadBase(false), reloadEmpty: reloadBase(true), inspect, melee, draw },
    fireCycle: { part: 'bolt', back: 0.03, fwd: 0.06, lockOpenOnEmpty: true },
    firePose: 'gripFire',
    muzzleLightPos: [0, 0.01, -0.5],
    redDot: { reticle: ret, center: aim, radius: 0.0138 },
    triangles: countTriangles(root),
  };
}

function mergeCircles(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [], uv: number[] = [], norm: number[] = [];
  for (const g of geos) {
    const ng = g.toNonIndexed();
    pos.push(...Array.from(ng.getAttribute('position').array as Float32Array));
    uv.push(...Array.from(ng.getAttribute('uv').array as Float32Array));
    norm.push(...Array.from(ng.getAttribute('normal').array as Float32Array));
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(norm, 3));
  out.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  return out;
}
