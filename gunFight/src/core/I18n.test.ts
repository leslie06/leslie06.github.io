import { describe, expect, it } from 'vitest';
import { STRINGS, lang, setLang, t, type TKey } from './I18n';

/** Placeholder names a template uses; `{nn}` is the zero-padded `{n}`, so they count as one. */
const holes = (s: string): string => [...new Set((s.match(/\{\w+\}/g) ?? []).map((h) => (h === '{nn}' ? '{n}' : h)))].sort().join(',');

describe('i18n', () => {
  it('every Chinese string fills the same placeholders as the English one', () => {
    for (const k of Object.keys(STRINGS.en) as TKey[]) expect(holes(STRINGS.zh[k]), k).toBe(holes(STRINGS.en[k]));
  });

  it('keeps the interact keycap parseable in both languages', () => {
    // ui/Banner Prompt.setRaw splits "[E] TEXT" into keycap + label.
    for (const l of ['en', 'zh'] as const) expect(STRINGS[l]['msg.resupplyPrompt']).toMatch(/^\s*\[[^\]]{1,6}\]\s*\S/);
  });

  it('fills placeholders and follows the current language', () => {
    setLang('en');
    expect(t('msg.waveComplete', { n: 3, bonus: 750 })).toBe('WAVE 3 COMPLETE  +750');
    expect(t('wave.banner', { n: 3, nn: '03' })).toBe('WAVE 03');
    setLang('zh');
    expect(lang()).toBe('zh');
    expect(t('msg.waveComplete', { n: 3, bonus: 750 })).toBe('第 3 波完成  +750');
    expect(t('wave.banner', { n: 3, nn: '03' })).toBe('第 3 波');
    setLang('en');
  });
});
