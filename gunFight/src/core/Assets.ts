import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export interface PbrMaps { map?: THREE.Texture; normalMap?: THREE.Texture; roughnessMap?: THREE.Texture; aoMap?: THREE.Texture; displacementMap?: THREE.Texture; metalnessMap?: THREE.Texture }

type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/**
 * Texture sets live in public/textures/<name>/{diffuse,normal,rough,ao,disp,metal}.(jpg|png)
 * (fetched by scripts/fetch-assets.mjs).
 *
 * Every set is decoded and uploaded once. A caller that wants a different `repeat` gets a
 * `Texture.clone()`: clones share the `Source`, and the renderer keys its GL textures by source, so
 * ten materials tiling the same brick at ten scales cost one upload (world/Materials does its own
 * per-tile clones the same way). The cache is therefore keyed on the set alone, never on `repeat`.
 *
 * `maxTextureSize` caps the decoded size: images larger than it are resized while decoding
 * (`createImageBitmap` with `resizeWidth/Height`, falling back to canvas halving), so the full-size
 * image is never uploaded. The Polyhaven sets are a mix of 1k and 2k files, and the level uses ~130
 * of their maps; at 2k a map with mips is 22 MB and at 1k 5.6 MB, so this cap - not `pixelRatio` or
 * shadow size - is what decides whether the scene needs 1.4 GB of GPU memory or a third of that.
 * Quality tiers set it via `quality.textureRes` (see Engine).
 *
 * Memory is held twice for every texture the page builds from a bitmap: once by WebGL, and once by
 * the source the texture object keeps pointing at. For a canvas that second copy is not a JS
 * object the GC will get to - Chrome backs any 2D canvas over ~256 px with a GPU-process texture,
 * and it stays allocated for as long as the element does. With ~140 downscaled file maps and ~30
 * procedural atlases that is a few hundred MB in the same GPU pool as the WebGL textures, and on an
 * integrated GPU that pool is system RAM. `compact()` is the answer: once a texture's source has
 * been uploaded it is released (ImageBitmap.close(), or a 0x0 canvas), and oversized procedural
 * canvases are shrunk to `maxCanvasSize` before upload. Engine runs it before the first frame and
 * every couple of seconds after, so textures created later (enemy skins) get the same treatment.
 * A texture that must keep its source (a canvas that is redrawn and re-uploaded) opts out with
 * `texture.userData.keepImage = true`.
 */
export class Assets {
  private texLoader = new THREE.TextureLoader();
  private cache = new Map<string, Promise<PbrMaps>>();
  private hdriCache = new Map<string, Promise<THREE.DataTexture>>();
  anisotropy = 8;
  /** Largest edge a loaded texture keeps; larger images are downscaled before upload. */
  maxTextureSize = Infinity;
  /** Largest edge a procedural canvas texture keeps; bigger canvases are shrunk by `compact()`. */
  maxCanvasSize = Infinity;
  readonly base = import.meta.env.BASE_URL;
  /** Sources already uploaded and released; textures sharing one are skipped. */
  private released = new WeakSet<object>();
  /** What `compact()` has done so far, for the diagnostics panel. */
  readonly stats = { released: 0, shrunk: 0, releasedPixels: 0 };

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
      // Texture<HTMLImageElement> from the loader; a bitmap or downscaled canvas is a valid image source at runtime.
      void this.fit(t.image as HTMLImageElement).then((img) => {
        (t as unknown as { image: ImageSource }).image = img;
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.anisotropy = this.anisotropy;
        if (srgb) t.colorSpace = THREE.SRGBColorSpace;
        t.needsUpdate = true;
        res(t);
      });
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
   * Bring `img` within `maxTextureSize`. The browser's own decoder does the resize
   * (`createImageBitmap` with `resizeQuality: 'high'`), which produces one bitmap and no canvases;
   * the bitmap is closed by `compact()` once uploaded. Returns the element untouched when it already
   * fits, so nothing is copied on the high tiers; falls back to canvas halving where
   * `createImageBitmap` is missing or refuses the options.
   */
  private async fit(img: HTMLImageElement): Promise<ImageSource> {
    const max = this.maxTextureSize;
    if (!(max > 0) || !Number.isFinite(max)) return img;
    const w0 = img.naturalWidth || img.width, h0 = img.naturalHeight || img.height;
    if (w0 <= max && h0 <= max) return img;
    let w = w0, h = h0;
    while (w > max || h > max) { w = Math.max(1, Math.round(w / 2)); h = Math.max(1, Math.round(h / 2)); }
    if (typeof createImageBitmap === 'function') {
      try {
        // flipY here because the renderer cannot flip an ImageBitmap at upload (UNPACK_FLIP_Y is
        // ignored for bitmaps), and Texture.flipY defaults to true for every other image source.
        return await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      } catch { /* fall through to the canvas path */ }
    }
    return shrinkCanvas(img, w0, h0, max) ?? img;
  }

