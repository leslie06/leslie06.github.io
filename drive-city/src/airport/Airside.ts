import type { AirfieldData } from './Data';
import type { Runway } from './Flights';

/**
 * 空侧（2026-11-16，第三批）：airfield.json 的 `air` / `airHoles`（建城时 4 米格子算出来的空侧边界，化简过）在 4 米的格子上
 * 光栅化一遍，问「这个点在不在围界里」是一次查表。闯空侧的通缉、尾流、空侧勤务车都用它。
 */
export class Airside {
  private readonly x0: number; private readonly z0: number;
  private readonly nx: number; private readonly nz: number;
  private readonly bits: Uint8Array;
  static readonly CELL = 4;

  constructor(d: AirfieldData, private readonly rws: readonly Runway[]) {
    const rings = [...(d.air ?? []), ...(d.airHoles ?? [])];
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of d.air ?? []) for (let k = 0; k < r.length; k += 2) { x0 = Math.min(x0, r[k]); x1 = Math.max(x1, r[k]); z0 = Math.min(z0, r[k + 1]); z1 = Math.max(z1, r[k + 1]); }
    const C = Airside.CELL;
    if (!Number.isFinite(x0)) { x0 = z0 = 0; x1 = z1 = C; }
    this.x0 = x0; this.z0 = z0;
    this.nx = Math.ceil((x1 - x0) / C) + 1; this.nz = Math.ceil((z1 - z0) / C) + 1;
    this.bits = new Uint8Array(this.nx * this.nz);
    // 扫描线（奇偶规则：洞自然挖掉）
    const xs: number[] = [];
    for (let j = 0; j < this.nz; j++) {
      const z = z0 + (j + 0.5) * C;
      xs.length = 0;
      for (const r of rings) {
        const n = r.length / 2;
        for (let k = 0; k < n; k++) {
          const ax = r[k * 2], az = r[k * 2 + 1], bx = r[((k + 1) % n) * 2], bz = r[((k + 1) % n) * 2 + 1];
          if ((az <= z) !== (bz <= z)) xs.push(ax + (z - az) / (bz - az) * (bx - ax));
        }
      }
      xs.sort((a, b) => a - b);
      for (let k = 0; k + 1 < xs.length; k += 2) {
        const i0 = Math.max(0, Math.ceil((xs[k] - x0) / C - 0.5)), i1 = Math.min(this.nx - 1, Math.floor((xs[k + 1] - x0) / C - 0.5));
        for (let i = i0; i <= i1; i++) this.bits[j * this.nx + i] = 1;
      }
    }
  }

  /** (x, z) 在空侧（围界里）。 */
  inside(x: number, z: number): boolean {
    const i = Math.floor((x - this.x0) / Airside.CELL), j = Math.floor((z - this.z0) / Airside.CELL);
    return i >= 0 && j >= 0 && i < this.nx && j < this.nz && this.bits[j * this.nx + i] === 1;
  }

  /** (x, z) 在哪条跑道上（跑道两边各外扩 `pad` 米、两头 60 米）：跑道和从南头量起的米数；不在就是 null。 */
  runwayAt(x: number, z: number, pad = 0): { rw: Runway; s: number } | null {
    for (const rw of this.rws) {
      const s = (x - rw.sx) * rw.ux + (z - rw.sz) * rw.uz, o = Math.abs((x - rw.sx) * -rw.uz + (z - rw.sz) * rw.ux);
      if (s > -60 && s < rw.len + 60 && o < rw.w / 2 + pad) return { rw, s };
    }
    return null;
  }
}
