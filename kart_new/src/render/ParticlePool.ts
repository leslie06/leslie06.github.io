/**
 * 通用粒子池。火花、扬尘、命中爆闪全都用它。
 *
 * 三条设计约束：
 *
 * 1. **一个池子 = 一个 drawcall。** 所以粒子存的是**世界坐标**，池子挂在 scene 上，
 *    全场所有车共用一个池 —— 每辆车各一个池的话八辆车就是八个 drawcall，
 *    而 low 档的总预算才 150 个。
 *
 * 2. **全程零分配。** 容量在构造时定死（typed array 建好就改不了大小），
 *    发射是覆盖最老的那一格（环形游标）。spawn 的参数走一个复用的描述对象，
 *    不接收字面量 —— 每帧几百次 `{...}` 是实打实的 GC 压力。
 *
 * 3. **每颗粒子有自己的大小和透明度**，所以用 ShaderMaterial 而不是 PointsMaterial
 *    （后者的 size 是整个材质一个值）。扬尘要"边飘边变大变淡"，火花要"越来越小"，
 *    这两件事没有 per-particle size 就做不了。
 */
import * as THREE from 'three';

export interface ParticlePoolOptions {
  /** 池子容量。建好不可变 */
  capacity: number;
  /** 重力加速度（m/s²，向下为正）。火花 14，烟尘 -1.5（往上飘） */
  gravity?: number;
  /** 每秒衰减掉的速度比例。0 = 不衰减，5 = 烟尘那种很快就飘不动了 */
  drag?: number;
  /** 加色混合（火花）还是普通混合（烟尘） */
  additive?: boolean;
  /** 贴图形状：'spark' 中心硬边缘软，'smoke' 整体柔和 */
  shape?: 'spark' | 'smoke';
  /** 粒子落到地面就停住（火花要，烟尘不要） */
  clampToGround?: boolean;
}

/**
 * 发射一颗粒子的参数。**复用同一个对象**，调用方填完字段再交给 spawn()。
 * 速度是"基础方向 + 随机扩散"两段式：调用方给方向，池子负责撒开。
 */
export interface SpawnParams {
  x: number;
  y: number;
  z: number;
  /** 初速度 */
  vx: number;
  vy: number;
  vz: number;
  /** 位置的随机抖动半径（米） */
  jitter: number;
  /** 速度的随机扩散（m/s） */
  spread: number;
  color: THREE.Color;
  /** 出生时的大小（米） */
  size: number;
  /** 寿命结束时的大小（米）。比 size 大 = 边飘边散开 */
  endSize: number;
  life: number;
  /** 地面高度，clampToGround 时用 */
  groundY: number;
}

export function createSpawnParams(): SpawnParams {
  return {
    x: 0, y: 0, z: 0,
    vx: 0, vy: 0, vz: 0,
    jitter: 0, spread: 0,
    color: new THREE.Color(1, 1, 1),
    size: 0.4, endSize: 0.4,
    life: 0.4, groundY: 0,
  };
}

export class ParticlePool {
  readonly points: THREE.Points;
  readonly capacity: number;

  private readonly position: Float32Array;
  private readonly color: Float32Array;
  private readonly sizeAttr: Float32Array;
  private readonly alphaAttr: Float32Array;

  private readonly velocity: Float32Array;
  private readonly baseColor: Float32Array;
  private readonly life: Float32Array;
  private readonly maxLife: Float32Array;
  private readonly size0: Float32Array;
  private readonly size1: Float32Array;
  private readonly groundY: Float32Array;

  private readonly gravity: number;
  private readonly drag: number;
  private readonly clampToGround: boolean;
  private cursor = 0;
  private live = 0;
  private dirty = false;