  /**
   * Upload every bitmap/canvas texture reachable from `roots` and release its source (see the class
   * comment). Canvases wider than `maxCanvasSize` are shrunk first. Cheap enough to run every few
   * seconds: a traverse over a few hundred objects and a WeakSet check per texture.
   */
  compact(renderer: THREE.WebGLRenderer, roots: THREE.Object3D[], extra: (THREE.Texture | null | undefined)[] = []): void {
    const seen = new Set<THREE.Texture>();
    const visit = (t: unknown) => {
      if (!(t instanceof THREE.Texture) || seen.has(t)) return;
      seen.add(t);
      this.compactOne(renderer, t);
    };
    for (const root of roots) {
      root.traverse((o) => {
        const mats = (o as THREE.Mesh).material;
        for (const m of Array.isArray(mats) ? mats : mats ? [mats] : []) {
          for (const v of Object.values(m)) visit(v);
          const uniforms = (m as THREE.ShaderMaterial).uniforms;
          if (uniforms) for (const u of Object.values(uniforms)) visit(u?.value);
        }
      });
    }
    for (const t of extra) visit(t);
  }

  private compactOne(renderer: THREE.WebGLRenderer, t: THREE.Texture): void {
    if (this.released.has(t.source)) return;
    const flags = t as unknown as Record<string, boolean | undefined>;
    if (t.userData.keepImage || flags.isCubeTexture || flags.isDataTexture || flags.isRenderTargetTexture || flags.isVideoTexture || flags.isCompressedTexture || flags.isDepthTexture) return;
    const img = t.image as ImageSource | null;
    const isBitmap = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap;
    const isCanvas = typeof HTMLCanvasElement !== 'undefined' && img instanceof HTMLCanvasElement;
    if (!img || (!isBitmap && !isCanvas)) return;
    if (isCanvas && (img.width > this.maxCanvasSize || img.height > this.maxCanvasSize)) {
      const small = shrinkCanvas(img, img.width, img.height, this.maxCanvasSize);
      if (small) {
        this.stats.shrunk++;
        this.stats.releasedPixels += img.width * img.height;
        img.width = img.height = 0;
        (t as unknown as { image: ImageSource }).image = small;
        t.needsUpdate = true;
      }
    }
    // Upload now, then drop the source. initTexture is what the renderer would do on first use.
    renderer.initTexture(t);
    const src = t.image as ImageSource;
    if (src instanceof ImageBitmap) { this.stats.releasedPixels += src.width * src.height; src.close(); }
    else if (src instanceof HTMLCanvasElement) { this.stats.releasedPixels += src.width * src.height; src.width = src.height = 0; }
    this.released.add(t.source);
    this.stats.released++;
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

/**
 * Downscale by successive halving until both edges are within `max`. Halving steps keep the
 * browser's bilinear drawImage from aliasing the way a single 4x shrink would. Null when a 2D
 * context is unavailable.
 */
function shrinkCanvas(src: HTMLImageElement | HTMLCanvasElement, w: number, h: number, max: number): HTMLCanvasElement | null {
  let cur: HTMLImageElement | HTMLCanvasElement = src;
  let out: HTMLCanvasElement | null = null;
  while (w > max || h > max) {
    w = Math.max(1, Math.round(w / 2)); h = Math.max(1, Math.round(h / 2));
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) return null;
    ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(cur, 0, 0, w, h);
    // Intermediate canvases are freed on the spot rather than left for the GC.
    if (out) out.width = out.height = 0;
    cur = out = c;
  }
  return out;
}
