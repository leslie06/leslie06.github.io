import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { Parts, circlePoly, floodGlow } from './kit/geo';
import { landmarkMaterials } from './kit/mats';
import { terrace, sumeru, roundStory } from './kit/hall';
import { roof } from './kit/roof';
import { assemble } from './kit/model';

/**
 * 天坛祈年殿 Hall of Prayer for Good Harvests on the 祈谷坛: a three-tier round white-marble terrace
 * (91 / 80 / 68 m, 5.7 m high, balustrades, stairs on four sides with a carved 御路 ramp north and
 * south), and the round hall: 12 outer columns with lattice doors all round, two lattice drums, three
 * tiers of deep-blue glazed eaves (32.7 / 26 / 20 m) and a gilded finial, 38 m above the terrace.
 */
function body(P: Parts, lod: boolean): number {
  const top = terrace(P, {
    tiers: [{ hw: 45.5, hd: 45.5, h: 1.9, round: true }, { hw: 39.8, hd: 39.8, h: 1.9, round: true }, { hw: 34.2, hd: 34.2, h: 1.9, round: true }],
    stairs: [{ side: 'S', w: 10, ramp: 2.8 }, { side: 'N', w: 10, ramp: 2.8 }, { side: 'E', w: 4.5 }, { side: 'W', w: 4.5 }],
    topKey: 'paving', railStep: 1.6, lod,
  });
  sumeru(P, 'marble', 17.6, 17.6, top, 0.85, { round: true, top: 'paving', plain: lod });
  const y0 = top + 0.85;
  const res = lod ? 0.35 : 1;
  const s1 = roundStory(P, { y0, r: 12.1, n: 12, colH: 6.3, colR: 0.5, fill: 'doors', beamH: 0.9, bracketH: 1.1, bracketOut: 1.2, lod });
  const in1 = s1.top + 0.15 + 3.8;
  roof(P, { kind: 'round', y0: s1.top + 0.15, y1: in1, hw: 16.4, hd: 0, inner: { hw: 9.2, hd: 0, y: in1 }, wall: s1.wall, tile: 'B', curve: 0.3, lift: 0.5, res, lod });
  const s2 = roundStory(P, { y0: in1 - 0.5, r: 8.8, n: 12, colH: 2.7, colR: 0.4, fill: 'windows', beamH: 0.8, bracketH: 1.0, bracketOut: 1.0, plinth: false, lod });
  const in2 = s2.top + 0.15 + 3.2;
  roof(P, { kind: 'round', y0: s2.top + 0.15, y1: in2, hw: 13.0, hd: 0, inner: { hw: 6.6, hd: 0, y: in2 }, wall: s2.wall, tile: 'B', curve: 0.3, lift: 0.4, res, lod });
  const s3 = roundStory(P, { y0: in2 - 0.5, r: 6.2, n: 12, colH: 2.5, colR: 0.34, fill: 'windows', beamH: 0.7, bracketH: 0.9, bracketOut: 0.9, plinth: false, lod });
  roof(P, { kind: 'round', y0: s3.top + 0.15, y1: s3.top + 0.15 + 8.9, hw: 9.9, hd: 0, ridge: 0.9, wall: s3.wall, tile: 'B', curve: 0.38, lift: 0.35, finial: 5.0, res, lod });
  return s3.top + 0.15 + 8.9 + 5.0;
}

function build(env: EnvUniforms): LandmarkModel {
  const mats = landmarkMaterials(env);
  const P = new Parts(), F = new Parts();
  const flood = floodGlow({ base: 0.2, front: 0.2, under: 1.0, top: 0.2, foot: 0.5, footH: 4, above: 0.3, aboveY: 6.5 });
  P.ctx.glow = flood; F.ctx.glow = flood;
  const height = body(P, false); body(F, true);
  const colliders: ColliderSpec[] = [
    { kind: 'cylinder', center: [0, 0.95, 0], radius: 45.5, halfHeight: 0.95 },
    { kind: 'cylinder', center: [0, 1.9, 0], radius: 39.8, halfHeight: 1.9 },
    { kind: 'cylinder', center: [0, 2.85, 0], radius: 34.2, halfHeight: 2.85 },
    { kind: 'cylinder', center: [0, 20, 0], radius: 13.5, halfHeight: 14 },
  ];
  return assemble({ name: 'qiniandian', detail: P, far: F, mats, colliders, footprint: circlePoly(46, 32), height: Math.round(height * 10) / 10 });
}

export const qiniandian: LandmarkDef = {
  id: 'qiniandian', name: { zh: '天坛祈年殿', en: 'Hall of Prayer for Good Harvests' },
  lat: 39.882249, lon: 116.406618, headingDeg: -2.2, build,
};
