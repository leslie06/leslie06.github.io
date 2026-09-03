/**
 * 全部声音的唯一入口。上层只说"播 boost"，不碰 Howl 实例。
 *
 * ## 两条总线 + 一个总音量
 * sfx / music 各有自己的音量，再乘一个总音量，外加一个静音开关。
 * 三个值都存 localStorage（Prefs），下次进来还是这个设置。
 *
 * ## 文件缺失自动退回合成音
 * 每条音效先按 SoundDef.file 去 public/audio/ 拿；404 或解码失败就换成
 * synth.ts 现场合成的占位音。所以**没有任何音频文件时整套系统照样能验**，
 * 放上真文件之后自动切过去，代码一个字不用改。
 *
 * ## 解锁
 * iOS/Chrome 只允许在**用户手势的事件处理函数里**启动音频。不这么做的话 context
 * 会一直是 'suspended'，之后播什么都是静音，而且不报任何错 —— 排查起来非常费劲。
 * 所以 init() 必须在点击的调用栈里同步调（见 main.ts 的主菜单）。
 * 除此之外还兜两层底：
 *   - 后续手势再 resume 一次（第一次没成功的话还有机会）；
 *   - 切回前台时 resume（iOS 会在切后台时把 context 挂起，回来不 resume 就一直是哑的）。
 */
import { Howl, Howler } from 'howler';
import { SOUND_DEFS, SOUND_IDS, type SoundBus, type SoundDef, type SoundId } from './SoundDefs';
import { synthDataUri } from './synth';

export interface AudioSettings {
  /** 总音量 0..1 */
  master: number;
  /** 音效总线 0..1 */
  sfx: number;
  /** 音乐总线 0..1 */
  music: number;
  muted: boolean;
}

export const DEFAULT_AUDIO_SETTINGS: Readonly<AudioSettings> = Object.freeze({
  master: 0.8,
  sfx: 1,
  music: 0.55,
  muted: false,
});

export interface AudioManagerOptions {
  /** 站点根，默认取 vite 的 BASE_URL */
  basePath?: string;
  settings?: Partial<AudioSettings>;
  /** 设置变化时回调（存 localStorage 用） */
  onSettingsChange?: (settings: Readonly<AudioSettings>) => void;
}

/**
 * 一条循环音的句柄。引擎声、漂移摩擦声、蓄力音都是这种：
 * 一直在播，靠音量和音高表达状态，而不是反复 start/stop
 * （反复启停在移动端会有明显的延迟和爆音）。
 */
export interface LoopHandle {
  /** 目标音量 0..1（相对这条音效自己的 volume）。0 = 听不见但还在播 */
  setVolume(value: number): void;
  /** 播放速率 = 音高倍率 */
  setRate(value: number): void;
  stop(): void;
}

interface Entry {
  def: SoundDef;
  howl: Howl;
  /** 用的是合成的占位音而不是真文件 */
  synthetic: boolean;
  /** 正在响的 voice id，用来限制同时发声数 */
  voices: number[];
}

export class AudioManager {
  private readonly settings: AudioSettings;
  private readonly basePath: string;
  private readonly entries = new Map<SoundId, Entry>();
  private readonly loops = new Map<SoundId, { id: number; volume: number }>();
  private ready = false;
  private disposed = false;

  constructor(private readonly options: AudioManagerOptions = {}) {
    this.settings = { ...DEFAULT_AUDIO_SETTINGS, ...options.settings };
    this.basePath = options.basePath ?? import.meta.env.BASE_URL;
    Howler.volume(this.settings.muted ? 0 : this.settings.master);
  }

  /**
   * 建所有 Howl 实例。
   *
   * **必须在用户手势里调**（点"开始比赛"那一下），不然 iOS 上 context 起不来。
   * 不 await 任何东西：Howler 自己异步解码，没解码完就播只是那一下没声，
   * 不该让点了开始的人等。
   */
  init(): void {
    if (this.ready || this.disposed) return;
    this.ready = true;
    for (const id of SOUND_IDS) this.create(SOUND_DEFS[id]);
    this.resume();
    for (const type of GESTURES) window.addEventListener(type, this.onGesture, GESTURE_OPTIONS);
    document.addEventListener('visibilitychange', this.onVisibility);
  }

  /** context 起来了没有。调试面板显示用 */
  get running(): boolean {
    return Howler.ctx?.state === 'running';
  }

  private resume(): void {
    const ctx = Howler.ctx as AudioContext | undefined;
    if (!ctx) return;
    void ctx.resume();
    // 光 resume 在老 iOS 上不算数，必须真的走一次 start()。
    // 播一个 1 帧的空 buffer 就够，听不见
    try {
      const source = ctx.createBufferSource();
      source.buffer = ctx.createBuffer(1, 1, ctx.sampleRate);
      source.connect(ctx.destination);
      source.start(0);
    } catch {
      // 有的浏览器在 suspended 状态下 start 会抛，忽略：下一次手势还会再来一遍
    }
  }

  private readonly onGesture = () => {
    if (this.disposed || this.running) return;
    this.resume();
  };

  private readonly onVisibility = () => {
    if (document.visibilityState === 'visible') this.resume();
  };

  /** Howler 用的是哪个 AudioContext。和 AudioUnlock 对账用 */
  get context(): AudioContext | null {
    return (Howler.ctx as AudioContext | null) ?? null;
  }

  /** 有几条音效在用合成的占位音。控制台提示 / 调试面板用 */
  get syntheticCount(): number {
    let n = 0;
    for (const entry of this.entries.values()) if (entry.synthetic) n++;
    return n;
  }

