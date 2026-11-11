import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Engine } from '../../core/Engine';
import type { RenderApi, WorldApi } from '../../game/Contracts';
import type { RenderSystem } from '../../render/RenderSystem';
import type { Network } from '../Data';
import type { Routes } from '../Routes';
import type { GuideSignApi } from './GuideSigns';
import { shortName } from '../Signs';
import { headingOf, levelAt, slotNow } from '../../traffic/Flow';

/**
 * 环路上的可变情报板（2026-11-10，docs/beijing-immersion-design.md A3）：北京二环到五环的主路上隔一两公里就有一座龙门架，
 * 架上的 LED 板画着前方几座立交之间的路况（绿畅通、黄缓行、红拥堵）。这里在环路主路（单向的车行道，不在桥上）
 * 每个方向大约每 1.5 公里放一座：两根立柱在路沿外，横梁跨过车道，板子朝来车。板上是环路名和前方三座立交
 * （顺着这条环路往前找 `br` 立交名），立交之间的色条按钟点变（早晚高峰红黄多），两分钟换一次。离镜头 900 米内才建。
 * 位置在 traffic 装好以后算（约 30 毫秒）。`?infoboards=0` 关。
 */
export interface InfoBoard { x: number; z: number; dx: number; dz: number; w: number; ring: string; ahead: string[];
  /** 前方每座立交在哪（x, z 一对一对，和 `ahead` 对齐）：每一段的路况按段的中点查路况表。 */
  at: number[] }

const RING = /^[东西南北][二三四五]环$/;
const MAIN = /^(trunk|motorway)$/;
const SPACING = 1500, NEAR = 900, FAR = 1100;
const BOARD_W = 9, BOARD_H = 3.4, BOARD_Y = 6.2;

/** Where the boards go (pure). `avoid`: points (guide signs) to keep 80 m from. */
export function placeBoards(net: Network, avoid: { x: number; z: number }[] = []): InfoBoard[] {
  const ringOf = (e: Network['edges'][number]) => (e.n && e.o === 1 && MAIN.test(e.c) && !e.br && !(e.h && Math.max(...e.h) > 0.5) ? shortName(e.n) : '');
  // edges leaving each node, for walking a ring forward
  const out = new Map<number, number[]>();
  net.edges.forEach((e, i) => { if (e.o === 1 && e.n) (out.get(e.a) ?? out.set(e.a, []).get(e.a)!).push(i); });
  const cands: { x: number; z: number; dx: number; dz: number; w: number; ring: string; ei: number; h: number }[] = [];
  net.edges.forEach((e, ei) => {
    const ring = ringOf(e);
    if (!RING.test(ring)) return;
    let s = 0;
    const p = e.p, total = (() => { let t = 0; for (let i = 0; i + 3 < p.length; i += 2) t += Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]); return t; })();
    if (total < 260) return;
    for (let i = 0; i + 3 < p.length; i += 2) {
      const L = Math.hypot(p[i + 2] - p[i], p[i + 3] - p[i + 1]);
      for (let at = Math.ceil(s / 120) * 120; at < s + L; at += 120) {
        if (at < 100 || at > total - 100) continue;
        const t = (at - s) / L, dx = (p[i + 2] - p[i]) / L, dz = (p[i + 3] - p[i + 1]) / L;
        const x = p[i] + (p[i + 2] - p[i]) * t, z = p[i + 1] + (p[i + 3] - p[i + 1]) * t;
        const h = Math.abs(Math.sin(x * 12.9898 + z * 78.233) * 43758.5453) % 1;
        cands.push({ x, z, dx, dz, w: e.w, ring, ei, h });
      }
      s += L;
    }
  });
  cands.sort((a, b) => a.h - b.h);
  const picked: typeof cands = [];
  for (const c of cands) {
    if (avoid.some((a) => Math.hypot(a.x - c.x, a.z - c.z) < 80)) continue;
    if (picked.some((o) => o.ring === c.ring && o.dx * c.dx + o.dz * c.dz > 0.3 && Math.hypot(o.x - c.x, o.z - c.z) < SPACING)) continue;
    picked.push(c);
  }
  const br = net.br ?? [];
  return picked.map((c) => {
    // walk the ring forward (the straightest way on with the same name) for up to 7 km, noting the interchanges passed
    const ahead: string[] = [], at: number[] = [];
    let ei = c.ei, walked = 0, dx = c.dx, dz = c.dz, first = true;
    const seen = new Set<number>();
    while (walked < 7000 && ahead.length < 3 && !seen.has(ei)) {
      seen.add(ei);
      const e = net.edges[ei], p = e.p;
      for (let i = 0; i + 1 < p.length; i += 2) {
        if (first && (p[i] - c.x) * c.dx + (p[i + 1] - c.z) * c.dz < 0) continue;
        if (i % 6 === 0) for (const [bx, bz, n] of br) {
          if (Math.abs(bx - p[i]) < 150 && Math.abs(bz - p[i + 1]) < 150 && Math.hypot(bx - p[i], bz - p[i + 1]) < 150 && !ahead.includes(n) && (bx - c.x) * c.dx + (bz - c.z) * c.dz > 60) { ahead.push(n); at.push(bx, bz); }
        }
        if (i >= 2) { walked += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]); dx = p[i] - p[i - 2]; dz = p[i + 1] - p[i - 1]; }
      }
      first = false;
      const L = Math.hypot(dx, dz) || 1;
      let next = -1, bestDot = 0.3;
      for (const j of out.get(e.b) ?? []) {
        const f = net.edges[j];
        if (!f.n || shortName(f.n) !== c.ring && !/桥$/.test(f.n)) continue;
        const ex = f.p[2] - f.p[0], ez = f.p[3] - f.p[1], d = (ex * dx + ez * dz) / ((Math.hypot(ex, ez) || 1) * L);
        if (d > bestDot) { bestDot = d; next = j; }
      }
      if (next < 0) break;
      ei = next;
    }
    return { x: c.x, z: c.z, dx: c.dx, dz: c.dz, w: c.w, ring: c.ring, ahead, at };
  }).filter((b) => b.ahead.length >= 2);
}

