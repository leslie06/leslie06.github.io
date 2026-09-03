/**
 * 所有音效的定义表。纯数据，不 import Howler / three / DOM。
 *
 * ## 加一个音效 = 往这张表里加一条
 *
 * 别处不许写 `if (soundId === ...)`。音量、循环与否、走哪条总线、
 * 文件缺失时用什么音色顶上，全都是这里的字段。
 * AudioManager 只认字段，它不知道有 'boost' 这个 id。
 *
 * ## file 和 synth 的关系
 *
 * `file` 指向 public/audio/ 下的文件（现在还没有）；`synth` 是文件缺失时
 * 现场合成的占位音（见 synth.ts）。两者接口一样，AudioManager 先试文件，
 * 加载失败就换合成音，所以：**放不放文件都能出声**，放了就自动用真的。
 */
import type { SynthSpec } from './synth';

export type SoundBus = 'sfx' | 'music';

export type SoundId =
  // 持续音
  | 'engine'
  | 'driftLoop'
  | 'charge'
  // 漂移 / boost
  | 'boost'
  // 道具
  | 'itemGet'
  | 'itemUse'
  | 'itemHit'
  | 'shieldBlock'
  // 碰撞
  | 'wallHit'
  | 'kartHit'
  // 比赛
  | 'countdown'
  | 'countdownGo'
  | 'lap'
  | 'record'
  | 'finish'
  // UI
  | 'uiClick'
  // 背景音乐
  | 'music';

export interface SoundDef {
  id: SoundId;
  /** public/audio/ 下的相对路径 */
  file: string;
  bus: SoundBus;
  /** 这一条自己的音量 0..1，会再乘上总线音量和总音量 */
  volume: number;
  loop: boolean;
  /**
   * 同时最多播几个。撞击类音效连着触发时不设上限会叠成一片糊声。
   * 循环音无意义（永远是 1）
   */
  maxVoices?: number;
  /** 文件缺失时的占位音色 */
  synth: SynthSpec;
}

/**
 * 三档蓄力音的音高倍率。档位越高越尖，"快满了"这件事光靠听就知道。
 * 数值是纯五度往上叠（1 : 1.5 : 2.25），叠出来的和声不刺耳。
 */
export const CHARGE_RATES = [1, 1.5, 2.25] as const;

