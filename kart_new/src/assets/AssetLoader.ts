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
 * 三个解码器：
 *   - KTX2Loader：Basis 压缩贴图。必须 detectSupport(renderer) —— 不同 GPU 支持的
 *     压缩格式不一样（ASTC / ETC2 / BC7），转码器要照着挑，不告诉它就只能退回未压缩。
 *   - DRACOLoader / MeshoptDecoder：两种几何压缩。清单里每个模型自己声明用了哪种。
 *
 * 三个 loader 都是**动态 import** 的：它们连着 basis / draco 的 wasm 一共一兆多，
 * 而首屏那一版赛道现在完全是程序化生成的，一个字节的外部资源都不用下。
 * 静态 import 的话这一兆多会躺在主 bundle 里，白白拖慢首屏。
 * 解码器自己的 wasm 路径不用管：three 里是 new URL(..., import.meta.url) 写的，
 * 打包器会把它们连同哈希文件名一起产出来。
 *
 * 分批：先 'core'（赛道 + 玩家的车），进比赛之后再补 'deferred'（AI 车、装饰物）。
 */
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

  private ktx2Loader(): Promise<KTX2Loader> {
    this.ktx2 ??= import('three/examples/jsm/loaders/KTX2Loader.js').then(
      // detectSupport 是必须的：它按 GPU 支持的压缩格式挑转码目标，不告诉它就只能退回未压缩
      ({ KTX2Loader }) => new KTX2Loader().detectSupport(this.renderer),
    );
    return this.ktx2;
  }

  private gltfLoader(): Promise<GLTFLoader> {
    this.gltf ??= (async () => {
      const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
        import('three/examples/jsm/loaders/GLTFLoader.js'),
        import('three/examples/jsm/loaders/DRACOLoader.js'),
        import('three/examples/jsm/libs/meshopt_decoder.module.js'),
      ]);
      return new GLTFLoader()
        .setDRACOLoader(new DRACOLoader())
        .setMeshoptDecoder(MeshoptDecoder)
        .setKTX2Loader(await this.ktx2Loader()); // glb 里内嵌的 KTX2 贴图也要能解
    })();
    return this.gltf;
  }

  dispose(): void {
    for (const texture of this.textures.values()) texture.dispose();
    this.textures.clear();
    this.models.clear();
    void this.ktx2?.then((loader) => loader.dispose());
    this.ktx2 = null;
    this.gltf = null;
  }
}
