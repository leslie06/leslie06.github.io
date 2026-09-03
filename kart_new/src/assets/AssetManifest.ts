/**
 * 资源清单。
 *
 * 这里是所有外部资源的**唯一**入口，而且是纯数据 —— 校验规则跟着写成纯函数，
 * 有测试钉着，所以"不许直接用 PNG/JPG"这条约定是能被 CI 拦下来的，不是文档里的一句话。
 *
 * 两条硬规矩：
 *   - 贴图只收 .ktx2（Basis 压缩）。PNG/JPG 在 GPU 上要解成未压缩的 RGBA，
 *     一张 1024 的图就是 4MB 显存；KTX2 直接以压缩格式躺在显存里，约 1/6。
 *   - 模型必须声明用了哪种几何压缩（draco 或 meshopt），loader 那边按这个挂解码器。
 *
 * 首屏预算 10MB 说的是 phase='core' 这一批：赛道和玩家的车。
 * AI 车、装饰物、音效走 'deferred'，比赛开始之后再补。
 */
import type { QualityTier } from '../render/QualityTiers';

/** core = 首屏必须有的；deferred = 可以边玩边补的 */
export type AssetPhase = 'core' | 'deferred';
export type AssetKind = 'texture' | 'model';
export type GeometryCompression = 'draco' | 'meshopt';

export interface AssetEntry {
  /** 代码里引用它用的名字 */
  id: string;
  kind: AssetKind;
  phase: AssetPhase;
  /** 相对站点根的路径 */
  url: string;
  /** 压缩后的大小（字节）。核预算用，填个约数就够 */
  bytes: number;
  /** 模型的几何压缩方式。kind='model' 必填 */
  compression?: GeometryCompression;
  /**
   * 分档变体：低画质档位换小图。
   * 没有对应档位的变体就退回 url。
   */
  variants?: Partial<Record<QualityTier, string>>;
}

/** 首屏（core）资源总量上限 */
export const FIRST_SCREEN_BUDGET_BYTES = 10 * 1024 * 1024;

/** 贴图只认这个后缀 */
const TEXTURE_EXT = '.ktx2';
/** 明确点名封杀的后缀，报错信息里好说话 */
const BANNED_TEXTURE_EXT = ['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp', '.tga'];
const MODEL_EXT = ['.glb', '.gltf'];

/**
 * 当前的资源清单。
 *
 * 现在是空的 —— 赛道、车、地面纹理全是程序化生成的（TrackMesh / KartView / World），
 * 一个字节都不用下载，这也是首屏能轻松压在 10MB 以内的原因。
 * 这套管线是给"以后换成真模型/真贴图"准备的：往这个数组里加一条，
 * AssetLoader 就会按 phase 分批把它拉下来，加载界面的进度条也会自动把它算进去。
 */
export const ASSET_MANIFEST: readonly AssetEntry[] = [];

export function entriesForPhase(
  entries: readonly AssetEntry[],
  phase: AssetPhase,
): readonly AssetEntry[] {
  return entries.filter((e) => e.phase === phase);
}

export function totalBytes(entries: readonly AssetEntry[]): number {
  return entries.reduce((sum, e) => sum + e.bytes, 0);
}

/** 按画质档位挑变体，没有就用主 url */
export function urlFor(entry: AssetEntry, tier: QualityTier): string {
  return entry.variants?.[tier] ?? entry.url;
}

const hasExt = (url: string, exts: readonly string[]): boolean => {
  const lower = url.toLowerCase();
  return exts.some((ext) => lower.endsWith(ext));
};

/**
 * 校验清单。返回一串人话错误信息，空数组 = 没问题。
 * 抛异常改成返回列表，是为了一次把所有毛病都说完，而不是改一条报一条。
 */
export function validateManifest(entries: readonly AssetEntry[]): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();

  for (const entry of entries) {
    const where = `资源 "${entry.id}"`;
    if (seen.has(entry.id)) errors.push(`${where}: id 重复`);
    seen.add(entry.id);

    if (!(entry.bytes >= 0)) errors.push(`${where}: bytes 必须是非负数`);

    const urls = [entry.url, ...Object.values(entry.variants ?? {})];
    for (const url of urls) {
      if (entry.kind === 'texture') {
        if (hasExt(url, BANNED_TEXTURE_EXT)) {
          errors.push(`${where}: 贴图不许用 ${url.slice(url.lastIndexOf('.'))}，转成 KTX2（npm run assets:convert）`);
        } else if (!hasExt(url, [TEXTURE_EXT])) {
          errors.push(`${where}: 贴图必须是 ${TEXTURE_EXT}，拿到的是 ${url}`);
        }
      } else if (!hasExt(url, MODEL_EXT)) {
        errors.push(`${where}: 模型必须是 ${MODEL_EXT.join(' / ')}，拿到的是 ${url}`);
      }
    }

    if (entry.kind === 'model' && !entry.compression) {
      errors.push(`${where}: 模型必须声明 compression（draco 或 meshopt），未压缩的几何不许进包`);
    }
  }

  const core = totalBytes(entriesForPhase(entries, 'core'));
  if (core > FIRST_SCREEN_BUDGET_BYTES) {
    errors.push(
      `首屏资源 ${(core / 1024 / 1024).toFixed(2)}MB 超了 ${FIRST_SCREEN_BUDGET_BYTES / 1024 / 1024}MB 预算，` +
        `把不是开局必须的挪到 phase='deferred'`,
    );
  }

  return errors;
}
