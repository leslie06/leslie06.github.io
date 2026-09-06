import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export interface PbrMaps { map?: THREE.Texture; normalMap?: THREE.Texture; roughnessMap?: THREE.Texture; aoMap?: THREE.Texture; metalnessMap?: THREE.Texture; displacementMap?: THREE.Texture }

/**
 * Texture sets live in public/textures/<name>/{diffuse,normal,rough,ao,disp,metal}.(jpg|png)
 * (fetched by scripts/fetch-assets.mjs). Every set is cached; requesting the same set twice
 * returns the same Texture objects so materials can share GPU memory.
 */
export class Assets {
  private texLoader = new THREE.TextureLoader();
  private cache = new Map<string, Promise<PbrMaps>>();
  private hdriCache = new Map<string, Promise<THREE.DataTexture>>();
  anisotropy = 8;
  readonly base = import.meta.env.BASE_URL;

  pbr(name: string, opts: { repeat?: [number, number]; withDisp?: boolean } = {}): Promise<PbrMaps> {
    const key = `${name}|${opts.repeat?.join(',') ?? ''}|${opts.withDisp ? 'd' : ''}`;
    let p = this.cache.get(key);
    if (!p) { p = this.loadPbr(name, opts); this.cache.set(key, p); }
    return p;
  }

  private async loadPbr(name: string, opts: { repeat?: [number, number]; withDisp?: boolean }): Promise<PbrMaps> {
    const dir = `${this.base}textures/${name}/`;
    let manifest: { maps: Record<string, string> } | null = null;
    try { manifest = await (await fetch(`${dir}manifest.json`)).json(); } catch { /* missing set -> flat material */ }
    if (!manifest) return {};
    const out: PbrMaps = {};
    const load = (file: string, srgb: boolean) => new Promise<THREE.Texture>((res, rej) => this.texLoader.load(dir + file, (t) => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = this.anisotropy;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      if (opts.repeat) t.repeat.set(opts.repeat[0], opts.repeat[1]);
      res(t);
    }, undefined, rej));
    const m = manifest.maps;
    const jobs: Promise<void>[] = [];
    if (m.diffuse) jobs.push(load(m.diffuse, true).then((t) => { out.map = t; }));
    if (m.normal) jobs.push(load(m.normal, false).then((t) => { out.normalMap = t; }));
    if (m.rough) jobs.push(load(m.rough, false).then((t) => { out.roughnessMap = t; }));
    if (m.ao) jobs.push(load(m.ao, false).then((t) => { out.aoMap = t; }));
    if (m.metal) jobs.push(load(m.metal, false).then((t) => { out.metalnessMap = t; }));
    if (opts.withDisp && m.disp) jobs.push(load(m.disp, false).then((t) => { out.displacementMap = t; }));
    await Promise.allSettled(jobs);
    return out;
  }

  hdri(name: string): Promise<THREE.DataTexture> {
    let p = this.hdriCache.get(name);
    if (!p) {
      p = new Promise((res, rej) => new HDRLoader().load(`${this.base}hdri/${name}.hdr`, (t) => { t.mapping = THREE.EquirectangularReflectionMapping; res(t); }, undefined, rej));
      this.hdriCache.set(name, p);
    }
    return p;
  }
}
