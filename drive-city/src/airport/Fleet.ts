import * as THREE from 'three';
import { LIVERIES, planeGeometry, type PlaneKind } from './Plane';

/**
 * 飞机的实例网格池（2026-11-16）：机型 × 两档（近 / 远）× 三块（机身、涂装、起落架），每块一张 InstancedMesh。
 * 一帧里先 `begin()`，每架 `add()`，再 `end()`——只有用到的才画。矩阵直接写进数组（`setMatrixAt` 在热路径上慢，见 CLAUDE.md）。
 */
export class Fleet {
  readonly group = new THREE.Group();
  private pools: { mesh: THREE.InstancedMesh; part: 'body' | 'livery' | 'gear'; n: number }[][][] = [];
  private m = new THREE.Matrix4();
  private q = new THREE.Quaternion();
  private e = new THREE.Euler(0, 0, 0, 'YXZ');
  private s = new THREE.Vector3(1, 1, 1);
  private p = new THREE.Vector3();

  constructor(cap: [number, number], shadows: boolean, name: string) {
    this.group.name = name;
    const body = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12 });
    const livery = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.08 });
    const gear = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.7, metalness: 0.2 });
    for (const kind of [0, 1, 2] as PlaneKind[]) {
      this.pools[kind] = [];
      for (const lod of [0, 1]) {
        const g = planeGeometry(kind, lod === 0);
        const list: { mesh: THREE.InstancedMesh; part: 'body' | 'livery' | 'gear'; n: number }[] = [];
        for (const part of ['body', 'livery', 'gear'] as const) {
          const mesh = new THREE.InstancedMesh(g[part], part === 'body' ? body : part === 'livery' ? livery : gear, cap[lod]);
          mesh.count = 0;
          mesh.frustumCulled = false;
          mesh.castShadow = shadows && lod === 0;
          mesh.receiveShadow = lod === 0;
          if (part === 'livery') mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap[lod] * 3), 3);
          mesh.name = `${name}-${kind}-${lod}-${part}`;
          this.group.add(mesh);
          list.push({ mesh, part, n: 0 });
        }
        this.pools[kind][lod] = list;
      }
    }
  }

  begin(): void { for (const k of this.pools) for (const l of k) for (const p of l) p.n = 0; }

  /** 一架：位置（地面 y）、航向（机头朝 (sin yaw, cos yaw)）、俯仰（抬头为正）、滚转、涂装、档、起落架放没放。 */
  add(kind: PlaneKind, x: number, y: number, z: number, yaw: number, pitch: number, roll: number, livery: number, lod: 0 | 1, gearDown: boolean): void {
    this.e.set(-pitch, yaw, -roll, 'YXZ');
    this.q.setFromEuler(this.e);
    this.m.compose(this.p.set(x, y, z), this.q, this.s);
    const me = this.m.elements, col = LIVERIES[livery % LIVERIES.length];
    for (const pool of this.pools[kind][lod]) {
      if (pool.part === 'gear' && !gearDown) continue;
      const mesh = pool.mesh;
      if (pool.n >= mesh.instanceMatrix.count) continue;
      const a = mesh.instanceMatrix.array as Float32Array, o = pool.n * 16;
      for (let i = 0; i < 16; i++) a[o + i] = me[i];
      if (pool.part === 'livery') { const c = mesh.instanceColor!.array as Float32Array; c[pool.n * 3] = col.r; c[pool.n * 3 + 1] = col.g; c[pool.n * 3 + 2] = col.b; }
      pool.n++;
    }
  }

  end(): void {
    for (const k of this.pools) for (const l of k) for (const p of l) {
      p.mesh.count = p.n;
      p.mesh.visible = p.n > 0;
      if (p.n) { p.mesh.instanceMatrix.needsUpdate = true; if (p.mesh.instanceColor) p.mesh.instanceColor.needsUpdate = true; }
    }
  }
}
