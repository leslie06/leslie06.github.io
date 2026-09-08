import type { Engine } from '../core/Engine';
import { shotMode } from './ShotMode';

/**
 * On-screen diagnostics, toggled with F9 or `?diag=1`.
 *
 * This exists because performance bugs are machine-specific: the same build ran 58 fps on an M2 Pro
 * laptop and "very laggy" on a desktop with a 3060 Ti, which is the faster GPU on paper. Nothing in
 * a screenshot or a headless benchmark can explain that, so the player needs to be able to read the
 * numbers off their own machine and send them back. The most common culprits it exposes:
 *
 *   - `GPU` naming a software rasteriser (SwiftShader / llvmpipe) or the wrong adapter. This is what
 *     the 3060 Ti machine turned out to be: the string was `ANGLE (AMD, AMD Radeon(TM) Graphics
 *     (0x00001638) Direct3D11)`, i.e. the Ryzen APU's integrated Radeon. The discrete card was never
 *     touched. That is a browser/OS setting, not something the page can fix, so it is called out in
 *     the panel *and* as a banner the player cannot miss.
 *   - a drawing buffer far larger than expected, from OS display scaling.
 *   - the adaptive governor sitting at its floor, meaning even the smallest buffer misses 60 fps.
 *
 * Both a median and a mean frame time are shown, and the gap between them is the diagnosis. Smooth
 * play has them within a millisecond of each other; the machine above read `13.1 ms (76 fps)` median
 * with a 760 ms p95, which is a GPU so over-subscribed that the driver runs the CPU several frames
 * ahead and then blocks - the mean, ~55 ms, is the frame rate the player is actually living in.
 */
export class Diagnostics {
  name = 'diagnostics';
  private el: HTMLDivElement;
  private frames: number[] = [];
  private last = performance.now();
  private acc = 0;
  private gl: string;
  /** Peak resource counts. A leak shows as peak climbing forever; a healthy scene plateaus. */
  private peakGeo = 0; private peakTex = 0; private peakHeap = 0;

  constructor(private engine: Engine, container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;padding:8px 10px;' +
      'background:rgba(6,8,12,.82);color:#dfe6f2;font:11px/1.5 ui-monospace,Menlo,monospace;' +
      'white-space:pre;pointer-events:none;border-left:2px solid #e08a3c;letter-spacing:.02em';
    this.el.hidden = !new URLSearchParams(location.search).has('diag');
    container.appendChild(this.el);

    // The engine already read the adapter off its own context to pick the tier; reuse that rather
    // than opening a second context, which can bind a different GPU than the one we draw with.
    this.gl = engine.gpu.renderer || 'unknown';
    // Never in shot mode: the harness renders with SwiftShader on purpose and the banner would
    // land in every screenshot.
    if (!shotMode && (engine.gpu.kind === 'integrated' || engine.gpu.kind === 'software')) this.warnWrongGpu(container);
    // A lost context is the one failure that leaves nothing on screen to look at, so it gets a
    // banner of its own rather than only a console line.
    engine.events.on('renderer:contextlost', () => { if (!shotMode) this.warnContextLost(container); });

    window.addEventListener('keydown', (e) => { if (e.code === 'F9') this.el.hidden = !this.el.hidden; });
  }

  /**
   * A banner, because this one is not tunable from inside the page: no tier and no render scale
   * makes an integrated Radeon behave like the discrete card sitting in the same box, and a player
   * who does not know which GPU the browser bound will read the result as "the game is broken".
   */
  private warnWrongGpu(container: HTMLElement): void {
    const soft = this.engine.gpu.kind === 'software';
    const box = document.createElement('div');
    box.id = 'gpu-warning';
    box.style.cssText = 'position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:10000;' +
      'max-width:min(680px,92vw);padding:12px 14px;background:rgba(10,12,18,.94);color:#f0e4d4;' +
      'font:12px/1.65 ui-monospace,Menlo,monospace;border-left:3px solid #e08a3c;' +
      'border-radius:3px;box-shadow:0 8px 28px rgba(0,0,0,.5)';
    const title = soft ? '浏览器正在用软件渲染（没有 GPU 加速）' : '浏览器正在用核显，不是你的独立显卡';
    box.innerHTML =
      `<b style="color:#f6b26b">${title}</b><br>` +
      `当前适配器：<span style="color:#9fb4d0">${escapeHtml(this.gl)}</span><br>` +
      '游戏已自动降到 <b>low</b> 画质。要用独显跑，请：<br>' +
      '&nbsp;1. 确认显示器线插在<b>显卡</b>上，不是主板背板；<br>' +
      '&nbsp;2. Windows 设置 → 系统 → 显示 → 显示卡 → 找到浏览器 → 选“高性能”；<br>' +
      '&nbsp;3. 浏览器地址栏进 <b>chrome://gpu</b> 确认 GL_RENDERER 变成 NVIDIA；<br>' +
      '&nbsp;4. 之后在设置里把画质调回 high。<br>' +
      '<span style="opacity:.6">按 F9 看实时帧数 · 点此关闭</span>';
    box.style.pointerEvents = 'auto';
    box.style.cursor = 'pointer';
    box.addEventListener('click', () => box.remove());
    container.appendChild(box);
    // Long enough to read and act on, but it does not sit over the HUD forever: the panel's GPU
    // line keeps flagging the adapter after the banner is gone.
    setTimeout(() => box.remove(), 60000);
    console.warn(`[gunfight] GPU is ${this.engine.gpu.kind}: ${this.gl}`);
  }

