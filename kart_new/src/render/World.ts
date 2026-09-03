import * as THREE from 'three';
import { QUALITY_TIERS, type QualitySettings } from './QualityTiers';
import { AFTERNOON_SUN_DIR, SkyEnvironment } from './SkyEnvironment';

export interface WorldOptions {
  /**
   * 渲染器。烘环境贴图（PMREM）要用它。
   * 不传就只有半球光，场景会明显平一些 —— 测试里就是这么跑的。
   */
  renderer?: THREE.WebGLRenderer;
  /** 草地平面的高度。赛道的裙边一直垂到这里，所以两个值要一致 */
  groundY?: number;
  /**
   * 判断某个位置是不是在赛道上（含护栏和一点余量）。
   * 撒参照物时用来避让 —— 不然锥桶会直接长在路中间。
   */
  isBlocked?: (x: number, z: number) => boolean;
  /** 画质档位参数。雾距离、阴影分辨率、装饰物密度全从这里读 */
  quality?: Readonly<QualitySettings>;
}

/** 场景：天空 + 地面 + 光照 + 一堆参照物（用来判断速度感）。 */
export class World {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;
  /** 渐变天空 + 环境贴图。雾色也从它那儿取 */
  readonly sky: SkyEnvironment;
  /** 半球光。强度跟着"有没有环境贴图"变，见构造函数里的说明 */
  private readonly hemi: THREE.HemisphereLight;

  private static readonly GROUND_SIZE = 2000;
  private static readonly GRID_TILE = 8; // 一格 8 米

  /** 平行光离车多远。只影响阴影相机的近远平面，不影响光照方向（平行光没有位置衰减） */
  private static readonly SUN_DISTANCE = 120;

  /** 装饰物按满档数量建好，实际画多少条由 InstancedMesh.count 控制（见 setQuality） */
  private static readonly CONE_BUDGET = 260;
  private static readonly BOX_BUDGET = 235;

  private readonly fog: THREE.Fog;
  private readonly groundTexture: THREE.Texture;
  private readonly cones: THREE.InstancedMesh;
  private readonly boxes: THREE.InstancedMesh;
  private quality: Readonly<QualitySettings>;

  constructor(private readonly options: WorldOptions = {}) {
    this.quality = options.quality ?? QUALITY_TIERS.high;

    // --- 天空。雾色 = 天空的地平线色，这两个对不上远处就会有一条硬边 ---
    this.sky = new SkyEnvironment();
    const skyColor = this.sky.fogColor;
    // 背景色兜底：天空球正常情况下盖住整个视野，万一它没画上也不该是黑的
    this.scene.background = skyColor;
    this.scene.add(this.sky.mesh);
    this.fog = new THREE.Fog(skyColor, this.quality.fogNear, this.quality.fogFar);
    this.scene.fog = this.fog;

    // --- 光照 ---
    // 半球光和环境贴图是**同一件事的两种做法**（都在补背光面），所以强度要此消彼长：
    // 有环境贴图的档位把半球光压到 0.35，没有的（low 档）拉回 1.15。
    // 两个都开满的后果是整个画面过曝 —— ACES 会把它压回来，代价是颜色全部发灰，
    // 卡通风格最怕的就是这个。切换在 setQuality 里做
    this.hemi = new THREE.HemisphereLight('#d6ecff', '#6b8a52', HEMI_WITHOUT_ENV);
    this.hemi.position.set(0, 50, 0);
    this.scene.add(this.hemi);

    // 主光源：午后的角度（仰角 34° 左右），偏暖。影子拉得够长能看出立体感
    this.sun = new THREE.DirectionalLight('#ffe9c4', 2.4);
    this.sun.position.copy(AFTERNOON_SUN_DIR).multiplyScalar(World.SUN_DISTANCE);
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = World.SUN_DISTANCE * 2.6;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    const ground = this.buildGround();
    this.groundTexture = (ground.material as THREE.MeshStandardMaterial).map!;
    this.scene.add(ground);

    const props = this.buildProps();
    this.cones = props.cones;
    this.boxes = props.boxes;
    this.scene.add(props.group);

    this.setQuality(this.quality);
  }

