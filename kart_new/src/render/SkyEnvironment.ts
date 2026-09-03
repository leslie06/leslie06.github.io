/**
 * 天空 + 环境光。
 *
 * 明亮卡通的关键其实不在主光源，而在**环境光**：低多边形模型的背光面如果只剩
 * 一个常数环境色，整台车会像一张贴纸。所以这里生成一张 PMREM 环境贴图挂到
 * scene.environment 上，背光面就带上了天空的蓝和地面的反光，塑料质感立刻出来。
 *
 * 环境贴图的来源有两个，接口一样：
 *   - **程序化渐变天空**（默认）：一个 shader 渐变球，PMREMGenerator.fromScene 预处理。
 *     不占一个字节的下载量，也不用等资源到位，所以它是缺省路径；
 *   - **HDRI**：loadHdri() 传一张 .hdr 进来，PMREMGenerator.fromEquirectangular 预处理。
 *     下不到就退回渐变天空，不会让场景变黑。
 *
 * 三件事必须保持一致，不然远处会出现一条硬边：
 *   雾的颜色 == 天空的地平线颜色 == 地面远处的颜色。
 * 所以颜色表放在这里，World 从这里取雾色，而不是各写各的。
 */
import * as THREE from 'three';

export interface SkyColors {
  /** 天顶 */
  top: string;
  /** 地平线。雾色取的就是它 */
  horizon: string;
  /** 地平线以下（地面方向的天光） */
  bottom: string;
  /** 太阳光晕的颜色 */
  sun: string;
}

/** 午后：暖调、天顶不要太深，低多边形场景压深了会显脏 */
export const AFTERNOON_SKY: Readonly<SkyColors> = Object.freeze({
  top: '#2f86dd',
  horizon: '#a9daff',
  bottom: '#7ea7bd',
  sun: '#ffeec4',
});

/**
 * 太阳方向（单位向量，从场景指向太阳）。
 * 仰角约 34°，偏西南 —— 午后的角度：影子拉得够长能看出立体感，
 * 又不至于像黄昏那样长到糊住整条赛道。
 */
export const AFTERNOON_SUN_DIR = new THREE.Vector3(0.66, 0.55, -0.5).normalize();

/** 天空球半径。要小于所有档位的相机远裁剪面（low 档是 360），并且每帧跟着相机走 */
const SKY_RADIUS = 300;

export class SkyEnvironment {
  /** 渐变天空球。加进场景，每帧 follow(camera) */
  readonly mesh: THREE.Mesh;
  readonly colors: Readonly<SkyColors>;

  private readonly material: THREE.ShaderMaterial;
  private pmrem: THREE.PMREMGenerator | null = null;
  private target: THREE.WebGLRenderTarget | null = null;
  /** HDRI 的原始贴图，成功加载后留着当背景 */
  private hdri: THREE.Texture | null = null;

