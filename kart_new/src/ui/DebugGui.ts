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

export interface DebugGuiTargets {
  kart: KartConfig;
  camera: FollowCameraConfig;
  view: KartViewConfig;
  track: TrackDebugState;
  race: RaceDebugState;
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
  ): void {
    const folder = this.gui.addFolder(title);
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
    this.gui.controllersRecursive().forEach((c) => c.updateDisplay());
  }

  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (e.code !== 'KeyH') return;
    this.visible = !this.visible;
    this.gui.show(this.visible);
    document.body.classList.toggle('debug-gui-open', this.visible);
  };

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    document.body.classList.remove('debug-gui-open');
    this.gui.destroy();
  }
}
