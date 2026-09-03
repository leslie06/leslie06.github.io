/**
 * 端到端：让 AI 在**真实赛道样条**上跑，验证"它真的能开完一圈"。
 *
 * 单点断言（直线不打方向、弯道打对方向）只能保证符号没写反；
 * 保证不了"沿着赛道能一路跑下去" —— 前瞻距离和转向增益配得不对的话，
 * 车会在弯里画龙、贴着护栏刮、或者干脆冲出去。那些只有跑起来才看得见。
 *
 * 这里不用 rapier：赛道地形查询在这个测试里退化成"样条上的横向偏移够不够小"，
 * 和 PhysicsSystem 的逻辑一致，只是把射线换成了中心线高度。
 */
import { describe, expect, it } from 'vitest';
import { TrackSpline } from '../track/TrackSpline';
import { SUNSET } from '../track/tracks/sunset';
import { DEFAULT_TRACK_CONFIG, drivableHalfWidth } from '../track/TrackConfig';
import { createGroundSample, type GroundSample } from '../kart/GroundSample';
import { cloneKartConfig } from '../kart/KartConfig';
import { RaceProgress } from '../race/RaceProgress';
import { RaceState } from '../race/RaceState';
import { DEFAULT_KART_COLLISION_CONFIG, resolveKartCollisions } from '../kart/kartCollision';
import { buildStartGrid } from '../race/StartGrid';
import { AIKart } from './AIKart';
import { personaAt, type AIDifficulty } from './AIProfiles';
import { createSplineSampler } from './SplineSampler';

const DT = 1 / 60;
const cfg = cloneKartConfig();
const trackCfg = DEFAULT_TRACK_CONFIG;
const halfWidth = drivableHalfWidth(trackCfg);

const spline = new TrackSpline(SUNSET.points, trackCfg.lutSamples);
const aiTrack = createSplineSampler(spline);
const grid = buildStartGrid(aiTrack, 8);

/** PhysicsSystem.sample 的无 rapier 版：地面高度直接取中心线高度 */
function sampleGround(x: number, z: number, respawnT: number, out: GroundSample): GroundSample {
  const p = spline.getProgress(x, z);
  out.onTrack = Math.abs(p.lateral) <= halfWidth;
  out.height = p.centerY;
  out.normalX = 0;
  out.normalY = 1;
  out.normalZ = 0;
  out.progress = p.t;
  out.lateral = p.lateral;
  out.halfWidth = halfWidth;
  const sign = p.lateral > 0 ? -1 : 1;
  out.toCenterX = Math.sin(p.heading - Math.PI / 2) * sign;
  out.toCenterZ = Math.cos(p.heading - Math.PI / 2) * sign;
  const rp = spline.getPointAt(respawnT);
  out.respawnX = rp.x;
  out.respawnY = rp.y;
  out.respawnZ = rp.z;
  out.respawnHeading = spline.getHeadingAt(respawnT);
  return out;
}

interface RunResult {
  laps: number;
  /** 全程横向偏移的最大绝对值 */
  maxLateral: number;
  /** 掉出赛道的帧数 */
  offTrackFrames: number;
  progress: RaceProgress;
  ai: AIKart;
}

/** 单独跑一辆 AI（没有玩家、没有橡皮筋），看它能不能自己开完。 */
function solo(difficulty: AIDifficulty, seconds: number, personaIndex = 6): RunResult {
  const slot = grid[0]!;
  const ai = new AIKart(
    { id: 'ai', persona: personaAt(personaIndex), difficulty, track: aiTrack },
    { x: slot.x, z: slot.z, y: spline.getPointAt(slot.t).y, heading: slot.heading },
  );
  ai.rubberbandEnabled = false;

  const progress = new RaceProgress({ startT: slot.t });
  const ground = createGroundSample();
  let maxLateral = 0;
  let offTrackFrames = 0;

  for (let i = 0; i < Math.round(seconds / DT); i++) {
    sampleGround(ai.current.x, ai.current.z, progress.getLastCheckpoint().t, ground);
    progress.update(ground.progress, DT);
    // deltaProgress 传 0：橡皮筋已经关掉，这里只是把参数填满
    ai.step(cfg, ground, false, 0, DT);
    maxLateral = Math.max(maxLateral, Math.abs(ground.lateral));
    if (!ground.onTrack) offTrackFrames++;
  }
  return { laps: progress.lap, maxLateral, offTrackFrames, progress, ai };
}

