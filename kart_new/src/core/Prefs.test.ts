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

/** 只写关心的字段，其余补默认值。加新字段时不用回来改每一条断言 */
const prefs = (over: Partial<typeof DEFAULT_PREFS> = {}) => ({ ...DEFAULT_PREFS, ...over });

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
    expect(sanitizePrefs({ quality: 'low', input: 'touch', track: 'ridge' })).toEqual(
      prefs({ quality: 'low', input: 'touch', track: 'ridge' }),
    );
  });

  it('垃圾输入一律退回默认，不抛异常', () => {
    for (const raw of [null, undefined, 42, 'nope', [], { quality: 'ultra', input: 'gamepad' }]) {
      expect(sanitizePrefs(raw)).toEqual(DEFAULT_PREFS);
    }
  });

  it('只有一个字段合法时，另一个字段用默认值', () => {
    expect(sanitizePrefs({ quality: 'high' })).toEqual(prefs({ quality: 'high' }));
  });

  it('音量：合法的收下，越界/非数字退回默认', () => {
    expect(sanitizePrefs({ volume: 0, musicVolume: 1 })).toEqual(prefs({ volume: 0, musicVolume: 1 }));
    for (const bad of [-0.1, 1.5, NaN, Infinity, '0.5', null]) {
      expect(sanitizePrefs({ volume: bad }).volume).toBe(DEFAULT_PREFS.volume);
    }
  });

  it('静音只认真正的 boolean —— 存过字符串 "false" 的话不能被当成静音', () => {
    expect(sanitizePrefs({ muted: true }).muted).toBe(true);
    for (const bad of ['false', 'true', 1, 0, null]) {
      expect(sanitizePrefs({ muted: bad }).muted).toBe(false);
    }
  });

  it('赛道 id 认不出来就退回默认赛道', () => {
    expect(sanitizePrefs({ track: 'meadow' }).track).toBe('meadow');
    expect(sanitizePrefs({ track: 'atlantis' }).track).toBe(DEFAULT_PREFS.track);
  });

  it('惯用手只认 left / right', () => {
    expect(sanitizePrefs({ handed: 'left' }).handed).toBe('left');
    for (const bad of ['LEFT', 1, null, {}]) {
      expect(sanitizePrefs({ handed: bad }).handed).toBe('right');
    }
  });

  it('键位表交给 sanitizeKeyBindings，坏值不会漏进来', () => {
    expect(sanitizePrefs({ keys: { forward: ['KeyI'] } }).keys.forward).toEqual(['KeyI']);
    // 没写的动作补默认，整张表坏掉也退回默认
    expect(sanitizePrefs({ keys: 'nope' }).keys).toEqual(DEFAULT_PREFS.keys);
    expect(sanitizePrefs({ keys: { forward: [] } }).keys.forward).toEqual(
      DEFAULT_PREFS.keys.forward,
    );
  });
});

describe('loadPrefs / savePrefs', () => {
  it('存了能读回来', () => {
    const storage = fakeStorage();
    savePrefs(prefs({ quality: 'medium', input: 'keyboard', volume: 0.3, muted: true }), storage);
    expect(loadPrefs(storage)).toEqual(
      prefs({ quality: 'medium', input: 'keyboard', volume: 0.3, muted: true }),
    );
  });

  it('存储里是坏 JSON 时退回默认', () => {
    const storage = fakeStorage({ 'kart.prefs.v3': '{oops' });
    expect(loadPrefs(storage)).toEqual(DEFAULT_PREFS);
  });

  it('没有存储（无痕模式）时既不抛也不崩', () => {
    expect(loadPrefs(null)).toEqual(DEFAULT_PREFS);
    expect(() => savePrefs(prefs({ quality: 'low', input: 'touch' }), null)).not.toThrow();
  });

  it('setItem 抛异常（Safari 无痕）时吞掉', () => {
    const storage: PrefsStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
    };
    expect(() => savePrefs(prefs({ quality: 'low', input: 'touch' }), storage)).not.toThrow();
  });
});

describe('applyUrlOverrides', () => {
  const base = prefs({ quality: 'high', input: 'keyboard' });

  it('URL 参数压过存储里的设置', () => {
    expect(applyUrlOverrides({ ...base }, '?quality=low&input=touch&track=meadow')).toEqual(
      prefs({ quality: 'low', input: 'touch', track: 'meadow' }),
    );
  });

  it('没写的那一项保持原样', () => {
    expect(applyUrlOverrides({ ...base }, '?quality=medium')).toEqual(
      prefs({ quality: 'medium', input: 'keyboard' }),
    );
  });

  it('乱填的参数被忽略（退回默认，不是崩）', () => {
    expect(applyUrlOverrides({ ...base }, '?quality=ultra')).toEqual(
      prefs({ quality: 'auto', input: 'keyboard' }),
    );
  });

  it('没有参数时原样返回', () => {
    expect(applyUrlOverrides({ ...base }, '')).toEqual(base);
  });

  it('?mute 两个方向都认：录屏要静音，调音效要强制打开', () => {
    const muted = prefs({ muted: true });
    expect(applyUrlOverrides({ ...base }, '?mute=1').muted).toBe(true);
    expect(applyUrlOverrides({ ...muted }, '?mute=0').muted).toBe(false);
    expect(applyUrlOverrides({ ...muted }, '').muted).toBe(true);
  });

  it('音量这类不适合放 URL 的设置不受影响', () => {
    const loud = prefs({ volume: 0.25 });
    expect(applyUrlOverrides({ ...loud }, '?quality=low').volume).toBe(0.25);
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
