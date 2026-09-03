/**
 * 杯赛：连着跑几条赛道，按每场名次积分，总分决定杯赛冠军。
 *
 * 纯逻辑 + 一个可注入的存储，不 import three / DOM。
 *
 * ## 为什么状态要存起来
 * 换赛道是重载页面的（赛道网格、rapier 碰撞体、发车格全是按那条赛道建的），
 * 所以一个杯赛天然跨好几次页面加载。既然已经要存，顺手就支持了"关掉浏览器
 * 明天接着打" —— 代价只是多写一个 sanitize。
 *
 * ## 阵容为什么锁死
 * CupState 里存了 aiCount：杯赛开始时是几个对手，整个杯赛就一直是几个。
 * 不锁的话中途改画质档位（对手数量跟着档位走）就会让积分表凭空多出或者少掉几行，
 * 那个杯赛冠军也就没意义了。
 */
import { personaAt } from '../ai/AIProfiles';
import { TRACK_IDS, isTrackId, type TrackId } from '../track/tracks';

/**
 * 名次积分。第一名 15 分往下递减，第 8 名 1 分，之后 0 分。
 * 头两名之间差 3 分、二三名差 2 分：**赢一场不至于锁死整个杯赛**，
 * 但也确实值钱 —— 全程第二拿不到冠军，需要至少赢一场或者对手崩一场。
 */
export const CUP_POINTS: readonly number[] = [15, 12, 10, 8, 6, 4, 2, 1];

export function pointsForPlace(place: number): number {
  if (!Number.isInteger(place) || place < 1) return 0;
  return CUP_POINTS[place - 1] ?? 0;
}

export type CupId = 'grand' | 'reverse';

export interface CupDefinition {
  id: CupId;
  name: string;
  subtitle: string;
  /** 按顺序跑的赛道 */
  trackIds: readonly TrackId[];
}

/**
 * 杯赛表。**加一个杯赛 = 加一条**，别处不许写 `if (cupId === ...)`。
 * 两个杯赛用同样四条道、顺序相反：难度曲线完全不同（一个越跑越难，
 * 一个上来就是最难的），而不用再画四条赛道。
 */
export const CUPS: Readonly<Record<CupId, CupDefinition>> = Object.freeze({
  grand: {
    id: 'grand',
    name: '大奖杯',
    subtitle: '四条赛道，由易到难',
    trackIds: TRACK_IDS,
  },
  reverse: {
    id: 'reverse',
    name: '逆行杯',
    subtitle: '同样四条，从最难的开始',
    trackIds: [...TRACK_IDS].reverse(),
  },
});

export const CUP_IDS: readonly CupId[] = ['grand', 'reverse'] as const;

export function isCupId(value: unknown): value is CupId {
  return typeof value === 'string' && Object.hasOwn(CUPS, value);
}

/** 一场比赛的结果：谁第几名 */
export interface CupRoundResult {
  trackId: TrackId;
  /** racerId -> 名次（1 = 第一） */
  places: Readonly<Record<string, number>>;
  /** 玩家这一场的总用时，结算面板上显示用；没跑完是 null */
  playerTime: number | null;
}

export interface CupState {
  cupId: CupId;
  /** 对手数量。杯赛开始时定死，中途改画质也不变 */
  aiCount: number;
  /** 已经跑完的每一场 */
  results: readonly CupRoundResult[];
}

export const PLAYER_ID = 'player';

/** 第 i 个 AI 的固定 id。和 main.ts 里建 AIKart 用的是同一套 */
export function aiIdAt(index: number): string {
  return `ai${index}`;
}

export function startCup(cupId: CupId, aiCount: number): CupState {
  return { cupId, aiCount: Math.max(0, Math.floor(aiCount)), results: [] };
}

/** 下一场跑哪条道。杯赛已经打完了返回 null */
export function currentTrack(state: CupState): TrackId | null {
  return CUPS[state.cupId].trackIds[state.results.length] ?? null;
}

/** 这是第几场（1-based），给 HUD 显示"第 2 / 4 场" */
export function currentRound(state: CupState): number {
  return Math.min(state.results.length + 1, totalRounds(state));
}

export function totalRounds(state: CupState): number {
  return CUPS[state.cupId].trackIds.length;
}

export function isCupFinished(state: CupState): boolean {
  return state.results.length >= totalRounds(state);
}

/** 记一场结果，返回**新的** state（不改原来那个） */
export function recordRound(state: CupState, result: CupRoundResult): CupState {
  if (isCupFinished(state)) return state;
  return { ...state, results: [...state.results, result] };
}

export interface CupStanding {
  racerId: string;
  name: string;
  color: string;
  isPlayer: boolean;
  points: number;
  /** 1 = 杯赛第一 */
  place: number;
  /** 每一场的名次，没跑的场次是 null。给积分表画成一行小数字 */
  rounds: readonly (number | null)[];
}

