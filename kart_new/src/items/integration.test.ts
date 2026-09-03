/**
 * 端到端：八辆 AI 在真实赛道上跑一整局，道具系统全开。
 *
 * 单元测试能证明每块零件对，证明不了它们接起来还对。这里要抓的是接线问题：
 * 箱子摆的位置车到底压不压得到、AI 会不会真的把道具丢出去、
 * boost 写进的是不是这一帧的状态对象（写错对象的话吃了等于没吃）、
 * 效果有没有真的传到 stepKart 用的那份 config 上。
 */
import { describe, expect, it } from 'vitest';
import { TrackSpline } from '../track/TrackSpline';
import { DEFAULT_TRACK_CONFIG, drivableHalfWidth, ITEM_BOX_ROWS } from '../track/TrackConfig';
import { createGroundSample, type GroundSample } from '../kart/GroundSample';
import { cloneKartConfig } from '../kart/KartConfig';
import { RaceState } from '../race/RaceState';
import { buildStartGrid } from '../race/StartGrid';
import { DEFAULT_KART_COLLISION_CONFIG, resolveKartCollisions } from '../kart/kartCollision';
import { AIKart } from '../ai/AIKart';
import { personaAt } from '../ai/AIProfiles';
import { createSplineSampler } from '../ai/SplineSampler';
import { ItemBoxField } from './ItemBoxes';
import { ITEM_DEFS, type ItemId } from './ItemDefs';
import { ItemSystem, type ItemEvent, type ItemKart } from './ItemSystem';

const DT = 1 / 60;
const cfg = cloneKartConfig();
const tc = DEFAULT_TRACK_CONFIG;
const halfWidth = drivableHalfWidth(tc);
const spline = new TrackSpline(undefined, tc.lutSamples);
const aiTrack = createSplineSampler(spline);

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

/** ITEM_BOX_ROWS -> 世界坐标，和 main.ts 里那段是同一套换算 */
function boxPlacements() {
  return ITEM_BOX_ROWS.flatMap((row) => {
    const center = spline.getPointAt(row.t);
    const heading = spline.getHeadingAt(row.t);
    const rx = Math.sin(heading - Math.PI / 2);
    const rz = Math.cos(heading - Math.PI / 2);
    return row.lanes.map((lateral) => ({
      x: center.x + rx * lateral,
      y: center.y,
      z: center.z + rz * lateral,
    }));
  });
}

interface RunResult {
  events: ItemEvent[];
  race: RaceState;
  karts: AIKart[];
  items: ItemSystem;
  maxLateral: number;
  /** 各车吃到 boost 的帧数 */
  boostFrames: Map<string, number>;
}

function runField(seconds: number): RunResult {
  const count = 8;
  const slots = buildStartGrid(aiTrack, count);
  const karts = slots.map(
    (slot, i) =>
      new AIKart(
        { id: `k${i}`, persona: personaAt(i), difficulty: 'normal', track: aiTrack, seed: i + 1 },
        { x: slot.x, z: slot.z, y: spline.getPointAt(slot.t).y, heading: slot.heading },
      ),
  );
  const race = new RaceState(
    karts.map((k, i) => ({ id: k.id, name: k.id, isPlayer: i === 0, startT: slots[i]!.t })),
  );
  const items = new ItemSystem(aiTrack, new ItemBoxField(boxPlacements()), { seed: 99 });
  for (const k of karts) items.register(k.id);

  const grounds = karts.map(() => createGroundSample());
  const positions: Record<string, number> = {};
  const itemKarts: ItemKart[] = [];
  const bodies = karts.map((k) => k.current);
  const events: ItemEvent[] = [];
  const boostFrames = new Map<string, number>();
  let maxLateral = 0;

  for (let step = 0; step < Math.round(seconds / DT); step++) {
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i]!;
      const g = grounds[i]!;
      sampleGround(k.current.x, k.current.z, race.getProgress(k.id)!.getLastCheckpoint().t, g);
      positions[k.id] = g.progress;
      maxLateral = Math.max(maxLateral, Math.abs(g.lateral));
    }
    race.update(DT, positions);

    itemKarts.length = 0;
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i]!;
      itemKarts.push({
        id: k.id,
        state: k.current,
        trackT: grounds[i]!.progress,
        place: race.getStanding(k.id)?.place ?? 1,
        useItem: k.wantsItem && !race.isInputLocked(k.id),
      });
    }

    const playerTotal = race.getProgress(karts[0]!.id)!.totalProgress;
    for (let i = 0; i < karts.length; i++) {
      const k = karts[i]!;
      const held = items.held(k.id);
      const fromT = grounds[i]!.progress;
      const targetAhead = itemKarts.some(
        (o) => o.id !== k.id && (((o.trackT - fromT) % 1) + 1) % 1 > 0 &&
          (((o.trackT - fromT) % 1) + 1) % 1 < 0.12,
      );
      k.step(
        cfg,
        grounds[i]!,
        race.isInputLocked(k.id),
        race.getProgress(k.id)!.totalProgress - playerTotal,
        DT,
        { hasItem: held !== null, offensive: held !== null && ITEM_DEFS[held].offensive, targetAhead },
        items.effectsOf(k.id),
      );
      bodies[i] = k.current;
      if (k.current.boostTime > 0) {
        boostFrames.set(k.id, (boostFrames.get(k.id) ?? 0) + 1);
      }
    }

    for (let i = 0; i < karts.length; i++) itemKarts[i]!.state = karts[i]!.current;
    items.update(itemKarts, DT);
    events.push(...items.consumeEvents());

    resolveKartCollisions(bodies, DEFAULT_KART_COLLISION_CONFIG, DT);
    if (race.phase === 'finished') break;
  }
  return { events, race, karts, items, maxLateral, boostFrames };
}