type Status = 0 | 1 | 2;
const COLOURS = ['#27d34a', '#ffc81e', '#ff3326'];

function drawBoard(g: CanvasRenderingContext2D, W: number, H: number, b: InfoBoard, st: Status[]): void {
  g.fillStyle = '#07090b'; g.fillRect(0, 0, W, H);
  g.strokeStyle = '#2b3036'; g.lineWidth = 10; g.strokeRect(5, 5, W - 10, H - 10);
  const font = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
  g.textBaseline = 'middle';
  g.fillStyle = '#ffb21e'; g.font = `800 ${H * 0.2}px ${font}`; g.textAlign = 'left';
  g.fillText(b.ring, W * 0.04, H * 0.2);
  g.fillStyle = '#d8dde2'; g.font = `600 ${H * 0.13}px ${font}`; g.textAlign = 'right';
  g.fillText('前方路况', W * 0.96, H * 0.2);
  // the road ahead: here, then each interchange, the stretches between coloured
  const n = b.ahead.length, x0 = W * 0.08, x1 = W * 0.94, y = H * 0.56;
  const xs = [x0, ...b.ahead.map((_, i) => x0 + (x1 - x0) * (i + 1) / n)];
  for (let i = 0; i < n; i++) {
    g.strokeStyle = COLOURS[st[i] ?? 0]; g.lineWidth = H * 0.11; g.lineCap = 'butt';
    g.beginPath(); g.moveTo(xs[i] + 4, y); g.lineTo(xs[i + 1] - 4, y); g.stroke();
  }
  g.fillStyle = '#ffffff';
  g.beginPath(); g.moveTo(x0 - H * 0.03, y - H * 0.1); g.lineTo(x0 + H * 0.07, y); g.lineTo(x0 - H * 0.03, y + H * 0.1); g.fill();
  g.font = `700 ${H * 0.13}px ${font}`; g.textAlign = 'center';
  b.ahead.forEach((name, i) => {
    const x = xs[i + 1];
    g.fillStyle = '#ffffff'; g.fillRect(x - 3, y - H * 0.1, 6, H * 0.2);
    const label = name.replace(/桥$/, '') + '桥';
    g.fillStyle = '#e8edf2';
    g.fillText(label, Math.min(W - g.measureText(label).width / 2 - 12, x), H * 0.82);
  });
}

/**
 * 板上每一段的路况（2026-11-11，street-level-design A6）：按路况表（traffic/Flow.ts）查这条环路、这个方向、这一段中点
 * 所在的那一格——和路上的车读的是同一张表，所以板上红的那一段开过去真的堵。原来是按钟点掷骰子，和路上的车没关系。
 * `force`：`?flow=0|1|2` 把路况定死的时候板子也跟着。
 */
export function stretches(b: InfoBoard, hour: number, slot: number, force = -1): Status[] {
  const dir = headingOf(b.dx, b.dz), out: Status[] = [];
  let px = b.x, pz = b.z;
  for (let i = 0; i < b.ahead.length; i++) {
    const x = b.at[i * 2], z = b.at[i * 2 + 1];
    out.push(force >= 0 ? force as Status : levelAt(b.ring, dir, (px + x) / 2, (pz + z) / 2, hour, slot));
    px = x; pz = z;
  }
  return out;
}