// 一圈大概 900m，normal 档均速 ~25 m/s，给 90 秒足够跑完两圈还有富余
const RUN_SECONDS = 90;

describe('AI 在真实赛道上开完整圈', () => {
  for (const difficulty of ['easy', 'normal', 'hard'] as const) {
    it(`${difficulty} 档能跑完至少一圈，而且圈是有效的（没漏 checkpoint）`, () => {
      const run = solo(difficulty, RUN_SECONDS);
      expect(run.laps).toBeGreaterThanOrEqual(1);
      expect(run.progress.bestLap).not.toBeNull();
    });

    it(`${difficulty} 档全程待在赛道上`, () => {
      const run = solo(difficulty, RUN_SECONDS);
      expect(run.offTrackFrames).toBe(0);
      // 护栏会把车拉回来，所以横向偏移最多刚好贴到可行驶边界
      expect(run.maxLateral).toBeLessThanOrEqual(halfWidth + 1e-6);
    });

    it(`${difficulty} 档不会卡住（全程保持在跑）`, () => {
      const run = solo(difficulty, 20);
      // 20 秒里至少推进 15% 的赛道，远低于任何一档的正常水平，
      // 只用来抓"撞墙顶死 / 原地打转"这类彻底卡住的情况
      expect(run.progress.totalProgress).toBeGreaterThan(0.15);
    });
  }

  it('难度越高跑得越快', () => {
    const easy = solo('easy', 40).progress.totalProgress;
    const normal = solo('normal', 40).progress.totalProgress;
    const hard = solo('hard', 40).progress.totalProgress;
    expect(normal).toBeGreaterThan(easy);
    expect(hard).toBeGreaterThan(normal);
  });

  it('normal / hard 会真的用上漂移蓄力', () => {
    for (const difficulty of ['normal', 'hard'] as const) {
      const slot = grid[0]!;
      const ai = new AIKart(
        { id: 'ai', persona: personaAt(6), difficulty, track: aiTrack },
        { x: slot.x, z: slot.z, y: spline.getPointAt(slot.t).y, heading: slot.heading },
      );
      ai.rubberbandEnabled = false;
      const progress = new RaceProgress({ startT: slot.t });
      const ground = createGroundSample();
      let boostFrames = 0;
      for (let i = 0; i < Math.round(60 / DT); i++) {
        sampleGround(ai.current.x, ai.current.z, progress.getLastCheckpoint().t, ground);
        progress.update(ground.progress, DT);
        ai.step(cfg, ground, false, 0, DT);
        if (ai.current.boostTime > 0) boostFrames++;
      }
      expect(boostFrames).toBeGreaterThan(0);
    }
  });

  it('easy 档全程不吃 mini-turbo', () => {
    const slot = grid[0]!;
    const ai = new AIKart(
      { id: 'ai', persona: personaAt(6), difficulty: 'easy', track: aiTrack },
      { x: slot.x, z: slot.z, y: spline.getPointAt(slot.t).y, heading: slot.heading },
    );
    ai.rubberbandEnabled = false;
    const progress = new RaceProgress({ startT: slot.t });
    const ground = createGroundSample();
    for (let i = 0; i < Math.round(60 / DT); i++) {
      sampleGround(ai.current.x, ai.current.z, progress.getLastCheckpoint().t, ground);
      progress.update(ground.progress, DT);
      ai.step(cfg, ground, false, 0, DT);
      expect(ai.current.boostTime).toBe(0);
    }
  });
});

