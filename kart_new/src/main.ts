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
import { browserRecordStorage, LapRecordStore } from './race/LapRecord';
import { RaceState } from './race/RaceState';
import { formatTimeOrDash } from './race/formatTime';
import { createRaceDebugState, createTrackDebugState, DebugGui } from './ui/DebugGui';
import { Hud } from './ui/Hud';
import { RaceHud, type RaceResults } from './ui/RaceHud';

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

// --- 比赛 ---
const PLAYER = 'player';
const race = new RaceState([{ id: PLAYER, name: '你', isPlayer: true }]);
const lapRecord = new LapRecordStore(browserRecordStorage());
/** 本局有没有破纪录，结算面板要用 */
let newRecordThisRace = false;
let raceResults: RaceResults | null = null;

// --- UI ---
const hud = new Hud(container);
const raceHud = new RaceHud(container);
const trackDebug = createTrackDebugState();
const raceDebug = createRaceDebugState();
const resetKart = () => {
  current = spawnState();
  previous = { ...current };
  followCamera.snapTo(current, kartConfig);
  race.restart();
  newRecordThisRace = false;
  raceResults = null;
};
new DebugGui({
  kart: kartConfig,
  camera: followCamera.config,
  view: kartView.config,
  track: trackDebug,
  race: raceDebug,
  onResetKart: resetKart,
  onClearRecord: () => lapRecord.clear(),
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

// --- 比赛事件 -> HUD ---
function drainRaceEvents(): void {
  for (const event of race.consumeEvents()) {
    switch (event.type) {
      case 'go':
        raceHud.showGo();
        break;
      case 'lap': {
        // 纪录只认玩家自己的圈速
        const record = event.id === PLAYER && lapRecord.submit(event.time);
        if (record) newRecordThisRace = true;
        if (event.id === PLAYER) raceHud.showLapSplit(event.lap, event.time, event.best, record);
        break;
      }
      case 'raceFinished': {
        const progress = race.getProgress(PLAYER)!;
        raceResults = {
          place: race.getStanding(PLAYER)?.place ?? 1,
          totalTime: progress.totalTime,
          lapTimes: [...progress.lapTimes],
          bestLap: progress.bestLap,
          newRecord: newRecordThisRace,
        };
        break;
      }
      case 'countdownTick':
      case 'racerFinished':
        // 倒计时数字由 RaceHud 直接读 race.countdown 画，这里不用管
        break;
    }
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
      const playerProgress = race.getProgress(PLAYER)!;
      // 射线在这里打：kartStep 是纯函数，不许自己去查地形。
      // 重生点用上一个 checkpoint，而不是最近的样条点（见 RaceProgress.getLastCheckpoint）
      const ground = physics.sample(
        current.x,
        current.y,
        current.z,
        playerProgress.getLastCheckpoint().t,
      );
      // 先更新比赛状态：倒计时和冲线后的输入锁要在这一步之前生效
      race.update(dt, { [PLAYER]: ground.progress });
      const gated = race.gateInput(PLAYER, input.sample());
      current = stepKart(current, gated, ground, kartConfig, dt);
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

      drainRaceEvents();
      const progress = race.getProgress(PLAYER)!;
      raceHud.update(
        {
          phase: race.phase,
          lap: progress.lap + 1,
          totalLaps: race.config.totalLaps,
          lapTime: progress.lapTime,
          lastLap: progress.lastLap,
          bestLap: progress.bestLap,
          recordLap: lapRecord.best,
          countdown: race.countdown,
          lapValid: progress.lapValid,
          place: race.getStanding(PLAYER)?.place ?? 1,
          racerCount: race.racerCount,
          standings: race.standings,
          results: raceResults,
        },
        frameDt,
      );

      centerLine.visible = trackDebug.showCenterLine;
      trackDebug.progress = round(state.trackProgress, 4);
      trackDebug.lateral = round(state.lateralOffset, 2);
      trackDebug.airborne = state.airborne;

      raceDebug.phase = race.phase;
      raceDebug.lap = `${Math.min(progress.lap + 1, race.config.totalLaps)}/${race.config.totalLaps}`;
      raceDebug.sector = progress.sector;
      raceDebug.lapValid = progress.lapValid;
      raceDebug.bestLap = formatTimeOrDash(progress.bestLap);
      raceDebug.record = formatTimeOrDash(lapRecord.best);

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
