/**
 * 道具系统的总装。纯逻辑，不 import three / rapier / DOM。
 *
 * 它把四块东西缝在一起：道具箱（抽奖发货）、效果层（挂在车上的状态）、
 * 投射物、陷阱。对外只暴露"每个物理子步喂一次全场车辆"这一个入口。
 *
 * ## 这里没有 `switch (itemId)`
 *
 * 加一个新道具只要往 ITEM_DEFS 里加一条。这个文件只认两样东西：
 *   - `def.targetType`：决定谁是目标（选目标的 switch 是对 targetType 的，不是对 id 的）
 *   - `def.apply()` 返回的 ItemOutcome：决定发生什么
 * 所以它压根不知道有 'lightning' 或 'trap' 这些 id 存在。
 *
 * ## 效果怎么影响车
 *
 * 不在这里改车。这里只负责把效果挂上去，主循环在拼这辆车这一帧的 KartConfig
 * 副本时调 `effectsOf(id).applyTo(cfg)`。kartStep 全程不知道有道具这回事。
 * 唯一的例外是 boost：它直接写 state.boostTime / boostLevel，
 * 也就是**复用漂移 mini-turbo 的那套实现**（需求里点名要的），
 * 于是速度线、镜头推近、超速平滑回落全是现成的。
 */
import type { AITrack } from '../ai/AITrack';
import type { KartState } from '../kart/kartStep';
import { EffectSet, type Effect } from './EffectSystem';
import { ItemBoxField, type BoxPickup } from './ItemBoxes';
import {
  ITEM_DEFS,
  rollItem,
  type ItemDef,
  type ItemId,
  type ItemTargetType,
  type ItemUseContext,
} from './ItemDefs';
import {
  DEFAULT_PROJECTILE_CONFIG,
  pickBackwardTarget,
  pickForwardTarget,
  stepProjectile,
  stepTrap,
  type Projectile,
  type ProjectileConfig,
  type ProjectileTarget,
  type Trap,
} from './Projectile';
import { createRng, type Rng } from './rng';

/** 投射物飞行时要查自己在赛道的哪儿，所以比 AITrack 多一个反查 */
export interface ItemTrack extends AITrack {
  /** 世界坐标 -> 赛道进度 0..1 */
  progressAt(x: number, z: number): number;
}

/** 每个物理子步喂进来的一辆车 */
export interface ItemKart {
  id: string;
  /** 可变。boost 会直接写进 boostTime / boostLevel */
  state: KartState;
  /** 这一帧的赛道进度 0..1 */
  trackT: number;
  /** 名次，1 = 第一名。抽奖按它加权 */
  place: number;
  /** 这一帧有没有请求使用道具 */
  useItem: boolean;
}

export type ItemEvent =
  | { type: 'pickup'; kartId: string; item: ItemId }
  | { type: 'use'; kartId: string; item: ItemId }
  /** 中招了。by = 谁干的（陷阱/投射物的主人；闪电是释放者） */
  | { type: 'hit'; kartId: string; by: string }
  /** 护盾挡下了一次 */
  | { type: 'blocked'; kartId: string };

export interface ItemSystemConfig {
  /** 随机种子。固定 -> 整局可复现 */
  seed: number;
  projectile: ProjectileConfig;
}

interface Slot {
  /** 手里攥着的道具，null = 空手 */
  held: ItemId | null;
  effects: EffectSet;
}

export class ItemSystem {
  readonly boxes: ItemBoxField;
  readonly projectiles: Projectile[] = [];
  readonly traps: Trap[] = [];
  readonly projectileConfig: ProjectileConfig;

  private readonly slots = new Map<string, Slot>();
  private readonly events: ItemEvent[] = [];
  private readonly rng: Rng;
  private readonly seed: number;
  private nextEntityId = 1;
  /** update 内部复用的临时数组，避免每帧新建 */
  private readonly pickups: BoxPickup[] = [];
  private readonly targets: ProjectileTarget[] = [];

  constructor(
    private readonly track: ItemTrack,
    boxes: ItemBoxField,
    config: Partial<ItemSystemConfig> = {},
  ) {
    this.boxes = boxes;
    this.seed = config.seed ?? 0x5eed;
    this.rng = createRng(this.seed);
    this.projectileConfig = { ...DEFAULT_PROJECTILE_CONFIG, ...config.projectile };
  }

  /** 每辆车开局注册一次 */
  register(id: string): void {
    if (!this.slots.has(id)) this.slots.set(id, { held: null, effects: new EffectSet() });
  }

