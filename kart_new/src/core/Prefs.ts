/**
 * 玩家的本机设置（画质档位 / 输入方式）。存 localStorage，跨会话记住。
 *
 * 读进来的东西一律当成脏数据过一遍 sanitizePrefs：localStorage 里可能是上个版本
 * 写的、也可能是人手改的，不校验的话一个坏值就能让整个启动流程炸掉。
 */
import { isInputMode, type InputModeSetting } from '../input/InputMode';
import { sanitizeKeyBindings, type KeyBindings } from '../input/KeyBindings';
import { isQualityTier, type TierOverride } from '../render/QualityTiers';
import { DEFAULT_TRACK_ID, isTrackId, type TrackId } from '../track/tracks';
import { isGameMode, type GameMode } from '../race/GameMode';
import { isCupId, type CupId } from '../race/Cup';

export interface Prefs {
  /** 画质档位覆盖，'auto' = 听设备探测的 */
  quality: TierOverride;
  /** 输入方式覆盖，'auto' = 听设备探测的 */
  input: InputModeSetting;
  /** 总音量 0..1 */
  volume: number;
  /** 音乐音量 0..1（在总音量之下再乘一次） */
  musicVolume: number;
  /** 静音开关。和音量分开存：静音再取消要能回到原来的音量 */
  muted: boolean;
  /** 上一次选的赛道，主菜单默认停在它上面 */
  track: TrackId;
  /** 上一次选的玩法 */
  mode: GameMode;
  /** 上一次选的杯赛 */
  cup: CupId;
  /** 按键映射。改过之后整张表存下来，不存差量 —— 差量在默认值变了之后会很难解释 */
  keys: KeyBindings;
  /**
   * 触屏布局的惯用手。'right' = 右手操作按钮（摇杆在左），左撇子反过来。
   * 这是"能不能舒服地玩"的问题，不是偏好问题：惯用手在摇杆那一侧的话，
   * 精细的转向操作交给了不灵活的那只手。
   */
  handed: 'right' | 'left';
}

export const DEFAULT_PREFS: Readonly<Prefs> = Object.freeze({
  quality: 'auto',
  input: 'auto',
  volume: 0.8,
  musicVolume: 0.55,
  muted: false,
  track: DEFAULT_TRACK_ID,
  mode: 'single',
  cup: 'grand',
  keys: sanitizeKeyBindings(null),
  handed: 'right',
});

/** 存储键带版本号：字段变了直接换 key，比写迁移代码省事，代价只是重选一次设置 */
const STORAGE_KEY = 'kart.prefs.v3';

/** 校验 + 补默认值。任何看不懂的字段都退回默认，不抛异常 */
export function sanitizePrefs(raw: unknown): Prefs {
  const out: Prefs = { ...DEFAULT_PREFS };
  if (!raw || typeof raw !== 'object') return out;
  const source = raw as Partial<Record<keyof Prefs, unknown>>;
  if (source.quality === 'auto' || isQualityTier(source.quality)) out.quality = source.quality;
  if (source.input === 'auto' || isInputMode(source.input)) out.input = source.input;
  if (isTrackId(source.track)) out.track = source.track;
  if (isGameMode(source.mode)) out.mode = source.mode;
  if (isCupId(source.cup)) out.cup = source.cup;
  out.volume = volumeOr(source.volume, DEFAULT_PREFS.volume);
  out.musicVolume = volumeOr(source.musicVolume, DEFAULT_PREFS.musicVolume);
  // 只认真正的 true：localStorage 里存过 'false' 这种字符串的话，
  // 松散判断会把它当成静音，玩家会觉得"声音莫名其妙没了"
  if (typeof source.muted === 'boolean') out.muted = source.muted;
  if (source.handed === 'left' || source.handed === 'right') out.handed = source.handed;
  // 键位表自己有一套校验（缺的补默认、空的退回默认），这里不重复写
  out.keys = sanitizeKeyBindings(source.keys);
  return out;
}

/** 音量：非有限数、超范围一律退回默认值，不做钳制 —— 那种值本来就是脏数据 */
function volumeOr(raw: unknown, fallback: number): number {
  return typeof raw === 'number' && Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : fallback;
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
 * URL 参数覆盖：?quality=low&input=touch&track=ridge&mode=timeTrial&mute=1。
 *
 * 真机上调试用：手机上没有控制台可以敲 localStorage，扫个二维码就能直接进低画质。
 * **不写回存储** —— 它是一次性的，关掉参数就回到平时的设置。
 */
export function applyUrlOverrides(prefs: Prefs, search: string): Prefs {
  const params = new URLSearchParams(search);
  const mute = params.get('mute');
  return sanitizePrefs({
    ...prefs,
    quality: params.get('quality') ?? prefs.quality,
    input: params.get('input') ?? prefs.input,
    track: params.get('track') ?? prefs.track,
    mode: params.get('mode') ?? prefs.mode,
    // ?mute=1 / ?mute=0 都要认：录屏时想静音，调音效时想强制打开
    muted: mute === null ? prefs.muted : mute !== '0' && mute !== 'false',
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