  constructor(colors: Readonly<SkyColors> = AFTERNOON_SKY) {
    this.colors = colors;
    this.material = new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      // 天空不吃雾：它本来就是"无穷远"，再乘一次雾色会把渐变压平
      fog: false,
      uniforms: {
        uTop: { value: new THREE.Color(colors.top) },
        uHorizon: { value: new THREE.Color(colors.horizon) },
        uBottom: { value: new THREE.Color(colors.bottom) },
        uSun: { value: new THREE.Color(colors.sun) },
        uSunDir: { value: AFTERNOON_SUN_DIR.clone() },
      },
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
    });

    this.mesh = new THREE.Mesh(new THREE.SphereGeometry(SKY_RADIUS, 24, 16), this.material);
    this.mesh.frustumCulled = false;
    // 先画天空再画别的：它 depthWrite 关着，不会挡住任何东西，
    // 但排在前面能让后面的物体正常做深度测试
    this.mesh.renderOrder = -1;
    this.mesh.name = 'sky';
  }

  /** 地平线色。雾色、加载界面底色都取它，保证接得上 */
  get fogColor(): THREE.Color {
    return (this.material.uniforms.uHorizon!.value as THREE.Color).clone();
  }

  /**
   * 天空球跟着相机走。不跟的话开出去几百米就会看到"天空的边"。
   * 只挪位置不挪朝向：太阳的方向是世界空间的，得钉住。
   */
  follow(camera: THREE.Camera): void {
    this.mesh.position.copy(camera.position);
  }

  /**
   * 生成/更新环境贴图并挂到场景上。
   *
   * @param size PMREM 立方图边长；**0 = 不要环境贴图**（low 档），
   *             这时把 scene.environment 清掉，只留半球光。
   *             一次预处理在桌面上是几毫秒，但它会 stall GPU 管线，
   *             所以只在开局和改画质档位时调，不要每帧调。
   */
  apply(renderer: THREE.WebGLRenderer, scene: THREE.Scene, size: number): void {
    this.releaseTarget();

    if (size <= 0) {
      scene.environment = null;
      return;
    }

    this.pmrem ??= new THREE.PMREMGenerator(renderer);
    this.pmrem.compileEquirectangularShader();

    if (this.hdri) {
      this.target = this.pmrem.fromEquirectangular(this.hdri);
    } else {
      // 单独拿一个只装天空球的场景去烘：主场景里有赛道和车，
      // 烘进环境贴图会让车"照亮自己"，一动起来环境光就跟着抖
      const skyScene = new THREE.Scene();
      const dome = new THREE.Mesh(this.mesh.geometry, this.material);
      skyScene.add(dome);
      this.target = this.pmrem.fromScene(skyScene, 0, 1, SKY_RADIUS * 2, { size });
      skyScene.remove(dome);
    }

    scene.environment = this.target.texture;
    // 环境光强度：1 会让整台车泛白（天空很亮），0.6 左右刚好只补背光面
    scene.environmentIntensity = 0.6;
  }

  /**
   * 换成真的 HDRI。**加载失败返回 false 并保持渐变天空**，不抛异常。
   * 成功之后要再调一次 apply() 才会重新烘环境贴图。
   *
   * HDRLoader 是动态 import 的：没有 HDRI 的时候它一个字节都不下
   * （three 0.185 里 RGBELoader 已经改名叫 HDRLoader，用旧名字会刷弃用警告）。
   */
  async loadHdri(url: string, scene: THREE.Scene): Promise<boolean> {
    try {
      const { HDRLoader } = await import('three/examples/jsm/loaders/HDRLoader.js');
      const texture = await new HDRLoader().loadAsync(url);
      texture.mapping = THREE.EquirectangularReflectionMapping;
      this.hdri?.dispose();
      this.hdri = texture;
      // HDRI 自己当背景，渐变球就没用了
      this.mesh.visible = false;
      scene.background = texture;
      scene.backgroundBlurriness = 0.25; // 背景糊一点，别让 HDRI 的细节抢了赛道
      return true;
    } catch (error) {
      console.warn(`[sky] HDRI 加载失败，继续用渐变天空：${url}`, error);
      return false;
    }
  }

  private releaseTarget(): void {
    this.target?.dispose();
    this.target = null;
  }

  dispose(): void {
    this.releaseTarget();
    this.pmrem?.dispose();
    this.pmrem = null;
    this.hdri?.dispose();
    this.hdri = null;
    this.mesh.geometry.dispose();
    this.material.dispose();
  }
}

/**
 * 渐变 + 太阳光晕。
 *
 * 高度用的是**方向向量的 y**而不是顶点 y：球是有半径的，直接用 y 的话
 * 渐变会随球半径变，改半径就得重调颜色。
 */
const SKY_VERT = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SKY_FRAG = /* glsl */ `
  uniform vec3 uTop;
  uniform vec3 uHorizon;
  uniform vec3 uBottom;
  uniform vec3 uSun;
  uniform vec3 uSunDir;
  varying vec3 vDir;

  void main() {
    vec3 dir = normalize(vDir);
    // 地平线附近收得紧一点（pow），远处才有"天边亮一条"的感觉
    float up = clamp(dir.y, 0.0, 1.0);
    float down = clamp(-dir.y, 0.0, 1.0);
    vec3 color = mix(uHorizon, uTop, pow(up, 0.55));
    color = mix(color, uBottom, pow(down, 0.4));

    // 太阳：一个很宽的软光晕。不画实心圆盘 —— 卡通风格里一个亮斑就够了，
    // 画了圆盘反而会在 bloom 之后糊成一大团
    float sun = pow(max(dot(dir, normalize(uSunDir)), 0.0), 24.0);
    color += uSun * sun * 0.8;

    gl_FragColor = vec4(color, 1.0);
    #include <colorspace_fragment>
  }
`;
