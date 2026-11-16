import * as THREE from 'three';

/**
 * 飞机模型（2026-11-16，第二批）：程序生成，三种机型——0 窄体双发（38 米）、1 宽体双发（64 米）、2 公务机（21 米，尾吊发动机、
 * T 型尾）。都是通用外形，不照任何真实型号的细节。
 *
 * 每种分三块网格：`body`（白机身、灰机腹、舷窗带、驾驶舱窗、机翼、起落架舱门这些固定颜色，顶点色）、`livery`（垂尾、腰线、发动机罩：
 * 顶点色是白的，按实例乘上航空公司的颜色——一张实例网格就能有几家涂装）、`gear`（起落架，起飞后收起来就不画）。两档：`detail`
 * 近处用（约 2.5 千三角形），远处一档几百个。
 *
 * 坐标：机头朝 +Z，+Y 向上，y = 0 是地面（起落架放下时轮子着地），原点在机身中点的正下方。
 */
export type PlaneKind = 0 | 1 | 2;

export interface PlaneDims {
  /** 机长、翼展、机身半径、机身中心离地高。 */
  len: number; span: number; r: number; h: number;
  /** 机翼弦长中点离机身中点（沿 z）、翼根弦长：碰撞体用。 */
  wingZ: number; chord: number;
  /** 垂尾顶离地高。 */
  top: number;
  /** 发动机：[x, y, z, 半径]（一侧），y 是离地高。 */
  eng: [number, number, number, number];
  /** 左前登机门（廊桥接的那个门，机头朝 +Z 时左手是 +X）：[x, y, z]。 */
  door: [number, number, number];
}

const C = (hex: string) => new THREE.Color(hex);
const WHITE = C('#f1f2f3'), BELLY = C('#c4c8cd'), WINDOW = C('#1b232c'), WING = C('#c0c5ca'), DARK = C('#2a2d31'), TYRE = C('#18191a'),
  STRUT = C('#9da2a8'), FAN = C('#3c4046'), LIV = C('#ffffff');

class Mesh {
  pos: number[] = []; nrm: number[] = []; col: number[] = [];
  tri(a: THREE.Vector3, b: THREE.Vector3, c: THREE.Vector3, col: THREE.Color, na?: THREE.Vector3, nb?: THREE.Vector3, nc?: THREE.Vector3): void {
    const n = new THREE.Vector3().subVectors(b, a).cross(new THREE.Vector3().subVectors(c, a)).normalize();
    for (const [p, q] of [[a, na], [b, nb], [c, nc]] as const) {
      this.pos.push(p.x, p.y, p.z);
      const m = q ?? n; this.nrm.push(m.x, m.y, m.z);
      this.col.push(col.r, col.g, col.b);
    }
  }
  geometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(this.nrm, 3));
    g.setAttribute('color', new THREE.Float32BufferAttribute(this.col, 3));
    g.computeBoundingSphere();
    return g;
  }
}

const V = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);

/**
 * 一个六面体（机翼、尾翼、挂架、起落架支柱）：a 是一头的四个角，b 是另一头的四个角，顺序一致。每个面朝外（按中心定方向）。
 */
function prism(m: Mesh, a: THREE.Vector3[], b: THREE.Vector3[], col: THREE.Color): void {
  const c = new THREE.Vector3();
  for (const p of [...a, ...b]) c.add(p);
  c.multiplyScalar(1 / 8);
  const quad = (p: THREE.Vector3, q: THREE.Vector3, r: THREE.Vector3, s: THREE.Vector3) => {
    const n = new THREE.Vector3().subVectors(q, p).cross(new THREE.Vector3().subVectors(r, p));
    const f = new THREE.Vector3().addVectors(p, r).multiplyScalar(0.5).sub(c);
    if (n.dot(f) < 0) { m.tri(p, s, r, col); m.tri(p, r, q, col); } else { m.tri(p, q, r, col); m.tri(p, r, s, col); }
  };
  quad(a[0], a[1], a[2], a[3]);
  quad(b[0], b[1], b[2], b[3]);
  for (let i = 0; i < 4; i++) { const j = (i + 1) % 4; quad(a[i], a[j], b[j], b[i]); }
}