  constructor(options: ParticlePoolOptions) {
    const n = (this.capacity = Math.max(1, Math.floor(options.capacity)));
    this.gravity = options.gravity ?? 14;
    this.drag = options.drag ?? 0;
    this.clampToGround = options.clampToGround ?? false;

    this.position = new Float32Array(n * 3);
    this.color = new Float32Array(n * 3);
    this.baseColor = new Float32Array(n * 3);
    this.velocity = new Float32Array(n * 3);
    this.sizeAttr = new Float32Array(n);
    this.alphaAttr = new Float32Array(n);
    this.life = new Float32Array(n);
    this.maxLife = new Float32Array(n);
    this.size0 = new Float32Array(n);
    this.size1 = new Float32Array(n);
    this.groundY = new Float32Array(n);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.color, 3));
    geometry.setAttribute('aSize', new THREE.BufferAttribute(this.sizeAttr, 1));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alphaAttr, 1));
    // 粒子在世界空间随处乱飞，按包围盒剔除会误剔（而且每帧重算包围盒本身就不便宜）
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    const material = new THREE.ShaderMaterial({
      // 雾的 uniform 必须**自己合并进来**。three 只给内置材质自动挂 fog uniform，
      // ShaderMaterial 光写 fog: true 和 #include <fog_*> 是不够的：
      // 渲染时 refreshFogUniforms 会去读 uniforms.fogColor，读到 undefined 直接抛，
      // 整个 render 就断在那儿了（表现是白屏 + 一条 "Cannot read properties of
      // undefined (reading 'value')"，堆栈里完全看不出是哪个材质）
      uniforms: THREE.UniformsUtils.merge([
        THREE.UniformsLib.fog,
        {
          uTexture: { value: null },
          // gl_PointSize 是**物理像素**，所以这里要的是 drawingBuffer 的高度（已含 dpr）
          uScale: { value: 300 },
        },
      ]),
      vertexShader: PARTICLE_VERT,
      fragmentShader: PARTICLE_FRAG,
      transparent: true,
      // 每颗粒子有自己的颜色。ShaderMaterial 只有在这个开关打开时
      // 才会给着色器注入 `attribute vec3 color`，不开的话着色器直接编译失败
      vertexColors: true,
      depthWrite: false, // 粒子之间不该互相遮挡出硬边
      depthTest: true,
      blending: options.additive === false ? THREE.NormalBlending : THREE.AdditiveBlending,
      // 粒子自己发光/自己是烟，不吃场景雾会在远处很突兀，所以让它吃
      fog: true,
    });

    // 贴图在 merge 之后再塞：UniformsUtils.merge 会克隆传进去的值，
    // 直接写在字面量里的话拿到的是克隆品，dispose 时释放的就不是同一个对象
    material.uniforms.uTexture!.value = makeParticleTexture(options.shape ?? 'spark');

    this.points = new THREE.Points(geometry, material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 2; // 在不透明物体之后画
  }

  /** 活着的粒子数。测试和调试面板用 */
  get activeCount(): number {
    return this.live;
  }

  /**
   * 屏幕尺寸变了要重设，否则粒子的像素大小会跟着分辨率漂。
   * @param drawingBufferHeight renderer.getDrawingBufferSize().y（含像素比）
   */
  setViewportHeight(drawingBufferHeight: number): void {
    (this.points.material as THREE.ShaderMaterial).uniforms.uScale!.value =
      drawingBufferHeight * 0.5;
  }

  /** 发一颗。池子满了就覆盖最老的那一颗 —— 宁可截断也不分配 */
  spawn(p: Readonly<SpawnParams>): void {
    const i = this.cursor;
    this.cursor = (this.cursor + 1) % this.capacity;
    if (this.life[i]! <= 0) this.live++;
    const o = i * 3;

    this.position[o] = p.x + (Math.random() - 0.5) * p.jitter;
    this.position[o + 1] = p.y + (Math.random() - 0.5) * p.jitter;
    this.position[o + 2] = p.z + (Math.random() - 0.5) * p.jitter;

    this.velocity[o] = p.vx + (Math.random() - 0.5) * p.spread;
    this.velocity[o + 1] = p.vy + (Math.random() - 0.5) * p.spread;
    this.velocity[o + 2] = p.vz + (Math.random() - 0.5) * p.spread;

    this.baseColor[o] = p.color.r;
    this.baseColor[o + 1] = p.color.g;
    this.baseColor[o + 2] = p.color.b;
    this.color[o] = p.color.r;
    this.color[o + 1] = p.color.g;
    this.color[o + 2] = p.color.b;

    this.size0[i] = p.size;
    this.size1[i] = p.endSize;
    this.sizeAttr[i] = p.size;
    this.alphaAttr[i] = 1;
    this.life[i] = p.life;
    this.maxLife[i] = p.life;
    this.groundY[i] = p.groundY;
    this.dirty = true;
  }

  /** 推进一帧。每帧调**一次**，发射走 spawn() */
  step(dt: number): void {
    if (dt <= 0 || this.live === 0) {
      this.flush();
      return;
    }
    const decay = this.drag > 0 ? Math.exp(-this.drag * dt) : 1;
    let live = 0;

    for (let i = 0; i < this.capacity; i++) {
      const remaining = this.life[i]!;
      if (remaining <= 0) continue;
      const next = remaining - dt;
      const o = i * 3;
      if (next <= 0) {
        this.life[i] = 0;
        this.alphaAttr[i] = 0;
        continue;
      }
      live++;
      this.life[i] = next;

      let vy = this.velocity[o + 1]! - this.gravity * dt;
      let vx = this.velocity[o]!;
      let vz = this.velocity[o + 2]!;
      if (decay !== 1) {
        vx *= decay;
        vy *= decay;
        vz *= decay;
      }
      this.velocity[o] = vx;
      this.velocity[o + 1] = vy;
      this.velocity[o + 2] = vz;

      this.position[o] = this.position[o]! + vx * dt;
      this.position[o + 1] = this.position[o + 1]! + vy * dt;
      this.position[o + 2] = this.position[o + 2]! + vz * dt;

      if (this.clampToGround) {
        const floor = this.groundY[i]! + 0.02;
        if (this.position[o + 1]! < floor) {
          this.position[o + 1] = floor;
          this.velocity[o + 1] = 0;
        }
      }

      // k = 剩余寿命比例，1 -> 0
      const k = next / this.maxLife[i]!;
      this.sizeAttr[i] = this.size1[i]! + (this.size0[i]! - this.size1[i]!) * k;
      // 透明度按剩余寿命衰减，但前 15% 有一个淡入，免得凭空"啪"地出现一颗
      const age = 1 - k;
      this.alphaAttr[i] = k * (age < 0.15 ? age / 0.15 : 1);
    }

    this.live = live;
    this.dirty = true;
    this.flush();
  }

  private flush(): void {
    if (!this.dirty) return;
    this.dirty = false;
    const attrs = this.points.geometry.attributes;
    attrs.position!.needsUpdate = true;
    attrs.color!.needsUpdate = true;
    attrs.aSize!.needsUpdate = true;
    attrs.aAlpha!.needsUpdate = true;
  }

  /** 全部熄灭（重开一局时用，不然上一局的火花会飘在新赛道上） */
  clear(): void {
    this.life.fill(0);
    this.alphaAttr.fill(0);
    this.live = 0;
    this.dirty = true;
    this.flush();
  }

  dispose(): void {
    this.points.geometry.dispose();
    const material = this.points.material as THREE.ShaderMaterial;
    (material.uniforms.uTexture!.value as THREE.Texture).dispose();
    material.dispose();
  }
}

