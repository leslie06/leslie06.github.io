import * as THREE from 'three';
import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { Parts, box, flat, walls, rectPoly, floodGlow, type V3 } from './kit/geo';
import { landmarkMaterials, nightGlow } from './kit/mats';
import { story, balustrade } from './kit/hall';
import { roof } from './kit/roof';
import { facadeMaterial } from './kit/facade';
import { textTex, CJK_SERIF } from './kit/tex';
import { assemble } from './kit/model';

/**
 * 北京站 Beijing Railway Station (1959): 222 m long, cream stone and stucco. The central hall
 * (shallow-shell roof, 34 m) behind a great arched window with the 北京站 sign, flanked by the two
 * clock towers (43 m, double-eaved pyramidal roofs of green glaze trimmed in yellow, gilt finials),
 * long three-storey wings under a green-glazed eave, and the two corner pavilions. Local frame: the
 * front faces the station square to the north (-Z).
 */
const HW = 111, ZF = -32, ZB = 40;         // main block
const HALL = { hw: 18, z0: -43, z1: 26, h: 29 };
const TOWER = { x: 22.5, hw: 4.6, z: -41.5, h: 29 };
const PAV = { x0: 95, x1: 111, z0: -45, z1: -29, h: 21 };

const matCache = new WeakMap<EnvUniforms, Record<string, THREE.Material>>();
function mats(env: EnvUniforms): Record<string, THREE.Material> {
  let m = matCache.get(env);
  if (m) return m;
  const clock = textTex('st.clock', 256, 256, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#c9a44c'; g.beginPath(); g.arc(c, c, c - 1, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#f4f2ea'; g.beginPath(); g.arc(c, c, c - 14, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#1a1a1a';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.save(); g.translate(c + Math.sin(a) * (c - 30), c - Math.cos(a) * (c - 30)); g.rotate(a); g.fillRect(-4, -12, 8, 24); g.restore(); }
    g.lineCap = 'round'; g.strokeStyle = '#1a1a1a';
    g.lineWidth = 10; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.sin(-0.9) * 60, c - Math.cos(-0.9) * 60); g.stroke();
    g.lineWidth = 6; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.sin(1.05) * 92, c - Math.cos(1.05) * 92); g.stroke();
  });
  const sign = textTex('st.sign', 512, 160, (g, w, h) => {
    g.fillStyle = '#9e1c16'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#d9b457'; g.lineWidth = 8; g.strokeRect(6, 6, w - 12, h - 12);
    g.fillStyle = '#f0c75a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${h * 0.66}px ${CJK_SERIF}`;
    '北京站'.split('').forEach((ch, i) => g.fillText(ch, (i + 0.5) * w / 3, h * 0.54));
  });
  m = {
    ...landmarkMaterials(env),
    stWindows: facadeMaterial(env, { floorH: 6, colW: 3.6, glass: '#39464f', frame: '#dccdaa', spandrel: '#d4c49f', mull: 0.2, slab: 0.32, metal: 0.6, rough: 0.12, lit: 0.55, coolShare: 0.15, seed: 21 }),
    stHallGlass: facadeMaterial(env, { floorH: 2.2, colW: 1.4, glass: '#46545e', frame: '#cfc09c', mull: 0.08, slab: 0.08, metal: 0.7, rough: 0.1, lit: 0.9, coolShare: 0, seed: 22 }),
    stClock: nightGlow(new THREE.MeshStandardMaterial({ map: clock, roughness: 0.4 }), env, 'lamp', '#fff4dc'),
    stSign: nightGlow(new THREE.MeshStandardMaterial({ map: sign, roughness: 0.4 }), env, 'lamp', '#ffe0a0'),
  };
  matCache.set(env, m);
  return m;
}