  /** Shown when the GPU drops the context: a driver reset, or the GPU running out of memory. */
  private warnContextLost(container: HTMLElement): void {
    const box = document.createElement('div');
    box.id = 'gl-lost';
    box.style.cssText = 'position:fixed;inset:0;z-index:10001;display:flex;align-items:center;' +
      'justify-content:center;background:rgba(6,8,12,.92);color:#f0e4d4;text-align:center;' +
      'font:13px/1.9 ui-monospace,Menlo,monospace;padding:24px';
    box.innerHTML =
      '<div><b style="color:#f6b26b;font-size:16px">显卡驱动重置了（WebGL 上下文丢失）</b><br><br>' +
      '这不是游戏退出，是 GPU 把渲染上下文收回去了。常见原因：<br>' +
      '单帧耗时超过 Windows 的驱动看门狗（TDR，默认 2 秒）、显存耗尽、或者显卡过热降频。<br><br>' +
      '<b>刷新页面（F5）</b>即可重开。如果反复出现，用 <b>?quality=medium</b> 或 <b>?fps=30</b> 打开，<br>' +
      '并把 F9 面板里的"资源"那行发出来。</div>';
    container.appendChild(box);
  }

  update(): void {
    const now = performance.now();
    this.frames.push(now - this.last); this.last = now;
    if (this.frames.length > 90) this.frames.shift();
    this.acc += 1;
    if (this.el.hidden || this.acc % 15 !== 0) return;

    const s = [...this.frames].sort((a, b) => a - b);
    const med = s[s.length >> 1] || 0;
    const p95 = s[Math.floor(s.length * 0.95)] || 0;
    let sum = 0; for (const v of s) sum += v;
    const mean = sum / Math.max(1, s.length);
    const r = this.engine.renderer, q = this.engine.quality;
    const w = r.domElement.width, h = r.domElement.height;
    const info = r.info.render;
    const gpuNote = this.engine.gpu.kind === 'discrete' ? '' :
      this.engine.gpu.kind === 'unknown' ? '  (适配器未知)' : `  <<< ${this.engine.gpu.kind === 'software' ? '软件渲染' : '核显'}`;

    // Resource counts, current and peak. These are the numbers that separate "the GPU is hot" from
    // "the GPU is running out of memory": a scene that has finished loading holds its geometry and
    // texture counts flat, and a peak that keeps climbing while the numbers next to it do not is a
    // leak, which is what precedes a lost context.
    const mem = r.info.memory;
    this.peakGeo = Math.max(this.peakGeo, mem.geometries);
    this.peakTex = Math.max(this.peakTex, mem.textures);
    const heapBytes = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    const heap = heapBytes / 1048576;
    this.peakHeap = Math.max(this.peakHeap, heap);
    const cap = this.engine.frameCapMs > 0 ? `${Math.round(1000 / this.engine.frameCapMs)} fps` : '不限';

    this.el.textContent = [
      `GPU     ${this.gl.slice(0, 52)}${gpuNote}`,
      `档位    ${q.tier}   像素比 ${r.getPixelRatio().toFixed(2)}  (自适应 ${this.engine.renderScale.toFixed(2)}, 上限 ${q.maxPixels} MP)  帧率上限 ${cap}`,
      `缓冲    ${w}×${h}  = ${(w * h / 1e6).toFixed(1)} MP    窗口 ${innerWidth}×${innerHeight} @${(devicePixelRatio || 1).toFixed(2)}x`,
      `帧      均值 ${mean.toFixed(1)} ms (${(1000 / Math.max(mean, 0.01)).toFixed(0)} fps)   中位 ${med.toFixed(1)} ms   p95 ${p95.toFixed(1)} ms`,
      `绘制    ${info.calls} 次   ${(info.triangles / 1000).toFixed(0)}k 三角面   着色器 ${r.info.programs?.length ?? 0}`,
      `资源    几何 ${mem.geometries} (峰 ${this.peakGeo})   纹理 ${mem.textures} (峰 ${this.peakTex})` +
        (heapBytes ? `   JS 堆 ${heap.toFixed(0)} MB (峰 ${this.peakHeap.toFixed(0)})` : ''),
      `F9 开关此面板`,
    ].join('\n');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
