import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { applyTint, buildKartRig, TintCache, tagOf } from './kartRig';

/** 造一棵假的"模型树"：一个车身 + 四个按名字标好的轮子 */
function fakeModel(names = ['Wheel_FL', 'Wheel_FR', 'Wheel_RL', 'Wheel_RR']): THREE.Object3D {
  const model = new THREE.Group();
  model.name = 'kart';

  const body = new THREE.Mesh(
    new THREE.BoxGeometry(1.2, 0.5, 2.2),
    new THREE.MeshStandardMaterial({ name: 'body_paint' }),
  );
  body.name = 'chassis';
  model.add(body);

  // 前轮 z > 0，后轮 z < 0（模型朝 +Z）
  const layout: Array<[x: number, z: number]> = [
    [-0.8, 0.95],
    [0.8, 0.95],
    [-0.9, -0.92],
    [0.9, -0.92],
  ];
  names.forEach((name, i) => {
    const [x, z] = layout[i]!;
    const wheel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.4, 0.4, 0.3, 8).rotateZ(Math.PI / 2),
      new THREE.MeshStandardMaterial({ name: 'tire_rubber' }),
    );
    wheel.name = name;
    wheel.position.set(x, 0.4, z);
    model.add(wheel);
  });
  return model;
}

describe('buildKartRig', () => {
  it('四个轮子都认出来，前后分对', () => {
    const root = new THREE.Group();
    const rig = buildKartRig(root, fakeModel());
    expect(rig.wheels).toHaveLength(4);
    expect(rig.wheels.filter((w) => w.front)).toHaveLength(2);
    expect(rig.wheels.filter((w) => w.left)).toHaveLength(2);
  });

  it('名字里没写前后时按 z 坐标分（模型朝 +Z，所以 z 大的是前轮）', () => {
    const root = new THREE.Group();
    const rig = buildKartRig(root, fakeModel(['wheel1', 'wheel2', 'wheel3', 'wheel4']));
    const fronts = rig.wheels.filter((w) => w.front);
    expect(fronts).toHaveLength(2);
    for (const wheel of fronts) expect(wheel.pivot.position.z).toBeGreaterThan(0);
  });

  it('名字写了前后就信名字，不看坐标', () => {
    const root = new THREE.Group();
    // 故意把名字和坐标写反：前两个在 z > 0 上，名字却是 rear。
    // 名字里必须带 wheel，否则根本不会被当成轮子（这是模型导出的约定）
    const rig = buildKartRig(
      root,
      fakeModel(['wheel_rear_l', 'wheel_rear_r', 'wheel_front_l', 'wheel_front_r']),
    );
    const byZ = new Map(rig.wheels.map((w) => [Math.sign(w.pivot.position.z), w.front]));
    expect(byZ.get(1)).toBe(false);
    expect(byZ.get(-1)).toBe(true);
  });

  /**
   * 这条是 rig 存在的理由：车身要侧倾，轮子得一直贴着地。
   * 轮子挂在 chassis 下面的话车身一歪，四个轮子就跟着离地了。
   */
  it('轮子挂在 root 上而不是会侧倾的车身上', () => {
    const root = new THREE.Group();
    const rig = buildKartRig(root, fakeModel());
    for (const wheel of rig.wheels) {
      expect(wheel.pivot.parent).toBe(root);
      expect(wheel.pivot.parent).not.toBe(rig.chassis);
    }

    // 让车身侧倾 30°，轮子的世界位置不该动
    const before = rig.wheels.map((w) => w.pivot.getWorldPosition(new THREE.Vector3()));
    rig.chassis.rotation.z = 0.5;
    root.updateMatrixWorld(true);
    const after = rig.wheels.map((w) => w.pivot.getWorldPosition(new THREE.Vector3()));
    for (let i = 0; i < before.length; i++) {
      expect(after[i]!.distanceTo(before[i]!)).toBeLessThan(1e-9);
    }
  });

  it('轮子被摘出来时世界位置不变，且相对 pivot 归零（转向和滚动才互不干扰）', () => {
    const root = new THREE.Group();
    const rig = buildKartRig(root, fakeModel());
    root.updateMatrixWorld(true);
    for (const wheel of rig.wheels) {
      const child = wheel.pivot.children[0]!;
      expect(child.position.length()).toBeLessThan(1e-9);
      // pivot 站在轮心上：y = 轮子半径
      expect(wheel.pivot.position.y).toBeCloseTo(0.4, 6);
    }
  });

  it('量得出轮子半径（半径写死在 config 里的话，大轮子的车看着像在打滑）', () => {
    const root = new THREE.Group();
    const rig = buildKartRig(root, fakeModel());
    expect(rig.wheelRadius).toBeCloseTo(0.4, 1);
  });

  it('一个轮子都没有也不崩，只是不会滚不会打方向', () => {
    const root = new THREE.Group();
    const model = new THREE.Group();
    model.add(new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial()));
    const rig = buildKartRig(root, model);
    expect(rig.wheels).toHaveLength(0);
    expect(rig.wheelRadius).toBeNull();
    expect(rig.chassis.parent).toBe(root);
  });

  it('轮毂之类的子网格不会被当成第二个轮子', () => {
    const root = new THREE.Group();
    const model = fakeModel();
    const wheel = model.children.find((c) => c.name === 'Wheel_FL')!;
    const hub = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.1, 0.1), new THREE.MeshStandardMaterial());
    hub.name = 'Wheel_FL_hub'; // 名字里也带 wheel
    wheel.add(hub);
    expect(buildKartRig(root, model).wheels).toHaveLength(4);
  });
});

