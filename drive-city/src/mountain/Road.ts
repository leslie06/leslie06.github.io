import * as THREE from 'three';
import type { MountainData, MountainRoad } from './Data';

/**
 * The roads west of the city as ribbons from mountain.bin's centre lines (2 m apart, banked): the carriageway (its
 * texture carries the lines - 妙峰山路 a double yellow centre and white edges, 京拉路 a dashed yellow centre), a gravel
 * shoulder each side falling a little to the ground, and W-beam guardrails with posts on the valley side where the
 * build put them. Pieces of PIECE points each, for culling; each piece's carriageway and shoulders are also its
 * collider (trimesh), and each guardrail run a wall.
 */
const PIECE = 120;
const SHOULDER_DROP = 0.18;

export interface RoadPiece { mesh: THREE.Mesh; shoulder: THREE.Mesh; verts: Float32Array; idx: Uint32Array }

function roadTexture(kind: 'mountain' | 'valley'): THREE.CanvasTexture {
  const W = 256, H = 1024;            // across the carriageway; 16 m along
  const c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d')!;
  g.fillStyle = '#4a4b4d'; g.fillRect(0, 0, W, H);
  // grain and patches
  for (let k = 0; k < 9000; k++) { const v = 60 + Math.random() * 40; g.fillStyle = `rgba(${v},${v},${v + 3},${0.25 + Math.random() * 0.3})`; g.fillRect(Math.random() * W, Math.random() * H, 1 + Math.random() * 2, 1 + Math.random() * 2); }
  for (let k = 0; k < 8; k++) { g.fillStyle = `rgba(30,30,32,${0.08 + Math.random() * 0.08})`; g.beginPath(); g.ellipse(Math.random() * W, Math.random() * H, 20 + Math.random() * 60, 40 + Math.random() * 120, 0, 0, Math.PI * 2); g.fill(); }
  // the wheel tracks, a little darker
  for (const u of [0.18, 0.36, 0.64, 0.82]) { g.fillStyle = 'rgba(25,25,27,0.12)'; g.fillRect(u * W - 10, 0, 20, H); }
  const roadW = kind === 'mountain' ? 7.5 : 9, px = W / roadW;
  g.fillStyle = 'rgba(232,232,226,0.92)';
  g.fillRect(0.25 * px, 0, 0.15 * px, H); g.fillRect(W - 0.4 * px, 0, 0.15 * px, H);
  g.fillStyle = 'rgba(226,178,40,0.95)';
  if (kind === 'mountain') { g.fillRect(W / 2 - 0.22 * px, 0, 0.15 * px, H); g.fillRect(W / 2 + 0.07 * px, 0, 0.15 * px, H); }
  else for (let v = 0; v < H; v += 640) g.fillRect(W / 2 - 0.075 * px, v, 0.15 * px, 256);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = THREE.ClampToEdgeWrapping; t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export function roadMaterials(): { mountain: THREE.MeshStandardMaterial; valley: THREE.MeshStandardMaterial; shoulder: THREE.MeshStandardMaterial; rail: THREE.MeshStandardMaterial; post: THREE.MeshStandardMaterial } {
  const mk = (kind: 'mountain' | 'valley') => { const m = new THREE.MeshStandardMaterial({ map: roadTexture(kind), roughness: 0.88, metalness: 0 }); m.userData.wet = 'ground'; return m; };
  const shoulder = new THREE.MeshStandardMaterial({ color: '#77736a', roughness: 1 }); shoulder.userData.wet = 'ground';
  const rail = new THREE.MeshStandardMaterial({ color: '#c8cbcd', roughness: 0.38, metalness: 0.65, side: THREE.DoubleSide }); rail.userData.wet = true;
  const post = new THREE.MeshStandardMaterial({ color: '#9fa3a6', roughness: 0.5, metalness: 0.5, side: THREE.DoubleSide }); post.userData.wet = true;
  return { mountain: mk('mountain'), valley: mk('valley'), shoulder, rail, post };
}

/** Left of travel at point i (unit, x-z) and the point itself. */
function frame(r: MountainRoad, i: number): { x: number; y: number; z: number; lx: number; lz: number; bank: number } {
  const p = r.p, n = r.n;
  const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1);
  const dx = p[b * 4] - p[a * 4], dz = p[b * 4 + 2] - p[a * 4 + 2], L = Math.hypot(dx, dz) || 1;
  return { x: p[i * 4], y: p[i * 4 + 1], z: p[i * 4 + 2], lx: dz / L, lz: -dx / L, bank: p[i * 4 + 3] };
}

