import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { PlayerApi, VehicleApi } from '../game/Contracts';
import type { NavSystem } from '../nav';
import { TIERS, type AreaCell, type RoadCell } from '../nav/MapData';
import { BLIP_COLOR, INK, drawBlip, drawEdgeArrow, drawPlayer, screenAngle, type MarkKind } from '../nav/Draw';
import { C, F, css, el } from './theme';

css(`
:root{--mm-left:max(24px,3vw);--mm-top:max(20px,3vh);--mm-w:clamp(210px,16vw,320px);--mm-h:calc(var(--mm-w) / 1.58 + 25px)}
.minimap{position:absolute;left:var(--mm-left);top:var(--mm-top);width:var(--mm-w);pointer-events:none}
.minimap .frame{position:relative;width:100%;aspect-ratio:1.58;border-radius:7px;overflow:hidden;background:rgba(15,18,20,.9);
  box-shadow:0 8px 26px rgba(0,0,0,.42),inset 0 0 0 1px rgba(244,241,232,.16)}
.minimap canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.minimap .bar{display:flex;align-items:baseline;gap:8px;margin-top:7px;height:18px;padding-left:2px;text-shadow:0 1px 6px rgba(0,0,0,.7)}
.minimap .bar[hidden]{display:none}
.minimap .bar .d{font:800 16px/1 ${F.num};font-variant-numeric:tabular-nums;letter-spacing:.02em;color:${C.yellow}}
.minimap .bar .l{font:700 11px/1 ${F.ui};letter-spacing:.14em;color:${C.muted};white-space:nowrap;overflow:hidden;text-overflow:ellipsis;text-transform:uppercase}
`);

/** Metres for the HUD: "850 m", "2.4 km". */
export function fmtDist(m: number): string {
  if (!Number.isFinite(m)) return '—';
  return m < 1000 ? t('nav.m', { n: Math.max(0, Math.round(m / 10) * 10) }) : t('nav.km', { n: (m / 1000).toFixed(m < 10000 ? 1 : 0) });
}

// Muted road greys, thinnest tier first; widths in px at the reference zoom.
const ROAD = ['#343c42', '#465057', '#5c656c', '#757d83', '#8f969a'];
const ROAD_PX = [1.4, 2.4, 3.6, 5, 6.6];
const GROUND = '#161b1e', WATER = '#1a3444', GREEN = '#1c2f23';
const REF_SCALE = 0.6;
const EDGE_KINDS = new Set<MarkKind>(['target', 'pickup', 'dropoff', 'mission', 'waypoint']);

/**
 * GTA-V-style radar, top-left: rotates with the camera, zooms out with speed, the player a
 * little below centre so more of the road ahead shows. Canvas 2D at 30 Hz: the roads are prebuilt
 * Path2D cells in world metres stroked under one world->screen transform, so a redraw is a few
 * dozen draw calls.
 */
export class Minimap implements System {
  name = 'minimap';
  readonly root: HTMLDivElement;
  /** Redraw cost (ms of main-thread time): running mean and worst. */
  readonly stats = { mean: 0, max: 0, n: 0 };
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private bar: HTMLDivElement;
  private barD: HTMLSpanElement;
  private barL: HTMLSpanElement;
  private shownBar = '';
  private w = 1; private h = 1; private dpr = 1;
  private span = 300;
  private last = -1e9;
  private readonly shot = new URLSearchParams(location.search).has('shot');
  private readonly me = { x: 0, z: 0, heading: 0 };
  private readonly dir = new THREE.Vector3();
  private readonly roads: RoadCell[] = [];
  private readonly areas: AreaCell[] = [];

  constructor(private engine: Engine, private host: HTMLElement) {
    this.root = el('div', 'minimap');
    host.prepend(this.root);   // before the F1 help panel, so the panel draws over it when open
    const frame = el('div', 'frame', this.root);
    this.canvas = el('canvas', '', frame);
    this.ctx = this.canvas.getContext('2d')!;
    this.bar = el('div', 'bar', this.root);
    this.barD = el('span', 'd', this.bar);
    this.barL = el('span', 'l', this.bar);
    this.bar.hidden = true;
    const fit = () => {
      this.dpr = Math.min(2, window.devicePixelRatio || 1);
      this.w = Math.max(1, frame.clientWidth); this.h = Math.max(1, frame.clientHeight);
      this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
      this.last = -1e9;
    };
    new ResizeObserver(fit).observe(frame);
    fit();
  }

