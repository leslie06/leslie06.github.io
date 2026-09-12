import * as THREE from 'three';
import type { ColliderSpec, EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { Parts, box, hexa, flat, walls, rectPoly, floodGlow, type V3 } from './kit/geo';
import { landmarkMaterials, nightGlow } from './kit/mats';
import { balustrade, sumeru } from './kit/hall';
import { textTex, CJK_SERIF } from './kit/tex';
import { assemble } from './kit/model';

/**
 * 人民英雄纪念碑 Monument to the People's Heroes, 37.94 m. Local frame: the inscription face
 * (north, towards Tiananmen) is -Z. Two terraces with white balustrades (the lower 海棠-shaped,
 * 50.4 x 61.5 m), a large sumeru with the marble relief band, a smaller flowered sumeru, the tapered
 * granite shaft with the gilded 人民英雄永垂不朽 on the north and the long inscription on the south,
 * and the 盝顶 cap.
 */
const LOW = { hw: 25.2, hd: 30.75, h: 1.35, notch: 4.2 };
const UP = { hw: 15.5, hd: 18.5, h: 1.45, notch: 2.6 };

function haitang(hw: number, hd: number, n: number): [number, number][] {
  return [[-hw + n, -hd], [hw - n, -hd], [hw - n, -hd + n], [hw, -hd + n], [hw, hd - n], [hw - n, hd - n], [hw - n, hd], [-hw + n, hd], [-hw + n, hd - n], [-hw, hd - n], [-hw, -hd + n], [-hw + n, -hd + n]];
}

const matCache = new WeakMap<EnvUniforms, Record<string, THREE.Material>>();
function mats(env: EnvUniforms): Record<string, THREE.Material> {
  let m = matCache.get(env);
  if (m) return m;
  const main = textTex('mon.main', 160, 1280, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#e8c15a'; g.textAlign = 'center'; g.textBaseline = 'middle';
    g.font = `900 ${w * 0.86}px ${CJK_SERIF}`;
    const t = '人民英雄永垂不朽';
    for (let i = 0; i < t.length; i++) g.fillText(t[i], w / 2, (i + 0.5) * h / t.length);
  });
  const back = textTex('mon.back', 512, 1024, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.fillStyle = '#e2bb55'; g.textAlign = 'center'; g.textBaseline = 'middle';
    const lines = ['三年以来在人民解放战争和人民革命中', '牺牲的人民英雄们永垂不朽', '三十年以来在人民解放战争和人民革命中', '牺牲的人民英雄们永垂不朽',
      '由此上溯到一千八百四十年从那时起为了', '反对内外敌人争取民族独立和人民自由幸福', '在历次斗争中牺牲的人民英雄们永垂不朽'];
    const cols = lines.length, cw = w / (cols + 1);
    g.font = `700 ${cw * 0.7}px ${CJK_SERIF}`;
    lines.forEach((ln, c) => { const x = w - (c + 1) * cw; for (let i = 0; i < ln.length; i++) g.fillText(ln[i], x, 40 + i * (h - 80) / 20); });
  });
  const relief = textTex('mon.relief', 1024, 128, (g, w, h) => {
    g.fillStyle = '#e6e1d6'; g.fillRect(0, 0, w, h);
    // a crowd in relief: shaded figures, flags and rifles
    let seed = 7; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 90; i++) {
      const x = rnd() * w, s = 0.7 + rnd() * 0.5, lean = (rnd() - 0.5) * 0.4;
      const grd = g.createLinearGradient(x - 10, 0, x + 10, 0); grd.addColorStop(0, '#f6f3ec'); grd.addColorStop(1, '#a8a397');
      g.fillStyle = grd;
      g.beginPath(); g.ellipse(x, h * 0.62, 9 * s, h * 0.3 * s, lean, 0, Math.PI * 2); g.fill();
      g.beginPath(); g.arc(x + lean * 20, h * 0.26, 6 * s, 0, Math.PI * 2); g.fill();
      if (rnd() < 0.12) { g.strokeStyle = '#9c978b'; g.lineWidth = 2; g.beginPath(); g.moveTo(x, h * 0.9); g.lineTo(x + 18, h * 0.05); g.stroke(); g.fillStyle = '#d7d2c6'; g.fillRect(x + 18, h * 0.05, 30, 16); }
    }
    g.strokeStyle = '#b8b3a6'; g.lineWidth = 4; g.strokeRect(2, 2, w - 4, h - 4);
  });
  const glow = (mm: THREE.MeshStandardMaterial) => nightGlow(mm, env, 'flood', '#fff1dc');
  m = {
    ...landmarkMaterials(env),
    monMain: glow(new THREE.MeshStandardMaterial({ map: main, metalness: 0.8, roughness: 0.3, alphaTest: 0.5 })),
    monBack: glow(new THREE.MeshStandardMaterial({ map: back, metalness: 0.8, roughness: 0.3, alphaTest: 0.5 })),
    monRelief: glow(new THREE.MeshStandardMaterial({ map: relief, roughness: 0.6 })),
  };
  matCache.set(env, m);
  return m;
}

