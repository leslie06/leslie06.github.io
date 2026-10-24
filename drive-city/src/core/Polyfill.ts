/**
 * Canvas `roundRect` for browsers older than Chrome 99 / Safari 16 (2026-10-24, 「游戏有时候报这个错」: `r.roundRect is not
 * a function` on a phone's Baidu browser, drawing a landmark's texture at boot). Five places draw with it (map labels, the
 * radar's icons, the subway sign, a landmark kit texture); all pass one radius. Imported first by `main.ts`.
 */
type Radii = number | DOMPointInit | (number | DOMPointInit)[];

function addRoundRect(proto: { roundRect?: unknown } | undefined): void {
  if (!proto || typeof proto.roundRect === 'function') return;
  proto.roundRect = function (this: CanvasPath, x: number, y: number, w: number, h: number, radii: Radii = 0): void {
    const first = Array.isArray(radii) ? radii[0] ?? 0 : radii;
    let r = typeof first === 'number' ? first : first.x ?? 0;
    r = Math.max(0, Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2));
    const sx = w < 0 ? -1 : 1, sy = h < 0 ? -1 : 1;
    this.moveTo(x + sx * r, y);
    this.lineTo(x + w - sx * r, y);
    this.arcTo(x + w, y, x + w, y + sy * r, r);
    this.lineTo(x + w, y + h - sy * r);
    this.arcTo(x + w, y + h, x + w - sx * r, y + h, r);
    this.lineTo(x + sx * r, y + h);
    this.arcTo(x, y + h, x, y + h - sy * r, r);
    this.lineTo(x, y + sy * r);
    this.arcTo(x, y, x + sx * r, y, r);
    this.closePath();
  };
}

addRoundRect(globalThis.CanvasRenderingContext2D?.prototype);
addRoundRect(globalThis.OffscreenCanvasRenderingContext2D?.prototype);
addRoundRect(globalThis.Path2D?.prototype);