/** Double-eaved pyramidal pavilion roof on a square block top (clock towers and corner pavilions). */
function pavilionTop(P: Parts, cx: number, cz: number, hw: number, y: number, lod: boolean, scale = 1): number {
  const res = lod ? 0.3 : 1;
  P.push(new THREE.Matrix4().makeTranslation(cx, 0, cz));
  const s1 = story(P, { y0: y, xs: [-hw * 0.82, 0, hw * 0.82], zs: [-hw * 0.82, 0, hw * 0.82], colH: 3.2 * scale, colR: 0.32, front: 'windows', back: 'windows', sides: 'windows', beamH: 0.55, bracketH: 0.6, bracketOut: 0.6, lod });
  const inY = s1.top + 1.6 * scale;
  roof(P, { kind: 'pyramid', y0: s1.top + 0.1, y1: inY, hw: s1.wall.hw + 1.6, hd: s1.wall.hd + 1.6, inner: { hw: hw * 0.6, hd: hw * 0.6, y: inY }, wall: s1.wall, tile: 'G', trim: 'Y', lift: 0.55, beasts: 3, res, lod });
  const s2 = story(P, { y0: inY - 0.3, xs: [-hw * 0.56, hw * 0.56], zs: [-hw * 0.56, hw * 0.56], colH: 1.6 * scale, colR: 0.26, front: 'windows', back: 'windows', sides: 'windows', beamH: 0.45, bracketH: 0.5, bracketOut: 0.5, plinth: false, lod });
  const top = s2.top + 0.1 + hw * 0.95 * scale;
  roof(P, { kind: 'pyramid', y0: s2.top + 0.1, y1: top, hw: s2.wall.hw + 1.5, hd: s2.wall.hd + 1.5, wall: s2.wall, tile: 'G', trim: 'Y', lift: 0.55, beasts: 3, finial: 2.2 * scale, res, lod });
  P.pop();
  return top + 2.2 * scale;
}

