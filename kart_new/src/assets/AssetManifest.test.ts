import { describe, expect, it } from 'vitest';
import {
  ASSET_MANIFEST,
  entriesForPhase,
  FIRST_SCREEN_BUDGET_BYTES,
  totalBytes,
  urlFor,
  validateManifest,
  type AssetEntry,
} from './AssetManifest';

const texture = (over: Partial<AssetEntry> = {}): AssetEntry => ({
  id: 'road',
  kind: 'texture',
  phase: 'core',
  url: 'assets/road.ktx2',
  bytes: 1024,
  ...over,
});

const model = (over: Partial<AssetEntry> = {}): AssetEntry => ({
  id: 'kart',
  kind: 'model',
  phase: 'core',
  url: 'assets/kart.glb',
  bytes: 1024,
  compression: 'meshopt',
  ...over,
});

describe('validateManifest', () => {
  it('实际清单是合法的', () => {
    expect(validateManifest(ASSET_MANIFEST)).toEqual([]);
  });

  it('PNG / JPG 贴图直接报错（这条约定靠这个测试钉着）', () => {
    for (const url of ['assets/road.png', 'assets/road.jpg', 'assets/road.webp']) {
      const errors = validateManifest([texture({ url })]);
      expect(errors.length).toBeGreaterThan(0);
      expect(errors[0]).toContain('KTX2');
    }
  });

  it('分档变体也要守同样的后缀规矩', () => {
    const errors = validateManifest([texture({ variants: { low: 'assets/road-512.png' } })]);
    expect(errors.length).toBeGreaterThan(0);
  });

  it('没声明几何压缩的模型不许进包', () => {
    const errors = validateManifest([model({ compression: undefined })]);
    expect(errors.join()).toContain('compression');
  });

  it('首屏资源超 10MB 报错，挪到 deferred 就不报', () => {
    const big = texture({ bytes: FIRST_SCREEN_BUDGET_BYTES + 1 });
    expect(validateManifest([big]).join()).toContain('首屏资源');
    expect(validateManifest([{ ...big, phase: 'deferred' }])).toEqual([]);
  });

  it('id 重复报错', () => {
    expect(validateManifest([texture(), texture()]).join()).toContain('重复');
  });

  it('合法的清单没有任何错误', () => {
    expect(validateManifest([texture(), model({ id: 'kart', compression: 'draco' })])).toEqual([]);
  });
});

describe('清单查询', () => {
  const entries = [texture(), texture({ id: 'sky', phase: 'deferred', bytes: 2048 })];

  it('按阶段筛选', () => {
    expect(entriesForPhase(entries, 'core').map((e) => e.id)).toEqual(['road']);
    expect(entriesForPhase(entries, 'deferred').map((e) => e.id)).toEqual(['sky']);
  });

  it('总字节数', () => {
    expect(totalBytes(entries)).toBe(3072);
  });

  it('按档位挑变体，没有变体就退回主 url', () => {
    const entry = texture({ variants: { low: 'assets/road-512.ktx2' } });
    expect(urlFor(entry, 'low')).toBe('assets/road-512.ktx2');
    expect(urlFor(entry, 'high')).toBe('assets/road.ktx2');
  });
});
