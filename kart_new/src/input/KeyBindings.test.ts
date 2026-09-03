import { describe, expect, it } from 'vitest';
import {
  ACTION_LABELS,
  DEFAULT_KEY_BINDINGS,
  INPUT_ACTIONS,
  codeToAction,
  isBindable,
  isDefaultBindings,
  keyLabel,
  rebind,
  resetAction,
  sanitizeKeyBindings,
  RESERVED_CODES,
} from './KeyBindings';

describe('默认映射', () => {
  it('每个动作都有键，而且都有名字', () => {
    for (const action of INPUT_ACTIONS) {
      expect(DEFAULT_KEY_BINDINGS[action].length).toBeGreaterThan(0);
      expect(ACTION_LABELS[action]).toBeTruthy();
    }
  });

  /**
   * 漂移是长按的。道具键和它绑同一个键的话，每次起漂都会顺手把道具扔掉 ——
   * 这个 bug 很难当场看出来（"我的香蕉呢？"），所以钉一条。
   */
  it('道具键不和漂移键重合', () => {
    for (const code of DEFAULT_KEY_BINDINGS.useItem) {
      expect(DEFAULT_KEY_BINDINGS.drift).not.toContain(code);
    }
  });

  it('WASD 和方向键两套并存', () => {
    expect(DEFAULT_KEY_BINDINGS.forward).toContain('KeyW');
    expect(DEFAULT_KEY_BINDINGS.forward).toContain('ArrowUp');
  });
});

describe('sanitizeKeyBindings', () => {
  it('垃圾输入退回默认，不抛', () => {
    for (const raw of [null, undefined, 42, 'nope', []]) {
      expect(sanitizeKeyBindings(raw)).toEqual(DEFAULT_KEY_BINDINGS);
    }
  });

  it('缺的动作补默认，不认识的字段丢掉', () => {
    const out = sanitizeKeyBindings({ forward: ['KeyI'], nonsense: ['KeyZ'] });
    expect(out.forward).toEqual(['KeyI']);
    expect(out.back).toEqual(DEFAULT_KEY_BINDINGS.back);
    expect('nonsense' in out).toBe(false);
  });

  /** 空映射 = 这个动作永远按不出来，玩家会以为游戏坏了 */
  it('某个动作一个键都不剩时退回它的默认键', () => {
    expect(sanitizeKeyBindings({ forward: [] }).forward).toEqual(DEFAULT_KEY_BINDINGS.forward);
    expect(sanitizeKeyBindings({ forward: [123, null, ''] }).forward).toEqual(
      DEFAULT_KEY_BINDINGS.forward,
    );
  });

  it('去重，而且一个动作最多三个键', () => {
    const out = sanitizeKeyBindings({ forward: ['KeyI', 'KeyI', 'KeyJ', 'KeyK', 'KeyL'] });
    expect(out.forward).toEqual(['KeyI', 'KeyJ', 'KeyK']);
  });

  it('长得离谱的 code 丢掉', () => {
    expect(sanitizeKeyBindings({ forward: ['x'.repeat(100)] }).forward).toEqual(
      DEFAULT_KEY_BINDINGS.forward,
    );
  });
});

describe('codeToAction', () => {
  it('反向表覆盖所有绑定的键', () => {
    const map = codeToAction(DEFAULT_KEY_BINDINGS);
    expect(map.get('KeyW')).toBe('forward');
    expect(map.get('ArrowLeft')).toBe('left');
    expect(map.get('Space')).toBe('brake');
    expect(map.get('KeyZ')).toBeUndefined();
  });

  it('一个键绑到两个动作时取靠前的那个（顺序是确定的，不会每次不一样）', () => {
    const bindings = sanitizeKeyBindings({ forward: ['KeyX'], back: ['KeyX'] });
    const map = codeToAction(bindings);
    // INPUT_ACTIONS 里 forward 排在 back 前面
    expect(map.get('KeyX')).toBe('forward');
  });
});

describe('rebind', () => {
  it('改掉指定槽位的键', () => {
    const next = rebind(DEFAULT_KEY_BINDINGS, 'forward', 0, 'KeyI');
    expect(next.forward[0]).toBe('KeyI');
    expect(next.forward[1]).toBe('KeyW'); // 另一个槽没动
  });

  /**
   * 不摘干净的话，玩家把 W 改绑到刹车之后会发现"油门也还是 W"，
   * 而界面上两个格子都写着 W，根本看不出哪儿不对。
   */
  it('新键会先从别的动作上摘掉', () => {
    const next = rebind(DEFAULT_KEY_BINDINGS, 'brake', 0, 'KeyW');
    expect(next.brake).toContain('KeyW');
    expect(next.forward).not.toContain('KeyW');
    expect(next.forward).toContain('ArrowUp'); // 还剩一个，不用补默认
  });

  it('摘完之后空了的动作会补回默认键', () => {
    // brake 默认只有 Space，把 Space 抢走之后它应该补回默认
    const next = rebind(DEFAULT_KEY_BINDINGS, 'forward', 0, 'Space');
    expect(next.forward).toContain('Space');
    expect(next.brake.length).toBeGreaterThan(0);
  });

  it('槽位越界就追加，满了就顶掉最后一个', () => {
    const one = rebind(sanitizeKeyBindings({ brake: ['Space'] }), 'brake', 5, 'KeyB');
    expect(one.brake).toEqual(['Space', 'KeyB']);
    const full = sanitizeKeyBindings({ brake: ['KeyA', 'KeyB', 'KeyC'] });
    expect(rebind(full, 'brake', 9, 'KeyD').brake).toEqual(['KeyA', 'KeyB', 'KeyD']);
  });

  it('不改原来那份', () => {
    const before = JSON.stringify(DEFAULT_KEY_BINDINGS);
    rebind(DEFAULT_KEY_BINDINGS, 'forward', 0, 'KeyI');
    expect(JSON.stringify(DEFAULT_KEY_BINDINGS)).toBe(before);
  });
});

describe('resetAction / isDefaultBindings', () => {
  it('单个动作能恢复默认', () => {
    const changed = rebind(DEFAULT_KEY_BINDINGS, 'forward', 0, 'KeyI');
    expect(isDefaultBindings(changed)).toBe(false);
    expect(resetAction(changed, 'forward').forward).toEqual(DEFAULT_KEY_BINDINGS.forward);
  });

  it('没改过时认得出来（设置界面据此显示"已改"标记）', () => {
    expect(isDefaultBindings(DEFAULT_KEY_BINDINGS)).toBe(true);
    expect(isDefaultBindings(sanitizeKeyBindings(DEFAULT_KEY_BINDINGS))).toBe(true);
  });
});

describe('keyLabel', () => {
  it('字母、数字、方向键、空格都有短标签', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit1')).toBe('1');
    expect(keyLabel('ArrowUp')).toBe('↑');
    expect(keyLabel('Space')).toBe('空格');
    expect(keyLabel('ShiftLeft')).toBe('左 Shift');
  });

  it('认不出来的原样返回 —— 显示 IntlBackslash 也比显示"未知"强', () => {
    expect(keyLabel('IntlBackslash')).toBe('IntlBackslash');
  });
});

describe('isBindable', () => {
  it('挡住那几个绑上去就回不来的键', () => {
    for (const code of RESERVED_CODES) expect(isBindable(code)).toBe(false);
    expect(isBindable('KeyW')).toBe(true);
    expect(isBindable('')).toBe(false);
  });
});