describe('AIKart 的配置副本', () => {
  it('AI 用的是玩家那份配置的数值，只有 maxSpeed 不同', () => {
    const slot = grid[0]!;
    const ai = new AIKart(
      { id: 'ai', persona: personaAt(0), difficulty: 'normal', track: aiTrack },
      { x: slot.x, z: slot.z, heading: slot.heading },
    );
    const ground = createGroundSample();
    sampleGround(ai.current.x, ai.current.z, 0, ground);
    ai.step(cfg, ground, false, 0, DT);

    expect(ai.config.turnRate).toBe(cfg.turnRate);
    expect(ai.config.engineAccel).toBe(cfg.engineAccel);
    expect(ai.config.driftTurnRate).toBe(cfg.driftTurnRate);
    expect(ai.config.maxSpeed).toBeCloseTo(cfg.maxSpeed * ai.effectiveSpeedMul, 9);
  });

  it('改玩家的配置，AI 下一步就跟着变；改 AI 的副本不会污染玩家的', () => {
    const slot = grid[0]!;
    const ai = new AIKart(
      { id: 'ai', persona: personaAt(0), difficulty: 'normal', track: aiTrack },
      { x: slot.x, z: slot.z, heading: slot.heading },
    );
    const ground = createGroundSample();
    sampleGround(ai.current.x, ai.current.z, 0, ground);

    const live = cloneKartConfig();
    live.turnRate = 4.2;
    live.chargeThresholds[0] = 0.11;
    ai.step(live, ground, false, 0, DT);
    expect(ai.config.turnRate).toBe(4.2);
    expect(ai.config.chargeThresholds[0]).toBe(0.11);

    // 三档数组必须是各自的对象，不能共享引用
    expect(ai.config.chargeThresholds).not.toBe(live.chargeThresholds);
    ai.config.chargeThresholds[1] = 99;
    expect(live.chargeThresholds[1]).not.toBe(99);
  });

  it('橡皮筋只动这辆 AI 的 maxSpeed，不碰玩家的配置', () => {
    const slot = grid[0]!;
    const ai = new AIKart(
      { id: 'ai', persona: personaAt(0), difficulty: 'normal', track: aiTrack },
      { x: slot.x, z: slot.z, heading: slot.heading },
    );
    const ground = createGroundSample();
    const before = cfg.maxSpeed;
    for (let i = 0; i < 600; i++) {
      sampleGround(ai.current.x, ai.current.z, 0, ground);
      ai.step(cfg, ground, false, -1, DT); // 一直落后一整圈
    }
    expect(cfg.maxSpeed).toBe(before);
    expect(ai.rubberband.multiplier).toBeGreaterThan(1);
    expect(ai.config.maxSpeed).toBeGreaterThan(before * ai.baseSpeedMul);
  });

  it('被锁住输入时不动，也不会攒脱困计时器', () => {
    const slot = grid[0]!;
    const ai = new AIKart(
      { id: 'ai', persona: personaAt(0), difficulty: 'normal', track: aiTrack },
      { x: slot.x, z: slot.z, y: spline.getPointAt(slot.t).y, heading: slot.heading },
    );
    const ground = createGroundSample();
    // 倒计时 3 秒
    for (let i = 0; i < 180; i++) {
      sampleGround(ai.current.x, ai.current.z, 0, ground);
      ai.step(cfg, ground, true, 0, DT);
    }
    expect(ai.current.speed).toBe(0);
    // 放行后第一帧就该踩油门，而不是倒车脱困
    sampleGround(ai.current.x, ai.current.z, 0, ground);
    ai.step(cfg, ground, false, 0, DT);
    expect(ai.current.speed).toBeGreaterThan(0);
  });
});

/**
 * 满场跑一局。玩家那一格也交给 AI 开（当替身），这样整局可以无人值守跑完。
 *
 * 这一段覆盖的是单车测试覆盖不到的东西：车车碰撞会不会把谁卡死 / 顶出赛道、
 * 名次排序在八辆车缠斗时对不对、以及橡皮筋开着的时候整局会不会跑飞。
 */
