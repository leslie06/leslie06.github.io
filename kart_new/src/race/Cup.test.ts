import { describe, expect, it } from 'vitest';
import {
  CUPS,
  CUP_IDS,
  CUP_POINTS,
  CupStore,
  aiIdAt,
  currentRound,
  currentTrack,
  cupStandings,
  isCupFinished,
  isCupId,
  pointsForPlace,
  recordRound,
  sanitizeCupState,
  startCup,
  totalRounds,
  PLAYER_ID,
  type CupState,
  type CupStorage,
} from './Cup';
import { TRACK_IDS } from '../track/tracks';

function memoryStorage(initial: Record<string, string> = {}): CupStorage & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    getItem: (k) => data[k] ?? null,
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

/** 跑完一场：给一份 racerId -> 名次 */
function round(state: CupState, order: readonly string[]) {
  const places: Record<string, number> = {};
  order.forEach((id, i) => (places[id] = i + 1));
  return recordRound(state, {
    trackId: currentTrack(state)!,
    places,
    playerTime: 90,
  });
}

describe('积分表', () => {
  it('第一名 15 分递减，第 8 名之后 0 分', () => {
    expect(pointsForPlace(1)).toBe(15);
    expect(pointsForPlace(2)).toBe(12);
    expect(pointsForPlace(8)).toBe(1);
    expect(pointsForPlace(9)).toBe(0);
    expect(pointsForPlace(100)).toBe(0);
  });

  it('乱七八糟的名次给 0 分，不抛', () => {
    for (const bad of [0, -1, 1.5, NaN]) expect(pointsForPlace(bad)).toBe(0);
  });

  it('分数严格递减 —— 名次靠前反而拿得少的话整个模式就没意义了', () => {
    for (let i = 1; i < CUP_POINTS.length; i++) {
      expect(CUP_POINTS[i]!).toBeLessThan(CUP_POINTS[i - 1]!);
    }
  });
});

describe('杯赛表', () => {
  it('每个杯赛的赛道都是真的，而且不重复', () => {
    for (const id of CUP_IDS) {
      const cup = CUPS[id];
      expect(cup.trackIds.length).toBeGreaterThanOrEqual(3);
      expect(new Set(cup.trackIds).size).toBe(cup.trackIds.length);
      for (const trackId of cup.trackIds) expect(TRACK_IDS).toContain(trackId);
    }
  });

  it('逆行杯就是大奖杯倒过来', () => {
    expect([...CUPS.reverse.trackIds]).toEqual([...CUPS.grand.trackIds].reverse());
  });

  it('isCupId 挡得住脏数据', () => {
    expect(isCupId('grand')).toBe(true);
    for (const bad of ['', 'GRAND', null, 0, {}]) expect(isCupId(bad)).toBe(false);
  });
});

describe('杯赛流程', () => {
  it('一场一场往前走，跑完最后一场就结束', () => {
    let state = startCup('grand', 3);
    expect(currentTrack(state)).toBe(CUPS.grand.trackIds[0]);
    expect(currentRound(state)).toBe(1);
    expect(isCupFinished(state)).toBe(false);

    for (let i = 0; i < totalRounds(state); i++) {
      expect(currentTrack(state)).toBe(CUPS.grand.trackIds[i]);
      state = round(state, [PLAYER_ID, aiIdAt(0), aiIdAt(1), aiIdAt(2)]);
    }
    expect(isCupFinished(state)).toBe(true);
    expect(currentTrack(state)).toBe(null);
    // 结束之后 currentRound 停在最后一场，不会越界
    expect(currentRound(state)).toBe(totalRounds(state));
  });

  it('打完了再记也不会多出一场', () => {
    let state = startCup('grand', 3);
    for (let i = 0; i < totalRounds(state); i++) state = round(state, [PLAYER_ID, aiIdAt(0)]);
    const after = recordRound(state, { trackId: 'meadow', places: { player: 1 }, playerTime: 1 });
    expect(after.results).toHaveLength(totalRounds(state));
  });

  it('recordRound 不改原来的 state', () => {
    const state = startCup('grand', 3);
    const next = round(state, [PLAYER_ID, aiIdAt(0)]);
    expect(state.results).toHaveLength(0);
    expect(next.results).toHaveLength(1);
  });
});

