/**
 * 通用 glTF 加载 + 缓存。
 *
 * 三条规矩：
 *
 * 1. **一个 url 只下载一次。** 同一个模型被几十个地方要，拿到的是同一份
 *    "模板"（GLTF.scene）。要摆进场景的是模板的克隆，不是模板本身。
 *
 * 2. **克隆共享几何体和材质。** THREE.Object3D.clone() 天然就是这个行为
 *    （子对象递归复制，geometry / material 只复制引用），所以八辆车 = 一份几何体。
 *    要换配色的时候也**不复制整套材质**，而是走 TintCache 按颜色缓存 —— 见下面。
 *
 * 3. **GLTFLoader 是动态 import 的。** 它是 three 里最大的一个 example 模块，
 *    而且只有真的要加载模型时才用得上。写成动态 import 之后打包器会把它切成
 *    单独一块，没模型的时候（现在就是）连下都不下。
 *
 * 几何压缩（draco / meshopt）和 KTX2 贴图的解码器**没有默认挂上**：那三个东西
 * 连着 1.8MB 的 wasm，见 assets/decoders.ts 顶上的说明。需要的时候由调用方
 * 通过 options.decorate 挂进来，这样"要不要付这 1.8MB"的决定权留在一个地方。
 */
import type * as THREE from 'three';
import type { GLTF, GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export interface ModelLibraryOptions {
  /** 站点根，默认取 vite 的 BASE_URL。给的 url 是相对它的 */
  basePath?: string;
  /**
   * 拿到 loader 之后、开始下载之前的回调。挂 draco / meshopt / KTX2 解码器用。
   * 不挂就是"只认未压缩几何 + 内嵌 PNG"，那已经够跑通流程了。
   */
  decorate?: (loader: GLTFLoader) => void | Promise<void>;
}

export class ModelLibrary {
  private readonly basePath: string;
  private loader: Promise<GLTFLoader> | null = null;
  /** url -> 加载中的 Promise。同一个 url 并发要多次也只下一次 */
  private readonly pending = new Map<string, Promise<GLTF | null>>();
  private readonly cache = new Map<string, GLTF>();

  constructor(private readonly options: ModelLibraryOptions = {}) {
    this.basePath = options.basePath ?? import.meta.env.BASE_URL;
  }

  /**
   * 加载一个 glTF/glb。
   *
   * **失败返回 null 而不是抛异常**：模型是打磨用的，没有它还有程序化的占位车，
   * 一个 404 不该让整局比赛起不来。控制台会有一行说明。
   */
  async load(url: string, onProgress?: (event: ProgressEvent) => void): Promise<GLTF | null> {
    const cached = this.cache.get(url);
    if (cached) return cached;

    let job = this.pending.get(url);
    if (!job) {
      job = this.fetch(url, onProgress);
      this.pending.set(url, job);
    }
    return job;
  }

  private async fetch(url: string, onProgress?: (event: ProgressEvent) => void): Promise<GLTF | null> {
    try {
      const loader = await this.getLoader();
      const gltf = await loader.loadAsync(this.basePath + stripLeadingSlash(url), onProgress);
      this.cache.set(url, gltf);
      return gltf;
    } catch (error) {
      console.warn(`[models] 加载失败，退回程序化占位：${url}`, error);
      return null;
    } finally {
      this.pending.delete(url);
    }
  }

  /** 已经下好的模板。没下过返回 null（不触发加载） */
  get(url: string): GLTF | null {
    return this.cache.get(url) ?? null;
  }

  /**
   * 取一份可以直接塞进场景的克隆。
   * 几何体和材质是共享的，所以克隆很便宜；要单独换色走 TintCache。
   */
  instantiate(url: string): THREE.Object3D | null {
    const gltf = this.cache.get(url);
    return gltf ? gltf.scene.clone(true) : null;
  }

  private getLoader(): Promise<GLTFLoader> {
    this.loader ??= (async () => {
      const { GLTFLoader } = await import('three/examples/jsm/loaders/GLTFLoader.js');
      const loader = new GLTFLoader();
      await this.options.decorate?.(loader);
      return loader;
    })();
    return this.loader;
  }

  /** 把缓存里的几何体和材质全释放掉。换赛道/退出时调 */
  dispose(): void {
    for (const gltf of this.cache.values()) disposeTree(gltf.scene);
    this.cache.clear();
    this.pending.clear();
  }
}

const stripLeadingSlash = (url: string): string => (url.startsWith('/') ? url.slice(1) : url);

/** 递归释放一棵树上的几何体和材质。同一份资源可能被多个 mesh 引用，去重后再释放 */
export function disposeTree(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    geometries.add(mesh.geometry);
    for (const material of toArray(mesh.material)) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const material of materials) material.dispose();
}

export function toArray<T>(value: T | T[]): T[] {
  return Array.isArray(value) ? value : [value];
}
