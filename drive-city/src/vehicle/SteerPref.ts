/**
 * 方向灵敏度（2026-11-18）：暂停菜单里五档，存在本地，只管玩家自己开的车（`vehicle/index.ts` 把它交给
 * `ControlFilter.sense`；交通车、任务车、自动驾驶不受影响）。
 * - 键盘和触屏的 ◀ ▶：方向盘跟上按键的快慢（滞后时间 ÷ 灵敏度），以及高速时按住键还给多少舵（灵敏度高给得多）。
 * - 手柄摇杆和触屏摇杆：中间那段的弧度（灵敏度高，推一点就转得多），满舵一直推得到。
 * `?steer=1..5` 临时指定（不存）。
 */
export const STEER_LEVELS = [0.6, 0.8, 1, 1.25, 1.5] as const;
export type SteerLevel = 0 | 1 | 2 | 3 | 4;
const KEY = 'drivecity.steerSense';
const DEFAULT: SteerLevel = 2;

const valid = (n: number): n is SteerLevel => Number.isInteger(n) && n >= 0 && n < STEER_LEVELS.length;
let level: SteerLevel = DEFAULT;
const fromUrl = typeof location === 'undefined' ? null : new URLSearchParams(location.search).get('steer');
if (fromUrl && valid(+fromUrl - 1)) level = (+fromUrl - 1) as SteerLevel;
else try { const s = Number(localStorage.getItem(KEY) ?? NaN); if (valid(s)) level = s; } catch { /* private mode */ }
const listeners: ((l: SteerLevel) => void)[] = [];

export const steerPref = {
  get level(): SteerLevel { return level; },
  /** The multiplier ControlFilter takes (1 = the tuned default). */
  get sense(): number { return STEER_LEVELS[level]; },
  set(l: SteerLevel): void {
    if (l === level || !valid(l)) return;
    level = l;
    try { localStorage.setItem(KEY, String(l)); } catch { /* private mode */ }
    for (const f of listeners) f(l);
  },
  onChange(f: (l: SteerLevel) => void): void { listeners.push(f); },
};
