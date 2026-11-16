import * as THREE from 'three';
import type { AirfieldData } from './Data';

/**
 * 跑道和滑行道上的漆（2026-11-16）：一张带顶点色的网格，白色和黄色。
 * 跑道（按国际民航组织的样子简化）：两头入口的斑马线、跑道号（从进近方向读：先字母、再往里是数字）、接地带标志、
 * 400 米处的两块瞄准点、中线虚线、两边的边线。滑行道：黄色中线，压在跑道上的那段不画。
 */
const WHITE = new THREE.Color('#e8e8e2'), YELLOW = new THREE.Color('#d9a91c');

/** 3 × 5 格的方块字：每个笔画一个长方形 [x0, y0, x1, y1]，y 往上（离入口越远）。 */
const TOP = [0, 4, 3, 5], MID = [0, 2, 3, 3], BOT = [0, 0, 3, 1];
const LFULL = [0, 0, 1, 5], RFULL = [2, 0, 3, 5], LUP = [0, 2, 1, 5], RUP = [2, 2, 3, 5], LLOW = [0, 0, 1, 3], RLOW = [2, 0, 3, 3];
const GLYPHS: Record<string, number[][]> = {
  0: [LFULL, RFULL, TOP, BOT], 1: [[1, 0, 2, 5]], 2: [TOP, RUP, MID, LLOW, BOT], 3: [TOP, MID, BOT, RFULL], 4: [LUP, MID, RFULL],
  5: [TOP, LUP, MID, RLOW, BOT], 6: [TOP, LFULL, MID, RLOW, BOT], 7: [TOP, RFULL], 8: [LFULL, RFULL, TOP, MID, BOT], 9: [TOP, LUP, MID, RFULL, BOT],
  L: [LFULL, BOT], R: [LFULL, TOP, RUP, MID, [2, 0, 3, 2]], C: [LFULL, TOP, BOT],
};

/** 按 1 公里的格子分开放（每格一个网格，视锥剔除得掉）。 */
const CELL = 1024;
class Paint {
  private cells = new Map<number, { pos: number[]; col: number[] }>();
  /** 一个长方形：中心 (cx, cz)，沿 (ux, uz) 长 2·hl，横向半宽 hw。 */
  rect(cx: number, cz: number, ux: number, uz: number, hl: number, hw: number, c: THREE.Color): void {
    const nx = -uz, nz = ux, y = 0;
    const p = [
      [cx - ux * hl - nx * hw, cz - uz * hl - nz * hw], [cx + ux * hl - nx * hw, cz + uz * hl - nz * hw],
      [cx + ux * hl + nx * hw, cz + uz * hl + nz * hw], [cx - ux * hl + nx * hw, cz - uz * hl + nz * hw],
    ];
    const key = Math.floor(cx / CELL) * 65536 + Math.floor(cz / CELL);
    let b = this.cells.get(key);
    if (!b) { b = { pos: [], col: [] }; this.cells.set(key, b); }
    // 朝上的两个三角形（x 右 z 下，从上往下看逆时针）
    for (const k of [0, 2, 1, 0, 3, 2]) { b.pos.push(p[k][0], y, p[k][1]); b.col.push(c.r, c.g, c.b); }
  }
  /** 一段线：从 a 到 b，宽 2·hw。 */
  seg(ax: number, az: number, bx: number, bz: number, hw: number, c: THREE.Color): void {
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 0.05) return;
    this.rect((ax + bx) / 2, (az + bz) / 2, (bx - ax) / L, (bz - az) / L, L / 2, hw, c);
  }
  geometries(): THREE.BufferGeometry[] {
    return [...this.cells.values()].map(({ pos, col }) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
      const n = new Float32Array(pos.length); for (let i = 1; i < n.length; i += 3) n[i] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
      g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
      g.computeBoundingSphere();
      return g;
    });
  }
}

