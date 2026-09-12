import { clamp, creaseNormals, smooth, type Mesher, type Surf } from './Mesher';

/**
 * The body-shell kernel. A body is two grids that meet along the "top contour" (the shoulder line
 * of a car, the roof edge of a bus):
 *
 *   cap   a height field over the plan: rows along the car (z), columns from the top contour in to
 *         the centre line. Its columns come in three groups: S (the shoulder, rounding from the
 *         side up to the deck edge D), G (the greenhouse side, D up to the roof rail R: side glass,
 *         pillars) and T (R across to the centre: roof, windscreen, rear screen, hood, boot lid).
 *         On the hood and boot G collapses to a point and T is the panel.
 *   wall  a skirt hanging from the top contour: stations run from the rear centre, out along the
 *         rear edge, forward along the side and in along the front edge; rows run down to the
 *         floor. Each station is pushed out along its plan normal by a height profile (bumper
 *         bulge, door section, sill tuck-under), so the front, the sides and the rear are one
 *         surface with rounded corners. Rows under a wheel arch are clamped up to the arch.
 *
 * Every face is classified (paint, glass, seam, lamp...) by the body definition from its place in
 * the grids, which is where door lines, pillars, window frames and lamp clusters come from: they
 * are grid lines, so their edges are crisp at any level of detail. Both halves are emitted
 * (mirrored), normals are creased (smooth across the panels, sharp at real edges) over the whole
 * shell before faces go to their buckets, so a paint/glass boundary on a smooth surface does not
 * show a shading seam.
 *
 * Body frame as in Spec: +Z forward, +X left, +Y up, y = 0 at hub height. Built for x >= 0.
 */

export interface Section {
  /** Top contour half-width and height. */
  w: number; top: number;
  /** Deck edge / belt line (where the shoulder ends). */
  xD: number; yD: number;
  /** Roof rail / window top. Equal to D where there is no greenhouse. */
  xR: number; yR: number;
  /** Centre-line top. */
  yT: number;
  /** Outward bow of the side glass at mid-height (m). */
  bulge?: number;
  /** Crown shape of the T group: 2 = parabola (default), higher = flatter centre. */
  crown?: number;
}

export interface WallRow {
  name: string;
  side(z: number, top: number): number;
  front(x: number, top: number): number;
  rear(x: number, top: number): number;
}

export interface Arch { z: number; r: number; yc: number }

export interface CapFace {
  z: number; x: number; y: number;
  group: 'S' | 'G' | 'T';
  /** 0..1 across the group (S: outer -> D, G: D -> R, T: R -> centre). */
  u: number;
  sec: Section;
  /** Row index of the face's rear edge, and its z extent. */
  row: number; z0: number; z1: number;
}

export interface WallFace {
  region: 'side' | 'front' | 'rear';
  /** Face centre: plan position, height, arc length along the outline. */
  x: number; z: number; y: number; s: number;
  /** Upper row index (rows are numbered from the top contour down). */
  k: number;
  rowName: string;
  /** Plan-normal weights of the face: side (x), front (+z), rear (-z). */
  wS: number; wF: number; wR: number;
  /** A vertex was clamped to a wheel arch. */
  arch: boolean;
  /** Station extent (arc length) and z extent. */
  s0: number; s1: number; z0: number; z1: number;
}

export interface ShellDef {
  zRear: number; zFront: number;
  section(z: number): Section;
  /** Plan rounding at the ends: over `len` metres the half-width falls to `end` of itself. */
  frontRound: { len: number; end: number; rows: number };
  rearRound: { len: number; end: number; rows: number };
  /** Column positions inside each group, 0..1, both ends included. */
  cols: { S: number[]; G: number[]; T: number[] };
  /** Absolute x of the T columns at the front / rear edge (so front-face features get grid lines). */
  frontX?: number[]; rearX?: number[];
  rows: WallRow[];
  offSide(y: number, z: number): number;
  offFront(y: number, x: number): number;
  offRear(y: number, x: number): number;
  arches: Arch[];
  /** z positions that must be cap rows / side stations (door lines, pillars, lamp edges). */
  zKeys: number[];
  maxDz: number;
  capClass(f: CapFace): Surf | null;
  wallClass(f: WallFace): Surf | null;
  /** Crease angle for normals (rad). */
  crease?: number;
}

