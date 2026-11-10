import * as THREE from 'three';
import type { Engine } from '../../core/Engine';
import type { WorldApi } from '../../game/Contracts';
import type { RenderSystem } from '../../render/RenderSystem';
import type { Network } from '../Data';
import type { Routes } from '../Routes';
import { Y } from '../Roads';

/**
 * 路口的黄色网状线（2026-11-10，docs/beijing-immersion-design.md A3）：北京不少大路口中间画着黄色的方框和交叉斜线（禁止停车的
 * 网状线），堵车时不许停在里面。这里在两条以上主干道（primary / secondary / trunk，不是环路主路和桥面）相交的路口
 * 挑约三成（按位置定，每次都一样），框的方向顺着最宽的那条路，长宽取两条路的宽度（再收一点，不压人行横道），
 * 画在路面标线上面。按 256 米一块合成一个网格，镜头 400 米内才建。`?junctiongrid=0` 关。
 */
const BLOCK = 256, NEAR = 400, FAR = 500;
const MAJOR = /^(primary|secondary|trunk)$/;

/** Per block: [x, z, angle, half along, half across] per box (pure). */
export function junctionBoxes(net: Network): Map<string, number[]> {
  const at = new Map<number, { x: number; z: number; w: number; a: number }[]>();
  for (const e of net.edges) {
    if (!MAJOR.test(e.c) || e.br || (e.h && Math.max(...e.h) > 0.5) || (e.n && /^[东西南北][二三四五]环$/.test(e.n.replace(/[东西南北中]?路?$/, '')))) continue;
    const n = e.p.length;
    const ends: [number, number, number, number, number][] = [[e.a, e.p[0], e.p[1], e.p[2], e.p[3]], [e.b, e.p[n - 2], e.p[n - 1], e.p[n - 4], e.p[n - 3]]];
    for (const [id, x, z, nx, nz] of ends) (at.get(id) ?? at.set(id, []).get(id)!).push({ x, z, w: e.w, a: Math.atan2(nx - x, nz - z) });
  }
  // the junction nodes (three or more major arms), then the ones within 45 m of each other as one junction
  type Node = { x: number; z: number; arms: { w: number; a: number }[] };
  const nodes: Node[] = [];
  for (const [, arms] of at) if (arms.length >= 3) nodes.push({ x: arms[0].x, z: arms[0].z, arms });
  const used = new Set<Node>(), out = new Map<string, number[]>();
  for (const n0 of nodes) {
    if (used.has(n0)) continue;
    const group = nodes.filter((n) => !used.has(n) && Math.hypot(n.x - n0.x, n.z - n0.z) < 45);
    for (const n of group) used.add(n);
    const x = group.reduce((t, n) => t + n.x, 0) / group.length, z = group.reduce((t, n) => t + n.z, 0) / group.length;
    // one in three or so, by place
    if (Math.abs(Math.sin(x * 0.1213 + z * 0.0731) * 43758.5) % 1 > 0.33) continue;
    const arms = group.flatMap((n) => n.arms).sort((p, q) => q.w - p.w);
    const main = arms[0];
    // the widest road across it (at least 45° off the main one)
    const cross = arms.find((r) => Math.abs(Math.sin(r.a - main.a)) > 0.7);
    if (!cross || main.w < 10 || cross.w < 8) continue;
    // the nodes' spread along and across the main road, and the roads' own widths round it
    const fx = Math.sin(main.a), fz = Math.cos(main.a);
    let f0 = 0, f1 = 0, r0 = 0, r1 = 0;
    for (const n of group) { const f = (n.x - x) * fx + (n.z - z) * fz, r = -(n.x - x) * fz + (n.z - z) * fx; f0 = Math.min(f0, f); f1 = Math.max(f1, f); r0 = Math.min(r0, r); r1 = Math.max(r1, r); }
    const along = Math.min((f1 - f0) / 2 + cross.w * 0.42, 24), across = Math.min((r1 - r0) / 2 + main.w * 0.42, 24);
    const cx = x + fx * (f0 + f1) / 2 - fz * (r0 + r1) / 2, cz = z + fz * (f0 + f1) / 2 + fx * (r0 + r1) / 2;
    const key = `${Math.floor(cx / BLOCK)}_${Math.floor(cz / BLOCK)}`;
    (out.get(key) ?? out.set(key, []).get(key)!).push(cx, cz, main.a, along, across);
  }
  return out;
}

