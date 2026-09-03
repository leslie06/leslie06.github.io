/**
 * 中立的输入"意图"。任何输入设备（键盘、触屏摇杆、手柄、AI）都只负责
 * 产出这个结构；上层逻辑不许直接读设备事件。
 */
export interface InputState {
  /** -1 = 全左, 0 = 直行, 1 = 全右 */
  steer: number;
  /** 0..1 */
  throttle: number;
  /** 0..1 */
  brake: number;
  /** 漂移键是否按住 */
  drift: boolean;
  /**
   * 这一帧要不要使用手里的道具。
   *
   * 是"这一帧按下了"而不是"按住"：道具是一次性的，按住不该连发。
   * 边沿检测放在各个 InputAdapter 里（键盘看 keydown，AI 看自己的计时器），
   * 上层拿到的永远是"就是现在用"这个意图。
   */
  useItem: boolean;
}

export const NEUTRAL_INPUT: Readonly<InputState> = Object.freeze({
  steer: 0,
  throttle: 0,
  brake: 0,
  drift: false,
  useItem: false,
});

export function createInputState(): InputState {
  return { ...NEUTRAL_INPUT };
}

/** 任何输入设备都实现这个接口。 */
export interface InputAdapter {
  /** 读取当前这一帧的输入意图。返回的对象可以是内部复用的，调用方不要长期持有。 */
  sample(): Readonly<InputState>;
  dispose(): void;
}
