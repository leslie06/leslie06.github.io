/**
 * 道具箱。纯逻辑，不 import three / rapier。
 *
 * 箱子是世界里的固定圆：车碾过去就消失、开始重生倒计时，倒计时走完再冒出来。
 * 判定用世界坐标而不是 (t, lateral)：进度 t 在终点线附近会绕回去，
 * 拿它做距离判定要处理折返，而世界坐标没这个问题。
 */

export interface ItemBoxConfig {
  /** 拾取半径（米）。车身半径 ~1.2，箱子看着 1.5 见方，给 2.4 手感刚好 */
  radius: number;
  /**
   * 被吃掉之后多久重生（秒）。
   *
   * 这个值直接决定队尾能不能吃到道具：八辆车通过同一排箱子要 2~3 秒，
   * 定太长（试过 4 秒）的话领头几辆把整排吃光，从最后一格发车的玩家一路空手。
   * 定太短又变成"停在箱子上刷道具"。2.5 秒是这两头之间。
   */
  respawnDelay: number;
}

export const DEFAULT_ITEM_BOX_CONFIG: ItemBoxConfig = {
  radius: 2.4,
  respawnDelay: 2.5,
};

/** GUI 滑条范围，和 KART_CONFIG_RANGES 同一套写法 */
export const ITEM_BOX_RANGES: Record<keyof ItemBoxConfig, [number, number, number]> = {
  radius: [0.5, 8, 0.1],
  respawnDelay: [0.5, 20, 0.5],
};

export interface ItemBox {
  /** 场上唯一序号，渲染层按它复用 mesh */
  index: number;
  x: number;
  y: number;
  z: number;
  /** false = 已经被吃了，正在等重生 */
  active: boolean;
  /** 还有多久重生。active 为 true 时恒为 0 */
  respawnIn: number;
}

/** 碰撞判定要的最小车辆信息 */
export interface BoxPicker {
  id: string;
  x: number;
  y: number;
  z: number;
}

export interface BoxPickup {
  /** 谁吃到的 */
  pickerId: string;
  /** 吃的是哪个箱子 */
  boxIndex: number;
}

/** 高度差超过这个不算碾到（立体交叉的上下两层路） */
const MAX_HEIGHT_DIFF = 3;
/** 车身半径，和 kartCollision / Projectile 里用的是同一个量级 */
const KART_RADIUS = 1.2;

export class ItemBoxField {
  readonly boxes: ItemBox[];
  readonly config: ItemBoxConfig;

  constructor(
    placements: readonly { x: number; y: number; z: number }[],
    config: Partial<ItemBoxConfig> = {},
  ) {
    this.config = { ...DEFAULT_ITEM_BOX_CONFIG, ...config };
    this.boxes = placements.map((p, index) => ({
      index,
      x: p.x,
      y: p.y,
      z: p.z,
      active: true,
      respawnIn: 0,
    }));
  }

  /** 重开一局：全部复活 */
  reset(): void {
    for (const box of this.boxes) {
      box.active = true;
      box.respawnIn = 0;
    }
  }

  /**
   * 走一帧：先跑重生倒计时，再判定这一帧谁碾到了谁。
   *
   * 一辆车一帧只会吃到一个箱子（同一排箱子挨得近，不做这个限制的话
   * 从中间穿过去能一次吃两个）。
   *
   * @param out 复用的结果数组，会被清空后写入
   */
  update(dt: number, karts: readonly BoxPicker[], out: BoxPickup[] = []): BoxPickup[] {
    out.length = 0;
    if (dt <= 0) return out;

    for (const box of this.boxes) {
      if (box.active) continue;
      box.respawnIn -= dt;
      if (box.respawnIn <= 0) {
        box.active = true;
        box.respawnIn = 0;
      }
    }

    const hitDist = this.config.radius + KART_RADIUS;
    const hitDist2 = hitDist * hitDist;
    const taken = new Set<string>();

    for (const box of this.boxes) {
      if (!box.active) continue;
      for (const kart of karts) {
        if (taken.has(kart.id)) continue;
        if (Math.abs(kart.y - box.y) > MAX_HEIGHT_DIFF) continue;
        const dx = kart.x - box.x;
        const dz = kart.z - box.z;
        if (dx * dx + dz * dz > hitDist2) continue;

        box.active = false;
        box.respawnIn = this.config.respawnDelay;
        taken.add(kart.id);
        out.push({ pickerId: kart.id, boxIndex: box.index });
        break;
      }
    }
    return out;
  }
}
