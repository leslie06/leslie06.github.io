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
}

export const NEUTRAL_INPUT: Readonly<InputState> = Object.freeze({
  steer: 0,
  throttle: 0,
  brake: 0,
  drift: false,
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
