import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../core/Rng';
import { SKYLINE } from './Layout';

/**
 * The CBD on the horizon: 中国尊 (the vessel-shaped 528 m tower), 国贸三期, the CCTV loop and a
 * few dozen anonymous towers, plus the Western Hills (西山) far behind. Unlit and pre-hazed: at
 * 3 km in a Beijing afternoon they are shapes, not buildings, and drawing them as shapes costs a
 * handful of triangles and two draw calls.
 */
export function buildSkyline(haze: THREE.Color): THREE.Group {
  const g = new THREE.Group();
  g.name = 'skyline';
  const rng = new Rng(7);
  const towers: THREE.BufferGeometry[] = [];
  const colorAttr = (geo: THREE.BufferGeometry, c: THREE.Color) => {
    const n = geo.getAttribute('position').count;
    const a = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; }
    geo.setAttribute('color', new THREE.BufferAttribute(a, 3));
    return geo;
  };
  const tint = (k: number) => new THREE.Color('#6d7a86').lerp(haze, k);
  const box = (x: number, z: number, w: number, d: number, h: number, k: number, yaw = 0) => {
    const geo = new THREE.BoxGeometry(w, h, d).translate(0, h / 2, 0).rotateY(yaw).translate(x, 0, z);
    towers.push(colorAttr(geo.toNonIndexed(), tint(k)));
  };

  // 中国尊: square plan, waisted like a ritual vessel (尊): wide foot, narrow waist at ~2/3, flared top.
  {
    const { x, z, h } = SKYLINE.zun;
    const rings = 24;
    const pos: number[] = [];
    const prof = (t: number) => 39 - 15 * Math.sin(Math.min(1, t / 0.78) * Math.PI * 0.62) + (t > 0.78 ? (t - 0.78) * 42 : 0);
    const sq = (r: number, y: number) => [[r, y, r], [-r, y, r], [-r, y, -r], [r, y, -r]];
    for (let i = 0; i < rings; i++) {
      const t0 = i / rings, t1 = (i + 1) / rings;
      const a = sq(prof(t0), t0 * h), b = sq(prof(t1), t1 * h);
      for (let k = 0; k < 4; k++) {
        const k1 = (k + 1) % 4;
        pos.push(...a[k], ...a[k1], ...b[k1], ...a[k], ...b[k1], ...b[k]);
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.rotateY(0.3).translate(x, 0, z);
    towers.push(colorAttr(geo, tint(0.58)));
  }
  // 国贸三期: slab tower with stepped crown.
  {
    const { x, z, h } = SKYLINE.gm3;
    box(x, z, 58, 58, h * 0.86, 0.62, 0.2);
    box(x, z, 46, 46, h * 0.94, 0.62, 0.2);
    box(x, z, 30, 30, h, 0.62, 0.2);
  }
  // CCTV: two leaning towers joined by a cantilevered bridge at the top.
  {
    const { x, z, h } = SKYLINE.cctv;
    const lean = 0.1;
    const leg = (dx: number, dir: number) => {
      const geo = new THREE.BoxGeometry(52, h, 52).translate(0, h / 2, 0);
      geo.applyMatrix4(new THREE.Matrix4().makeShear(0, 0, dir * lean, 0, 0, 0));
      geo.translate(x + dx, 0, z);
      towers.push(colorAttr(geo.toNonIndexed(), tint(0.68)));
    };
    leg(-70, 1); leg(70, -1);
    const top = new THREE.BoxGeometry(200, 56, 52).translate(x, h - 28, z);
    towers.push(colorAttr(top.toNonIndexed(), tint(0.68)));
    const base = new THREE.BoxGeometry(220, 50, 90).translate(x, 25, z + 20);
    towers.push(colorAttr(base.toNonIndexed(), tint(0.7)));
  }
  // Anonymous towers around them, nearer ones hazier-lighter only slightly.
  const { x: cx, z: cz } = SKYLINE.centre;
  for (let i = 0; i < 46; i++) {
    const a = rng.range(-Math.PI, Math.PI), r = rng.range(150, 1300);
    const x = cx + Math.cos(a) * r * 1.4, z = cz + Math.sin(a) * r * 0.6;
    const h = rng.range(70, 240), w = rng.range(30, 60);
    box(x, z, w, rng.range(26, 55), h, rng.range(0.6, 0.78), rng.range(0, 1.5));
  }
  // Low city fabric between the yard and the towers.
  for (let i = 0; i < 90; i++) {
    const a = rng.range(Math.PI * 0.2, Math.PI * 0.95), r = rng.range(900, 2600);
    box(Math.cos(a) * r - 300, Math.sin(a) * r + 400, rng.range(40, 120), rng.range(20, 60), rng.range(15, 55), rng.range(0.7, 0.86), rng.range(0, 1.5));
  }
  // Unlit, so only position + colour matter; strip the rest so every piece merges.
  const clean = towers.map((geo) => {
    const g2 = geo.index ? geo.toNonIndexed() : geo;
    for (const k of Object.keys(g2.attributes)) if (k !== 'position' && k !== 'color') g2.deleteAttribute(k);
    return g2;
  });
  const merged = mergeGeometries(clean)!;
  const mat = new THREE.MeshBasicMaterial({ vertexColors: true, fog: false });
  const mesh = new THREE.Mesh(merged, mat);
  mesh.frustumCulled = false;
  g.add(mesh);

  // 西山: a long low ridge far to the north-west, barely darker than the haze.
  {
    const pts: number[] = [];
    const R = 9000, segs = 90;
    for (let i = 0; i <= segs; i++) {
      const a = Math.PI * 0.55 + (i / segs) * Math.PI * 0.55;
      const n = Math.sin(i * 0.37) * 0.5 + Math.sin(i * 0.11 + 1) * 0.35 + Math.sin(i * 1.3) * 0.15;
      const hgt = 380 + n * 260;
      const x = Math.cos(a) * R, z = Math.sin(a) * R;
      pts.push(x, -20, z, x, hgt, z);
    }
    const idx: number[] = [];
    for (let i = 0; i < segs; i++) { const b = i * 2; idx.push(b, b + 2, b + 1, b + 1, b + 2, b + 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
    geo.setIndex(idx);
    const ridge = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: new THREE.Color('#7f8a90').lerp(haze, 0.72), fog: false, side: THREE.DoubleSide }));
    ridge.frustumCulled = false;
    g.add(ridge);
  }
  return g;
}
