import GUI from 'lil-gui';
import {
  CHARGE_LEVEL_NAMES,
  DEFAULT_KART_CONFIG,
  KART_CONFIG_RANGES,
  KART_CONFIG_TRIPLE_RANGES,
  type KartConfig,
  type KartConfigTripleKey,
} from '../kart/KartConfig';
import {
  DEFAULT_FOLLOW_CAMERA_CONFIG,
  FOLLOW_CAMERA_RANGES,
  type FollowCameraConfig,
} from '../render/FollowCamera';
import {
  DEFAULT_KART_VIEW_CONFIG,
  KART_VIEW_RANGES,
  type KartViewConfig,
} from '../render/KartView';
import { AI_DIFFICULTIES, type AIDifficulty } from '../ai/AIProfiles';
import {
  DEFAULT_KART_COLLISION_CONFIG,
  KART_COLLISION_RANGES,
  type KartCollisionConfig,
} from '../kart/kartCollision';
import { PERF_BUDGET_LOW, type QualityTier } from '../render/QualityTiers';
import { ITEM_BOX_RANGES, type ItemBoxConfig } from '../items/ItemBoxes';
import { ITEM_IDS, type ItemId } from '../items/ItemDefs';
import { PROJECTILE_RANGES, type ProjectileConfig } from '../items/Projectile';

/**
 * 赛道相关的调试开关和读数。
 * progress / lateral / airborne 是每帧被主循环写进来的只读显示值。
 */
export interface TrackDebugState {
  /** 显示样条中心线 */
  showCenterLine: boolean;
  /** 当前进度 t（0..1） */
  progress: number;
  /** 当前横向偏移（米，正 = 车手视角右侧） */
  lateral: number;
  /** 脚下没路了 */
  airborne: boolean;
}

export function createTrackDebugState(): TrackDebugState {
  return { showCenterLine: false, progress: 0, lateral: 0, airborne: false };
}

/**
 * 比赛相关的只读读数。每帧由主循环写进来，GUI 只显示。
 * 字段全是已经格式化好的字符串/数字 —— GUI 不该反过来去读 RaceState。
 */
export interface RaceDebugState {
  phase: string;
  /** 当前第几圈 / 共几圈 */
  lap: string;
  /** 当前所在 sector（= 最近通过的 checkpoint） */
  sector: number;
  /** 本圈 checkpoint 有没有漏 */
  lapValid: boolean;
  /** 本局最佳圈速 */
  bestLap: string;
  /** localStorage 里的历史纪录 */
  record: string;
}

export function createRaceDebugState(): RaceDebugState {
  return { phase: 'countdown', lap: '1/3', sector: 0, lapValid: true, bestLap: '--', record: '--' };
}

/**
 * AI 对手的调试开关和读数。
 * difficulty / rubberband 是可改的，改完通过回调立刻套到所有 AI 上；
 * 其余字段每帧由主循环写进来，只显示。
 */
export interface AIDebugState {
  difficulty: AIDifficulty;
  /** 橡皮筋总开关 */
  rubberband: boolean;
  /** AI 数量（只读，改要重开局） */
  count: number;
  /** 领头 AI 当前的极速倍率（含难度、个体差异和橡皮筋） */
  leaderSpeedMul: number;
  /** 玩家和第一名 AI 的进度差，正 = 玩家领先 */
  gapToPlayer: number;
}

export function createAIDebugState(count: number, difficulty: AIDifficulty = 'normal'): AIDebugState {
  return { difficulty, rubberband: true, count, leaderSpeedMul: 1, gapToPlayer: 0 };
}

/**
 * 道具系统的调试开关和读数。
 * forceItem 选中之后按「发一个」就直接塞进玩家手里，方便单独验某个道具的手感。
 */
export interface ItemDebugState {
  /** 玩家当前手里的道具（只读显示） */
  held: string;
  /** 玩家身上挂着的效果（只读显示） */
  effects: string;
  /** 场上的投射物 / 陷阱数量 */
  entities: string;
  /** 按当前名次，各道具的抽中概率（只读显示） */
  chances: string;
  /** 「发一个」要发哪个 */
  forceItem: ItemId;
}

export function createItemDebugState(): ItemDebugState {
  return { held: '—', effects: '—', entities: '0 / 0', chances: '—', forceItem: 'boost' };
}

/**
 * 性能读数。除了 autoAdapt 之外全是每帧写进来的只读显示值。
 * 调画质的时候盯着 drawCalls / triangles 看，别等真机上卡了才发现超预算。
 */
export interface PerfDebugState {
  /** 当前实际跑的画质档位 */
  tier: QualityTier;
  /** 最近的平均帧率 */
  fps: number;
  /** 上一帧的 drawcall 数（含阴影 pass） */
  drawCalls: number;
  /** 上一帧的三角面数 */
  triangles: number;
  /** 实际像素比 */
  pixelRatio: number;
  /** low 档预算，只读显示 */
  budget: string;
  /** 三个粒子池当前活着的粒子数（火花 / 扬尘 / 爆闪）。调特效手感时盯这个 */
  particles: string;
  /** 有几条音效在用程序化占位音（public/audio/ 下没找到文件） */
  audioFallback: string;
  /** 帧率自适应总开关。调参时关掉，免得它在你面前偷偷降档 */
  autoAdapt: boolean;
}