function terraceTier(P: Parts, t: typeof LOW, y0: number, lod: boolean): number {
  const poly = haitang(t.hw, t.hd, t.notch);
  walls(P.get('granite'), poly, y0, y0 + t.h);
  flat(P.get('paving'), poly, y0 + t.h);
  if (lod) return y0 + t.h;
  const inset = 0.3;
  const railPoly = haitang(t.hw - inset, t.hd - inset, t.notch);
  const sw = { N: 12, S: 12, E: 8, W: 8 };
  const gap = (x: number, z: number) => (Math.abs(x) < sw.N / 2 + 0.3 && Math.abs(z) > t.hd - 1.5) || (Math.abs(z) < sw.E / 2 + 0.3 && Math.abs(x) > t.hw - 1.5);
  balustrade(P, railPoly, y0 + t.h, { closed: true, gap, h: 1.05 });
  // stairs on the four axes
  const n = Math.round(t.h / 0.15), rr = t.h / n, tr = 0.34;
  for (const [side, w] of [['N', sw.N], ['S', sw.S], ['E', sw.E], ['W', sw.W]] as const) {
    const ry = { S: 0, N: Math.PI, E: Math.PI / 2, W: -Math.PI / 2 }[side];
    const edge = side === 'N' || side === 'S' ? t.hd : t.hw;
    P.push(new THREE.Matrix4().makeRotationY(ry).setPosition(side === 'E' ? edge : side === 'W' ? -edge : 0, 0, side === 'S' ? edge : side === 'N' ? -edge : 0));
    for (let i = 0; i < n; i++) box(P.get('granite'), 0, y0 + (i + 0.5) * rr, (n - i - 0.5) * tr, w, rr * (i + 1) > 0 ? rr : rr, tr + 0.02, { faces: 'zZY' });
    for (let i = 0; i < n; i++) box(P.get('granite'), 0, y0 + (i * rr) / 2, (n - i - 0.5) * tr, w, i * rr + 0.001, tr, { faces: 'Z' });
    P.pop();
  }
  return y0 + t.h;
}

