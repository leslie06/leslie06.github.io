import * as THREE from 'three';
import { FixedStepLoop } from './core/FixedStepLoop';
import { probeDeviceCaps } from './core/DeviceCaps';
import { applyUrlOverrides, loadPrefs, savePrefs, type Prefs } from './core/Prefs';
import { KeyboardAdapter } from './input/KeyboardAdapter';
import { TouchAdapter } from './input/TouchAdapter';
import { resolveInputMode, type InputMode, type InputModeSetting } from './input/InputMode';
import type { InputAdapter } from './input/InputState';
import { cloneKartConfig, type KartConfig } from './kart/KartConfig';
import { createGroundSample, type GroundSample } from './kart/GroundSample';
import {
  createKartState,
  diffKartEvents,
  lerpKartState,
  stepKart,
  type KartEvent,
  type KartState,
} from './kart/kartStep';
import {
  DEFAULT_KART_COLLISION_CONFIG,
  resolveKartCollisions,
  type KartCollisionConfig,
} from './kart/kartCollision';
import type { PhysicsSystem as PhysicsSystemType } from './physics/PhysicsSystem';
import { drivableHalfWidth } from './track/TrackConfig';
import { trackAt, type TrackId } from './track/TrackCatalog';
import { createCenterLine, TrackMesh } from './track/TrackMesh';
import { TrackSpline } from './track/TrackSpline';
import { AIKart } from './ai/AIKart';
import type { AIItemView } from './ai/AIDriver';
import { personaAt, type AIDifficulty } from './ai/AIProfiles';
import { createSplineSampler } from './ai/SplineSampler';
import { DriftSparks } from './render/DriftSparks';
import { TireDust } from './render/TireDust';
import { ImpactFx } from './render/ImpactFx';
import { BoostTrails } from './render/BoostTrails';
import { FollowCamera } from './render/FollowCamera';
import { KartView } from './render/KartView';
import { World } from './render/World';
import { BlobShadows } from './render/BlobShadows';
import { PostFx } from './render/PostFx';
import { FrameMonitor } from './render/FrameMonitor';
import {
  effectivePixelRatio,
  lowerTier,
  QUALITY_TIERS,
  resolveTier,
  type QualityTier,
  type TierOverride,
} from './render/QualityTiers';
import { reportPerfBudget } from './render/PerfBudget';
import { AssetLoader } from './assets/AssetLoader';
import { LoadProgress } from './assets/LoadProgress';
import { ModelLibrary } from './assets/ModelLibrary';
import { KART_MODEL_URL, SKY_HDRI_URL } from './assets/ModelPaths';
import { AudioManager } from './audio/AudioManager';
import { RaceAudio } from './audio/RaceAudio';
import { browserRecordStorage, lapRecordKey, LapRecordStore } from './race/LapRecord';
import { RaceState, type RacerInit } from './race/RaceState';
import { buildStartGrid, type GridSlot } from './race/StartGrid';
import { formatTimeOrDash } from './race/formatTime';
import {
  createAIDebugState,
  createItemDebugState,
  createPerfDebugState,
  createRaceDebugState,
  createTrackDebugState,
  DebugGui,
} from './ui/DebugGui';
import { ItemBoxField } from './items/ItemBoxes';
import { ITEM_DEFS, ITEM_IDS, lotteryChances, type ItemDef } from './items/ItemDefs';
import { ItemSystem, type ItemKart } from './items/ItemSystem';
import type { EffectType } from './items/EffectSystem';
import { ItemBoxViews, ProjectileViews, TrapViews } from './render/ItemViews';
import { Hud } from './ui/Hud';
import { ItemHud, type ItemHudView } from './ui/ItemHud';
import { RaceHud, type RaceResults, type ResultRow, type TrackDot } from './ui/RaceHud';
import { LoadingScreen } from './ui/LoadingScreen';
import { MainMenu } from './ui/MainMenu';
import { SettingsMenu } from './ui/SettingsMenu';
import { THEME } from './ui/theme';
import { Toast } from './ui/Toast';
import { installContextLossGuard, installGestureGuards, OrientationGate } from './ui/DeviceOverlays';

const container = document.getElementById('app')!;

// ============================================================================
// 启动：先定档位和操作方式，再建东西
// ============================================================================
// 这两件事必须在建渲染器之前定下来：antialias 是构造参数，建完就改不了；
// AI 数量决定要 new 多少辆车，也没法中途加减
// ?quality=low&input=touch 可以临时压过存储里的设置，方便在真机上直接验低画质
const prefs: Prefs = applyUrlOverrides(loadPrefs(), location.search);
const caps = probeDeviceCaps();
let { tier, settings, detected: detectedTier } = resolveTier(caps, prefs.quality);
const inputModes = resolveInputMode(caps, prefs.input);
let inputMode: InputMode = inputModes.mode;

// ============================================================================
// 主菜单：选赛道
// ============================================================================
// 菜单必须排在所有重活**前面**，因为赛道网格、rapier 的碰撞体、环境贴图
// 全都是按选中的那条赛道建的，先建就白建了。
// 顺带解决第二件事：音频只能在用户手势里初始化，"开始比赛"那一下正好是。
const audio = new AudioManager({
  settings: { master: prefs.volume, music: prefs.musicVolume, muted: prefs.muted },
  onSettingsChange: (next) => {
    prefs.volume = next.master;
    prefs.musicVolume = next.music;
    prefs.muted = next.muted;
    savePrefs(prefs);
  },
});
const raceAudio = new RaceAudio(audio);

const selectedTrackId: TrackId = await new Promise<TrackId>((resolve) => {
  const menu = new MainMenu(container, {
    initial: prefs.track,
    quality: prefs.quality,
    detectedTier,
    onQuality: (value) => {
      prefs.quality = value;
      savePrefs(prefs);
      // 这时候渲染器、世界、AI 都还没建，所以"生效"就是把档位重算一遍写回去 ——
      // 菜单关掉之后下面才拿着 settings 去建渲染器（antialias 是构造参数）
      // 和车队（AI 数量），这两样开局之后就改不了了
      ({ tier, settings, detected: detectedTier } = resolveTier(caps, prefs.quality));
    },
    bestLapOf: (id) => new LapRecordStore(browserRecordStorage(), lapRecordKey(id)).best,
    onSelect: (id) => {
      prefs.track = id;
      savePrefs(prefs);
    },
    onStart: (id) => {
      prefs.track = id;
      savePrefs(prefs);
      // 这一句必须在点击的调用栈里同步跑掉，异步之后 iOS 就不认这个手势了
      audio.init();
      audio.play('uiClick');
      menu.hide();
      resolve(id);
    },
  });
});

