/** Tiny DOM helpers. No framework — the HUD is a handful of elements updated by hand. */

type Attrs = Record<string, string | number | boolean | undefined>;

export function el<K extends keyof HTMLElementTagNameMap>(tag: K, cls?: string, attrs?: Attrs, children?: (Node | string)[]): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (attrs) for (const [k, v] of Object.entries(attrs)) if (v !== undefined && v !== false) e.setAttribute(k, String(v === true ? '' : v));
  if (children) for (const c of children) e.append(c);
  return e;
}

export function div(cls?: string, children?: (Node | string)[]): HTMLDivElement { return el('div', cls, undefined, children); }
export function span(cls?: string, text?: string): HTMLSpanElement { const s = el('span', cls); if (text !== undefined) s.textContent = text; return s; }

const SVG_NS = 'http://www.w3.org/2000/svg';
export function svg(inner: string, viewBox = '0 0 24 24', cls?: string): SVGSVGElement {
  const s = document.createElementNS(SVG_NS, 'svg');
  s.setAttribute('viewBox', viewBox);
  if (cls) s.setAttribute('class', cls);
  s.innerHTML = inner;
  return s;
}

/** Set textContent only when it changed (avoids layout work for unchanged HUD numbers). */
export function setText(node: Node & { textContent: string | null }, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Toggle a class only when the state actually flips. */
export function setClass(e: Element, cls: string, on: boolean): void {
  if (e.classList.contains(cls) !== on) e.classList.toggle(cls, on);
}

/** Cache of last-written style vars per element; avoids touching CSSOM when nothing moved. */
const varCache = new WeakMap<HTMLElement, Map<string, string>>();
export function setVar(e: HTMLElement, name: string, value: string): void {
  let m = varCache.get(e); if (!m) { m = new Map(); varCache.set(e, m); }
  if (m.get(name) === value) return;
  m.set(name, value); e.style.setProperty(name, value);
}

/** Opacity / transform writers that skip no-op writes. */
export function setOpacity(e: HTMLElement, v: number): void { setVar(e, '--o', v.toFixed(3)); }

export interface ShotAnim extends Animation { shotTime?: number }

/**
 * One-shot animation through the Web Animations API. Frame-rate independent, compositor driven,
 * and — unlike class toggling — retriggerable without a forced reflow. `shotTime` is the
 * currentTime the screenshot harness freezes this animation at (see freezeAnimations).
 */
export function animate(e: Element, keyframes: Keyframe[], opts: KeyframeAnimationOptions, shotTime?: number): ShotAnim {
  // Offsets are authored as time fractions, so easing must apply per segment, not to the whole
  // iteration (effect-level easing would warp every offset).
  if (opts.easing && keyframes.length > 2) {
    for (const k of keyframes) if (!k.easing) k.easing = opts.easing;
    opts = { ...opts, easing: 'linear' };
  }
  const a = e.animate(keyframes, { fill: 'both', ...opts }) as ShotAnim;
  a.shotTime = shotTime;
  return a;
}

/** Freeze every running animation (WAAPI and CSS) at a deterministic time for screenshot poses. */
export function freezeAnimations(defaultMs = 300): void {
  for (const a of document.getAnimations() as ShotAnim[]) {
    const timing = a.effect?.getComputedTiming();
    const dur = typeof timing?.duration === 'number' ? timing.duration : 1000;
    const iterations = timing?.iterations ?? 1;
    const t = a.shotTime ?? (iterations === Infinity ? defaultMs : Math.min(defaultMs, Math.max(0, dur - 1)));
    a.pause();
    a.currentTime = t;
  }
}

export function unfreezeAnimations(): void {
  for (const a of document.getAnimations()) a.play();
}

/**
 * Format a score. Nothing is grouped below 10 000 — "4 250" with a thin space was reading as two
 * separate numbers; only five digits and up get a hair-space separator.
 */
export function fmtInt(n: number): string {
  const v = Math.round(n);
  const s = Math.abs(v).toString();
  if (s.length < 5) return String(v);
  return (v < 0 ? '-' : '') + s.replace(/\B(?=(\d{3})+(?!\d))/g, '\u2009');
}

export function pad2(n: number): string { return n < 10 ? `0${n}` : String(n); }
