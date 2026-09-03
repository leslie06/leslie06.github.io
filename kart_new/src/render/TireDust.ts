import * as THREE from 'three';
import { createSpawnParams, ParticlePool } from './ParticlePool';

/**
 * 轮胎扬尘。漂移时和跑到路肩/草地上时从轮子底下扬起来。
 *
 * 和火花是两个池子而不是一个，因为它们的物理和混合方式正相反：
 * 火花是加色混合、往下掉、越飞越小；烟尘是普通混合、往上飘、越飘越大越淡。
 * 塞进一个池子就得给每颗粒子加一堆开关，那比多一个 drawcall 贵。
 *
 * 全场共用一个池（同 DriftSparks）：粒子是世界坐标的。
 */
export class TireDust {
  private static readonly LIFE = 0.75;
  /** 每个轮子每秒扬多少 */
  private static readonly RATE = 26;

  /** 路面上的尘是浅灰，越野时是土黄 —— 一眼能看出压到草地上了 */
  private static readonly ROAD_COLOR = new THREE.Color('#d8d2c4');
  private static readonly OFFROAD_COLOR = new THREE.Color('#c2a874');

  private readonly pool: ParticlePool;
  private readonly spawn = createSpawnParams();
  private accumulator = 0;

  constructor(capacity: number) {
    this.pool = new ParticlePool({
      capacity,
      gravity: -1.2, // 负重力 = 往上飘
      drag: 2.2, // 很快就飘不动了，停在原地慢慢散
      additive: false,
      shape: 'smoke',
    });
  }

  get points(): THREE.Points {
    return this.pool.points;
  }

  get activeCount(): number {
    return this.pool.activeCount;
  }

  /**
   * @param emitters 轮子世界坐标
   * @param intensity 0..1，扬多少。漂移档位越高、速度越快就越多
   * @param offroad 是不是压在路面之外（换土黄色）
   */
  emit(
    emitters: readonly THREE.Vector3[],
    intensity: number,
    dt: number,
    groundY: number,
    offroad: boolean,
  ): void {
    if (dt <= 0 || intensity <= 0.01 || emitters.length === 0) return;

    this.accumulator += TireDust.RATE * emitters.length * intensity * dt;
    const count = Math.floor(this.accumulator);
    this.accumulator -= count;

    const p = this.spawn;
    p.color = offroad ? TireDust.OFFROAD_COLOR : TireDust.ROAD_COLOR;
    p.jitter = 0.3;
    p.spread = 0.9;
    p.life = TireDust.LIFE * (0.7 + 0.6 * intensity);
    p.size = 0.5;
    p.endSize = 1.5; // 边飘边散开
    p.groundY = groundY;

    for (let i = 0; i < count; i++) {
      const origin = emitters[i % emitters.length]!;
      p.x = origin.x;
      p.y = groundY + 0.12; // 从地面起，不是从轮心
      p.z = origin.z;
      p.vx = (Math.random() - 0.5) * 1.4;
      p.vy = 0.6 + Math.random() * 0.9;
      p.vz = (Math.random() - 0.5) * 1.4;
      this.pool.spawn(p);
    }
  }

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
