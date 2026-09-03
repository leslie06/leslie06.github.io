import { describe, expect, it } from 'vitest';
import {
  GHOST_SAMPLE_RATE,
  GHOST_VERSION,
  GhostPlayback,
  GhostRecorder,
  GhostStore,
  decodeSamples,
  encodeSamples,
  ghostKey,
  type GhostSample,
  type GhostStorage,
} from './Ghost';

function memoryStorage(initial: Record<string, string> = {}): GhostStorage {
  const data = { ...initial };
  return {
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

/** 造一段"绕圈跑"的轨迹，数值范围和真实赛道差不多（半径 150m，34 m/s） */
function fakeLap(seconds = 60, rate = GHOST_SAMPLE_RATE): GhostSample[] {
  const out: GhostSample[] = [];
  const count = Math.round(seconds * rate);
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2;
    out.push({
      x: Math.cos(a) * 150,
      y: 8 + Math.sin(a * 3) * 4,
      z: Math.sin(a) * 150,
      // 不归一化：跑一圈朝向从 0 走到 2π，和 KartState.heading 一样
      heading: a,
    });
  }
  return out;
}

describe('编解码', () => {
  it('往返之后位置误差在 1cm 内、朝向在 0.001 弧度内', () => {
    const samples = fakeLap(10);
    const back = decodeSamples(encodeSamples(samples));
    expect(back).toHaveLength(samples.length);
    for (let i = 0; i < samples.length; i++) {
      expect(Math.abs(back[i]!.x - samples[i]!.x)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(back[i]!.y - samples[i]!.y)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(back[i]!.z - samples[i]!.z)).toBeLessThanOrEqual(0.005);
      expect(Math.abs(back[i]!.heading - samples[i]!.heading)).toBeLessThanOrEqual(0.0005);
    }
  });

  it('负坐标和倒着开也没问题（zigzag 的意义）', () => {
    const samples: GhostSample[] = [
      { x: -120.34, y: -3.5, z: -88.9, heading: -2.5 },
      { x: -121.5, y: -3.6, z: -90.1, heading: -2.7 },
      { x: -119.2, y: -3.4, z: -87.0, heading: -2.2 },
    ];
    const back = decodeSamples(encodeSamples(samples));
    for (let i = 0; i < samples.length; i++) {
      expect(back[i]!.x).toBeCloseTo(samples[i]!.x, 2);
      expect(back[i]!.heading).toBeCloseTo(samples[i]!.heading, 3);
    }
  });

  it('朝向绕好几圈也不会跳（存的是不归一化的值）', () => {
    const samples: GhostSample[] = [
      { x: 0, y: 0, z: 0, heading: 0 },
      { x: 1, y: 0, z: 0, heading: 6.28 },
      { x: 2, y: 0, z: 0, heading: 12.56 },
    ];
    const back = decodeSamples(encodeSamples(samples));
    expect(back[2]!.heading).toBeCloseTo(12.56, 2);
  });

  /**
   * 体积是这套编码存在的唯一理由，所以钉死：
   * 一圈 60 秒的轨迹压完（base64 之后）必须比同样内容的 JSON 小一大截。
   */
  it('一圈 60 秒压到 20KB 以内，比 JSON 小四倍以上', () => {
    const samples = fakeLap(60);
    const encoded = encodeSamples(samples);
    const asJson = JSON.stringify(samples);
    expect(encoded.length).toBeLessThan(20 * 1024);
    expect(encoded.length * 4).toBeLessThan(asJson.length);
  });

  it('空轨迹和坏数据都不抛', () => {
    expect(decodeSamples('')).toEqual([]);
    expect(decodeSamples('!!!not base64!!!')).toEqual([]);
    expect(encodeSamples([])).toBe('');
  });

  it('数据被截断时只丢尾巴，不抛', () => {
    const encoded = encodeSamples(fakeLap(2));
    const truncated = encoded.slice(0, Math.floor(encoded.length / 2));
    expect(() => decodeSamples(truncated)).not.toThrow();
  });
});

describe('GhostRecorder', () => {
  it('按固定间隔采样，掉帧时补齐（不然轨迹会被拉长）', () => {
    const recorder = new GhostRecorder(0.05);
    const sample = { x: 0, y: 0, z: 0, heading: 0 };
    recorder.push(0, sample); // 第一帧无条件采一个
    expect(recorder.length).toBe(1);
    // 一帧卡了 0.2 秒 = 4 个间隔，要补 4 个点
    recorder.push(0.2, sample);
    expect(recorder.length).toBe(5);
  });

  it('60fps 跑 1 秒得到大约 20 个点', () => {
    const recorder = new GhostRecorder();
    for (let i = 0; i < 60; i++) recorder.push(1 / 60, { x: i, y: 0, z: 0, heading: 0 });
    expect(recorder.length).toBeGreaterThanOrEqual(20);
    expect(recorder.length).toBeLessThanOrEqual(22);
  });

  it('reset 之后从头开始 —— 每过一次线都要调，否则几圈会连成一条', () => {
    const recorder = new GhostRecorder();
    for (let i = 0; i < 60; i++) recorder.push(1 / 60, { x: i, y: 0, z: 0, heading: 0 });
    recorder.reset();
    expect(recorder.length).toBe(0);
  });

  it('太短的轨迹不出录像（放出来只会是个抽搐的方块）', () => {
    const recorder = new GhostRecorder();
    recorder.push(0, { x: 0, y: 0, z: 0, heading: 0 });
    expect(recorder.finish(0.1)).toBe(null);
  });

  it('正常一圈出得来，采样间隔存在录像里', () => {
    const recorder = new GhostRecorder();
    for (let i = 0; i < 300; i++) recorder.push(1 / 60, { x: i * 0.5, y: 0, z: 0, heading: 0 });
    const recording = recorder.finish(5)!;
    expect(recording).not.toBe(null);
    expect(recording.version).toBe(GHOST_VERSION);
    expect(recording.lapTime).toBe(5);
    expect(recording.interval).toBeCloseTo(1 / GHOST_SAMPLE_RATE, 6);
  });
});

describe('GhostPlayback', () => {
  const recording = {
    version: GHOST_VERSION,
    lapTime: 3,
    interval: 1,
    data: encodeSamples([
      { x: 0, y: 0, z: 0, heading: 0 },
      { x: 10, y: 2, z: -10, heading: 1 },
      { x: 20, y: 4, z: -20, heading: 2 },
    ]),
  };

  it('两点之间线性插值', () => {
    const playback = new GhostPlayback(recording);
    const mid = playback.sampleAt(0.5);
    expect(mid.x).toBeCloseTo(5, 2);
    expect(mid.y).toBeCloseTo(1, 2);
    expect(mid.z).toBeCloseTo(-5, 2);
    expect(mid.heading).toBeCloseTo(0.5, 2);
  });

  it('落在采样点上时就是那个点', () => {
    const playback = new GhostPlayback(recording);
    expect(playback.sampleAt(1).x).toBeCloseTo(10, 2);
  });

  it('超出录像长度就停在终点（幽灵车已经冲线了）', () => {
    const playback = new GhostPlayback(recording);
    expect(playback.sampleAt(99).x).toBeCloseTo(20, 2);
    expect(playback.duration).toBeCloseTo(2, 6);
  });

  it('负时间取第一个点', () => {
    expect(new GhostPlayback(recording).sampleAt(-5).x).toBeCloseTo(0, 6);
  });

  it('坏数据时 valid 是 false，不会画出一辆抽搐的车', () => {
    const bad = new GhostPlayback({ version: GHOST_VERSION, lapTime: 1, interval: 1, data: '' });
    expect(bad.valid).toBe(false);
  });
});

describe('GhostStore', () => {
  const recording = (lapTime: number) => ({
    version: GHOST_VERSION,
    lapTime,
    interval: 1 / GHOST_SAMPLE_RATE,
    data: encodeSamples(fakeLap(2)),
  });

  it('存了能读回来，键按赛道分开', () => {
    const storage = memoryStorage();
    new GhostStore(storage, 'meadow').saveIfFaster(recording(80));
    expect(new GhostStore(storage, 'meadow').load()!.lapTime).toBe(80);
    // 另一条赛道读不到 —— 850m 和 1200m 的圈速没有可比性
    expect(new GhostStore(storage, 'ridge').load()).toBe(null);
    expect(ghostKey('meadow')).not.toBe(ghostKey('ridge'));
  });

  it('只在更快的时候覆盖', () => {
    const storage = memoryStorage();
    const store = new GhostStore(storage, 'meadow');
    expect(store.saveIfFaster(recording(80))).toBe(true);
    expect(store.saveIfFaster(recording(85))).toBe(false);
    expect(store.load()!.lapTime).toBe(80);
    expect(store.saveIfFaster(recording(70))).toBe(true);
    expect(store.load()!.lapTime).toBe(70);
  });

  it('版本对不上就当没有（幽灵车丢了不是大事）', () => {
    const storage = memoryStorage({
      [ghostKey('meadow')]: JSON.stringify({ ...recording(80), version: 999 }),
    });
    expect(new GhostStore(storage, 'meadow').load()).toBe(null);
  });

  it('坏 JSON / 缺字段 / 圈速非法都当没有', () => {
    for (const raw of [
      '{oops',
      JSON.stringify({ version: GHOST_VERSION, lapTime: 0, data: 'x', interval: 0.05 }),
      JSON.stringify({ version: GHOST_VERSION, lapTime: 10 }),
      JSON.stringify({ version: GHOST_VERSION, lapTime: 'fast', data: 'x' }),
    ]) {
      const storage = memoryStorage({ [ghostKey('meadow')]: raw });
      expect(new GhostStore(storage, 'meadow').load()).toBe(null);
    }
  });

  it('没有存储时不抛', () => {
    const store = new GhostStore(null, 'meadow');
    expect(store.load()).toBe(null);
    expect(() => store.saveIfFaster(recording(80))).not.toThrow();
    expect(() => store.clear()).not.toThrow();
  });

  it('配额满了写不进去，但不该崩', () => {
    const storage: GhostStorage = {
      getItem: () => null,
      setItem: () => {
        throw new Error('QuotaExceededError');
      },
      removeItem: () => {},
    };
    expect(new GhostStore(storage, 'meadow').saveIfFaster(recording(80))).toBe(false);
  });
});
