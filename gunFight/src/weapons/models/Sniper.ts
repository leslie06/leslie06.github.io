import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PartBuilder, decalPlanes, socket, contactShadows, type V3 } from '../Build';
import { countTriangles, type ModelCtx, type WeaponModel, type Clip } from '../Model';

/**
 * L96A1-style bolt-action sniper: olive thumbhole stock, fluted barrel with a muzzle brake, folded bipod,
 * 10x scope (the eyepiece shows a magnified render-target view + a reticle mask while aiming),
 * bolt that lifts and cycles with the right hand, 5-rd box mag.
 * Origin: bore axis above the grip. Muzzle at -Z.
 */
export function buildSniper(ctx: ModelCtx): WeaponModel {
  const b = new PartBuilder(ctx.mats);
  const B = 'body';

  // ---- stock (thumbhole, cheek riser, butt) + forend
  b.profileX(B, 'stockPoly', [[0.10, 0.02], [0.30, 0.03], [0.345, 0.02], [0.35, -0.04], [0.34, -0.11], [0.30, -0.12], [0.20, -0.08], [0.12, -0.15], [0.09, -0.155], [0.05, -0.13], [0.04, -0.06], [0.0, -0.05], [-0.40, -0.045], [-0.42, -0.015], [-0.10, -0.015], [-0.10, 0.0], [0.02, 0.0]], 0.05, [0, 0, 0], 0.005);
  b.box(B, 'stockPoly', [0.052, 0.03, 0.09], [0, 0.03, 0.20], 0.006);
  b.box(B, 'polymer', [0.05, 0.13, 0.016], [0, -0.045, 0.356], 0.005);
  b.screw(B, [0.026, -0.03, 0.06], 'x', 0.0035); b.screw(B, [0.026, -0.03, -0.12], 'x', 0.0035); b.screw(B, [-0.026, -0.03, 0.06], '-x', 0.0035); b.screw(B, [-0.026, -0.03, -0.12], '-x', 0.0035);
  const sheet = ctx.mats.engravingSheet([{ lines: ['L96A1  7.62x51', 'GUNFIGHT ARMORY'], font: 44 }]);
  b.attach(B, decalPlanes([{ w: 0.08, h: 0.026, pos: [-0.0252, -0.03, -0.02], rot: [0, -Math.PI / 2, 0], rect: sheet.rects[0] }], sheet.mat));
  // ---- receiver + rail + trigger
  b.cylZ(B, 'metal', 0.018, 0.018, 0.20, [0, 0.0, -0.02], 24, 0.002);
  b.box(B, 'metal', [0.03, 0.02, 0.19], [0, -0.012, -0.02], 0.003);
  b.rail(B, 'rail', 0.15, 0.021, [0, 0.017, -0.03]);
  b.box(B, 'metalDark', [0.012, 0.004, 0.06], [0, -0.09, 0.0], 0.001);
  b.box(B, 'metalDark', [0.012, 0.03, 0.004], [0, -0.075, -0.03], 0.001);
  b.box(B, 'metalDark', [0.007, 0.024, 0.006], [0, -0.07, 0.0], 0.0015, [0.15, 0, 0]);
  b.box(B, 'metalDark', [0.004, 0.006, 0.02], [0.0175, -0.005, 0.05], 0.001);
  // ---- bolt: body (translates) with the handle (rotates about the bore)
  b.cylZ('bolt', 'metal', 0.0125, 0.0125, 0.11, [0, 0.0, 0.03], 18, 0.002);
  b.latheZ('bolt', 'metal', [[0.0, 0], [0.014, 0], [0.016, 0.004], [0.016, 0.024], [0.012, 0.028], [0, 0.028]], [0, 0, 0.10], 18);
  b.cylX('boltHandle', 'metal', 0.005, 0.045, [0.03, -0.012, 0.03], 12);
  b.add('boltHandle', 'metal', new THREE.SphereGeometry(0.0115, 14, 10), [0.054, -0.016, 0.03]);
  b.box('boltHandle', 'metal', [0.012, 0.02, 0.014], [0.013, -0.004, 0.03], 0.002);
  // ---- barrel (fluted) + muzzle brake + bipod (folded)
  b.cylZ(B, 'metalDark', 0.0115, 0.0145, 0.56, [0, 0, -0.40], 22);
  for (let i = 0; i < 6; i++) { const a = (i / 6) * Math.PI * 2; b.box(B, 'metalDark', [0.0025, 0.004, 0.30], [Math.cos(a) * 0.0128, Math.sin(a) * 0.0128, -0.36], 0.0005, [0, 0, a + Math.PI / 2]); }
  b.latheZ(B, 'metalDark', [[0.0115, 0], [0.016, 0.004], [0.016, 0.05], [0.014, 0.054], [0.007, 0.054], [0.007, 0]], [0, 0, -0.68], 18);
  b.shade(0.3); for (let i = 0; i < 3; i++) { b.box(B, 'metalDark', [0.036, 0.008, 0.006], [0, 0, -0.695 - i * 0.012], 0.0006, [0, 0, 0], 1); } b.endShade();
  b.box(B, 'metalDark', [0.04, 0.014, 0.03], [0, -0.052, -0.30], 0.002);
  b.cylZ(B, 'metalDark', 0.006, 0.006, 0.18, [0.02, -0.056, -0.21], 12);
  b.cylZ(B, 'metalDark', 0.006, 0.006, 0.18, [-0.02, -0.056, -0.21], 12);
  b.box(B, 'polymer', [0.014, 0.008, 0.012], [0.02, -0.056, -0.115], 0.002); b.box(B, 'polymer', [0.014, 0.008, 0.012], [-0.02, -0.056, -0.115], 0.002);
  // ---- scope: rings, tube, objective bell, ocular bell with recessed eyepiece, turrets, sunshade
  const SY = 0.062;
  for (const z of [-0.06, 0.02]) { b.tubeZ(B, 'metalDark', 0.02, 0.0165, 0.016, [0, SY, z], 24); b.box(B, 'metalDark', [0.026, 0.02, 0.016], [0, SY - 0.026, z], 0.002); b.screw(B, [0.016, SY + 0.006, z], 'x', 0.0025); b.screw(B, [-0.016, SY + 0.006, z], '-x', 0.0025); }
  b.cylZ(B, 'metal', 0.0165, 0.0165, 0.22, [0, SY, -0.03], 26, 0.002);
  b.latheZ(B, 'metal', [[0.0165, 0], [0.0165, 0.01], [0.027, 0.045], [0.027, 0.09], [0.024, 0.093], [0.024, 0.088], [0, 0.088]], [0, SY, -0.14], 26);
  // Ocular bell: flares out, ends in a rubber-like rolled lip with the lens recessed behind it. The bore
  // is opened up (lip inner 0.0168, eyepiece ring 0.0166) so the glass can be 0.0164 — see the note on
  // `scope.radius` below for why the ring/glass sizes are what they are.
  b.latheZ(B, 'metal', [[0.0165, 0], [0.0178, 0.02], [0.0188, 0.05], [0.0188, 0.058], [0.0182, 0.062], [0.0172, 0.062], [0.0168, 0.057], [0.0168, 0.052], [0, 0.052]], [0, SY, 0.075], 28);
  b.shade(0.25).tubeZ(B, 'metalDark', 0.0176, 0.0166, 0.012, [0, SY, 0.131], 28).endShade();
  b.cylY(B, 'metalDark', 0.011, 0.011, 0.016, [0, SY + 0.024, -0.02], 18, 0.0015);
  b.cylX(B, 'metalDark', 0.011, 0.016, [0.024, SY, -0.02], 18);
  b.cylX(B, 'metalDark', 0.009, 0.014, [-0.023, SY, -0.02], 18);
  b.cylY(B, 'metalDark', 0.005, 0.005, 0.006, [0, SY + 0.035, -0.02], 10);
  b.cylY(B, 'metalDark', 0.007, 0.007, 0.01, [0, SY + 0.02, 0.10], 14, 0.001);
  const aim: V3 = [0, SY, 0.131];
  // lens surfaces: objective glass (front) + ocular glass (rear). The whole glass mesh hides while aiming so the
  // render-target image is not tinted by the glass reflection.
  const og = new THREE.CircleGeometry(0.023, 28); og.translate(0, SY, -0.229);
  const ocg = new THREE.CircleGeometry(0.0164, 24); ocg.translate(0, SY, 0.1305);
  const glassMesh = new THREE.Mesh(mergeGeometries([og.toNonIndexed(), ocg.toNonIndexed()], false)!, ctx.mats.glass);
  glassMesh.renderOrder = 3; glassMesh.frustumCulled = false; b.attach(B, glassMesh);
  const lens = new THREE.Mesh(new THREE.CircleGeometry(0.0164, 44), ctx.mats.scopeView);
  lens.position.set(0, SY, 0.1300); lens.frustumCulled = false; lens.visible = false; lens.name = 'scopeLens'; b.attach(B, lens);
  const mask = new THREE.Mesh(new THREE.CircleGeometry(0.0164, 52), ctx.mats.scopeMask);
  mask.position.set(0, SY, 0.1302); mask.frustumCulled = false; mask.visible = false; mask.renderOrder = 4; b.attach(B, mask);
  // hand contact
  b.darken(B, [-0.02, -0.045, -0.27], 0.07, 0.4);
  b.darken(B, [0.012, -0.10, 0.075], 0.07, 0.4);
  b.attach(B, contactShadows([
    { pos: [-0.0252, -0.03, -0.27], normal: [-1, 0, 0], radius: 0.028, stretch: 1.5 },
    { pos: [-0.006, -0.0452, -0.28], normal: [0, -1, 0], radius: 0.026, stretch: 1.5 },
    { pos: [0.026, -0.10, 0.08], normal: [1, 0, 0.1], radius: 0.03, stretch: 1.2 },
    { pos: [-0.026, -0.105, 0.07], normal: [-1, 0, 0.1], radius: 0.028, stretch: 1.2 },
  ], ctx.mats.shadow));
  // ---- magazine
  const M = 'mag';
  b.box(M, 'metalDark', [0.026, 0.06, 0.09], [0, -0.05, -0.06], 0.003);
  b.box(M, 'metalDark', [0.03, 0.008, 0.096], [0, -0.082, -0.06], 0.002);
  b.box(M, 'brass', [0.014, 0.01, 0.06], [0, -0.02, -0.06], 0.004);

  const groups = b.build();
  groups.bolt.add(groups.boltHandle);
  const root = new THREE.Group(); root.name = 'l96';
  for (const g of Object.values(groups)) if (g !== groups.boltHandle) root.add(g);
  const muzzle = socket('muzzle', [0, 0, -0.74]); root.add(muzzle);
  const eject = socket('eject', [0.022, 0.012, 0.0]); root.add(eject);
  const aimS = socket('aim', aim); root.add(aimS);

  const R0: V3 = [0.042, -0.082, 0.128];
  const RF: V3 = [-0.25, -0.4, -0.88], RB: V3 = [0.95, -0.05, 0.3], RE: V3 = [0.30, -0.92, 0.26];
  // left hand cradles the forend from below-left, thumb along the left side
  const L0: V3 = [-0.078, -0.070, -0.266];
  const LF: V3 = [0.55, 0.80, -0.24], LB: V3 = [-0.80, 0.42, 0.42], LE: V3 = [-0.62, -0.66, 0.42];
  // bolt cycle: right hand to the knob, lift, pull, push, drop, back to the grip
  const cycle: Clip = {
    duration: 1.15,
    gunRot: [[0, [0, 0, 0]], [0.3, [0.05, 0.12, -0.18]], [0.85, [0.05, 0.1, -0.15]], [1.15, [0, 0, 0]]],
    gunPos: [[0, [0, 0, 0]], [0.3, [-0.03, -0.01, 0.02]], [0.85, [-0.03, -0.01, 0.02]], [1.15, [0, 0, 0]]],
    right: {
      pos: [[0, R0], [0.2, [0.075, -0.05, 0.06]], [0.38, [0.07, 0.03, 0.05]], [0.6, [0.07, 0.035, 0.13]], [0.82, [0.07, 0.03, 0.05]], [0.98, [0.075, -0.05, 0.06]], [1.15, R0]],
      fingers: [[0, RF], [0.2, [-0.6, 0.2, -0.75]], [0.98, [-0.6, 0.2, -0.75]], [1.15, RF]],
      back: [[0, RB], [0.2, [0.8, -0.6, 0]], [0.98, [0.8, -0.6, 0]], [1.15, RB]],
      elbow: [[0, RE], [0.2, [0.5, -1, 0.5]], [1.15, RE]],
      pose: [[0, 'grip'], [0.12, 'bolt'], [1.02, 'grip']],
    },
    parts: { boltHandle: [[0.2, 0], [0.38, 1], [0.82, 1], [0.98, 0]], bolt: [[0.38, 0], [0.6, 1], [0.82, 0]] },
    events: [{ t: 0.36, sound: 'bolt' }, { t: 0.56, action: 'shell' }, { t: 0.82, sound: 'bolt_close' }],
  };
  const reload = (empty: boolean): Clip => {
    const T = empty ? 3.4 : 2.9;
    const magGrab: V3 = [-0.03, -0.11, -0.06];
    return {
      duration: T,
      gunRot: [[0, [0, 0, 0]], [0.35, [0.2, 0.3, -0.55]], [1.6, [0.18, 0.25, -0.5]], [1.9, [0.05, 0.1, -0.2]], [T, [0, 0, 0]]],
      gunPos: [[0, [0, 0, 0]], [0.35, [-0.05, 0.05, 0.03]], [1.6, [-0.05, 0.045, 0.03]], [T, [0, 0, 0]]],
      left: {
        pos: [[0, L0], [0.35, magGrab], [0.8, [-0.03, -0.36, 0.05]], [0.95, [-0.04, -0.4, 0.06]], [1.55, magGrab], [1.65, [-0.02, -0.15, -0.06]], [1.9, [-0.03, -0.16, -0.06]], [2.6, L0]],
        fingers: [[0, LF], [0.35, [0.35, -1, -0.15]], [1.9, [0.3, -1, 0]], [2.6, LF]],
        back: [[0, LB], [0.35, [-1, 0, 0.3]], [1.9, [-0.9, -0.2, 0.2]], [2.6, LB]],
        elbow: [[0, LE], [0.35, [-0.7, -0.6, 0.4]], [1.9, [-0.7, -0.6, 0.4]], [2.6, LE]],
        pose: [[0, 'foregrip'], [0.15, 'open'], [0.33, 'magHold'], [1.6, 'flat'], [1.9, 'open'], [2.4, 'foregrip']],
      },
      right: empty ? cycle.right && { ...cycle.right, pos: cycle.right.pos!.map(([t, v]) => [t + 2.0, v] as [number, V3]), fingers: cycle.right.fingers!.map(([t, v]) => [t + 2.0, v] as [number, V3]), back: cycle.right.back!.map(([t, v]) => [t + 2.0, v] as [number, V3]), elbow: cycle.right.elbow!.map(([t, v]) => [t + 2.0, v] as [number, V3]), pose: cycle.right.pose!.map(([t, v]) => [t + 2.0, v] as [number, typeof v]) } : undefined,
      parts: { mag: [[0, 0], [0.38, 0], [0.8, 1], [1.0, 1], [1.55, 0.02], [1.6, -0.02], [1.68, 0]], ...(empty ? { boltHandle: [[2.2, 0], [2.38, 1], [2.82, 1], [2.98, 0]], bolt: [[2.38, 0], [2.6, 1], [2.82, 0]] } : {}) },
      magVisible: [[0, 1], [0.85, 0], [0.97, 1]],
      events: [{ t: 0.42, sound: 'reload_magout', action: 'magOut' }, { t: 1.55, sound: 'reload_magin', action: 'magIn' }, ...(empty ? [{ t: 2.36, sound: 'bolt' }, { t: 2.82, sound: 'bolt_close' }, { t: 2.85, action: 'chamber' as const }] : [])],
    };
  };
  const inspect: Clip = {
    duration: 5.0,
    gunPos: [[0, [0, 0, 0]], [0.9, [-0.06, 0.0, 0.05]], [2.4, [-0.05, 0.01, 0.05]], [3.2, [0.02, -0.02, 0.06]], [4.2, [0.02, -0.02, 0.06]], [5.0, [0, 0, 0]]],
    gunRot: [[0, [0, 0, 0]], [0.9, [0.15, 0.8, -0.4]], [2.4, [0.05, 0.95, -0.45]], [3.2, [-0.25, -0.65, 0.5]], [4.2, [-0.2, -0.75, 0.55]], [5.0, [0, 0, 0]]],
    right: { pose: [[0, 'grip'], [1.0, 'bolt'], [2.2, 'grip']], pos: [[0, R0], [1.0, [0.07, 0.03, 0.05]], [1.4, [0.07, 0.035, 0.13]], [1.9, [0.07, 0.03, 0.05]], [2.2, R0]], fingers: [[0, RF], [1.0, [-0.6, 0.2, -0.75]], [2.0, [-0.6, 0.2, -0.75]], [2.2, RF]], back: [[0, RB], [1.0, [0.8, -0.6, 0]], [2.0, [0.8, -0.6, 0]], [2.2, RB]] },
    parts: { boltHandle: [[0.9, 0], [1.1, 1], [1.9, 1], [2.1, 0]], bolt: [[1.1, 0], [1.4, 1], [1.9, 0]] },
    events: [{ t: 1.1, sound: 'bolt' }, { t: 1.9, sound: 'bolt_close' }],
  };
  const melee: Clip = {
    duration: 0.9,
    gunPos: [[0, [0, 0, 0]], [0.15, [0.06, 0.02, 0.12]], [0.36, [-0.12, -0.06, -0.16]], [0.9, [0, 0, 0]]],
    gunRot: [[0, [0, 0, 0]], [0.15, [0.25, 0.5, 0.2]], [0.36, [-0.35, -0.9, -0.6]], [0.9, [0, 0, 0]]],
    events: [{ t: 0.33, action: 'hit' }],
  };
  const draw: Clip = { duration: 0.6, gunPos: [[0, [0.05, -0.32, 0.05]], [0.6, [0, 0, 0]]], gunRot: [[0, [0.9, -0.3, 0.4]], [0.6, [0, 0, 0]]] };

  return {
    root, groups,
    sockets: { muzzle, eject, aim: aimS },
    ejectDir: [1, 0.6, 0.2],
    parts: {
      mag: { obj: groups.mag, pos: [0.0, -0.26, 0.03], rot: [0.2, 0, -0.2] },
      bolt: { obj: groups.bolt, pos: [0, 0, 0.075] },
      boltHandle: { obj: groups.boltHandle, rot: [0, 0, 1.25], pivot: [0, 0, 0.03] },
    },
    hands: {
      right: { pos: R0, fingers: RF, back: RB, elbow: RE, pose: 'grip', contact: 'grip' },
      left: { pos: L0, fingers: LF, back: LB, elbow: LE, pose: 'foregrip', contact: 'forend' },
    },
    // Forend: the stock profile out to z -0.42 (y -0.046..-0.015, 50 mm across) plus the barrel sitting
    // in it, so the hand cradles a ~59 mm deep section. Grip: the thumbhole grip column, (z 0.065,
    // y -0.07) to (z 0.10, y -0.145).
    grips: {
      forend: { a: [0, -0.0165, -0.335], b: [0, -0.0165, -0.205], hw: 0.0250, hh: 0.0295, r: 0.0150 },
      grip: { a: [0, -0.072, 0.066], b: [0, -0.145, 0.100], hw: 0.0250, hh: 0.0260, r: 0.0200, skip: ['index'] },
    },
    clips: { reload: reload(false), reloadEmpty: reload(true), cycle, inspect, melee, draw },
    firePose: 'gripFire',
    muzzleLightPos: [0, 0.02, -0.78],
    /**
     * Scope framing. On screen a circle of radius r sitting `d` from the eye covers
     * `r / (d * tan(fovAds/2))` of the frame height. At the old eye relief (adsDist 0.075, fovAds 40)
     * the ocular bell's widest ring came out at 0.0188 / (0.075 * 0.364) = 69% of frame height, which
     * is the 68% the round-2 review measured against a 55-60% target. adsDist is now 0.090, putting the
     * bell at 59% and the glass (0.0164) at 50%, with a real rim between them instead of a hairline.
     * `radius` also drives the scope camera's FOV, so the two stay coupled.
     */
    scope: { lens, reticleMask: mask, radius: 0.0164, ocular: glassMesh },
    triangles: countTriangles(root),
  };
}
