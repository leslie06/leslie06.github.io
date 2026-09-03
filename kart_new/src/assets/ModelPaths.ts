/**
 * 外部美术资源的路径。
 *
 * 这些文件**现在都不存在**，全部是"有就用、没有就退回程序化的东西"：
 *   - 卡丁车模型没有   -> KartView 用 Box 拼的占位车；
 *   - HDRI 没有        -> SkyEnvironment 用渐变球烘环境贴图；
 *   - 音频文件没有     -> AudioManager 用 synth.ts 现场合成。
 * 所以路径写在这里而不是 AssetManifest 里：清单里的东西是**必须存在**的
 * （validateManifest 会核格式、核首屏预算，AssetLoader.test.ts 还盯着解码器接线），
 * 而这几个是可选的，下不到只是画面/声音退一档，不该让清单校验红。
 *
 * 把文件放进 public/ 对应位置就自动生效，代码一个字不用改。
 * 模型的导出约定见 render/kartRig.ts 顶上那段。
 */

/** 玩家和 AI 共用的卡丁车模型。车头朝 +Z、轮子贴地 y=0、轮子节点名带 wheel */
export const KART_MODEL_URL = 'models/kart.glb';

/** 环境贴图用的 HDRI（等距圆柱投影的 .hdr）。没有就用程序化渐变天空 */
export const SKY_HDRI_URL = 'hdri/afternoon.hdr';
