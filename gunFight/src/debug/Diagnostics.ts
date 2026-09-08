import type { Engine } from '../core/Engine';

/**
 * On-screen diagnostics, toggled with F9 or `?diag=1`.
 *
 * This exists because performance bugs are machine-specific: the same build ran 58 fps on an M2 Pro
 * laptop and "very laggy" on a desktop with a 3060 Ti, which is the faster GPU on paper. Nothing in
 * a screenshot or a headless benchmark can explain that, so the player needs to be able to read the
 * numbers off their own machine and send them back. The most common culprits it exposes:
 *
 *   - `renderer` naming a software rasteriser (SwiftShader / llvmpipe) or the wrong adapter, which
 *     is common on Windows desktops with a discrete card and an integrated one.
 *   - a drawing buffer far larger than expected, from OS display scaling.
 *   - the adaptive governor sitting at its floor, meaning even the smallest buffer misses 60 fps.
 */
export class Diagnostics {
  name = 'diagnostics';
  private el: HTMLDivElement;
  private frames: number[] = [];
  private last = performance.now();
  private acc = 0;
  private gl = 'unknown';

  constructor(private engine: Engine, container: HTMLElement) {
    this.el = document.createElement('div');
    this.el.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:9999;padding:8px 10px;' +
      'background:rgba(6,8,12,.82);color:#dfe6f2;font:11px/1.5 ui-monospace,Menlo,monospace;' +
      'white-space:pre;pointer-events:none;border-left:2px solid #e08a3c;letter-spacing:.02em';
    this.el.hidden = !new URLSearchParams(location.search).has('diag');
    container.appendChild(this.el);

    try {
      const c = document.createElement('canvas');
      const g = c.getContext('webgl2') as WebGL2RenderingContext | null;
      const d = g?.getExtension('WEBGL_debug_renderer_info');
      if (g && d) this.gl = String(g.getParameter(d.UNMASKED_RENDERER_WEBGL));
    } catch { /* some browsers block this; the rest of the readout still helps */ }

    window.addEventListener('keydown', (e) => { if (e.code === 'F9') this.el.hidden = !this.el.hidden; });
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
    const r = this.engine.renderer, q = this.engine.quality;
    const w = r.domElement.width, h = r.domElement.height;
    const info = r.info.render;

    this.el.textContent = [
      `GPU     ${this.gl.slice(0, 52)}`,
      `档位    ${q.tier}   像素比 ${(q.pixelRatio * this.engine.renderScale).toFixed(2)}  (基准 ${q.pixelRatio} × 自适应 ${this.engine.renderScale.toFixed(2)})`,
      `缓冲    ${w}×${h}  = ${(w * h / 1e6).toFixed(1)} MP    窗口 ${innerWidth}×${innerHeight} @${(devicePixelRatio || 1).toFixed(2)}x`,
      `帧      ${med.toFixed(1)} ms  (${(1000 / Math.max(med, 0.01)).toFixed(0)} fps)   p95 ${p95.toFixed(1)} ms`,
      `绘制    ${info.calls} 次   ${(info.triangles / 1000).toFixed(0)}k 三角面`,
      `F9 开关此面板`,
    ].join('\n');
  }
}
