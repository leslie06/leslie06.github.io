import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { FollowCamera } from './FollowCamera';
import { DEFAULT_KART_CONFIG } from '../kart/KartConfig';
import { createKartState, stepKart, type KartState } from '../kart/kartStep';
import { FLAT_GROUND } from '../kart/GroundSample';
import { NEUTRAL_INPUT, type InputState } from '../input/InputState';

const cfg = DEFAULT_KART_CONFIG;
const DT = 1 / 60;
const input = (p: Partial<InputState> = {}): InputState => ({ ...NEUTRAL_INPUT, ...p });

/** 开 seconds 秒，返回相机和最终状态。 */
function drive(inp: InputState, seconds: number) {
  const cam = new FollowCamera(16 / 9);
  let state: KartState = createKartState();
  cam.snapTo(state, cfg);
  for (let i = 0; i < Math.round(seconds / DT); i++) {
    state = stepKart(state, inp, FLAT_GROUND, cfg, DT);
    cam.update(state, cfg, DT);
  }
  return { cam, state };
}

const planarDistance = (cam: FollowCamera, s: KartState) =>
  Math.hypot(cam.camera.position.x - s.x, cam.camera.position.z - s.z);

describe('FollowCamera', () => {
  it('静止时正好停在 baseDistance 后面', () => {
    const { cam, state } = drive(input(), 1);
    expect(planarDistance(cam, state)).toBeCloseTo(cam.config.baseDistance, 3);
    expect(cam.camera.fov).toBeCloseTo(cam.config.baseFov, 3);
  });

  it('速度越快相机拉得越远、FOV 越大', () => {
    const slow = drive(input({ throttle: 0.15 }), 6);
    const fast = drive(input({ throttle: 1 }), 6);
    expect(Math.abs(fast.state.speed)).toBeGreaterThan(Math.abs(slow.state.speed));
    expect(planarDistance(fast.cam, fast.state)).toBeGreaterThan(planarDistance(slow.cam, slow.state));
    expect(fast.cam.camera.fov).toBeGreaterThan(slow.cam.camera.fov);
  });

  /**
   * 弹簧追匀速目标会有稳态滞后，FollowCamera 用速度前馈补掉了。
   * 没有补偿的话满速时会被拖到配置值的 1.6 倍远，baseDistance/distanceGain 就白调了。
   */
  it('稳态距离贴合配置值，不被弹簧滞后拖走（直行和转弯都是）', () => {
    for (const steer of [0, 0.6, 1]) {
      const { cam, state } = drive(input({ throttle: 1, steer }), 6);
      const ratio = Math.min(Math.abs(state.speed) / cfg.maxSpeed, 1);
      const want = cam.config.baseDistance + cam.config.distanceGain * ratio;
      expect(planarDistance(cam, state)).toBeGreaterThan(want - 1);
      expect(planarDistance(cam, state)).toBeLessThan(want + 1);
    }
  });

  /**
   * 玩家说的"左右"其实是屏幕左右，取决于 sim 和相机两边符号的组合，
   * 单看 heading 或单看相机都验不出来。这里把车的位移变换到相机空间：
   * 相机 local +x 就是屏幕右，按右舵它必须为正。
   */
  it('按右舵车在画面里往右走，按左舵往左走', () => {
    for (const [label, steer, wantSign] of [
      ['右', 1, 1],
      ['左', -1, -1],
    ] as const) {
      const cam = new FollowCamera(16 / 9);
      let state = createKartState();
      cam.snapTo(state, cfg);
      // 先直行加速到巡航，让相机稳定下来
      for (let i = 0; i < 120; i++) {
        state = stepKart(state, input({ throttle: 1 }), FLAT_GROUND, cfg, DT);
        cam.update(state, cfg, DT);
      }

      // 冻结这一刻的相机，再打舵，看车相对这个视角往哪边跑
      cam.camera.updateMatrixWorld(true);
      const frozen = cam.camera.clone();
      for (let i = 0; i < 30; i++) {
        state = stepKart(state, input({ throttle: 1, steer }), FLAT_GROUND, cfg, DT);
      }

      const inCameraSpace = frozen.worldToLocal(new THREE.Vector3(state.x, 0, state.z));
      expect(Math.sign(inCameraSpace.x), `按${label}舵画面里应该往${label}偏`).toBe(wantSign);
    }
  });

  it('相机不会钻到地面以下', () => {
    const { cam } = drive(input({ throttle: 1, steer: 1 }), 6);
    expect(cam.camera.position.y).toBeGreaterThanOrEqual(0.4);
  });

  it('掉帧（大 frameDt）时弹簧不发散', () => {
    const cam = new FollowCamera(16 / 9);
    let state = createKartState();
    cam.snapTo(state, cfg);
    for (let i = 0; i < 120; i++) {
      state = stepKart(state, input({ throttle: 1, steer: 1 }), FLAT_GROUND, cfg, 1 / 5);
      cam.update(state, cfg, 1 / 5); // 5 FPS
    }
    expect(Number.isFinite(cam.camera.position.x)).toBe(true);
    expect(planarDistance(cam, state)).toBeLessThan(60);
  });
});
