import type { NavSystem } from '../nav';
import { CHAIN_STEP, type Place, type PlaceCat, type RoadChain } from '../nav/Places';
import { F } from './theme';

/** Place icons: colour and glyph per category ('+' draws a cross); '' for a text-only label. */
const PLACE_ICON: Record<PlaceCat, [string, string]> = {
  metro: ['#2f6fe4', '铁'], rail: ['#1f4fa8', '站'], park: ['#2f9459', '园'], hospital: ['#e0463c', '+'], school: ['#8a5ad0', '学'],
  mall: ['#e0802a', '购'], hotel: ['#c24f9a', '宿'], sight: ['#1b9a96', '景'], gov: ['#55698f', '政'], office: ['#66737e', '楼'],
  resid: ['#6a7b6c', '区'], area: ['', ''],
};
const PLACE_TEXT: Partial<Record<PlaceCat, string>> = { metro: '#a9c6ff', rail: '#a9c6ff', park: '#98d8ad', hospital: '#ffa39b', sight: '#8fd8d2', mall: '#f5c08e' };

/** How a map sizes and thins its labels. */
export interface LabelStyle {
  /** The zoom (px per m) a place of each rank shows from; area names also stop at `areaMax` (and are left out with `areas` false). */
  rankS: number[]; areaMax: number; areas: boolean;
  /** Road names by tier: the zoom they show from (tier 4, expressways and rings, are shields). */
  roadS: number[];
  /** Ring shields use their short name (东三环) below this zoom. */
  shortBelow: number;
  bridgeS: number;
  /** Text sizes (px): places, rank-0 places, road names by tier 1..3, shields and bridges. */
  font: { place: number; big: number; road: [number, number, number]; shield: number };
  /** Icon radius (px); glyphs are drawn only when it is 6 or more. */
  icon: number;
  /** Road names: px between tries along a chain, and the least px between two of the same name. */
  every: number; gap: number;
  /** At most this many road names and places. */
  maxRoads: number; maxPlaces: number;
  /** Keep this many px clear of the edges. */
  margin: number;
}

/** What a map shows: its canvas, world -> screen (any rotation), the zoom and the world box in view. */
export interface LabelView {
  ctx: CanvasRenderingContext2D;
  W: number; H: number; s: number;
  X: (x: number, z: number) => number; Y: (x: number, z: number) => number;
  x0: number; z0: number; x1: number; z1: number;
  lg: 'zh' | 'en';
}
export interface MapHit { sx: number; sy: number; x: number; z: number; label: string }

/**
 * Map labels the way the map apps layer them - the big places, the interchanges, the stations and
 * districts, ring shields, then road names and smaller places as the zoom allows - each claiming
 * a screen box that later ones may not overlap. Shared by the full map (north up) and the radar
 * (turning with the camera: names are set along the road's direction on screen, always upright).
 */
export class Labeller {
  /** Claimed screen boxes [x0, y0, x1, y1, ...]; the owner seeds it with what must stay clear. */
  readonly boxes: number[] = [];
  /** Places and interchanges drawn, for clicking one. */
  readonly hits: MapHit[] = [];
  private readonly placed: { name: string; sx: number; sy: number }[] = [];
  private readonly widths = new Map<string, number>();
  private landmarkNames: Set<string> | null = null;
  private nRoads = 0;
  private nPlaces = 0;

  constructor(readonly style: LabelStyle) {}

  /** All the layers. Call after seeding `boxes`. */
  draw(nav: NavSystem, v: LabelView): void {
    const st = this.style, s = v.s, lb = nav.labels();
    this.hits.length = 0;
    this.placed.length = 0;
    this.nRoads = this.nPlaces = 0;
    const lm = this.landmarkNames ??= new Set(nav.landmarks.map((l) => l.name.zh));
    const places = (rank: number) => {
      if (s < st.rankS[rank]) return;
      for (const p of lb.places) {
        if (p.rank !== rank || p.x < v.x0 - 50 || p.x > v.x1 + 50 || p.z < v.z0 - 50 || p.z > v.z1 + 50) continue;
        if (p.cat === 'area' && (!st.areas || s > st.areaMax)) continue;
        if (lm.has(p.name.zh) || (p.cat === 'sight' && nav.landmarks.some((l) => Math.abs(l.x - p.x) < 120 && Math.abs(l.z - p.z) < 120))) continue;
        if (this.nPlaces >= st.maxPlaces) return;
        this.place(v, p);
      }
    };
    places(0);
    // Interchanges and stations before the shields: a shield can sit anywhere along its ring.
    if (s >= st.bridgeS) for (const b of lb.bridges) {
      if (b.x < v.x0 || b.x > v.x1 || b.z < v.z0 || b.z > v.z1) continue;
      this.bridge(v, b.name[v.lg], b.x, b.z);
    }
    places(1);
    this.roads(v, lb.roads, 4);
    this.roads(v, lb.roads, 3);
    places(2);
    this.roads(v, lb.roads, 2);
    this.roads(v, lb.roads, 1);
    places(3);
  }

