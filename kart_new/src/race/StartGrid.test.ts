import { describe, expect, it } from 'vitest';
import { buildStartGrid, DEFAULT_START_GRID_OPTIONS } from './StartGrid';
import type { AITrack } from '../ai/AITrack';

/** 沿 +z 的闭合直线（当成一条很长的环）。够用来验格子的排布规则 */
const track: AITrack = {
  length: 800,
  sampleAt(t, out) {
    out.x = 0;
    out.z = ((t % 1) + 1) % 1 * 800;
    out.heading = 0;
    return out;
  },
};

describe('发车格', () => {
  it('全部排在起点线之后（t > 0），名次从第一帧起就是对的', () => {
    for (const slot of buildStartGrid(track, 8)) {
      expect(slot.t).toBeGreaterThan(0);
      // 整条 800m 的赛道，八个格子只占最前面一小段
      expect(slot.t).toBeLessThan(0.1);
    }
  });

  it('杆位离起点线最远，序号越大越靠后', () => {
    const grid = buildStartGrid(track, 8);
    for (let i = 2; i < grid.length; i += 2) {
      // 同排两辆 t 相同，隔一排才比
      expect(grid[i]!.t).toBeLessThan(grid[i - 2]!.t);
    }
    expect(grid[0]!.t).toBeGreaterThan(grid[7]!.t);
  });

  it('两辆一排，左右分开，排间距按 rowSpacing', () => {
    const grid = buildStartGrid(track, 8);
    expect(grid[0]!.lateral).toBeCloseTo(-DEFAULT_START_GRID_OPTIONS.columnOffset, 9);
    expect(grid[1]!.lateral).toBeCloseTo(DEFAULT_START_GRID_OPTIONS.columnOffset, 9);
    expect(grid[0]!.t).toBeCloseTo(grid[1]!.t, 12);

    const rowGap = (grid[0]!.t - grid[2]!.t) * track.length;
    expect(rowGap).toBeCloseTo(DEFAULT_START_GRID_OPTIONS.rowSpacing, 6);
  });

  it('最后一排离起点线留了余量，抖一下不会退回线外', () => {
    const grid = buildStartGrid(track, 8);
    const last = grid[grid.length - 1]!;
    expect(last.t * track.length).toBeCloseTo(DEFAULT_START_GRID_OPTIONS.lineMargin, 6);
  });

  it('朝向就是该处的赛道切线，坐标已经带上横向偏移', () => {
    const grid = buildStartGrid(track, 4);
    for (const slot of grid) {
      expect(slot.heading).toBe(0);
      // heading = 0 时"右"是 -x，所以 lateral 正的格子在 -x 侧
      expect(slot.x).toBeCloseTo(-slot.lateral, 9);
      expect(slot.z).toBeCloseTo(slot.t * track.length, 6);
    }
  });

  it('单列时居中', () => {
    for (const slot of buildStartGrid(track, 3, { columns: 1 })) {
      expect(slot.lateral).toBe(0);
    }
  });

  it('格子数就是要的车数', () => {
    for (const n of [1, 2, 5, 8, 12]) {
      expect(buildStartGrid(track, n)).toHaveLength(n);
    }
  });
});
