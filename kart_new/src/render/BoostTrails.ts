import * as THREE from 'three';

/**
 * boost 时车尾拖出来的一条飘带。
 *
 * **所有车的飘带在同一个几何体里**，每辆车固定占一段顶点区间，
 * 所以满场八条拖尾也只是 1 个 drawcall。不用粒子做是因为拖尾要的是
 * "连续的一条"，粒子做出来永远是断断续续的一串点。
 *
 * 每辆车的飘带是一条历史轨迹：每帧把车尾的位置推进一个环形队列，
 * 队列里的点两两之间张出一个四边形。宽度从头到尾收窄，透明度也跟着掉，
 * 所以看起来是"从车尾长出来、在身后化掉"。
 */
export class BoostTrails {
  readonly mesh: THREE.Mesh;

  /** 每条飘带记多少个历史点。16 个 × 每帧一个 ≈ 0.27 秒的尾巴 */
  private static readonly SEGMENTS = 16;
  /** 飘带最宽处（米），大约是车宽 */
  private static readonly WIDTH = 0.85;

  private readonly count: number;
  private readonly position: Float32Array;
  private readonly color: Float32Array;
  private readonly alpha: Float32Array;
  /** 每辆车的历史点：[x,y,z, sideX,sideZ] × SEGMENTS */
  private readonly history: Float32Array;
  /** 每辆车当前的强度 0..1，boost 结束后自己衰减到 0 */
  private readonly strength: Float32Array;
  private readonly historyValid: Uint8Array;

  private readonly tint = new THREE.Color();

  constructor(count: number) {
    this.count = Math.max(1, count);
    const seg = BoostTrails.SEGMENTS;
    const verts = this.count * seg * 2;

    this.position = new Float32Array(verts * 3);
    this.color = new Float32Array(verts * 3);
    this.alpha = new Float32Array(verts);
    this.history = new Float32Array(this.count * seg * 5);
    this.strength = new Float32Array(this.count);
    this.historyValid = new Uint8Array(this.count);

    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.color, 3));
    geometry.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1));

    // 索引是固定的：第 k 辆车的第 i 段是四个顶点两个三角形，建一次就不动了
    const indices: number[] = [];
    for (let k = 0; k < this.count; k++) {
      const base = k * seg * 2;
      for (let i = 0; i < seg - 1; i++) {
        const a = base + i * 2;
        indices.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
      }
    }
    geometry.setIndex(indices);
    geometry.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);

    this.mesh = new THREE.Mesh(
      geometry,
      new THREE.ShaderMaterial({
        vertexShader: TRAIL_VERT,
        fragmentShader: TRAIL_FRAG,
        transparent: true,
        // 同 ParticlePool：不开这个就没有 `attribute vec3 color`
        vertexColors: true,
        depthWrite: false,
        side: THREE.DoubleSide,
        blending: THREE.AdditiveBlending,
      }),
    );
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 2;
  }

  /**
   * 推一帧。**每辆车每帧都要调**（包括没在 boost 的），否则它的尾巴不会化掉。
   *
   * @param index    车的编号，0..count-1
   * @param tailX/Y/Z 车尾的世界坐标
   * @param heading  车的朝向（弧度），用来算飘带的横向
   * @param intensity 0..1，0 = 不在 boost（尾巴开始收）
   */
  push(
    index: number,
    tailX: number,
    tailY: number,
    tailZ: number,
    heading: number,
    intensity: number,
    colorHex: string,
    frameDt: number,
  ): void {
    if (index < 0 || index >= this.count) return;
    const seg = BoostTrails.SEGMENTS;

    // 强度：起来得快（一下就有），落下去慢一点（尾巴化开）
    const target = Math.max(0, Math.min(intensity, 1));
    const rate = target > this.strength[index]! ? 26 : 5;
    this.strength[index] = lerp(this.strength[index]!, target, 1 - Math.exp(-rate * frameDt));

    // 车的横向 = 朝向转 90°。飘带要贴着车尾横过来，不然从正后方看就是一条线
    const sideX = Math.cos(heading);
    const sideZ = -Math.sin(heading);

    const h = index * seg * 5;
    if (!this.historyValid[index]) {
      // 第一次：整条队列填成同一个点，免得从原点拉出一条几百米的带子
      for (let i = 0; i < seg; i++) {
        const o = h + i * 5;
        this.history[o] = tailX;
        this.history[o + 1] = tailY;
        this.history[o + 2] = tailZ;
        this.history[o + 3] = sideX;
        this.history[o + 4] = sideZ;
      }
      this.historyValid[index] = 1;
    } else {
      // 整体后移一格，新点写在 0 号位（0 号 = 车尾，seg-1 = 最老）
      this.history.copyWithin(h + 5, h, h + (seg - 1) * 5);
      this.history[h] = tailX;
      this.history[h + 1] = tailY;
      this.history[h + 2] = tailZ;
      this.history[h + 3] = sideX;
      this.history[h + 4] = sideZ;
    }

    this.tint.set(colorHex);
    const s = this.strength[index]!;
    const base = index * seg * 2;
    for (let i = 0; i < seg; i++) {
      const o = h + i * 5;
      const x = this.history[o]!;
      const y = this.history[o + 1]!;
      const z = this.history[o + 2]!;
      const halfWidth = (BoostTrails.WIDTH / 2) * s * (1 - i / seg);
      const hx = this.history[o + 3]! * halfWidth;
      const hz = this.history[o + 4]! * halfWidth;

      const v = (base + i * 2) * 3;
      this.position[v] = x - hx;
      this.position[v + 1] = y;
      this.position[v + 2] = z - hz;
      this.position[v + 3] = x + hx;
      this.position[v + 4] = y;
      this.position[v + 5] = z + hz;

      for (let k = 0; k < 2; k++) {
        const c = v + k * 3;
        this.color[c] = this.tint.r;
        this.color[c + 1] = this.tint.g;
        this.color[c + 2] = this.tint.b;
        // 越靠后越淡（平方衰减，尾巴化得干净一点）
        this.alpha[base + i * 2 + k] = s * (1 - i / seg) ** 2;
      }
    }
  }

  /** 所有车都 push 完之后调一次 */
  flush(): void {
    const attrs = this.mesh.geometry.attributes;
    attrs.position!.needsUpdate = true;
    attrs.color!.needsUpdate = true;
    attrs.aAlpha!.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  /** 重开一局：把历史抹掉，否则会从旧位置拉出一条横跨全场的带子 */
  clear(): void {
    this.historyValid.fill(0);
    this.strength.fill(0);
    this.alpha.fill(0);
    this.flush();
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as THREE.Material).dispose();
  }
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

const TRAIL_VERT = /* glsl */ `
  attribute float aAlpha;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vColor = color;
    vAlpha = aAlpha;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const TRAIL_FRAG = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    if (vAlpha < 0.01) discard;
    gl_FragColor = vec4(vColor, vAlpha);
    #include <colorspace_fragment>
  }
`;
