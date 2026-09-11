import type { Engine } from '../core/Engine';
import { shotMode } from './ShotMode';
import { BlackBox } from './BlackBox';
import { t } from '../core/I18n';

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
  private blackBox: BlackBox;

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

    // The flight recorder. If the browser killed the previous session, its last minutes are
    // reported here, because that death leaves no other trace.
    this.blackBox = new BlackBox(engine);
    engine.add(this.blackBox);
    if (this.blackBox.crashed) {
      console.warn('[gunfight] previous session ended without a clean unload:\n' + this.blackBox.report());
      if (!shotMode) this.warnCrashed(container);
    }
  }

  /** The previous session died without unloading: show what it looked like just before. */
  private warnCrashed(container: HTMLElement): void {
    const box = document.createElement('div');
    box.id = 'crash-report';
    box.style.cssText = 'position:fixed;left:50%;bottom:14px;transform:translateX(-50%);z-index:10000;' +
      'max-width:min(760px,94vw);padding:10px 14px;background:rgba(10,12,18,.94);color:#f0e4d4;' +
      'font:12px/1.6 ui-monospace,Menlo,monospace;border-left:3px solid #d9534f;border-radius:3px;' +
      'box-shadow:0 8px 28px rgba(0,0,0,.5);pointer-events:auto';
    const pre = document.createElement('pre');
    pre.style.cssText = 'margin:6px 0 0;max-height:34vh;overflow:auto;font:inherit;white-space:pre;opacity:.85';
    pre.textContent = this.blackBox.report();
    const head = document.createElement('div');
    head.innerHTML = `<b style="color:#f6b26b">${t('diag.crashTitle')}</b><br>` +
      `${t('diag.crashBody')} <span style="opacity:.6">${t('diag.crashClose')}</span>`;
    head.style.cursor = 'pointer';
    head.addEventListener('click', () => box.remove());
    const copy = document.createElement('button');
    copy.textContent = t('diag.copy');
    copy.style.cssText = 'margin-top:6px;font:inherit;padding:2px 10px;cursor:pointer';
    copy.addEventListener('click', () => { void navigator.clipboard?.writeText(this.blackBox.report()).then(() => { copy.textContent = t('diag.copied'); }); });
    box.append(head, pre, copy);
    container.appendChild(box);
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
    const title = t(soft ? 'diag.gpuSoft' : 'diag.gpuIntegrated');
    box.innerHTML =
      `<b style="color:#f6b26b">${title}</b><br>` +
      `${t('diag.gpuAdapter')}<span style="color:#9fb4d0">${escapeHtml(this.gl)}</span><br>` +
      t('diag.gpuSteps');
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
    box.innerHTML = t('diag.lost');
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
      this.engine.gpu.kind === 'unknown' ? t('diag.adapterUnknown') : `  <<< ${t(this.engine.gpu.kind === 'software' ? 'diag.software' : 'diag.integrated')}`;

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
    const cap = this.engine.frameCapMs > 0 ? `${Math.round(1000 / this.engine.frameCapMs)} fps` : t('diag.uncapped');
    const st = this.engine.assets.stats;

    this.el.textContent = [
      `GPU     ${this.gl.slice(0, 52)}${gpuNote}`,
      t('diag.tier', { tier: q.tier, pr: r.getPixelRatio().toFixed(2), scale: this.engine.renderScale.toFixed(2), mp: q.maxPixels, cap }),
      t('diag.buffer', { w, h, mp: (w * h / 1e6).toFixed(1), iw: innerWidth, ih: innerHeight, dpr: (devicePixelRatio || 1).toFixed(2) }),
      t('diag.frame', { mean: mean.toFixed(1), fps: (1000 / Math.max(mean, 0.01)).toFixed(0), med: med.toFixed(1), p95: p95.toFixed(1) }),
      t('diag.draw', { calls: info.calls, tris: (info.triangles / 1000).toFixed(0), prog: r.info.programs?.length ?? 0 }),
      t('diag.mem', { geo: mem.geometries, pgeo: this.peakGeo, tex: mem.textures, ptex: this.peakTex }) +
        (heapBytes ? t('diag.heap', { heap: heap.toFixed(0), pheap: this.peakHeap.toFixed(0) }) : ''),
      t('diag.released', { n: st.released, mb: (st.releasedPixels * 4 / 1048576).toFixed(0), s: st.shrunk }),
      this.blackBox.summary(),
      t('diag.toggle'),
    ].filter(Boolean).join('\n');
  }
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string));
}
