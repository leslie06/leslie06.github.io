import { describe, expect, it } from 'vitest';
import { footCurve, gaitFor, hipsCurve, phaseRate, springStep, damp, dampAngle, wrap01 } from './Gait';
import { astar, bridgeCandidates, coverPrescore, coverScore, labelComponents, nearestNode, pickWhisker, planPath, ringSamples, separation, type NavNode } from './Nav';
import { burstLength, bulletDamage, hitIntentChance, shotOffset } from './Accuracy';
import { ACCURACY, ANIM } from './EnemyDefs';

describe('gait', () => {
  it('planted foot moves backwards at exactly body speed during stance', () => {
    for (const speed of [1.2, 2.5, 4.6]) {
      const g = gaitFor(speed, 0);
      const rate = phaseRate(speed, g);
      const dt = 1 / 240;
      // sample inside the stance window
      const a = footCurve(0.1, g), b = footCurve(0.1 + rate * dt, g);
      const v = (b.forward - a.forward) / dt;
      expect(v).toBeCloseTo(-speed, 2);
      expect(a.planted).toBe(1);
      expect(a.up).toBe(0);
    }
  });
  it('swing foot lifts and returns forward', () => {
    const g = gaitFor(4, 0);
    const mid = footCurve(g.stanceFrac + (1 - g.stanceFrac) / 2, g);
    expect(mid.up).toBeCloseTo(g.lift, 5);
    expect(mid.planted).toBe(0);
    const end = footCurve(0.9999, g), start = footCurve(0, g);
    expect(Math.abs(end.forward - start.forward)).toBeLessThan(0.01);
  });
  it('gait params blend monotonically with speed and crouch shortens stride', () => {
    expect(gaitFor(1, 0).stride).toBeLessThan(gaitFor(4.5, 0).stride);
    expect(gaitFor(4.5, 0).stride).toBeCloseTo(ANIM.runStride, 3);
    expect(gaitFor(2, 1).stride).toBeLessThan(gaitFor(2, 0).stride);
  });
  it('hips bob twice per cycle and is zero when idle', () => {
    const g = gaitFor(3, 0);
    expect(hipsCurve(0, g, 0).bob).toBeCloseTo(0, 9);
    const h0 = hipsCurve(0, g, 1).bob, h25 = hipsCurve(0.25, g, 1).bob, h5 = hipsCurve(0.5, g, 1).bob;
    expect(h0).toBeCloseTo(h5, 6);
    expect(h25).toBeGreaterThan(h0);
  });
  it('spring and damp converge', () => {
    let x = 1, v = 0;
    for (let i = 0; i < 300; i++) [x, v] = springStep(x, v, 0, 8, 1 / 60);
    expect(Math.abs(x)).toBeLessThan(1e-3);
    let d = 0; for (let i = 0; i < 120; i++) d = damp(d, 1, 10, 1 / 60);
    expect(d).toBeGreaterThan(0.99);
    expect(dampAngle(3.1, -3.1, 1000, 1)).toBeCloseTo(3.1 + 0.083, 1);
    expect(wrap01(1.25)).toBeCloseTo(0.25);
    expect(wrap01(-0.25)).toBeCloseTo(0.75);
  });
});