const variant = trackAt(selectedTrackId);

// 加载界面接在菜单后面，底色是同一片天，看着是一个连续的画面
const loading = new LoadingScreen(container);
const progress = new LoadProgress(
  [
    { id: 'scene', label: '生成赛道…', weight: 3 },
    { id: 'assets', label: '下载资源…', weight: 2 },
    { id: 'physics', label: '启动物理引擎…', weight: 4 },
  ],
  (snapshot) => loading.update(snapshot),
);
/** 让出一帧，好让浏览器把加载界面/进度条真的画出来 */
const nextFrame = () => new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
await nextFrame();

// --- 渲染器 ---
const renderer = new THREE.WebGLRenderer({
  antialias: settings.antialias,
  powerPreference: 'high-performance',
});
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
// PCFSoft 在 three 0.185 里已经弃用（内部会静默退回 PCF，只留一条警告），
// 直接写 PCF，省掉每次启动的那条控制台噪音
renderer.shadowMap.type = THREE.PCFShadowMap;
// 统计要手动清零：开了后处理之后一帧里有好几个 pass，自动清零的话
// info.render 里只剩最后那个全屏 pass 的数字（1 个 drawcall），预算就白核了
renderer.info.autoReset = false;
container.appendChild(renderer.domElement);

// --- 赛道。形状 / 路宽 / 圈数 / 道具箱位置全部来自 TrackCatalog 里选中的那条 ---
const trackConfig = variant.config;
const spline = new TrackSpline(variant.points, trackConfig.lutSamples);
const track = new TrackMesh(spline, trackConfig);
const centerLine = createCenterLine(spline);
centerLine.visible = false; // 默认关掉，GUI 里的"显示中心线"再打开

// --- 场景。参照物要避开赛道，不然锥桶会长在路中间 ---
const propClearance = drivableHalfWidth(trackConfig) + trackConfig.wallThickness + 7;
const world = new World({
  groundY: trackConfig.skirtBottomY,
  isBlocked: (x, z) => Math.abs(spline.getProgress(x, z).lateral) < propClearance,
  quality: settings,
  // 烘环境贴图（PMREM）要用渲染器。不传的话场景只剩半球光，背光面会很平
  renderer,
});
world.scene.add(track.group);
world.scene.add(centerLine);

const followCamera = new FollowCamera(window.innerWidth / window.innerHeight);
const postFx = new PostFx(renderer, world.scene, followCamera.camera, settings);

// --- 输入。键盘和触屏是平级的两套适配器，随时可以换 ---
let input: InputAdapter = makeInput(inputMode);

function makeInput(mode: InputMode): InputAdapter {
  document.body.classList.toggle('touch-input', mode === 'touch');
  return mode === 'touch' ? new TouchAdapter(container) : new KeyboardAdapter();
}

function setInputMode(setting: InputModeSetting): void {
  const resolved = resolveInputMode(caps, setting);
  prefs.input = setting;
  savePrefs(prefs);
  if (resolved.mode === inputMode) return;
  input.dispose();
  inputMode = resolved.mode;
  input = makeInput(inputMode);
  orientationGate.setEnabled(inputMode === 'touch');
  // 调参面板在手机上占半个屏幕，切到触屏就收起来（按 H 还能叫回来）
  if (inputMode === 'touch') debugGui.setVisible(false);
}

// --- 模拟状态 ---
// config 是可变对象，lil-gui 直接改它，改完立刻生效。
// 必须深拷贝：三个三档参数是数组，浅拷贝会和模块级默认值共享引用。
// AI 每步会把这份逐字段拷进自己的副本（见 AIKart.syncConfig），所以调参对所有车同时生效
const kartConfig: KartConfig = cloneKartConfig();

// ============================================================================
// 阵容
// ============================================================================
const PLAYER = 'player';
/** 对手数量跟着画质档位走（high 7 / medium 5 / low 3）。改档位要重开页面才生效 */
const AI_COUNT = settings.aiCount;
/** 玩家排在最后一格。从队尾往前超才有得玩，也让镜头一开局就看得见对手 */
const PLAYER_SLOT = AI_COUNT;
const DEFAULT_DIFFICULTY: AIDifficulty = 'normal';

/** 玩家的配色。AI 各自的配色在 AI_PERSONAS 里 */
const PLAYER_PALETTE = { body: '#ff3b30', accent: '#ffcc00', trim: '#f7f7fa', suit: '#2f6fed' };

const aiTrack = createSplineSampler(spline);
const grid: GridSlot[] = buildStartGrid(aiTrack, AI_COUNT + 1);

/** 发车格 -> 出生状态。y 取该处中心线高度，免得开局往下沉一截 */
function spawnAt(slot: GridSlot): { x: number; z: number; y: number; heading: number } {
  const y = spline.getPointAt(slot.t).y;
  return { x: slot.x, z: slot.z, y, heading: slot.heading };
}

const playerSpawn = () => spawnAt(grid[PLAYER_SLOT]!);

/** 第 i 辆 AI 占哪个发车格：除玩家那一格外按顺序填，序号越小越靠前 */
const aiSlots: number[] = [];
for (let slot = 0; slot < grid.length; slot++) {
  if (slot !== PLAYER_SLOT) aiSlots.push(slot);
}

let current: KartState = (() => {
  const s = playerSpawn();
  return createKartState(s.x, s.z, s.heading, s.y);
})();
let previous: KartState = { ...current };

const ais: AIKart[] = aiSlots.map(
  (slot, i) =>
    new AIKart(
      { id: `ai${i}`, persona: personaAt(i), difficulty: DEFAULT_DIFFICULTY, track: aiTrack },
      spawnAt(grid[slot]!),
    ),
);

