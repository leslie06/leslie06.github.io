import type { Engine, System } from '../core/Engine';
import type { PlayerApi, WantedApi } from '../game/Contracts';
import type { UiApi } from '../ui';
import { ALIVE_KEY, steppedDownFrom } from '../core/Quality';

/**
 * The funnel (2026-10-17, to find out why the median session is 29 s of play): the steps a session gets through,
 * each as the seconds since the page began loading, plus a few facts about the device. They live in `window.__stat`
 * (index.html starts it before the program downloads, and catches errors there) and go to the stats server with the
 * site's play heartbeat every 15 s and on leaving (stats/apply.mjs); the dashboard's 「b城追车 · 漏斗」 counts them.
 * Anonymous: no position, no names, nothing typed.
 *
 *   js, b_<stage>, title        the boot (core/Boot.ts marks each loading-bar stage)
 *   start, move                 clicked 进入城市; 30 m from where the session started (driving or walking)
 *   p1m p3m p10m p30m           minutes of play (title, pause and hidden tab not counted)
 *   fare adv ch chpass foot jack fight wanted busted map race acct    the first time each happened
 *   q gpu dlkb kbps fps fpslo lost    tier, GPU, KB downloaded before the title and at what rate, frame rate in the
 *                               first minute of play (median and slowest tenth), WebGL context lost
 *   cpu lite                    第一分钟每帧 JS 时间的中位数（ms，`engine.cpuMs`：接近帧间隔就是 CPU 不够），省电档打开的时间
 *                               （开局就是省电档的记 0；2026-10-18）
 *   died                        上一次会话是玩着玩着没了（页面被系统杀掉，多半是内存不够）：当时玩了多少秒（2026-10-19，iPhone
 *                               「玩了一分钟就退到这个页面了」）。玩的时候每 5 秒在本地记一笔，正常离开或切到后台就擦掉；下次打开还在，
 *                               就是没来得及擦——被杀了
 *   qdown                       这次开局因为上次被杀把画质自动降了一档：降之前的档（'high' / 'medium'；2026-10-25，iPhone 高画质
 *                               「开着车就重新加载了」）
 */
type Stat = Record<string, number | string>;
const S = (): Stat | null => (typeof window !== 'undefined' ? (window as unknown as { __stat?: Stat }).__stat ?? null : null);
const now = () => Math.round(performance.now() / 100) / 10;

export const stat = {
  /** The first time step `k` is reached. */
  mark(k: string): void { const s = S(); if (s && !(k in s)) s[k] = now(); },
  set(k: string, v: number | string): void { const s = S(); if (s) s[k] = v; },
  has(k: string): boolean { return !!S() && k in S()!; },
};

/** At the title: how much came down the wire before it, and how fast (only a first download: a cached one is ~0). */
export function markTitle(): void {
  if (stat.has('title')) return;
  stat.mark('title');
  try {
    const all = [...performance.getEntriesByType('navigation'), ...performance.getEntriesByType('resource')] as PerformanceResourceTiming[];
    const kb = all.reduce((a, r) => a + (r.transferSize || 0), 0) / 1024;
    stat.set('dlkb', Math.round(kb));
    const secs = performance.now() / 1000;
    if (kb > 1500 && secs > 0) stat.set('kbps', Math.round(kb / secs));
  } catch { /* no timing API */ }
}

