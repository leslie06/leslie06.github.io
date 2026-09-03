import * as THREE from 'three';

/**
 * 贴片假阴影：车底下贴一张径向渐变的圆片。
 *
 * low 档关掉实时阴影之后车会像浮在路面上 —— 阴影不只是好看，它是玩家判断
 * "车到底贴没贴地"的唯一线索。一张 InstancedMesh 把全场的车影一次画完，
 * 8 辆车 1 个 drawcall，比一张 1024 的阴影贴图便宜两个数量级。
 *
 * 贴图是程序化画的，不占首屏资源预算。
 */
export class BlobShadows {
  readonly mesh: THREE.InstancedMesh;

  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3();

  /**
   * @param capacity 最多同时有多少个影子（= 场上车辆数）
   * @param radius   影子半径（米），比车宽一点点
   */
  constructor(capacity: number, private readonly radius = 1.15) {
    const geometry = new THREE.PlaneGeometry(2, 2);
    geometry.rotateX(-Math.PI / 2); // 平面默认竖着，转成躺在地上

    const material = new THREE.MeshBasicMaterial({
      map: new THREE.CanvasTexture(makeBlobTexture()),
      transparent: true,
      opacity: 0.5,
      depthWrite: false, // 不写深度：影子之间互相叠不该出现硬边
      color: 0x000000,
      blending: THREE.NormalBlending,
    });
    material.map!.colorSpace = THREE.SRGBColorSpace;

    this.mesh = new THREE.InstancedMesh(geometry, material, capacity);
    this.mesh.frustumCulled = false; // 影子跟着车满场跑，包围盒没意义
    this.mesh.renderOrder = 1; // 在路面之后画，避免 z-fighting
    this.mesh.count = 0;
  }

  /** 这一帧开始摆影子。之后按顺序 add()，最后 finish() */
  begin(): void {
    this.mesh.count = 0;
  }

  /**
   * 摆一个影子。
   * @param groundY 车脚下的路面高度。用车自己的 y 会在腾空时影子跟着飞起来，
   *                那就完全没意义了 —— 影子留在地上、车飞起来，才看得出腾空多高
   * @param airHeight 车离地多高，越高影子越淡越大
   */
  add(x: number, groundY: number, z: number, airHeight = 0): void {
    const index = this.mesh.count;
    if (index >= this.mesh.instanceMatrix.count) return;

    // 离地 3m 以上就基本看不见了
    const fade = Math.max(0, 1 - airHeight / 3);
    const spread = this.radius * (1 + airHeight * 0.12);
    this.position.set(x, groundY + 0.03, z);
    this.scale.set(spread * fade, 1, spread * fade);
    this.mesh.setMatrixAt(index, this.matrix.compose(this.position, this.quaternion, this.scale));
    this.mesh.count = index + 1;
  }

  finish(): void {
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setVisible(visible: boolean): void {
    this.mesh.visible = visible;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    const material = this.mesh.material as THREE.MeshBasicMaterial;
    material.map?.dispose();
    material.dispose();
  }
}

/** 中间黑、边缘透明的圆片。64x64 足够了，反正是虚的 */
function makeBlobTexture(): HTMLCanvasElement {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.55, 'rgba(255,255,255,0.72)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  return canvas;
}
