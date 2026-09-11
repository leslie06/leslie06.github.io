/**
 * Boot screen. Shown the instant this module is evaluated (before main.ts's boot() runs), so the
 * player never sees the raw black canvas while physics/textures load. Removed by ui.install once
 * the engine is about to start, but never sooner than MIN_MS so it doesn't strobe on fast machines.
 */
import { cssVars } from './theme';
import { t } from '../core/I18n';

const MIN_MS = 2000;
const shownAt = performance.now();
let root: HTMLDivElement | null = null;

function show(): void {
  if (root || typeof document === 'undefined') return;
  root = document.createElement('div');
  root.id = 'loading';
  root.setAttribute('style', cssVars());
  // Minimal inline style so it renders before the HUD stylesheet exists.
  root.innerHTML = `<style>
    #loading{position:fixed;inset:0;z-index:30;background:#07090c;display:flex;align-items:center;justify-content:center;flex-direction:column;gap:1.4em;font-family:var(--font-display);font-stretch:condensed;color:#f4f5f7;font-size:clamp(11px,1.45vh,32px);transition:opacity .45s;-webkit-font-smoothing:antialiased}
    #loading.out{opacity:0;pointer-events:none}
    #loading .n{font-size:6em;font-weight:800;letter-spacing:.08em;line-height:1}
    #loading .n i{font-style:normal;display:inline-block;width:.12em;height:.6em;background:#ff8a1f;margin-left:.1em}
    #loading .l{font-size:.9em;letter-spacing:.6em;padding-left:.6em;opacity:.6;font-weight:600}
    #loading .bar{width:18em;height:2px;background:rgba(255,255,255,.14);overflow:hidden;position:relative}
    #loading .bar i{position:absolute;top:0;bottom:0;left:0;width:35%;background:#f4f5f7;animation:loadsweep 1.1s cubic-bezier(.4,0,.6,1) infinite}
    #loading .ft{position:absolute;bottom:2.4em;font-size:.75em;letter-spacing:.3em;opacity:.35;font-family:var(--font-mono);font-stretch:normal}
    @keyframes loadsweep{0%{transform:translateX(-100%)}100%{transform:translateX(300%)}}
  </style>
  <div class="n">GUNFIGHT<i></i></div>
  <div class="bar"><i></i></div>
  <div class="l">${t('loading.label')}</div>
  <div class="ft">${t('loading.detail')}</div>`;
  document.body.appendChild(root);
}

/** Fade out (or remove instantly for screenshot mode) once the game is ready. */
export function hideLoading(instant = false): void {
  if (!root) return;
  const r = root; root = null;
  const remove = () => r.remove();
  if (instant) { remove(); return; }
  const wait = Math.max(0, MIN_MS - (performance.now() - shownAt));
  setTimeout(() => { r.classList.add('out'); setTimeout(remove, 500); }, wait);
}

show();