  private get nav(): NavSystem | undefined { return this.engine.get<NavSystem>('nav'); }

  update(dt: number): void {
    const nav = this.nav;
    if (!nav || this.host.hidden || nav.mapOpen) return;
    // Zoom: metres of map height on screen, opening up with speed.
    const pl = this.engine.get<PlayerApi>('player'), car = this.engine.get<VehicleApi>('vehicle')?.car;
    const kmh = pl?.mode === 'onfoot' || !car ? 0 : car.speed * 3.6;
    const want = pl?.mode === 'onfoot' ? 170 : Math.min(720, 250 + kmh * 3.4);
    this.span += (want - this.span) * (1 - Math.exp(-dt * 1.2));
    const now = performance.now();
    if (!this.shot && now - this.last < 1000 / 30 - 3) return;
    this.last = now;
    this.draw(nav, now / 1000);
    this.updateBar(nav);
  }

  private updateBar(nav: NavSystem): void {
    const tg = nav.target;
    const text = tg ? `${fmtDist(nav.routeLeft)}|${tg.label ?? t(tg.kind === 'mission' ? 'nav.mission' : 'nav.waypoint')}` : '';
    if (text === this.shownBar) return;
    this.shownBar = text;
    this.bar.hidden = !tg;
    const [d, l] = text.split('|');
    this.barD.textContent = d ?? ''; this.barL.textContent = l ?? '';
  }

  /** One redraw; public so a benchmark can call it directly. */
  draw(nav: NavSystem, time: number): void {
    const t0 = performance.now();
    const ctx = this.ctx, W = this.w, H = this.h, dpr = this.dpr;
    const me = nav.player(this.me);
    this.engine.camera.getWorldDirection(this.dir);
    const up = Math.atan2(this.dir.x, this.dir.z);
    const s = H / this.span;
    const fx = Math.sin(up), fz = Math.cos(up), rx = -fz, rz = fx;
    const ax = W / 2, ay = H * 0.63;
    // World -> screen: x = ax + (o . r) s, y = ay - (o . f) s, o = world - player.
    const toX = (x: number, z: number) => ax + ((x - me.x) * rx + (z - me.z) * rz) * s;
    const toY = (x: number, z: number) => ay - ((x - me.x) * fx + (z - me.z) * fz) * s;

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = GROUND;
    ctx.fillRect(0, 0, W, H);

    // The screen rectangle's bounding box in the world.
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [sx, sy] of [[0, 0], [W, 0], [0, H], [W, H]]) {
      const dx = (sx - ax) / s, dy = (ay - sy) / s;
      const wx = me.x + rx * dx + fx * dy, wz = me.z + rz * dx + fz * dy;
      x0 = Math.min(x0, wx); x1 = Math.max(x1, wx); z0 = Math.min(z0, wz); z1 = Math.max(z1, wz);
    }
    ctx.setTransform(dpr * s * rx, -dpr * s * fx, dpr * s * rz, -dpr * s * fz,
      dpr * (ax - s * (rx * me.x + rz * me.z)), dpr * (ay + s * (fx * me.x + fz * me.z)));