function hatchTexture(): THREE.CanvasTexture {
  const S = 512, cv = document.createElement('canvas');
  cv.width = S; cv.height = S;
  const g = cv.getContext('2d')!;
  g.strokeStyle = '#e3b02a'; g.lineCap = 'butt';
  g.lineWidth = S * 0.03; g.strokeRect(S * 0.015, S * 0.015, S * 0.97, S * 0.97);
  g.lineWidth = S * 0.026;
  g.save(); g.beginPath(); g.rect(0, 0, S, S); g.clip();
  for (let k = -S; k <= 2 * S; k += S / 7) {
    g.beginPath(); g.moveTo(k, 0); g.lineTo(k + S, S); g.stroke();
    g.beginPath(); g.moveTo(k, S); g.lineTo(k + S, 0); g.stroke();
  }
  g.restore();
  const t = new THREE.CanvasTexture(cv);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function install(engine: Engine): void {
  if (new URLSearchParams(location.search).get('junctiongrid') === '0') return;
  const net = engine.get<WorldApi & { routes?: Routes }>('world')?.routes?.net;
  if (!net) return;
  let blocks: Map<string, number[]> | null = null, wait = 3.5;
  // blended, not alpha-tested: the thin lines' alpha averages away in the smaller mip levels, and a test then drops them all
  const mat = new THREE.MeshStandardMaterial({ map: hatchTexture(), roughness: 0.6, transparent: true, depthWrite: false, alphaTest: 0.02, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4 });
  mat.userData.wet = 'ground'; mat.userData.snow = 0.22;
  const render = engine.get<RenderSystem>('render');
  const root = new THREE.Group();
  root.name = 'junction-grid';
  engine.scene.add(root);
  const live = new Map<string, THREE.Mesh>();
  // over the junction's own surface, which sits above the street's markings (at Y.mark it was under it, not drawn)
  const y = Y.curb + 0.005;
  const build = (b: number[]) => {
    const v: number[] = [], uv: number[] = [], nm: number[] = [], idx: number[] = [];
    for (let o = 0; o < b.length; o += 5) {
      const [x, z, a, hl, hc] = [b[o], b[o + 1], b[o + 2], b[o + 3], b[o + 4]];
      const fx = Math.sin(a), fz = Math.cos(a), rx = -fz, rz = fx, n = v.length / 3;
      for (const [s, t] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { v.push(x + fx * hl * t + rx * hc * s, y, z + fz * hl * t + rz * hc * s); uv.push((s + 1) / 2, (t + 1) / 2); nm.push(0, 1, 0); }
      idx.push(n, n + 1, n + 2, n, n + 2, n + 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(v, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('normal', new THREE.Float32BufferAttribute(nm, 3));
    g.setIndex(idx);
    const m = new THREE.Mesh(g, mat);
    m.receiveShadow = true;
    render?.prepare?.(m);
    root.add(m);
    return m;
  };
  let poll = 0;
  engine.add({
    name: 'junctionGrid',
    update(dt) {
      if (!blocks) { if ((wait -= dt) > 0) return; blocks = junctionBoxes(net); }
      if ((poll -= dt) > 0) return;
      poll = 1;
      const cam = engine.camera.position;
      for (const [k, b] of blocks) {
        const [i, j] = k.split('_').map(Number);
        const d = Math.max(Math.abs((i + 0.5) * BLOCK - cam.x), Math.abs((j + 0.5) * BLOCK - cam.z)) - BLOCK / 2, m = live.get(k);
        if (!m && d < NEAR) live.set(k, build(b));
        else if (m && d > FAR) { root.remove(m); m.geometry.dispose(); live.delete(k); }
      }
    },
  });
}