interface P3 { x: number; y: number; z: number }

/** Face coordinates for textured features: per-vertex (s, y) on the wall, (z, x) on the cap. */
interface Tri { s: Surf; p: number[]; q: number[] }

export class Shell {
  readonly rowsZ: number[] = [];
  /** Cap points [row][col] (x >= 0). */
  readonly cap: P3[][] = [];
  /** Wall points [station][row]. */
  readonly wall: P3[][] = [];
  readonly stations: { o: P3; nx: number; nz: number; s: number; region: 'side' | 'front' | 'rear'; wS: number; wF: number; wR: number }[] = [];
  readonly capU: number[][] = [];
  private tris: Tri[] = [];
  private nS: number; private nG: number; private nT: number;

  constructor(readonly def: ShellDef) {
    const d = def;
    this.nS = d.cols.S.length; this.nG = d.cols.G.length; this.nT = d.cols.T.length;
    this.buildRows();
    this.buildCap();
    this.buildWall();
  }

  /** Plan-rounding scale of the half-width at z. */
  endScale(z: number): number {
    const d = this.def, f = d.frontRound, r = d.rearRound;
    const tf = clamp((z - (d.zFront - f.len)) / f.len, 0, 1), tr = clamp(((d.zRear + r.len) - z) / r.len, 0, 1);
    const sf = f.end + (1 - f.end) * Math.sqrt(Math.max(0, 1 - tf * tf));
    const sr = r.end + (1 - r.end) * Math.sqrt(Math.max(0, 1 - tr * tr));
    return Math.min(sf, sr);
  }

  private buildRows(): void {
    const d = this.def, zs: number[] = [];
    const f = d.frontRound, r = d.rearRound;
    for (let k = 0; k <= f.rows; k++) zs.push(d.zFront - f.len + f.len * Math.sin((Math.PI / 2) * (k / f.rows)));
    for (let k = 0; k <= r.rows; k++) zs.push(d.zRear + r.len - r.len * Math.sin((Math.PI / 2) * (k / r.rows)));
    const a = d.zRear + r.len, b = d.zFront - f.len;
    const n = Math.max(1, Math.ceil((b - a) / d.maxDz));
    for (let k = 0; k <= n; k++) zs.push(a + (b - a) * (k / n));
    for (const z of d.zKeys) if (z > d.zRear && z < d.zFront) zs.push(z);
    zs.sort((p, q) => p - q);
    for (const z of zs) if (!this.rowsZ.length || z - this.rowsZ[this.rowsZ.length - 1] > 0.0015) this.rowsZ.push(z);
    // Keep the exact ends.
    this.rowsZ[0] = d.zRear; this.rowsZ[this.rowsZ.length - 1] = d.zFront;
  }

  /** Column u values of the T group at z (blended towards the edge distributions near the ends). */
  private tCols(z: number, sec: Section, e: number): number[] {
    const d = this.def, T = d.cols.T;
    const blendF = d.frontX ? smooth(d.zFront - 1.6 * d.frontRound.len, d.zFront, z) : 0;
    const blendR = d.rearX ? smooth(d.zRear + 1.6 * d.rearRound.len, d.zRear, z) : 0;
    if (blendF <= 0 && blendR <= 0) return T;
    const xr = sec.xR * e;
    const edge = (xs: number[]) => xs.map((x) => clamp(1 - x / Math.max(1e-3, xr), 0, 1));
    const ef = blendF > 0 ? edge(d.frontX!) : null, er = blendR > 0 ? edge(d.rearX!) : null;
    return T.map((u, j) => {
      let v = u;
      if (ef) v += (ef[j] - u) * blendF;
      if (er) v += (er[j] - v) * blendR;
      return v;
    });
  }

  /** Cap point for a section at z, group and u (x before the end scale). */
  private capPoint(sec: Section, group: 'S' | 'G' | 'T', u: number, out: P3): P3 {
    if (group === 'S') {
      out.x = sec.w - (sec.w - sec.xD) * (1 - Math.cos(u * Math.PI / 2));
      out.y = sec.top + (sec.yD - sec.top) * Math.sin(u * Math.PI / 2);
    } else if (group === 'G') {
      out.x = sec.xD + (sec.xR - sec.xD) * u + (sec.bulge ?? 0) * Math.sin(u * Math.PI) * Math.min(1, (sec.yR - sec.yD) / 0.3);
      out.y = sec.yD + (sec.yR - sec.yD) * u;
    } else {
      const c = sec.crown ?? 2;
      out.x = sec.xR * (1 - u);
      out.y = sec.yR + (sec.yT - sec.yR) * (1 - Math.pow(1 - u, c));
    }
    return out;
  }

