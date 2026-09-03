/**
 * 状态效果层。纯逻辑，不 import three / rapier / DOM。
 *
 * ## kartStep 不知道道具的存在
 *
 * 这是整套道具系统最要紧的一条约束。效果**不**通过在 kartStep 里加分支实现，
 * 而是通过改一份传给它的 KartConfig 副本：减速效果就是把这辆车这一帧的
 * maxSpeed 乘个系数，kartStep 照常按"它的极速就是这么多"来跑。
 *
 * 好处不只是干净：kartStep 里"超过上限就平滑回落"那套（boostFalloffDecel）
 * 会自动接管减速效果的手感 —— 中了闪电不会瞬间掉速像撞墙，而是自然地滑下来。
 * 这跟 AI 的 maxSpeed 倍率走的是同一条路子（见 AIKart.syncConfig）。
 *
 * ## magnitude 的语义
 *
 * 统一成"强度"，恒为非负，**越大越强**。各类型自己解释：
 *   boost   极速 ×(1 + m)
 *   slow    极速 ×(1 - m)
 *   spinout 失控：在 slow 之上再吃掉转向权限
 *   shield  不用 magnitude
 * 之所以不让 magnitude 直接就是"速度倍率"：那样 slow 的"更强"是数值更小、
 * boost 的"更强"是数值更大，叠加规则里没法统一比较。
 */
import type { KartConfig } from '../kart/KartConfig';

export type EffectType = 'boost' | 'slow' | 'spinout' | 'shield';

export interface Effect {
  type: EffectType;
  /** 剩余时长（秒） */
  duration: number;
  /** 强度，非负，越大越强。语义见文件头 */
  magnitude: number;
}

export function effect(type: EffectType, duration: number, magnitude = 0): Effect {
  return { type, duration, magnitude };
}

/** 失控时转向权限还剩多少（0 = 完全打不动方向）。留一点点，不然车会像轨道车 */
const SPINOUT_STEER_FLOOR = 0.12;

/**
 * 一辆车身上挂着的所有效果。
 *
 * 每种类型最多一条 —— 同类效果**刷新时长而不是累加倍率**：
 * 连吃三发闪电不该叠成 0.125 倍速直接停在原地。具体规则见 add()。
 */
export class EffectSet {
  private readonly effects = new Map<EffectType, Effect>();

  /**
   * 挂一个效果。
   *
   * 同类叠加规则：
   *   - 时长取**两者较大**，不累加。补刀不该让人躺更久，但也不能把长效果刷短了
   *     （剩 3 秒时再吃一发 0.5 秒的，重置成 0.5 秒等于帮了对方）
   *   - 强度取**两者较大**，不相乘。相乘的话补刀会指数级变强
   */
  add(next: Readonly<Effect>): void {
    if (next.duration <= 0) return;
    const cur = this.effects.get(next.type);
    if (!cur) {
      this.effects.set(next.type, { ...next });
      return;
    }
    cur.duration = Math.max(cur.duration, next.duration);
    cur.magnitude = Math.max(cur.magnitude, next.magnitude);
  }

  /** 走一帧，到期的自动移除。 */
  update(dt: number): void {
    if (dt <= 0) return;
    for (const [type, e] of this.effects) {
      e.duration -= dt;
      if (e.duration <= 0) this.effects.delete(type);
    }
  }

  has(type: EffectType): boolean {
    return this.effects.has(type);
  }

  get(type: EffectType): Readonly<Effect> | undefined {
    return this.effects.get(type);
  }

  /** 剩余时长，没这个效果就是 0 */
  remaining(type: EffectType): number {
    return this.effects.get(type)?.duration ?? 0;
  }

  remove(type: EffectType): void {
    this.effects.delete(type);
  }

  clear(): void {
    this.effects.clear();
  }

  get size(): number {
    return this.effects.size;
  }

  /** 当前挂着的所有效果（HUD 要显示） */
  list(): Readonly<Effect>[] {
    return [...this.effects.values()];
  }

  /**
   * 挡一次伤害。
   *
   * 护盾是"限时免疫一次" —— 挡下之后立刻消失，不管还剩多久。
   * @returns true = 这次伤害被挡下了，调用方不要再挂负面效果
   */
  consumeShield(): boolean {
    if (!this.effects.has('shield')) return false;
    this.effects.delete('shield');
    return true;
  }

  /**
   * 把效果写进这辆车这一帧的 config 副本。
   *
   * out 必须是调用方自己的副本（每辆车一份），**不能**是玩家那份原始 config ——
   * 这里是就地改的。
   */
  applyTo(out: KartConfig): void {
    if (this.effects.size === 0) return;

    const boost = this.effects.get('boost');
    if (boost) {
      out.maxSpeed *= 1 + boost.magnitude;
      out.engineAccel *= 1 + boost.magnitude;
    }

    // slow 和 spinout 的减速部分是同一件事，取更强的那个，不叠乘
    const slow = Math.max(
      this.effects.get('slow')?.magnitude ?? 0,
      this.effects.get('spinout')?.magnitude ?? 0,
    );
    if (slow > 0) {
      const keep = Math.max(1 - slow, 0.05);
      out.maxSpeed *= keep;
      // 加速度也一起砍，不然减速一结束会"嗖"地弹回极速
      out.engineAccel *= keep;
    }

    const spin = this.effects.get('spinout');
    if (spin) {
      // 失控 = 方向盘基本没用了。留一点点权限，不然车变成轨道车，
      // 撞墙之后连挪都挪不出来
      const keep = Math.max(1 - spin.magnitude, SPINOUT_STEER_FLOOR);
      out.turnRate *= keep;
      out.driftTurnRate *= keep;
      // 失控期间起不了漂：把门槛抬到极速之上就行，不用去动 kartStep
      out.driftMinSpeed = Number.POSITIVE_INFINITY;
    }
  }
}