describe('nav', () => {
  const grid: NavNode[] = [];
  const W = 5;
  for (let z = 0; z < W; z++) for (let x = 0; x < W; x++) {
    const links: number[] = [];
    if (x > 0) links.push(z * W + x - 1); if (x < W - 1) links.push(z * W + x + 1);
    if (z > 0) links.push((z - 1) * W + x); if (z < W - 1) links.push((z + 1) * W + x);
    grid.push({ p: [x * 2, 0, z * 2], links });
  }
  it('A* finds a shortest manhattan path on a grid', () => {
    const path = astar(grid, 0, W * W - 1)!;
    expect(path[0]).toBe(0); expect(path[path.length - 1]).toBe(W * W - 1);
    expect(path.length).toBe(2 * (W - 1) + 1);
  });
  it('A* routes around a wall of removed links', () => {
    const g = grid.map((n) => ({ p: n.p, links: [...n.links] }));
    // block column x=2 except z=4
    for (let z = 0; z < W - 1; z++) { const id = z * W + 2; for (const n of g) n.links = n.links.filter((l) => l !== id); g[id].links = []; }
    const path = astar(g, 0, 4)!;
    expect(path).not.toBeNull();
    expect(path.some((i) => i === 4 * W + 2)).toBe(true);
    expect(path.every((i) => !(i % W === 2 && Math.floor(i / W) < 4))).toBe(true);
  });
  it('A* returns null when unreachable and honours penalties', () => {
    const g: NavNode[] = [{ p: [0, 0, 0], links: [] }, { p: [1, 0, 0], links: [] }];
    expect(astar(g, 0, 1)).toBeNull();
    const tri: NavNode[] = [{ p: [0, 0, 0], links: [1, 2] }, { p: [1, 0, 0], links: [0, 3] }, { p: [0, 0, 1.2], links: [0, 3] }, { p: [1, 0, 1], links: [1, 2] }];
    expect(astar(tri, 0, 3)).toEqual([0, 1, 3]);
    expect(astar(tri, 0, 3, (i) => (i === 1 ? 10 : 0))).toEqual([0, 2, 3]);
  });
  it('planPath falls back to a straight segment without a graph and drops a node behind us', () => {
    expect(planPath([], [0, 0, 0], [5, 0, 5])).toEqual([[5, 0, 5]]);
    const p = planPath(grid, [1.5, 0, 0], [8, 0, 0]);
    expect(p[0]).toEqual([2, 0, 0]);
    expect(p[p.length - 1]).toEqual([8, 0, 0]);
  });
  it('helpers: nearest node, whiskers, separation, ring, cover score', () => {
    expect(nearestNode(grid, [3.9, 0, 0.1])).toBe(2);
    expect(nearestNode([], [0, 0, 0])).toBe(-1);
    expect(pickWhisker([0, 0.5, -0.5], [0.5, 2, 2], 2)).toBe(0.5);
    expect(pickWhisker([0, 0.5, -0.5], [0.5, 1, 1.5], 2)).toBe(-0.5);
    const [sx, sz] = separation([0, 0, 0], [[0.5, 0, 0], [0, 0, -0.5]], 1.4);
    expect(sx).toBeLessThan(0); expect(sz).toBeGreaterThan(0);
    expect(ringSamples([0, 0, 0], [3, 5], 8).length).toBe(16);
    const hidden = coverScore([5, 0, 0], [0, 0, 0], [15, 0, 0], true, true, 7, 18, false);
    expect(hidden).toBeGreaterThan(coverScore([5, 0, 0], [0, 0, 0], [15, 0, 0], true, false, 7, 18, false));
    expect(coverScore([5, 0, 0], [0, 0, 0], [15, 0, 0], false, true, 7, 18, false)).toBe(-Infinity);
    expect(coverScore([5, 0, 0], [0, 0, 0], [15, 0, 0], true, true, 7, 18, true)).toBe(-Infinity);
  });

  it('coverPrescore bounds coverScore from above and leans toward the near edge of the band', () => {
    const me: [number, number, number] = [0, 0, 0], player: [number, number, number] = [30, 0, 0];
    // it is the ray-free half of the real score, so score = prescore + the peek term
    for (const c of [[10, 0, 0], [18, 0, 0], [24, 0, 0]] as [number, number, number][]) {
      expect(coverScore(c, me, player, true, true, 7, 18, false)).toBeCloseTo(coverPrescore(c, me, player, 7, 18) + 4, 9);
      expect(coverPrescore(c, me, player, 7, 18) + 4).toBeGreaterThan(coverScore(c, me, player, true, false, 7, 18, false));
    }
    // inside the band, equal walking distance, the one closer to the player wins
    const stand: [number, number, number] = [15, 0, 0];
    const near = coverPrescore([18, 0, 0], stand, player, 7, 18);  // 3 m walk, 12 m standoff
    const far = coverPrescore([12, 0, 0], stand, player, 7, 18);   // 3 m walk, 18 m standoff
    expect(near).toBeGreaterThan(far);
    // but walking distance still has a say: 15 m of ground is not worth 6 m of standoff
    expect(coverPrescore([12, 0, 0], stand, player, 7, 18)).toBeGreaterThan(coverPrescore([18, 0, 15], stand, player, 7, 18));
    // and the band is still the dominant term: nothing outside it beats something inside it
    expect(coverPrescore([16, 0, 0], me, player, 7, 18)).toBeGreaterThan(coverPrescore([0, 0, 0], me, player, 7, 18));
  });
});