describe('换配色', () => {
  it('tagOf 认材质名里的标签', () => {
    expect(tagOf('body_paint')).toBe('body');
    expect(tagOf('KART_ACCENT_02')).toBe('accent');
    expect(tagOf('driver_suit')).toBe('suit');
    expect(tagOf('tire_rubber')).toBe(null);
    expect(tagOf('')).toBe(null);
  });

  /**
   * 这条是"不要每辆车复制一套材质"的钉子：材质各不相同的话每套都要单独
   * 编译一次着色器，也再不可能被合批。八辆同色的车必须共用同一份材质。
   */
  it('同一个 (原材质, 颜色) 永远返回同一份材质', () => {
    const cache = new TintCache();
    const source = new THREE.MeshStandardMaterial({ name: 'body' });
    const a = cache.get(source, '#ff0000');
    const b = cache.get(source, '#ff0000');
    const c = cache.get(source, '#00ff00');
    expect(a).toBe(b);
    expect(a).not.toBe(c);
    expect(cache.size).toBe(2);
    expect((a as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff0000');
  });

  it('原材质不会被改动（它是所有车共用的模板）', () => {
    const cache = new TintCache();
    const source = new THREE.MeshStandardMaterial({ name: 'body', color: '#ffffff' });
    cache.get(source, '#123456');
    expect(source.color.getHexString()).toBe('ffffff');
  });

  it('applyTint 只换有标签的材质，轮胎这种共用件原样留着', () => {
    const cache = new TintCache();
    const model = fakeModel();
    const tire = model.children.find((c) => c.name === 'Wheel_FL') as THREE.Mesh;
    const tireMaterial = tire.material;

    const changed = applyTint(model, { body: '#ff3b30', accent: '#ffcc00', trim: '#fff', suit: '#00f' }, cache);

    expect(changed).toBe(1); // 只有 body_paint 带标签
    expect(tire.material).toBe(tireMaterial); // 轮胎没被换
    const body = model.children.find((c) => c.name === 'chassis') as THREE.Mesh;
    expect((body.material as THREE.MeshStandardMaterial).color.getHexString()).toBe('ff3b30');
  });

  it('两辆同色的车共用一份材质，两辆异色的车各一份', () => {
    const cache = new TintCache();
    const palette = { body: '#ff3b30', accent: '#ffcc00', trim: '#fff', suit: '#00f' };
    const a = fakeModel();
    const b = fakeModel();
    // 两棵树是各自 new 出来的，材质对象不同 —— 真实情况是同一份克隆的模板，
    // 所以这里手动让它们共用同一个原材质，模拟 ModelLibrary.instantiate 的行为
    const shared = new THREE.MeshStandardMaterial({ name: 'body_paint' });
    for (const model of [a, b]) {
      (model.children.find((c) => c.name === 'chassis') as THREE.Mesh).material = shared;
    }
    applyTint(a, palette, cache);
    applyTint(b, palette, cache);
    expect(cache.size).toBe(1);

    applyTint(fakeModelWith(shared), { ...palette, body: '#2f6fed' }, cache);
    expect(cache.size).toBe(2);
  });
});

function fakeModelWith(material: THREE.Material): THREE.Object3D {
  const model = fakeModel();
  (model.children.find((c) => c.name === 'chassis') as THREE.Mesh).material = material;
  return model;
}