  /** Claim a screen box; false if it overlaps one already claimed (or, with a view, sticks out of it). */
  label(ax: number, ay: number, bx: number, by: number, v?: LabelView): boolean {
    if (v) { const m = this.style.margin * 0.5; if (ax < m || ay < m || bx > v.W - m || by > v.H - m) return false; }
    const bs = this.boxes;
    for (let i = 0; i < bs.length; i += 4) if (ax < bs[i + 2] && bx > bs[i] && ay < bs[i + 3] && by > bs[i + 1]) return false;
    bs.push(ax, ay, bx, by);
    return true;
  }

  halo(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, color: string, align: CanvasTextAlign, font?: string, lw = 3.5): void {
    if (font) ctx.font = font;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = lw; ctx.strokeStyle = 'rgba(9,11,13,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  private inside(v: LabelView, sx: number, sy: number): boolean {
    const m = this.style.margin;
    return sx > m && sx < v.W - m && sy > m && sy < v.H - m;
  }

  /** A place: its icon and name to the right (or the left if that is taken); nothing if neither fits. */
  private place(v: LabelView, p: Place): void {
    const st = this.style, ctx = v.ctx, [col, glyph] = PLACE_ICON[p.cat], name = p.name[v.lg];
    const sx = v.X(p.x, p.z), sy = v.Y(p.x, p.z);
    if (!this.inside(v, sx, sy)) return;
    const fs = p.rank === 0 ? st.font.big : st.font.place, hh = Math.max(fs * 0.62, st.icon + 1);
    if (!col) {
      // District names: text only, quiet.
      const font = `600 ${fs + 1}px ${F.ui}`, w = this.width(ctx, name, font);
      if (!this.label(sx - w / 2 - 4, sy - hh, sx + w / 2 + 4, sy + hh, v)) return;
      this.halo(ctx, name, sx, sy, 'rgba(196,202,208,0.62)', 'center', font);
      this.nPlaces++;
      return;
    }
    const font = `${p.rank === 0 ? 700 : 600} ${fs}px ${F.ui}`, w = this.width(ctx, name, font), r = st.icon, gap = r + 3;
    if (!this.label(sx - r - 1, sy - r - 1, sx + r + 1, sy + r + 1)) return;
    const right = this.label(sx + gap, sy - hh, sx + gap + 3 + w, sy + hh, v), left = !right && this.label(sx - gap - 3 - w, sy - hh, sx - gap, sy + hh, v);
    if (!right && !left) { this.boxes.length -= 4; return; }
    ctx.beginPath(); ctx.arc(sx, sy, r, 0, Math.PI * 2);
    ctx.fillStyle = col; ctx.fill();
    ctx.lineWidth = r > 5 ? 1.5 : 1.2; ctx.strokeStyle = 'rgba(9,11,13,0.9)'; ctx.stroke();
    if (glyph === '+') {
      const a = r * 0.57, b = r * 0.19;
      ctx.fillStyle = '#fff'; ctx.fillRect(sx - b, sy - a, b * 2, a * 2); ctx.fillRect(sx - a, sy - b, a * 2, b * 2);
    } else if (r >= 6) {
      ctx.font = `700 ${Math.round(r * 1.3)}px ${F.ui}`; ctx.fillStyle = '#fff'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(glyph, sx, sy + 0.5);
    }
    this.halo(ctx, name, right ? sx + gap + 1 : sx - gap - 1, sy, PLACE_TEXT[p.cat] ?? 'rgba(232,229,220,0.9)', right ? 'left' : 'right', font, fs < 12 ? 3 : 3.5);
    this.hits.push({ sx, sy, x: p.x, z: p.z, label: name });
    this.nPlaces++;
  }

  /** An interchange: a small bridge glyph and its name. */
  private bridge(v: LabelView, name: string, x: number, z: number): void {
    const st = this.style, ctx = v.ctx, sx = v.X(x, z), sy = v.Y(x, z);
    if (!this.inside(v, sx, sy)) return;
    const fs = st.font.shield, font = `700 ${fs}px ${F.ui}`, w = this.width(ctx, name, font), r = fs * 0.58, hh = Math.max(r + 1, fs * 0.62);
    const right = this.label(sx - r - 1, sy - hh, sx + r + 4 + w, sy + hh, v), left = !right && this.label(sx - r - 4 - w, sy - hh, sx + r + 1, sy + hh, v);
    if (!right && !left) return;
    ctx.beginPath(); ctx.roundRect(sx - r, sy - r, r * 2, r * 2, r * 0.4);
    ctx.fillStyle = '#2b3136'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#d7b779'; ctx.stroke();
    const q = r * 0.65;
    ctx.beginPath(); ctx.moveTo(sx - q, sy + q * 0.45); ctx.lineTo(sx - q, sy); ctx.quadraticCurveTo(sx, sy - q * 1.1, sx + q, sy); ctx.lineTo(sx + q, sy + q * 0.45);
    ctx.moveTo(sx - q * 1.1, sy - q * 0.15); ctx.lineTo(sx + q * 1.1, sy - q * 0.15);
    ctx.strokeStyle = '#f0d9a6'; ctx.lineWidth = 1.1; ctx.stroke();
    this.halo(ctx, name, right ? sx + r + 3 : sx - r - 3, sy, '#f0d9a6', right ? 'left' : 'right', font, fs < 12 ? 3 : 3.5);
    this.hits.push({ sx, sy, x, z, label: name });
  }