export function createPerfDebugState(tier: QualityTier): PerfDebugState {
  return {
    tier,
    fps: 0,
    drawCalls: 0,
    triangles: 0,
    pixelRatio: 1,
    budget: `drawcall ≤ ${PERF_BUDGET_LOW.drawCalls} · 三角面 ≤ ${PERF_BUDGET_LOW.triangles / 1000}k`,
    particles: '0 / 0 / 0',
    audioFallback: '—',
    autoAdapt: true,
  };
}

export interface DebugGuiTargets {
  kart: KartConfig;
  camera: FollowCameraConfig;
  view: KartViewConfig;
  track: TrackDebugState;
  race: RaceDebugState;
  /** 车与车的碰撞手感 */
  collision: KartCollisionConfig;
  ai: AIDebugState;
  item: ItemDebugState;
  /** 道具箱重生等参数 */
  itemBox: ItemBoxConfig;
  projectile: ProjectileConfig;
  /** 性能读数 */
  perf: PerfDebugState;
  /** 把 item.forceItem 直接塞给玩家 */
  onGrantItem: () => void;
  /** 难度或橡皮筋开关改了，把新值套到所有 AI 上 */
  onAIChanged: () => void;
  onResetKart: () => void;
  /** 抹掉 localStorage 里的最佳圈速 */
  onClearRecord: () => void;
}

/** 把所有手感参数挂到 lil-gui 上实时调。按 H 收起。 */
export class DebugGui {
  private readonly gui = new GUI({ title: '手感调参' });
  private visible = true;

  constructor(private readonly targets: DebugGuiTargets) {
    const kart = this.gui.addFolder('车辆手感');
    for (const key of ['maxSpeed', 'maxReverseSpeed', 'engineAccel', 'reverseAccel', 'brakeDecel', 'coastFriction'] as const) {
      this.addScalar(kart, targets.kart, key);
    }

    const steering = this.gui.addFolder('转向');
    for (const key of ['turnRate', 'steerAuthoritySpeed', 'highSpeedSteerFactor', 'steerSmoothing', 'corneringDrag'] as const) {
      this.addScalar(steering, targets.kart, key);
    }

    const drift = this.gui.addFolder('漂移');
    for (const key of ['driftMinSpeed', 'driftSteerDeadzone', 'driftYaw', 'driftYawSmoothing', 'driftTurnRate', 'driftCounterSteer', 'driftFriction'] as const) {
      this.addScalar(drift, targets.kart, key);
    }

    const terrain = this.gui.addFolder('地形贴合 / 护栏');
    for (const key of ['groundStickSmoothing', 'groundNormalSmoothing', 'gravity', 'respawnDelay', 'wallDecel'] as const) {
      this.addScalar(terrain, targets.kart, key);
    }

    const turbo = this.gui.addFolder('蓄力 / Mini-Turbo');
    this.addTriple(turbo, targets.kart, 'chargeThresholds');
    this.addTriple(turbo, targets.kart, 'boostSpeedMul');
    this.addTriple(turbo, targets.kart, 'boostDuration');
    this.addScalar(turbo, targets.kart, 'boostAccelMul');
    this.addScalar(turbo, targets.kart, 'boostFalloffDecel');

    this.section('车车碰撞', targets.collision, KART_COLLISION_RANGES);
    this.section('跟随相机', targets.camera, FOLLOW_CAMERA_RANGES);
    this.section('车身视觉', targets.view, KART_VIEW_RANGES);

    // 赛道：一个开关 + 三个只读读数。
    // .listen() 让 lil-gui 每帧回读，.disable() 让它只显示不可改
    const track = this.gui.addFolder('赛道');
    track.add(targets.track, 'showCenterLine').name('显示中心线');
    track.add(targets.track, 'progress').name('进度 t').listen().disable();
    track.add(targets.track, 'lateral').name('横向偏移 (m)').listen().disable();
    track.add(targets.track, 'airborne').name('掉出赛道').listen().disable();

    // 比赛：全是只读读数 + 两个按钮
    const race = this.gui.addFolder('比赛');
    race.add(targets.race, 'phase').name('阶段').listen().disable();
    race.add(targets.race, 'lap').name('圈数').listen().disable();
    race.add(targets.race, 'sector').name('最近 checkpoint').listen().disable();
    race.add(targets.race, 'lapValid').name('本圈有效').listen().disable();
    race.add(targets.race, 'bestLap').name('本局最佳').listen().disable();
    race.add(targets.race, 'record').name('本地纪录').listen().disable();
    race.add({ clear: targets.onClearRecord }, 'clear').name('清除本地纪录');

    // AI：两个可改的（难度、橡皮筋），其余是只读读数
    const ai = this.gui.addFolder('AI 对手');
    ai.add(targets.ai, 'count').name('对手数量').listen().disable();
    ai.add(targets.ai, 'difficulty', [...AI_DIFFICULTIES])
      .name('难度')
      .onChange(targets.onAIChanged);
    ai.add(targets.ai, 'rubberband').name('橡皮筋').onChange(targets.onAIChanged);
    ai.add(targets.ai, 'leaderSpeedMul').name('领头极速倍率').listen().disable();
    ai.add(targets.ai, 'gapToPlayer').name('与玩家进度差').listen().disable();

    // 道具：四个只读读数 + 一个"直接发一个"的调试入口 + 两组手感参数
    const item = this.gui.addFolder('道具');
    item.add(targets.item, 'held').name('手里的道具').listen().disable();
    item.add(targets.item, 'effects').name('身上的效果').listen().disable();
    item.add(targets.item, 'entities').name('投射物/陷阱').listen().disable();
    item.add(targets.item, 'chances').name('当前名次概率').listen().disable();
    item.add(targets.item, 'forceItem', [...ITEM_IDS]).name('调试发货');
    item.add({ grant: targets.onGrantItem }, 'grant').name('发一个给我');
    this.section('道具箱', targets.itemBox, ITEM_BOX_RANGES, item);
    this.section('投射物', targets.projectile, PROJECTILE_RANGES, item);

    // 性能：全是只读读数 + 一个自适应开关。画质档位本身在左下角的设置里改
    const perf = this.gui.addFolder('性能');
    perf.add(targets.perf, 'tier').name('画质档位').listen().disable();
    perf.add(targets.perf, 'fps').name('平均帧率').listen().disable();
    perf.add(targets.perf, 'drawCalls').name('drawcall').listen().disable();
    perf.add(targets.perf, 'triangles').name('三角面').listen().disable();
    perf.add(targets.perf, 'pixelRatio').name('像素比').listen().disable();
    perf.add(targets.perf, 'particles').name('粒子 火花/尘/爆闪').listen().disable();
    perf.add(targets.perf, 'audioFallback').name('占位音效').disable();
    perf.add(targets.perf, 'budget').name('low 档预算').disable();
    perf.add(targets.perf, 'autoAdapt').name('帧率自适应降档');

    this.gui.add({ reset: targets.onResetKart }, 'reset').name('重开比赛 (R)');
    this.gui.add({ resetAll: () => this.resetAll() }, 'resetAll').name('全部参数恢复默认');

    // 让 HUD 知道右上角被 GUI 占了（比赛计时面板要往左让）
    document.body.classList.add('debug-gui-open');
    window.addEventListener('keydown', this.onKeyDown);
  }