  /**
   * 换档位。运行时降档（帧率自适应）和设置菜单里手动改都走这里。
   *
   * 装饰物数量是靠改 InstancedMesh.count 实现的：摆位是同一串确定性随机，
   * 少画就是**取前缀**，所以降档只是让远处的锥桶消失，已经在那儿的不会跳位置。
   */
  setQuality(settings: Readonly<QualitySettings>): void {
    this.quality = settings;

    this.fog.near = settings.fogNear;
    this.fog.far = settings.fogFar;

    const shadows = settings.shadowMapSize > 0;
    this.sun.castShadow = shadows;
    if (shadows) {
      const cam = this.sun.shadow.camera;
      cam.left = -settings.shadowRadius;
      cam.right = settings.shadowRadius;
      cam.top = settings.shadowRadius;
      cam.bottom = -settings.shadowRadius;
      cam.updateProjectionMatrix();
      if (this.sun.shadow.mapSize.x !== settings.shadowMapSize) {
        this.sun.shadow.mapSize.setScalar(settings.shadowMapSize);
        // 贴图尺寸变了必须把旧的丢掉，否则 three 会继续用原来那张
        this.sun.shadow.map?.dispose();
        this.sun.shadow.map = null;
      }
    }

    // 环境贴图。烘一次是几毫秒的 GPU stall，所以只在这里（开局 / 改档位）做
    const hasEnv = settings.envMapSize > 0 && this.options.renderer !== undefined;
    if (this.options.renderer) {
      this.sky.apply(this.options.renderer, this.scene, settings.envMapSize);
    }
    this.hemi.intensity = hasEnv ? HEMI_WITH_ENV : HEMI_WITHOUT_ENV;

    this.groundTexture.anisotropy = settings.textureAnisotropy;
    this.groundTexture.needsUpdate = true;

    const density = Math.max(0, Math.min(1, settings.propDensity));
    this.cones.count = Math.round(World.CONE_BUDGET * density);
    this.boxes.count = Math.round(World.BOX_BUDGET * density);
  }

  /**
   * 阴影相机跟着车走，否则开远了就没影子了。
   * 太阳的方向保持不变，只是整体平移。
   */
  followShadow(x: number, y: number, z: number): void {
    if (!this.sun.castShadow) return;
    this.sun.target.position.set(x, y, z);
    this.sun.target.updateMatrixWorld();
    this.sun.position
      .copy(AFTERNOON_SUN_DIR)
      .multiplyScalar(World.SUN_DISTANCE)
      .add(this.sun.target.position);
  }

  /**
   * 每帧调一次：天空球跟着相机走。
   * 不跟的话开出去几百米就会看到天空的边缘（球半径 300m，赛道跨度 500m）。
   */
  update(camera: THREE.Camera): void {
    this.sky.follow(camera);
  }

  private buildGround(): THREE.Mesh {
    const texture = new THREE.CanvasTexture(makeGridTexture());
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(World.GROUND_SIZE / World.GRID_TILE, World.GROUND_SIZE / World.GRID_TILE);
    texture.colorSpace = THREE.SRGBColorSpace;

    const mesh = new THREE.Mesh(
      new THREE.PlaneGeometry(World.GROUND_SIZE, World.GROUND_SIZE),
      new THREE.MeshStandardMaterial({ map: texture, roughness: 0.95, metalness: 0 }),
    );
    mesh.rotation.x = -Math.PI / 2;
    mesh.position.y = this.groundY;
    mesh.receiveShadow = true;
    return mesh;
  }

  private get groundY(): number {
    return this.options.groundY ?? 0;
  }

