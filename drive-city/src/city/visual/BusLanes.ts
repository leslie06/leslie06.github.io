import * as THREE from 'three';
import type { Engine } from '../../core/Engine';
import type { WorldApi } from '../../game/Contracts';
import type { RenderSystem } from '../../render/RenderSystem';
import type { Network } from '../Data';
import type { Routes } from '../Routes';
import { Y } from '../Roads';

/**
 * 公交专用道（2026-11-10，docs/beijing-immersion-design.md A3）：北京的主干道最右边一条车道是公交专用道，黄色虚线隔开（压在路面最右一条白虚线上：车道宽按 city/Roads.ts 的分法，路宽 / round(路宽 / 3.4)），
 * 隔一段写着「公交专用」。这里在够宽的主干道（primary / trunk，不是环路主路、辅路和桥面；单向车行道 10.5 米以上，
 * 双向 20 米以上）每个方向最右一条车道的左边画黄虚线（6 米画 2 米空、0.24 米宽，盖住下面的白虚线），车道里每 150 米写一次字，离路口 30 米内不画。
 * 按 256 米一块在建好以后缓存，镜头 450 米内才建网格（每块一次 draw call 的线、一次字）。`?buslanes=0` 关。
 */
const DASH = 6, GAP = 2, TEXT_EVERY = 150, END = 30, BLOCK = 256, NEAR = 450, FAR = 550;
const RING = /^[东西南北][二三四五]环/;

export interface BusPieces {
  /** Dashes: [ax, az, bx, bz] each. */
  dash: number[];
  /** Words: [x, z, dx, dz] (dx, dz: the way the traffic goes) each. */
  text: number[];
}

/** Every dash and word, by block (pure). */
export function busLanes(net: Network): Map<string, BusPieces> {
  const blocks = new Map<string, BusPieces>();
  const at = (x: number, z: number) => {
    const k = `${Math.floor(x / BLOCK)}_${Math.floor(z / BLOCK)}`;
    return blocks.get(k) ?? blocks.set(k, { dash: [], text: [] }).get(k)!;
  };
  // a node where three or more ways meet is a junction (the lane ends short of it); one where an edge just continues is not
  const deg = new Map<number, number>();
  for (const e of net.edges) { deg.set(e.a, (deg.get(e.a) ?? 0) + 1); deg.set(e.b, (deg.get(e.b) ?? 0) + 1); }
  for (const e of net.edges) {
    if (!/^(primary|trunk)$/.test(e.c) || e.br || (e.h && Math.max(...e.h) > 0.5) || !e.n || RING.test(e.n) || /辅路/.test(e.n)) continue;
    if (e.o === 1 ? e.w < 10.5 : e.w < 20) continue;
    const p = e.p, hw = e.w / 2;
    // the lanes as city/Roads.ts paints them: the width shared evenly, so the yellow line lies on the last white one
    const lanes = e.l || Math.max(1, Math.round(e.w / 3.4)), lw = e.o === 1 ? e.w / lanes : hw / Math.max(1, Math.round(lanes / 2));
    if (lw > hw - 1) continue;
    let total = 0;
    for (let i = 0; i + 3 < p.length; i += 2) total += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
    const pad0 = (deg.get(e.a) ?? 0) > 2 ? END : 0, pad1 = (deg.get(e.b) ?? 0) > 2 ? END : 0;
    if (total < pad0 + pad1 + 12) continue;
    // each direction's right-hand lane: one-way, the right; two-way, both (the far side runs the other way)
    for (const side of e.o === 1 ? [1] : [1, -1]) {
      let s = 0;
      for (let i = 0; i + 3 < p.length; i += 2) {
        const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
        if (L < 0.5) { s += L; continue; }
        const dx = (p[i + 2] - p[i]) / L, dz = (p[i + 3] - p[i + 1]) / L, rx = -dz * side, rz = dx * side;
        const line = hw - lw, mid = hw - lw / 2;
        const pt = (u: number, off: number): [number, number] => [p[i] + dx * u + rx * off, p[i + 1] + dz * u + rz * off];
        for (let a = Math.ceil(s / (DASH + GAP)) * (DASH + GAP); a < s + L; a += DASH + GAP) {
          if (a < pad0 || a + DASH > total - pad1) continue;
          const u0 = a - s, u1 = Math.min(L, u0 + DASH);
          const [ax, az] = pt(u0, line), [bx, bz] = pt(u1, line);
          at(ax, az).dash.push(ax, az, bx, bz);
        }
        for (let a = Math.ceil((s - 40) / TEXT_EVERY) * TEXT_EVERY + 40; a < s + L; a += TEXT_EVERY) {
          if (a < s) continue;
          if (a < pad0 + 10 || a > total - pad1 - 10) continue;
          const [x, z] = pt(a - s, mid);
          // the far side's traffic goes the other way
          at(x, z).text.push(x, z, dx * side, dz * side);
        }
        s += L;
      }
    }
  }
  return blocks;
}