/** One road's pieces: carriageway (textured), shoulders, the trimesh of both. */
export function buildRoad(r: MountainRoad, d: MountainData, mats: ReturnType<typeof roadMaterials>): RoadPiece[] {
  const out: RoadPiece[] = [];
  const kind = r.cls === 'tertiary' ? 'mountain' : 'valley';
  const sh = d.shoulder, last = r.n - 1;            // a ring's points already close on themselves
  for (let a = 0; a < last; a += PIECE) {
    const b = Math.min(last, a + PIECE);
    const cnt = b - a + 1;
    // per point: shoulder L outer, edge L, edge R, shoulder R outer
    const P = new Float32Array(cnt * 4 * 3), UV = new Float32Array(cnt * 2 * 2);
    for (let k = 0; k < cnt; k++) {
      const i = a + k, f = frame(r, i);
      const lift = Math.sin(f.bank) * r.hw;
      const pts = [
        [f.x + f.lx * (r.hw + sh), f.y + lift - SHOULDER_DROP, f.z + f.lz * (r.hw + sh)],
        [f.x + f.lx * r.hw, f.y + lift, f.z + f.lz * r.hw],
        [f.x - f.lx * r.hw, f.y - lift, f.z - f.lz * r.hw],
        [f.x - f.lx * (r.hw + sh), f.y - lift - SHOULDER_DROP, f.z - f.lz * (r.hw + sh)],
      ];
      pts.forEach((q, c) => P.set(q, (k * 4 + c) * 3));
      const v = ((a + k) * 2) / 16;
      UV.set([0, v, 1, v], k * 4);
    }
    // carriageway: columns 1..2
    const cp = new Float32Array(cnt * 2 * 3);
    for (let k = 0; k < cnt; k++) { cp.set(P.subarray((k * 4 + 1) * 3, (k * 4 + 1) * 3 + 3), k * 6); cp.set(P.subarray((k * 4 + 2) * 3, (k * 4 + 2) * 3 + 3), k * 6 + 3); }
    const ci: number[] = [];
    for (let k = 0; k < cnt - 1; k++) { const v = k * 2; ci.push(v, v + 1, v + 2, v + 1, v + 3, v + 2); }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute('position', new THREE.BufferAttribute(cp, 3));
    cg.setAttribute('uv', new THREE.BufferAttribute(UV, 2));
    cg.setIndex(ci); cg.computeVertexNormals(); cg.computeBoundingSphere();
    const mesh = new THREE.Mesh(cg, kind === 'mountain' ? mats.mountain : mats.valley);
    mesh.name = 'mountain-road'; mesh.receiveShadow = true;
    // shoulders: columns 0..1 and 2..3
    const si: number[] = [];
    for (let k = 0; k < cnt - 1; k++) { const v = k * 4; si.push(v, v + 1, v + 4, v + 1, v + 5, v + 4, v + 2, v + 3, v + 6, v + 3, v + 7, v + 6); }
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.BufferAttribute(P, 3));
    sg.setIndex(si); sg.computeVertexNormals(); sg.computeBoundingSphere();
    const shoulder = new THREE.Mesh(sg, mats.shoulder);
    shoulder.name = 'mountain-shoulder'; shoulder.receiveShadow = true;
    // the collider: the whole cross-section, as one strip
    const idx: number[] = [];
    for (let k = 0; k < cnt - 1; k++) for (let c = 0; c < 3; c++) { const v = k * 4 + c; idx.push(v, v + 1, v + 4, v + 1, v + 5, v + 4); }
    out.push({ mesh, shoulder, verts: P, idx: new Uint32Array(idx) });
  }
  return out;
}

