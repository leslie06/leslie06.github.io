import { describe, expect, it, vi } from 'vitest';
import { LoadProgress, type LoadSnapshot } from './LoadProgress';

const TASKS = [
  { id: 'physics', label: '编译物理引擎', weight: 3 },
  { id: 'assets', label: '下载赛道资源', weight: 1 },
];

describe('LoadProgress', () => {
  it('按权重算总进度，不是按任务个数', () => {
    const p = new LoadProgress(TASKS);
    p.complete('assets');
    expect(p.snapshot().ratio).toBeCloseTo(0.25, 6);
    p.complete('physics');
    expect(p.snapshot().ratio).toBe(1);
  });

  it('全做完才算 done', () => {
    const p = new LoadProgress(TASKS);
    p.complete('physics');
    expect(p.snapshot().done).toBe(false);
    p.complete('assets');
    expect(p.snapshot().done).toBe(true);
  });

  it('label 是第一个没做完的任务', () => {
    const p = new LoadProgress(TASKS);
    expect(p.snapshot().label).toBe('编译物理引擎');
    p.complete('physics');
    expect(p.snapshot().label).toBe('下载赛道资源');
  });

  it('进度只许往前，不倒退', () => {
    const p = new LoadProgress(TASKS);
    p.set('physics', 0.8);
    p.set('physics', 0.2);
    expect(p.snapshot().ratio).toBeCloseTo(0.6, 6);
  });

  it('超出 0..1 的值被夹住，未知 id 忽略', () => {
    const p = new LoadProgress(TASKS);
    p.set('physics', 5);
    p.set('nope', 1);
    expect(p.snapshot().ratio).toBeCloseTo(0.75, 6);
  });

  it('每次变化都回调一次，构造时也报一次初始状态', () => {
    const seen: LoadSnapshot[] = [];
    const p = new LoadProgress(TASKS, (s) => seen.push(s));
    expect(seen).toHaveLength(1);
    expect(seen[0]!.ratio).toBe(0);
    p.complete('assets');
    expect(seen).toHaveLength(2);
  });

  it('没有任务时不会除以 0', () => {
    const p = new LoadProgress([], vi.fn());
    expect(p.snapshot().ratio).toBe(0);
  });
});
