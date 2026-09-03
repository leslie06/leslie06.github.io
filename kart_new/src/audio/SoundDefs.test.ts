import { describe, expect, it } from 'vitest';
import { CHARGE_RATES, SOUND_DEFS, SOUND_IDS, type SoundId } from './SoundDefs';
import { renderSamples } from './synth';

/**
 * 音效表是纯数据，规矩靠这个测试钉住 —— 表里少填一个 synth 的后果是
 * "那条音效在没有文件时永远静音"，而这件事在开发机上（有文件时）看不出来。
 */
describe('SOUND_DEFS', () => {
  it('SOUND_IDS 和表对得上', () => {
    expect(SOUND_IDS.length).toBe(Object.keys(SOUND_DEFS).length);
    for (const id of SOUND_IDS) expect(SOUND_DEFS[id].id).toBe(id);
  });

  it.each(SOUND_IDS)('%s 的字段是合法的', (id: SoundId) => {
    const def = SOUND_DEFS[id];
    expect(def.volume).toBeGreaterThan(0);
    expect(def.volume).toBeLessThanOrEqual(1);
    expect(def.bus === 'sfx' || def.bus === 'music').toBe(true);
    // 路径统一在 audio/ 下，AudioManager 会在前面拼 BASE_URL
    expect(def.file.startsWith('audio/')).toBe(true);
    expect(def.file).not.toMatch(/^\//);
  });

  it.each(SOUND_IDS)('%s 有能出声的占位音色', (id: SoundId) => {
    const { synth } = SOUND_DEFS[id];
    expect(synth.duration).toBeGreaterThan(0);
    expect(synth.freq).toBeGreaterThan(0);
    // 真的渲染一遍：光有字段不算数，得确认它不是一段静音
    const samples = renderSamples(synth, 8000);
    expect(samples.length).toBeGreaterThan(0);
    expect(Math.max(...Array.from(samples, Math.abs))).toBeGreaterThan(0.05);
  });

  it('循环音不设同时发声数上限（它永远只有一条）', () => {
    for (const id of SOUND_IDS) {
      const def = SOUND_DEFS[id];
      if (def.loop) expect(def.maxVoices).toBeUndefined();
    }
  });

  it('循环音的占位音色必须是 seamless 的，否则每循环一次响一声"啪"', () => {
    for (const id of SOUND_IDS) {
      const def = SOUND_DEFS[id];
      // charge 是例外：它本来就是一条向上的滑音，接口处的跳变正是"又爬了一轮"的效果
      if (!def.loop || id === 'charge') continue;
      expect(def.synth.seamless, `${id} 是循环音但占位音色没写 seamless`).toBe(true);
    }
  });

  it('撞击类音效有同时发声数上限（不限的话连撞会叠成一片糊声）', () => {
    for (const id of ['itemHit', 'wallHit', 'kartHit'] as const) {
      expect(SOUND_DEFS[id].maxVoices).toBeGreaterThan(0);
      expect(SOUND_DEFS[id].maxVoices).toBeLessThanOrEqual(4);
    }
  });

  it('背景音乐走 music 总线，其余全走 sfx —— 不然音乐音量拖条会拖走音效', () => {
    for (const id of SOUND_IDS) {
      expect(SOUND_DEFS[id].bus).toBe(id === 'music' ? 'music' : 'sfx');
    }
  });
});

describe('CHARGE_RATES', () => {
  it('三档，音高逐档往上，档位之间差得听得出来', () => {
    expect(CHARGE_RATES).toHaveLength(3);
    for (let i = 1; i < CHARGE_RATES.length; i++) {
      // 至少一个大三度（1.25 倍）才算"听得出换档了"
      expect(CHARGE_RATES[i]! / CHARGE_RATES[i - 1]!).toBeGreaterThan(1.25);
    }
    // Howler 的 rate 只认 0.5..4
    for (const rate of CHARGE_RATES) {
      expect(rate).toBeGreaterThanOrEqual(0.5);
      expect(rate).toBeLessThanOrEqual(4);
    }
  });
});
