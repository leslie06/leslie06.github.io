/**
 * Boot screen. The element, its styles and the bar itself live in index.html, because they have to
 * be on screen before this bundle has even been downloaded; index.html also moves the bar (it is
 * handed every progress update through `window.__gfBoot`). This module takes over the text once it
 * is evaluated: which stage boot is in, and how many MB of the level have arrived, so a slow first
 * download reads as a download and not as a hang.
 *
 * main.ts removes the screen with `hideLoading` after the first frames have been drawn, so the
 * shader-compile stall happens behind it rather than on a frozen view of the level.
 */
import { t } from '../core/I18n';
import { onBootProgress } from '../core/BootProgress';

let root: HTMLElement | null = typeof document === 'undefined' ? null : document.getElementById('loading');

if (root) {
  const label = root.querySelector<HTMLElement>('.l');
  const bytes = root.querySelector<HTMLElement>('.by');
  const hint = root.querySelector<HTMLElement>('.ft');
  if (hint) hint.textContent = t('loading.hint');
  let lastLabel = '', lastBytes = '';
  const mb = (n: number) => (n / 1e6).toFixed(1);
  onBootProgress((s) => {
    const l = t(`loading.stage.${s.stage}`);
    if (label && l !== lastLabel) label.textContent = lastLabel = l;
    const b = s.totalBytes > 0 && s.stage !== 'done' ? t('loading.bytes', { loaded: mb(s.loadedBytes), total: mb(s.totalBytes) }) : '';
    if (bytes && b !== lastBytes) bytes.textContent = lastBytes = b;
  });
}

/** Fade out (or remove instantly for screenshot mode) once the game is ready. */
export function hideLoading(instant = false): void {
  if (!root) return;
  const r = root; root = null;
  if (instant) { r.remove(); return; }
  r.classList.add('out');
  setTimeout(() => r.remove(), 500);
}