/**
 * The guardrails: per run a mesh of the W-beam and one of its posts (culled with the camera; no shadows - 10 km of rail
 * drawn into three cascades was a sixth of a high frame), and a wall (verts, idx) per run for the collider.
 */
export function buildRails(d: MountainData, mats: ReturnType<typeof roadMaterials>): { meshes: THREE.Mesh[]; walls: { verts: Float32Array; idx: Uint32Array }[] } {
  const meshes: THREE.Mesh[] = [];
  const walls: { verts: Float32Array; idx: Uint32Array }[] = [];
  // the W profile across the beam, simplified to a fold: out (from the road), up
  const prof: [number, number][] = [[0, 0.45], [0.07, 0.61], [0, 0.77]];
  for (const [ri, side, from, to] of d.rails) {
    const r = d.roads[ri];
    const off = r.hw + d.shoulder - 0.3;
    const wv: number[] = [], wi: number[] = [];
    const bp: number[] = [], bi: number[] = [], pp: number[] = [], pi: number[] = [];
    const base = 0;
    for (let i = from; i <= to; i++) {
      const f = frame(r, i);
      const ox = f.lx * side, oz = f.lz * side;
      const lift = Math.sin(f.bank) * r.hw * side;
      const x = f.x + ox * off, z = f.z + oz * off, y = f.y + lift - SHOULDER_DROP * 0.6;
      for (const [o, up] of prof) bp.push(x + ox * (o + 0.12), y + up, z + oz * (o + 0.12));
      if (i < to) for (let c = 0; c < prof.length - 1; c++) { const v = base + (i - from) * prof.length + c, w = v + prof.length; bi.push(v, w, v + 1, v + 1, w, w + 1); }
      wv.push(x, y, z, x, y + 0.95, z);
      if (i < to) { const v = (i - from) * 2; wi.push(v, v + 2, v + 1, v + 1, v + 2, v + 3); }
      // a post every 4 m
      if ((i - from) % 2 === 0) {
        const pb = pp.length / 3, s = 0.075;
        const tx = -oz, tz = ox;                 // along the road
        const corners = [[-s, -s], [s, -s], [s, s], [-s, s]].map(([u, w]) => [x + ox * u + tx * w, z + oz * u + tz * w]);
        for (const [cx, cz] of corners) pp.push(cx, y - 0.3, cz);
        for (const [cx, cz] of corners) pp.push(cx, y + 0.8, cz);
        for (let c = 0; c < 4; c++) { const c2 = (c + 1) % 4; pi.push(pb + c, pb + c2, pb + 4 + c, pb + c2, pb + 4 + c2, pb + 4 + c); }
        pi.push(pb + 4, pb + 5, pb + 6, pb + 4, pb + 6, pb + 7);
      }
    }
    walls.push({ verts: new Float32Array(wv), idx: new Uint32Array(wi) });
    const mk = (p: number[], i: number[], mat: THREE.Material, name: string) => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3)); g.setIndex(i); g.computeVertexNormals(); g.computeBoundingSphere();
      const m = new THREE.Mesh(g, mat); m.name = name; m.castShadow = false; m.receiveShadow = true;
      return m;
    };
    // the posts in the same mesh as the beam (one draw a run): their indices after the beam's vertices
    const nb = bp.length / 3;
    meshes.push(mk(bp.concat(pp), bi.concat(pi.map((v) => v + nb)), mats.rail, 'mountain-rail'));
  }
  return { meshes, walls };
}
