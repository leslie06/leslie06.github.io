import * as THREE from 'three';
import type { ChargeLevel } from '../kart/kartStep';

/**
 * 漂移火花。用一个固定容量的 Points 池，循环覆盖最老的粒子，
 * 全程不分配新对象。
 *
 * 粒子存在**世界坐标**里，所以必须挂到 scene 上而不是车上 ——
 * 挂车上的话火花会跟着车一起走，看不出甩在身后的效果。
 */
export class DriftSparks {
  readonly points: THREE.Points;

  /** 每档的颜色：一档蓝、二档橙、三档粉紫 */
  static readonly LEVEL_COLORS = [
    new THREE.Color('#4db8ff'),
    new THREE.Color('#ffa62b'),
    new THREE.Color('#ff4fd8'),
  ] as const;

  /** 默认粒子池容量。实际用多少由画质档位给（QualitySettings.sparkCapacity） */
  static readonly DEFAULT_CAPACITY = 400;
  private static readonly LIFE = 0.38;
  /** 每个后轮每秒喷多少粒子 */
  private static readonly RATE = 110;

  /** 这一份火花的池子容量。低画质档位会开小一点 */
  readonly capacity: number;

  private readonly positions: Float32Array;
  private readonly colors: Float32Array;
  private readonly velocities: Float32Array;
  private readonly life: Float32Array;
  private readonly baseColor: Float32Array;
  private cursor = 0;
  private emitAccumulator = 0;

  constructor(capacity: number = DriftSparks.DEFAULT_CAPACITY) {
    const n = (this.capacity = Math.max(1, Math.floor(capacity)));
    this.positions = new Float32Array(n * 3);
    this.colors = new Float32Array(n * 3);
    this.velocities = new Float32Array(n * 3);
    this.baseColor = new Float32Array(n * 3);
    this.life = new Float32Array(n);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    // 粒子在世界空间随处乱飞，视锥剔除按包围盒算会误剔，直接关掉
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.points = new THREE.Points(
      geometry,
      new THREE.PointsMaterial({
        size: 0.42,
        sizeAttenuation: true,
        vertexColors: true,
        transparent: true,
        depthWrite: false,
        // 加色混合：颜色淡到黑就等于消失，不用再单独做透明度
        blending: THREE.AdditiveBlending,
      }),
    );
    this.points.frustumCulled = false;
  }

  /**
   * @param emitters 后轮世界坐标；不发射时传空数组
   * @param level    当前蓄力档位，0 = 不发射（还没成档就没火花）
   * @param groundY  当前路面高度。赛道有起伏，写死 0 的话上坡时火花会埋进路里
   */
  update(
    emitters: readonly THREE.Vector3[],
    level: ChargeLevel,
    dt: number,
    groundY = 0,
  ): void {
    if (dt <= 0) return;

    // --- 发射 ---
    if (level > 0 && emitters.length > 0) {
      this.emitAccumulator += DriftSparks.RATE * emitters.length * dt;
      const count = Math.floor(this.emitAccumulator);
      this.emitAccumulator -= count;
      const color = DriftSparks.LEVEL_COLORS[level - 1]!;
      for (let i = 0; i < count; i++) {
        this.spawn(emitters[i % emitters.length]!, color, groundY);
      }
    } else {
      this.emitAccumulator = 0;
    }

    // --- 推进 ---
    const n = this.capacity;
    for (let i = 0; i < n; i++) {
      if (this.life[i]! <= 0) continue;
      const remaining = (this.life[i] = this.life[i]! - dt);
      const o = i * 3;
      if (remaining <= 0) {
        this.colors[o] = this.colors[o + 1] = this.colors[o + 2] = 0;
        continue;
      }
      this.velocities[o + 1] = this.velocities[o + 1]! - 14 * dt; // 重力
      this.positions[o] = this.positions[o]! + this.velocities[o]! * dt;
      this.positions[o + 1] = this.positions[o + 1]! + this.velocities[o + 1]! * dt;
      this.positions[o + 2] = this.positions[o + 2]! + this.velocities[o + 2]! * dt;
      // 落地就停在地面上，不穿到地下去
      if (this.positions[o + 1]! < groundY + 0.02) {
        this.positions[o + 1] = groundY + 0.02;
        this.velocities[o + 1] = 0;
      }
      // 亮度按剩余寿命衰减
      const k = remaining / DriftSparks.LIFE;
      this.colors[o] = this.baseColor[o]! * k;
      this.colors[o + 1] = this.baseColor[o + 1]! * k;
      this.colors[o + 2] = this.baseColor[o + 2]! * k;
    }

    this.points.geometry.getAttribute('position').needsUpdate = true;
    this.points.geometry.getAttribute('color').needsUpdate = true;
  }

  private spawn(origin: THREE.Vector3, color: THREE.Color, groundY: number): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    const o = i * 3;

    this.positions[o] = origin.x + (Math.random() - 0.5) * 0.18;
    // 从轮子底下冒出来：轮心往下挪一点，但不低于路面
    this.positions[o + 1] = Math.max(groundY + 0.05, origin.y - 0.18);
    this.positions[o + 2] = origin.z + (Math.random() - 0.5) * 0.18;

    // 向外上方喷一小簇
    const angle = Math.random() * Math.PI * 2;
    const speed = 1.6 + Math.random() * 3.4;
    this.velocities[o] = Math.cos(angle) * speed * 0.6;
    this.velocities[o + 1] = 1.8 + Math.random() * 3.2;
    this.velocities[o + 2] = Math.sin(angle) * speed * 0.6;

    this.baseColor[o] = color.r;
    this.baseColor[o + 1] = color.g;
    this.baseColor[o + 2] = color.b;
    this.colors[o] = color.r;
    this.colors[o + 1] = color.g;
    this.colors[o + 2] = color.b;
    this.life[i] = DriftSparks.LIFE;
  }

  /** 活着的粒子数，给测试和调试用 */
  get activeCount(): number {
    let n = 0;
    for (let i = 0; i < this.capacity; i++) if (this.life[i]! > 0) n++;
    return n;
  }
}