// ============================================================================
// 道具
// ============================================================================
// 箱子位置写在 TrackConfig 里（ITEM_BOX_ROWS），这里把 (t, lateral) 换算成世界坐标。
// 判定用世界坐标而不是 (t, lateral)：进度 t 在终点线附近会绕回去
const itemBoxPlacements = variant.itemBoxRows.flatMap((row) => {
  const center = spline.getPointAt(row.t);
  const heading = spline.getHeadingAt(row.t);
  // 车手视角的"右" = (sin(h - π/2), cos(h - π/2))，和 TrackSpline.lateral 同一套约定
  const rx = Math.sin(heading - Math.PI / 2);
  const rz = Math.cos(heading - Math.PI / 2);
  return row.lanes.map((lateral) => ({
    x: center.x + rx * lateral,
    y: center.y,
    z: center.z + rz * lateral,
  }));
});
const items = new ItemSystem(aiTrack, new ItemBoxField(itemBoxPlacements), { seed: 0x4b41 });

// --- 渲染侧：每辆车一个 KartView，特效池全场共用 ---
const kartView = new KartView(PLAYER_PALETTE);
world.scene.add(kartView.root);

const aiViews: KartView[] = ais.map((ai) => {
  const view = new KartView({
    body: ai.persona.color,
    accent: ai.persona.accent,
    suit: ai.persona.accent,
  });
  world.scene.add(view.root);
  return view;
});
/** 玩家 + 所有 AI，顺序固定：0 是玩家。拖尾的槽位、车尾坐标都按这个下标走 */
const allViews: KartView[] = [kartView, ...aiViews];

// 特效池挂在 scene 上而不是车上：粒子存的是世界坐标，挂车上会跟着车走。
//
// **全场一个池子**，不是每辆车一个：一个 Points = 一个 drawcall，八辆车各一套
// 火花和扬尘就是 16 个 drawcall，而 low 档总共才 150 个。粒子既然是世界坐标的，
// 谁发射的对渲染来说毫无区别，合并是白赚的。
// 容量按档位乘上车数：typed array 建好就不能改大小，所以只在启动时定一次
const sparkKarts = settings.aiSparks ? AI_COUNT + 1 : 1;
const sparks = new DriftSparks(settings.sparkCapacity * sparkKarts);
world.scene.add(sparks.points);

// 扬尘：low 档 dustCapacity 是 0，整个池子就不建
const dust = settings.dustCapacity > 0 ? new TireDust(settings.dustCapacity * sparkKarts) : null;
if (dust) world.scene.add(dust.points);

// 命中爆闪。全场一个，容量最小的 low 档也有 60 颗
const impacts = new ImpactFx(settings.burstCapacity);
world.scene.add(impacts.points);

// boost 拖尾：所有车的飘带在同一个几何体里，1 个 drawcall
const trails = new BoostTrails(AI_COUNT + 1);
trails.setVisible(settings.boostTrail);
world.scene.add(trails.mesh);

// 假阴影：low 档关掉实时阴影之后靠它给出"车贴着地"的线索。一个 InstancedMesh 画全场
const blobShadows = new BlobShadows(AI_COUNT + 1);
world.scene.add(blobShadows.mesh);

/** 粒子的屏幕大小依赖 drawingBuffer 的高度，换分辨率/转屏时要重设 */
function syncParticleViewport(): void {
  const height = renderer.getDrawingBufferSize(new THREE.Vector2()).y;
  sparks.setViewportHeight(height);
  dust?.setViewportHeight(height);
  impacts.setViewportHeight(height);
}

followCamera.snapTo(current, kartConfig);
kartView.update(current, kartConfig, 1 / 60);

// --- 比赛 ---
const racerInits: RacerInit[] = [
  { id: PLAYER, name: '你', isPlayer: true, startT: grid[PLAYER_SLOT]!.t },
  ...ais.map((ai, i) => ({
    id: ai.id,
    name: ai.persona.name,
    startT: grid[aiSlots[i]!]!.t,
  })),
];
const race = new RaceState(racerInits, { totalLaps: variant.laps });
for (const r of racerInits) items.register(r.id);
// 每条赛道一份纪录：850m 的草原和 1200m 的山脊圈速没有可比性，
// 共用一个键的话跑一次长道就把短道的纪录永久顶掉了
const lapRecord = new LapRecordStore(browserRecordStorage(), lapRecordKey(variant.id));
/** 本局有没有破纪录，结算面板要用 */
let newRecordThisRace = false;
let raceResults: RaceResults | null = null;

/** 每辆车一份地面采样结果。共享一个的话前面几辆的采样会被后面覆盖掉 */
const playerGround: GroundSample = createGroundSample();
const aiGrounds: GroundSample[] = ais.map(() => createGroundSample());
/** 喂给 race.update 的进度表，复用同一个对象 */
const positions: Record<string, number> = {};
/** 碰撞检测的入参数组，复用 */
const collisionBodies: KartState[] = [];
/** 可变副本，lil-gui 直接调它 */
const collisionConfig: KartCollisionConfig = { ...DEFAULT_KART_COLLISION_CONFIG };

/**
 * 玩家这一步实际用的 config。
 *
 * 不能直接把 kartConfig 喂给 stepKart 了：道具效果是**改一份副本**实现的
 * （见 EffectSystem 的说明），直接改原件的话减速效果会永久留在调参面板上。
 * 每步先从 kartConfig 拷一份，再让效果层盖上去。AI 那边同理，在 AIKart.syncConfig 里。
 */
const playerConfig: KartConfig = cloneKartConfig();
/** 喂给 ItemSystem 的车辆列表，复用 */
const itemKarts: ItemKart[] = [];
/** 每辆 AI 一份道具视图，复用 */
const aiItemViews: AIItemView[] = ais.map(() => ({
  hasItem: false,
  offensive: false,
  targetAhead: false,
}));

/**
 * 把 base 逐字段拷进 out。
 * 三档数组**就地**改而不是换引用：换引用会和 base 共享同一个数组，
 * 之后谁改都串台（cloneKartConfig 的注释里踩过同一个坑），而且每帧新建三个数组是白扔垃圾。
 */
function copyConfigInto(out: KartConfig, base: Readonly<KartConfig>): void {
  const triples = ['chargeThresholds', 'boostSpeedMul', 'boostDuration'] as const;
  const kept = triples.map((k) => out[k]);
  Object.assign(out, base);
  triples.forEach((key, i) => {
    const dst = kept[i]!;
    const src = base[key];
    dst[0] = src[0];
    dst[1] = src[1];
    dst[2] = src[2];
    out[key] = dst;
  });
}

