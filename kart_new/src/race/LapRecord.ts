/**
 * 最佳圈速的本地存档。
 *
 * 不直接写 window.localStorage：存储对象从外面注入，测试里塞一个内存实现就行。
 * 所有访问都包了 try/catch —— Safari 无痕模式下 localStorage 存在但一写就抛。
 */
export interface RecordStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const DEFAULT_LAP_RECORD_KEY = 'kart-new.bestLap.v1';

export class LapRecordStore {
  private cached: number | null;

  constructor(
    private readonly storage: RecordStorage | null,
    private readonly key: string = DEFAULT_LAP_RECORD_KEY,
  ) {
    this.cached = this.read();
  }

  /** 历史最佳圈速（秒），没有记录返回 null */
  get best(): number | null {
    return this.cached;
  }

  /**
   * 提交一个圈速。
   * @returns 破纪录返回 true（HUD 据此弹"新纪录"）
   */
  submit(time: number): boolean {
    if (!Number.isFinite(time) || time <= 0) return false;
    if (this.cached !== null && time >= this.cached) return false;
    this.cached = time;
    this.write(time);
    return true;
  }

  clear(): void {
    this.cached = null;
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* 存不了就算了，纪录只是锦上添花 */
    }
  }

  private read(): number | null {
    try {
      const raw = this.storage?.getItem(this.key);
      if (raw == null) return null;
      const value = Number.parseFloat(raw);
      return Number.isFinite(value) && value > 0 ? value : null;
    } catch {
      return null;
    }
  }

  private write(time: number): void {
    try {
      this.storage?.setItem(this.key, String(time));
    } catch {
      /* 同上 */
    }
  }
}

/** 浏览器里能用就用 localStorage，node / 隐私模式下返回 null。 */
export function browserRecordStorage(): RecordStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
