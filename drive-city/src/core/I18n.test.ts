import { describe, it, expect } from 'vitest';
import { STRINGS, setLang, t, type TKey } from './I18n';

describe('I18n', () => {
  it('every key has the same placeholders in both languages', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(',');
    for (const key of Object.keys(STRINGS.en) as TKey[]) {
      expect(ph(STRINGS.zh[key]), key).toBe(ph(STRINGS.en[key]));
      expect(STRINGS.zh[key].length, key).toBeGreaterThan(0);
    }
  });
  it('fills templates', () => {
    setLang('en');
    expect(t('hud.best', { n: 1200 })).toBe('BEST 1200');
    setLang('zh');
    expect(t('hud.driftBank', { n: 42 })).toBe('+42 已入账');
  });
});
