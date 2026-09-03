import * as THREE from 'three';
import type { ChargeLevel } from '../kart/kartStep';
import { createSpawnParams, ParticlePool } from './ParticlePool';

/**
 * 漂移火花。
 *
 * **全场共用一个池子**：粒子存的是世界坐标，谁发射的根本无所谓，
 * 而每辆车各一个 Points 就是每辆车一个 drawcall。八辆车 8 个 vs 1 个，
 * 在 low 档 150 的预算下这个差别是要命的。
 *
 * 用法是"每辆车 emit 一次，每帧 step 一次"：
 *   for (车) sparks.emit(后轮世界坐标, 档位, dt, 路面高度);
 *   sparks.step(dt);
 */
export class DriftSparks {
  /** 每档的颜色：一档白、二档橙、三档蓝。越高越"冷"，一眼看得出满档了 */
  static readonly LEVEL_COLORS = [
    new THREE.Color('#fff6e0'),
    new THREE.Color('#ff9a2b'),
    new THREE.Color('#3fa9ff'),
  ] as const;

  /** 默认粒子池容量。实际用多少由画质档位给（QualitySettings.sparkCapacity） */
  static readonly DEFAULT_CAPACITY = 400;
  private static readonly LIFE = 0.38;
  /** 每个后轮每秒喷多少粒子 */
  private static readonly RATE = 110;

  private readonly pool: ParticlePool;
  private readonly spawn = createSpawnParams();
  /**
   * 发射的小数余量。全场共一个：多辆车分摊同一个余量，
   * 单辆车某一帧可能多喷或少喷一颗，平均速率还是对的，肉眼看不出来。
   */
  private accumulator = 0;

  constructor(capacity: number = DriftSparks.DEFAULT_CAPACITY) {
    this.pool = new ParticlePool({
      capacity,
      gravity: 14,
      additive: true, // 加色混合：颜色淡到黑就等于消失，不用再单独做透明度
      shape: 'spark',
      clampToGround: true, // 落地就停在地上，不穿到路面底下去
    });
  }

  get points(): THREE.Points {
    return this.pool.points;
  }

  get capacity(): number {
    return this.pool.capacity;
  }

  /** 活着的粒子数，给测试和调试用 */
  get activeCount(): number {
    return this.pool.activeCount;
  }

  /**
   * 一辆车这一帧的发射。
   * @param emitters 后轮世界坐标；不发射时传空数组
   * @param level    当前蓄力档位，0 = 不发射（还没成档就没火花）
   * @param groundY  当前路面高度。赛道有起伏，写死 0 的话上坡时火花会埋进路里
   */
  emit(emitters: readonly THREE.Vector3[], level: ChargeLevel, dt: number, groundY = 0): void {
    if (dt <= 0 || level <= 0 || emitters.length === 0) return;

    this.accumulator += DriftSparks.RATE * emitters.length * dt;
    const count = Math.floor(this.accumulator);
    this.accumulator -= count;

    const p = this.spawn;
    p.color = DriftSparks.LEVEL_COLORS[level - 1]!;
    p.jitter = 0.18;
    p.spread = 1.2;
    p.life = DriftSparks.LIFE;
    p.size = 0.34;
    p.endSize = 0.08; // 越飞越小，像溅出去的铁屑
    p.groundY = groundY;

    for (let i = 0; i < count; i++) {
      const origin = emitters[i % emitters.length]!;
      p.x = origin.x;
      // 从轮子底下冒出来：轮心往下挪一点，但不低于路面
      p.y = Math.max(groundY + 0.05, origin.y - 0.18);
      p.z = origin.z;

      // 向外上方喷一小簇
      const angle = Math.random() * Math.PI * 2;
      const speed = 1.6 + Math.random() * 3.4;
      p.vx = Math.cos(angle) * speed * 0.6;
      p.vy = 1.8 + Math.random() * 3.2;
      p.vz = Math.sin(angle) * speed * 0.6;
      this.pool.spawn(p);
    }
  }

  /** 每帧调一次，放在所有 emit 之后 */
  step(dt: number): void {
    this.pool.step(dt);
  }

  setViewportHeight(height: number): void {
    this.pool.setViewportHeight(height);
  }

  clear(): void {
    this.pool.clear();
    this.accumulator = 0;
  }

  dispose(): void {
    this.pool.dispose();
  }
}