/** 跑道号：从方向 (ux, uz) 进近的那一头（磁航向近似成真航向，北京的磁偏角六度，取整到十度后多半一样）。 */
function designator(ref: string, ux: number, uz: number): string {
  const hdg = ((Math.atan2(ux, -uz) * 180 / Math.PI) + 360) % 360;
  const num = Math.round(hdg / 10) || 36;
  const parts = ref.split('/').map((s) => s.trim()).filter(Boolean);
  let best = parts[0] ?? String(num).padStart(2, '0'), bd = Infinity;
  for (const p of parts) {
    const n = parseInt(p, 10);
    if (!Number.isFinite(n)) continue;
    const d = Math.min(Math.abs(n - num), 36 - Math.abs(n - num));
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

/** 一头的入口：(ex, ez) 是跑道端点，(ux, uz) 指向跑道里面。 */
function threshold(P: Paint, ex: number, ez: number, ux: number, uz: number, w: number, ref: string, length: number): void {
  const nx = -uz, nz = ux;
  // 斑马线：离端点 6 米起、长 30 米、宽 1.8 米，中间留 3.6 米
  const pairs = Math.max(2, Math.floor((w / 2 - 3) / 3.6));
  for (let k = 0; k < pairs; k++) for (const sd of [1, -1]) {
    const o = sd * (1.8 + 0.9 + k * 3.6);
    P.rect(ex + ux * 21 + nx * o, ez + uz * 21 + nz * o, ux, uz, 15, 0.9, WHITE);
  }
  // 跑道号：字高 9 米，字母在近处、数字在远处；读的人面朝 (ux, uz)，他的右手是 (-uz, ux)
  const des = designator(ref, ux, uz), num = des.replace(/[^0-9]/g, ''), letter = des.replace(/[0-9]/g, '');
  const rx = -uz, rz = ux, cw = 1.2, ch = 1.8, gap = 1.5;
  const text = (s: string, d0: number) => {
    const W = s.length * 3 * cw + (s.length - 1) * gap;
    [...s].forEach((c, i) => {
      for (const [x0, y0, x1, y1] of GLYPHS[c] ?? []) {
        const lx = -W / 2 + i * (3 * cw + gap) + (x0 + x1) / 2 * cw, ly = d0 + (y0 + y1) / 2 * ch;
        P.rect(ex + ux * ly + rx * lx, ez + uz * ly + rz * lx, ux, uz, (y1 - y0) / 2 * ch, (x1 - x0) / 2 * cw, WHITE);
      }
    });
  };
  let d = 48;
  if (letter) { text(letter, d); d += 9 + 6; }
  text(num, d);
  // 接地带：150、450、600、750、900 米处，每边 3、2、2、1、1 条（22.5 × 1.8 米）
  for (const [at, n] of [[150, 3], [450, 2], [600, 2], [750, 1], [900, 1]] as const) {
    if (at + 30 > length / 2) break;
    for (let k = 0; k < n; k++) for (const sd of [1, -1]) {
      const o = sd * (w / 2 - 6 - k * 3);
      P.rect(ex + ux * at + nx * o, ez + uz * at + nz * o, ux, uz, 11.25, 0.9, WHITE);
    }
  }
  // 瞄准点：400 米处两块 45 × 9 米
  if (length > 1200) for (const sd of [1, -1]) P.rect(ex + ux * 400 + nx * sd * (w * 0.2 + 2), ez + uz * 400 + nz * sd * (w * 0.2 + 2), ux, uz, 22.5, 4.5, WHITE);
}

/** 点在不在某条跑道（外扩 margin）上。 */
function onRunway(rws: { ax: number; az: number; ux: number; uz: number; L: number; hw: number }[], x: number, z: number, margin: number): boolean {
  for (const r of rws) {
    const s = (x - r.ax) * r.ux + (z - r.az) * r.uz, o = Math.abs((x - r.ax) * -r.uz + (z - r.az) * r.ux);
    if (s > -margin && s < r.L + margin && o < r.hw + margin) return true;
  }
  return false;
}

/** 漆的网格，一公里一块。 */
export function buildMarks(d: AirfieldData): THREE.BufferGeometry[] {
  const P = new Paint();
  const rws: { ax: number; az: number; ux: number; uz: number; L: number; hw: number }[] = [];
  for (const r of d.runways) {
    const p = r.p, ax = p[0], az = p[1], bx = p[p.length - 2], bz = p[p.length - 1];
    const L = Math.hypot(bx - ax, bz - az);
    if (L < 500) continue;
    const ux = (bx - ax) / L, uz = (bz - az) / L, nx = -uz, nz = ux, hw = r.w / 2;
    rws.push({ ax, az, ux, uz, L, hw });
    threshold(P, ax, az, ux, uz, r.w, r.ref, L);
    threshold(P, bx, bz, -ux, -uz, r.w, r.ref, L);
    // 边线
    for (const sd of [1, -1]) P.seg(ax + nx * sd * (hw - 1), az + nz * sd * (hw - 1), bx + nx * sd * (hw - 1), bz + nz * sd * (hw - 1), 0.45, WHITE);
    // 中线：30 米一段、空 20 米，两头的跑道号后面开始
    for (let s = 75; s + 30 < L - 75; s += 50) P.seg(ax + ux * s, az + uz * s, ax + ux * (s + 30), az + uz * (s + 30), 0.45, WHITE);
  }
  // 滑行道中线：按 4 米一小段，压在跑道上（外扩 4 米）的不画
  for (const t of d.taxiways) {
    const p = t.p;
    for (let i = 2; i < p.length; i += 2) {
      const ax = p[i - 2], az = p[i - 1], bx = p[i], bz = p[i + 1], L = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(L / 4));
      for (let k = 0; k < n; k++) {
        const x0 = ax + (bx - ax) * k / n, z0 = az + (bz - az) * k / n, x1 = ax + (bx - ax) * (k + 1) / n, z1 = az + (bz - az) * (k + 1) / n;
        if (onRunway(rws, (x0 + x1) / 2, (z0 + z1) / 2, 4)) continue;
        P.seg(x0, z0, x1, z1, 0.25, YELLOW);
      }
    }
  }
  return P.geometries();
}