describe('满场 8 车整局', () => {
  interface Field {
    race: RaceState;
    karts: AIKart[];
    seconds: number;
  }

  function runFullField(maxSeconds: number): Field {
    const count = 8;
    const slots = buildStartGrid(aiTrack, count);
    const karts = slots.map(
      (slot, i) =>
        new AIKart(
          { id: `k${i}`, persona: personaAt(i), difficulty: 'normal', track: aiTrack },
          { x: slot.x, z: slot.z, y: spline.getPointAt(slot.t).y, heading: slot.heading },
        ),
    );
    // 0 号车当"玩家"：橡皮筋是相对它算的
    const race = new RaceState(
      karts.map((k, i) => ({ id: k.id, name: k.id, isPlayer: i === 0, startT: slots[i]!.t })),
    );
    const grounds = karts.map(() => createGroundSample());
    const positions: Record<string, number> = {};
    const bodies = karts.map((k) => k.current);

    let seconds = 0;
    for (let step = 0; step < Math.round(maxSeconds / DT); step++) {
      for (let i = 0; i < karts.length; i++) {
        const k = karts[i]!;
        const g = grounds[i]!;
        sampleGround(k.current.x, k.current.z, race.getProgress(k.id)!.getLastCheckpoint().t, g);
        positions[k.id] = g.progress;
      }
      race.update(DT, positions);

      const playerTotal = race.getProgress(karts[0]!.id)!.totalProgress;
      for (let i = 0; i < karts.length; i++) {
        const k = karts[i]!;
        const delta = race.getProgress(k.id)!.totalProgress - playerTotal;
        k.step(cfg, grounds[i]!, race.isInputLocked(k.id), delta, DT);
        bodies[i] = k.current;
      }
      resolveKartCollisions(bodies, DEFAULT_KART_COLLISION_CONFIG, DT);

      seconds += DT;
      if (race.phase === 'finished') break;
    }
    return { race, karts, seconds };
  }

  // 3 圈 × ~900m，均速 22 m/s 左右 -> 单圈 40 秒上下。留足余量
  const field = runFullField(400);

  it('比赛能自己跑完（玩家替身冲线，进入 finished）', () => {
    expect(field.race.phase).toBe('finished');
    expect(field.seconds).toBeLessThan(400);
  });

  it('冠军跑满 3 圈；其余车没被落下一整圈（橡皮筋把队形收着）', () => {
    // 比赛在"玩家"（0 号替身）冲线时就进入 finished，后面的车还在路上 ——
    // 这是对的，结算面板出来的时候 AI 本来就还在跑
    const winner = field.race.standings[0]!;
    expect(winner.finished).toBe(true);
    expect(field.race.getProgress(winner.id)!.lap).toBeGreaterThanOrEqual(3);

    const best = winner.totalProgress;
    for (const kart of field.karts) {
      const total = field.race.getProgress(kart.id)!.totalProgress;
      expect(total).toBeGreaterThan(best - 1);
    }
  });

  it('没有车被挤出赛道或卡在护栏上', () => {
    for (const kart of field.karts) {
      const p = spline.getProgress(kart.current.x, kart.current.z);
      expect(Math.abs(p.lateral)).toBeLessThanOrEqual(halfWidth + 1e-6);
      expect(kart.current.airborne).toBe(false);
    }
  });

  it('名次表是 1..8 的一个排列，且和 totalProgress 的顺序一致', () => {
    const standings = field.race.standings;
    expect(standings.map((s) => s.place)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(new Set(standings.map((s) => s.id)).size).toBe(8);
    for (let i = 1; i < standings.length; i++) {
      const a = standings[i - 1]!;
      const b = standings[i]!;
      // 已冲线的按冲线顺序排前面；都没冲线（不会发生）才比进度
      if (!a.finished && !b.finished) {
        expect(a.totalProgress).toBeGreaterThanOrEqual(b.totalProgress);
      }
    }
  });

  it('圈速都在合理范围内（没有谁靠抄近道跑出神仙圈速）', () => {
    for (const kart of field.karts) {
      const best = field.race.getProgress(kart.id)!.bestLap;
      expect(best).not.toBeNull();
      expect(best!).toBeGreaterThan(20);
      expect(best!).toBeLessThan(120);
    }
  });
});