  private buildCap(): void {
    const d = this.def;
    for (const z of this.rowsZ) {
      const sec = d.section(z), e = this.endScale(z);
      const row: P3[] = [], us: number[] = [];
      const push = (g: 'S' | 'G' | 'T', u: number) => {
        const p = this.capPoint(sec, g, u, { x: 0, y: 0, z });
        p.x *= e;
        row.push(p); us.push(u);
      };
      for (const u of d.cols.S) push('S', u);
      for (let j = 1; j < this.nG; j++) push('G', d.cols.G[j]);
      const tc = this.tCols(z, sec, e);
      for (let j = 1; j < this.nT; j++) push('T', tc[j]);
      row[row.length - 1].x = 0;
      this.cap.push(row); this.capU.push(us);
    }
  }

  get capCols(): number { return this.cap[0].length; }

  groupOf(j: number): 'S' | 'G' | 'T' {
    if (j < this.nS - 1) return 'S';
    if (j < this.nS - 1 + this.nG - 1) return 'G';
    return 'T';
  }

  private buildWall(): void {
    const d = this.def, cap = this.cap, nr = cap.length, nc = this.capCols;
    const st = this.stations;
    for (let j = nc - 1; j >= 1; j--) st.push({ o: cap[0][j], nx: 0, nz: -1, s: 0, region: 'rear', wS: 0, wF: 0, wR: 1 });
    for (let i = 0; i < nr; i++) st.push({ o: cap[i][0], nx: 1, nz: 0, s: 0, region: 'side', wS: 1, wF: 0, wR: 0 });
    for (let j = 1; j < nc; j++) st.push({ o: cap[nr - 1][j], nx: 0, nz: 1, s: 0, region: 'front', wS: 0, wF: 1, wR: 0 });
    // Plan normals of the side stations from the outline (corners turn from the side to the ends).
    for (let m = 0; m < st.length; m++) {
      const a = st[Math.max(0, m - 1)].o, b = st[Math.min(st.length - 1, m + 1)].o;
      if (m > 0) st[m].s = st[m - 1].s + Math.hypot(st[m].o.x - st[m - 1].o.x, st[m].o.z - st[m - 1].o.z);
      if (st[m].region !== 'side') continue;
      const tx = b.x - a.x, tz = b.z - a.z, l = Math.hypot(tx, tz) || 1;
      st[m].nx = tz / l; st[m].nz = -tx / l;
      st[m].wS = st[m].nx * st[m].nx;
      st[m].wF = Math.max(0, st[m].nz) ** 2;
      st[m].wR = Math.max(0, -st[m].nz) ** 2;
    }
    for (const s of st) {
      const col: P3[] = [];
      let prev = Infinity;
      for (let k = 0; k < d.rows.length; k++) {
        const row = d.rows[k], o = s.o;
        let y = k === 0 ? o.y : s.wS * row.side(o.z, o.y) + s.wF * row.front(o.x, o.y) + s.wR * row.rear(o.x, o.y);
        if (k > 0) y = Math.min(y, prev - 0.0005);
        let arch = false;
        if (k > 0 && s.wS > 0.5) for (const a of d.arches) {
          const dz = o.z - a.z;
          if (Math.abs(dz) >= a.r) continue;
          const ya = a.yc + Math.sqrt(a.r * a.r - dz * dz);
          if (y < ya) { y = Math.min(prev, ya); arch = true; }
        }
        prev = y;
        const off = k === 0 ? 0 : s.wS * d.offSide(y, o.z) + s.wF * d.offFront(y, o.x) + s.wR * d.offRear(y, o.x);
        col.push({ x: o.x + s.nx * off, y, z: o.z + s.nz * off, arch } as P3 & { arch: boolean });
      }
      this.wall.push(col);
    }
  }

