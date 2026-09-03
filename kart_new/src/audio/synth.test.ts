import { describe, expect, it } from 'vitest';
import { encodeWav, renderSamples, SYNTH_SAMPLE_RATE, synthDataUri, toBase64 } from './synth';

const spec = (over: Partial<Parameters<typeof renderSamples>[0]> = {}) => ({
  wave: 'sine' as const,
  freq: 440,
  duration: 0.1,
  ...over,
});

describe('renderSamples', () => {
  it('样本数按时长和采样率算', () => {
    const samples = renderSamples(spec({ duration: 0.2 }), 8000);
    expect(samples.length).toBe(1600);
  });

  it('确定性：同一个 spec 永远得到同一段波形（噪声也一样）', () => {
    const a = renderSamples(spec({ wave: 'noise', noise: 1 }));
    const b = renderSamples(spec({ wave: 'noise', noise: 1 }));
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('换种子就换一段噪声', () => {
    const a = renderSamples(spec({ wave: 'noise', seed: 1 }));
    const b = renderSamples(spec({ wave: 'noise', seed: 2 }));
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });

  it('永远不削顶（超出 [-1,1] 的话打包成 16 位时会破音）', () => {
    for (const wave of ['sine', 'square', 'saw', 'triangle', 'noise'] as const) {
      const samples = renderSamples(spec({ wave, harmonics: 8, noise: 0.5, gain: 1 }));
      for (const v of samples) expect(Math.abs(v)).toBeLessThanOrEqual(1);
    }
  });

  it('有起音：第一个样本接近 0，不是"啪"的一下', () => {
    const samples = renderSamples(spec({ attack: 0.02 }));
    expect(Math.abs(samples[0]!)).toBeLessThan(0.02);
  });

  it('有释音：最后一个样本接近 0', () => {
    const samples = renderSamples(spec({ release: 0.05 }));
    expect(Math.abs(samples[samples.length - 1]!)).toBeLessThan(0.02);
  });

  /**
   * 循环音的接口处不能有跳变，否则每循环一次就"啪"一声。
   * 两条保证：时长被调成整数个周期，而且不做淡入淡出。
   */
  it('seamless 把时长凑成整数个周期，且不做包络', () => {
    const sampleRate = 10000;
    const samples = renderSamples(spec({ freq: 100, duration: 0.105, seamless: true }), sampleRate);
    // 0.105s × 100Hz = 10.5 个周期 -> 凑成 11 个 = 0.11s
    expect(samples.length).toBe(1100);
    // 首尾都在满音量上（没有包络），而且波形接得上
    expect(Math.abs(samples[0]!)).toBeLessThan(0.01); // sin 从 0 开始
    const last = samples[samples.length - 1]!;
    const wrapped = samples[0]!;
    expect(Math.abs(last - wrapped)).toBeLessThan(0.1);
  });

  it('扫频音不做 seamless 的时长微调（首尾频率本来就接不上）', () => {
    const samples = renderSamples(
      spec({ freq: 100, freqEnd: 300, duration: 0.105, seamless: true }),
      10000,
    );
    expect(samples.length).toBe(1050);
  });
});

describe('encodeWav', () => {
  const wav = encodeWav(renderSamples(spec({ duration: 0.05 }), 8000), 8000);

  it('头是合法的 RIFF/WAVE', () => {
    const text = (offset: number, length: number) =>
      String.fromCharCode(...wav.subarray(offset, offset + length));
    expect(text(0, 4)).toBe('RIFF');
    expect(text(8, 4)).toBe('WAVE');
    expect(text(12, 4)).toBe('fmt ');
    expect(text(36, 4)).toBe('data');
  });

  it('参数写对了：PCM、单声道、16 位', () => {
    const view = new DataView(wav.buffer, wav.byteOffset);
    expect(view.getUint16(20, true)).toBe(1); // PCM
    expect(view.getUint16(22, true)).toBe(1); // 单声道
    expect(view.getUint32(24, true)).toBe(8000); // 采样率
    expect(view.getUint16(34, true)).toBe(16); // 位深
  });

  it('长度对得上：44 字节头 + 每个样本 2 字节', () => {
    expect(wav.length).toBe(44 + 400 * 2);
    const view = new DataView(wav.buffer, wav.byteOffset);
    expect(view.getUint32(4, true)).toBe(wav.length - 8);
    expect(view.getUint32(40, true)).toBe(400 * 2);
  });
});

describe('synthDataUri', () => {
  it('给出的是 Howler 能直接吃的 data URI', () => {
    const uri = synthDataUri(spec({ duration: 0.02 }), SYNTH_SAMPLE_RATE);
    expect(uri.startsWith('data:audio/wav;base64,')).toBe(true);
    expect(uri.length).toBeGreaterThan(100);
  });

  it('base64 分块编码，长数据不会爆调用栈', () => {
    // 一秒 11025 采样 = 22KB，早就超过 String.fromCharCode(...) 的安全长度了
    const big = encodeWav(renderSamples(spec({ duration: 1 })));
    expect(() => toBase64(big)).not.toThrow();
    expect(toBase64(big).length).toBeGreaterThan(1000);
  });
});
