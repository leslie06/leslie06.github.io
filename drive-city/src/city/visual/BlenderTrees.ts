import * as THREE from 'three';
import type { EnvUniforms } from '../../game/Contracts';
import TREES from './trees.json';

/**
 * The street trees grown in Blender (2026-09-27; scripts/blender/trees/): per species a branching
 * skeleton with leaf cards over the crown, in a near and a mid level (`trees.json`, converted by
 * scripts/vehicles/import.mjs --group), and for the far level an impostor - the near tree rendered
 * from the side in Blender - on two crossed quads. One 2048 x 1024 atlas holds the four leaf
 * sprites (modelled sprigs rendered with Cycles), the four impostors and the bark
 * (public/models/trees/foliage.webp, scripts/trees/atlas.mjs).
 *
 * The procedural trees (Foliage.ts) are built at boot as before, synchronously and with no network;
 * `loadBlenderTrees` fetches the atlas and hands back geometries and materials that the streamer
 * swaps into its instance pools when it arrives (`?trees=old` keeps the procedural ones).
 * Geometry attributes match Foliage.ts (position, normal, uv, color for a crown's AO, aSway), so the
 * same sway and mip-alpha shader serves both.
 */
type Part = { p: number[]; n: number[]; i: number[]; t?: number[] };
const SPECIES = ['huai', 'poplar', 'cypress', 'ginkgo'] as const;
/** The impostors' frames in metres (trees.py writes .scratch/trees/impostors.json): width and height of the cell. */
const IMPOSTOR: Record<(typeof SPECIES)[number], { width: number; height: number }> = {
  huai: { width: 8.515, height: 9.732 }, poplar: { width: 13.78, height: 15.749 },
  cypress: { width: 8.916, height: 10.189 }, ginkgo: { width: 10.34, height: 11.817 },
};

function level(species: string, lod: 'near' | 'mid'): THREE.BufferGeometry {
  const parts = (TREES as unknown as Record<string, Record<string, Part>>)[`${species}_${lod}`];
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], sway: number[] = [], idx: number[] = [];
  let top = 0;
  for (const g of Object.values(parts)) for (let i = 1; i < g.p.length; i += 3) top = Math.max(top, g.p[i] / 1000);
  for (const [name, g] of Object.entries(parts)) {
    const base = pos.length / 3;
    const leaf = name === 'leaf';
    // the crown's centre, for leaf normals that shade it as a volume and for its ambient occlusion
    let cx = 0, cy = 0, cz = 0;
    if (leaf) { const n = g.p.length / 3; for (let i = 0; i < g.p.length; i += 3) { cx += g.p[i]; cy += g.p[i + 1]; cz += g.p[i + 2]; } cx /= n * 1000; cy /= n * 1000; cz /= n * 1000; }
    for (let i = 0, k = 0; i < g.p.length; i += 3, k += 2) {
      const x = g.p[i] / 1000, y = g.p[i + 1] / 1000, z = g.p[i + 2] / 1000;
      pos.push(x, y, z);
      if (leaf) {
        const d = new THREE.Vector3(x - cx, (y - cy) * 0.7, z - cz);
        const r = d.length();
        d.normalize().lerp(new THREE.Vector3(g.n[i] / 100, g.n[i + 1] / 100, g.n[i + 2] / 100), 0.25).normalize();
        nor.push(d.x, d.y, d.z);
        const out = Math.min(1, r / 3.5), h = Math.max(0, Math.min(1, y / top));
        const ao = (0.5 + 0.4 * out) * (0.7 + 0.24 * h);
        col.push(ao, ao, ao);
        sway.push(Math.min(1, 0.25 + 0.85 * h));
      } else {
        nor.push(g.n[i] / 100, g.n[i + 1] / 100, g.n[i + 2] / 100);
        col.push(1, 1, 1);
        sway.push(Math.min(0.45, Math.max(0, (y - 2) / 12)));
      }
      uv.push((g.t?.[k] ?? 0) / 4096, (g.t?.[k + 1] ?? 0) / 4096);
    }
    for (const i of g.i) idx.push(base + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

/** Two crossed quads carrying species `s`'s impostor (its cell in the atlas's bottom row). */
function impostor(s: number): THREE.BufferGeometry {
  const { width, height } = IMPOSTOR[SPECIES[s]];
  // UVs glTF-style, v down from the top of the atlas (flipY off): the impostors are the bottom row
  const u0 = (448 * s + 1) / 2048, u1 = (448 * (s + 1) - 1) / 2048, vBottom = 1023 / 1024, vTop = 513 / 1024;
  const pos: number[] = [], nor: number[] = [], uv: number[] = [], col: number[] = [], sway: number[] = [], idx: number[] = [];
  for (const [ax, az] of [[1, 0], [0, 1]]) {
    const b = pos.length / 3, hw = width / 2;
    for (const [sx, y] of [[-1, 0], [1, 0], [1, height], [-1, height]]) {
      pos.push(ax * sx * hw, y, az * sx * hw);
      nor.push(0, 1, 0);          // lit from above like a crown, not by the quad's own facing
      uv.push(sx < 0 ? u0 : u1, y > 0 ? vTop : vBottom);
      col.push(0.74, 0.74, 0.74);
      sway.push(y > 0 ? 0.35 : 0);
    }
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute('aSway', new THREE.Float32BufferAttribute(sway, 1));
  geo.setIndex(idx);
  geo.computeBoundingSphere();
  return geo;
}

export interface BlenderTrees { near: THREE.BufferGeometry[]; mid: THREE.BufferGeometry[]; far: THREE.BufferGeometry[]; map: THREE.Texture }

/** Fetch the atlas and build the geometries (the materials are Foliage.ts's with this map). */
export async function loadBlenderTrees(anisotropy: number): Promise<BlenderTrees> {
  const map = await new THREE.TextureLoader().loadAsync(`${import.meta.env.BASE_URL}models/trees/foliage.webp`);
  map.colorSpace = THREE.SRGBColorSpace;
  map.flipY = false;               // the models' UVs are glTF's (v down)
  map.anisotropy = anisotropy;
  map.generateMipmaps = true;
  map.minFilter = THREE.LinearMipmapLinearFilter;
  return {
    near: SPECIES.map((s) => level(s, 'near')),
    mid: SPECIES.map((s) => level(s, 'mid')),
    far: SPECIES.map((_, i) => impostor(i)),
    map,
  };
}

/** Swap the atlas into the foliage material and its shadow twin (the shader reads `map` as before). */
export function useTreeMap(mats: { mat: THREE.MeshStandardMaterial; depth: THREE.MeshDepthMaterial }, map: THREE.Texture, env: EnvUniforms): void {
  void env;
  mats.mat.map = map; mats.mat.needsUpdate = true;
  mats.depth.map = map; mats.depth.needsUpdate = true;
}