/**
 * 顶点着色器。
 *
 * gl_PointSize 里带上 projectionMatrix[1][1]（= 1 / tan(fov/2)）而不是照抄 three
 * 内置的那套：boost 的时候相机 FOV 会被推出去十几度，不带这一项的话粒子的
 * 屏幕大小不会跟着变，看着就像粒子突然被"拉近"了。
 */
const PARTICLE_VERT = /* glsl */ `
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;

  #include <fog_pars_vertex>

  void main() {
    vColor = color;
    vAlpha = aAlpha;
    vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = max(aSize * uScale * projectionMatrix[1][1] / -mvPosition.z, 1.0);
    gl_Position = projectionMatrix * mvPosition;
    #include <fog_vertex>
  }
`;

const PARTICLE_FRAG = /* glsl */ `
  uniform sampler2D uTexture;
  varying vec3 vColor;
  varying float vAlpha;

  #include <fog_pars_fragment>

  void main() {
    vec4 tex = texture2D(uTexture, gl_PointCoord);
    float alpha = tex.a * vAlpha;
    if (alpha < 0.01) discard;
    gl_FragColor = vec4(vColor * tex.rgb, alpha);
    #include <colorspace_fragment>
    #include <fog_fragment>
  }
`;

/**
 * 粒子贴图。程序化画的，不占资源预算。
 * spark 中间是个亮核（bloom 会挑中它），smoke 从中心就开始软下去。
 */
function makeParticleTexture(shape: 'spark' | 'smoke'): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  if (shape === 'spark') {
    gradient.addColorStop(0, 'rgba(255,255,255,1)');
    gradient.addColorStop(0.25, 'rgba(255,255,255,0.95)');
    gradient.addColorStop(0.6, 'rgba(255,255,255,0.35)');
  } else {
    // 烟尘从中心就开始软下去，而且整体压得比火花淡得多 ——
    // 中心画到 0.85 的话一团尘就是一块糊在路面上的白斑
    gradient.addColorStop(0, 'rgba(255,255,255,0.5)');
    gradient.addColorStop(0.45, 'rgba(255,255,255,0.26)');
  }
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
