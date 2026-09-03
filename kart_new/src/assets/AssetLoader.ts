import * as THREE from 'three';
import type { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';
import type { QualityTier } from '../render/QualityTiers';
import {
  ASSET_MANIFEST,
  entriesForPhase,
  totalBytes,
  urlFor,
  validateManifest,
  type AssetEntry,
  type AssetPhase,
} from './AssetManifest';

/**
 * 资源加载。清单在 AssetManifest.ts，这里只负责把它拉下来。
 *
 * 解码器（KTX2 / draco / meshopt）的接线在 decoders.ts，而且**现在是断开的** ——
 * 那三个 loader 连着 basis 和 draco 的 wasm 一共 1.8MB，只要这里出现一句
 * import()，打包器就会把它们产出来部署上去，不管运行时会不会真的执行到。
 * 清单现在是空的（赛道和车全是程序化生成的），这 1.8MB 就是纯死重，所以断开。
 * 加第一条资源的时候按 decoders.ts 顶上的说明接回来，AssetLoader.test.ts 盯着这件事。
 *
 * 分批：先 'core'（赛道 + 玩家的车），进比赛之后再补 'deferred'（AI 车、装饰物）。
 */
/** 清单里有资源、解码器却没接的时候的报错。写清楚怎么接，别让人去翻 git log */
const DECODERS_OFF =
  '[assets] 解码器没接线：清单里有资源，但 KTX2/draco/meshopt 的 import 还断着。' +
  '按 src/assets/decoders.ts 顶上的说明改 AssetLoader 的两个 getter。';

export interface AssetLoaderOptions {
  manifest?: readonly AssetEntry[];
  /** 按画质档位挑贴图变体 */
  tier: QualityTier;
  /** 站点根，默认取 vite 的 BASE_URL */
  basePath?: string;
}

export class AssetLoader {
  private readonly manifest: readonly AssetEntry[];
  private readonly tier: QualityTier;
  private readonly basePath: string;

  private readonly textures = new Map<string, THREE.CompressedTexture | THREE.Texture>();
  private readonly models = new Map<string, GLTF>();
  private readonly loaded = new Set<AssetPhase>();

  private ktx2: Promise<KTX2Loader> | null = null;
  private gltf: Promise<GLTFLoader> | null = null;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    options: AssetLoaderOptions,
  ) {
    this.manifest = options.manifest ?? ASSET_MANIFEST;
    this.tier = options.tier;
    this.basePath = options.basePath ?? import.meta.env.BASE_URL;

    // 清单不合法就直接喊出来。dev 下这是"你刚加的那条 PNG"的第一现场
    const errors = validateManifest(this.manifest);
    if (errors.length > 0) {
      console.error('[assets] 资源清单有问题：\n' + errors.map((e) => '  - ' + e).join('\n'));
    }
  }

  /**
   * 渲染器。接线之后 decoders.makeTextureLoader 要拿它做 detectSupport ——
   * 那是 KTX2 挑压缩格式的依据，所以这个引用现在虽然没人用，也得留着。
   */
  get webglRenderer(): THREE.WebGLRenderer {
    return this.renderer;
  }

  /** 某一批资源的总字节数，进度条按它加权 */
  phaseBytes(phase: AssetPhase): number {
    return totalBytes(entriesForPhase(this.manifest, phase));
  }

  /**
   * 加载一批资源。
   * @param onProgress 0..1。按**字节数**加权而不是按文件数 —— 一张 3MB 的贴图和
   *                   一个 20KB 的模型算一样多的话，进度条会在最后一格卡很久
   */
  async loadPhase(phase: AssetPhase, onProgress?: (ratio: number) => void): Promise<void> {
    if (this.loaded.has(phase)) return;
    this.loaded.add(phase);

    const entries = entriesForPhase(this.manifest, phase);
    const total = totalBytes(entries) || 1;
    if (entries.length === 0) {
      onProgress?.(1);
      return;
    }

    let done = 0;
    const inflight = new Map<string, number>();
    const report = () => {
      let sum = done;
      for (const bytes of inflight.values()) sum += bytes;
      onProgress?.(Math.min(sum / total, 1));
    };

    await Promise.all(
      entries.map(async (entry) => {
        const url = this.basePath + urlFor(entry, this.tier);
        const track = (event: ProgressEvent) => {
          // 服务端没给 Content-Length 时 total 是 0，这时候就别猜了，等它结束
          if (event.total > 0) inflight.set(entry.id, (event.loaded / event.total) * entry.bytes);
          report();
        };
        try {
          if (entry.kind === 'texture') {
            const texture = await (await this.ktx2Loader()).loadAsync(url, track);
            texture.colorSpace = THREE.SRGBColorSpace;
            this.textures.set(entry.id, texture);
          } else {
            this.models.set(entry.id, await (await this.gltfLoader()).loadAsync(url, track));
          }
        } catch (error) {
          // 单个资源挂了不该让整局比赛起不来：程序化的占位内容还在
          console.error(`[assets] 加载失败：${entry.id} (${url})`, error);
        } finally {
          inflight.delete(entry.id);
          done += entry.bytes;
          report();
        }
      }),
    );

    onProgress?.(1);
  }

  texture(id: string): THREE.Texture | null {
    return this.textures.get(id) ?? null;
  }

  model(id: string): GLTF | null {
    return this.models.get(id) ?? null;
  }

  /**
   * 贴图解码器。现在是断开的 —— 见文件顶上的说明和 decoders.ts。
   * 接回来就是把下面这个 throw 换成：
   *   this.ktx2 ??= import('./decoders').then((d) => d.makeTextureLoader(this.renderer));
   *   return this.ktx2;
   */
  private ktx2Loader(): Promise<KTX2Loader> {
    return this.ktx2 ?? Promise.reject(new Error(DECODERS_OFF));
  }

  /**
   * 模型解码器。同上：
   *   this.gltf ??= import('./decoders').then((d) => d.makeModelLoader(await this.ktx2Loader()));
   */
  private gltfLoader(): Promise<GLTFLoader> {
    return this.gltf ?? Promise.reject(new Error(DECODERS_OFF));
  }

  dispose(): void {
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.models.clear();
    void this.ktx2?.then((loader) => loader.dispose()).catch(() => {});
    this.ktx2 = null;
    this.gltf = null;
  }
}
