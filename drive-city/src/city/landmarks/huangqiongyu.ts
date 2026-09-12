import * as THREE from 'three';
import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { Parts, box, circlePoly, floodGlow } from './kit/geo';
import { landmarkMaterials } from './kit/mats';
import { terrace, roundStory, hall, bays, gatePlatform } from './kit/hall';
import { roof } from './kit/roof';
import { assemble } from './kit/model';

/**
 * 天坛皇穹宇 Imperial Vault of Heaven: the small round hall (single conical eave of blue glaze,
 * gilded finial, 19 m) on a round marble terrace, inside the grey-brick Echo Wall (回音壁, 65 m,
 * blue coping) with its two five-bay side halls and the glazed south gate. The hall stands in the
 * north of the round court. Local frame: +Z south; origin at the hall.
 */
const WALL = { cz: 19, r: 32.6, h: 3.7 };

function body(P: Parts, lod: boolean): void {
  const res = lod ? 0.3 : 1;
  const top = terrace(P, { tiers: [{ hw: 11.2, hd: 11.2, h: 2.3, round: true }], stairs: [{ side: 'S', w: 6.5, ramp: 2.2 }, { side: 'E', w: 3 }, { side: 'W', w: 3 }], topKey: 'paving', lod });
  const s1 = roundStory(P, { y0: top, r: 6.9, n: 8, colH: 5.4, colR: 0.36, fill: 'windows', beamH: 0.7, bracketH: 0.9, bracketOut: 0.9, lod });
  roof(P, { kind: 'round', y0: s1.top + 0.12, y1: 16.9, hw: 10.0, hd: 0, ridge: 0.6, wall: s1.wall, tile: 'B', curve: 0.35, lift: 0.3, finial: 2.2, res, lod });
  // the Echo Wall: grey brick with blue glazed coping, open at the south gate
  const n = lod ? 32 : 72, gate = 9 / WALL.r;
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2, a1 = ((i + 1) / n) * Math.PI * 2, am = (a0 + a1) / 2;
    if (Math.abs(am - Math.PI / 2) < gate) continue;
    const x = Math.cos(am) * WALL.r, z = WALL.cz + Math.sin(am) * WALL.r, len = (a1 - a0) * WALL.r + 0.06, ry = -am + Math.PI / 2;
    box(P.get('brick'), x, WALL.h / 2, z, len, WALL.h, 0.9, { ry, faces: 'zZY' });
    if (!lod) box(P.get('glzB'), x, WALL.h + 0.2, z, len, 0.4, 1.3, { ry, faces: 'zZYy' });
  }
  // 琉璃门: the three-door south gate
  P.at(0, 0, WALL.cz + WALL.r, 0, () => {
    gatePlatform(P, { hw: 9.2, hd: 0.7, h: 4.6, batter: 0, key: 'redWall', arches: [{ x: -5.2, w: 2.2, h: 3.4 }, { x: 0, w: 2.6, h: 3.8 }, { x: 5.2, w: 2.2, h: 3.4 }], parapet: { h: 0.4, t: 1.4, key: 'glzB', coping: 'glzB' }, tunnelGlow: 0.1, lod });
  });
  // 东西配殿: five-bay side halls with blue roofs, facing the court
  for (const sx of [-1, 1]) {
    P.push(new THREE.Matrix4().makeRotationY(sx * Math.PI / 2).setPosition(sx * 19.6, 0, 24.6));
    const t = terrace(P, { tiers: [{ hw: 8.6, hd: 3.8, h: 0.9 }], rail: false, topKey: 'paving', lod });
    hall(P, { y0: t, xs: bays(5, 14.4, 0.85), zs: [-2.3, 2.3], colH: 3.6, colR: 0.25, front: 'mixed', back: 'wall', sides: 'wall', beamH: 0.45, bracketH: 0.5, bracketOut: 0.5,
      roof: { kind: 'hipGable', tile: 'B', overhang: 1.3, rise: 3.0, curve: 0.55, lift: 0.4, beasts: 3 }, lod });
    P.pop();
  }
}

function build(env: EnvUniforms): LandmarkModel {
  const mats = landmarkMaterials(env);
  const P = new Parts(), F = new Parts();
  const flood = floodGlow({ base: 0.25, front: 0.2, under: 0.9, top: 0.2, foot: 0.45, footH: 4, above: 0.2, aboveY: 2.4 });
  P.ctx.glow = flood; F.ctx.glow = flood;
  body(P, false); body(F, true);
  const colliders: ColliderSpec[] = [
    { kind: 'cylinder', center: [0, 1.15, 0], radius: 11.2, halfHeight: 1.15 },
    { kind: 'cylinder', center: [0, 8, 0], radius: 7.5, halfHeight: 6 },
  ];
  for (let i = 0; i < 20; i++) {
    const a = ((i + 0.5) / 20) * Math.PI * 2;
    if (Math.abs(a - Math.PI / 2) < 0.3) continue;
    colliders.push({ kind: 'box', center: [Math.cos(a) * WALL.r, WALL.h / 2, WALL.cz + Math.sin(a) * WALL.r], half: [5.2, WALL.h / 2, 0.45], yaw: -a + Math.PI / 2 });
  }
  for (const sx of [-1, 1]) colliders.push({ kind: 'box', center: [sx * 19.6, 3, 24.6], half: [3.8, 3, 8.6] });
  return assemble({ name: 'huangqiongyu', detail: P, far: F, mats, colliders, footprint: circlePoly(WALL.r + 1, 32, 0, WALL.cz), height: 19.02 });
}

export const huangqiongyu: LandmarkDef = {
  id: 'huangqiongyu', name: { zh: '天坛皇穹宇', en: 'Imperial Vault of Heaven' },
  lat: 39.877144, lon: 116.406922, headingDeg: -1.53, build,
};
