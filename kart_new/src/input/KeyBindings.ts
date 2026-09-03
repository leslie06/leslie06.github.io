/**
 * 按键映射。纯数据 + 纯函数，不碰 DOM，所以校验逻辑可以直接单测。
 *
 * 存的是 `KeyboardEvent.code`（物理键位）而不是 `key`（字符）：
 * `code` 不受输入法、大小写、键盘布局影响 —— AZERTY 键盘上按最左上那个键，
 * `key` 是 'a' 而 `code` 永远是 'KeyQ'。游戏要的是"哪个位置的键"。
 */

export type InputAction = 'left' | 'right' | 'forward' | 'back' | 'brake' | 'drift' | 'useItem';

/** 设置界面上的顺序和名字。顺序 = 玩家最可能想改的排前面 */
export const INPUT_ACTIONS: readonly InputAction[] = [
  'forward',
  'back',
  'left',
  'right',
  'drift',
  'brake',
  'useItem',
] as const;

export const ACTION_LABELS: Readonly<Record<InputAction, string>> = Object.freeze({
  forward: '油门',
  back: '刹车 / 倒车',
  left: '左转',
  right: '右转',
  drift: '漂移',
  brake: '刹车',
  useItem: '用道具',
});

/** 一个动作可以绑多个键（默认就是 WASD 和方向键两套并存） */
export type KeyBindings = Readonly<Record<InputAction, readonly string[]>>;

/**
 * 默认映射。
 *
 * 道具键**不能**用 Shift：Shift 是漂移键，而且是长按的，绑在一起等于每次漂移
 * 都自动把道具丢掉。除了这里列的键之外，鼠标右键也能用道具（写死在 KeyboardAdapter 里）。
 */
export const DEFAULT_KEY_BINDINGS: KeyBindings = Object.freeze({
  left: ['ArrowLeft', 'KeyA'],
  right: ['ArrowRight', 'KeyD'],
  forward: ['ArrowUp', 'KeyW'],
  back: ['ArrowDown', 'KeyS'],
  brake: ['Space'],
  drift: ['ShiftLeft', 'ShiftRight'],
  useItem: ['KeyQ'],
});

/** 一个动作最多绑几个键。多了设置界面排不下，也没意义 */
const MAX_KEYS_PER_ACTION = 3;

/**
 * 校验 + 补默认值。localStorage 里可能是上个版本写的、也可能是人手改的。
 *
 * 规矩：
 *   - 不认识的动作丢掉，缺的动作补默认；
 *   - 键位必须是非空字符串，长度有上限（防止有人塞一整本书进去）；
 *   - **一个动作一个键都不剩时退回默认** —— 空映射意味着这个动作永远按不出来，
 *     玩家会以为游戏坏了；
 *   - 同一个键绑到多个动作是**允许**的（有人就想用一个键同时刹车和倒车），
 *     冲突交给 UI 提示，不在这里拦。
 */
export function sanitizeKeyBindings(raw: unknown): KeyBindings {
  const out: Record<InputAction, string[]> = {} as Record<InputAction, string[]>;
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;

  for (const action of INPUT_ACTIONS) {
    const value = source[action];
    const codes = Array.isArray(value)
      ? value.filter(
          (c): c is string => typeof c === 'string' && c.length > 0 && c.length <= 32,
        )
      : [];
    const unique = [...new Set(codes)].slice(0, MAX_KEYS_PER_ACTION);
    out[action] = unique.length > 0 ? unique : [...DEFAULT_KEY_BINDINGS[action]];
  }
  return out;
}

export function isDefaultBindings(bindings: KeyBindings): boolean {
  return INPUT_ACTIONS.every(
    (action) =>
      bindings[action].length === DEFAULT_KEY_BINDINGS[action].length &&
      bindings[action].every((code, i) => code === DEFAULT_KEY_BINDINGS[action][i]),
  );
}

/** 反向表：按下某个 code 时触发哪个动作。同一个键绑了多个动作时取靠前的那个 */
export function codeToAction(bindings: KeyBindings): Map<string, InputAction> {
  const map = new Map<string, InputAction>();
  for (const action of INPUT_ACTIONS) {
    for (const code of bindings[action]) {
      if (!map.has(code)) map.set(code, action);
    }
  }
  return map;
}

/**
 * 把某个键改绑到某个动作上。
 *
 * **会先把这个键从别的动作上摘掉** —— 不摘的话玩家改完会发现"油门也还是刹车"，
 * 而那个冲突在界面上根本看不出来（两个动作的格子里都写着同一个键）。
 * 摘完之后如果某个动作空了，就给它补回默认键。
 *
 * @param slot 改这个动作的第几个键位；超出长度就是追加
 */
export function rebind(
  bindings: KeyBindings,
  action: InputAction,
  slot: number,
  code: string,
): KeyBindings {
  const next: Record<InputAction, string[]> = {} as Record<InputAction, string[]>;
  for (const a of INPUT_ACTIONS) next[a] = [...bindings[a]];

  // 先从所有动作里摘掉这个键
  for (const a of INPUT_ACTIONS) next[a] = next[a].filter((c) => c !== code);

  const list = next[action];
  if (slot >= 0 && slot < list.length) list[slot] = code;
  else if (list.length < MAX_KEYS_PER_ACTION) list.push(code);
  else list[list.length - 1] = code;

  return sanitizeKeyBindings(next);
}

/** 恢复某一个动作的默认键 */
export function resetAction(bindings: KeyBindings, action: InputAction): KeyBindings {
  return sanitizeKeyBindings({ ...bindings, [action]: [...DEFAULT_KEY_BINDINGS[action]] });
}

/**
 * `KeyboardEvent.code` -> 显示用的短标签。
 * 认不出来的原样返回 —— 显示一个 'IntlBackslash' 也比显示"未知"强。
 */
export function keyLabel(code: string): string {
  const special = SPECIAL_LABELS[code];
  if (special) return special;
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit\d$/.test(code)) return code.slice(5);
  if (/^Numpad\d$/.test(code)) return `小键盘${code.slice(6)}`;
  if (/^F\d{1,2}$/.test(code)) return code;
  return code;
}

const SPECIAL_LABELS: Readonly<Record<string, string>> = Object.freeze({
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: '空格',
  ShiftLeft: '左 Shift',
  ShiftRight: '右 Shift',
  ControlLeft: '左 Ctrl',
  ControlRight: '右 Ctrl',
  AltLeft: '左 Alt',
  AltRight: '右 Alt',
  Enter: '回车',
  Tab: 'Tab',
  Backspace: '退格',
  Escape: 'Esc',
  Comma: ',',
  Period: '.',
  Slash: '/',
  Semicolon: ';',
  Quote: "'",
  BracketLeft: '[',
  BracketRight: ']',
  Backslash: '\\',
  Minus: '-',
  Equal: '=',
  Backquote: '`',
});

/**
 * 不许绑的键。绑上去的话玩家可能再也回不到设置界面里改回来。
 * Escape 是设置面板的关闭键，F5 / Tab 是浏览器的。
 */
export const RESERVED_CODES: readonly string[] = ['Escape', 'Tab', 'F5', 'F11', 'F12'];

export function isBindable(code: string): boolean {
  return code.length > 0 && !RESERVED_CODES.includes(code);
}
