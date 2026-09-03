import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { KartView } from './KartView';
import { DEFAULT_KART_CONFIG } from '../kart/KartConfig';
import { createKartState, stepKart, type KartState } from '../kart/kartStep';
import { FLAT_GROUND } from '../kart/GroundSample';
import { NEUTRAL_INPUT, type InputState } from '../input/InputState';

const cfg = DEFAULT_KART_CONFIG;
const DT = 1 / 60;
const input = (p: Partial<InputState> = {}): InputState => ({ ...NEUTRAL_INPUT, ...p });

function drive(inp: InputState, seconds: number) {
  const view = new KartView();
  let state: KartState = createKartState();
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    state = stepKart(state, inp, FLAT_GROUND, cfg, DT);
    view.update(state, cfg, DT);
  }
  return { view, state };
}

/**
 * 转向反了这个 bug 犯过两次（一次在 kartStep，一次在前轮视觉角），
 * 所以这里把"视觉方向必须和模拟方向一致"钉死。
 */
describe('KartView 视觉方向', () => {
  it('前轮转的方向和车实际偏航的方向一致', () => {
    for (const steer of [1, -1]) {
      const { view, state } = drive(input({ throttle: 1, steer }), 1);
      expect(state.yawRate).not.toBe(0);
      expect(Math.sign(view.frontWheelAngle)).toBe(Math.sign(state.yawRate));
    }
  });

  it('转向时车身往弯内侧倒（右转右侧下沉）', () => {
    for (const [steer, expectDown] of [
      [1, 'right'],
      [-1, 'left'],
    ] as const) {
      const { view } = drive(input({ throttle: 1, steer }), 2);
      const chassis = view.root.children[0] as THREE.Object3D;

      // 车自身的右侧在模型局部 -x 上（面朝 +z 时 forward × up = -x）
      const rightSide = new THREE.Vector3(-1, 0, 0).applyEuler(chassis.rotation);
      const leftSide = new THREE.Vector3(1, 0, 0).applyEuler(chassis.rotation);

      if (expectDown === 'right') {
        expect(rightSide.y).toBeLessThan(0);
        expect(leftSide.y).toBeGreaterThan(0);
      } else {
        expect(leftSide.y).toBeLessThan(0);
        expect(rightSide.y).toBeGreaterThan(0);
      }
    }
  });

  it('直行不侧倾', () => {
    const { view } = drive(input({ throttle: 1 }), 2);
    expect(Math.abs(view.bodyRoll)).toBeLessThan(1e-6);
    expect(view.frontWheelAngle).toBeCloseTo(0, 6);
  });

  it('车模型跟着 state 走位和转向', () => {
    const { view, state } = drive(input({ throttle: 1, steer: 0.5 }), 2);
    expect(view.root.position.x).toBeCloseTo(state.x, 6);
    expect(view.root.position.z).toBeCloseTo(state.z, 6);
    // 姿态是用四元数设的（要把车顶掰到地面法线上），不能拿 rotation.y 去比 heading：
    // 欧拉分解在 |heading| > π/2 时会给出另一组等价的角度。直接比朝向向量。
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(view.root.quaternion);
    expect(forward.x).toBeCloseTo(Math.sin(state.heading), 6);
    expect(forward.z).toBeCloseTo(Math.cos(state.heading), 6);
    expect(forward.y).toBeCloseTo(0, 6); // 平地上不该有俯仰
  });

  it('地面有坡度时车顶跟着地面法线倒过去，同时保持 heading', () => {
    const view = new KartView();
    const tilt = 0.35;
    const state: KartState = {
      ...createKartState(0, 0, 0.8),
      groundNormalX: Math.sin(tilt),
      groundNormalY: Math.cos(tilt),
      groundNormalZ: 0,
      y: 4,
    };
    view.update(state, cfg, DT);

    expect(view.root.position.y).toBe(4);
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(view.root.quaternion);
    expect(up.x).toBeCloseTo(Math.sin(tilt), 6);
    expect(up.y).toBeCloseTo(Math.cos(tilt), 6);
    // 车头躺在坡面里（和法线严格垂直），水平投影仍然大致是 heading。
    // "大致"是 tilt * yaw 这个复合顺序的固有性质：先转朝向再把车顶掰到法线上，
    // 水平朝向会被带偏一点点（这里 20° 的坡偏了约 1.8°，实际赛道最大 4.4° 的坡偏不到 0.1°）。
    // 反过来写成 yaw * tilt 的话朝向是准了，但坡度会变成随朝向变化的侧倾，那个错得多。
    const forward = new THREE.Vector3(0, 0, 1).applyQuaternion(view.root.quaternion);
    expect(forward.dot(up)).toBeCloseTo(0, 9);
    expect(Math.atan2(forward.x, forward.z)).toBeCloseTo(0.8, 1);
  });
});
