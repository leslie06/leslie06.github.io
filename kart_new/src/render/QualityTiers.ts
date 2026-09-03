/**
 * 画质档位。
 *
 * 规矩：**所有**渲染参数都从这张表里读，任何地方都不许再硬编码一个像素比、
 * 阴影分辨率或者雾距离。想调画质就改这张表，想加一个新的可调项就往
 * QualitySettings 里加一个字段 —— 这样"low 档到底开了什么"永远只有一个答案。
 *
 * 这个文件是纯的（不 import three），分档逻辑可以直接单测。
 * 探测设备的脏活在 core/DeviceCaps.ts。
 */
import { isMobileUA, type DeviceCaps } from '../core/DeviceCaps';

export type QualityTier = 'high' | 'medium' | 'low';

/** 从低到高。降档/升档都按这个顺序走 */
export const TIER_ORDER: readonly QualityTier[] = ['low', 'medium', 'high'] as const;

/** 后处理档位：full = bloom + SMAA，bloom = 只留轻 bloom，none = 只有 tonemapping */
export type PostFxLevel = 'full' | 'bloom' | 'none';

export interface QualitySettings {
  /** devicePixelRatio 上限。手机屏 dpr 常年 3，不设上限等于白推 9 倍像素 */
  maxPixelRatio: number;
  /** WebGLRenderer 的 antialias 构造参数。开了后处理就交给 SMAA，这里要关 */
  antialias: boolean;
  /** 阴影贴图边长；0 = 关闭实时阴影，改用贴片假阴影 */
  shadowMapSize: number;
  /** 阴影相机的半边长（米）。越小越清晰但覆盖范围越窄 */
  shadowRadius: number;
  /** 关了实时阴影时，车底下画一片圆形贴片当影子 */
  blobShadows: boolean;
  /** 后处理级别 */
  postFx: PostFxLevel;
  /** bloom 强度（postFx 为 none 时无意义） */
  bloomStrength: number;
  /** bloom 的扩散半径 0..1。越大溢得越开，也越糊 */
  bloomRadius: number;
  /** SMAA 抗锯齿。关了就靠像素比顶着 */
  smaa: boolean;
  /** 暗角强度 0..1，0 = 不加这一 pass */
  vignette: number;
  /**
   * 环境贴图（PMREM）的立方图边长；0 = 不生成，只靠半球光。
   * 天空是程序化渐变球，所以这一项不吃下载量，只吃一次性的预处理时间和显存。
   */
  envMapSize: number;
  /** 每辆车的轮胎扬尘粒子池容量；0 = 不喷扬尘 */
  dustCapacity: number;
  /** 全场共用的爆闪/命中粒子池容量 */
  burstCapacity: number;
  /** boost 期间的车尾拖尾 */
  boostTrail: boolean;
  /** AI 对手数量 */
  aiCount: number;
  /** 每辆车的漂移火花粒子池容量 */
  sparkCapacity: number;
  /** AI 车要不要也喷火花。low 档只留玩家自己的 */
  aiSparks: boolean;
  /** 赛道两侧装饰物密度倍率（1 = 满） */
  propDensity: number;
  /** 雾的近/远距离（米）。low 档拉近，把远景直接雾掉省得画 */
  fogNear: number;
  fogFar: number;
  /** 相机远裁剪面（米）。和雾远端配套，比雾远一点就行 */
  cameraFar: number;
  /** 贴图边长上限。资源有多档变体时按这个挑 */
  maxTextureSize: number;
  /** 各向异性过滤倍数。斜着看地面的清晰度全靠它，也是最容易被忽略的一笔开销 */
  textureAnisotropy: number;
}

/**
 * 三档参数表。
 *
 * low 档要顶住 PERF_BUDGET_LOW（drawcall ≤ 150、三角面 ≤ 20 万、贴图 ≤ 1024），
 * 所以它砍的是"数量"而不是"精度"：AI 少三辆、装饰物剩四分之一、雾拉到 90m。
 */
export const QUALITY_TIERS: Readonly<Record<QualityTier, Readonly<QualitySettings>>> = Object.freeze({
  high: Object.freeze({
    maxPixelRatio: 2,
    antialias: false, // 后处理链里用 SMAA，renderer 自带的 MSAA 对 composer 无效
    shadowMapSize: 2048,
    shadowRadius: 70,
    blobShadows: false,
    postFx: 'full',
    bloomStrength: 0.42,
    aiCount: 7,
    sparkCapacity: 400,
    aiSparks: true,
    propDensity: 1,
    fogNear: 180,
    fogFar: 620,
    cameraFar: 900,
    maxTextureSize: 2048,
    textureAnisotropy: 8,
    bloomRadius: 0.55,
    smaa: true,
    vignette: 0.32,
    envMapSize: 256,
    dustCapacity: 160,
    burstCapacity: 320,
    boostTrail: true,
  }),
  medium: Object.freeze({
    maxPixelRatio: 1.5,
    antialias: false,
    shadowMapSize: 1024,
    shadowRadius: 55,
    blobShadows: false,
    postFx: 'bloom',
    bloomStrength: 0.28,
    aiCount: 5,
    sparkCapacity: 220,
    aiSparks: true,
    propDensity: 0.55,
    fogNear: 130,
    fogFar: 420,
    cameraFar: 620,
    maxTextureSize: 2048,
    textureAnisotropy: 4,
    bloomRadius: 0.4,
    smaa: false,
    vignette: 0.22,
    envMapSize: 128,
    dustCapacity: 80,
    burstCapacity: 180,
    boostTrail: true,
  }),
  low: Object.freeze({
    maxPixelRatio: 1,
    antialias: false,
    shadowMapSize: 0,
    shadowRadius: 0,
    blobShadows: true,
    postFx: 'none',
    bloomStrength: 0,
    aiCount: 3,
    sparkCapacity: 100,
    aiSparks: false,
    propDensity: 0.25,
    fogNear: 80,
    fogFar: 240,
    cameraFar: 360,
    maxTextureSize: 1024,
    textureAnisotropy: 1,
    bloomRadius: 0,
    smaa: false,
    vignette: 0,
    envMapSize: 0,
    dustCapacity: 0,
    burstCapacity: 60,
    boostTrail: false,
  }),
});