/**
 * 杯赛总积分榜。
 *
 * 同分时的排序：**赢的场次多的在前**，还一样就比最好的单场名次，再一样按 id ——
 * 最后这一条只是为了让排序稳定，不代表任何竞技意义。
 */
export function cupStandings(state: CupState): CupStanding[] {
  const ids = [PLAYER_ID, ...Array.from({ length: state.aiCount }, (_, i) => aiIdAt(i))];

  const rows = ids.map((racerId) => {
    const isPlayer = racerId === PLAYER_ID;
    const persona = isPlayer ? null : personaAt(indexOfAi(racerId));
    const rounds = state.results.map((r) => r.places[racerId] ?? null);
    const points = rounds.reduce<number>((sum, place) => sum + (place ? pointsForPlace(place) : 0), 0);
    const finished = rounds.filter((p): p is number => p !== null);
    return {
      racerId,
      name: isPlayer ? '你' : (persona?.name ?? racerId),
      color: isPlayer ? PLAYER_COLOR : (persona?.color ?? '#ffffff'),
      isPlayer,
      points,
      place: 0,
      rounds,
      wins: finished.filter((p) => p === 1).length,
      best: finished.length > 0 ? Math.min(...finished) : Number.POSITIVE_INFINITY,
    };
  });

  rows.sort(
    (a, b) =>
      b.points - a.points ||
      b.wins - a.wins ||
      a.best - b.best ||
      a.racerId.localeCompare(b.racerId),
  );
  rows.forEach((row, i) => (row.place = i + 1));
  return rows.map(({ wins: _wins, best: _best, ...row }) => row);
}

/** 玩家的车身色。和 main.ts 里的 PLAYER_PALETTE.body 是同一个值 */
const PLAYER_COLOR = '#ff3b30';

function indexOfAi(id: string): number {
  const n = Number.parseInt(id.slice(2), 10);
  return Number.isFinite(n) ? n : 0;
}

// ============================================================================
// 存储
// ============================================================================

/** localStorage 的最小接口。测试塞个内存实现就行 */
export interface CupStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const CUP_STORAGE_KEY = 'kart-new.cup.v1';

/**
 * 校验存进来的东西。localStorage 里可能是上个版本写的、也可能是人手改的，
 * **一个坏值就能让启动流程炸掉**，所以看不懂的一律当成"没有进行中的杯赛"。
 */
export function sanitizeCupState(raw: unknown): CupState | null {
  if (!raw || typeof raw !== 'object') return null;
  const source = raw as Partial<Record<keyof CupState, unknown>>;
  if (!isCupId(source.cupId)) return null;

  const aiCount = source.aiCount;
  if (typeof aiCount !== 'number' || !Number.isFinite(aiCount) || aiCount < 0 || aiCount > 16) {
    return null;
  }

  const rounds = CUPS[source.cupId].trackIds.length;
  const rawResults = Array.isArray(source.results) ? source.results : [];
  const results: CupRoundResult[] = [];
  for (const entry of rawResults.slice(0, rounds)) {
    if (!entry || typeof entry !== 'object') return null;
    const r = entry as Partial<CupRoundResult>;
    if (!isTrackId(r.trackId)) return null;
    if (!r.places || typeof r.places !== 'object') return null;
    const places: Record<string, number> = {};
    for (const [id, place] of Object.entries(r.places as Record<string, unknown>)) {
      if (typeof place !== 'number' || !Number.isInteger(place) || place < 1) return null;
      places[id] = place;
    }
    const time = typeof r.playerTime === 'number' && Number.isFinite(r.playerTime) ? r.playerTime : null;
    results.push({ trackId: r.trackId, places, playerTime: time });
  }
  return { cupId: source.cupId, aiCount: Math.floor(aiCount), results };
}

export class CupStore {
  constructor(
    private readonly storage: CupStorage | null,
    private readonly key: string = CUP_STORAGE_KEY,
  ) {}

  /** 进行中的杯赛，没有就是 null */
  load(): CupState | null {
    try {
      const raw = this.storage?.getItem(this.key);
      return raw ? sanitizeCupState(JSON.parse(raw)) : null;
    } catch {
      // 坏 JSON 也当没有。杯赛进度丢了顶多重打一次，不该让游戏起不来
      return null;
    }
  }

  save(state: CupState): void {
    try {
      this.storage?.setItem(this.key, JSON.stringify(state));
    } catch {
      /* 无痕模式 / 配额满：存不下就算了 */
    }
  }

  clear(): void {
    try {
      this.storage?.removeItem(this.key);
    } catch {
      /* 同上 */
    }
  }
}

/** 浏览器里能用就用 localStorage，node / 隐私模式下返回 null */
export function browserCupStorage(): CupStorage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}
