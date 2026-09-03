import * as THREE from 'three';
import { createSpawnParams, ParticlePool } from './ParticlePool';

/**
 * 一次性的爆闪：道具命中、撞墙、撞车。
 *
 * 爆闪 = **一颗很大的短命粒子** + 一圈向外扩散的小粒子，共用同一个池子。
 * 用粒子而不是单独做一个发光片，是因为那样就得再来一个 drawcall 和一套
 * billboard 的代码；一颗 size 从 3m 涨到 7m、活 0.18 秒的加色粒子，
 * 在 bloom 之后看起来就是一团炸开的白光，效果一样而代码是零。
 *
 * 全场一个池子，1 个 drawcall。
 */
export class ImpactFx {
  private static readonly FLASH_LIFE = 0.18;
  private static readonly SHARD_LIFE = 0.5;

  private readonly pool: ParticlePool;
  private readonly spawn = createSpawnParams();
  private readonly color = new THREE.Color();

  constructor(capacity: number) {
    this.pool = new ParticlePool({
      capacity,
      gravity: 6,
      drag: 1.6,
      additive: true,
      shape: 'spark',
    });
  }

  get points(): THREE.Points {
    return this.pool.points;
  }

  get activeCount(): number {
    return this.pool.activeCount;
  }

  /**
   * 炸一下。
   * @param scale 规模。1 = 道具命中，0.4 = 蹭一下墙
   * @param shards 扩散粒子数量。池子小的档位（low 只有 60）会被 spawn 自己截断，
   *               表现是"火星少一点"，不会出错
   */
  burst(x: number, y: number, z: number, colorHex: string, scale = 1, shards = 26): void {
    this.color.set(colorHex);
    const p = this.spawn;
    p.color = this.color;
    p.groundY = y - 1;

    // 1. 中心那一团光
    p.x = x;
    p.y = y;
    p.z = z;
    p.vx = p.vy = p.vz = 0;
    p.jitter = 0;
    p.spread = 0;
    p.size = 2.2 * scale;
    p.endSize = 5.5 * scale;
    p.life = ImpactFx.FLASH_LIFE;
    this.pool.spawn(p);

    // 2. 向各个方向飞出去的碎光
    p.jitter = 0.25;
    p.spread = 1.5 * scale;
    p.size = 0.55 * scale;
    p.endSize = 0.1;
    p.life = ImpactFx.SHARD_LIFE;
    for (let i = 0; i < shards; i++) {
      // 球面上均匀取方向：cos 分布，不然会在两极堆积
      const theta = Math.random() * Math.PI * 2;
      const cosPhi = Math.random() * 1.4 - 0.4; // 略偏上，往地里钻的没意义
      const sinPhi = Math.sqrt(Math.max(0, 1 - cosPhi * cosPhi));
      const speed = (5 + Math.random() * 7) * scale;
      p.vx = Math.cos(theta) * sinPhi * speed;
      p.vy = cosPhi * speed;
      p.vz = Math.sin(theta) * sinPhi * speed;
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
  }

  dispose(): void {
    this.pool.dispose();
  }
}
