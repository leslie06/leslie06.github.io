import * as THREE from 'three';
import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { Parts, box, cyl, lathe, rectPoly, floodGlow, type GlowFn } from './kit/geo';
import { landmarkMaterials, nightGlow } from './kit/mats';
import { gatePlatform, hall, bays, terrace, type HallSpec } from './kit/hall';
import { textTex, CJK } from './kit/tex';
import { assemble } from './kit/model';
import { marbleBridge, huabiao } from './kit/props';

/**
 * 天安门 Tiananmen, the Gate of Heavenly Peace. Local frame: +X east, +Z south (the front, facing the
 * square). Red platform 118 x 39 m, 13.4 m high, on a marble plinth, five arched gateways; the
 * 9 x 5 bay gate tower with a double-eaved 歇山 roof of yellow glazed tiles, 34.7 m to the top of the
 * ridge ornaments. Eight red lanterns in the front colonnade, the national emblem between the
 * eaves, the portrait and the two slogans on the platform. Extras: the five 外金水桥 marble bridges
 * over the moat and the two front 华表.
 */
const PLAT = { hw: 58.95, hd: 19.4, h: 13.4, batter: 0.9 };
const ARCHES = [{ x: 0, w: 5.3, h: 8.0 }, { x: -16.5, w: 4.4, h: 7.2 }, { x: 16.5, w: 4.4, h: 7.2 }, { x: -32, w: 3.8, h: 6.2 }, { x: 32, w: 3.8, h: 6.2 }];

const flood: GlowFn = floodGlow({ base: 0.18, front: 0.3, under: 0.9, top: 0.2, foot: 0.6, footH: 6, above: 0.35, aboveY: 13.5 });

function hallSpec(y0: number, lod: boolean): HallSpec {
  return {
    y0, xs: bays(9, 56, 0.8), zs: bays(5, 21, 0.8), colH: 5.6, colR: 0.45, corridor: 3.0,
    front: 'mixed', back: 'mixed', sides: 'wall', beamH: 0.85, bracketH: 1.0, bracketOut: 1.1,
    roof: { kind: 'hipGable', tile: 'Y', overhang: 3.2, rise: 5.6, curve: 0.6, lift: 1.2, beasts: 9 },
    double: { inset: 5.6, insetZ: 2.8, h: 1.4, skirtRise: 2.3, front: 'windows', back: 'windows', sides: 'wall' },
    lod,
  };
}