function body(P: Parts, lod: boolean): number {
  const pl = P.get('plaster'), gr = P.get('granite');
  // plinth
  box(gr, 0, 0.45, (ZF + ZB) / 2 - 2, HW * 2 + 1, 0.9, ZB - ZF + 6, { top: true });
  // wings: three storeys of tall windows under a green-glazed eave
  for (const sx of [-1, 1]) {
    const x0 = sx > 0 ? HALL.hw : -PAV.x0, x1 = sx > 0 ? PAV.x0 : -HALL.hw;
    const cx = (x0 + x1) / 2, hw = (x1 - x0) / 2, h = 17.5;
    const poly: [number, number][] = [[x0, ZF], [x1, ZF], [x1, ZB], [x0, ZB]];
    walls(P.get('stWindows'), poly, 0.9, h);
    flat(P.get('roofFlat'), poly, h + 0.9);
    box(pl, cx, h + 0.5, (ZF + ZB) / 2, hw * 2 + 0.6, 1.0, ZB - ZF + 0.6, { top: false });   // cornice
    P.at(cx, 0, (ZF + ZB) / 2, 0, () => roof(P, { kind: 'hip', y0: h + 0.4, y1: h + 2.6, hw: hw + 2.2, hd: (ZB - ZF) / 2 + 2.2, inner: { hw: hw - 0.6, hd: (ZB - ZF) / 2 - 0.6, y: h + 2.6 }, wall: { hw: hw + 0.3, hd: (ZB - ZF) / 2 + 0.3, y: h + 0.9 }, tile: 'G', trim: 'Y', lift: 0.3, res: lod ? 0.2 : 0.6, lod }));
    // arcade piers along the ground floor front
    if (!lod) for (let x = Math.min(x0, x1) + 2.5; x < Math.max(x0, x1) - 2; x += 5.2) box(pl, x, 3.6, ZF - 1.2, 1.2, 5.4, 1.6);
    if (!lod) box(pl, cx, 6.6, ZF - 1.3, hw * 2, 0.7, 2.4);
  }
  // corner pavilions
  for (const sx of [-1, 1]) {
    const cx = sx * (PAV.x0 + PAV.x1) / 2, cz = (PAV.z0 + PAV.z1) / 2, hw = (PAV.x1 - PAV.x0) / 2;
    walls(P.get('stWindows'), rectPoly(hw, (PAV.z1 - PAV.z0) / 2, cx, cz), 0.9, PAV.h);
    box(pl, cx, PAV.h + 0.4, cz, hw * 2 + 0.8, 0.8, PAV.z1 - PAV.z0 + 0.8);
    pavilionTop(P, cx, cz, hw * 0.78, PAV.h + 0.8, lod);
  }
  // central hall: great arched window and the shell roof
  const hz = (HALL.z0 + HALL.z1) / 2, hd = (HALL.z1 - HALL.z0) / 2;
  walls(pl, rectPoly(HALL.hw, hd, 0, hz), 0.9, HALL.h);
  box(pl, 0, HALL.h + 0.5, hz, HALL.hw * 2 + 1.2, 1.0, hd * 2 + 1.2, { top: false });
  P.at(0, 0, hz, 0, () => {
    roof(P, { kind: 'hip', y0: HALL.h + 0.4, y1: HALL.h + 2.4, hw: HALL.hw + 2.0, hd: hd + 2.0, inner: { hw: HALL.hw - 1, hd: hd - 1, y: HALL.h + 2.4 }, wall: { hw: HALL.hw + 0.6, hd: hd + 0.6, y: HALL.h + 1 }, tile: 'Y', lift: 0.25, res: lod ? 0.3 : 1, lod });
    // shallow shell (扁壳)
    P.get('roofFlat').grid(16, 16, (u, v) => { const x = (u - 0.5) * 2 * (HALL.hw - 1), z = (v - 0.5) * 2 * (hd - 1); const k = 1 - Math.pow(Math.abs(u - 0.5) * 2, 2.2), l = 1 - Math.pow(Math.abs(v - 0.5) * 2, 2.2); return [x, HALL.h + 2.4 + 6.5 * k * l, z] as V3; }, (u, v) => [u * 30, v * 60], [0, 1, 0]);
  });
  if (!lod) {
    // the arched window: glazing inset in a stone frame
    const zw = HALL.z0 - 0.02, sh = new THREE.Shape();
    const aw = 10, ay0 = 4.5, ay1 = 15.5;
    sh.moveTo(-aw, ay0); sh.lineTo(aw, ay0); sh.lineTo(aw, ay1); sh.absarc(0, ay1, aw, 0, Math.PI, false); sh.lineTo(-aw, ay0);
    const g = new THREE.ShapeGeometry(sh, 16);
    const pa = g.getAttribute('position'), ix = g.getIndex()!;
    const b = P.get('stHallGlass'), base = b.count;
    for (let i = 0; i < pa.count; i++) b.vert(-pa.getX(i), pa.getY(i), zw - 0.3, 0, 0, -1, pa.getX(i) + aw, pa.getY(i));
    for (let i = 0; i < ix.count; i += 3) b.tri(base + ix.getX(i), base + ix.getX(i + 1), base + ix.getX(i + 2));
    g.dispose();
    // stone surround and piers
    for (const sx of [-1, 1]) box(pl, sx * (aw + 1.2), 13, zw - 0.9, 2.4, 24, 1.4);
    box(pl, 0, 2.2, zw - 0.9, 2 * aw + 4.8, 4.4, 1.4);
    P.glow(0.9, () => P.get('stSign').poly([[6.6, 26.1, zw - 0.35], [-6.6, 26.1, zw - 0.35], [-6.6, 28.8, zw - 0.35], [6.6, 28.8, zw - 0.35]], [[0, 0], [1, 0], [1, 1], [0, 1]]));
    box(P.get('gold'), 0, 27.45, zw - 0.2, 14, 3.4, 0.2);
    // entrance steps across the front
    for (let i = 0; i < 4; i++) box(P.get('granite'), 0, 0.9 - i * 0.22, HALL.z0 - 2 - i * 0.4, 44, 0.22, 0.42, { faces: 'zZY' });
  }
  // clock towers
  for (const sx of [-1, 1]) {
    const cx = sx * TOWER.x, hw = TOWER.hw;
    walls(pl, rectPoly(hw, hw, cx, TOWER.z), 0.9, TOWER.h);
    box(pl, cx, TOWER.h + 0.35, TOWER.z, hw * 2 + 1.2, 0.7, hw * 2 + 1.2);
    if (!lod) {
      // clock faces on the front and outer side
      P.glow(0.8, () => {
        const c = P.get('stClock'), r = 2.1, y = 24.6;
        c.poly([[cx + r, y - r, TOWER.z - hw - 0.05], [cx - r, y - r, TOWER.z - hw - 0.05], [cx - r, y + r, TOWER.z - hw - 0.05], [cx + r, y + r, TOWER.z - hw - 0.05]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
        const xs = cx + sx * (hw + 0.05);
        const pts: V3[] = sx > 0 ? [[xs, y - r, TOWER.z - r], [xs, y - r, TOWER.z + r], [xs, y + r, TOWER.z + r], [xs, y + r, TOWER.z - r]] : [[xs, y - r, TOWER.z + r], [xs, y - r, TOWER.z - r], [xs, y + r, TOWER.z - r], [xs, y + r, TOWER.z + r]];
        c.poly(pts, [[0, 0], [1, 0], [1, 1], [0, 1]]);
      });
      balustrade(P, rectPoly(hw + 0.4, hw + 0.4, cx, TOWER.z), TOWER.h + 0.7, { closed: true, h: 0.9, step: 1.5 });
    }
    pavilionTop(P, cx, TOWER.z, hw * 0.8, TOWER.h + 0.7, lod, 1.1);
  }
  return 44;
}

function build(env: EnvUniforms): LandmarkModel {
  const m = mats(env);
  const P = new Parts(), F = new Parts();
  const flood = floodGlow({ base: 0.25, front: 0.0, under: 0.8, top: 0.2, foot: 0.45, footH: 6 });
  P.ctx.glow = flood; F.ctx.glow = flood;
  const height = body(P, false); body(F, true);
  const colliders: ColliderSpec[] = [
    { kind: 'box', center: [0, 9.5, (ZF + ZB) / 2], half: [HW, 9.5, (ZB - ZF) / 2] },
    { kind: 'box', center: [0, 12, (HALL.z0 + ZF) / 2], half: [HALL.hw, 12, (ZF - HALL.z0) / 2] },
    { kind: 'box', center: [TOWER.x, 15, TOWER.z], half: [TOWER.hw, 15, TOWER.hw] },
    { kind: 'box', center: [-TOWER.x, 15, TOWER.z], half: [TOWER.hw, 15, TOWER.hw] },
    { kind: 'box', center: [(PAV.x0 + PAV.x1) / 2, 11, (PAV.z0 + PAV.z1) / 2], half: [(PAV.x1 - PAV.x0) / 2, 11, (PAV.z1 - PAV.z0) / 2] },
    { kind: 'box', center: [-(PAV.x0 + PAV.x1) / 2, 11, (PAV.z0 + PAV.z1) / 2], half: [(PAV.x1 - PAV.x0) / 2, 11, (PAV.z1 - PAV.z0) / 2] },
  ];
  return assemble({ name: 'station', detail: P, far: F, mats: m, colliders, footprint: [[-HW - 1, -46], [HW + 1, -46], [HW + 1, ZB + 5], [-HW - 1, ZB + 5]], height });
}

export const station: LandmarkDef = {
  id: 'station', name: { zh: '北京站', en: 'Beijing Railway Station' },
  lat: 39.902290, lon: 116.421031, headingDeg: -1.19, build,
};
