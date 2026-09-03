/** 圈速格式化。纯函数，HUD 和结算面板共用。 */

/**
 * 秒 -> `m:ss.mmm`（不满一分钟就是 `s.mmm`）。
 * @example formatTime(83.456) === '1:23.456'
 * @example formatTime(9.4)    === '9.400'
 */
export function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '--.---';
  const total = Math.floor(seconds * 1000 + 0.5);
  const ms = total % 1000;
  const s = Math.floor(total / 1000) % 60;
  const m = Math.floor(total / 60000);
  const frac = String(ms).padStart(3, '0');
  return m > 0 ? `${m}:${String(s).padStart(2, '0')}.${frac}` : `${s}.${frac}`;
}

/** null（还没有成绩）显示成占位符。 */
export function formatTimeOrDash(seconds: number | null): string {
  return seconds === null ? '--.---' : formatTime(seconds);
}

/** 带符号的时间差，用来显示"比最佳快/慢多少"。 */
export function formatDelta(seconds: number): string {
  const sign = seconds < 0 ? '-' : '+';
  return sign + formatTime(Math.abs(seconds));
}
