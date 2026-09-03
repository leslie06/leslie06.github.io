/**
 * 程序化音效：把一段参数描述渲染成一个 WAV 的 data URI。
 *
 * ## 为什么要有这个东西
 *
 * public/audio/ 下的音频文件是后补的。没有文件时最省事的做法是"静音"，
 * 但那样整套音频系统就没法验 —— 引擎声的音高有没有跟上速度、蓄力音有没有分档、
 * 音量开关有没有生效，全都看不出来。所以这里合成一份**能出声的占位音**，
 * 接口和真文件完全一样（都是喂给 Howl 的一个 src）。
 * 真文件一旦放进 public/audio/，AudioManager 会优先用它，这里的合成音自动退场。
 *
 * ## 纯函数
 *
 * 这个文件不 import Howler、不碰 DOM、不用 Math.random（噪声走带种子的 PRNG），
 * 所以同样的 spec 永远得到同样的字节，可以直接单测。
 */
import { createRng } from '../items/rng';

export type SynthWave = 'sine' | 'triangle' | 'square' | 'saw' | 'noise';

export interface SynthSpec {
  wave: SynthWave;
  /** 起始频率（Hz） */
  freq: number;
  /** 结束频率。给了就是一条扫频（滑音），不给就是定频 */
  freqEnd?: number;
  /** 时长（秒） */
  duration: number;
  /** 起音时间（秒）。0 = 一上来就满音量，打击类音效要的就是这个 */
  attack?: number;
  /** 释音时间（秒），从这个时间点开始淡出到结尾 */
  release?: number;
  /** 叠几个泛音（2 = 基频 + 二倍频…）。让音色厚一点，引擎声全靠它 */
  harmonics?: number;
  /** 混入多少白噪 0..1。摩擦声、撞击声要 */
  noise?: number;
  /**
   * 首尾相接。给循环音用：把时长微调成整数个周期，
   * 不然循环点上会有一声"啪"（波形的跳变）。
   */
  seamless?: boolean;
  /** 整体音量 0..1 */
  gain?: number;
  /** 噪声的种子。同一个 spec 要出同一段声音 */
  seed?: number;
}

/** 采样率。11025 已经够占位音用了，而且 data URI 的体积直接砍到四分之一 */
export const SYNTH_SAMPLE_RATE = 11025;

/**
 * 把 spec 渲染成 [-1, 1] 的单声道样本。纯函数。
 */
export function renderSamples(spec: SynthSpec, sampleRate = SYNTH_SAMPLE_RATE): Float32Array {
  const duration = seamlessDuration(spec);
  const count = Math.max(1, Math.round(duration * sampleRate));
  const out = new Float32Array(count);

  const rng = createRng(spec.seed ?? 0x5eed);
  const harmonics = Math.max(1, Math.floor(spec.harmonics ?? 1));
  const noiseMix = clamp01(spec.noise ?? 0);
  const gain = spec.gain ?? 0.8;
  const attack = Math.max(0, spec.attack ?? 0.005);
  const release = Math.max(0, spec.release ?? duration * 0.35);

  // 相位是**累加**出来的，不是用 t * freq 算的：扫频时后者会在频率变化处
  // 产生相位跳变（听起来是"咔"一声），累加则始终连续。
  // 先取样再推进，所以第 0 个样本落在相位 0 上 —— 这样整数个周期的循环音
  // 末尾的下一个样本正好回到相位 0，接口处严丝合缝
  let phase = 0;

  for (let i = 0; i < count; i++) {
    const t = i / sampleRate;
    const progress = count > 1 ? i / (count - 1) : 0;
    const freq = spec.freqEnd === undefined ? spec.freq : lerp(spec.freq, spec.freqEnd, progress);

    let sample = 0;
    if (spec.wave === 'noise') {
      sample = rng.next() * 2 - 1;
    } else {
      // 泛音的幅度按 1/n 掉，这是锯齿/方波的天然分布，听着最自然
      let sum = 0;
      let norm = 0;
      for (let h = 1; h <= harmonics; h++) {
        const amp = 1 / h;
        sum += waveAt(spec.wave, phase * h) * amp;
        norm += amp;
      }
      sample = sum / norm;
    }

    if (noiseMix > 0) sample = sample * (1 - noiseMix) + (rng.next() * 2 - 1) * noiseMix;

    out[i] = sample * gain * envelope(t, duration, attack, release, spec.seamless === true);
    phase += freq / sampleRate;
  }

  return out;
}

