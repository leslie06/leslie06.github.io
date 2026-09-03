/**
 * 把一棵 glTF 场景树拆成"能开的车"：车身一个组、四个轮子各一个 pivot。
 *
 * ## 模型要满足的约定（导出时对一遍）
 *   - 车头朝 **+Z**，轮子贴地 **y = 0**，单位是米（车长 ≈ 2.6m）；
 *   - 轮子的节点名里带 `wheel`（大小写随意，`Wheel_FL` / `wheel.rear.l` 都认）。
 *     认不出前后就按节点在模型里的 z 坐标分：z > 0 是前轮；
 *   - 想换配色的材质，**材质名**里带 `body` / `accent` / `trim` / `suit` 之一。
 *     不带标签的材质（轮胎、玻璃、驾驶员皮肤）所有车共用，不参与换色 ——
 *     这也是故意的：全车都跟着换色就看不出是同一个系列的车了。
 *
 * 名字对不上也不会崩：找不到轮子就当整台车是一个刚体（不会滚也不会打方向，
 * 但位置朝向都对），控制台留一行提示。
 *
 * ## 为什么轮子要挪出车身
 * 车身要侧倾/俯仰，轮子不能跟着倒 —— 它们得一直贴着地。所以建 rig 的时候把
 * 轮子从车身子树里摘出来挂到 root 上（world 变换保持不变），之后车身怎么歪都不影响轮子。
 */
import * as THREE from 'three';

export interface WheelNode {
  /** 转向用：绕 y 转。滚动是 pivot 的子对象绕 x 转，两者分开挂才不会互相干扰 */
  readonly pivot: THREE.Group;
  readonly front: boolean;
  /** 在模型里的左右：x < 0 是左 */
  readonly left: boolean;
}

export interface KartRig {
  /** 会侧倾/俯仰的部分 */
  readonly chassis: THREE.Group;
  readonly wheels: readonly WheelNode[];
  /** 从模型量出来的轮子半径（米）。量不出来是 null */
  readonly wheelRadius: number | null;
}

const WHEEL_NAME = /wheel|轮/i;
/** 名字里明确写了前后的，优先信名字，不去猜坐标 */
const FRONT_NAME = /front|_f[lr]?\b|\bf[lr]\b|前/i;
const REAR_NAME = /rear|back|_r[lr]?\b|\br[lr]\b|后/i;

/**
 * 从一棵已经克隆好的模型树上建 rig。**会就地改这棵树**（重挂轮子），
 * 所以传进来的必须是克隆，不能是 ModelLibrary 里的模板。
 *
 * @param root 摆进场景的那个根节点，位置/朝向由 KartView 每帧写
 * @param model 克隆出来的 glTF 场景
 */
export function buildKartRig(root: THREE.Object3D, model: THREE.Object3D): KartRig {
  const chassis = new THREE.Group();
  chassis.add(model);
  root.add(chassis);

  // 先把矩阵刷出来：下面要按世界坐标（此刻 root 还在原点，所以世界 = 模型局部）
  // 判断前后左右，也要靠它把轮子原地挪出车身
  root.updateMatrixWorld(true);

  const found: THREE.Object3D[] = [];
  model.traverse((node) => {
    if (!WHEEL_NAME.test(node.name)) return;
    // 只取最外层的轮子节点：轮毂、轮胎往往是它的子网格，名字里也带 wheel
    if (found.some((other) => isAncestor(other, node))) return;
    found.push(node);
  });

  const wheels: WheelNode[] = [];
  let radiusSum = 0;
  const box = new THREE.Box3();
  const size = new THREE.Vector3();
  const worldPos = new THREE.Vector3();

  for (const node of found) {
    node.getWorldPosition(worldPos);
    // 半径按包围盒的"竖直/纵向里大的那个"算：轮子是个饼，轴向那一维是宽度，不能算进去
    box.setFromObject(node);
    box.getSize(size);
    radiusSum += Math.max(size.y, size.z) / 2;

    const pivot = new THREE.Group();
    pivot.position.copy(worldPos);
    root.add(pivot);
    // attach 保持世界变换不变，所以轮子不会跳位置；再把它相对 pivot 归零，
    // 这样 pivot 转 y（转向）、子对象转 x（滚动），两个旋转互不影响
    pivot.attach(node);
    node.position.set(0, 0, 0);

    wheels.push({
      pivot,
      front: classifyFront(node.name, worldPos.z),
      left: worldPos.x < 0,
    });
  }

  if (wheels.length === 0) {
    console.warn(
      '[kartRig] 模型里没找到名字带 "wheel" 的节点，轮子不会转也不会打方向。' +
        '导出时把四个轮子的节点名改成 Wheel_FL / Wheel_FR / Wheel_RL / Wheel_RR。',
    );
  }

  return { chassis, wheels, wheelRadius: wheels.length > 0 ? radiusSum / wheels.length : null };
}