describe('nav island stitching', () => {
  /** Two 3-node rows on the same y, `gap` metres apart in x, linked only within each row. */
  const twoIslands = (gap: number, rise = 0): NavNode[] => {
    const n: NavNode[] = [
      { p: [0, 0, 0], links: [1] }, { p: [0, 0, 2], links: [0, 2] }, { p: [0, 0, 4], links: [1] },
      { p: [gap, rise, 0], links: [4] }, { p: [gap, rise, 2], links: [3, 5] }, { p: [gap, rise, 4], links: [4] },
    ];
    labelComponents(n);
    return n;
  };

  it('offers the shortest crossings between two islands and nothing within one', () => {
    const nodes = twoIslands(5);
    const pairs = bridgeCandidates(nodes, 9, 1.2, 3);
    expect(pairs.length).toBe(3);                       // capped at perPair
    for (const [i, j] of pairs) expect(nodes[i].comp).not.toBe(nodes[j].comp);
    // shortest first: the three straight-across crossings (5 m) beat the diagonals
    expect(pairs.slice(0, 3).every(([i, j]) => Math.abs(nodes[i].p[2] - nodes[j].p[2]) < 1e-9)).toBe(true);
  });

  it('respects the gap and rise limits, and finds nothing once the islands are one component', () => {
    expect(bridgeCandidates(twoIslands(12), 9, 1.2)).toEqual([]);
    expect(bridgeCandidates(twoIslands(5, 3), 9, 1.2)).toEqual([]);
    const joined = twoIslands(5);
    (joined[1].links as number[]).push(4); (joined[4].links as number[]).push(1);
    labelComponents(joined);
    expect(bridgeCandidates(joined, 9, 1.2)).toEqual([]);
  });

  it('a stitched link makes a previously unreachable goal reachable', () => {
    const nodes = twoIslands(5);
    expect(astar(nodes, 0, 5)).toBeNull();
    const [i, j] = bridgeCandidates(nodes, 9, 1.2, 1)[0];
    (nodes[i].links as number[]).push(j); (nodes[j].links as number[]).push(i);
    labelComponents(nodes);
    expect(astar(nodes, 0, 5)).not.toBeNull();
    expect(new Set(nodes.map((n) => n.comp)).size).toBe(1);
  });
});

describe('accuracy', () => {
  const base = { distance: 10, timeOnTarget: 0, shooterMoving: false, targetSprinting: false, targetCrouching: false, accuracyMul: 1 };
  it('rises with time on target and decays with distance', () => {
    const c0 = hitIntentChance(base), c2 = hitIntentChance({ ...base, timeOnTarget: 5 });
    expect(c0).toBeCloseTo(ACCURACY.baseHitChance * (1 - (10 / ACCURACY.farDist) * (1 - ACCURACY.farFrac)), 3);
    expect(c2).toBeGreaterThan(c0);
    expect(hitIntentChance({ ...base, distance: 40 })).toBeLessThan(c0);
    expect(hitIntentChance({ ...base, shooterMoving: true })).toBeLessThan(c0);
    expect(hitIntentChance({ ...base, timeOnTarget: 9, accuracyMul: 50 })).toBeLessThanOrEqual(0.97);
  });
  it('shotOffset is aimed below the chance threshold and misses near the target above it', () => {
    const c = hitIntentChance(base);
    expect(shotOffset(base, c - 0.001, 0, 0, 0).aimed).toBe(true);
    const miss = shotOffset(base, c + 0.001, 0.5, 0.25, 0.5);
    expect(miss.aimed).toBe(false);
    expect(Math.hypot(miss.missX, miss.missY)).toBeGreaterThan(ACCURACY.missRadiusMin * 0.4);
    expect(Math.hypot(miss.missX, miss.missY)).toBeLessThan(ACCURACY.missRadiusMax + 0.2);
  });
  it('burst length grows when close, damage falls off with distance', () => {
    expect(burstLength(3, 6, 5, 0.5)).toBeGreaterThanOrEqual(burstLength(3, 6, 40, 0.5));
    expect(burstLength(3, 6, 60, 0)).toBe(3);
    expect(bulletDamage(7, 12, 0, 1, 1)).toBe(12);
    expect(bulletDamage(7, 12, 80, 1, 1)).toBeLessThan(12);
    expect(bulletDamage(7, 12, 0, 0, 2)).toBe(14);
  });
});
