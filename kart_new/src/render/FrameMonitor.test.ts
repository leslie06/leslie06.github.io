import { describe, expect, it } from 'vitest';
import { DEFAULT_FRAME_MONITOR_CONFIG, FrameMonitor } from './FrameMonitor';

/** 连喂 seconds 秒、每帧 dt，返回这期间触发了几次降档 */
function feed(monitor: FrameMonitor, dt: number, seconds: number): number {
  let hits = 0;
  for (let t = 0; t < seconds; t += dt) {
    if (monitor.push(dt)) hits++;
  }
  return hits;
}

describe('FrameMonitor', () => {
  it('稳定 60fps 永远不建议降档', () => {
    const monitor = new FrameMonitor();
    expect(feed(monitor, 1 / 60, 30)).toBe(0);
  });

  it('刚好压在 30fps 上不降档（目标是"低于"才降）', () => {
    const monitor = new FrameMonitor();
    expect(feed(monitor, 1 / 30, 30)).toBe(0);
  });

  it('持续 20fps 会降档', () => {
    const monitor = new FrameMonitor();
    expect(feed(monitor, 1 / 20, 30)).toBeGreaterThan(0);
  });

  it('warmup 期间再卡也不降档', () => {
    const monitor = new FrameMonitor({ warmupSeconds: 5 });
    expect(feed(monitor, 1 / 10, 4.5)).toBe(0);
  });

  it('降档后进入冷静期，不会连着降第二次', () => {
    const cfg = DEFAULT_FRAME_MONITOR_CONFIG;
    const monitor = new FrameMonitor();
    // 跑到第一次触发
    let elapsed = 0;
    const dt = 1 / 15;
    while (elapsed < 60 && !monitor.push(dt)) elapsed += dt;
    expect(elapsed).toBeLessThan(60);

    // 冷静期内一直很卡，也不该再喊
    expect(feed(monitor, dt, cfg.cooldownSeconds * 0.9)).toBe(0);
  });

  it('单帧毛刺不算数：偶尔一个 2 秒的巨帧不该拉低判断', () => {
    const monitor = new FrameMonitor();
    let hits = 0;
    for (let i = 0; i < 60 * 30; i++) {
      hits += monitor.push(i % 300 === 0 ? 2 : 1 / 60) ? 1 : 0;
    }
    expect(hits).toBe(0);
  });

  it('窗口没攒满就不给平均帧率，攒满后约等于真实帧率', () => {
    const monitor = new FrameMonitor({ warmupSeconds: 0 });
    monitor.push(1 / 60);
    expect(monitor.averageFps).toBe(0);
    feed(monitor, 1 / 48, 3);
    expect(monitor.averageFps).toBeCloseTo(48, 1);
  });

  it('reset 之后重新走 warmup，不会拿旧档位的帧接着算账', () => {
    const monitor = new FrameMonitor();
    feed(monitor, 1 / 10, 10);
    monitor.reset();
    expect(feed(monitor, 1 / 10, DEFAULT_FRAME_MONITOR_CONFIG.warmupSeconds * 0.8)).toBe(0);
    expect(monitor.averageFps).toBe(0);
  });
});