/** 一个周期内的波形，phase 是"第几个周期"（可以是任意实数） */
function waveAt(wave: SynthWave, phase: number): number {
  const x = phase - Math.floor(phase); // 0..1
  switch (wave) {
    case 'sine':
      return Math.sin(x * Math.PI * 2);
    case 'square':
      return x < 0.5 ? 1 : -1;
    case 'saw':
      return x * 2 - 1;
    case 'triangle':
      return x < 0.5 ? x * 4 - 1 : 3 - x * 4;
    default:
      return 0;
  }
}

/**
 * 音量包络。
 * 循环音（seamless）**不做包络**：淡入淡出会让循环点上出现规律的一声"呼"。
 */
function envelope(
  t: number,
  duration: number,
  attack: number,
  release: number,
  seamless: boolean,
): number {
  if (seamless) return 1;
  const rise = attack > 0 ? Math.min(t / attack, 1) : 1;
  const releaseStart = Math.max(0, duration - release);
  const fall = release > 0 && t > releaseStart ? 1 - (t - releaseStart) / release : 1;
  return Math.max(0, rise * fall);
}

/**
 * 循环音的时长微调成整数个周期，接口处才不会"啪"。
 * 扫频音不能这么调（首尾频率本来就不一样，接不上），所以直接原样返回。
 */
function seamlessDuration(spec: SynthSpec): number {
  if (!spec.seamless || spec.freqEnd !== undefined || spec.freq <= 0) return spec.duration;
  const cycles = Math.max(1, Math.round(spec.duration * spec.freq));
  return cycles / spec.freq;
}

/**
 * 打包成 WAV（16 位 PCM 单声道）。
 * 选 WAV 不选别的：不需要编码器，浏览器全都认，而占位音本来就只有几十 KB。
 */
export function encodeWav(samples: Float32Array, sampleRate = SYNTH_SAMPLE_RATE): Uint8Array {
  const bytes = new Uint8Array(44 + samples.length * 2);
  const view = new DataView(bytes.buffer);

  const ascii = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };

  ascii(0, 'RIFF');
  view.setUint32(4, 36 + samples.length * 2, true);
  ascii(8, 'WAVE');
  ascii(12, 'fmt ');
  view.setUint32(16, 16, true); // fmt 块长度
  view.setUint16(20, 1, true); // 1 = PCM
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 每秒字节数
  view.setUint16(32, 2, true); // 每帧字节数
  view.setUint16(34, 16, true); // 位深
  ascii(36, 'data');
  view.setUint32(40, samples.length * 2, true);

  for (let i = 0; i < samples.length; i++) {
    const clamped = Math.max(-1, Math.min(1, samples[i]!));
    // 负半轴的量化范围比正半轴多一格，分开乘才不会削顶
    view.setInt16(44 + i * 2, clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff, true);
  }
  return bytes;
}

/** 给 Howler 用的 data URI。Howler 认 data URI，但必须同时告诉它 format: ['wav'] */
export function synthDataUri(spec: SynthSpec, sampleRate = SYNTH_SAMPLE_RATE): string {
  return `data:audio/wav;base64,${toBase64(encodeWav(renderSamples(spec, sampleRate), sampleRate))}`;
}

/** Uint8Array -> base64。分块喂给 btoa，一次性 apply 几十万字节会爆调用栈 */
export function toBase64(bytes: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