    for (const a of nav.map.areaCells(x0, z0, x1, z1, false, this.areas)) {
      if (a.green) { ctx.fillStyle = GREEN; ctx.fill(a.green); }
      if (a.water) { ctx.fillStyle = WATER; ctx.fill(a.water); }
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const k = Math.min(1.3, Math.max(0.75, Math.sqrt(s / REF_SCALE)));
    const cells = nav.map.roadCells(x0, z0, x1, z1, false, this.roads);
    for (let tier = 0; tier < TIERS; tier++) {
      ctx.strokeStyle = ROAD[tier]; ctx.lineWidth = ROAD_PX[tier] * k / s;
      for (const c of cells) { const p = c.roads[tier]; if (p) ctx.stroke(p); }
    }

    // Police search circle, flashing red and blue.
    const sa = nav.searchArea;
    if (sa) {
      const red = Math.floor(time * 1.6) % 2 === 0;
      ctx.beginPath(); ctx.arc(sa.x, sa.z, sa.r, 0, Math.PI * 2);
      ctx.fillStyle = red ? 'rgba(226,64,47,0.2)' : 'rgba(47,123,255,0.2)'; ctx.fill();
      ctx.lineWidth = 2 / s; ctx.strokeStyle = red ? 'rgba(255,90,70,0.85)' : 'rgba(80,150,255,0.85)'; ctx.stroke();
    }

    // The GPS route from the player's projection onwards.
    const g = nav.gps;
    if (g && g.pts.length >= 4) {
      ctx.beginPath(); ctx.moveTo(g.x, g.z);
      for (let i = (g.i + 1) * 2; i < g.pts.length; i += 2) ctx.lineTo(g.pts[i], g.pts[i + 1]);
      ctx.strokeStyle = 'rgba(9,11,13,0.6)'; ctx.lineWidth = 7.5 / s; ctx.stroke();
      ctx.strokeStyle = C.yellow; ctx.lineWidth = 4.2 / s; ctx.stroke();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    // Landmarks (small, inside only), then blips, then the target on top.
    for (const lm of nav.landmarks) {
      const sx = toX(lm.x, lm.z), sy = toY(lm.x, lm.z);
      if (sx > 4 && sx < W - 4 && sy > 4 && sy < H - 4) drawBlip(ctx, 'landmark', sx, sy, 3.6, NaN, time);
    }
    for (const b of nav.blips()) this.mark(b.kind, b.x, b.z, b.heading, up, time, b.flash ?? false, ax, ay, toX, toY);
    const tg = nav.target;
    if (tg) this.mark(tg.kind === 'mission' ? 'mission' : 'waypoint', tg.x, tg.z, undefined, up, time, false, ax, ay, toX, toY);

    drawPlayer(ctx, ax, ay, screenAngle(me.heading, up), 17);
    this.north(up, W, H);

    const ms = performance.now() - t0;
    const st = this.stats;
    st.n++; st.mean += (ms - st.mean) / Math.min(st.n, 120); st.max = Math.max(st.max, ms);
  }

  /** A blip inside the radar, or pinned to its edge with an arrow when it is a destination. */
  private mark(kind: MarkKind, x: number, z: number, heading: number | undefined, up: number, time: number, flash: boolean,
    ax: number, ay: number, toX: (x: number, z: number) => number, toY: (x: number, z: number) => number): void {
    const W = this.w, H = this.h, ctx = this.ctx;
    const sx = toX(x, z), sy = toY(x, z);
    const angle = heading === undefined ? NaN : screenAngle(heading, up);
    const r = kind === 'waypoint' ? 6.5 : kind === 'police' || kind === 'car' ? 4.8 : 6;
    const m = kind === 'waypoint' ? 4 : 5;
    const inside = sx > m && sx < W - m && sy > (kind === 'waypoint' ? 18 : m) && sy < H - m;
    if (inside) { drawBlip(ctx, kind, sx, sy, r, angle, time, flash); return; }
    if (!EDGE_KINDS.has(kind)) return;
    // Clamp along the ray from the player to a rectangle inset from the edge.
    const inset = 15, dx = sx - ax, dy = sy - ay;
    const tx = dx > 0 ? (W - inset - ax) / dx : dx < 0 ? (inset - ax) / dx : Infinity;
    const ty = dy > 0 ? (H - inset - ay) / dy : dy < 0 ? (inset - ay) / dy : Infinity;
    const tt = Math.min(tx, ty), px = ax + dx * tt, py = ay + dy * tt;
    const ang = Math.atan2(dx, -dy);
    drawEdgeArrow(ctx, px + Math.sin(ang) * 10, py - Math.cos(ang) * 10, ang, BLIP_COLOR[kind], 5);
    drawBlip(ctx, kind === 'waypoint' ? 'target' : kind, px, py, 5, NaN, time, flash);
  }

  /** "N" on the radar's edge where north is. */
  private north(up: number, W: number, H: number): void {
    const ctx = this.ctx, ang = screenAngle(Math.PI, up), dx = Math.sin(ang), dy = -Math.cos(ang);
    const cx = W / 2, cy = H / 2, inset = 11;
    const tt = Math.min(dx ? Math.abs((W / 2 - inset) / dx) : Infinity, dy ? Math.abs((H / 2 - inset) / dy) : Infinity);
    const x = cx + dx * tt, y = cy + dy * tt;
    ctx.beginPath(); ctx.arc(x, y, 8.5, 0, Math.PI * 2);
    ctx.fillStyle = INK; ctx.fill();
    ctx.lineWidth = 1; ctx.strokeStyle = 'rgba(244,241,232,0.35)'; ctx.stroke();
    ctx.fillStyle = C.paper; ctx.font = `800 10px ${F.num}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(t('nav.north'), x, y + 0.5);
  }
}
