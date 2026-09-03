/**
 * 三个解码器的接线。
 *
 * ⚠️ 这个文件**故意没有被任何地方 import**，所以它不进打包图，一个字节都不会部署。
 *
 * 原因：KTX2Loader / DRACOLoader 里的转码器是 `new URL(..., import.meta.url)` 写的，
 * 只要打包器看得见那句 import()，就会连着 basis / draco 的 wasm 一起产出来 ——
 * 一共 1.8MB。而现在资源清单是空的（赛道、车、地面纹理全是程序化生成的），
 * 这 1.8MB 永远不会有人去取，纯粹是部署里的死重。动态 import 也救不了：
 * 打包器不管那句 import() 会不会被执行到，看见就产。
 *
 * 什么时候把它接回去：往 AssetManifest.ts 里加第一条资源的时候。
 * 改法是 AssetLoader.ts 里的两个 getter —— 把 throw 换成
 *     const d = await import('./decoders');
 *     return d.makeTextureLoader(this.renderer);
 * AssetLoader.test.ts 有一条测试盯着这件事：清单非空但没接线，测试直接红。
 *
 * 三个解码器各自的用途：
 *   - KTX2Loader：Basis 压缩贴图。必须 detectSupport(renderer) —— 不同 GPU 支持的
 *     压缩格式不一样（ASTC / ETC2 / BC7），转码器要照着挑，不告诉它就只能退回未压缩。
 *   - DRACOLoader / MeshoptDecoder：两种几何压缩，清单里每个模型自己声明用了哪种。
 */
import type * as THREE from 'three';
import type { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { KTX2Loader } from 'three/examples/jsm/loaders/KTX2Loader.js';

/** KTX2（Basis）贴图。转码器的 wasm 路径不用管，打包器会跟着一起产出来 */
export async function makeTextureLoader(renderer: THREE.WebGLRenderer): Promise<KTX2Loader> {
  const { KTX2Loader } = await import('three/examples/jsm/loaders/KTX2Loader.js');
  return new KTX2Loader().detectSupport(renderer);
}

/** glTF。draco 和 meshopt 两种几何压缩都挂上，glb 里内嵌的 KTX2 贴图也要能解 */
export async function makeModelLoader(ktx2: KTX2Loader): Promise<GLTFLoader> {
  const [{ GLTFLoader }, { DRACOLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/examples/jsm/loaders/GLTFLoader.js'),
    import('three/examples/jsm/loaders/DRACOLoader.js'),
    import('three/examples/jsm/libs/meshopt_decoder.module.js'),
  ]);
  return new GLTFLoader()
    .setDRACOLoader(new DRACOLoader())
    .setMeshoptDecoder(MeshoptDecoder)
    .setKTX2Loader(ktx2);
}