  /**
   * Names along the roads of one tier: at every `every` px of a chain where the road runs straight
   * under the whole name, turned to it and kept upright; a name not repeated within `gap` px.
   * Expressways and rings get a shield instead.
   */
  private roads(v: LabelView, roads: readonly RoadChain[], tier: number): void {
    const st = this.style, s = v.s, ctx = v.ctx;
    if (s < st.roadS[tier]) return;
    const shield = tier === 4;
    const fs = shield ? st.font.shield : st.font.road[3 - tier];
    const font = `${shield ? 700 : 600} ${fs}px ${F.ui}`;
    const color = tier === 3 ? 'rgba(240,237,228,0.92)' : tier === 2 ? 'rgba(232,229,220,0.8)' : 'rgba(220,217,208,0.66)';
    const gap = shield ? st.gap * 1.4 : st.gap;
    // Tries every `every` px along a chain, the step rounded to a power of two so the spots do not
    // slide about while the zoom eases (the radar's follows the speed).
    const want = (shield ? st.every * 1.3 : st.every) / (s * CHAIN_STEP);
    const every = Math.max(2, 2 ** Math.round(Math.log2(want)));
    const hb = fs * 0.62 + 2;
    for (const c of roads) {
      if (this.nRoads >= st.maxRoads) return;
      if (c.tier !== tier || c.x1 < v.x0 || c.x0 > v.x1 || c.z1 < v.z0 || c.z0 > v.z1) continue;
      const name = shield && s < st.shortBelow ? c.short[v.lg] : c.name[v.lg];
      const w = this.width(ctx, name, font);
      const half = (w / 2 + 8) / s, k = shield ? 1 : Math.ceil(half / CHAIN_STEP);
      const P = c.pts, m = P.length / 2;
      if (m < 2 * k + 1) continue;
      for (let i = k + (every >> 1) % Math.max(1, m - 2 * k); i < m - k; i += every) {
        const x = P[i * 2], z = P[i * 2 + 1], sx = v.X(x, z), sy = v.Y(x, z);
        if (!this.inside(v, sx, sy)) continue;
        if (this.placed.some((q) => q.name === name && Math.hypot(q.sx - sx, q.sy - sy) < gap)) continue;
        if (shield) {
          const hw = w / 2 + fs * 0.55, hh = fs * 0.75;
          if (!this.label(sx - hw, sy - hh - 1, sx + hw, sy + hh + 1, v)) continue;
          ctx.beginPath(); ctx.roundRect(sx - hw, sy - hh, hw * 2, hh * 2, fs * 0.33);
          ctx.fillStyle = '#c98a2b'; ctx.fill(); ctx.lineWidth = 1.3; ctx.strokeStyle = 'rgba(9,11,13,0.85)'; ctx.stroke();
          ctx.font = font; ctx.fillStyle = '#1b1206'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(name, sx, sy + 0.5);
        } else {
          // Straight enough under the whole name: every sample within 3 px of the chord, on screen.
          const ax = v.X(P[(i - k) * 2], P[(i - k) * 2 + 1]), ay = v.Y(P[(i - k) * 2], P[(i - k) * 2 + 1]);
          const bx = v.X(P[(i + k) * 2], P[(i + k) * 2 + 1]), by = v.Y(P[(i + k) * 2], P[(i + k) * 2 + 1]);
          const cl = Math.hypot(bx - ax, by - ay);
          if (cl < (w + 16) * 0.9) continue;
          const ux = (bx - ax) / cl, uy = (by - ay) / cl;
          let bent = false;
          for (let j = i - k + 1; j < i + k && !bent; j++) {
            const px = v.X(P[j * 2], P[j * 2 + 1]) - ax, py = v.Y(P[j * 2], P[j * 2 + 1]) - ay;
            bent = Math.abs(px * uy - py * ux) > 3;
          }
          if (bent) continue;
          let ang = Math.atan2(uy, ux);
          if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
          const cs = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang)), hx = cs * w / 2 + sn * hb, hy = sn * w / 2 + cs * hb;
          if (!this.label(sx - hx, sy - hy, sx + hx, sy + hy, v)) continue;
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
          this.halo(ctx, name, 0, 0, color, 'center', font, fs < 12 ? 3 : 3.5);
          ctx.restore();
        }
        this.placed.push({ name, sx, sy });
        if (++this.nRoads >= st.maxRoads) return;
      }
    }
  }

  private width(ctx: CanvasRenderingContext2D, text: string, font: string): number {
    const key = font + '|' + text;
    let w = this.widths.get(key);
    if (w === undefined) { ctx.font = font; w = ctx.measureText(text).width; this.widths.set(key, w); }
    return w;
  }
}