/**
 * low 档的性能预算。CLAUDE.md 里也写了一份，这里是能被代码读到的那份 ——
 * 主循环在 dev 下会拿 renderer.info 跟它对一下，超了直接在控制台喊。
 */
export const PERF_BUDGET_LOW = Object.freeze({
  drawCalls: 150,
  triangles: 200_000,
  textureSize: 1024,
});

/** 档位手动覆盖：'auto' = 听探测的 */
export type TierOverride = QualityTier | 'auto';

export function isQualityTier(value: unknown): value is QualityTier {
  return value === 'high' || value === 'medium' || value === 'low';
}

/** 降一档。已经是最低了就返回 null（调用方据此决定还提不提示） */
export function lowerTier(tier: QualityTier): QualityTier | null {
  const i = TIER_ORDER.indexOf(tier);
  return i > 0 ? TIER_ORDER[i - 1]! : null;
}

/**
 * 按设备能力分档。
 *
 * 逻辑是"先看硬门槛，再给手机打分"：
 *   - 没有 WebGL2 或者贴图上限 < 4096 的机器直接 low，别浪费时间；
 *   - 桌面默认 high（核数少得离谱的降到 medium）；
 *   - 手机按 核数 / 内存 / GPU 型号 / dpr 打分，>= 3 分 high，>= 1 分 medium。
 *
 * 分错了也不要紧：FrameMonitor 会在跑起来之后按真实帧率把档位拉下来。
 * 所以这里宁可乐观一点，也别让旗舰机一上来就吃 low 档。
 */
export function pickTier(caps: DeviceCaps): QualityTier {
  if (!caps.webgl2 || caps.maxTextureSize < 4096) return 'low';
  // 软件渲染（虚拟机、显卡驱动挂了、无头浏览器）在桌面上也一样画不动，
  // 所以这条要放在"桌面直接给 high"的前面
  if (isSoftwareRenderer(caps.gpu)) return 'low';

  const mobile = isMobileUA(caps.ua) || (caps.maxTouchPoints > 0 && caps.screenLongEdge <= 1400);
  if (!mobile) return caps.hardwareConcurrency <= 2 ? 'medium' : 'high';

  let score = 0;

  if (caps.hardwareConcurrency >= 8) score += 2;
  else if (caps.hardwareConcurrency >= 6) score += 1;
  else if (caps.hardwareConcurrency <= 3) score -= 1;

  // deviceMemory 是 null 就当没投票（Safari 全系没有这个 API，不能当成"内存小"）
  if (caps.deviceMemoryGB !== null) {
    if (caps.deviceMemoryGB >= 6) score += 2;
    else if (caps.deviceMemoryGB >= 4) score += 1;
    else if (caps.deviceMemoryGB <= 2) score -= 2;
  }

  score += gpuScore(caps.gpu);

  // dpr 3 的屏幕像素多 2.25 倍，同样的 GPU 会更吃力
  if (caps.devicePixelRatio >= 3) score -= 1;

  if (score >= 3) return 'high';
  if (score >= 1) return 'medium';
  return 'low';
}

/**
 * GPU 名打分。型号表肯定会过时，所以只做**粗粒度**的世代判断，
 * 认不出来的一律 0 分（交给核数和内存去投票），不要瞎猜。
 */
function gpuScore(gpu: string): number {
  const g = gpu.toLowerCase();
  if (!g) return 0;
  // 苹果：A14 之后 / M 系列都够猛
  if (/apple\s*(a1[4-9]|a[2-9]\d|m\d)/.test(g)) return 2;
  if (/apple/.test(g)) return 1;
  // 高通 Adreno 6xx 以上算新，5xx 及以下明显老
  const adreno = /adreno.*?(\d{3})/.exec(g);
  if (adreno) {
    const model = Number(adreno[1]);
    if (model >= 700) return 2;
    if (model >= 640) return 1;
    if (model < 600) return -2;
    return 0;
  }
  // ARM Mali：G7xx 新，G5x/T 系列老
  if (/mali-g[7-9]\d/.test(g)) return 1;
  if (/mali-t|mali-g5|mali-g3/.test(g)) return -2;
  return 0;
}

/** 软件渲染的几个常见名字 */
export function isSoftwareRenderer(gpu: string): boolean {
  return /swiftshader|llvmpipe|software|basic render/i.test(gpu);
}

export interface ResolvedTier {
  tier: QualityTier;
  settings: Readonly<QualitySettings>;
  /** 探测出来的档位（不含手动覆盖），设置菜单里显示"自动: high"用 */
  detected: QualityTier;
}

/** 探测 + 手动覆盖，一次性给出最终档位和参数。 */
export function resolveTier(caps: DeviceCaps, override: TierOverride = 'auto'): ResolvedTier {
  const detected = pickTier(caps);
  const tier = override === 'auto' ? detected : override;
  return { tier, settings: QUALITY_TIERS[tier], detected };
}

/** 实际用的像素比 = 设备 dpr 和档位上限里的小的那个。 */
export function effectivePixelRatio(
  settings: Readonly<QualitySettings>,
  devicePixelRatio: number,
): number {
  return Math.min(devicePixelRatio || 1, settings.maxPixelRatio);
}