/** 一块翼面（左右对称各一块）：翼根前缘/后缘的 z、翼尖前缘/后缘的 z，翼根/翼尖的 x、y，厚度。 */
function wingPair(m: Mesh, rLE: number, rTE: number, tLE: number, tTE: number, xr: number, xt: number, yr: number, yt: number, thR: number, thT: number, col: THREE.Color): void {
  for (const s of [1, -1]) {
    const a = [V(s * xr, yr + thR / 2, rLE), V(s * xr, yr + thR / 2, rTE), V(s * xr, yr - thR / 2, rTE), V(s * xr, yr - thR / 2, rLE)];
    const b = [V(s * xt, yt + thT / 2, tLE), V(s * xt, yt + thT / 2, tTE), V(s * xt, yt - thT / 2, tTE), V(s * xt, yt - thT / 2, tLE)];
    prism(m, a, b, col);
  }
}

/** 竖着的翼面（垂尾、小翼）：底边在 y0（x = 0 附近，厚 th），顶边在 y1。 */
function fin(m: Mesh, x: number, y0: number, y1: number, bLE: number, bTE: number, tLE: number, tTE: number, th0: number, th1: number, col: THREE.Color): void {
  const a = [V(x - th0 / 2, y0, bLE), V(x - th0 / 2, y0, bTE), V(x + th0 / 2, y0, bTE), V(x + th0 / 2, y0, bLE)];
  const b = [V(x - th1 / 2, y1, tLE), V(x - th1 / 2, y1, tTE), V(x + th1 / 2, y1, tTE), V(x + th1 / 2, y1, tLE)];
  prism(m, a, b, col);
}

/** 沿 z 的旋转体（发动机短舱、机轮横过来用 axis 'x'）：截面 [z, r]，n 等分。 */
function lathe(m: Mesh, cx: number, cy: number, cz: number, prof: [number, number][], n: number, col: THREE.Color, axis: 'z' | 'x' = 'z', cap?: THREE.Color): void {
  const pt = (s: number, r: number, a: number) => axis === 'z' ? V(cx + r * Math.sin(a), cy + r * Math.cos(a), cz + s) : V(cx + s, cy + r * Math.cos(a), cz + r * Math.sin(a));
  const nr = (a: number) => axis === 'z' ? V(Math.sin(a), Math.cos(a), 0) : V(0, Math.cos(a), Math.sin(a));
  for (let i = 0; i + 1 < prof.length; i++) for (let k = 0; k < n; k++) {
    const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
    const p00 = pt(prof[i][0], prof[i][1], a0), p01 = pt(prof[i][0], prof[i][1], a1), p10 = pt(prof[i + 1][0], prof[i + 1][1], a0), p11 = pt(prof[i + 1][0], prof[i + 1][1], a1);
    // 外侧朝外：沿轴往前、绕一圈的方向决定绕序
    if (axis === 'z') { m.tri(p00, p10, p11, col, nr(a0), nr(a0), nr(a1)); m.tri(p00, p11, p01, col, nr(a0), nr(a1), nr(a1)); }
    else { m.tri(p00, p11, p10, col, nr(a0), nr(a1), nr(a0)); m.tri(p00, p01, p11, col, nr(a0), nr(a1), nr(a1)); }
  }
  if (cap) {
    // 前端（prof 的最后一个截面）封口：风扇
    const [s, r] = prof[prof.length - 1], c = axis === 'z' ? V(cx, cy, cz + s - r * 0.15) : V(cx + s, cy, cz);
    for (let k = 0; k < n; k++) {
      const a0 = k / n * Math.PI * 2, a1 = (k + 1) / n * Math.PI * 2;
      m.tri(c, pt(s, r * 0.92, a1), pt(s, r * 0.92, a0), cap);
    }
  }
}

interface Spec {
  len: number; r: number; span: number;
  rear: boolean;
}
const SPECS: Spec[] = [
  { len: 38, r: 1.98, span: 34, rear: false },
  { len: 64, r: 2.95, span: 60, rear: false },
  { len: 21, r: 1.0, span: 17, rear: true },
];

/** 按窄体的比例算的尺寸（碰撞体、廊桥、灯的位置用）。 */
export function dims(kind: PlaneKind): PlaneDims {
  const S = SPECS[kind], sx = S.span / 34, sy = S.r / 1.98, sz = S.len / 38;
  const h = 3.9 * sy;
  return {
    len: S.len, span: S.span, r: S.r, h,
    wingZ: -0.8 * sz, chord: 7 * sz,
    top: h + 7.6 * sy * (S.rear ? 1.05 : 1),
    eng: S.rear ? [3.4 * sx, h + 1.09 * sy, -6.5 * sz, 1.1 * sy] : [5.7 * sx, h - 2.3 * sy, 5.6 * sz, 1.0 * sy],
    // 机头朝 +Z 时左手边是 +X
    door: [S.r * 0.98, h + 0.2 * sy, 14.2 * sz],
  };
}

