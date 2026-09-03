import { describe, expect, it } from 'vitest';
import { formatDelta, formatTime, formatTimeOrDash } from './formatTime';
import { LapRecordStore, type RecordStorage } from './LapRecord';

/** 内存版存储，替掉 localStorage */
function memoryStorage(initial: Record<string, string> = {}): RecordStorage {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

/** 一写就抛，模拟 Safari 无痕模式 */
const throwingStorage: RecordStorage = {
  getItem: () => {
    throw new Error('SecurityError');
  },
  setItem: () => {
    throw new Error('QuotaExceededError');
  },
  removeItem: () => {
    throw new Error('SecurityError');
  },
};

describe('LapRecordStore', () => {
  it('第一次提交就是纪录', () => {
    const store = new LapRecordStore(memoryStorage(), 'k');
    expect(store.best).toBeNull();
    expect(store.submit(42.5)).toBe(true);
    expect(store.best).toBe(42.5);
  });

  it('只有更快才算破纪录', () => {
    const store = new LapRecordStore(memoryStorage(), 'k');
    store.submit(30);
    expect(store.submit(31)).toBe(false);
    expect(store.submit(30)).toBe(false); // 打平不算
    expect(store.submit(29.999)).toBe(true);
    expect(store.best).toBe(29.999);
  });

  it('写进去的值下次开局能读回来', () => {
    const storage = memoryStorage();
    new LapRecordStore(storage, 'k').submit(18.25);
    expect(new LapRecordStore(storage, 'k').best).toBe(18.25);
  });

  it('存的是脏数据时当作没有纪录', () => {
    expect(new LapRecordStore(memoryStorage({ k: 'oops' }), 'k').best).toBeNull();
    expect(new LapRecordStore(memoryStorage({ k: '-3' }), 'k').best).toBeNull();
  });

  it('非法圈速不入库', () => {
    const store = new LapRecordStore(memoryStorage(), 'k');
    expect(store.submit(Number.NaN)).toBe(false);
    expect(store.submit(0)).toBe(false);
    expect(store.best).toBeNull();
  });

  it('storage 为 null 或一碰就抛时不影响使用', () => {
    for (const storage of [null, throwingStorage]) {
      const store = new LapRecordStore(storage, 'k');
      expect(store.best).toBeNull();
      expect(store.submit(20)).toBe(true); // 内存里仍然记住本局最佳
      expect(store.best).toBe(20);
      expect(() => store.clear()).not.toThrow();
      expect(store.best).toBeNull();
    }
  });
});

describe('formatTime', () => {
  it('不满一分钟省掉分位', () => {
    expect(formatTime(0)).toBe('0.000');
    expect(formatTime(9.4)).toBe('9.400');
    expect(formatTime(59.999)).toBe('59.999');
  });

  it('超过一分钟带 m:ss', () => {
    expect(formatTime(60)).toBe('1:00.000');
    expect(formatTime(83.456)).toBe('1:23.456');
    expect(formatTime(3600 + 1.5)).toBe('60:01.500');
  });

  it('毫秒四舍五入，进位时秒也跟着进', () => {
    expect(formatTime(1.9996)).toBe('2.000');
    expect(formatTime(59.9999)).toBe('1:00.000');
  });

  it('非法值给占位符', () => {
    expect(formatTime(Number.NaN)).toBe('--.---');
    expect(formatTime(-1)).toBe('--.---');
    expect(formatTimeOrDash(null)).toBe('--.---');
    expect(formatTimeOrDash(1)).toBe('1.000');
  });

  it('formatDelta 带符号', () => {
    expect(formatDelta(-0.25)).toBe('-0.250');
    expect(formatDelta(1.5)).toBe('+1.500');
  });
});
