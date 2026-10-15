import { beforeAll, describe, expect, it } from 'vitest';
import { setLang } from '../core/I18n';
import { formatPlaytime } from './PlayTime';
import { summary } from '../online/CloudSave';

describe('play time', () => {
  beforeAll(() => setLang('zh'));
  it('reads as minutes, then hours and minutes', () => {
    expect(formatPlaytime(30)).toBe('不到 1 分钟');
    expect(formatPlaytime(12 * 60 + 40)).toBe('12 分钟');
    expect(formatPlaytime(3 * 3600 + 12 * 60)).toBe('3 小时 12 分');
  });
  it('travels in the cloud save and shows in its summary', () => {
    expect(summary({ 'drivecity.playtime.v1': '7200' }).secs).toBe(7200);
    expect(summary({}).secs).toBe(0);
  });
});