  /** Classify every face and collect the triangles (x >= 0 half). */
  private collect(): void {
    const d = this.def, cap = this.cap, nr = cap.length, nc = this.capCols;
    const tris = this.tris;
    const add = (s: Surf, a: P3, b: P3, c: P3, qa: number[], qb: number[], qc: number[]) => {
      const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z, vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
      const cx = uy * vz - uz * vy, cy = uz * vx - ux * vz, cz = ux * vy - uy * vx;
      if (cx * cx + cy * cy + cz * cz < 1e-14) return;
      tris.push({ s, p: [a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z], q: [...qa, ...qb, ...qc] });
    };
    // Cap.
    for (let i = 0; i < nr - 1; i++) {
      const zc = (this.rowsZ[i] + this.rowsZ[i + 1]) / 2, sec = d.section(zc);
      for (let j = 0; j < nc - 1; j++) {
        const A = cap[i][j], B = cap[i][j + 1], C = cap[i + 1][j + 1], D = cap[i + 1][j];
        const g = this.groupOf(j);
        const s = d.capClass({ z: zc, x: (A.x + B.x + C.x + D.x) / 4, y: (A.y + B.y + C.y + D.y) / 4, group: g, u: this.faceU(i, j), sec, row: i, z0: this.rowsZ[i], z1: this.rowsZ[i + 1] });
        if (!s) continue;
        const q = (p: P3) => [p.z, p.x];
        add(s, A, B, C, q(A), q(B), q(C));
        add(s, A, C, D, q(A), q(C), q(D));
      }
    }
    // Wall.
    const st = this.stations, W = this.wall;
    for (let m = 0; m < st.length - 1; m++) {
      const s0 = st[m], s1 = st[m + 1];
      const region = s0.region === s1.region ? s0.region : 'side';
      for (let k = 0; k < d.rows.length - 1; k++) {
        const A = W[m][k], B = W[m + 1][k], C = W[m + 1][k + 1], D = W[m][k + 1];
        const arch = !!((A as P3 & { arch?: boolean }).arch || (B as P3 & { arch?: boolean }).arch || (C as P3 & { arch?: boolean }).arch || (D as P3 & { arch?: boolean }).arch);
        const s = d.wallClass({
          region, x: (A.x + B.x + C.x + D.x) / 4, z: (A.z + B.z + C.z + D.z) / 4, y: (A.y + B.y + C.y + D.y) / 4, s: (s0.s + s1.s) / 2,
          k, rowName: d.rows[k].name, wS: (s0.wS + s1.wS) / 2, wF: (s0.wF + s1.wF) / 2, wR: (s0.wR + s1.wR) / 2, arch,
          s0: s0.s, s1: s1.s, z0: Math.min(s0.o.z, s1.o.z), z1: Math.max(s0.o.z, s1.o.z),
        });
        if (!s) continue;
        add(s, A, B, C, [s0.s, A.y], [s1.s, B.y], [s1.s, C.y]);
        add(s, A, C, D, [s0.s, A.y], [s1.s, C.y], [s0.s, D.y]);
      }
    }
  }

  /** Mean u of a cap face within its group (a column shared with the previous group is u = 0 of this one). */
  private faceU(i: number, j: number): number {
    const g = this.groupOf(j);
    const u0 = j === 0 || this.groupOf(j - 1) === g ? (this.capU[i][j] + this.capU[i + 1][j]) / 2 : 0;
    const u1 = (this.capU[i][j + 1] + this.capU[i + 1][j + 1]) / 2;
    return (u0 + u1) / 2;
  }

