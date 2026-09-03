import { describe, expect, it } from 'vitest';
import {
  applyUrlOverrides,
  DEFAULT_PREFS,
  loadPrefs,
  sanitizePrefs,
  savePrefs,
  type PrefsStorage,
} from './Prefs';
import { detectInputMode, resolveInputMode } from '../input/InputMode';
import { makeCaps } from './DeviceCaps';

function fakeStorage(initial: Record<string, string> = {}): PrefsStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
  };
}

describe('sanitizePrefs', () => {
  it('认识合法值', () => {
    expect(sanitizePrefs({ quality: 'low', input: 'touch' })).toEqual({ quality: 'low', input: 'touch' });
  });

  it('垃圾输入一律退回默认，不抛异常', () => {
    for (const raw of [null, undefined, 42, 'nope', [], { quality: 'ultra', input: 'gamepad' }]) {
      expect(sanitizePrefs(raw)).toEqual(DEFAULT_PREFS);
    }
  });

  it('只有一个字段合法时，另一个字段用默认值', () => {
    expect(sanitizePrefs({ quality: 'high' })).toEqual({ quality: 'high', input: 'auto' });
  });
});

describe('loadPrefs / savePrefs', () => {
  it('存了能读回来', () => {
    const storage = fakeStorage();
    savePrefs({ quality: 'medium', input: 'keyboard' }, storage);
    expect(loadPrefs(storage)).toEqual({ quality: 'medium', input: 'keyboard' });
  });

  it('存储里是坏 JSON 时退回默认', () => {
    const storage = fakeStorage({ 'kart.prefs.v1': '{oops' });
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS);
  });

  it('没有存储（无痕模式）时既不抛也不崩', () => {
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs({ quality: 'low', input: 'touch' }, null)).not.toThrow();
  });

  it('setItem 抛异常（Safari 无痕）时吞掉', () => {
    const storage: PrefsStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => savePrefs({ quality: 'low', input: 'touch' }, storage)).not.toThrow();
  });
});

describe('applyUrlOverrides', () => {
  const base = { quality: 'high', input: 'keyboard' } as const;

  it('URL 参数压过存储里的设置', () => {
    expect(applyUrlOverrides({ ...base }, '?quality=low&input=touch')).toEqual({
      quality: 'low',
      input: 'touch',
    });
  });

  it('没写的那一项保持原样', () => {
    expect(applyUrlOverrides({ ...base }, '?quality=medium')).toEqual({
      quality: 'medium',
      input: 'keyboard',
    });
  });

  it('乱填的参数被忽略（退回默认，不是崩）', () => {
    expect(applyUrlOverrides({ ...base }, '?quality=ultra')).toEqual({
      quality: 'auto',
      input: 'keyboard',
    });
  });

  it('没有参数时原样返回', () => {
    expect(applyUrlOverrides({ ...base }, '')).toEqual(base);
  });
});

describe('detectInputMode', () => {
  it('手机 UA 判触屏', () => {
    expect(detectInputMode(makeCaps({ ua: 'iPhone', maxTouchPoints: 5, screenLongEdge: 852 }))).toBe('touch');
  });

  it('触摸屏笔记本留在键盘上（屏幕大、有真键盘）', () => {
    const caps = makeCaps({
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120',
      maxTouchPoints: 10,
      screenLongEdge: 1920,
    });
    expect(detectInputMode(caps)).toBe('keyboard');
  });

  it('没有触摸点的桌面判键盘', () => {
    expect(detectInputMode(makeCaps({ ua: 'Macintosh', maxTouchPoints: 0, screenLongEdge: 2560 }))).toBe('keyboard');
  });

  it('手动设置压过自动探测，detected 仍然保留探测值', () => {
    const caps = makeCaps({ ua: 'iPhone', maxTouchPoints: 5, screenLongEdge: 852 });
    expect(resolveInputMode(caps, 'keyboard')).toEqual({ mode: 'keyboard', detected: 'touch' });
    expect(resolveInputMode(caps, 'auto')).toEqual({ mode: 'touch', detected: 'touch' });
  });
});