export interface PlaneGeo { body: THREE.BufferGeometry; livery: THREE.BufferGeometry; gear: THREE.BufferGeometry }

export function planeGeometry(kind: PlaneKind, detail: boolean): PlaneGeo {
  const S = SPECS[kind];
  // 先按窄体的「标准单位」建（长 38、半径 1.98、翼展 34），再整体缩放
  const sx = S.span / 34, sy = S.r / 1.98, sz = S.len / 38;
  const body = new Mesh(), liv = new Mesh(), gear = new Mesh();
  const r0 = 1.98;
  // ---- 机身：截面 [z, 半径倍数, 中心 y]
  const prof: [number, number, number][] = [[-19, 0.08, 1.25], [-17.5, 0.45, 1.0], [-15, 0.72, 0.62], [-12, 0.92, 0.22], [-9.5, 1, 0], [13, 1, 0], [15.2, 0.93, -0.08], [16.8, 0.78, -0.2], [18, 0.52, -0.34], [18.8, 0.22, -0.46], [19, 0.02, -0.5]];
  const sec: [number, number, number][] = [];
  const step = detail ? 1.6 : 4.5;
  for (let i = 0; i + 1 < prof.length; i++) {
    const [z0, a0, y0] = prof[i], [z1, a1, y1] = prof[i + 1], n = Math.max(1, Math.ceil((z1 - z0) / step));
    for (let k = 0; k < n; k++) { const t = k / n; sec.push([z0 + (z1 - z0) * t, a0 + (a1 - a0) * t, y0 + (y1 - y0) * t]); }
  }
  sec.push(prof[prof.length - 1]);
  // 绕一圈的角度（从正上方量，度）：舷窗带、腰线那两条附近密一些
  const half = detail ? [0, 22, 42, 54, 58, 66, 78, 82, 92, 104, 122, 145, 165, 180] : [0, 45, 72, 95, 130, 180];
  const ang = [...half, ...half.slice(1, -1).reverse().map((d) => 360 - d)].map((d) => d * Math.PI / 180);
  const cabin = (z: number) => z > -10.5 && z < 13.6;
  const ringPt = (s: [number, number, number], a: number) => V(Math.sin(a) * s[1] * r0, s[2] + Math.cos(a) * s[1] * r0 * 1.03, s[0]);
  const ringN = (a: number) => V(Math.sin(a), Math.cos(a), 0);
  for (let i = 0; i + 1 < sec.length; i++) for (let k = 0; k < ang.length; k++) {
    const a0 = ang[k], a1 = ang[(k + 1) % ang.length];
    const am = Math.acos(Math.cos((a0 + a1) / 2 + (k === ang.length - 1 ? Math.PI : 0))) * 180 / Math.PI; // 离正上方的角度 0..180
    const zm = (sec[i][0] + sec[i + 1][0]) / 2;
    let col = WHITE, target = body;
    if (am > 112) col = BELLY;
    else if (detail && am > 54 && am < 66 && cabin(zm)) col = WINDOW;
    else if (!detail && am > 45 && am < 72 && cabin(zm)) col = WINDOW;
    else if (am > (detail ? 78 : 72) && am < (detail ? 92 : 95) && zm > -13 && zm < 15) target = liv;
    if (zm > 15.6 && zm < 17.2 && am > 22 && am < 66) col = WINDOW;   // 驾驶舱
    const p00 = ringPt(sec[i], a0), p01 = ringPt(sec[i], a1), p10 = ringPt(sec[i + 1], a0), p11 = ringPt(sec[i + 1], a1);
    target.tri(p00, p10, p11, target === liv ? LIV : col, ringN(a0), ringN(a0), ringN(a1));
    target.tri(p00, p11, p01, target === liv ? LIV : col, ringN(a0), ringN(a1), ringN(a1));
  }
  // ---- 机翼（下单翼、后掠、上反）和翼梢小翼
  wingPair(body, 4.2, -4.2, -3.6, -5.6, 1.4, 17, -1.25, 0.2, 0.55, 0.16, WING);
  if (detail) for (const s of [1, -1]) fin(body, s * 17, 0.12, 2.0, -3.7, -5.6, -5.3, -6.2, 0.14, 0.08, WHITE);
  // 机翼和机身的整流罩（机腹）
  if (detail) prism(body, [V(-1.4, -1.3, 5), V(1.4, -1.3, 5), V(1.2, -2.05, 4.2), V(-1.2, -2.05, 4.2)], [V(-1.4, -1.3, -5.5), V(1.4, -1.3, -5.5), V(1.2, -2.05, -4.8), V(-1.2, -2.05, -4.8)], BELLY);
  // ---- 尾翼
  if (S.rear) {
    // T 型尾：平尾在垂尾顶上
    fin(liv, 0, 1.2, 7.4, -11.5, -17.8, -16.6, -19.6, 0.5, 0.3, LIV);
    wingPair(body, -16.4, -18.6, -18.6, -19.8, 0.2, 6.0, 7.2, 7.5, 0.3, 0.14, WHITE);
  } else {
    fin(liv, 0, 1.5, 7.6, -12.2, -18.4, -17.3, -19.4, 0.5, 0.25, LIV);
    wingPair(body, -13.6, -17.4, -17.4, -18.6, 0.9, 6.4, 0.75, 1.15, 0.35, 0.12, WHITE);
  }
  // ---- 发动机
  const nSeg = detail ? 14 : 6;
  if (S.rear) {
    for (const s of [1, -1]) {
      lathe(liv, s * 3.4, 1.09, -6.5, [[-3.6, 0.82], [-1.0, 1.11], [1.5, 1.09]], nSeg, LIV, 'z', FAN);
      if (detail) prism(body, [V(s * 1.7, 0.75, -5.2), V(s * 1.7, 1.15, -5.2), V(s * 1.7, 1.15, -7.6), V(s * 1.7, 0.75, -7.6)], [V(s * 2.5, 0.85, -5.6), V(s * 2.5, 1.2, -5.6), V(s * 2.5, 1.2, -7.4), V(s * 2.5, 0.85, -7.4)], WING);
    }
  } else {
    for (const s of [1, -1]) {
      lathe(liv, s * 5.7, -2.3, 5.6, [[-3.0, 0.62], [-1.6, 0.92], [0.4, 1.02], [1.3, 1.0]], nSeg, LIV, 'z', FAN);
      // 挂架
      if (detail) prism(body, [V(s * 5.55, -1.45, 4.4), V(s * 5.85, -1.45, 4.4), V(s * 5.85, -1.25, -2.6), V(s * 5.55, -1.25, -2.6)], [V(s * 5.55, -1.0, 4.0), V(s * 5.85, -1.0, 4.0), V(s * 5.85, -1.0, -2.6), V(s * 5.55, -1.0, -2.6)], WING);
    }
  }
  // ---- 起落架（地面在 y = -3.9）
  const G = -3.9;
  if (detail) {
    const wheels = (x: number, z: number, n: number, rad: number) => {
      for (let k = 0; k < n; k++) {
        const zz = z + (k - (n - 1) / 2) * rad * 2.3;
        for (const s of [1, -1]) lathe(gear, x + s * 0.32, G + rad, zz, [[-0.18, rad], [0.18, rad]], 10, TYRE, 'x');
      }
      prism(gear, [V(x - 0.12, G + rad, z - 0.12), V(x + 0.12, G + rad, z - 0.12), V(x + 0.12, G + rad, z + 0.12), V(x - 0.12, G + rad, z + 0.12)],
        [V(x - 0.12, -1.6, z - 0.12), V(x + 0.12, -1.6, z - 0.12), V(x + 0.12, -1.6, z + 0.12), V(x - 0.12, -1.6, z + 0.12)], STRUT);
    };
    for (const s of [1, -1]) wheels(s * 3.0, -1.6, kind === 1 ? 2 : 1, 0.58);
    wheels(0, 14.6, 1, 0.38);
  } else {
    for (const s of [1, -1]) prism(gear, [V(s * 3 - 0.4, G, -2.2), V(s * 3 + 0.4, G, -2.2), V(s * 3 + 0.4, G, -1.0), V(s * 3 - 0.4, G, -1.0)], [V(s * 3 - 0.2, -1.8, -2.0), V(s * 3 + 0.2, -1.8, -2.0), V(s * 3 + 0.2, -1.8, -1.2), V(s * 3 - 0.2, -1.8, -1.2)], DARK);
  }
  // 缩放、抬到地面以上
  const out: PlaneGeo = { body: body.geometry(), livery: liv.geometry(), gear: gear.geometry() };
  for (const g of [out.body, out.livery, out.gear]) {
    g.scale(sx, sy, sz);
    g.translate(0, 3.9 * sy, 0);
    g.computeBoundingSphere();
  }
  return out;
}

/** 航空公司（都是编的）：尾翼、腰线、发动机罩的颜色。 */
export const LIVERIES = ['#c4161c', '#1d4f9f', '#14774a', '#d49a1a', '#1b8a9c', '#5b2c83'].map((h) => new THREE.Color(h));