  /** 重开一局：清空所有人的道具和效果、收掉场上的实体、箱子全复活 */
  reset(): void {
    for (const slot of this.slots.values()) {
      slot.held = null;
      slot.effects.clear();
    }
    this.projectiles.length = 0;
    this.traps.length = 0;
    this.events.length = 0;
    this.boxes.reset();
  }

  held(id: string): ItemId | null {
    return this.slots.get(id)?.held ?? null;
  }

  /**
   * 直接把道具塞给某辆车，绕过箱子和抽奖。
   * 调试面板用它验单个道具的手感，正常玩法走不到这里。
   */
  grant(id: string, item: ItemId | null): void {
    this.register(id);
    this.slots.get(id)!.held = item;
  }

  /** 这辆车身上挂着的效果。主循环用它改 KartConfig 副本 */
  effectsOf(id: string): EffectSet {
    let slot = this.slots.get(id);
    if (!slot) {
      slot = { held: null, effects: new EffectSet() };
      this.slots.set(id, slot);
    }
    return slot.effects;
  }

  /** 取走这一批事件（取完就清空）。HUD / 音效每渲染帧调一次 */
  consumeEvents(): ItemEvent[] {
    if (this.events.length === 0) return [];
    return this.events.splice(0, this.events.length);
  }

  /**
   * 推进一个物理子步。
   *
   * 顺序是有讲究的：
   *   1. 效果先走时间 —— 这一帧到期的效果不该再影响这一帧的判定
   *   2. 场上实体（投射物 / 陷阱）先结算 —— 新放下的东西下一帧才生效，
   *      不然刚出膛的投射物会在发射者脸上炸开
   *   3. 最后才处理箱子和"使用道具"
   */
  update(karts: readonly ItemKart[], dt: number): void {
    if (dt <= 0) return;

    this.syncTargets(karts);

    for (const kart of karts) this.effectsOf(kart.id).update(dt);

    this.stepProjectiles(dt);
    this.stepTraps(dt);
    this.collectBoxes(karts, dt);
    this.consumeUseRequests(karts);
  }

  // ------------------------------------------------------------------ 内部

  /** 把这一帧的车辆位置抄进碰撞判定用的数组 */
  private syncTargets(karts: readonly ItemKart[]): void {
    this.targets.length = 0;
    for (const k of karts) {
      this.targets.push({
        id: k.id,
        x: k.state.x,
        y: k.state.y,
        z: k.state.z,
        trackT: k.trackT,
      });
    }
  }

