import * as THREE from 'three';
import { merge, prep, type GeoOpts } from './Geo';
import type { MaterialLib } from './Materials';

/**
 * Collects static geometry per material and flushes each material into a single merged Mesh.
 * Repeated props go through `instanced()` → one InstancedMesh (one draw call) per prop kind.
 */
export class Batcher {
  private buckets = new Map<string, THREE.BufferGeometry[]>();
  private instances = new Map<string, { geo: THREE.BufferGeometry; mat: string; mats: THREE.Matrix4[]; colors: THREE.Color[]; shadow: boolean }>();
  readonly meshes: THREE.Mesh[] = [];
  triangles = 0;

  constructor(private lib: MaterialLib, private root: THREE.Group) {}

  add(mat: string, geo: THREE.BufferGeometry | null | undefined): void {
    if (!geo) return;
    let b = this.buckets.get(mat);
    if (!b) { b = []; this.buckets.set(mat, b); }
    b.push(geo);
  }
  addAll(mat: string, geos: THREE.BufferGeometry[]): void { for (const g of geos) this.add(mat, g); }

  /** Register an instance of a prop kind. Geometry is prepped once (local space, keep uv option). */
  instanced(kind: string, mat: string, makeGeo: () => THREE.BufferGeometry, m: THREE.Matrix4, color?: THREE.ColorRepresentation, opts: GeoOpts = {}, shadow = true): void {
    let e = this.instances.get(kind);
    if (!e) { e = { geo: prep(makeGeo(), { uv: 'planar', ...opts }), mat, mats: [], colors: [], shadow }; this.instances.set(kind, e); }
    e.mats.push(m.clone());
    e.colors.push(new THREE.Color(color ?? 0xffffff));
  }

  /** [name, triangles] per mesh, filled by flush(). */
  readonly report: [string, number][] = [];

  flush(opts: { shadows?: Set<string>; noShadow?: Set<string> } = {}): void {
    for (const [mat, geos] of this.buckets) {
      const g = merge(geos);
      if (!g) continue;
      this.report.push([mat, (g.getAttribute('position').count / 3) | 0]);
      const mesh = new THREE.Mesh(g, this.lib.get(mat));
      mesh.name = `static:${mat}`;
      const noShadow = opts.noShadow?.has(mat) ?? false;
      mesh.castShadow = !noShadow; mesh.receiveShadow = true;
      mesh.matrixAutoUpdate = false; mesh.updateMatrix();
      this.root.add(mesh); this.meshes.push(mesh);
      this.triangles += (g.getAttribute('position').count / 3) | 0;
    }
    this.buckets.clear();
    for (const [kind, e] of this.instances) {
      const im = new THREE.InstancedMesh(e.geo, this.lib.get(e.mat), e.mats.length);
      for (let i = 0; i < e.mats.length; i++) { im.setMatrixAt(i, e.mats[i]); im.setColorAt(i, e.colors[i]); }
      im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true;
      im.name = `inst:${kind}`;
      this.report.push([`inst:${kind}×${e.mats.length}`, ((e.geo.getAttribute('position').count / 3) | 0) * e.mats.length]);
      im.castShadow = e.shadow; im.receiveShadow = true;
      im.frustumCulled = false;
      this.root.add(im); this.meshes.push(im);
      this.triangles += ((e.geo.getAttribute('position').count / 3) | 0) * e.mats.length;
    }
    this.instances.clear();
  }
}
