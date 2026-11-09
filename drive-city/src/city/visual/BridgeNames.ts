import * as THREE from 'three';
import type { Engine } from '../../core/Engine';
import type { WorldApi } from '../../game/Contracts';
import type { RenderSystem } from '../../render/RenderSystem';
import type { Network } from '../Data';

/**
 * 立交桥身上的桥名（2026-11-09，docs/beijing-immersion-design.md A1）：北京的立交在桥身侧面写着「国贸桥」「西直门桥」
 * 这样的大字，从桥下开过来一抬头就知道到了哪儿。network.json 里架起来的桥面（`br`、`h` ≥ 4.5 米）从一条地面道路
 * 上方跨过的地方，在桥面朝着来车的那一侧挂一块字：桥面自己叫「XX桥」就用它，否则用 300 米内 `br` 点的立交名。
 * 同一座立交、朝同一个方向的字 150 米内只留最外侧的一块，每座最多 8 块。位置在构建时算好（`bridgenames.mts` →
 * `public/city/bridgenames.json`），镜头 800 米内才建网格，晚上微微发亮。
 * `?bridgenames=0` 关掉。
 */
export interface BridgePlate { x: number; y: number; z: number; nx: number; nz: number; name: string }

const DECK_MIN = 4.5;
const UNDER = /^(motorway|trunk|primary|secondary|tertiary|motorway_link|trunk_link|primary_link|secondary_link|unclassified|residential)$/;
const CELL = 100;
const NEAR = 800, FAR = 1000;
/** The plate's height (m); the characters fill 80% of it. */
const PLATE_H = 2.0;

export function bridgePlates(net: Network): BridgePlate[] {
  const br = net.br ?? [];
  const nameNear = (x: number, z: number): string | null => {
    let best: string | null = null, bd = 300;
    for (const [bx, bz, n] of br) { const d = Math.hypot(bx - x, bz - z); if (d < bd) { bd = d; best = n; } }
    return best;
  };
  // ground roads, segments in a grid
  const grid = new Map<string, number[]>();
  const segs: { ax: number; az: number; bx: number; bz: number; oneway: boolean }[] = [];
  for (const e of net.edges) {
    if (e.br || !UNDER.test(e.c) || (e.h && Math.max(...e.h) > 1)) continue;
    for (let i = 0; i + 3 < e.p.length; i += 2) {
      const s = { ax: e.p[i], az: e.p[i + 1], bx: e.p[i + 2], bz: e.p[i + 3], oneway: e.o === 1 };
      const k = segs.push(s) - 1;
      const x0 = Math.floor(Math.min(s.ax, s.bx) / CELL), x1 = Math.floor(Math.max(s.ax, s.bx) / CELL);
      const z0 = Math.floor(Math.min(s.az, s.bz) / CELL), z1 = Math.floor(Math.max(s.az, s.bz) / CELL);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) { const key = `${ix}_${iz}`; (grid.get(key) ?? grid.set(key, []).get(key)!).push(k); }
    }
  }
  const cands: (BridgePlate & { out: number })[] = [];
  for (const e of net.edges) {
    if (!e.br || !e.h || Math.max(...e.h) < DECK_MIN) continue;
    const mid = e.p.length >> 2 << 1;
    const name = e.n && /桥$/.test(e.n) ? e.n : nameNear(e.p[mid], e.p[mid + 1]);
    if (!name) continue;
    for (let i = 0; i + 3 < e.p.length; i += 2) {
      const ax = e.p[i], az = e.p[i + 1], bx = e.p[i + 2], bz = e.p[i + 3];
      const dx = bx - ax, dz = bz - az, L = Math.hypot(dx, dz);
      if (L < 1) continue;
      const seen = new Set<number>();
      const x0 = Math.floor(Math.min(ax, bx) / CELL), x1 = Math.floor(Math.max(ax, bx) / CELL);
      const z0 = Math.floor(Math.min(az, bz) / CELL), z1 = Math.floor(Math.max(az, bz) / CELL);
      for (let ix = x0; ix <= x1; ix++) for (let iz = z0; iz <= z1; iz++) for (const k of grid.get(`${ix}_${iz}`) ?? []) {
        if (seen.has(k)) continue;
        seen.add(k);
        const s = segs[k], ex = s.bx - s.ax, ez = s.bz - s.az;
        const den = dx * ez - dz * ex;
        if (Math.abs(den) < 1e-6) continue;
        const t = ((s.ax - ax) * ez - (s.az - az) * ex) / den, u = ((s.ax - ax) * dz - (s.az - az) * dx) / den;
        if (t < 0 || t > 1 || u < 0 || u > 1) continue;
        // crossing at less than ~35° from parallel: the face would not look at the road's traffic
        const sin = Math.abs(den) / (L * Math.hypot(ex, ez));
        if (sin < 0.55) continue;
        const h = e.h[i / 2] + (e.h[i / 2 + 1] - e.h[i / 2]) * t;
        if (h < DECK_MIN) continue;
        const px = ax + dx * t, pz = az + dz * t, rl = Math.hypot(ex, ez), rx = ex / rl, rz = ez / rl;
        for (const side of [-1, 1]) {
          const nx = (-dz / L) * side, nz = (dx / L) * side;
          // a one-way road below: only the face its traffic drives towards (normal against the traffic)
          if (s.oneway && nx * rx + nz * rz > -0.3) continue;
          const off = e.w / 2 + 0.6;
          cands.push({ x: px + nx * off, y: h - 1.1, z: pz + nz * off, nx, nz, name, out: (px + nx * off) * nx + (pz + nz * off) * nz });
        }
      }
    }
  }
  // per interchange and facing (45° bins): within 150 m only the outermost face (the inner ones are behind the outer deck)
  const out: BridgePlate[] = [];
  const perName = new Map<string, number>();
  cands.sort((a, b) => b.out - a.out);
  for (const c of cands) {
    const bin = Math.round(Math.atan2(c.nx, c.nz) / (Math.PI / 4));
    const clash = out.some((o) => o.name === c.name && Math.round(Math.atan2(o.nx, o.nz) / (Math.PI / 4)) === bin && Math.hypot(o.x - c.x, o.z - c.z) < 150);
    if (clash || (perName.get(c.name) ?? 0) >= 8) continue;
    perName.set(c.name, (perName.get(c.name) ?? 0) + 1);
    out.push({ x: c.x, y: c.y, z: c.z, nx: c.nx, nz: c.nz, name: c.name });
  }
  return out;
}

