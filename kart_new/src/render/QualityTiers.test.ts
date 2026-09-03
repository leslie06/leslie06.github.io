import { describe, expect, it } from 'vitest';
import { isIOSUA, isMobileUA, makeCaps } from '../core/DeviceCaps';
import {
  effectivePixelRatio,
  lowerTier,
  PERF_BUDGET_LOW,
  pickTier,
  QUALITY_TIERS,
  resolveTier,
  TIER_ORDER,
  type QualityTier,
} from './QualityTiers';

const IPHONE_15 = makeCaps({
  ua: 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1',
  maxTouchPoints: 5,
  screenLongEdge: 852,
  devicePixelRatio: 3,
  hardwareConcurrency: 6,
  deviceMemoryGB: null,
  gpu: 'Apple A17 GPU',
  maxTextureSize: 8192,
});

const OLD_ANDROID = makeCaps({
  ua: 'Mozilla/5.0 (Linux; Android 9; SM-J600G) AppleWebKit/537.36 Mobile Safari/537.36',
  maxTouchPoints: 5,
  screenLongEdge: 720,
  devicePixelRatio: 2,
  hardwareConcurrency: 4,
  deviceMemoryGB: 2,
  gpu: 'Mali-T830',
  maxTextureSize: 4096,
});

const DESKTOP = makeCaps({
  ua: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36',
  maxTouchPoints: 0,
  screenLongEdge: 2560,
  devicePixelRatio: 2,
  hardwareConcurrency: 12,
  deviceMemoryGB: 16,
  gpu: 'Apple M2',
  maxTextureSize: 16384,
});

describe('pickTier', () => {
  it('桌面旗舰给 high，老安卓机给 low', () => {
    expect(pickTier(DESKTOP)).toBe('high');
    expect(pickTier(OLD_ANDROID)).toBe('low');
  });

  it('没有 WebGL2 直接判 low，不看别的', () => {
    expect(pickTier(makeCaps({ ...DESKTOP, webgl2: false }))).toBe('low');
  });

  it('贴图上限低于 4096 的机器直接判 low', () => {
    expect(pickTier(makeCaps({ ...DESKTOP, maxTextureSize: 2048 }))).toBe('low');
  });

  it('软件渲染兜底到 low，哪怕是核数很多的桌面机', () => {
    for (const base of [IPHONE_15, DESKTOP]) {
      const caps = makeCaps({ ...base, gpu: 'SwiftShader', hardwareConcurrency: 16 });
      expect(pickTier(caps)).toBe('low');
    }
  });

  it('新款 iPhone 至少给到 medium', () => {
    const tier = pickTier(IPHONE_15);
    expect(TIER_ORDER.indexOf(tier)).toBeGreaterThanOrEqual(TIER_ORDER.indexOf('medium'));
  });

  it('deviceMemory 探不到（Safari）不该被当成内存小', () => {
    const withMemory = pickTier(makeCaps({ ...IPHONE_15, deviceMemoryGB: 4 }));
    const withoutMemory = pickTier(makeCaps({ ...IPHONE_15, deviceMemoryGB: null }));
    expect(TIER_ORDER.indexOf(withoutMemory)).toBeGreaterThanOrEqual(
      TIER_ORDER.indexOf(withMemory) - 1,
    );
  });

  it('同一台机器核数越多档位不会更低（单调）', () => {
    let prev = -1;
    for (const cores of [2, 4, 6, 8, 12]) {
      const tier = pickTier(makeCaps({ ...IPHONE_15, hardwareConcurrency: cores }));
      const index = TIER_ORDER.indexOf(tier);
      expect(index).toBeGreaterThanOrEqual(prev);
      prev = index;
    }
  });
});