function wordTexture(): THREE.CanvasTexture {
  // four characters stacked along the lane, drawn tall (road lettering is stretched to read at a glance from a car)
  const W = 128, H = 512, cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#e9b829'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${W * 0.9}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif`;
  // the first character nearest the driver (the bottom of the texture, which lies towards the traffic)
  [...'公交专用'].forEach((ch, i) => {
    g.save(); g.translate(W / 2, H - (i + 0.5) * H / 4); g.scale(1, 1.25); g.fillText(ch, 0, 0); g.restore();
  });
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function install(engine: Engine): void {
  if (new URLSearchParams(location.search).get('buslanes') === '0') return;
  const net = engine.get<WorldApi & { routes?: Routes }>('world')?.routes?.net;
  if (!net) return;
  // worked out a couple of seconds in, not in the boot (~40 ms on a desktop)
  let blocks: Map<string, BusPieces> | null = null, wait = 2;
  const yellow = new THREE.MeshStandardMaterial({ color: '#d9a721', roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  yellow.userData.wet = 'ground'; yellow.userData.snow = 0.22;
  const wordMat = new THREE.MeshStandardMaterial({ map: wordTexture(), roughness: 0.6, alphaTest: 0.4, transparent: false, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  wordMat.userData.wet = 'ground'; wordMat.userData.snow = 0.22;
  const render = engine.get<RenderSystem>('render');
  const root = new THREE.Group();
  root.name = 'bus-lanes';
  engine.scene.add(root);
  const live = new Map<string, THREE.Mesh[]>();
  const y = Y.mark + 0.004;
  const build = (b: BusPieces): THREE.Mesh[] => {
    const out: THREE.Mesh[] = [];
    const quads = (items: number[], stride: number, quad: (o: number, v: number[], uv: number[]) => void, mat: THREE.Material) => {
      if (!items.length) return;
      const v: number[] = [], uv: number[] = [], idx: number[] = [];
      for (let o = 0; o < items.length; o += stride) { const n = v.length / 3; quad(o, v, uv); idx.push(n, n + 1, n + 2, n, n + 2, n + 3); }
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
      g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
      g.setAttribute('normal', new THREE.Float32BufferAttribute(new Array(v.length / 3).fill([0, 1, 0]).flat(), 3));
      g.setIndex(idx);
      const m = new THREE.Mesh(g, mat);
      m.receiveShadow = true;
      out.push(m);
    };
    // a dash 0.2 m wide
    quads(b.dash, 4, (o, v, uv) => {
      const ax = b.dash[o], az = b.dash[o + 1], bx = b.dash[o + 2], bz = b.dash[o + 3], L = Math.hypot(bx - ax, bz - az) || 1;
      const nx = -(bz - az) / L * 0.12, nz = (bx - ax) / L * 0.12;
      v.push(ax - nx, y, az - nz, ax + nx, y, az + nz, bx + nx, y, bz + nz, bx - nx, y, bz - nz);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    }, yellow);
    // the words: 2.2 m across, 7 m along, the first character towards the traffic
    quads(b.text, 4, (o, v, uv) => {
      const x = b.text[o], z = b.text[o + 1], dx = b.text[o + 2], dz = b.text[o + 3], rx = -dz, rz = dx, a = 3.5, w = 1.1;
      v.push(x - dx * a - rx * w, y, z - dz * a - rz * w, x - dx * a + rx * w, y, z - dz * a + rz * w, x + dx * a + rx * w, y, z + dz * a + rz * w, x + dx * a - rx * w, y, z + dz * a - rz * w);
      uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    }, wordMat);
    for (const m of out) { render?.prepare?.(m); root.add(m); }
    return out;
  };
  let poll = 0;
  engine.add({
    name: 'busLanes',
    update(dt) {
      if (!blocks) { if ((wait -= dt) > 0) return; blocks = busLanes(net); }
      if ((poll -= dt) > 0) return;
      poll = 1;
      const cam = engine.camera.position;
      for (const [k, b] of blocks) {
        const [i, j] = k.split('_').map(Number), cx = (i + 0.5) * BLOCK, cz = (j + 0.5) * BLOCK;
        const d = Math.max(Math.abs(cx - cam.x), Math.abs(cz - cam.z)) - BLOCK / 2, m = live.get(k);
        if (!m && d < NEAR) live.set(k, build(b));
        else if (m && d > FAR) { for (const x of m) { root.remove(x); x.geometry.dispose(); } live.delete(k); }
      }
    },
  });
}