  /**
   * 随机撒锥形和方块，避开赛道本身。
   *
   * 全部走 InstancedMesh：495 个参照物原来是 495 个 drawcall，占掉 low 档
   * 三倍还多的预算；合成两个之后是 2 个。锥桶一个 InstancedMesh，
   * 方块和高柱子共用另一个 —— 它们都是单位立方体，差别只在每个实例的缩放上。
   */
  private buildProps(): { group: THREE.Group; cones: THREE.InstancedMesh; boxes: THREE.InstancedMesh } {
    const group = new THREE.Group();
    const rand = mulberry32(0xc0ffee);
    const palette = ['#ff5d5d', '#ffd23f', '#3ddc97', '#4d9bff', '#ff8ac4', '#ffffff'].map(
      (c) => new THREE.Color(c),
    );

    const material = new THREE.MeshStandardMaterial({ roughness: 0.6, metalness: 0.05 });
    const cones = new THREE.InstancedMesh(
      new THREE.ConeGeometry(0.9, 2.4, 12),
      material,
      World.CONE_BUDGET,
    );
    const boxes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), material, World.BOX_BUDGET);
    for (const mesh of [cones, boxes]) {
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      // 摆完就不动了，告诉 three 不用每帧重传矩阵
      mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
      group.add(mesh);
    }

    const blocked = this.options.isBlocked ?? (() => false);
    const base = this.groundY;
    const matrix = new THREE.Matrix4();
    const position = new THREE.Vector3();
    const quaternion = new THREE.Quaternion();
    const scale = new THREE.Vector3(1, 1, 1);

    /** 摇一个不压在赛道上的位置；连续摇不到就放弃这一个，别死循环 */
    const place = (mesh: THREE.InstancedMesh, index: number, y: number): boolean => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const angle = rand() * Math.PI * 2;
        const radius = 20 + Math.sqrt(rand()) * 460;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (blocked(x, z)) continue;
        position.set(x, base + y, z);
        quaternion.setFromAxisAngle(UP, rand() * Math.PI * 2);
        mesh.setMatrixAt(index, matrix.compose(position, quaternion, scale));
        mesh.setColorAt(index, palette[Math.floor(rand() * palette.length)]!);
        return true;
      }
      // 摇不到位置的实例缩到 0，等于不存在（但要占住这一格，保持"降档=取前缀"的性质）
      mesh.setMatrixAt(index, matrix.makeScale(0, 0, 0));
      mesh.setColorAt(index, palette[0]!);
      return false;
    };

    for (let i = 0; i < World.CONE_BUDGET; i++) {
      scale.set(1, 1, 1);
      place(cones, i, 1.2);
    }
    for (let i = 0; i < World.BOX_BUDGET; i++) {
      // 前 180 个是矮方块，后面 55 个是高柱子（远处也能看出在移动）
      const pillar = i >= 180;
      const h = pillar ? 10 + rand() * 22 : 1 + rand() * 5;
      if (pillar) scale.set(2.5, h, 2.5);
      else scale.set(1 + rand() * 2.5, h, 1 + rand() * 2.5);
      place(boxes, i, h / 2);
    }

    cones.instanceMatrix.needsUpdate = true;
    boxes.instanceMatrix.needsUpdate = true;
    if (cones.instanceColor) cones.instanceColor.needsUpdate = true;
    if (boxes.instanceColor) boxes.instanceColor.needsUpdate = true;
    // 实例是撒在半径 480m 的一大圈里的，包围盒得自己算，不然会被整块剔掉
    cones.computeBoundingSphere();
    boxes.computeBoundingSphere();

    return { group, cones, boxes };
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/** 有环境贴图时的半球光强度。环境贴图已经在补背光面了，这里只留一点点垫底 */
const HEMI_WITH_ENV = 0.35;
/** 没有环境贴图时（low 档）的半球光强度。全靠它撑背光面，不然车会有一半是死黑的 */
const HEMI_WITHOUT_ENV = 1.15;

/** 一格网格纹理：深色底 + 亮线，再加一点内格分隔。 */
function makeGridTexture(): HTMLCanvasElement {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;

  ctx.fillStyle = '#4f7a45';
  ctx.fillRect(0, 0, size, size);

  ctx.strokeStyle = 'rgba(255,255,255,0.10)';
  ctx.lineWidth = 2;
  for (let i = 1; i < 4; i++) {
    const p = (size / 4) * i;
    ctx.beginPath();
    ctx.moveTo(p, 0);
    ctx.lineTo(p, size);
    ctx.moveTo(0, p);
    ctx.lineTo(size, p);
    ctx.stroke();
  }

  ctx.strokeStyle = 'rgba(255,255,255,0.45)';
  ctx.lineWidth = 6;
  ctx.strokeRect(0, 0, size, size);

  return canvas;
}

/** 确定性伪随机，保证每次刷新参照物摆的位置一样。 */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