/**
 * AI 判断"前面够近的地方有没有车"。
 * 只看四分之一圈以内，太远的目标打不到，攥着道具等它没意义
 */
function hasTargetAhead(fromT: number, id: string): boolean {
  for (const k of itemKarts) {
    if (k.id === id) continue;
    const gap = ((k.trackT - fromT) % 1 + 1) % 1;
    if (gap > 0 && gap < 0.12) return true;
  }
  return false;
}

// --- 道具的渲染 ---
const itemBoxViews = new ItemBoxViews(items.boxes.boxes);
const projectileViews = new ProjectileViews();
const trapViews = new TrapViews();
world.scene.add(itemBoxViews.group);
world.scene.add(projectileViews.group);
world.scene.add(trapViews.group);

// --- UI ---
const hud = new Hud(container);
const itemHud = new ItemHud(container);
// 结算面板上的两个按钮。触屏上没有 R 键，"再来一局"是唯一的重开入口。
//
// "换赛道"是**重载页面**：赛道网格、rapier 的碰撞体、发车格、AI 的赛道采样器
// 全是按这条赛道建的，运行时换等于把整个世界拆了重搭。重载几秒钟就完事，
// 而且加载界面本来就在，比维护一套"拆干净"的代码可靠得多
const raceHud = new RaceHud(container, {
  onRestart: () => resetKart(),
  onChangeTrack: () => {
    audio.play('uiClick');
    savePrefs(prefs);
    location.reload();
  },
});
const toast = new Toast(container);
const trackDebug = createTrackDebugState();
const raceDebug = createRaceDebugState();
const aiDebug = createAIDebugState(AI_COUNT, DEFAULT_DIFFICULTY);
const itemDebug = createItemDebugState();
const perfDebug = createPerfDebugState(tier);

// ============================================================================
// 画质档位
// ============================================================================
/**
 * 把一档参数套到所有吃画质的地方。
 *
 * 这是**唯一**改这些渲染参数的入口 —— 手动改档、帧率自适应降档都走它，
 * 所以永远不会出现"改了像素比但忘了改阴影"这种半套状态。
 * 三样东西这里改不了，它们只能在启动时定：AI 数量、火花池容量、抗锯齿开关。
 */