const decalCache = new WeakMap<EnvUniforms, Record<string, THREE.Material>>();
function decals(env: EnvUniforms): Record<string, THREE.Material> {
  let d = decalCache.get(env);
  if (d) return d;
  const portrait = textTex('tam.portrait', 320, 250, (g, w, h) => {
    g.fillStyle = '#3a2a1a'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#b08a3c'; g.fillRect(6, 6, w - 12, h - 12);
    const bg = g.createLinearGradient(0, 0, 0, h); bg.addColorStop(0, '#a9b4b8'); bg.addColorStop(1, '#8e9aa0');
    g.fillStyle = bg; g.fillRect(16, 16, w - 32, h - 32);
    // a painted head-and-shoulders figure
    g.fillStyle = '#4c5650'; g.beginPath(); g.ellipse(w / 2, h * 1.02, w * 0.36, h * 0.42, 0, Math.PI, 0); g.fill();
    g.fillStyle = '#3f4843'; g.beginPath(); g.moveTo(w * 0.42, h * 0.6); g.lineTo(w / 2, h * 0.78); g.lineTo(w * 0.58, h * 0.6); g.fill();
    g.fillStyle = '#d9a98a'; g.beginPath(); g.ellipse(w / 2, h * 0.42, w * 0.12, h * 0.2, 0, 0, Math.PI * 2); g.fill();
    g.fillStyle = '#2a2522'; g.beginPath(); g.ellipse(w / 2, h * 0.29, w * 0.125, h * 0.09, 0, Math.PI, 0); g.fill();
    g.fillStyle = 'rgba(120,70,50,0.35)'; g.beginPath(); g.ellipse(w / 2, h * 0.5, w * 0.06, h * 0.03, 0, 0, Math.PI * 2); g.fill();
  });
  const slogan = (key: string, text: string) => textTex(key, 2048, 184, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#f5f1e6';
    g.font = `900 ${Math.round(h * 0.84)}px ${CJK}`;
    g.textBaseline = 'middle'; g.textAlign = 'center';
    g.strokeStyle = '#f5f1e6'; g.lineWidth = h * 0.045; g.lineJoin = 'round';
    const n = text.length;
    for (let i = 0; i < n; i++) { g.fillText(text[i], (i + 0.5) * w / n, h * 0.54); g.strokeText(text[i], (i + 0.5) * w / n, h * 0.54); }
  });
  const emblem = textTex('tam.emblem', 256, 256, (g, w) => {
    const c = w / 2;
    g.fillStyle = '#d9a53c'; g.beginPath(); g.arc(c, c, c - 2, 0, Math.PI * 2); g.fill();
    g.strokeStyle = '#a8761c'; g.lineWidth = 3;
    for (let k = 0; k < 40; k++) { const a = (k / 40) * Math.PI * 2; g.beginPath(); g.moveTo(c + Math.cos(a) * (c - 6), c + Math.sin(a) * (c - 6)); g.lineTo(c + Math.cos(a + 0.12) * (c - 26), c + Math.sin(a + 0.12) * (c - 26)); g.stroke(); }
    g.fillStyle = '#c3261a'; g.beginPath(); g.arc(c, c, c - 30, 0, Math.PI * 2); g.fill();
    const star = (x: number, y: number, r: number) => { g.beginPath(); for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.4 : r; g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } g.fill(); };
    g.fillStyle = '#f2c14e'; star(c, c * 0.62, 22);
    for (let i = 0; i < 4; i++) { const a = -Math.PI * 0.85 + i * 0.28; star(c + Math.cos(a) * 62 * 0.95, c * 0.72 + Math.sin(a) * 50, 8); }
    g.fillRect(c - 44, c + 18, 88, 10); g.fillRect(c - 36, c + 2, 72, 16); g.fillRect(c - 50, c + 28, 100, 22);
    g.beginPath(); g.moveTo(c - 44, c + 4); g.lineTo(c, c - 12); g.lineTo(c + 44, c + 4); g.fill();
    g.beginPath(); g.arc(c, c + 76, 18, 0, Math.PI * 2); g.fill();
  });
  const std = (map: THREE.Texture, p: THREE.MeshStandardMaterialParameters = {}) => nightGlow(new THREE.MeshStandardMaterial({ map, roughness: 0.6, ...p }), env, 'flood', '#ffd8a8');
  d = {
    tamPortrait: std(portrait, { roughness: 0.45 }),
    tamSloganW: std(slogan('tam.sloganW', '中华人民共和国万岁'), { alphaTest: 0.5 }),
    tamSloganE: std(slogan('tam.sloganE', '世界人民大团结万岁'), { alphaTest: 0.5 }),
    tamEmblem: std(emblem, { metalness: 0.5, roughness: 0.35 }),
  };
  decalCache.set(env, d);
  return d;
}

