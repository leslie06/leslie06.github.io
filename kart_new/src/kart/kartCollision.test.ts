import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_KART_COLLISION_CONFIG as CFG,
  resolveKartCollisions,
} from './kartCollision';
import { createKartState, type KartState } from './kartStep';

const DT = 1 / 60;

function at(x: number, z: number, speed = 20, y = 0): KartState {
  const s = createKartState(x, z);
  s.speed = speed;
  s.y = y;
  return s;
}

const dist = (a: KartState, b: KartState): number => Math.hypot(a.x - b.x, a.z - b.z);

describe('架构约束', () => {
  it('kartCollision.ts 不 import three / rapier', () => {
    const src = readFileSync(new URL('./kartCollision.ts', import.meta.url), 'utf8');
    const imports = [...src.matchAll(/from\s+['"]([^'"]+)['"]/g)].map((m) => m[1]!);
    for (const spec of imports) {
      expect(spec).not.toMatch(/three|rapier/i);
      expect(spec.startsWith('.')).toBe(true);
    }
  });
});

describe('分离', () => {
  it('没重叠就什么都不做', () => {
    const a = at(0, 0);
    const b = at(0, 10);
    expect(resolveKartCollisions([a, b], CFG, DT)).toBe(0);
    expect(a.x).toBe(0);
    expect(b.z).toBe(10);
    expect(a.speed).toBe(20);
  });

  it('重叠时两车沿连线互相推开', () => {
    const a = at(0, 0);
    const b = at(1.0, 0); // 间距 1.0 < 2*radius = 2.2
    const before = dist(a, b);
    expect(resolveKartCollisions([a, b], CFG, DT)).toBe(1);
    expect(dist(a, b)).toBeGreaterThan(before);
    // 沿连线（x 轴）推，z 不该动
    expect(a.z).toBe(0);
    expect(b.z).toBe(0);
    expect(a.x).toBeLessThan(0);
    expect(b.x).toBeGreaterThan(1.0);
  });

  it('推力对半分，质心不动', () => {
    const a = at(0, 0);
    const b = at(1.0, 0);
    resolveKartCollisions([a, b], CFG, DT);
    expect((a.x + b.x) / 2).toBeCloseTo(0.5, 9);
  });

  it('连续几帧之后会分开到不再重叠', () => {
    const a = at(0, 0);
    const b = at(0.6, 0);
    for (let i = 0; i < 240; i++) resolveKartCollisions([a, b], CFG, DT);
    expect(dist(a, b)).toBeGreaterThan(CFG.radius * 2 - 1e-6);
  });

  it('不会一帧推过头（不弹开）', () => {
    const a = at(0, 0);
    const b = at(0.1, 0);
    resolveKartCollisions([a, b], CFG, DT);
    // 单帧位移不超过整个重叠量，更不该把两车推到超出接触距离
    expect(dist(a, b)).toBeLessThanOrEqual(CFG.radius * 2);
  });

  it('完全重合也能掰开，而且是确定性的', () => {
    const run = () => {
      const a = at(5, 5);
      const b = at(5, 5);
      resolveKartCollisions([a, b], CFG, DT);
      return [a.x, a.z, b.x, b.z];
    };
    expect(dist(at(5, 5), at(5, 5))).toBe(0);
    const first = run();
    expect(first).toEqual(run());
    expect(first[0]).not.toBe(first[2]);
  });
});

describe('减速与守卫', () => {
  it('接触时双方都轻微掉速，但不会掉到反向', () => {
    const a = at(0, 0, 20);
    const b = at(1.0, 0, 20);
    resolveKartCollisions([a, b], CFG, DT);
    expect(a.speed).toBeLessThan(20);
    expect(b.speed).toBeLessThan(20);
    expect(a.speed).toBeGreaterThan(19);

    const slow = at(0, 0, 0.01);
    const slow2 = at(1.0, 0, -0.01);
    resolveKartCollisions([slow, slow2], CFG, DT);
    expect(slow.speed).toBe(0);
    expect(slow2.speed).toBe(0);
  });

  it('不改 heading —— 被撞一下不该像被抢了方向盘', () => {
    const a = at(0, 0);
    const b = at(1.0, 0);
    a.heading = 1.23;
    b.heading = -0.5;
    resolveKartCollisions([a, b], CFG, DT);
    expect(a.heading).toBe(1.23);
    expect(b.heading).toBe(-0.5);
  });

  it('高度差太大就不算碰撞（立体交叉的上下两层路）', () => {
    const a = at(0, 0, 20, 0);
    const b = at(0.5, 0, 20, CFG.maxHeightDiff + 1);
    expect(resolveKartCollisions([a, b], CFG, DT)).toBe(0);
    expect(a.x).toBe(0);
  });

  it('dt <= 0 或不足两辆车时是空操作', () => {
    const a = at(0, 0);
    const b = at(1.0, 0);
    expect(resolveKartCollisions([a, b], CFG, 0)).toBe(0);
    expect(a.x).toBe(0);
    expect(resolveKartCollisions([a], CFG, DT)).toBe(0);
    expect(resolveKartCollisions([], CFG, DT)).toBe(0);
  });

  it('三车挤在一起时每一对都处理到', () => {
    const karts = [at(0, 0), at(1.0, 0), at(0.5, 0.8)];
    expect(resolveKartCollisions(karts, CFG, DT)).toBe(3);
    for (let i = 0; i < 600; i++) resolveKartCollisions(karts, CFG, DT);
    for (let i = 0; i < karts.length; i++) {
      for (let j = i + 1; j < karts.length; j++) {
        expect(dist(karts[i]!, karts[j]!)).toBeGreaterThan(CFG.radius * 2 - 1e-3);
      }
    }
  });
});