export function install(engine: Engine): void {
  if (new URLSearchParams(location.search).get('infoboards') === '0') return;
  const world = engine.get<WorldApi & { routes?: Routes }>('world'), net = world?.routes?.net;
  if (!net) return;
  // worked out a few seconds in, not in the boot (~60 ms on a desktop)
  let boards: InfoBoard[] | null = null, wait = 5;
  const render = engine.get<RenderSystem & RenderApi>('render');
  const root = new THREE.Group();
  root.name = 'info-boards';
  engine.scene.add(root);
  // the frame: two posts outside the kerbs and a truss across, built per board (the span is the road's width)
  const steel = new THREE.MeshStandardMaterial({ color: '#8d9399', roughness: 0.55, metalness: 0.6 });
  steel.userData.wet = 'surface';
  const back = new THREE.MeshStandardMaterial({ color: '#2a2f34', roughness: 0.7, metalness: 0.3 });
  back.userData.wet = 'surface';
  const live = new Map<InfoBoard, { group: THREE.Group; tex: THREE.CanvasTexture; cv: HTMLCanvasElement; mat: THREE.MeshStandardMaterial; drawnAt: number }>();
  const build = (b: InfoBoard) => {
    const half = b.w / 2 + 1.4, top = BOARD_Y + BOARD_H / 2 + 0.6;
    const parts = [-1, 1].map((s) => new THREE.BoxGeometry(0.45, top, 0.45).translate(s * half, top / 2, 0));
    parts.push(new THREE.BoxGeometry(half * 2 + 0.5, 0.35, 0.35).translate(0, top - 0.2, 0), new THREE.BoxGeometry(half * 2 + 0.5, 0.25, 0.25).translate(0, BOARD_Y - BOARD_H / 2 - 0.2, 0));
    const frame = new THREE.Mesh(mergeGeometries(parts)!, steel);
    for (const p of parts) p.dispose();
    const cv = document.createElement('canvas');
    cv.width = 768; cv.height = 290;
    const tex = new THREE.CanvasTexture(cv);
    tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
    // redrawn every two minutes: core/Assets.compact must not free its canvas
    tex.userData.keepImage = true;
    const mat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: tex, emissiveIntensity: 0.45, roughness: 0.4 });
    const face = new THREE.Mesh(new THREE.PlaneGeometry(BOARD_W, BOARD_H), mat);
    face.position.set(0, BOARD_Y, -0.21);
    face.rotation.y = Math.PI;
    const box = new THREE.Mesh(new THREE.BoxGeometry(BOARD_W + 0.3, BOARD_H + 0.3, 0.4), back);
    box.position.set(0, BOARD_Y, 0);
    const group = new THREE.Group();
    group.add(frame, box, face);
    group.position.set(b.x, 0, b.z);
    // local -Z (the face) towards the traffic coming at it
    group.rotation.y = Math.atan2(b.dx, b.dz);
    render?.prepare?.(group);
    root.add(group);
    return { group, tex, cv, mat, drawnAt: -1 };
  };
  let poll = 0;
  engine.add({
    name: 'infoBoards',
    update(dt) {
      if (!boards) {
        if ((wait -= dt) > 0) return;
        boards = placeBoards(net, (engine.get<GuideSignApi>('guideSigns')?.signs ?? []).map((s) => ({ x: s.x, z: s.z })));
      }
      if ((poll -= dt) > 0) return;
      poll = 1;
      // 路况表关着（`?rush=0`）或被定死（`?flow=`）的时候跟着车流那边
      const gh = engine.get<{ name: string; ghosts?: { flowOn: boolean; force: number } | null }>('traffic')?.ghosts;
      const on = gh ? gh.flowOn : true, force = gh ? gh.force : -1;
      const cam = engine.camera.position, hour = render?.timeOfDay ?? 12, slot = slotNow() * 16 + Math.floor(hour);
      for (const b of boards) {
        const d = Math.hypot(b.x - cam.x, b.z - cam.z);
        let l = live.get(b);
        if (!l && d < NEAR) { l = build(b); live.set(b, l); }
        else if (l && d > FAR) {
          root.remove(l.group);
          l.group.traverse((o) => { if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).geometry.dispose(); });
          l.tex.dispose(); l.mat.dispose(); live.delete(b);
          continue;
        }
        if (l) l.mat.emissiveIntensity = 0.45 - 0.17 * (render?.night ?? 0);
        if (l && l.drawnAt !== slot) {
          l.drawnAt = slot;
          drawBoard(l.cv.getContext('2d')!, l.cv.width, l.cv.height, b, on ? stretches(b, hour, slotNow(), force) : b.ahead.map(() => 0 as Status));
          l.tex.needsUpdate = true;
        }
      }
    },
  });
}
