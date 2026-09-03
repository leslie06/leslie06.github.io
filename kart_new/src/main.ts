import * as THREE from 'three';
import { FixedStepLoop } from './core/FixedStepLoop';
import { KeyboardAdapter } from './input/KeyboardAdapter';
import { cloneKartConfig, type KartConfig } from './kart/KartConfig';
import {
  createKartState,
  diffKartEvents,
  lerpKartState,
  stepKart,
  type KartEvent,
  type KartState,
} from './kart/kartStep';
import { PhysicsSystem } from './physics/PhysicsSystem';
import { DEFAULT_TRACK_CONFIG, drivableHalfWidth } from './track/TrackConfig';
import { createCenterLine, TrackMesh } from './track/TrackMesh';
import { TrackSpline } from './track/TrackSpline';
import { DriftSparks } from './render/DriftSparks';
import { FollowCamera } from './render/FollowCamera';
import { KartView } from './render/KartView';
import { World } from './render/World';
import { createTrackDebugState, DebugGui } from './ui/DebugGui';
import { Hud } from './ui/Hud';

const container = document.getElementById('app')!;

// --- 渲染器 ---
const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
container.appendChild(renderer.domElement);

// --- 赛道 ---
const trackConfig = DEFAULT_TRACK_CONFIG;
const spline = new TrackSpline(undefined, trackConfig.lutSamples);
const track = new TrackMesh(spline, trackConfig);
const centerLine = createCenterLine(spline);
centerLine.visible = false; // 默认关掉，GUI 里的"显示中心线"再打开

// --- 场景。参照物要避开赛道，不然锥桶会长在路中间 ---
const propClearance = drivableHalfWidth(trackConfig) + trackConfig.wallThickness + 7;
const world = new World({
  groundY: trackConfig.skirtBottomY,
  isBlocked: (x, z) => Math.abs(spline.getProgress(x, z).lateral) < propClearance,
});
world.scene.add(track.group);
world.scene.add(centerLine);

const kartView = new KartView();
world.scene.add(kartView.root);

// 火花挂在 scene 上而不是车上：粒子存的是世界坐标，挂车上会跟着车走
const sparks = new DriftSparks();
world.scene.add(sparks.points);

const followCamera = new FollowCamera(window.innerWidth / window.innerHeight);

// --- 输入 ---
const input = new KeyboardAdapter();

// --- 模拟状态 ---
// config 是可变对象，lil-gui 直接改它，改完立刻生效。
// 必须深拷贝：三个三档参数是数组，浅拷贝会和模块级默认值共享引用
const kartConfig: KartConfig = cloneKartConfig();

/** 出生点 = 样条起点，朝向取该处切线 */
function spawnState(): KartState {
  const p = spline.getPointAt(0);
  return createKartState(p.x, p.z, spline.getHeadingAt(0), p.y);
}

let current: KartState = spawnState();
let previous: KartState = { ...current };

followCamera.snapTo(current, kartConfig);
kartView.update(current, kartConfig, 1 / 60);

// --- UI ---
const hud = new Hud(container);
const trackDebug = createTrackDebugState();
const resetKart = () => {
  current = spawnState();
  previous = { ...current };
  followCamera.snapTo(current, kartConfig);
};
new DebugGui({
  kart: kartConfig,
  camera: followCamera.config,
  view: kartView.config,
  track: trackDebug,
  onResetKart: resetKart,
});
window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') resetKart();
});

// --- 漂移事件 -> 特效 ---
function onKartEvent(event: KartEvent): void {
  switch (event.type) {
    case 'boostStart':
      // 档位越高推得越狠
      followCamera.punch(followCamera.config.punchFov * (0.6 + 0.2 * event.level));
      break;
    case 'driftLevelUp':
    case 'driftStart':
    case 'driftEnd':
    case 'boostEnd':
      // 火花颜色直接读 state.driftLevel，这里暂时不用额外处理。
      // 之后接音效就挂在这几个分支上
      break;
  }
}

const DRIFT_LABELS = ['蓄力中', '一档', '二档', '三档'] as const;
function driftLabel(state: KartState): string {
  if (state.airborne) return '坠落中…';
  if (state.boostTime > 0) return `BOOST ${state.boostLevel}档 ${state.boostTime.toFixed(1)}s`;
  if (state.driftPhase === 'drifting') return DRIFT_LABELS[state.driftLevel]!;
  return '—';
}

const round = (v: number, digits: number): number => {
  const k = 10 ** digits;
  return Math.round(v * k) / k;
};

// --- 主循环：物理固定 60Hz，渲染插值 ---
const rearWheels: THREE.Vector3[] = [];

function makeLoop(physics: PhysicsSystem): FixedStepLoop {
  return new FixedStepLoop({
    fixedDt: 1 / 60,
    update: (dt) => {
      previous = current;
      // 射线在这里打：kartStep 是纯函数，不许自己去查地形
      const ground = physics.sample(current.x, current.y, current.z);
      current = stepKart(current, input.sample(), ground, kartConfig, dt);
      // 每个子步都取一次事件：一个渲染帧可能跑多步，只在 render 里比 prev/current 会漏
      for (const event of diffKartEvents(previous, current)) onKartEvent(event);
    },
    render: (alpha, frameDt) => {
      const state = lerpKartState(previous, current, alpha);

      kartView.update(state, kartConfig, frameDt);
      followCamera.update(state, kartConfig, frameDt);
      world.followShadow(state.x, state.y, state.z);

      // 火花：只有漂移且已成档才喷
      const emitting = state.driftPhase === 'drifting' && state.driftLevel > 0;
      sparks.update(
        emitting ? kartView.getRearWheelWorldPositions(rearWheels) : [],
        state.driftLevel,
        frameDt,
        state.y,
      );

      // boost 速度线：末尾 0.35s 内淡出，不要"啪"地一下消失
      const boostIntensity = Math.min(state.boostTime / 0.35, 1) * 0.85;
      hud.update(state.speed, frameDt, boostIntensity, driftLabel(state));

      centerLine.visible = trackDebug.showCenterLine;
      trackDebug.progress = round(state.trackProgress, 4);
      trackDebug.lateral = round(state.lateralOffset, 2);
      trackDebug.airborne = state.airborne;

      renderer.render(world.scene, followCamera.camera);
    },
  });
}

window.addEventListener('resize', () => {
  renderer.setSize(window.innerWidth, window.innerHeight);
  followCamera.resize(window.innerWidth / window.innerHeight);
});

// rapier 是 wasm，必须 await 完才能查询地形，所以主循环要等它。
// 先画一帧静止画面顶着，别让开局是黑屏。
// （不等的话开局那几帧脚下按平地算，车会从出生点 11m 高往 y=0 沉，接上之后再弹回来）
renderer.render(world.scene, followCamera.camera);
PhysicsSystem.create(spline, track.collision, trackConfig).then((physics) => {
  makeLoop(physics).start();
});
