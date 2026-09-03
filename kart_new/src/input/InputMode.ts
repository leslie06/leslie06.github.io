/**
 * 选哪套输入适配器：键盘还是触屏。
 *
 * 判断是纯函数，真正 new 出适配器的地方在 main.ts。自动判断永远可以被
 * 设置里的手动开关压过去 —— 二合一笔记本、外接键盘的平板这类机器怎么判都会有人不满意，
 * 与其把规则写得越来越绕，不如给个开关。
 */
import { isMobileUA, type DeviceCaps } from '../core/DeviceCaps';

export type InputMode = 'keyboard' | 'touch';
/** 设置项：'auto' = 听探测的 */
export type InputModeSetting = InputMode | 'auto';

export function isInputMode(value: unknown): value is InputMode {
  return value === 'keyboard' || value === 'touch';
}

/**
 * 自动判断。
 *
 * 规则：UA 认得出是手机/平板 -> 触屏；否则要求"能多点触摸 **且** 屏幕不大" ——
 * 触摸屏笔记本满足前一半但不满足后一半，会留在键盘上，这是对的：
 * 它有真键盘，硬塞一套占半个屏幕的虚拟摇杆反而添乱。
 */
export function detectInputMode(caps: DeviceCaps): InputMode {
  if (isMobileUA(caps.ua)) return 'touch';
  if (caps.maxTouchPoints > 0 && caps.screenLongEdge <= 1400) return 'touch';
  return 'keyboard';
}

export interface ResolvedInputMode {
  mode: InputMode;
  /** 探测结果，设置菜单里显示"自动: 触屏"用 */
  detected: InputMode;
}

export function resolveInputMode(caps: DeviceCaps, setting: InputModeSetting = 'auto'): ResolvedInputMode {
  const detected = detectInputMode(caps);
  return { mode: setting === 'auto' ? detected : setting, detected };
}
