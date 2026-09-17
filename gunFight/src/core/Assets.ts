import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';

export interface PbrMaps { map?: THREE.Texture; normalMap?: THREE.Texture; roughnessMap?: THREE.Texture; aoMap?: THREE.Texture; displacementMap?: THREE.Texture; metalnessMap?: THREE.Texture }

type ImageSource = HTMLImageElement | HTMLCanvasElement | ImageBitmap;

/** public/textures/index.json, written by scripts/optimize-textures.mjs: bytes per set/map/resolution. */
interface TextureIndex { version: number; sets: Record<string, { maps: Record<string, Record<string, number>> }> }

/**
 * Texture sets live in public/textures/<name>/<map>_<res>.webp, one file per resolution, listed with
 * their byte sizes in public/textures/index.json (scripts/optimize-textures.mjs builds both from the
 * Polyhaven originals in assets-src/).
 *
 * Every set is decoded and uploaded once. A caller that wants a different `repeat` gets a
 * `Texture.clone()`: clones share the `Source`, and the renderer keys its GL textures by source, so
 * ten materials tiling the same brick at ten scales cost one upload (world/Materials does its own
 * per-tile clones the same way). The cache is therefore keyed on the set alone, never on `repeat`.
 *
 * `maxTextureSize` picks which file is downloaded: the largest variant that fits. The level uses
 * ~130 maps; at 2k a map with mips is 22 MB of GPU memory and at 1k 5.6 MB, so this cap - not
 * `pixelRatio` or shadow size - is what decides whether the scene needs 1.4 GB or a third of that,
 * and since the variants are separate files it decides the download too (~6 MB at 512 against
 * ~35 MB at 2k; it used to be 125 MB of JPEG for every tier, downscaled after the fact). Quality
 * tiers set it via `quality.textureRes` (see Engine). `fit` still guards the odd image with no
 * small enough variant.
 *
 * Files are fetched and decoded with `createImageBitmap`, which runs off the main thread - an
 * <img> is decoded synchronously at first upload, which is where the first-frame stall came from.
 * `progress` counts the bytes of everything requested so far, from the index, so the loading
 * screen can show a real number (core/BootProgress).
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
  private index: Promise<TextureIndex | null> | null = null;
  anisotropy = 8;
  /** Largest edge a loaded texture keeps: picks the file variant, and caps anything larger. */
  maxTextureSize = Infinity;
  /** Largest edge a procedural canvas texture keeps; bigger canvases are shrunk by `compact()`. */
  maxCanvasSize = Infinity;
  readonly base = import.meta.env.BASE_URL;
  /** Sources already uploaded and released; textures sharing one are skipped. */
  private released = new WeakSet<object>();
  /** What `compact()` has done so far, for the diagnostics panel. */
  readonly stats = { released: 0, shrunk: 0, releasedPixels: 0 };
  /** Download progress over everything requested so far. `totalBytes` grows as sets are asked for. */
  readonly progress = { loadedBytes: 0, totalBytes: 0, files: 0 };
  /** Called whenever `progress` changes. */
  onProgress: (() => void) | null = null;

  private bump(loaded: number, total: number): void {
    this.progress.loadedBytes += loaded; this.progress.totalBytes += total;
    this.onProgress?.();
  }

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

  private loadIndex(): Promise<TextureIndex | null> {
    this.index ??= fetch(`${this.base}textures/index.json`)
      .then((r) => (r.ok ? (r.json() as Promise<TextureIndex>) : null))
      .catch(() => null);
    return this.index;
  }

  /** Largest variant within `maxTextureSize`, else the smallest there is (`fit` shrinks that one). */
  private pickVariant(variants: Record<string, number>): { res: number; bytes: number } | null {
    const sizes = Object.keys(variants).map(Number).filter((n) => n > 0).sort((a, b) => a - b);
    if (!sizes.length) return null;
    const fits = sizes.filter((s) => s <= this.maxTextureSize);
    const res = fits.length ? fits[fits.length - 1] : sizes[0];
    return { res, bytes: variants[String(res)] };
  }

  private async loadPbr(name: string, withDisp: boolean): Promise<PbrMaps> {
    const set = (await this.loadIndex())?.sets[name];
    if (!set) return {}; // missing set -> flat material
    const dir = `${this.base}textures/${name}/`;
    const out: PbrMaps = {};
    const wanted: [string, keyof PbrMaps, boolean][] = [
      ['diffuse', 'map', true], ['normal', 'normalMap', false], ['rough', 'roughnessMap', false],
      ['ao', 'aoMap', false], ['metal', 'metalnessMap', false],
    ];
    if (withDisp) wanted.push(['disp', 'displacementMap', false]);
    const jobs: Promise<void>[] = [];
    for (const [map, slot, srgb] of wanted) {
      const v = set.maps[map] ? this.pickVariant(set.maps[map]) : null;
      if (!v) continue;
      this.bump(0, v.bytes);
      jobs.push(this.loadTexture(`${dir}${map}_${v.res}.webp`, srgb)
        .then((t) => { out[slot] = t; })
        // A failed file still counts as done, or the bar would stall short of the end.
        .finally(() => { this.progress.files++; this.bump(v.bytes, 0); }));
    }
    await Promise.allSettled(jobs);
    return out;
  }

  private async loadTexture(url: string, srgb: boolean): Promise<THREE.Texture> {
    const finish = (t: THREE.Texture): THREE.Texture => {
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.anisotropy = this.anisotropy;
      if (srgb) t.colorSpace = THREE.SRGBColorSpace;
      t.needsUpdate = true;
      return t;
    };
    if (typeof createImageBitmap === 'function') {
      try {
        const r = await fetch(url);
        if (!r.ok) throw new Error(`${r.status} ${url}`);
        // flipY here because the renderer cannot flip an ImageBitmap at upload (UNPACK_FLIP_Y is
        // ignored for bitmaps), and Texture.flipY defaults to true for every other image source.
        const bmp = await createImageBitmap(await r.blob(), { imageOrientation: 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
        const fitted = await this.fit(bmp);
        if (fitted !== bmp) bmp.close();
        return finish(new THREE.Texture(fitted as unknown as HTMLImageElement));
      } catch { /* a browser that refuses the bitmap options: fall through to <img> */ }
    }
    const t = await new Promise<THREE.Texture>((res, rej) => this.texLoader.load(url, res, undefined, rej));
    // Texture<HTMLImageElement> from the loader; a bitmap or downscaled canvas is a valid image source at runtime.
    (t as unknown as { image: ImageSource }).image = await this.fit(t.image as HTMLImageElement);
    return finish(t);
  }

  /**
   * Bring `img` within `maxTextureSize`. The browser's own decoder does the resize
   * (`createImageBitmap` with `resizeQuality: 'high'`), which produces one bitmap and no canvases;
   * the bitmap is closed by `compact()` once uploaded. Returns the element untouched when it already
   * fits, so nothing is copied on the high tiers; falls back to canvas halving where
   * `createImageBitmap` is missing or refuses the options.
   */
  private async fit(img: HTMLImageElement | ImageBitmap): Promise<ImageSource> {
    const max = this.maxTextureSize;
    if (!(max > 0) || !Number.isFinite(max)) return img;
    const isBitmap = typeof ImageBitmap !== 'undefined' && img instanceof ImageBitmap;
    const w0 = (img as HTMLImageElement).naturalWidth || img.width, h0 = (img as HTMLImageElement).naturalHeight || img.height;
    if (w0 <= max && h0 <= max) return img;
    let w = w0, h = h0;
    while (w > max || h > max) { w = Math.max(1, Math.round(w / 2)); h = Math.max(1, Math.round(h / 2)); }
    if (typeof createImageBitmap === 'function') {
      try {
        // flipY here because the renderer cannot flip an ImageBitmap at upload (UNPACK_FLIP_Y is
        // ignored for bitmaps), and Texture.flipY defaults to true for every other image source.
        // A bitmap handed in was already flipped when it was decoded; flipping again would undo it.
        return await createImageBitmap(img, { resizeWidth: w, resizeHeight: h, resizeQuality: 'high', imageOrientation: isBitmap ? 'from-image' : 'flipY', premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
      } catch { /* fall through to the canvas path */ }
    }
    // The canvas path relies on the renderer's upload flip, which a pre-flipped bitmap must not get.
    if (isBitmap) return img;
    return shrinkCanvas(img as HTMLImageElement, w0, h0, max) ?? img;
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
      // No index entry for HDRIs: the size comes from the response, or a typical 2k figure when the
      // server does not send one. `seen`/`total` are this file's contribution to `progress` so far.
      let seen = 0, total = 0;
      const track = (loaded: number, size: number) => {
        const t = Math.max(size, loaded, total || 5e6);
        this.bump(loaded - seen, t - total);
        seen = loaded; total = t;
      };
      track(0, 0);
      p = new Promise((res, rej) => new HDRLoader().load(`${this.base}hdri/${name}.hdr`, (t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        track(total, total); this.progress.files++;
        res(t);
      }, (e) => track(e.loaded, e.lengthComputable ? e.total : 0), (e) => { track(total, total); rej(e); }));
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
