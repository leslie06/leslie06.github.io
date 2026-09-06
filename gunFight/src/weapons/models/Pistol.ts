import * as THREE from 'three';
import { PartBuilder, decalPlanes, socket, contactShadows, type V3 } from '../Build';
import { countTriangles, type ModelCtx, type WeaponModel, type Clip } from '../Model';

/**
 * M9-style service pistol: open-top slide that cycles (and locks back on empty), exposed barrel,
 * hammer, frame with dust cover + trigger guard, checkered grip panels, 15-rd mag.
 * Origin: bore axis above the grip. Muzzle at -Z.
 */
export function buildPistol(ctx: ModelCtx): WeaponModel {
  const b = new PartBuilder(ctx.mats);
  const B = 'body', S = 'slide';

  // ---- frame: dust cover, rails, trigger guard, grip
  b.profileX(B, 'metal', [[0.045, -0.012], [0.045, -0.035], [0.005, -0.04], [-0.05, -0.04], [-0.14, -0.038], [-0.145, -0.012]], 0.027, [0, 0, 0], 0.0025);
  b.box(B, 'metalDark', [0.02, 0.004, 0.024], [0, -0.012, -0.05], 0.001);
  // trigger guard (loop): front bar + bottom bar + trigger
  b.box(B, 'metal', [0.012, 0.045, 0.006], [0, -0.06, -0.052], 0.0015);
  b.box(B, 'metal', [0.012, 0.005, 0.06], [0, -0.082, -0.022], 0.0015);
  b.box(B, 'metalDark', [0.006, 0.02, 0.005], [0, -0.06, -0.02], 0.001, [0.2, 0, 0]);
  // grip frame + checkered panels + screws
  b.profileX(B, 'metal', [[0.005, -0.03], [0.05, -0.03], [0.068, -0.115], [0.06, -0.125], [0.018, -0.125], [0.012, -0.10], [0.008, -0.06]], 0.028, [0, 0, 0], 0.003);
  b.profileX(B, 'polymer', [[0.012, -0.045], [0.05, -0.045], [0.064, -0.112], [0.024, -0.112], [0.016, -0.08]], 0.036, [0, 0, 0], 0.003);
  b.screw(B, [0.0185, -0.075, 0.035], 'x', 0.003); b.screw(B, [-0.0185, -0.075, 0.035], '-x', 0.003);
  // beavertail, hammer, safety/decocker lever (left), mag release, slide release
  b.box(B, 'metal', [0.026, 0.008, 0.02], [0, -0.008, 0.055], 0.002);
  b.box(B, 'metalDark', [0.008, 0.02, 0.012], [0, 0.008, 0.052], 0.002, [0.35, 0, 0]);
  b.box(B, 'metalDark', [0.004, 0.006, 0.02], [-0.016, 0.005, 0.03], 0.001);
  b.cylX(B, 'metalDark', 0.005, 0.004, [-0.0155, -0.038, -0.01], 12);
  b.box(B, 'metalDark', [0.003, 0.006, 0.024], [-0.0155, -0.015, -0.02], 0.001);
  const sheet = ctx.mats.engravingSheet([{ lines: ['M9  9mm PARABELLUM', 'GUNFIGHT ARMORY'], font: 44 }]);
  b.attach(B, decalPlanes([{ w: 0.05, h: 0.016, pos: [-0.0137, -0.026, -0.08], rot: [0, -Math.PI / 2, 0], rect: sheet.rects[0] }], sheet.mat));

  // ---- slide (open top): rear block, front block, side rails, sights, serrations
  b.profileX(S, 'metalDark', [[0.035, -0.012], [0.035, 0.018], [-0.02, 0.02], [-0.02, -0.012]], 0.028, [0, 0, 0], 0.004);
  b.profileX(S, 'metalDark', [[-0.115, -0.012], [-0.115, 0.02], [-0.16, 0.018], [-0.165, 0.0], [-0.16, -0.012]], 0.028, [0, 0, 0], 0.004);
  b.box(S, 'metalDark', [0.006, 0.026, 0.1], [0.011, 0.001, -0.068], 0.0025);
  b.box(S, 'metalDark', [0.006, 0.026, 0.1], [-0.011, 0.001, -0.068], 0.0025);
  // ejection port cut (dark cavity behind the right rail)
  b.shade(0.25).box(S, 'metalDark', [0.004, 0.014, 0.03], [0.0125, 0.008, -0.01], 0.001).endShade();
  // rear + front cocking serrations
  for (let i = 0; i < 6; i++) { b.box(S, 'metalDark', [0.03, 0.02, 0.0018], [0, 0.002, 0.005 + i * 0.006], 0.0004, [0, 0, 0], 1); }
  for (let i = 0; i < 4; i++) { b.box(S, 'metalDark', [0.03, 0.016, 0.0016], [0, 0.002, -0.128 - i * 0.006], 0.0004, [0, 0, 0], 1); }
  // dovetail sight bases
  b.box(S, 'metalDark', [0.016, 0.003, 0.009], [0, 0.0215, 0.02], 0.0006);
  b.box(S, 'metalDark', [0.012, 0.003, 0.007], [0, 0.0215, -0.152], 0.0006);
  // rear sight (notch) + front post with white dots
  b.box(S, 'metalDark', [0.006, 0.007, 0.008], [-0.005, 0.0235, 0.02], 0.001);
  b.box(S, 'metalDark', [0.006, 0.007, 0.008], [0.005, 0.0235, 0.02], 0.001);
  b.box(S, 'metalDark', [0.003, 0.008, 0.006], [0, 0.024, -0.152], 0.0008, [0, 0, 0], 1);
  b.box(S, 'plate', [0.0015, 0.0015, 0.001], [0, 0.025, -0.1553], 0.0003, [0, 0, 0], 1);
  b.box(S, 'plate', [0.0015, 0.0015, 0.001], [-0.0065, 0.025, 0.0245], 0.0003, [0, 0, 0], 1);
  b.box(S, 'plate', [0.0015, 0.0015, 0.001], [0.0065, 0.025, 0.0245], 0.0003, [0, 0, 0], 1);
  // extractor + ejection cut on the right
  b.box(S, 'metal', [0.003, 0.006, 0.02], [0.0135, 0.01, -0.005], 0.0006);
  // ---- barrel (exposed through the open slide) + chamber block + guide rod
  b.cylZ(B, 'metal', 0.0075, 0.0075, 0.17, [0, 0.002, -0.08], 18);
  b.box(B, 'metal', [0.02, 0.018, 0.03], [0, 0.0, -0.005], 0.002);
  b.cylZ(B, 'metal', 0.004, 0.004, 0.03, [0, -0.012, -0.15], 12);
  const aim: V3 = [0, 0.0272, 0.02];

  // ---- magazine (moves down on reload)
  const M = 'mag';
  b.box(M, 'metalDark', [0.02, 0.10, 0.032], [0, -0.075, 0.038], 0.002);
  b.box(M, 'polymer', [0.026, 0.008, 0.042], [0, -0.128, 0.038], 0.002);
  b.box(M, 'brass', [0.012, 0.008, 0.02], [0, -0.028, 0.03], 0.003);

  const groups = b.build();
  const root = new THREE.Group(); root.name = 'm9';
  for (const g of Object.values(groups)) root.add(g);
  const muzzle = socket('muzzle', [0, 0.002, -0.17]); root.add(muzzle);
  const eject = socket('eject', [0.018, 0.012, -0.01]); root.add(eject);
  const aimS = socket('aim', aim); root.add(aimS);

  // support hand wraps over the firing hand's fingers, thumb along the frame
  const L0: V3 = [-0.046, -0.086, 0.052];
  const LF: V3 = [0.66, 0.32, -0.68], LB: V3 = [-0.76, 0.34, -0.55], LE: V3 = [-0.34, -0.94, 0.05];
  b.darken(B, [0.0, -0.085, 0.045], 0.06, 0.45);
  b.attach(B, contactShadows([
    { pos: [0.0182, -0.085, 0.045], normal: [1, 0, 0.15], radius: 0.026, stretch: 1.2 },
    { pos: [-0.0182, -0.088, 0.04], normal: [-1, 0, 0.1], radius: 0.026, stretch: 1.2 },
    { pos: [0.0, -0.08, 0.066], normal: [0, -0.4, 1], radius: 0.02 },
  ], ctx.mats.shadow));
  const reload = (empty: boolean): Clip => {
    const T = empty ? 1.95 : 1.55;
    const magGrab: V3 = [-0.02, -0.15, 0.05];
    return {
      duration: T,
      gunRot: [[0, [0, 0, 0]], [0.25, [0.15, 0.35, -0.55]], [1.0, [0.15, 0.3, -0.5]], [1.2, [0.05, 0.1, -0.2]], [T, [0, 0, 0]]],
      gunPos: [[0, [0, 0, 0]], [0.25, [-0.04, 0.04, 0.04]], [1.0, [-0.04, 0.035, 0.04]], [T, [0, 0, 0]]],
      left: {
        pos: [[0, L0], [0.25, magGrab], [0.5, [-0.03, -0.38, 0.1]], [0.6, [-0.04, -0.42, 0.1]], [0.95, magGrab], [1.02, [-0.01, -0.19, 0.05]], [1.12, [-0.03, -0.20, 0.05]],
          ...(empty ? [[1.4, [-0.035, 0.01, 0.05]] as [number, V3], [1.55, [-0.035, 0.0, 0.045]] as [number, V3], [1.9, L0] as [number, V3]] : [[1.5, L0] as [number, V3]])],
        fingers: [[0, LF], [0.25, [0.3, -1, -0.15]], [1.12, [0.2, -1, 0]], ...(empty ? [[1.4, [0.9, 0.2, -0.4]] as [number, V3], [1.9, LF] as [number, V3]] : [[1.5, LF] as [number, V3]])],
        back: [[0, LB], [0.25, [-1, 0, 0.3]], [1.12, [-0.9, -0.2, 0.2]], ...(empty ? [[1.4, [-0.5, 0.8, 0]] as [number, V3], [1.9, LB] as [number, V3]] : [[1.5, LB] as [number, V3]])],
        elbow: [[0, LE], [0.25, [-0.7, -0.6, 0.4]], [1.12, [-0.7, -0.6, 0.4]], ...(empty ? [[1.4, [-0.7, -0.6, 0.5]] as [number, V3], [1.9, LE] as [number, V3]] : [[1.5, LE] as [number, V3]])],
        pose: [[0, 'support'], [0.1, 'open'], [0.24, 'magHold'], [0.98, 'flat'], [1.12, 'open'], ...(empty ? [[1.38, 'pinch'] as [number, 'pinch'], [1.7, 'support'] as [number, 'support']] : [[1.45, 'support'] as [number, 'support']])],
      },
      parts: { mag: [[0, 0], [0.27, 0], [0.5, 1], [0.62, 1], [0.95, 0.02], [1.0, -0.02], [1.06, 0]], slide: empty ? [[0, 1], [1.5, 1], [1.56, 0]] : [] },
      magVisible: [[0, 1], [0.53, 0], [0.61, 1]],
      events: [{ t: 0.3, sound: 'reload_magout', action: 'magOut' }, { t: 0.95, sound: 'reload_magin', action: 'magIn' }, ...(empty ? [{ t: 1.53, sound: 'reload_rack' }, { t: 1.56, action: 'chamber' as const }] : [])],
    };
  };
  const inspect: Clip = {
    duration: 3.6,
    gunPos: [[0, [0, 0, 0]], [0.6, [-0.04, 0.02, 0.06]], [1.6, [-0.03, 0.02, 0.06]], [2.3, [0.03, -0.01, 0.05]], [3.0, [0.03, -0.01, 0.05]], [3.6, [0, 0, 0]]],
    gunRot: [[0, [0, 0, 0]], [0.6, [0.2, 1.1, -0.5]], [1.6, [0.1, 1.25, -0.55]], [2.3, [-0.3, -0.8, 0.6]], [3.0, [-0.25, -0.9, 0.65]], [3.6, [0, 0, 0]]],
    left: { pose: [[0, 'support'], [0.5, 'pinch'], [1.5, 'support']], pos: [[0, L0], [0.5, [-0.03, 0.02, 0.02]], [1.0, [-0.03, 0.02, 0.05]], [1.5, L0]], fingers: [[0, LF], [0.5, [0.9, 0.2, -0.4]], [1.5, LF]], back: [[0, LB], [0.5, [-0.5, 0.8, 0]], [1.5, LB]] },
    parts: { slide: [[0.5, 0], [0.9, 1], [1.2, 0]] },
    events: [{ t: 0.9, sound: 'reload_rack' }],
  };
  const melee: Clip = {
    duration: 0.6,
    gunPos: [[0, [0, 0, 0]], [0.1, [0.05, 0.02, 0.08]], [0.25, [-0.1, -0.05, -0.12]], [0.6, [0, 0, 0]]],
    gunRot: [[0, [0, 0, 0]], [0.1, [0.25, 0.5, -0.2]], [0.25, [-0.3, -0.8, 0.5]], [0.6, [0, 0, 0]]],
    events: [{ t: 0.23, action: 'hit' }],
  };
  const draw: Clip = { duration: 0.3, gunPos: [[0, [0.04, -0.22, 0.05]], [0.3, [0, 0, 0]]], gunRot: [[0, [0.7, -0.3, 0.3]], [0.3, [0, 0, 0]]] };

  return {
    root, groups,
    sockets: { muzzle, eject, aim: aimS },
    ejectDir: [1, 0.7, 0.3],
    parts: {
      mag: { obj: groups.mag, pos: [0.0, -0.22, 0.02], rot: [0.15, 0, -0.1] },
      slide: { obj: groups.slide, pos: [0, 0, 0.032] },
    },
    hands: {
      right: { pos: [0.044, -0.064, 0.095], fingers: [-0.3, -0.3, -0.9], back: [0.9, -0.1, 0.42], elbow: [0.42, -0.86, 0.28], pose: 'grip', contact: 'grip' },
      left: { pos: L0, fingers: LF, back: LB, elbow: LE, pose: 'support', contact: 'support' },
    },
    /**
     * Aimed: the pistol and its sights are the subject. Hip has both elbows hanging almost straight down
     * (x +/-0.3), which projects the two forearms as vertical columns either side of the sight line — the
     * round-2 review scored that frame 3.0, the worst in the build. Aimed, the grip cluster drops and
     * rolls under the bore, the support hand comes in thumbs-forward and *lower* than the firing hand,
     * and both elbows swing far out (x +/-0.68) so the forearms enter from the bottom corners instead.
     */
    handsAds: {
      right: { pos: [0.030, -0.080, 0.104], fingers: [-0.26, -0.42, -0.87], back: [0.94, -0.02, 0.34], elbow: [0.52, -0.84, 0.14], sleeve: 0.45, pose: 'grip', contact: 'grip' },
      left: { pos: [-0.052, -0.104, 0.048], fingers: [0.70, 0.30, -0.65], back: [-0.66, 0.44, -0.61], elbow: [-0.60, -0.79, 0.12], sleeve: 0.45, pose: 'support', contact: 'support' },
    },
    /**
     * `grip` is the frame's grip column (z 0.028..0.042, y -0.04..-0.118, 36 mm across the panels).
     * `support` is what the *support* hand actually wraps on a two-handed pistol grip: not the gun, but
     * the firing hand around it. Modelling it as the same column inflated by a hand thickness is what
     * keeps the left fingers lying on the right knuckles instead of inside the grip or 3 cm off it.
     */
    grips: {
      grip: { a: [0, -0.042, 0.028], b: [0, -0.118, 0.044], hw: 0.0180, hh: 0.0260, r: 0.0140, skip: ['index'], derive: false },
      support: { a: [0, -0.048, 0.026], b: [0, -0.110, 0.042], hw: 0.0330, hh: 0.0380, r: 0.0270, derive: false, virtual: true },
    },
    clips: { reload: reload(false), reloadEmpty: reload(true), inspect, melee, draw },
    fireCycle: { part: 'slide', back: 0.03, fwd: 0.05, lockOpenOnEmpty: true },
    firePose: 'gripFire',
    muzzleLightPos: [0, 0.01, -0.2],
    triangles: countTriangles(root),
  };
}