export function install(engine: Engine): void {
  if (!S()) return;
  stat.set('q', engine.quality.tier);
  try {
    const gl = engine.renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = String(ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER));
    // "ANGLE (Apple, ANGLE Metal Renderer: Apple M2 Pro, Unspecified Version)" -> the part that names the GPU
    const m = name.match(/^ANGLE \(([^,]+), (?:ANGLE [^:]+: )?([^,]+?)(?:,.*)?\)$/);
    const gpu = m ? (m[2].startsWith(m[1]) ? m[2] : `${m[1]} ${m[2]}`) : name;
    stat.set('gpu', gpu.replace(/\s+/g, ' ').slice(0, 60));
  } catch { /* no context */ }
  try { if (localStorage.getItem('drivecity.acct.v1')) stat.mark('acct'); } catch { /* private mode */ }

  const ev = engine.events;
  let from: { x: number; z: number } | null = null;
  ev.on('game:start', () => {
    stat.mark('start');
    const p = engine.get<PlayerApi>('player')?.position;
    if (p) from = { x: p.x, z: p.z };
  });
  ev.on('taxi:board', () => stat.mark('fare'));
  ev.on('campaign:passed', () => stat.mark('chpass'));
  ev.on('campaign:call', (e) => { stat.mark('call'); if (e.go) stat.mark('callgo'); });
  ev.on('player:mode', (e) => { if (e.mode === 'onfoot') stat.mark('foot'); if (e.carjacked) stat.mark('jack'); });
  ev.on('combat:swing', () => stat.mark('fight'));
  ev.on('wanted:level', (e) => { if (e.up && e.level > 0) stat.mark('wanted'); });
  ev.on('wanted:busted', () => stat.mark('busted'));
  ev.on('race:finish', () => stat.mark('race'));
  ev.on('trial:start', () => stat.mark('race'));
  ev.on('renderer:contextlost', () => stat.mark('lost'));

  // Killed last time? (see `died` above) Then keep a mark while playing: every 5 s, wiped on leaving or going to the background.
  const ALIVE = ALIVE_KEY;
  try {
    const prev = localStorage.getItem(ALIVE);
    if (prev) { const p = Number(JSON.parse(prev).p); if (Number.isFinite(p)) stat.set('died', p); localStorage.removeItem(ALIVE); }
    if (steppedDownFrom) stat.set('qdown', steppedDownFrom);
  } catch { /* private mode */ }
  const wipe = () => { try { localStorage.removeItem(ALIVE); } catch { /* private mode */ } };
  addEventListener('pagehide', wipe);
  document.addEventListener('visibilitychange', () => { if (document.hidden) wipe(); });
  let aliveT = 0;

  // Wall-clock time, not the engine's dt: dt is capped per frame, so on a slow device game time runs behind the
  // clock (minutes of play would come late) and 1/dt would read a 10 fps phone as 20.
  let played = 0, poll = 0, last = performance.now();
  const fps: number[] = [], cpu: number[] = [];
  if (engine.lite) stat.set('lite', 0);
  engine.events.on('quality:lite', ({ on }) => { if (on) stat.mark('lite'); });
  const sys: System = {
    name: 'funnel',
    update() {
      const t = performance.now(), dt = Math.min(1, (t - last) / 1000);
      last = t;
      // the map takes the screen over (not 'playing' while it is open)
      if (engine.get<{ name: string; isOpen: boolean }>('navmap')?.isOpen) stat.mark('map');
      const ui = engine.get<UiApi>('ui');
      if (!from || ui?.state !== 'playing' || document.hidden) return;
      played += dt;
      // The first minute of play's frame rate: every frame's, then the median and the slowest tenth.
      if (fps.length < 7200 && dt > 0) { fps.push(1 / dt); cpu.push(engine.cpuMs); }
      if (played >= 60 && !stat.has('p1m')) {
        stat.mark('p1m');
        const a = [...fps].sort((x, y) => x - y);
        if (a.length) { stat.set('fps', Math.round(a[a.length >> 1])); stat.set('fpslo', Math.round(a[Math.floor(a.length * 0.1)])); }
        if (cpu.length) { cpu.sort((x, y) => x - y); stat.set('cpu', Math.round(cpu[cpu.length >> 1] * 10) / 10); }
        fps.length = 0; cpu.length = 0;
      }
      aliveT -= dt;
      if (aliveT <= 0) { aliveT = 5; try { localStorage.setItem(ALIVE, JSON.stringify({ p: Math.round(played), q: engine.quality.tier })); } catch { /* private mode */ } }
      if (played >= 180) stat.mark('p3m');
      if (played >= 600) stat.mark('p10m');
      if (played >= 1800) stat.mark('p30m');
      poll -= dt;
      if (poll > 0) return;
      poll = 1;
      const p = engine.get<PlayerApi>('player')?.position;
      if (p && Math.hypot(p.x - from.x, p.z - from.z) > 30) stat.mark('move');
      if (engine.get<{ name: string; running: string | null }>('campaign')?.running) stat.mark('ch');
      if (engine.get<{ name: string; active: boolean }>('adventure')?.active) stat.mark('adv');
      if ((engine.get<WantedApi>('wanted')?.level ?? 0) > 0) stat.mark('wanted');
    },
  };
  engine.add(sys);
}