  private create(def: SoundDef): void {
    const howl = new Howl({
      src: [this.basePath + def.file],
      loop: def.loop,
      volume: this.gainFor(def),
      html5: false, // 全用 WebAudio：只有它能调 rate（引擎声全靠这个）
      preload: true,
      onloaderror: () => this.fallbackToSynth(def),
    });
    this.entries.set(def.id, { def, howl, synthetic: false, voices: [] });
  }

  /**
   * 文件没下到 -> 换合成音。
   * 静默换掉，只在控制台留一行 —— 缺音频文件不是运行时错误。
   */
  private fallbackToSynth(def: SoundDef): void {
    const existing = this.entries.get(def.id);
    if (!existing || existing.synthetic || this.disposed) return;
    existing.howl.unload();

    const howl = new Howl({
      src: [synthDataUri(def.synth)],
      format: ['wav'], // data URI 没有扩展名，必须明确告诉 Howler
      loop: def.loop,
      volume: this.gainFor(def),
      html5: false,
      preload: true,
    });
    this.entries.set(def.id, { def, howl, synthetic: true, voices: [] });

    // 这条音效如果本来就在循环播（引擎声是开局就起的），要接着播下去
    const loop = this.loops.get(def.id);
    if (loop) {
      const id = howl.play();
      howl.volume(this.gainFor(def) * loop.volume, id);
      this.loops.set(def.id, { id, volume: loop.volume });
    }
  }

  /**
   * 放一个一次性音效。
   * @param rate 音高倍率（1 = 原速）
   * @param volume 相对这条音效自己的音量 0..1
   */
  play(id: SoundId, rate = 1, volume = 1): void {
    const entry = this.entries.get(id);
    if (!entry || this.settings.muted) return;

    // 同时发声数限制：撞击类连着触发时不限会叠成一片糊声
    const max = entry.def.maxVoices ?? 8;
    entry.voices = entry.voices.filter((voice) => entry.howl.playing(voice));
    if (entry.voices.length >= max) {
      entry.howl.stop(entry.voices.shift()!);
    }

    const voice = entry.howl.play();
    entry.howl.rate(rate, voice);
    entry.howl.volume(this.gainFor(entry.def) * volume, voice);
    entry.voices.push(voice);
  }

  /**
   * 起一条循环音。同一个 id 重复调返回同一条，不会叠着播。
   * 初始音量给 0 的话是"在播但听不见"，之后用 setVolume 推上去 ——
   * 这样引擎声的启停不会有爆音。
   */
  loop(id: SoundId, volume = 1): LoopHandle {
    const entry = this.entries.get(id);
    const existing = this.loops.get(id);
    if (entry && !existing) {
      const voice = entry.howl.play();
      entry.howl.volume(this.gainFor(entry.def) * volume, voice);
      this.loops.set(id, { id: voice, volume });
    } else if (existing) {
      existing.volume = volume;
    }
    return {
      setVolume: (value: number) => {
        const e = this.entries.get(id);
        const state = this.loops.get(id);
        if (!e || !state) return;
        state.volume = value;
        e.howl.volume(this.gainFor(e.def) * value, state.id);
      },
      setRate: (value: number) => {
        const e = this.entries.get(id);
        const state = this.loops.get(id);
        if (!e || !state) return;
        // Howler 的 rate 允许 0.5..4，超出会被它自己夹住，这里先夹一次免得刷警告
        e.howl.rate(Math.max(0.5, Math.min(value, 4)), state.id);
      },
      stop: () => {
        const e = this.entries.get(id);
        const state = this.loops.get(id);
        if (!e || !state) return;
        e.howl.stop(state.id);
        this.loops.delete(id);
      },
    };
  }

  /** 停掉所有循环音（回主菜单、页面隐藏时用） */
  stopLoops(): void {
    for (const [id, state] of this.loops) this.entries.get(id)?.howl.stop(state.id);
    this.loops.clear();
  }

  // --- 音量 / 静音 ---------------------------------------------------------

  get current(): Readonly<AudioSettings> {
    return this.settings;
  }

  setMuted(muted: boolean): void {
    this.settings.muted = muted;
    // 静音走 Howler 的全局音量而不是 mute()：mute 会把正在播的循环音也掐掉，
    // 取消静音时引擎声要重新起，中间那一下很突兀
    Howler.volume(muted ? 0 : this.settings.master);
    this.options.onSettingsChange?.(this.settings);
  }

  setVolume(bus: SoundBus | 'master', value: number): void {
    const clamped = Math.max(0, Math.min(value, 1));
    if (bus === 'master') {
      this.settings.master = clamped;
      if (!this.settings.muted) Howler.volume(clamped);
    } else {
      this.settings[bus] = clamped;
      this.refreshBus(bus);
    }
    this.options.onSettingsChange?.(this.settings);
  }

  /** 某条总线的音量变了：正在播的循环音要跟着变，一次性音效下次播时自然就对了 */
  private refreshBus(bus: SoundBus): void {
    for (const [id, state] of this.loops) {
      const entry = this.entries.get(id);
      if (!entry || entry.def.bus !== bus) continue;
      entry.howl.volume(this.gainFor(entry.def) * state.volume, state.id);
    }
  }

  private gainFor(def: SoundDef): number {
    return def.volume * this.settings[def.bus];
  }

  dispose(): void {
    this.disposed = true;
    for (const type of GESTURES) window.removeEventListener(type, this.onGesture, GESTURE_OPTIONS);
    document.removeEventListener('visibilitychange', this.onVisibility);
    this.stopLoops();
    for (const entry of this.entries.values()) entry.howl.unload();
    this.entries.clear();
  }
}

/** 能算"用户手势"的几个事件。touchend 比 touchstart 稳：iOS 上 touchstart 有时不算数 */
const GESTURES = ['touchend', 'pointerdown', 'mousedown', 'keydown'] as const;
const GESTURE_OPTIONS: AddEventListenerOptions = { passive: true };