  /**
   * Emit both halves into the mesher, with creased normals and feature texture coordinates.
   * Extra triangles (floor, liners) can be added to the same normal pass with `extra`.
   */
  emit(mesher: Mesher): void {
    this.collect();
    const all = this.tris;
    const n = all.length;
    const pos = new Float32Array(n * 18);
    for (let t = 0; t < n; t++) {
      const p = all[t].p;
      pos.set(p, t * 9);
      // Mirror (x -> -x) with the winding reversed.
      const o = (n + t) * 9;
      pos[o] = -p[0]; pos[o + 1] = p[1]; pos[o + 2] = p[2];
      pos[o + 3] = -p[6]; pos[o + 4] = p[7]; pos[o + 5] = p[8];
      pos[o + 6] = -p[3]; pos[o + 7] = p[4]; pos[o + 8] = p[5];
    }
    const nrm = creaseNormals(pos, this.def.crease ?? 0.62);
    // Feature bounds in face coordinates, per surface.
    const box = new Map<Surf, [number, number, number, number]>();
    for (const t of all) {
      if (!t.s.rect) continue;
      const b = box.get(t.s) ?? [Infinity, Infinity, -Infinity, -Infinity];
      for (let k = 0; k < 3; k++) { b[0] = Math.min(b[0], t.q[k * 2]); b[1] = Math.min(b[1], t.q[k * 2 + 1]); b[2] = Math.max(b[2], t.q[k * 2]); b[3] = Math.max(b[3], t.q[k * 2 + 1]); }
      box.set(t.s, b);
    }
    const uv = new Array<number>(6), uvm = new Array<number>(6);
    for (let t = 0; t < n; t++) {
      const tr = all[t];
      const b = box.get(tr.s);
      for (let k = 0; k < 3; k++) {
        uv[k * 2] = b ? (tr.q[k * 2] - b[0]) / Math.max(1e-6, b[2] - b[0]) : 0;
        uv[k * 2 + 1] = b ? (tr.q[k * 2 + 1] - b[1]) / Math.max(1e-6, b[3] - b[1]) : 0;
      }
      mesher.tri(tr.s, pos.subarray(t * 9, t * 9 + 9), nrm.subarray(t * 9, t * 9 + 9), uv);
      uvm[0] = uv[0]; uvm[1] = uv[1]; uvm[2] = uv[4]; uvm[3] = uv[5]; uvm[4] = uv[2]; uvm[5] = uv[3];
      mesher.tri(tr.s, pos.subarray((n + t) * 9, (n + t) * 9 + 9), nrm.subarray((n + t) * 9, (n + t) * 9 + 9), uvm);
    }
  }

  /** Point on the side wall at (z, y), and its outward plan normal (for handles, badges, lettering). */
  sideAt(z: number, y: number): { x: number; y: number; z: number; nx: number; nz: number } {
    const st = this.stations;
    let a = -1;
    for (let m = 0; m < st.length - 1; m++) if (st[m].region === 'side' && st[m + 1].region === 'side' && st[m].o.z <= z && st[m + 1].o.z >= z) { a = m; break; }
    if (a < 0) a = st.findIndex((s) => s.region === 'side');
    const s0 = st[a], s1 = st[Math.min(st.length - 1, a + 1)];
    const t = s1.o.z > s0.o.z ? clamp((z - s0.o.z) / (s1.o.z - s0.o.z), 0, 1) : 0;
    const ox = s0.o.x + (s1.o.x - s0.o.x) * t, oz = s0.o.z + (s1.o.z - s0.o.z) * t;
    let nx = s0.nx + (s1.nx - s0.nx) * t, nz = s0.nz + (s1.nz - s0.nz) * t;
    const l = Math.hypot(nx, nz) || 1; nx /= l; nz /= l;
    const off = this.def.offSide(y, z);
    return { x: ox + nx * off, y, z: oz + nz * off, nx, nz };
  }

  /** Point on the front (+1) or rear (-1) face at (x, y), inside the straight part of the edge. */
  endAt(end: 1 | -1, x: number, y: number): { x: number; y: number; z: number } {
    const d = this.def;
    return end > 0 ? { x, y, z: d.zFront + d.offFront(y, x) } : { x, y, z: d.zRear - d.offRear(y, x) };
  }

  /** Point on the cap's T group (roof, hood) at z and fraction u from the rail to the centre. */
  capAt(z: number, u: number): P3 {
    const sec = this.def.section(z), e = this.endScale(z);
    const p = this.capPoint(sec, 'T', u, { x: 0, y: 0, z });
    p.x *= e;
    return p;
  }

  /** Point on the cap's G group (side glass) at z and fraction u from the belt to the rail. */
  glassAt(z: number, u: number): P3 {
    const sec = this.def.section(z), e = this.endScale(z);
    const p = this.capPoint(sec, 'G', u, { x: 0, y: 0, z });
    p.x *= e;
    return p;
  }

  get triangleCount(): number { return this.tris.length * 2; }
}
