import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export interface PbrMaps { map?: THREE.Texture; normalMap?: THREE.Texture; roughnessMap?: THREE.Texture; aoMap?: THREE.Texture; metalnessMap?: THREE.Texture; displacementMap?: THREE.Texture }

/**
 * Texture sets live in public/textures/<name>/{diffuse,normal,rough,ao,disp,metal}.(jpg|png)
 * (fetched by scripts/fetch-assets.mjs).
 *
 * Every set is decoded and uploaded once. A caller that wants a different `repeat` gets a
 * `Texture.clone()`: clones share the `Source`, and the renderer keys its GL textures by source, so
 * ten materials tiling the same brick at ten scales cost one upload (world/Materials does its own
 * per-tile clones the same way). The cache is therefore keyed on the set alone, never on `repeat`.
 *
 * `maxTextureSize` caps the decoded size: images larger than it are halved on a canvas until they
 * fit, before the texture is created, so the full-size image is never uploaded. The Polyhaven sets
 * are a mix of 1k and 2k files, and the level uses ~130 of their maps; at 2k a map with mips is
 * 22 MB and at 1k 5.6 MB, so this cap - not `pixelRatio` or shadow size - is what decides whether
 * the scene needs 1.4 GB of GPU memory or a third of that. Quality tiers set it via
 * `quality.textureRes` (see Engine).
 */
export class Assets {
  private texLoader = new THREE.TextureLoader();
  private cache = new Map<string, Promise<PbrMaps>>();
  private hdriCache = new Map<string, Promise<THREE.DataTexture>>();
  anisotropy = 8;
  /** Largest edge a loaded texture keeps; larger images are downscaled before upload. */
  maxTextureSize = Infinity;
  readonly base = import.meta.env.BASE_URL;

  pbr(name: string, opts: { repeat?: [number, number]; withDisp?: boolean } = {}): Promise<PbrMaps> {
    const key = `${name}|${opts.withDisp ? 'd' : ''}`;
    let p = this.cache.get(key);
    if (!p) { p = this.loadPbr(name, opts.withDisp === true); this.cache.set(key, p); }
    if (!opts.repeat) return p;
    const [rx, ry] = opts.repeat;
    return p.then((maps) => {
      const out: PbrMaps = {};
      for (const k of Object.keys(maps) as (keyof PbrMaps)[]) {
        const t = maps[k]; if (!t) continue;
        const c = t.clone(); c.repeat.set(rx, ry);
        out[k] = c;
      }
      return out;
    });
  }

  private async loadPbr(name: string, withDisp: boolean): Promise<PbrMaps> {
    const dir = `${this.base}textures/${name}/`;
    let manifest: { maps: Record<string, string> } | null = null;
    try { manifest = await (await fetch(`${dir}manifest.json`)).json(); } catch { /* missing set -> flat material */ }
    if (!manifest) return {};
    const out: PbrMaps = {};
    const load = (file: string, srgb: boolean) => new Promise<THREE.Texture>((res, rej) => this.texLoader.load(dir + file, (t) => {
      // Texture<HTMLImageElement> from the loader; a downscaled canvas is a valid image source at runtime.
      (t as unknown as { image: HTMLImageElement | HTMLCanvasElement }).image = this.fit(t.image as HTMLImageElement);
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = this.anisotropy;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      res(t);
    }, undefined, rej));
    const m = manifest.maps;
    const jobs: Promise<void>[] = [];
    if (m.diffuse) jobs.push(load(m.diffuse, true).then((t) => { out.map = t; }));
    if (m.normal) jobs.push(load(m.normal, false).then((t) => { out.normalMap = t; }));
    if (m.rough) jobs.push(load(m.rough, false).then((t) => { out.roughnessMap = t; }));
    if (m.ao) jobs.push(load(m.ao, false).then((t) => { out.aoMap = t; }));
    if (m.metal) jobs.push(load(m.metal, false).then((t) => { out.metalnessMap = t; }));
    if (withDisp && m.disp) jobs.push(load(m.disp, false).then((t) => { out.displacementMap = t; }));
    await Promise.allSettled(jobs);
    return out;
  }

  /**
   * Downscale `img` by successive halving until both edges are within `maxTextureSize`. Halving
   * steps keep the browser's bilinear drawImage from aliasing the way a single 4x shrink would.
   * Returns the original element when no scaling is needed, so nothing is copied on the high tiers.
   */
  private fit(img: HTMLImageElement): HTMLImageElement | HTMLCanvasElement {
    const max = this.maxTextureSize;
    if (!(max > 0) || !Number.isFinite(max)) return img;
    let w = img.naturalWidth || img.width, h = img.naturalHeight || img.height;
    if (w <= max && h <= max) return img;
    let src: HTMLImageElement | HTMLCanvasElement = img;
    while (w > max || h > max) {
      w = Math.max(1, Math.round(w / 2)); h = Math.max(1, Math.round(h / 2));
      const c = document.createElement('canvas');
      c.width = w; c.height = h;
      const ctx = c.getContext('2d');
      if (!ctx) return img;
      ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(src, 0, 0, w, h);
      src = c;
    }
    return src;
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