function applyQuality(nextTier: QualityTier): void {
  tier = nextTier;
  settings = QUALITY_TIERS[nextTier];

  renderer.setPixelRatio(effectivePixelRatio(settings, window.devicePixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.shadowMap.enabled = settings.shadowMapSize > 0;

  world.setQuality(settings);
  postFx.setQuality(settings);
  postFx.setSize(window.innerWidth, window.innerHeight);
  blobShadows.setVisible(settings.blobShadows);

  followCamera.camera.far = settings.cameraFar;
  followCamera.camera.updateProjectionMatrix();

  // 拖尾在 low 档整个关掉。池子还留着（它就一个几何体，不占什么），
  // 只是不画 —— 这样从 low 调回 high 不用重建
  trails.setVisible(settings.boostTrail);
  // 像素比可能变了，粒子的屏幕大小要跟着重算
  syncParticleViewport();

  perfDebug.tier = nextTier;
  frameMonitor.reset();
}

function setQualityOverride(override: TierOverride): void {
  prefs.quality = override;
  savePrefs(prefs);
  applyQuality(override === 'auto' ? detectedTier : override);
  settingsMenu.setActiveTier(tier, override);
}

/** 帧率一直上不去就自己降一档，并且说一声 —— 画面突然变糊得让人知道为什么 */
function autoDowngrade(): void {
  const next = lowerTier(tier);
  if (!next) return;
  applyQuality(next);
  // 记成手动覆盖：既然这台机器跑不动自动挡选的档，下次进来就别再从那一档开始
  prefs.quality = next;
  savePrefs(prefs);
  settingsMenu.setActiveTier(next, next);
  toast.show(`帧率不够，画质已降到「${TIER_NAMES[next]}」（左下角设置里可以调回去）`, 4);
}

const TIER_NAMES: Record<QualityTier, string> = { high: '高', medium: '中', low: '低' };

const frameMonitor = new FrameMonitor();

const settingsMenu = new SettingsMenu(container, {
  prefs,
  detectedTier,
  detectedInput: inputModes.detected,
  onQuality: setQualityOverride,
  onInput: setInputMode,
  // 音量的持久化在 AudioManager 的 onSettingsChange 里做（它是唯一知道
  // 当前真实音量的地方），所以这里只管把值转过去
  onVolume: (bus, value) => audio.setVolume(bus, value),
  onMuted: (muted) => audio.setMuted(muted),
});

// --- 移动端的几个专项处理 ---
const orientationGate = new OrientationGate(container);
orientationGate.setEnabled(inputMode === 'touch');
// 竖屏时把主循环停掉：遮罩已经盖住了，没必要在后面接着烧电
orientationGate.onChange = (portrait) => {
  if (portrait) loop?.stop();
  else if (started) loop?.start();
};

installContextLossGuard(renderer.domElement, container, {
  onLost: () => loop?.stop(),
  onRestored: () => {
    if (started) loop?.start();
    toast.show('画面已恢复', 2);
  },
});

// 触摸设备一律装上手势拦截：双击缩放、长按选中、整页橡皮筋在游戏里全是干扰
if (caps.maxTouchPoints > 0) installGestureGuards();


/** 主循环，物理起来之后才建 */
let loop: FixedStepLoop | null = null;
/** 已经开跑了（用来决定遮罩消失后要不要恢复循环） */
let started = false;

const resetKart = () => {
  const s = playerSpawn();
  current = createKartState(s.x, s.z, s.heading, s.y);
  previous = { ...current };
  followCamera.snapTo(current, kartConfig);
  ais.forEach((ai, i) => ai.respawn(spawnAt(grid[aiSlots[i]!]!)));
  race.restart();
  items.reset();
  newRecordThisRace = false;
  raceResults = null;
  // 特效也要清干净：不清的话上一局的火花会飘在新赛道上，
  // 拖尾更明显 —— 它会从旧位置拉出一条横跨全场的带子
  sparks.clear();
  dust?.clear();
  impacts.clear();
  trails.clear();
  raceAudio.reset();
};

const applyAISettings = () => {
  for (const ai of ais) {
    ai.setDifficulty(aiDebug.difficulty);
    ai.rubberbandEnabled = aiDebug.rubberband;
  }
};

const debugGui = new DebugGui({
  kart: kartConfig,
  camera: followCamera.config,
  view: kartView.config,
  track: trackDebug,
  race: raceDebug,
  collision: collisionConfig,
  ai: aiDebug,
  item: itemDebug,
  itemBox: items.boxes.config,
  projectile: items.projectileConfig,
  perf: perfDebug,
  onGrantItem: () => items.grant(PLAYER, itemDebug.forceItem),
  onAIChanged: applyAISettings,
  onResetKart: resetKart,
  onClearRecord: () => lapRecord.clear(),
});
// 触屏上默认收起调参面板：它是给键鼠调手感用的，在手机上只会挡住半个屏幕
if (inputMode === 'touch') debugGui.setVisible(false);

window.addEventListener('keydown', (e) => {
  if (e.code === 'KeyR') resetKart();
});

// --- 漂移事件 -> 特效 ---
function onKartEvent(event: KartEvent): void {
  raceAudio.onKartEvent(event);
  switch (event.type) {
    case 'boostStart':
      // 档位越高推得越狠
      followCamera.punch(followCamera.config.punchFov * (0.6 + 0.2 * event.level));
      break;
    case 'driftLevelUp':
      // 成档那一下在车尾炸一小簇同色的光，"到档了"这件事不用盯着火花数颜色
      kartView.getTailWorldPosition(_tail);
      impacts.burst(
        _tail.x,
        _tail.y,
        _tail.z,
        `#${DriftSparks.LEVEL_COLORS[event.level - 1]!.getHexString()}`,
        0.35,
        8,
      );
      break;
    case 'driftStart':
    case 'driftEnd':
    case 'boostEnd':
      // 这几个由火花颜色和循环音的音量变化表达，不用额外做什么
      break;
  }
}

/** 复用的车尾坐标，避免每次事件都 new 一个 Vector3 */
const _tail = new THREE.Vector3();

/** 按 id 找车的当前位置。命中特效要在挨打的那辆车身上炸 */
function stateOf(id: string): Readonly<KartState> | null {
  if (id === PLAYER) return current;
  return ais.find((ai) => ai.id === id)?.current ?? null;
}

// --- 比赛事件 -> HUD ---
function drainRaceEvents(): void {
  for (const event of race.consumeEvents()) {
    raceAudio.onRaceEvent(event, PLAYER);
    switch (event.type) {
      case 'go':
        raceHud.showGo();
        break;
      case 'lap': {
        // 纪录只认玩家自己的圈速
        const record = event.id === PLAYER && lapRecord.submit(event.time);
        if (record) {
          newRecordThisRace = true;
          raceAudio.onNewRecord();
        }
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
          standings: buildResultRows(),
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

/** 车身配色查表，进度条圆点和结算排名表都要用 */
const colorOf = new Map<string, string>([[PLAYER, PLAYER_PALETTE.body]]);
for (const ai of ais) colorOf.set(ai.id, ai.persona.color);

function buildResultRows(): ResultRow[] {
  return race.standings.map((s) => ({
    place: s.place,
    name: s.name,
    isPlayer: s.isPlayer,
    color: colorOf.get(s.id) ?? '#ffffff',
    finishTime: s.finishTime,
    lap: s.lap,
    finished: s.finished,
  }));
}

/** 进度条上的小圆点。用赛道进度 t（totalProgress 的小数部分）定位 */
const dots: TrackDot[] = [];
function buildDots(): TrackDot[] {
  dots.length = 0;
  for (const standing of race.standings) {
    const progress = race.getProgress(standing.id);
    if (!progress) continue;
    dots.push({
      id: standing.id,
      t: progress.t,
      color: colorOf.get(standing.id) ?? '#ffffff',
      isPlayer: standing.isPlayer,
    });
  }
  return dots;
}

// --- 道具事件 -> HUD / 特效 ---
function drainItemEvents(): void {
  for (const event of items.consumeEvents()) {
    raceAudio.onItemEvent(event, PLAYER);
    switch (event.type) {
      case 'pickup':
        // 只播玩家自己的抽奖动画。AI 拿到道具是它们自己的事
        if (event.kartId === PLAYER) itemHud.playRoll();
        break;
      case 'use':
        break;
      case 'hit': {
        // 爆闪打在挨打的那辆车身上 —— 包括 AI，看着别人被打中也是反馈的一部分
        const victim = stateOf(event.kartId);
        if (victim) impacts.burst(victim.x, victim.y + 0.7, victim.z, THEME.danger, 1, 26);
        if (event.kartId === PLAYER) {
          // 自己中招：镜头拉远一下（负值走 punch 那条通道）+ 一记短促的震动
          followCamera.punch(-followCamera.config.punchFov * 0.5);
          followCamera.shake(1);
        }
        break;
      }
      case 'blocked': {
        // 护盾挡下来的那一下用护盾色，和"被打中"分得开
        const owner = stateOf(event.kartId);
        if (owner) impacts.burst(owner.x, owner.y + 0.7, owner.z, THEME.mint, 0.7, 14);
        break;
      }
    }
  }
}

/** 效果条要画"还剩多少"，所以得记住它满的时候有多长 */
const effectTotals = new Map<string, number>();
const itemHudEffects: ItemHudView['effects'] = [];

function playerItemView(): ItemHudView {
  const held = items.held(PLAYER);
  const list = items.effectsOf(PLAYER).list();
  const out = itemHudEffects as { type: EffectType; remaining: number; total: number }[];
  out.length = 0;
  for (const e of list) {
    // 第一次见到这个效果时它就是满的，记下来当分母
    const prev = effectTotals.get(e.type) ?? 0;
    const total = e.duration > prev ? e.duration : prev;
    effectTotals.set(e.type, total);
    out.push({ type: e.type, remaining: e.duration, total });
  }
  // 已经消失的效果把分母也忘掉，免得下次进度条从半截开始
  for (const type of [...effectTotals.keys()]) {
    if (!list.some((e) => e.type === type)) effectTotals.delete(type);
  }
  return {
    held: held ? (ITEM_DEFS[held] as ItemDef) : null,
    effects: out,
    rolling: false,
  };
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
/** 复用的轮子世界坐标数组，避免每帧新建 Vector3 */
const wheelPoints: THREE.Vector3[] = [];
/**
 * 这一帧**玩家**和几辆车挨上了。
 *
 * 只数玩家的，不数全场的：八辆车互相挤的时候全场接触对数一直在跳，
 * 拿它驱动音效和震动的话，玩家会在完全没被碰到的时候被晃一下。
 */
let playerContacts = 0;
/** 上一帧的值，用来把"刚撞上"和"一直挤着"区分开 */
let prevPlayerContacts = 0;

/** 和 resolveKartCollisions 同一套判定：水平距离小于两倍半径，且高度差不大 */
function countPlayerContacts(): number {
  let n = 0;
  const r2 = (collisionConfig.radius * 2) ** 2;
  for (const ai of ais) {
    if (Math.abs(ai.current.y - current.y) > collisionConfig.maxHeightDiff) continue;
    const dx = ai.current.x - current.x;
    const dz = ai.current.z - current.z;
    if (dx * dx + dz * dz < r2) n++;
  }
  return n;
}

/**
 * 一辆车这一帧要喷的所有特效：漂移火花、轮胎扬尘、boost 拖尾。
 *
 * 玩家和 AI 走的是同一个函数 —— 特效规则只写一遍，不会出现"玩家有扬尘、
 * AI 没有"这种半套状态（low 档整体关掉 AI 的特效是另一回事，那是有意的）。
 *
 * @param slot 拖尾的槽位，0 是玩家
 */
function emitKartFx(
  slot: number,
  state: Readonly<KartState>,
  cfg: Readonly<KartConfig>,
  view: KartView,
  ground: Readonly<GroundSample>,
  frameDt: number,
  particles: boolean,
): void {
  const drifting = state.driftPhase === 'drifting' && !state.airborne;

  // --- 火花：漂移且已成档才喷。没成档就有火花的话，"到档了"就没有提示作用了 ---
  if (particles && drifting && state.driftLevel > 0) {
    sparks.emit(view.getWheelWorldPositions(wheelPoints, 'rear'), state.driftLevel, frameDt, ground.height);
  }

  // --- 扬尘：漂移时从后轮扬，压出柏油（路肩/草地）时四个轮子都扬 ---
  if (particles && dust && !state.airborne) {
    const speedRatio = Math.min(Math.abs(state.speed) / Math.max(cfg.maxSpeed, 0.001), 1);
    // halfWidth 是"路面 + 路肩"，路面本身只有它的一部分；
    // 超出柏油半宽就算越野，颜色换成土黄
    const offroad = Math.abs(state.lateralOffset) > trackConfig.trackWidth / 2;
    const intensity = drifting ? 0.5 + 0.5 * speedRatio : offroad ? 0.35 + 0.65 * speedRatio : 0;
    if (intensity > 0) {
      dust.emit(
        view.getWheelWorldPositions(wheelPoints, offroad ? 'all' : 'rear'),
        intensity,
        frameDt,
        ground.height,
        offroad,
      );
    }
  }

  // --- boost 拖尾。**每辆车每帧都要 push**（包括没在 boost 的、包括 low 档关掉
  //     粒子的那些车），不 push 的话它的尾巴不会化掉，会一直挂在原地 ---
  if (settings.boostTrail) {
    view.getTailWorldPosition(_tail);
    // 末尾 0.3s 内淡出，不要"啪"地一下消失
    const intensity = Math.min(state.boostTime / 0.3, 1);
    const color = state.boostLevel > 0
      ? `#${DriftSparks.LEVEL_COLORS[state.boostLevel - 1]!.getHexString()}`
      : THEME.gold;
    trails.push(slot, _tail.x, _tail.y, _tail.z, state.heading, intensity, color, frameDt);
  }
}

function makeLoop(physics: PhysicsSystemType): FixedStepLoop {
  return new FixedStepLoop({
    fixedDt: 1 / 60,
    update: (dt) => {
      previous = current;
      const playerProgress = race.getProgress(PLAYER)!;

      // 1. 先给所有车各采一次地面。射线在这里打：kartStep 是纯函数，不许自己去查地形。
      //    重生点用上一个 checkpoint，而不是最近的样条点（见 RaceProgress.getLastCheckpoint）。
      //    必须**先全部采完**再逐辆步进：比赛状态机要拿到所有车这一帧的进度才能排名次
      physics.sample(
        current.x,
        current.y,
        current.z,
        playerProgress.getLastCheckpoint().t,
        playerGround,
      );
      positions[PLAYER] = playerGround.progress;
      for (let i = 0; i < ais.length; i++) {
        const ai = ais[i]!;
        const g = aiGrounds[i]!;
        physics.sample(
          ai.current.x,
          ai.current.y,
          ai.current.z,
          race.getProgress(ai.id)!.getLastCheckpoint().t,
          g,
        );
        positions[ai.id] = g.progress;
      }

      // 2. 更新比赛状态：倒计时和冲线后的输入锁要在步进之前生效。
      //    名次也在这里算出来，下面抽奖要按它加权
      race.update(dt, positions);

      // 3. 拼这一帧喂给道具系统的车辆列表。放在步进之前：
      //    抽奖要用这一帧的名次，AI 判断"前面有没有车"也要用这一帧的位置
      itemKarts.length = 0;
      const gated = race.gateInput(PLAYER, input.sample());
      itemKarts.push({
        id: PLAYER,
        state: current,
        trackT: playerGround.progress,
        place: race.getStanding(PLAYER)?.place ?? 1,
        useItem: gated.useItem,
      });
      for (let i = 0; i < ais.length; i++) {
        const ai = ais[i]!;
        itemKarts.push({
          id: ai.id,
          state: ai.current,
          trackT: aiGrounds[i]!.progress,
          place: race.getStanding(ai.id)?.place ?? 1,
          // AI 的开火意图是上一步车手算出来的（车手在下面第 5 步才跑）
          useItem: ai.wantsItem && !race.isInputLocked(ai.id),
        });
      }

      // 4. 玩家。config 每步现拼：基准参数 + 道具效果
      copyConfigInto(playerConfig, kartConfig);
      items.effectsOf(PLAYER).applyTo(playerConfig);
      current = stepKart(current, gated, playerGround, playerConfig, dt);
      // 每个子步都取一次事件：一个渲染帧可能跑多步，只在 render 里比 prev/current 会漏
      for (const event of diffKartEvents(previous, current)) onKartEvent(event);

      // 5. AI。橡皮筋看的是它和玩家的 totalProgress 差
      const playerTotal = playerProgress.totalProgress;
      for (let i = 0; i < ais.length; i++) {
        const ai = ais[i]!;
        const delta = race.getProgress(ai.id)!.totalProgress - playerTotal;
        const held = items.held(ai.id);
        const view = aiItemViews[i]!;
        view.hasItem = held !== null;
        view.offensive = held !== null && ITEM_DEFS[held].offensive;
        view.targetAhead = hasTargetAhead(aiGrounds[i]!.progress, ai.id);
        ai.step(
          kartConfig,
          aiGrounds[i]!,
          race.isInputLocked(ai.id),
          delta,
          dt,
          view,
          items.effectsOf(ai.id),
        );
      }

      // 6. 道具。
      //    stepKart 返回的是**新对象**，所以上面第 3 步存进 itemKarts 的 state
      //    此刻指的还是旧状态。这里刷新一遍再交给道具系统 ——
      //    不然 boost 会写进一个马上就被丢掉的对象里，吃了等于没吃
      itemKarts[0]!.state = current;
      for (let i = 0; i < ais.length; i++) itemKarts[i + 1]!.state = ais[i]!.current;
      items.update(itemKarts, dt);

      // 7. 车车碰撞。放在最后统一解一次，
      //    否则先算的车会占便宜（它推开别人时别人这一帧还没动）
      collisionBodies.length = 0;
      collisionBodies.push(current);
      for (const ai of ais) collisionBodies.push(ai.current);
      resolveKartCollisions(collisionBodies, collisionConfig, dt);
      playerContacts = countPlayerContacts();
    },
    render: (alpha, frameDt) => {
      renderer.info.reset(); // 这一帧的 drawcall 从这里开始数（阴影 pass 和后处理都算进来）
      const state = lerpKartState(previous, current, alpha);

      kartView.update(state, kartConfig, frameDt);
      followCamera.update(state, kartConfig, frameDt);
      world.followShadow(state.x, state.y, state.z);
      // 天空球跟着相机走，否则开出去几百米就能看到天空的边
      world.update(followCamera.camera);

      // 撞车的那一下：震一下 + 在两车之间炸一小簇。
      // 只在接触对数**涨起来**的那一帧做，一直挤着的时候不重复触发
      if (playerContacts > prevPlayerContacts) {
        const force = Math.min(Math.abs(state.speed) / Math.max(kartConfig.maxSpeed, 0.001), 1);
        followCamera.shake(0.35 + 0.4 * force);
        impacts.burst(state.x, state.y + 0.6, state.z, '#ffffff', 0.4, 10);
      }
      prevPlayerContacts = playerContacts;

      // 假阴影（low 档没有实时阴影时才可见）。影子留在路面高度上，
      // 车飞起来时它不跟着飞，这样"腾空了多高"一眼能看出来
      blobShadows.begin();
      blobShadows.add(state.x, playerGround.height, state.z, state.y - playerGround.height);
      emitKartFx(0, state, kartConfig, kartView, playerGround, frameDt, true);

      // AI 车走同一套渲染路径（同样的插值、同样的特效规则），只是没有相机
      for (let i = 0; i < ais.length; i++) {
        const ai = ais[i]!;
        const view = aiViews[i]!;
        const aiState = lerpKartState(ai.previous, ai.current, alpha);
        view.update(aiState, ai.config, frameDt);
        const ground = aiGrounds[i]!;
        blobShadows.add(aiState.x, ground.height, aiState.z, aiState.y - ground.height);
        // low 档只给玩家喷火花和扬尘（粒子多了之后每帧的顶点更新在低端机上是实打实的
        // 一笔），但拖尾照推 —— 它是按辆固定占一段顶点的，跳过就等于把那条尾巴冻在原地
        emitKartFx(i + 1, aiState, ai.config, view, ground, frameDt, settings.aiSparks);
      }
      blobShadows.finish();
      // 三个池子每帧各推进一次，放在所有 emit 之后
      sparks.step(frameDt);
      dust?.step(frameDt);
      impacts.step(frameDt);
      trails.flush();

      // 道具的实体
      itemBoxViews.update(items.boxes.boxes, frameDt);
      projectileViews.update(items.projectiles, frameDt);
      trapViews.update(items.traps, frameDt);

      // boost 速度线：末尾 0.35s 内淡出，不要"啪"地一下消失
      const boostIntensity = Math.min(state.boostTime / 0.35, 1) * 0.85;
      hud.update(state.speed, frameDt, boostIntensity, driftLabel(state));

      // 音频。引擎音高、漂移摩擦、撞墙撞车全在 RaceAudio 里按状态推出来，
      // 主循环只负责把这一帧的状态转过去
      raceAudio.update({
        state,
        config: kartConfig,
        halfWidth: playerGround.halfWidth,
        contacts: playerContacts,
        racing: race.phase === 'racing',
        frameDt,
      });

      drainItemEvents();
      itemHud.update(playerItemView(), frameDt);

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
          dots: buildDots(),
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

      // 道具的只读读数
      const heldId = items.held(PLAYER);
      itemDebug.held = heldId ? `${ITEM_DEFS[heldId].name} (${heldId})` : '—';
      const activeEffects = items.effectsOf(PLAYER).list();
      itemDebug.effects =
        activeEffects.length === 0
          ? '—'
          : activeEffects.map((e) => `${e.type} ${e.duration.toFixed(1)}s`).join(' · ');
      itemDebug.entities = `${items.projectiles.length} / ${items.traps.length}`;
      const chances = lotteryChances(race.getStanding(PLAYER)?.place ?? 1, race.racerCount);
      itemDebug.chances = ITEM_IDS.filter((id) => chances[id] > 0)
        .map((id) => `${id.slice(0, 4)} ${(chances[id] * 100).toFixed(0)}%`)
        .join(' · ');

      // 排名表里第一个非玩家就是领头 AI
      const leader = race.standings.find((s) => !s.isPlayer);
      const leaderAI = leader ? ais.find((a) => a.id === leader.id) : undefined;
      aiDebug.leaderSpeedMul = round(leaderAI?.effectiveSpeedMul ?? 1, 3);
      aiDebug.gapToPlayer = round(
        progress.totalProgress - (leader ? (race.getProgress(leader.id)?.totalProgress ?? 0) : 0),
        3,
      );

      // 后处理链自己决定要不要走 composer（low 档是直接画到屏幕，省一次全屏拷贝）
      postFx.render(frameDt);

      // --- 性能读数 + 帧率自适应 ---
      // 统计要在 render 之后读，读的是刚画完这一帧
      perfDebug.drawCalls = renderer.info.render.calls;
      perfDebug.triangles = renderer.info.render.triangles;
      perfDebug.pixelRatio = round(renderer.getPixelRatio(), 2);
      perfDebug.fps = Math.round(frameMonitor.averageFps);
      perfDebug.particles =
        `${sparks.activeCount} / ${dust?.activeCount ?? 0} / ${impacts.activeCount}`;
      if (perfDebug.autoAdapt && frameMonitor.push(frameDt)) autoDowngrade();
      checkBudgetOnce();
    },
  });
}

/**
 * 跑起来之后核一次 low 档预算。
 * 只查一次：这些数字在一局里基本是常数，每帧查纯属浪费。
 */
let budgetChecked = false;
function checkBudgetOnce(): void {
  if (budgetChecked || frameMonitor.averageFps === 0) return;
  budgetChecked = true;
  const problems = reportPerfBudget(renderer, tier);
  for (const problem of problems) console.warn(`[perf] ${problem}`);
}

window.addEventListener('resize', () => {
  // 像素比也要重新算：转屏、拖到外接屏都可能换 dpr
  renderer.setPixelRatio(effectivePixelRatio(settings, window.devicePixelRatio));
  renderer.setSize(window.innerWidth, window.innerHeight);
  postFx.setSize(window.innerWidth, window.innerHeight);
  followCamera.resize(window.innerWidth / window.innerHeight);
  // 粒子的 gl_PointSize 是按 drawingBuffer 高度算的，不重设的话
  // 转屏之后粒子会突然变大或变小
  syncParticleViewport();
});

// ============================================================================
// 启动序列
// ============================================================================
// 顺序是有讲究的：
//   1. 画质档位套上去（上面建对象时用的是构造参数，这里把运行时那些也对齐）；
//   2. 首屏资源（core）—— 现在清单是空的，赛道和车全是程序化生成的；
//   3. rapier 的 wasm。它必须 await 完才能查询地形，所以主循环要等它
//      （不等的话开局那几帧脚下按平地算，车会从出生点 11m 高往 y=0 沉，接上之后再弹回来）。
// 每一步之间让出一帧，进度条才有机会画出来 —— 全挤在一个 tick 里的话
// 玩家看到的就是"0% 然后突然开局"，中间那几秒是纯黑屏。

applyQuality(tier);
progress.complete('scene');
await nextFrame();

const assets = new AssetLoader(renderer, { tier });
await assets.loadPhase('core', (ratio) => progress.set('assets', ratio));
await nextFrame();

// rapier 是动态 import 的：它连着一兆多的 wasm，静态引的话这一兆多会跟主 bundle
// 一起下完才轮到第一行 JS 跑，加载界面根本来不及出现。拆出去之后是
// "先看到进度条，再下物理引擎"
const { PhysicsSystem } = await import('./physics/PhysicsSystem');
const physics = await PhysicsSystem.create(spline, track.collision, trackConfig);
progress.complete('physics');

// 先画一帧静止画面顶着，加载界面淡出的时候后面已经是赛道了
postFx.render();
// 让进度条把最后那段走完再淡出，否则看到的是"停在 56% 然后消失"
await nextFrame();
loading.hide();

loop = makeLoop(physics);
started = true;
// 三条循环音（引擎、漂移摩擦、蓄力）在这里起来，之后靠音量和音高表达状态，
// 不反复启停 —— 移动端每次 play() 都有几十毫秒延迟，启停的漂移声会碎成一片
raceAudio.start();
perfDebug.audioFallback =
  audio.syntheticCount > 0 ? `${audio.syntheticCount} 条用合成音` : '无（全部用真文件）';
if (audio.syntheticCount > 0) {
  console.info(
    `[audio] ${audio.syntheticCount} 条音效没找到文件，用的是程序化占位音。` +
      '把真文件放进 public/audio/（路径见 src/audio/SoundDefs.ts）就会自动换过去。',
  );
}
if (!(inputMode === 'touch' && orientationGate.isPortrait)) loop.start();

// 剩下的资源边玩边补。失败也不影响开局，所以不 await
void assets.loadPhase('deferred');

// ============================================================================
// 卡丁车模型
// ============================================================================
// 也是边玩边下：先拿 Box 拼的占位车开着，模型下完了再无缝换上。
// 文件不存在（现在就是）时 ModelLibrary 返回 null，占位车一直留着 ——
// 所以 public/models/kart.glb 放不放都能跑，放了就自动用上。
//
// 配色不是每辆车复制一套材质：applyTint 走 TintCache 按 (原材质, 颜色) 查表，
// 同色的车共用同一份材质（见 render/kartRig.ts）。
// HDRI 也是可选的：下到了就拿它烘环境贴图并当背景，下不到就继续用渐变天空球。
// 控制台会因此多一条 404 —— 这是"可选资源"的固有代价，换来的是把文件丢进
// public/hdri/ 就自动生效，不用改任何代码
void world.sky.loadHdri(import.meta.env.BASE_URL + SKY_HDRI_URL, world.scene).then((ok) => {
  if (ok) world.setQuality(settings); // 重新烘一次环境贴图，这次用 HDRI
});

const models = new ModelLibrary();
void models.load(KART_MODEL_URL).then((gltf) => {
  if (!gltf) return;
  for (const view of allViews) {
    // 每辆车一份克隆：建 rig 要就地重挂轮子，共用一棵树的话第二辆车就把第一辆拆了
    const clone = models.instantiate(KART_MODEL_URL);
    if (clone) view.setModel(clone);
  }
  console.info(`[models] 卡丁车模型已换上（${allViews.length} 辆）`);
});