  private stepProjectiles(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const p = this.projectiles[i]!;
      const trackT = this.track.progressAt(p.x, p.z);
      const outcome = stepProjectile(p, trackT, this.track, this.targets, this.projectileConfig, dt);
      if (outcome.kind === 'alive') continue;
      if (outcome.kind === 'hit') this.applyHarm(outcome.targetId, p.ownerId, p.onHit);
      this.projectiles.splice(i, 1);
    }
  }

  private stepTraps(dt: number): void {
    for (let i = this.traps.length - 1; i >= 0; i--) {
      const trap = this.traps[i]!;
      const outcome = stepTrap(trap, this.targets, dt);
      if (outcome.hitId) this.applyHarm(outcome.hitId, trap.ownerId, trap.onHit);
      if (outcome.done) this.traps.splice(i, 1);
    }
  }

  private collectBoxes(karts: readonly ItemKart[], dt: number): void {
    this.boxes.update(dt, this.targets, this.pickups);
    for (const pickup of this.pickups) {
      const slot = this.slots.get(pickup.pickerId);
      // 手里还攥着一个就不再发货。箱子照样消失 —— 不然满手道具的人会把
      // 一整排箱子当成免费的路障一直碾着走
      if (!slot || slot.held !== null) continue;
      const kart = karts.find((k) => k.id === pickup.pickerId);
      if (!kart) continue;
      slot.held = rollItem(kart.place, karts.length, this.rng);
      this.events.push({ type: 'pickup', kartId: kart.id, item: slot.held });
    }
  }

  private consumeUseRequests(karts: readonly ItemKart[]): void {
    for (const kart of karts) {
      if (!kart.useItem) continue;
      const slot = this.slots.get(kart.id);
      if (!slot?.held) continue;
      const item = slot.held;
      slot.held = null;
      this.fire(ITEM_DEFS[item], kart, karts);
      this.events.push({ type: 'use', kartId: kart.id, item });
    }
  }

  /**
   * 执行一次使用。
   *
   * 这里只读 ItemOutcome 的字段和 def.targetType —— 没有任何一处按 id 分支。
   */
  private fire(def: ItemDef, user: ItemKart, karts: readonly ItemKart[]): void {
    const ctx: ItemUseContext = {
      userId: user.id,
      x: user.state.x,
      y: user.state.y,
      z: user.state.z,
      heading: user.state.heading,
      trackT: user.trackT,
      place: user.place,
      racerCount: karts.length,
    };
    const outcome = def.apply(ctx, this.rng);

    // 1. 自己吃的 boost：直接写状态，复用漂移 mini-turbo 那一套
    if (outcome.grantBoost) {
      const { level, duration } = outcome.grantBoost;
      // 手上还有更久的 boost 就别把它换短了（和 kartStep 里漂移结算的规则一致）
      if (duration >= user.state.boostTime) {
        user.state.boostTime = duration;
        user.state.boostLevel = level;
      }
    }

    // 2. 自己吃的效果
    if (outcome.selfEffects) {
      const set = this.effectsOf(user.id);
      for (const e of outcome.selfEffects) set.add(e);
    }

    // 3. 放陷阱：放在使用者**身后** dropBack 米处。
    //    放在脚下的话低速时自己就在半径里，armDelay 一过就自爆
    if (outcome.spawnTrap) {
      const t = outcome.spawnTrap;
      this.traps.push({
        id: this.nextEntityId++,
        ownerId: user.id,
        x: ctx.x - Math.sin(ctx.heading) * t.dropBack,
        y: ctx.y,
        z: ctx.z - Math.cos(ctx.heading) * t.dropBack,
        radius: t.radius,
        life: t.life,
        armDelay: t.armDelay,
        ownerGrace: t.ownerGrace,
        onHit: t.onHit,
      });
    }

    // 4. 发射投射物。锁定谁由 targetType 决定
    if (outcome.spawnProjectile) {
      const s = outcome.spawnProjectile;
      const backward = def.targetType === 'backward';
      const targetId = s.homing
        ? backward
          ? pickBackwardTarget(ctx.trackT, user.id, this.targets)
          : pickForwardTarget(ctx.trackT, user.id, this.targets)
        : null;
      this.projectiles.push({
        id: this.nextEntityId++,
        ownerId: user.id,
        x: ctx.x,
        y: ctx.y + this.projectileConfig.hoverHeight,
        z: ctx.z,
        heading: backward ? ctx.heading + Math.PI : ctx.heading,
        speed: s.speed,
        life: s.life,
        radius: s.radius,
        homing: s.homing,
        targetId,
        onHit: outcome.targetEffects ?? s.onHit,
      });
    }

    // 5. 直接生效的目标效果（没走投射物的那些，比如闪电）
    if (outcome.targetEffects && !outcome.spawnProjectile) {
      for (const targetId of this.selectTargets(def.targetType, ctx, karts)) {
        this.applyHarm(targetId, user.id, outcome.targetEffects);
      }
    }
  }

  /** 按 targetType 选目标。注意分支是对 targetType 的，不是对道具 id 的 */
  private selectTargets(
    targetType: ItemTargetType,
    ctx: Readonly<ItemUseContext>,
    karts: readonly ItemKart[],
  ): string[] {
    switch (targetType) {
      case 'self':
        return [ctx.userId];
      case 'allOthers':
        return karts.filter((k) => k.id !== ctx.userId).map((k) => k.id);
      case 'forward': {
        const id = pickForwardTarget(ctx.trackT, ctx.userId, this.targets);
        return id ? [id] : [];
      }
      case 'backward': {
        const id = pickBackwardTarget(ctx.trackT, ctx.userId, this.targets);
        return id ? [id] : [];
      }
    }
  }

  /**
   * 给别人挂负面效果。护盾在这里统一结算 ——
   * 所有伤害都必须走这个口子，不然新道具很容易忘了判护盾。
   */
  private applyHarm(targetId: string, byId: string, effects: readonly Effect[]): void {
    if (effects.length === 0) return;
    const set = this.effectsOf(targetId);
    if (set.consumeShield()) {
      this.events.push({ type: 'blocked', kartId: targetId });
      return;
    }
    for (const e of effects) set.add(e);
    this.events.push({ type: 'hit', kartId: targetId, by: byId });
  }
}