  private addScalar(
    folder: GUI,
    target: KartConfig,
    key: keyof typeof KART_CONFIG_RANGES,
  ): void {
    const [min, max, step] = KART_CONFIG_RANGES[key];
    folder.add(target, key, min, max, step);
  }

  /** 三档参数展开成三个滑条，标上"一档/二档/三档"。 */
  private addTriple(folder: GUI, target: KartConfig, key: KartConfigTripleKey): void {
    const { range, label } = KART_CONFIG_TRIPLE_RANGES[key];
    const [min, max, step] = range;
    const sub = folder.addFolder(`${key} · ${label}`);
    for (let i = 0; i < 3; i++) {
      sub.add(target[key], i, min, max, step).name(CHARGE_LEVEL_NAMES[i]!);
    }
  }

  private section<T extends object>(
    title: string,
    target: T,
    ranges: Record<keyof T, [number, number, number]>,
    parent: GUI = this.gui,
  ): void {
    const folder = parent.addFolder(title);
    for (const key of Object.keys(ranges) as Array<keyof T & string>) {
      const [min, max, step] = ranges[key];
      folder.add(target, key, min, max, step);
    }
  }

  private resetAll(): void {
    // 标量直接写回。KART_CONFIG_RANGES 的键正好就是全部标量键
    for (const key of Object.keys(KART_CONFIG_RANGES) as Array<keyof typeof KART_CONFIG_RANGES>) {
      this.targets.kart[key] = DEFAULT_KART_CONFIG[key];
    }
    // 三档数组必须**就地**改，不能换引用：
    // GUI 控件绑的是构造时那个数组对象，换引用它们就和实际参数脱钩了
    for (const key of Object.keys(KART_CONFIG_TRIPLE_RANGES) as KartConfigTripleKey[]) {
      const target = this.targets.kart[key];
      const defaults = DEFAULT_KART_CONFIG[key];
      for (let i = 0; i < 3; i++) target[i] = defaults[i]!;
    }
    Object.assign(this.targets.camera, DEFAULT_FOLLOW_CAMERA_CONFIG);
    Object.assign(this.targets.view, DEFAULT_KART_VIEW_CONFIG);
    Object.assign(this.targets.collision, DEFAULT_KART_COLLISION_CONFIG);
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  /** 收起/展开。触屏上默认收起来：一屏几十个滑条在手机上只会挡路 */
  setVisible(visible: boolean): void {
    this.visible = visible;
    this.gui.show(visible);
    document.body.classList.toggle('debug-gui-open', visible);
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'KeyH') return;
    this.setVisible(!this.visible);
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    document.body.classList.remove('debug-gui-open');
    this.gui.destroy();
  }
}
