/**
 * UI tokens. Beijing taxi yellow and its dark green, on a warm ink ground. System fonts only (no
 * runtime font requests); CJK falls back to PingFang / YaHei.
 */
export const C = {
  yellow: '#f3b50f',
  yellowDim: 'rgba(243,181,15,0.35)',
  green: '#1f5e3c',
  ink: '#101315',
  inkGlass: 'rgba(12,15,17,0.72)',
  paper: '#f4f1e8',
  muted: 'rgba(244,241,232,0.62)',
  line: 'rgba(244,241,232,0.16)',
  red: '#e2402f',
};
export const F = {
  ui: '"PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", system-ui, -apple-system, "Segoe UI", sans-serif',
  num: '"SF Pro Display", "DIN Alternate", "Bahnschrift", "Segoe UI", system-ui, sans-serif',
  mono: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
};

export function css(text: string): void {
  const s = document.createElement('style');
  s.textContent = text;
  document.head.appendChild(s);
}

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, parent?: HTMLElement): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  parent?.appendChild(e);
  return e;
}
