/**
 * 季节按北京的日历（2026-11-09，docs/beijing-immersion-design.md D1，「让人能感觉在真实的北京城跑」）：游戏一直是夏天
 * 的绿，可 11 月的北京满城银杏金黄、国槐杨树转黄、月底落光；冬天草地枯黄，侧柏发暗。这里按北京时间的日子插值出几个
 * 0..1 的量，树的着色器（`uSeason`：x 国槐杨树转黄、y 落叶、z 银杏金黄、w 侧柏冬天发暗）和草地的颜色读它。
 * `?season=spring|summer|autumn|winter` 或 `?date=MM-DD` 强制；shot mode 默认夏天（截图基线不随日子变）。
 */
export interface Season {
  /** 国槐、杨树叶子转黄 */
  autumn: number;
  /** 落叶（侧柏不落） */
  bare: number;
  /** 银杏金黄 */
  ginkgo: number;
  /** 侧柏冬天发暗发黄 */
  cypress: number;
  /** 草地枯黄 */
  dry: number;
  /** 一年里的第几天（北京时间，0 = 1 月 1 日） */
  day: number;
}

type Curve = [number, number][];
// 转黄一直保持到第二年发芽（剩在枝头的几片是枯叶色），3 月底新叶是绿的
const AUTUMN: Curve = [[0, 1], [85, 1], [95, 0], [285, 0], [300, 0.55], [313, 1], [366, 1]];
const BARE: Curve = [[0, 1], [78, 1], [92, 0.55], [105, 0], [305, 0], [318, 0.35], [330, 0.8], [343, 1], [366, 1]];
const GINKGO: Curve = [[0, 1], [85, 1], [95, 0], [290, 0], [302, 0.5], [310, 1], [366, 1]];
const CYPRESS: Curve = [[0, 1], [60, 1], [90, 0], [320, 0], [345, 1], [366, 1]];
const DRY: Curve = [[0, 1], [70, 1], [100, 0.3], [115, 0], [300, 0], [320, 0.6], [335, 1], [366, 1]];

const at = (c: Curve, d: number): number => {
  for (let i = 1; i < c.length; i++) if (d <= c[i][0]) { const [d0, v0] = c[i - 1], [d1, v1] = c[i]; return v0 + (v1 - v0) * (d1 > d0 ? (d - d0) / (d1 - d0) : 1); }
  return c[c.length - 1][1];
};

/** 北京时间的第几天（0 = 1 月 1 日）。 */
export function beijingDay(now: Date): number {
  const b = new Date(now.getTime() + 8 * 3600e3);
  return Math.floor((Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate()) - Date.UTC(b.getUTCFullYear(), 0, 1)) / 86400e3);
}

const FORCED: Record<string, number> = { spring: 115, summer: 196, autumn: 309, winter: 15 };

export function seasonAt(now = new Date(), q: URLSearchParams = new URLSearchParams(typeof location === 'undefined' ? '' : location.search)): Season {
  let day = beijingDay(now);
  const s = q.get('season'), dt = q.get('date')?.match(/^(\d{1,2})-(\d{1,2})$/);
  if (s && s in FORCED) day = FORCED[s];
  else if (dt) day = Math.floor((Date.UTC(2026, Number(dt[1]) - 1, Number(dt[2])) - Date.UTC(2026, 0, 1)) / 86400e3);
  else if (q.has('shot')) day = FORCED.summer;
  return { autumn: at(AUTUMN, day), bare: at(BARE, day), ginkgo: at(GINKGO, day), cypress: at(CYPRESS, day), dry: at(DRY, day), day };
}
