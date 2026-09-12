import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { Parts, box, cyl, lathe, rectPoly, floodGlow } from './kit/geo';
import { landmarkMaterials } from './kit/mats';
import { terrace } from './kit/hall';
import { assemble } from './kit/model';

/**
 * 天坛圜丘 Circular Mound Altar: three open round white-marble tiers (54.9 / 38.4 / 23.7 m, 5.2 m in
 * all) with dense balustrades and nine-step stairs on the four axes; a low round inner wall (104 m)
 * and a square outer wall (167 m), red with blue glazed coping, each opened on the four axes by a set
 * of three white 棂星门; the green glazed 燔柴炉 to the south-east and the three 望灯 lantern poles to
 * the south-west.
 */
const R_IN = 52, HW_OUT = 83.5, WALL_H = 1.6, GATE_SET = 17.5;

/** Three 棂星门 side by side, spanning x in [-GATE_SET/2, GATE_SET/2] in the local frame, facing z. */
function lingxing(P: Parts, lod: boolean): void {
  const m = P.get('marble');
  const gates: [number, number][] = [[-5.6, 2.8], [0, 3.4], [5.6, 2.8]];
  for (const [cx, w] of gates) {
    const h = cx === 0 ? 5.4 : 5.0;
    for (const sx of [-1, 1]) {
      const px = cx + sx * (w / 2 + 0.35);
      box(m, px, h / 2, 0, 0.62, h, 0.62);
      if (!lod) { box(m, px, h + 0.25, 0, 0.95, 0.5, 0.95); cyl(m, px, h + 0.5, 0, 0.35, 0.12, 0.5, 8); }
    }
    box(m, cx, h - 1.2, 0, w + 1.1, 0.5, 0.5);
    box(m, cx, h - 0.5, 0, w + 0.5, 0.9, 0.3);
    if (!lod) cyl(m, cx, h - 0.05, 0, 0.3, 0.05, 0.8, 8);
  }
  // short walls between the gates
  const red = P.get('redWall'), cap = P.get('glzB');
  for (const x of [-2.85 - 0.35, 2.85 + 0.35]) {
    box(red, x, WALL_H / 2, 0, 1.2, WALL_H, 0.8);
    box(cap, x, WALL_H + 0.15, 0, 1.3, 0.3, 1.1);
  }
}

function body(P: Parts, lod: boolean): void {
  terrace(P, {
    tiers: [{ hw: 27.46, hd: 27.46, h: 1.72, round: true }, { hw: 19.2, hd: 19.2, h: 1.72, round: true }, { hw: 11.83, hd: 11.83, h: 1.72, round: true }],
    stairs: (['S', 'N', 'E', 'W'] as const).map((side) => ({ side, w: 3.4 })),
    topKey: 'paving', railStep: 1.25, railH: 0.95, lod,
  });
  if (!lod) cyl(P.get('marble'), 0, 5.16, 0, 0.5, 0.5, 0.04, 16);      // 天心石
  const red = P.get('redWall'), cap = P.get('glzB');
  // inner round wall, open at the four axes
  const n = 64, gapA = (GATE_SET / 2 + 0.3) / R_IN;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    const near = [0, Math.PI / 2, Math.PI, Math.PI * 1.5, Math.PI * 2].some((ax) => Math.abs(am - ax) < gapA);
    if (near) continue;
    const x = Math.cos(am) * R_IN, z = Math.sin(am) * R_IN, len = (a1 - a0) * R_IN + 0.05;
    const ry = -am + Math.PI / 2;
    box(red, x, WALL_H / 2, z, len, WALL_H, 0.8, { ry, faces: 'zZY' });
    if (!lod) box(cap, x, WALL_H + 0.15, z, len, 0.3, 1.15, { ry, faces: 'zZYy' });
  }
  // outer square wall, open at the four axes
  for (const [cx, cz, ry] of [[0, HW_OUT, 0], [0, -HW_OUT, Math.PI], [HW_OUT, 0, Math.PI / 2], [-HW_OUT, 0, -Math.PI / 2]] as const) {
    P.at(cx, 0, cz, ry, () => {
      for (const sx of [-1, 1]) {
        const a = GATE_SET / 2 + 0.3, b = HW_OUT + 0.4, mid = sx * (a + b) / 2, len = b - a;
        box(red, mid, (WALL_H + 0.3) / 2, 0, len, WALL_H + 0.3, 0.9, { faces: 'zZY' });
        if (!lod) box(cap, mid, WALL_H + 0.45, 0, len, 0.3, 1.25, { faces: 'zZYy' });
      }
      lingxing(P, lod);
    });
    P.at(Math.sign(cx) * R_IN, 0, Math.sign(cz) * R_IN, ry, () => lingxing(P, lod));
  }
  if (lod) return;
  // 燔柴炉: green glazed round furnace, south-east between the walls
  lathe(P.get('glzG'), [[3.0, 0], [3.0, 0.6], [2.6, 0.8], [2.6, 2.4], [2.9, 2.6], [2.9, 3.0], [2.4, 3.3], [0.01, 3.4]], 24, 62, 52);
  box(P.get('marble'), 62, 0.3, 48.2, 2.4, 0.6, 1.6);
  // 望灯: three tall lantern poles, south-west
  for (const [x, z] of [[-60, 50], [-66, 44], [-54, 56]] as const) {
    box(P.get('marble'), x, 0.6, z, 2.2, 1.2, 2.2);
    cyl(P.get('red'), x, 1.2, z, 0.22, 0.16, 24, 8);
    P.glow(0.5, () => cyl(P.get('lantern'), x, 20.5, z, 0.7, 0.7, 2.0, 12));
    cyl(P.get('gold'), x, 22.5, z, 0.75, 0.2, 0.5, 12);
  }
}