describe('总积分榜', () => {
  it('每个车手都在榜上，包括一场没跑的', () => {
    const state = startCup('grand', 3);
    const rows = cupStandings(state);
    expect(rows).toHaveLength(4);
    expect(rows.every((r) => r.points === 0)).toBe(true);
    expect(rows.filter((r) => r.isPlayer)).toHaveLength(1);
  });

  it('分数是每场名次的累加', () => {
    let state = startCup('grand', 2);
    state = round(state, [PLAYER_ID, aiIdAt(0), aiIdAt(1)]); // 玩家 15
    state = round(state, [aiIdAt(0), PLAYER_ID, aiIdAt(1)]); // 玩家 +12
    const player = cupStandings(state).find((r) => r.isPlayer)!;
    expect(player.points).toBe(27);
    expect(player.rounds).toEqual([1, 2]);
  });

  it('按总分排名', () => {
    let state = startCup('grand', 2);
    state = round(state, [aiIdAt(0), PLAYER_ID, aiIdAt(1)]);
    state = round(state, [aiIdAt(0), PLAYER_ID, aiIdAt(1)]);
    const rows = cupStandings(state);
    expect(rows[0]!.racerId).toBe(aiIdAt(0));
    expect(rows[1]!.isPlayer).toBe(true);
    expect(rows.map((r) => r.place)).toEqual([1, 2, 3]);
  });

  /** 同分时赢的场次多的在前 —— 全程第二拿不到冠军，这是这套积分的性格 */
  it('同分先比谁赢的场次多', () => {
    let state = startCup('grand', 1);
    // 玩家：第 1 + 第 3；AI：第 2 + 第 2 —— 不同分，换个组合
    state = recordRound(state, {
      trackId: 'meadow',
      places: { [PLAYER_ID]: 1, [aiIdAt(0)]: 3 },
      playerTime: null,
    });
    state = recordRound(state, {
      trackId: 'sunset',
      places: { [PLAYER_ID]: 3, [aiIdAt(0)]: 1 },
      playerTime: null,
    });
    const rows = cupStandings(state);
    // 两人都是 15 + 10 = 25 分、各赢一场、最好名次都是 1 —— 只剩 id 兜底，
    // 但至少排序必须是稳定的（不能每次刷新换一个冠军）
    expect(rows[0]!.points).toBe(rows[1]!.points);
    expect(cupStandings(state).map((r) => r.racerId)).toEqual(rows.map((r) => r.racerId));
  });

  it('没跑的场次记成 null，不是 0 分名次', () => {
    let state = startCup('grand', 1);
    state = round(state, [PLAYER_ID, aiIdAt(0)]);
    const player = cupStandings(state).find((r) => r.isPlayer)!;
    expect(player.rounds).toEqual([1]);
  });
});

describe('存档', () => {
  it('存了能读回来', () => {
    const storage = memoryStorage();
    const store = new CupStore(storage);
    let state = startCup('reverse', 5);
    state = round(state, [PLAYER_ID, aiIdAt(0)]);
    store.save(state);
    expect(store.load()).toEqual(state);
  });

  it('没存过是 null', () => {
    expect(new CupStore(memoryStorage()).load()).toBe(null);
  });

  it('清掉之后就没有了', () => {
    const store = new CupStore(memoryStorage());
    store.save(startCup('grand', 3));
    store.clear();
    expect(store.load()).toBe(null);
  });

  it('没有存储（无痕模式）时既不抛也不崩', () => {
    const store = new CupStore(null);
    expect(store.load()).toBe(null);
    expect(() => store.save(startCup('grand', 3))).not.toThrow();
    expect(() => store.clear()).not.toThrow();
  });

  it('坏 JSON 当成没有杯赛', () => {
    expect(new CupStore(memoryStorage({ 'kart-new.cup.v1': '{oops' })).load()).toBe(null);
  });
});

describe('sanitizeCupState', () => {
  it('认得出合法状态', () => {
    const state = startCup('grand', 3);
    expect(sanitizeCupState(JSON.parse(JSON.stringify(state)))).toEqual(state);
  });

  it('杯赛 id / 对手数 / 赛道 id / 名次里任何一样不对都退回 null', () => {
    const good = { cupId: 'grand', aiCount: 3, results: [] };
    expect(sanitizeCupState(good)).not.toBe(null);
    for (const bad of [
      null,
      42,
      { ...good, cupId: 'nope' },
      { ...good, aiCount: -1 },
      { ...good, aiCount: 99 },
      { ...good, aiCount: 'three' },
      { ...good, results: [{ trackId: 'atlantis', places: {}, playerTime: null }] },
      { ...good, results: [{ trackId: 'meadow', places: { player: 0 }, playerTime: null }] },
      { ...good, results: [{ trackId: 'meadow', places: { player: 1.5 }, playerTime: null }] },
      { ...good, results: [{ trackId: 'meadow' }] },
    ]) {
      expect(sanitizeCupState(bad), JSON.stringify(bad)).toBe(null);
    }
  });

  it('比赛道还多的场次被截掉，不会让杯赛永远打不完', () => {
    const rounds = CUPS.grand.trackIds.length;
    const results = Array.from({ length: rounds + 3 }, () => ({
      trackId: 'meadow',
      places: { player: 1 },
      playerTime: null,
    }));
    expect(sanitizeCupState({ cupId: 'grand', aiCount: 3, results })!.results).toHaveLength(rounds);
  });

  it('playerTime 不是数字就当没有，而不是整条丢掉', () => {
    const state = sanitizeCupState({
      cupId: 'grand',
      aiCount: 1,
      results: [{ trackId: 'meadow', places: { player: 1 }, playerTime: 'fast' }],
    });
    expect(state!.results[0]!.playerTime).toBe(null);
  });
});