const run = runField(120);
const kinds = (type: ItemEvent['type']) => run.events.filter((e) => e.type === type);

describe('八车整局 · 道具全开', () => {
  it('车真的能碾到箱子（箱子摆的位置是在路上的）', () => {
    const pickups = kinds('pickup');
    expect(pickups.length).toBeGreaterThan(20);
    // 不是只有一辆车在吃
    expect(new Set(pickups.map((e) => e.kartId)).size).toBeGreaterThanOrEqual(6);
  });

  it('AI 真的会把道具丢出去，而不是攥到底', () => {
    const uses = kinds('use');
    expect(uses.length).toBeGreaterThan(15);
    expect(new Set(uses.map((e) => e.kartId)).size).toBeGreaterThanOrEqual(5);
  });

  it('五种道具整局下来都出现过', () => {
    const used = new Set(
      run.events.flatMap((e) => (e.type === 'use' ? [e.item as ItemId] : [])),
    );
    for (const id of Object.keys(ITEM_DEFS) as ItemId[]) {
      expect(used.has(id), `${id} 整局一次都没被用过`).toBe(true);
    }
  });

  it('攻击道具真的打中过人', () => {
    expect(kinds('hit').length).toBeGreaterThan(0);
  });

  it('护盾真的挡下过伤害', () => {
    expect(kinds('blocked').length).toBeGreaterThan(0);
  });

  it('boost 道具真的生效了（写进的是这一帧的状态对象）', () => {
    // 拿过 boost 的车必须有吃到 boost 的帧。写错状态对象的话这里会是 0
    const boosted = [...run.boostFrames.values()].reduce((a, b) => a + b, 0);
    expect(boosted).toBeGreaterThan(0);
  });

  it('道具没把谁搞得开不动：全场都跑完了至少两圈', () => {
    for (const kart of run.karts) {
      expect(run.race.getProgress(kart.id)!.lap).toBeGreaterThanOrEqual(2);
    }
  });

  it('中了失控也没人被挤出赛道', () => {
    expect(run.maxLateral).toBeLessThanOrEqual(halfWidth + 1.5);
    for (const kart of run.karts) expect(kart.current.airborne).toBe(false);
  });

  it('场上实体不会泄漏：投射物和陷阱都有上限', () => {
    // 都会超时自毁，任何时刻都不该攒出几百个
    expect(run.items.projectiles.length).toBeLessThan(20);
    expect(run.items.traps.length).toBeLessThan(40);
  });

  it('比赛照常能跑完', () => {
    expect(run.race.phase).toBe('finished');
  });

  it('整局是可复现的（同样的种子给出同样的事件序列）', () => {
    const a = runField(20);
    const b = runField(20);
    expect(a.events.length).toBe(b.events.length);
    expect(a.events).toEqual(b.events);
  });
});
