/**
 * 虚拟摇杆的数学。
 *
 * 单独拆出来是因为它是这套触屏输入里唯一有"逻辑"的部分：死区、曲线、摇杆头
 * 不能被拖出圈。DOM 那一坨事件在 TouchAdapter.ts 里，那部分没法在 node 里跑测试，
 * 所以凡是能算的都挪到这个文件来。
 */

export interface TouchSteerConfig {
  /** 摇杆半径（CSS 像素）。手指从圆心拉到这里就是满舵 */
  radius: number;
  /** 死区，占半径的比例。手指按下去的那一点几乎不可能正好是圆心，没死区车会一直微微歪 */
  deadzone: number;
  /**
   * 转向曲线的指数。1 = 线性；> 1 = 中间段更钝、边缘更利。
   * 手机上没有键盘那种"要么 0 要么 1"的干脆，靠这个把小幅度修正做细。
   */
  curve: number;
}

export const DEFAULT_TOUCH_STEER: Readonly<TouchSteerConfig> = Object.freeze({
  radius: 64,
  deadzone: 0.12,
  curve: 1.35,
});

export const TOUCH_STEER_RANGES: Record<keyof TouchSteerConfig, [number, number, number]> = {
  radius: [30, 140, 1],
  deadzone: [0, 0.5, 0.01],
  curve: [1, 3, 0.05],
};

const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);

/**
 * 手指相对摇杆圆心的横向偏移 -> steer（-1..1）。
 * 只看横向：油门和刹车是右手边的按钮，摇杆上下不参与。
 */
export function steerFromOffset(dx: number, cfg: Readonly<TouchSteerConfig> = DEFAULT_TOUCH_STEER): number {
  const radius = Math.max(cfg.radius, 1);
  const raw = clamp(dx / radius, -1, 1);
  const magnitude = Math.abs(raw);
  const deadzone = clamp(cfg.deadzone, 0, 0.95);
  if (magnitude <= deadzone) return 0;
  // 死区之外重新拉伸回 0..1，否则一出死区就跳到 deadzone 那么大的舵角
  const normalized = (magnitude - deadzone) / (1 - deadzone);
  return Math.sign(raw) * normalized ** Math.max(cfg.curve, 0.05);
}

export interface KnobOffset {
  x: number;
  y: number;
}

/**
 * 摇杆头的显示位置：把手指偏移按长度截到半径以内。
 * 截长度而不是分别截 x/y —— 分别截的话斜着拉会跑到圆外的方角上。
 */
export function clampKnob(dx: number, dy: number, radius: number, out: KnobOffset = { x: 0, y: 0 }): KnobOffset {
  const length = Math.hypot(dx, dy);
  const scale = length > radius && length > 0 ? radius / length : 1;
  out.x = dx * scale;
  out.y = dy * scale;
  return out;
}