function classifyFront(name: string, z: number): boolean {
  if (FRONT_NAME.test(name)) return true;
  if (REAR_NAME.test(name)) return false;
  return z > 0; // 模型朝 +Z，所以 z 大的是前轮
}

function isAncestor(maybeAncestor: THREE.Object3D, node: THREE.Object3D): boolean {
  for (let p = node.parent; p; p = p.parent) if (p === maybeAncestor) return true;
  return false;
}

// ============================================================================
// 换配色
// ============================================================================

/** 材质名上的标签 -> 配色表的字段名 */
export const TINT_TAGS = ['body', 'accent', 'trim', 'suit'] as const;
export type TintTag = (typeof TINT_TAGS)[number];

/**
 * 按颜色缓存材质。
 *
 * 换配色最省事的写法是 `mesh.material = mesh.material.clone()` 然后改 color，
 * 但那样**每辆车都会多出一整套材质**：材质各不相同 = 每套都要单独编译一次着色器，
 * 也再不可能被合批。这里换成"按 (原材质, 颜色) 查表"：
 * 同色的车共用同一份材质，八辆不同色的车对一个可换色材质来说也就是八份，
 * 而且和模型里有多少个 mesh 无关。
 *
 * 缓存活得比车久（模块级），因为颜色表是固定的那几套。
 */
export class TintCache {
  private readonly cache = new Map<string, THREE.Material>();

  /** 取一份把 color 换成 hex 的材质。同样的入参永远返回同一个对象 */
  get(source: THREE.Material, hex: string): THREE.Material {
    const key = `${source.uuid}|${hex}`;
    const hit = this.cache.get(key);
    if (hit) return hit;

    const tinted = source.clone();
    const colored = tinted as THREE.Material & { color?: THREE.Color };
    if (colored.color) colored.color.set(hex);
    tinted.name = `${source.name || 'mat'}#${hex}`;
    this.cache.set(key, tinted);
    return tinted;
  }

  get size(): number {
    return this.cache.size;
  }

  dispose(): void {
    for (const material of this.cache.values()) material.dispose();
    this.cache.clear();
  }
}

/** 全场共用一份。配色是固定的那几套，缓存不会无限长大 */
export const sharedTintCache = new TintCache();

/**
 * 按材质名上的标签换色。名字里没有标签的材质原样留着（共用）。
 * @returns 换掉了几个材质槽，0 = 这个模型没打标签
 */
export function applyTint(
  root: THREE.Object3D,
  palette: Readonly<Record<TintTag, string>>,
  cache: TintCache = sharedTintCache,
): number {
  let changed = 0;
  root.traverse((node) => {
    const mesh = node as THREE.Mesh;
    if (!mesh.isMesh) return;
    const slots = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const next = slots.map((material) => {
      const tag = tagOf(material.name);
      if (!tag) return material;
      changed++;
      return cache.get(material, palette[tag]);
    });
    mesh.material = Array.isArray(mesh.material) ? next : next[0]!;
  });
  return changed;
}

/** 材质名 -> 标签。取**最先**匹配上的那个标签，名字里同时带两个标签是导出方的锅 */
export function tagOf(materialName: string): TintTag | null {
  const lower = materialName.toLowerCase();
  for (const tag of TINT_TAGS) if (lower.includes(tag)) return tag;
  return null;
}
