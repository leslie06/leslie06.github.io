import * as THREE from 'three';
import { Parts, box, cyl, lathe, lerp, type V3 } from './geo';

/** Humpbacked marble bridge along z centred on (x, zc): deck, side faces and a railing. */
export function marbleBridge(P: Parts, x: number, zc: number, w: number, len: number, rise: number): void {
  const b = P.get('marble');
  const y = (t: number) => 0.3 + rise * Math.pow(Math.sin(Math.PI * t), 0.9);
  const n = 16, hw = w / 2;
  b.grid(2, n, (u, v) => [x + (u - 0.5) * w, y(v), zc - len / 2 + v * len], (u, v) => [u * w, v * len], [0, 1, 0]);
  for (const sx of [-1, 1]) {
    b.grid(1, n, (u, v) => [x + sx * hw, lerp(-1.2, y(v), u), zc - len / 2 + v * len], (u, v) => [v * len, u * 2], [sx, 0, 0]);
    // railing: posts along the curve and pitched panels between them
    const posts: V3[] = [];
    const k = Math.round(len / 2.1);
    for (let i = 0; i <= k; i++) { const t = i / k; posts.push([x + sx * (hw - 0.2), y(t), zc - len / 2 + t * len]); }
    for (let i = 0; i < posts.length; i++) {
      const p = posts[i];
      box(b, p[0], p[1] + 0.55, p[2], 0.22, 1.1, 0.22);
      box(b, p[0], p[1] + 1.2, p[2], 0.28, 0.2, 0.28);
      if (i > 0) {
        const q = posts[i - 1];
        const mid: V3 = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2, (p[2] + q[2]) / 2];
        const dir = new THREE.Vector3(p[0] - q[0], p[1] - q[1], p[2] - q[2]);
        const L = dir.length() - 0.22; dir.normalize();
        const up = new THREE.Vector3(0, 1, 0);
        const side = new THREE.Vector3().crossVectors(dir, up).normalize();
        const up2 = new THREE.Vector3().crossVectors(side, dir);
        const m = new THREE.Matrix4().makeBasis(dir, up2, side).setPosition(mid[0], mid[1], mid[2]);
        P.push(m);
        box(b, 0, 0.42, 0, L, 0.7, 0.12, { faces: 'zZY' });
        box(b, 0, 0.92, 0, L, 0.12, 0.14, { faces: 'zZYy' });
        P.pop();
      }
    }
  }
}

/** 华表: octagonal marble column with a cloud board and a disc crowned by a beast, on a sumeru base. */
export function huabiao(P: Parts, x: number, z: number, h: number): void {
  const b = P.get('marble');
  box(b, x, 0.35, z, 2.6, 0.7, 2.6);
  box(b, x, 0.95, z, 2.0, 0.5, 2.0);
  box(b, x, 1.35, z, 2.3, 0.3, 2.3);
  cyl(b, x, 1.5, z, 0.52, 0.46, h - 2.9, 8, { phase: Math.PI / 8 });
  // coiled-dragon bulges
  for (let i = 0; i < 5; i++) cyl(b, x, 2.4 + i * 1.25, z, 0.58, 0.58, 0.45, 8, { phase: i * 0.4 });
  box(b, x, h - 2.4, z, 3.0, 0.55, 0.28);                   // 云板
  lathe(b, [[0.4, h - 1.4], [0.95, h - 1.2], [0.95, h - 1.0], [0.5, h - 0.95]], 12, x, z);   // 承露盘
  box(b, x, h - 0.55, z, 0.45, 0.85, 0.8);                   // 犼
  cyl(b, x, h - 0.2, z, 0.2, 0.05, 0.3, 6);
}