describe('QUALITY_TIERS 表', () => {
  const tiers: QualityTier[] = ['low', 'medium', 'high'];

  it('画质开销随档位单调不减', () => {
    const keys = [
      'maxPixelRatio', 'aiCount', 'sparkCapacity', 'propDensity', 'fogFar',
      'bloomRadius', 'vignette', 'envMapSize', 'dustCapacity', 'burstCapacity',
    ] as const;
    for (const key of keys) {
      for (let i = 1; i < tiers.length; i++) {
        expect(QUALITY_TIERS[tiers[i]!][key]).toBeGreaterThanOrEqual(QUALITY_TIERS[tiers[i - 1]!][key]);
      }
    }
  });

  it('low 档关实时阴影并改用贴片假影子', () => {
    expect(QUALITY_TIERS.low.shadowMapSize).toBe(0);
    expect(QUALITY_TIERS.low.blobShadows).toBe(true);
    expect(QUALITY_TIERS.medium.shadowMapSize).toBeGreaterThan(0);
    expect(QUALITY_TIERS.medium.blobShadows).toBe(false);
  });

  it('low 档的贴图上限不超过性能预算', () => {
    expect(QUALITY_TIERS.low.maxTextureSize).toBeLessThanOrEqual(PERF_BUDGET_LOW.textureSize);
  });

  it('low 档只留 tonemapping，不做 bloom', () => {
    expect(QUALITY_TIERS.low.postFx).toBe('none');
    expect(QUALITY_TIERS.low.bloomStrength).toBe(0);
  });

  it('postFx 关掉的档位，后处理里的每一项也都得是关的', () => {
    for (const tier of tiers) {
      if (QUALITY_TIERS[tier].postFx !== 'none') continue;
      expect(QUALITY_TIERS[tier].bloomStrength).toBe(0);
      expect(QUALITY_TIERS[tier].smaa).toBe(false);
      expect(QUALITY_TIERS[tier].vignette).toBe(0);
    }
  });

  it('SMAA 只在 full 档开：bloom 档已经在省带宽了，再加一个全屏 pass 没道理', () => {
    expect(QUALITY_TIERS.high.smaa).toBe(true);
    expect(QUALITY_TIERS.medium.smaa).toBe(false);
    expect(QUALITY_TIERS.low.smaa).toBe(false);
  });

  it('low 档把吃粒子和吃带宽的都关掉', () => {
    expect(QUALITY_TIERS.low.envMapSize).toBe(0);
    expect(QUALITY_TIERS.low.dustCapacity).toBe(0);
    expect(QUALITY_TIERS.low.boostTrail).toBe(false);
    expect(QUALITY_TIERS.low.aiSparks).toBe(false);
    // 但爆闪要留着：道具打中了没有任何反馈的话，玩家不知道自己为什么慢了
    expect(QUALITY_TIERS.low.burstCapacity).toBeGreaterThan(0);
  });

  it('相机远裁剪面比雾的远端更远，否则远处会被裁出硬边', () => {
    for (const tier of tiers) {
      expect(QUALITY_TIERS[tier].cameraFar).toBeGreaterThan(QUALITY_TIERS[tier].fogFar);
    }
  });
});

describe('lowerTier / resolveTier / effectivePixelRatio', () => {
  it('降档按 high -> medium -> low，到底了返回 null', () => {
    expect(lowerTier('high')).toBe('medium');
    expect(lowerTier('medium')).toBe('low');
    expect(lowerTier('low')).toBeNull();
  });

  it('手动覆盖压过探测结果，但 detected 仍然是探测值', () => {
    const auto = resolveTier(DESKTOP, 'auto');
    expect(auto.tier).toBe('high');

    const forced = resolveTier(DESKTOP, 'low');
    expect(forced.tier).toBe('low');
    expect(forced.detected).toBe('high');
    expect(forced.settings).toBe(QUALITY_TIERS.low);
  });

  it('像素比取设备值和档位上限里的小的那个', () => {
    expect(effectivePixelRatio(QUALITY_TIERS.high, 3)).toBe(2);
    expect(effectivePixelRatio(QUALITY_TIERS.high, 1)).toBe(1);
    expect(effectivePixelRatio(QUALITY_TIERS.low, 3)).toBe(1);
  });
});

describe('UA 判断', () => {
  it('认得出 iPhone 和安卓手机', () => {
    expect(isMobileUA(IPHONE_15.ua)).toBe(true);
    expect(isMobileUA(OLD_ANDROID.ua)).toBe(true);
    expect(isMobileUA(DESKTOP.ua)).toBe(false);
  });

  it('伪装成 Mac 的 iPadOS 靠触摸点数认出来', () => {
    const ipad = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 Safari/605.1.15';
    expect(isIOSUA(ipad, 5)).toBe(true);
    expect(isIOSUA(ipad, 0)).toBe(false);
    expect(isIOSUA(IPHONE_15.ua)).toBe(true);
  });
});