function build(env: EnvUniforms): LandmarkModel {
  const mats = landmarkMaterials(env);
  const P = new Parts(), F = new Parts();
  const flood = floodGlow({ base: 0.3, front: 0.2, under: 0.8, top: 0.1, foot: 0.4, footH: 3 });
  P.ctx.glow = flood; F.ctx.glow = flood;
  body(P, false); body(F, true);
  const colliders: ColliderSpec[] = [
    { kind: 'cylinder', center: [0, 0.86, 0], radius: 27.46, halfHeight: 0.86 },
    { kind: 'cylinder', center: [0, 1.72, 0], radius: 19.2, halfHeight: 1.72 },
    { kind: 'cylinder', center: [0, 2.58, 0], radius: 11.83, halfHeight: 2.58 },
  ];
  for (const [cx, cz, along] of [[0, HW_OUT, 'x'], [0, -HW_OUT, 'x'], [HW_OUT, 0, 'z'], [-HW_OUT, 0, 'z']] as const) for (const s of [-1, 1]) {
    const mid = s * (GATE_SET / 2 + HW_OUT) / 2, half = (HW_OUT - GATE_SET / 2) / 2;
    colliders.push({ kind: 'box', center: [along === 'x' ? mid : cx, 0.95, along === 'x' ? cz : mid], half: along === 'x' ? [half, 0.95, 0.45] : [0.45, 0.95, half] });
  }
  for (let i = 0; i < 16; i++) {
    const a = ((i + 0.5) / 16) * Math.PI * 2;
    if ([0, 1, 2, 3].some((k) => Math.abs(Math.cos(a - k * Math.PI / 2)) > 0.985)) continue;
    colliders.push({ kind: 'box', center: [Math.cos(a) * R_IN, 0.8, Math.sin(a) * R_IN], half: [10, 0.8, 0.4], yaw: -a + Math.PI / 2 });
  }
  return assemble({ name: 'huanqiu', detail: P, far: F, mats, colliders, footprint: rectPoly(HW_OUT + 0.8, HW_OUT + 0.8), height: 26 });
}

export const huanqiu: LandmarkDef = {
  id: 'huanqiu', name: { zh: '天坛圜丘', en: 'Circular Mound Altar' },
  lat: 39.875583, lon: 116.406957, headingDeg: -2.04, build,
};