function nameTexture(name: string): { tex: THREE.CanvasTexture; aspect: number } {
  const H = 160, chars = [...name].length, W = Math.ceil((chars * 1.12 + 0.5) * H * 0.82 / 4) * 4;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.clearRect(0, 0, W, H);
  g.font = `900 ${Math.round(H * 0.8)}px "Songti SC","STSong","Noto Serif SC","Noto Serif CJK SC","Source Han Serif SC",serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  if ('letterSpacing' in g) (g as unknown as { letterSpacing: string }).letterSpacing = `${Math.round(H * 0.1)}px`;
  // mounted letters: a dark edge so they read against grey concrete, a warm white face
  g.lineJoin = 'round'; g.lineWidth = H * 0.07; g.strokeStyle = 'rgba(40,30,20,0.85)';
  g.strokeText(name, W / 2, H * 0.53);
  g.fillStyle = '#f4e7c6';
  g.fillText(name, W / 2, H * 0.53);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return { tex, aspect: W / H };
}

export function install(engine: Engine): void {
  if (new URLSearchParams(location.search).get('bridgenames') === '0') return;
  if (!engine.get<WorldApi>('world')) return;
  const plates: BridgePlate[] = [];
  // 构建时算好的（scripts/city/bridgenames.mts）；没有这个文件就不挂
  fetch(`${import.meta.env.BASE_URL}city/bridgenames.json`).then((r) => (r.ok ? r.json() : null)).then((d: { n: string[]; p: number[][] } | null) => {
    for (const [x, y, z, nx, nz, k] of d?.p ?? []) plates.push({ x, y, z, nx, nz, name: d!.n[k] });
  }).catch(() => { /* 没有桥名 */ });
  const render = engine.get<RenderSystem & { uniforms?: { uNight: { value: number } } }>('render');
  const root = new THREE.Group();
  root.name = 'bridge-names';
  engine.scene.add(root);
  const live = new Map<BridgePlate, THREE.Mesh>();
  const mats = new Map<string, { mat: THREE.MeshStandardMaterial; aspect: number; refs: number }>();
  const matFor = (name: string) => {
    let m = mats.get(name);
    if (!m) {
      const { tex, aspect } = nameTexture(name);
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#fff2d6'), emissiveIntensity: 0.3, alphaTest: 0.5, roughness: 0.45, metalness: 0.2 });
      mat.userData.wet = 'surface';
      m = { mat, aspect, refs: 0 };
      mats.set(name, m);
    }
    m.refs++;
    return m;
  };
  const release = (name: string) => {
    const m = mats.get(name);
    if (!m || --m.refs > 0) return;
    m.mat.map?.dispose(); m.mat.dispose(); mats.delete(name);
  };
  let poll = 0;
  engine.add({
    name: 'bridgeNames',
    update(dt) {
      poll -= dt;
      if (poll > 0) return;
      poll = 1;
      if (!plates.length) return;
      const cam = engine.camera.position;
      for (const p of plates) {
        const d = Math.hypot(p.x - cam.x, p.z - cam.z), m = live.get(p);
        if (!m && d < NEAR) {
          const { mat, aspect } = matFor(p.name);
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(PLATE_H * aspect, PLATE_H), mat);
          mesh.position.set(p.x, p.y, p.z);
          mesh.rotation.y = Math.atan2(p.nx, p.nz);
          mesh.receiveShadow = true;
          render?.prepare?.(mesh);
          root.add(mesh);
          live.set(p, mesh);
        } else if (m && d > FAR) {
          root.remove(m); m.geometry.dispose(); release(p.name); live.delete(p);
        }
      }
      const n = render?.uniforms?.uNight.value ?? 0;
      for (const { mat } of mats.values()) mat.emissiveIntensity = 0.3 + 0.5 * n;
    },
  });
}