export const SOUND_DEFS: Readonly<Record<SoundId, SoundDef>> = Object.freeze({
  // --- 持续音 ---------------------------------------------------------------
  engine: {
    id: 'engine',
    file: 'audio/engine-loop.webm',
    bus: 'sfx',
    volume: 0.34,
    loop: true,
    // 低频锯齿 + 一堆泛音 = 内燃机那种"嗡"。播放时用 rate 拉音高跟着速度走，
    // 所以这里的基频要低（80Hz），拉到 2.4 倍也还在合理的音域里
    synth: { wave: 'saw', freq: 80, duration: 0.5, harmonics: 6, noise: 0.06, seamless: true, gain: 0.5 },
  },
  driftLoop: {
    id: 'driftLoop',
    file: 'audio/drift-loop.webm',
    bus: 'sfx',
    volume: 0.3,
    loop: true,
    // 轮胎摩擦就是被过滤过的白噪，这里用高频三角波混大量噪声近似
    synth: { wave: 'triangle', freq: 620, duration: 0.4, noise: 0.85, seamless: true, gain: 0.42 },
  },
  charge: {
    id: 'charge',
    file: 'audio/charge-loop.webm',
    bus: 'sfx',
    volume: 0.24,
    loop: true,
    // 蓄力的"充能"感：一条向上的滑音，循环起来就是持续爬升。
    // 分档靠 rate（见 CHARGE_RATES），不是靠三个文件
    synth: { wave: 'sine', freq: 300, freqEnd: 460, duration: 0.5, harmonics: 3, gain: 0.5 },
  },

  // --- 漂移 / boost ---------------------------------------------------------
  boost: {
    id: 'boost',
    file: 'audio/boost.webm',
    bus: 'sfx',
    volume: 0.55,
    loop: false,
    maxVoices: 3,
    synth: { wave: 'saw', freq: 180, freqEnd: 900, duration: 0.42, harmonics: 4, noise: 0.2, attack: 0.005, release: 0.25 },
  },

  // --- 道具 -----------------------------------------------------------------
  itemGet: {
    id: 'itemGet',
    file: 'audio/item-get.webm',
    bus: 'sfx',
    volume: 0.5,
    loop: false,
    maxVoices: 2,
    // 向上的短滑音 = "拿到了"
    synth: { wave: 'square', freq: 520, freqEnd: 1040, duration: 0.26, attack: 0.004, release: 0.14 },
  },
  itemUse: {
    id: 'itemUse',
    file: 'audio/item-use.webm',
    bus: 'sfx',
    volume: 0.45,
    loop: false,
    maxVoices: 3,
    synth: { wave: 'square', freq: 880, freqEnd: 440, duration: 0.18, attack: 0.003, release: 0.1 },
  },
  itemHit: {
    id: 'itemHit',
    file: 'audio/item-hit.webm',
    bus: 'sfx',
    volume: 0.62,
    loop: false,
    maxVoices: 4,
    // 下坠 + 噪声 = 挨了一下
    synth: { wave: 'saw', freq: 420, freqEnd: 70, duration: 0.4, harmonics: 3, noise: 0.45, attack: 0.002, release: 0.3 },
  },
  shieldBlock: {
    id: 'shieldBlock',
    file: 'audio/shield-block.webm',
    bus: 'sfx',
    volume: 0.5,
    loop: false,
    maxVoices: 2,
    synth: { wave: 'sine', freq: 1200, freqEnd: 700, duration: 0.3, harmonics: 4, attack: 0.002, release: 0.24 },
  },

  // --- 碰撞 -----------------------------------------------------------------
  wallHit: {
    id: 'wallHit',
    file: 'audio/wall-hit.webm',
    bus: 'sfx',
    volume: 0.45,
    loop: false,
    maxVoices: 2,
    synth: { wave: 'noise', freq: 200, duration: 0.16, attack: 0.001, release: 0.14, gain: 0.7 },
  },
  kartHit: {
    id: 'kartHit',
    file: 'audio/kart-hit.webm',
    bus: 'sfx',
    volume: 0.36,
    loop: false,
    maxVoices: 3,
    synth: { wave: 'triangle', freq: 160, freqEnd: 90, duration: 0.14, noise: 0.35, attack: 0.001, release: 0.12 },
  },

  // --- 比赛 -----------------------------------------------------------------
  countdown: {
    id: 'countdown',
    file: 'audio/countdown.webm',
    bus: 'sfx',
    volume: 0.6,
    loop: false,
    synth: { wave: 'sine', freq: 440, duration: 0.22, harmonics: 2, attack: 0.004, release: 0.16 },
  },
  countdownGo: {
    id: 'countdownGo',
    file: 'audio/countdown-go.webm',
    bus: 'sfx',
    volume: 0.7,
    loop: false,
    // 比读秒高一个八度，"放行"这一下要明显不一样
    synth: { wave: 'sine', freq: 880, duration: 0.5, harmonics: 3, attack: 0.004, release: 0.4 },
  },
  lap: {
    id: 'lap',
    file: 'audio/lap.webm',
    bus: 'sfx',
    volume: 0.5,
    loop: false,
    synth: { wave: 'sine', freq: 660, freqEnd: 990, duration: 0.32, harmonics: 2, attack: 0.005, release: 0.22 },
  },
  record: {
    id: 'record',
    file: 'audio/record.webm',
    bus: 'sfx',
    volume: 0.6,
    loop: false,
    synth: { wave: 'sine', freq: 784, freqEnd: 1568, duration: 0.7, harmonics: 4, attack: 0.006, release: 0.5 },
  },
  finish: {
    id: 'finish',
    file: 'audio/finish.webm',
    bus: 'sfx',
    volume: 0.65,
    loop: false,
    synth: { wave: 'square', freq: 523, freqEnd: 1046, duration: 0.9, harmonics: 3, attack: 0.008, release: 0.6 },
  },

  // --- UI -------------------------------------------------------------------
  uiClick: {
    id: 'uiClick',
    file: 'audio/ui-click.webm',
    bus: 'sfx',
    volume: 0.35,
    loop: false,
    maxVoices: 2,
    synth: { wave: 'square', freq: 900, duration: 0.06, attack: 0.001, release: 0.05 },
  },

  // --- 背景音乐 -------------------------------------------------------------
  music: {
    id: 'music',
    file: 'audio/music.webm',
    bus: 'music',
    volume: 0.5,
    loop: true,
    // 占位音乐只能是个低频的"垫音"—— 合成一段旋律不是这个文件该干的事。
    // 真文件放进 public/audio/music.webm 之后这条自动退场
    synth: { wave: 'triangle', freq: 110, duration: 1, harmonics: 3, seamless: true, gain: 0.28 },
  },
});

export const SOUND_IDS = Object.keys(SOUND_DEFS) as SoundId[];