function body(P: Parts, lod: boolean): { top: number } {
  let y = terraceTier(P, LOW, 0, lod);
  y = terraceTier(P, UP, y, lod);
  // large sumeru with the relief band set in its waist
  sumeru(P, 'granite', 7.3, 5.2, y, 4.1, { top: 'granite', plain: lod });
  if (!lod) {
    const rb = P.get('monRelief'), yr0 = y + 1.15, yr1 = y + 2.95;
    const faces: [V3, V3][] = [[[-7.0, 0, 4.95], [7.0, 0, 4.95]], [[7.0, 0, -4.95], [-7.0, 0, -4.95]], [[7.05, 0, 4.9], [7.05, 0, -4.9]], [[-7.05, 0, -4.9], [-7.05, 0, 4.9]]];
    for (const [a, b] of faces) rb.poly([[a[0], yr0, a[2]], [b[0], yr0, b[2]], [b[0], yr1, b[2]], [a[0], yr1, a[2]]], [[0, 0], [Math.hypot(b[0] - a[0], b[2] - a[2]) / 7, 0], [Math.hypot(b[0] - a[0], b[2] - a[2]) / 7, 1], [0, 1]]);
  }
  y += 4.1;
  sumeru(P, 'granite', 4.9, 3.5, y, 2.6, { top: 'granite', plain: lod });
  y += 2.6;
  // shaft
  const s0 = y, s1 = 35.0;
  const shaft: V3[] = [[-2.45, s0, -1.75], [2.45, s0, -1.75], [2.45, s0, 1.75], [-2.45, s0, 1.75], [-2.2, s1, -1.55], [2.2, s1, -1.55], [2.2, s1, 1.55], [-2.2, s1, 1.55]];
  hexa(P.get('granite'), shaft, { top: false });
  // cornice and 盝顶 cap
  const g = P.get('granite');
  box(g, 0, s1 + 0.2, 0, 5.2, 0.4, 3.9);
  hexa(g, [[-2.9, s1 + 0.4, -2.2], [2.9, s1 + 0.4, -2.2], [2.9, s1 + 0.4, 2.2], [-2.9, s1 + 0.4, 2.2], [-2.0, 37.1, -1.35], [2.0, 37.1, -1.35], [2.0, 37.1, 1.35], [-2.0, 37.1, 1.35]], { bottom: true });
  box(g, 0, 37.52, 0, 3.6, 0.84, 2.4);
  if (!lod) {
    // inscriptions: north face (-z) and south face (+z), following the taper
    const zN = (yy: number) => -(1.75 + (1.55 - 1.75) * (yy - s0) / (s1 - s0)) - 0.02;
    // heart stone (a lighter panel following the taper), then the gilded inscriptions just in front
    const panel = (x0: number, x1: number, y0: number, y1: number, off: number, north: boolean) => {
      const z0 = (north ? zN(y0) : -zN(y0)) + (north ? -off : off), z1 = (north ? zN(y1) : -zN(y1)) + (north ? -off : off);
      const pts: V3[] = north ? [[x1, y0, z0], [x0, y0, z0], [x0, y1, z1], [x1, y1, z1]] : [[x0, y0, z0], [x1, y0, z0], [x1, y1, z1], [x0, y1, z1]];
      return pts;
    };
    P.get('marble').poly(panel(-1.55, 1.55, 15.2, 33.4, 0.01, true), [[0, 15.2], [3.1, 15.2], [3.1, 33.4], [0, 33.4]]);
    P.get('marble').poly(panel(-2.0, 2.0, 16.8, 32.2, 0.01, false), [[0, 16.8], [4, 16.8], [4, 32.2], [0, 32.2]]);
    P.glow(0.9, () => {
      P.get('monMain').poly(panel(-1.1, 1.1, 15.8, 32.8, 0.04, true), [[0, 0], [1, 0], [1, 1], [0, 1]]);
      P.get('monBack').poly(panel(-1.8, 1.8, 17.5, 31.5, 0.04, false), [[0, 0], [1, 0], [1, 1], [0, 1]]);
    });
  }
  return { top: 37.94 };
}

function build(env: EnvUniforms): LandmarkModel {
  const m = mats(env);
  const P = new Parts(), F = new Parts();
  const flood = floodGlow({ base: 0.26, front: 0.0, under: 0.5, top: 0.2, foot: 0.3, footH: 10 });
  P.ctx.glow = flood; F.ctx.glow = flood;
  body(P, false); body(F, true);
  const colliders: ColliderSpec[] = [
    { kind: 'box', center: [0, LOW.h / 2, 0], half: [LOW.hw, LOW.h / 2, LOW.hd] },
    { kind: 'box', center: [0, LOW.h + UP.h / 2, 0], half: [UP.hw, UP.h / 2, UP.hd] },
    { kind: 'box', center: [0, 6, 0], half: [7.3, 3.4, 5.2] },
    { kind: 'box', center: [0, 22.5, 0], half: [2.45, 13, 1.75] },
  ];
  return assemble({ name: 'monument', detail: P, far: F, mats: m, colliders, footprint: rectPoly(28.6, 34.2), height: 37.94 });
}

export const monument: LandmarkDef = {
  id: 'monument', name: { zh: '人民英雄纪念碑', en: "Monument to the People's Heroes" },
  lat: 39.903197, lon: 116.391425, headingDeg: -1.74, build,
};
