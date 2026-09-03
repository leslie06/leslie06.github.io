/**
 * 玩家的本机设置（画质档位 / 输入方式）。存 localStorage，跨会话记住。
 *
 * 读进来的东西一律当成脏数据过一遍 sanitizePrefs：localStorage 里可能是上个版本
 * 写的、也可能是人手改的，不校验的话一个坏值就能让整个启动流程炸掉。
 */
import { isInputMode, type InputModeSetting } from '../input/InputMode';
import { isQualityTier, type TierOverride } from '../render/QualityTiers';

export interface Prefs {
  /** 画质档位覆盖，'auto' = 听设备探测的 */
  quality: TierOverride;
  /** 输入方式覆盖，'auto' = 听设备探测的 */
  input: InputModeSetting;
}

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({ quality: 'auto', input: 'auto' });

const STORAGE_KEY = 'kart.prefs.v1';

/** 校验 + 补默认值。任何看不懂的字段都退回默认，不抛异常 */
export function sanitizePrefs(raw: unknown): Prefs {
  const out: Prefs = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== 'object') return out;
  const source = raw as Partial<Record<keyof Prefs, unknown>>;
  if (source.quality === 'auto' || isQualityTier(source.quality)) out.quality = source.quality;
  if (source.input === 'auto' || isInputMode(source.input)) out.input = source.input;
  return out;
}

/** localStorage 的最小接口。测试塞个假的进来就行 */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/**
 * 浏览器的 localStorage。
 * Safari 无痕模式下 setItem 会抛，所以整个存储层都得能吞异常 ——
 * 设置存不下顶多是下次要重选，不该让游戏起不来。
 */
export function browserPrefsStorage(): PrefsStorage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function loadPrefs(storage: PrefsStorage | null = browserPrefsStorage()): Prefs {
  if (!storage) return { ...DEFAULT_PREFS };
  try {
    const raw = storage.getItem(STORAGE_KEY);
    return sanitizePrefs(raw ? JSON.parse(raw) : null);
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

/**
 * URL 参数覆盖：?quality=low&input=touch。
 *
 * 真机上调试用：手机上没有控制台可以敲 localStorage，扫个二维码就能直接进低画质。
 * **不写回存储** —— 它是一次性的，关掉参数就回到平时的设置。
 */
export function applyUrlOverrides(prefs: Prefs, search: string): Prefs {
  const params = new URLSearchParams(search);
  return sanitizePrefs({
    quality: params.get('quality') ?? prefs.quality,
    input: params.get('input') ?? prefs.input,
  });
}

export function savePrefs(prefs: Prefs, storage: PrefsStorage | null = browserPrefsStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(sanitizePrefs(prefs)));
  } catch {
    // 无痕模式 / 存储配额满：忽略
  }
}
