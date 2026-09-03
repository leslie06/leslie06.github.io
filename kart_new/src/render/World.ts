import * as THREE from 'three';

export interface WorldOptions {
  /** 草地平面的高度。赛道的裙边一直垂到这里，所以两个值要一致 */
  groundY?: number;
  /**
   * 判断某个位置是不是在赛道上（含护栏和一点余量）。
   * 撒参照物时用来避让 —— 不然锥桶会直接长在路中间。
   */
  isBlocked?: (x: number, z: number) => boolean;
}

/** 场景：地面 + 网格纹理 + 光照 + 一堆参照物（用来判断速度感）。 */
export class World {
  readonly scene = new THREE.Scene();
  readonly sun: THREE.DirectionalLight;

  private static readonly GROUND_SIZE = 2000;
  private static readonly GRID_TILE = 8; // 一格 8 米

  constructor(private readonly options: WorldOptions = {}) {
    const skyColor = new THREE.Color('#8fd3ff');
    this.scene.background = skyColor;
    this.scene.fog = new THREE.Fog(skyColor, 180, 620);

    // --- 光照 ---
    const hemi = new THREE.HemisphereLight('#cfe9ff', '#5c7a4a', 1.6);
    hemi.position.set(0, 50, 0);
    this.scene.add(hemi);

    this.sun = new THREE.DirectionalLight('#fff4e0', 2.4);
    this.sun.position.set(60, 90, 40);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const cam = this.sun.shadow.camera;
    cam.near = 1;
    cam.far = 320;
    cam.left = -70;
    cam.right = 70;
    cam.top = 70;
    cam.bottom = -70;
    this.sun.shadow.bias = -0.0006;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun);
    this.scene.add(this.sun.target);

    this.scene.add(this.buildGround());
    this.scene.add(this.buildProps());
  }

  /**
   * 阴影相机跟着车走，否则开远了就没影子了。
   * 太阳的方向保持不变，只是整体平移。
   */
  followShadow(x: number, y: number, z: number): void {
    this.sun.target.position.set(x, y, z);
    this.sun.target.updateMatrixWorld();
    this.sun.position.set(x + 60, y + 90, z + 40);
  }

  private buildGround(): THREE.Mesh {
    const texture = new THREE.CanvasTexture(makeGridTexture());
    texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
    texture.repeat.set(World.GROUND_SIZE / World.GRID_TILE, World.GROUND_SIZE / World.GRID_TILE);
    texture.anisotropy = 8;
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

  /** 随机撒锥形和方块，避开赛道本身。 */
  private buildProps(): THREE.Group {
    const group = new THREE.Group();
    const rand = mulberry32(0xc0ffee);
    const palette = ['#ff5d5d', '#ffd23f', '#3ddc97', '#4d9bff', '#ff8ac4', '#ffffff'];

    const coneGeo = new THREE.ConeGeometry(0.9, 2.4, 16);
    const boxGeo = new THREE.BoxGeometry(1, 1, 1);
    const materials = palette.map(
      (c) => new THREE.MeshStandardMaterial({ color: c, roughness: 0.6, metalness: 0.05 }),
    );

    const blocked = this.options.isBlocked ?? (() => false);
    const base = this.groundY;

    /** 摇一个不压在赛道上的位置；连续摇不到就放弃这一个，别死循环 */
    const place = (mesh: THREE.Mesh, y: number): boolean => {
      for (let attempt = 0; attempt < 12; attempt++) {
        const angle = rand() * Math.PI * 2;
        const radius = 20 + Math.sqrt(rand()) * 460;
        const x = Math.cos(angle) * radius;
        const z = Math.sin(angle) * radius;
        if (blocked(x, z)) continue;
        mesh.position.set(x, base + y, z);
        mesh.rotation.y = rand() * Math.PI * 2;
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
        return true;
      }
      return false;
    };

    for (let i = 0; i < 260; i++) {
      place(new THREE.Mesh(coneGeo, pick(materials, rand)), 1.2);
    }
    for (let i = 0; i < 180; i++) {
      const h = 1 + rand() * 5;
      const mesh = new THREE.Mesh(boxGeo, pick(materials, rand));
      mesh.scale.set(1 + rand() * 2.5, h, 1 + rand() * 2.5);
      place(mesh, h / 2);
    }
    // 几根高柱子，远处也能看出在移动
    for (let i = 0; i < 55; i++) {
      const h = 10 + rand() * 22;
      const mesh = new THREE.Mesh(boxGeo, pick(materials, rand));
      mesh.scale.set(2.5, h, 2.5);
      place(mesh, h / 2);
    }
    return group;
  }
}

function pick<T>(items: readonly T[], rand: () => number): T {
  return items[Math.floor(rand() * items.length)]!;
}

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