/** Quad leaning back with the platform batter at height y0..y1 (face z at y is hd - batter * y / h). */
function wallDecal(P: Parts, key: string, x0: number, x1: number, y0: number, y1: number, off = 0.12): void {
  const z = (y: number) => PLAT.hd - PLAT.batter * (y / PLAT.h) + off;
  P.get(key).poly([[x0, y0, z(y0)], [x1, y0, z(y0)], [x1, y1, z(y1)], [x0, y1, z(y1)]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
}

function lantern(P: Parts, x: number, y: number, z: number, r: number, h: number): void {
  P.glow(0.4, () => {
    const prof: [number, number][] = [];
    for (let i = 0; i <= 8; i++) { const t = i / 8; prof.push([r * (0.55 + 0.45 * Math.sin(Math.PI * t)), y - h / 2 + t * h]); }
    lathe(P.get('lantern'), prof, 14, x, z);
  });
  cyl(P.get('gold'), x, y - h / 2 - 0.12, z, r * 0.56, r * 0.56, 0.16, 12);
  cyl(P.get('gold'), x, y + h / 2 - 0.04, z, r * 0.56, r * 0.5, 0.18, 12);
  cyl(P.get('red'), x, y - h / 2 - 0.9, z, 0.08, 0.2, 0.8, 6);
}

function build(env: EnvUniforms): LandmarkModel {
  const mats = { ...landmarkMaterials(env), ...decals(env) };
  const P = new Parts(), F = new Parts(), X = new Parts();
  P.ctx.glow = flood; X.ctx.glow = flood; F.ctx.glow = flood;
  const top = gatePlatform(P, { ...PLAT, key: 'redWall', arches: ARCHES, base: { h: 1.6, out: 0.55, key: 'marble' }, parapet: { h: 1.1, t: 0.8, key: 'redWall', coping: 'glzY' }, topKey: 'paving', tunnelGlow: 0.16 });
  const baseTop = terrace(P, { tiers: [{ hw: 30.6, hd: 13.2, h: 1.2 }], y0: top, topKey: 'paving', railH: 1.0 });
  const spec = hallSpec(baseTop, false);
  const res = hall(P, spec);
  // lanterns in the front colonnade, all bays but the centre
  const xs = spec.xs, zmax = spec.zs[spec.zs.length - 1];
  for (let i = 0; i < xs.length - 1; i++) if (i !== 4) lantern(P, (xs[i] + xs[i + 1]) / 2, baseTop + 3.2, zmax - 1.4, 1.0, 2.1);
  // national emblem between the eaves
  const ez = zmax - 2.8 + 0.3 + 1.1 + 0.6;
  P.glow(1.3, () => {
    P.get('tamEmblem').poly([[-1.25, res.eaveY[0] + 2.1, ez], [1.25, res.eaveY[0] + 2.1, ez], [1.25, res.eaveY[0] + 4.6, ez], [-1.25, res.eaveY[0] + 4.6, ez]], [[0, 0], [1, 0], [1, 1], [0, 1]]);
    // portrait and slogans on the platform
    wallDecal(P, 'tamPortrait', -3.2, 3.2, 8.25, 13.15, 0.2);
  });
  P.glow(0.9, () => {
    wallDecal(P, 'tamSloganW', -29.5, -5.4, 10.0, 11.9);
    wallDecal(P, 'tamSloganE', 5.4, 29.5, 10.0, 11.9);
  });
  box(P.get('red'), 0, 10.7, PLAT.hd - PLAT.batter * (10.7 / PLAT.h) + 0.08, 6.9, 5.4, 0.14);   // portrait frame backing

  // extras: 外金水桥 (5 marble bridges over the moat) and the two front 华表
  const bridges: [number, number, number][] = [[0, 9.7, 41], [-13.8, 7.7, 35], [13.8, 7.7, 35], [-24.8, 6.5, 34], [24.8, 6.5, 34]];
  for (const [x, w, l] of bridges) marbleBridge(X, x, 63, w, l, x === 0 ? 1.7 : 1.35);
  for (const sx of [-1, 1]) huabiao(X, sx * 21, 88, 9.6);

  // far LOD
  gatePlatform(F, { ...PLAT, key: 'redWall', lod: true });
  const fb = terrace(F, { tiers: [{ hw: 30.6, hd: 13.2, h: 1.2 }], y0: PLAT.h, lod: true, rail: false });
  hall(F, hallSpec(fb, true));

  const colliders: ColliderSpec[] = [];
  // piers between the arches and lintels over them, so the tunnels stay open
  let x0 = -PLAT.hw;
  for (const a of [...ARCHES].sort((p, q) => p.x - q.x)) {
    const x1 = a.x - a.w / 2;
    colliders.push({ kind: 'box', center: [(x0 + x1) / 2, 7.2, 0], half: [(x1 - x0) / 2, 7.2, PLAT.hd] });
    colliders.push({ kind: 'box', center: [a.x, (a.h + 14.4) / 2, 0], half: [a.w / 2, (14.4 - a.h) / 2, PLAT.hd] });
    x0 = a.x + a.w / 2;
  }
  colliders.push({ kind: 'box', center: [(x0 + PLAT.hw) / 2, 7.2, 0], half: [(PLAT.hw - x0) / 2, 7.2, PLAT.hd] });
  colliders.push({ kind: 'box', center: [0, 24, 0], half: [31, 10, 13.5] });
  for (const sx of [-1, 1]) colliders.push({ kind: 'cylinder', center: [sx * 21, 5, 88], radius: 1.4, halfHeight: 5 });

  return assemble({
    name: 'tiananmen', detail: P, far: F, extras: X, mats, colliders,
    footprint: rectPoly(PLAT.hw + 0.6, PLAT.hd + 0.6), height: 34.7,
  });
}

export const tiananmen: LandmarkDef = {
  id: 'tiananmen',
  name: { zh: '天安门', en: 'Tiananmen' },
  lat: 39.907338, lon: 116.391265, headingDeg: -1.84,
  build,
};

