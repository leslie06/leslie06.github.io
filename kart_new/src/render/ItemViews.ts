/**
 * 道具箱 / 投射物 / 陷阱的渲染。
 *
 * 逻辑全在 src/items/ 里，这里只做一件事：把那边的数组画出来。
 * 按 id 复用 mesh，不每帧新建/销毁 —— 投射物飞得快，重建会掉帧也会闪。
 *
 * 和 HUD 一样，这里**不认识任何具体道具**：颜色从 ItemDef 里取。
 */
import * as THREE from 'three';
import type { ItemBox } from '../items/ItemBoxes';
import type { Projectile, Trap } from '../items/Projectile';

/** 道具箱边长 */
const BOX_SIZE = 1.6;
/** 箱子悬浮在地面之上多少 */
const BOX_HOVER = 1.1;

export class ItemBoxViews {
  readonly group = new THREE.Group();
  private readonly mesh: THREE.InstancedMesh;
  private readonly matrix = new THREE.Matrix4();
  private readonly position = new THREE.Vector3();
  private readonly quaternion = new THREE.Quaternion();
  private readonly scale = new THREE.Vector3(1, 1, 1);
  private spin = 0;

  constructor(boxes: readonly ItemBox[]) {
    // 二十几个箱子原来是二十几个 Mesh 外加同样多的描边 LineSegments，
    // 五十个 drawcall 就为了画一排问号箱。合成一个 InstancedMesh：
    // 描边一起去掉了，用 emissive 让它在阴影里照样显眼
    const geo = new THREE.BoxGeometry(BOX_SIZE, BOX_SIZE, BOX_SIZE);
    const mat = new THREE.MeshStandardMaterial({
      color: '#ffd34d',
      emissive: '#4a3a00',
      roughness: 0.3,
      metalness: 0.1,
      transparent: true,
      opacity: 0.82,
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, Math.max(boxes.length, 1));
    this.mesh.castShadow = true;
    this.mesh.frustumCulled = false; // 箱子沿整条赛道铺开，包围盒等于整个场景，剔了也白剔
    this.group.add(this.mesh);
    this.update(boxes, 0);
  }

  /** @param frameDt 真实帧间隔，转速用真实时间 */
  update(boxes: readonly ItemBox[], frameDt: number): void {
    this.spin += frameDt * 1.6;
    const count = Math.min(boxes.length, this.mesh.instanceMatrix.count);
    for (let i = 0; i < count; i++) {
      const box = boxes[i]!;
      // 吃掉的箱子缩到 0：实例的下标要和 boxes 的下标对齐（重生时还是这一格），
      // 所以不能靠减 count 来隐藏中间某一个
      this.scale.setScalar(box.active ? 1 : 0);
      // 上下浮一点，看着像悬空的而不是插在地里
      this.position.set(box.x, box.y + BOX_HOVER + Math.sin(this.spin * 1.7 + i) * 0.12, box.z);
      this.quaternion.setFromAxisAngle(UP, this.spin);
      this.mesh.setMatrixAt(i, this.matrix.compose(this.position, this.quaternion, this.scale));
    }
    this.mesh.count = count;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

const UP = new THREE.Vector3(0, 1, 0);

/**
 * 投射物和陷阱共用一个池：两者数量都少且随时增删，
 * 按 id 从池里认领一个 mesh，这一帧没被认领的就藏起来。
 */
class MeshPool {
  private readonly free: THREE.Mesh[] = [];
  private readonly used = new Map<number, THREE.Mesh>();
  private readonly seen = new Set<number>();

  constructor(
    readonly group: THREE.Group,
    private readonly make: () => THREE.Mesh,
  ) {}

  beginFrame(): void {
    this.seen.clear();
  }

  claim(id: number): THREE.Mesh {
    this.seen.add(id);
    let mesh = this.used.get(id);
    if (!mesh) {
      mesh = this.free.pop() ?? this.make();
      mesh.visible = true;
      this.group.add(mesh);
      this.used.set(id, mesh);
    }
    return mesh;
  }

  endFrame(): void {
    for (const [id, mesh] of this.used) {
      if (this.seen.has(id)) continue;
      mesh.visible = false;
      this.used.delete(id);
      this.free.push(mesh);
    }
  }
}

export class ProjectileViews {
  readonly group = new THREE.Group();
  private readonly pool: MeshPool;
  private spin = 0;

  constructor() {
    const geo = new THREE.SphereGeometry(0.9, 16, 12);
    const mat = new THREE.MeshStandardMaterial({
      color: '#3fc4ff',
      emissive: '#0a4b6b',
      roughness: 0.25,
      metalness: 0.4,
    });
    this.pool = new MeshPool(this.group, () => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      // 拖尾：一个拉长的半透明壳，比粒子便宜得多
      const tail = new THREE.Mesh(
        new THREE.ConeGeometry(0.55, 2.4, 12),
        new THREE.MeshBasicMaterial({ color: '#9fe6ff', transparent: true, opacity: 0.35 }),
      );
      tail.rotation.x = Math.PI / 2; // 圆锥默认沿 +y，转成沿 +z
      tail.position.z = -1.4; // 拖在身后
      mesh.add(tail);
      return mesh;
    });
  }

  update(projectiles: readonly Projectile[], frameDt: number): void {
    this.spin += frameDt * 9;
    this.pool.beginFrame();
    for (const p of projectiles) {
      const mesh = this.pool.claim(p.id);
      mesh.position.set(p.x, p.y, p.z);
      mesh.rotation.y = p.heading;
      mesh.rotation.z = this.spin;
    }
    this.pool.endFrame();
  }
}

export class TrapViews {
  readonly group = new THREE.Group();
  private readonly pool: MeshPool;
  private pulse = 0;

  constructor() {
    const geo = new THREE.ConeGeometry(1.1, 0.9, 4);
    const mat = new THREE.MeshStandardMaterial({
      color: '#ff5fa2',
      emissive: '#5a0028',
      roughness: 0.5,
    });
    this.pool = new MeshPool(this.group, () => {
      const mesh = new THREE.Mesh(geo, mat);
      mesh.castShadow = true;
      mesh.rotation.y = Math.PI / 4; // 四棱锥转 45°，看着像个地刺
      return mesh;
    });
  }

  update(traps: readonly Trap[], frameDt: number): void {
    this.pulse += frameDt * 4;
    this.pool.beginFrame();
    for (const trap of traps) {
      const mesh = this.pool.claim(trap.id);
      mesh.position.set(trap.x, trap.y + 0.45, trap.z);
      // 还没起爆的半沉在地里，起爆后长出来并轻轻脉动 —— 一眼能看出踩不踩得到
      const armed = trap.armDelay <= 0;
      const s = armed ? 1 + Math.sin(this.pulse) * 0.08 : 0.6;
      mesh.scale.setScalar(s);
    }
    this.pool.endFrame();
  }
}
