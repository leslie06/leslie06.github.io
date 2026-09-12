import type { Engine } from '../core/Engine';

/**
 * Flight recorder for the one failure nothing else can report: the browser killing the page.
 *
 * When a tab runs out of memory the renderer process is gone before any JS can run, so there is no
 * error, no console line and no context-lost event - the player just sees the page reload. What
 * survives is DOM storage, which lives in the browser process. So every few seconds the current
 * resource counts are written there, and a clean exit (`pagehide`) marks the record as such. On the
 * next boot a record that was never marked clean is a session the browser ended for us, and its
 * last minutes are printed to the console and shown in a banner the player can copy and send back.
 *
 * The numbers are the ones that separate the possible causes: a JS heap that climbs forever is a
 * leak in game code, texture/geometry counts that climb are GPU resources never disposed, and flat
 * numbers up to the moment of death mean the steady-state footprint is simply too large for that
 * machine (integrated GPUs carve their memory out of system RAM, which is where a 16 GB desktop
 * running a browser gets tight).
 */
interface Sample {
  /** seconds since boot */
  t: number;
  /** MB, Chrome only */
  heap: number;
  tex: number; geo: number; prog: number;
  calls: number;
  /** mean frame ms over the last interval */
  ms: number;
  scale: number;
  speed: number;
  dom: number;
}

interface Record_ {
  v: 1;
  started: string;
  ended?: string;
  clean: boolean;
  /** why the record was closed: 'unload' (normal), 'contextlost' */
  reason?: string;
  /** performance navigation type of the session that wrote this record: 'navigate' | 'reload' | ... */
  nav: string;
  gpu: string; tier: string; buffer: string; ua: string;
  samples: Sample[];
}

const KEY = 'drivecity.blackbox';
const LAST_KEY = 'drivecity.blackbox.last';
const INTERVAL = 5;
const KEEP = 48; // 4 minutes at 5 s

interface VehicleLike { car?: { speed: number } }

export class BlackBox {
  name = 'blackbox';
  /** The previous session's record, when it ended without a clean unload. */
  readonly crashed: Record_ | null;
  private rec: Record_;
  private acc = 0;
  private frames = 0;
  private frameMs = 0;
  private lastNow = performance.now();
  private storage: Storage | null;

  constructor(private engine: Engine) {
    this.storage = pickStorage();
    this.crashed = this.readCrashed();
    const nav = (performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined)?.type ?? '?';
    const r = engine.renderer.domElement;
    this.rec = {
      v: 1, started: new Date().toISOString(), clean: false, nav,
      gpu: engine.gpu.renderer || 'unknown', tier: engine.quality.tier, buffer: `${r.width}x${r.height}`, ua: navigator.userAgent.slice(0, 160),
      samples: [],
    };
    this.write();
    const close = (reason: string) => { this.rec.clean = reason === 'unload'; this.rec.reason = reason; this.rec.ended = new Date().toISOString(); this.write(); };
    window.addEventListener('pagehide', () => close('unload'));
    window.addEventListener('beforeunload', () => close('unload'));
    engine.events.on('renderer:contextlost', () => close('contextlost'));
  }

  update(dt: number): void {
    const now = performance.now();
    this.frameMs += now - this.lastNow; this.lastNow = now; this.frames++;
    this.acc += dt;
    if (this.acc < INTERVAL) return;
    this.acc = 0;
    const e = this.engine, m = e.renderer.info.memory;
    const heap = (performance as unknown as { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? 0;
    const veh = e.get<VehicleLike & { name: string }>('vehicle');
    this.rec.samples.push({
      t: Math.round(e.time), heap: Math.round(heap / 1048576), tex: m.textures, geo: m.geometries, prog: e.renderer.info.programs?.length ?? 0,
      calls: e.renderer.info.render.calls, ms: +(this.frameMs / Math.max(1, this.frames)).toFixed(1), scale: +e.renderScale.toFixed(2),
      speed: Math.round((veh?.car?.speed ?? 0) * 3.6), dom: document.getElementsByTagName('*').length,
    });
    this.frames = 0; this.frameMs = 0;
    if (this.rec.samples.length > KEEP) this.rec.samples.splice(0, this.rec.samples.length - KEEP);
    this.write();
  }

  /** One-line summary of the crashed session for the diagnostics panel; '' when there was none. */
  summary(): string {
    const c = this.crashed; if (!c) return '';
    const last = c.samples[c.samples.length - 1];
    if (!last) return `上次会话异常结束（${c.started.slice(11, 19)}，无采样）`;
    const first = c.samples[0];
    return `上次异常结束 @${fmtT(last.t)}  堆 ${first.heap}→${last.heap}MB  纹理 ${first.tex}→${last.tex}  几何 ${first.geo}→${last.geo}  帧 ${last.ms}ms  车速 ${last.speed}`;
  }

  /** The crashed record as text for the player to paste back. */
  report(): string {
    const c = this.crashed; if (!c) return '';
    const head = `b城追车 上次会话在没有正常关闭的情况下结束（浏览器重载/杀掉了页面）\n开始 ${c.started}  导航 ${c.nav}  档位 ${c.tier}  缓冲 ${c.buffer}\nGPU ${c.gpu}\n${c.ua}\n`;
    const cols = ['t', 'heap', 'tex', 'geo', 'prog', 'calls', 'ms', 'scale', 'speed', 'dom'] as const;
    const rows = c.samples.map((s) => cols.map((k) => String(s[k]).padStart(8)).join(''));
    return head + cols.map((k) => k.padStart(8)).join('') + '\n' + rows.join('\n');
  }

  private readCrashed(): Record_ | null {
    const s = this.storage; if (!s) return null;
    try {
      const raw = s.getItem(KEY);
      if (!raw) return null;
      const r = JSON.parse(raw) as Record_;
      if (r.v !== 1) return null;
      if (r.clean) return null;
      s.setItem(LAST_KEY, raw);
      return r;
    } catch { return null; }
  }

  private write(): void {
    try { this.storage?.setItem(KEY, JSON.stringify(this.rec)); } catch { /* quota / private mode: recorder is best-effort */ }
  }
}

function pickStorage(): Storage | null {
  try { localStorage.setItem('drivecity.probe', '1'); localStorage.removeItem('drivecity.probe'); return localStorage; } catch { /* fall through */ }
  try { sessionStorage.setItem('drivecity.probe', '1'); sessionStorage.removeItem('drivecity.probe'); return sessionStorage; } catch { return null; }
}

function fmtT(t: number): string {
  const m = Math.floor(t / 60), s = Math.round(t % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}
