import type { Engine, System } from '../core/Engine';
import { lang, t, type TKey } from '../core/I18n';
import type { VehicleApi, WorldApi } from '../game/Contracts';
import type { NavSystem } from '../nav';
import { TIERS, type AreaCell, type RoadCell } from '../nav/MapData';
import { INK, drawBlip, drawPlayer, screenAngle, type MarkKind } from '../nav/Draw';
import type { UiApi } from '.';
import { fmtDist } from './Minimap';
import { CHAIN_STEP, type Place, type PlaceCat, type RoadChain } from '../nav/Places';
import { C, F, css, el } from './theme';
import { L } from './lang';

css(`
.navmap{position:fixed;inset:0;z-index:40;background:#0b0e10;font-family:${F.ui};color:${C.paper};user-select:none;overflow:hidden;cursor:crosshair}
.navmap[hidden]{display:none}
.navmap.drag{cursor:grabbing}
.navmap>canvas{position:absolute;inset:0;width:100%;height:100%;display:block}
.navmap .vig{position:absolute;inset:0;pointer-events:none;background:radial-gradient(ellipse 75% 70% at 50% 50%,rgba(0,0,0,0) 60%,rgba(0,0,0,.5) 100%)}
.navmap .head{position:absolute;left:max(28px,3vw);top:max(24px,3.2vh);pointer-events:none;text-shadow:0 2px 12px rgba(0,0,0,.6)}
.navmap .tag{font:700 12px/1 ${F.num};letter-spacing:.32em;color:${C.yellow}}
.navmap h1{margin:10px 0 0;font:900 34px/1 ${F.ui};letter-spacing:.05em}
.navmap .place{margin-top:12px;height:18px;font:700 15px/18px ${F.ui};letter-spacing:.06em;color:${C.paper};opacity:.8}
.navmap .side{position:absolute;right:max(28px,3vw);top:max(24px,3.2vh);display:grid;gap:12px;width:236px;pointer-events:none}
.navmap .card{padding:14px 16px;border-radius:10px;background:${C.inkGlass};border:1px solid ${C.line};backdrop-filter:blur(8px)}
.navmap .card h2{margin:0 0 10px;font:800 11px/1 ${F.num};letter-spacing:.24em;color:${C.yellow}}
.navmap .dest[hidden]{display:none}
.navmap .dest .d{font:800 34px/1 ${F.num};font-variant-numeric:tabular-nums;letter-spacing:-.01em}
.navmap .dest .s{margin-top:8px;font:600 13px/1.3 ${F.ui};color:${C.muted}}
.navmap .legend .row{display:flex;align-items:center;gap:10px;height:25px;font:500 13px/1 ${F.ui}}
.navmap .legend canvas{width:22px;height:22px;flex:none}
.navmap .keys{position:absolute;left:50%;bottom:max(20px,3vh);transform:translateX(-50%);display:flex;gap:20px;align-items:center;padding:10px 18px;border-radius:9px;
  background:${C.inkGlass};border:1px solid ${C.line};backdrop-filter:blur(8px);font:500 13px/1 ${F.ui};white-space:nowrap;pointer-events:none}
.navmap .keys[hidden]{display:none}
.navmap .keys span{color:${C.muted}}
.navmap kbd{display:inline-block;min-width:22px;padding:0 6px;margin-right:6px;border-radius:4px;border:1px solid ${C.line};background:rgba(244,241,232,.08);font:700 11px/22px ${F.mono};text-align:center;color:${C.paper}}
.navmap .scale{position:absolute;left:max(28px,3vw);bottom:max(24px,3vh);font:700 11px/1 ${F.num};letter-spacing:.12em;color:${C.paper};pointer-events:none;text-shadow:0 1px 6px rgba(0,0,0,.7)}
.navmap .scale i{display:block;height:6px;margin-bottom:6px;border:2px solid ${C.paper};border-top:0;box-shadow:0 1px 4px rgba(0,0,0,.5)}
.navmap .attr{position:absolute;right:max(28px,3vw);bottom:max(24px,3vh);text-align:right;font:500 11px/1.5 ${F.ui};color:${C.muted};pointer-events:none;text-shadow:0 1px 4px rgba(0,0,0,.8)}
@media (max-width: 900px){.navmap .side .legend{display:none}.navmap .keys{gap:12px;font-size:12px}}
`);

// North-up palette: a little brighter than the radar, since nothing else competes with it here.
const OUTSIDE = '#0b0e10', GROUND = '#12171a', GREEN = '#182b20', WATER = '#15303f', PLAZA = '#182024', BLD = '#212a2f';
// Expressways and ring roads amber (the map apps' convention), the rest greys by class.
const ROAD = ['#2c3439', '#3c454b', '#525b62', '#6c747a', '#9c7b47'];
/** Road widths: metres at street zoom, and the thinnest they get in px. */
const ROAD_M = [5, 8, 13, 20, 28], ROAD_MIN = [0.6, 0.9, 1.4, 2, 2.6];
const S_MIN = 0.1, S_MAX = 5, S_OPEN = 0.42;
/** Place icons: colour and glyph per category ('+' draws a cross); '' for a text-only label. */
const PLACE_ICON: Record<PlaceCat, [string, string]> = {
  metro: ['#2f6fe4', '铁'], rail: ['#1f4fa8', '站'], park: ['#2f9459', '园'], hospital: ['#e0463c', '+'], school: ['#8a5ad0', '学'],
  mall: ['#e0802a', '购'], hotel: ['#c24f9a', '宿'], sight: ['#1b9a96', '景'], gov: ['#55698f', '政'], office: ['#66737e', '楼'],
  resid: ['#6a7b6c', '区'], area: ['', ''],
};
const PLACE_TEXT: Partial<Record<PlaceCat, string>> = { metro: '#a9c6ff', rail: '#a9c6ff', park: '#98d8ad', hospital: '#ffa39b', sight: '#8fd8d2', mall: '#f5c08e' };
/** The zoom (px per m) a place of each rank shows from; area names also stop at AREA_MAX. */
const RANK_S = [0.08, 0.2, 0.5, 1.05], AREA_MAX = 2.4;
/** Road names by tier: the zoom they show from. Tier 4 (expressways, rings) are shields. */
const ROAD_S = [Infinity, 0.9, 0.42, 0.17, 0.08];
interface MapHit { sx: number; sy: number; x: number; z: number; label: string }
const smooth = (a: number, b: number, x: number) => { const u = Math.max(0, Math.min(1, (x - a) / (b - a))); return u * u * (3 - 2 * u); };

/**
 * The pause-menu map: north up, the whole city. Pan with drag / WASD / left stick, zoom with the
 * wheel / Q E / triggers around the cursor, click to set a waypoint (right-click or clicking it
 * again clears it). Gameplay is paused behind it the way the pause menu does it.
 */
export class MapScreen implements System {
  name = 'navmap';
  readonly root: HTMLDivElement;
  /** Redraw cost, ms of main-thread time. */
  readonly stats = { mean: 0, max: 0, n: 0 };
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private placeEl: HTMLDivElement;
  private dest: HTMLDivElement;
  private destTag: HTMLHeadingElement;
  private destD: HTMLDivElement;
  private destS: HTMLDivElement;
  private scaleEl: HTMLDivElement;
  private scaleBar: HTMLElement;
  private scaleText: Text;
  private loadEl: HTMLDivElement;
  private keysMouse: HTMLDivElement;
  private keysPad: HTMLDivElement;
  private head: HTMLDivElement;
  private side: HTMLDivElement;
  private attr: HTMLDivElement;
  /** Screen boxes of the DOM panels, kept free of map labels (refreshed twice a second). */
  private reserved: number[] = [];
  private reservedT = 0;
  /** What the last redraw showed, so a still map redraws only for its flashing blips (20 Hz). */
  private drawn = { cx: NaN, cz: NaN, s: NaN, version: -1, target: null as unknown, gps: null as unknown, search: null as unknown, pad: false, t: 0 };
  /** The 3D frame is fully hidden behind the map: skip it while open (restored on close). */
  private savedRender: ((dt: number) => void) | null = null;
  private readonly noRender = () => {};
  private open_ = false;
  private w = 1; private h = 1; private dpr = 1;
  private cx = 0; private cz = 0; private s = S_OPEN; private ts = S_OPEN;
  /** The world point kept under a screen point while a zoom animates. */
  private anchor = { sx: 0, sy: 0, wx: 0, wz: 0 };
  private mouse = { x: -1, y: -1, down: false, dragged: false, sx: 0, sy: 0 };
  private held = new Set<string>();
  private padMode = false;
  private padPrev: boolean[] = [];
  private lastT = 0;
  private placeT = 0;
  private shownDest = '';
  private shownScale = -1;
  private readonly me = { x: 0, z: 0, heading: 0 };
  private readonly roads: RoadCell[] = [];
  private readonly areas: AreaCell[] = [];
  private readonly boxes: number[] = [];
  private readonly widths = new Map<string, number>();
  private readonly tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  /** Places and interchanges drawn in the last frame, for clicking one as the waypoint. */
  private readonly hits: MapHit[] = [];
  private readonly placedRoads: { name: string; sx: number; sy: number }[] = [];
  private landmarkNames: Set<string> | null = null;

  constructor(private engine: Engine, container: HTMLElement) {
    const root = this.root = el('div', 'navmap', container);
    root.hidden = true;
    this.canvas = el('canvas', '', root);
    this.ctx = this.canvas.getContext('2d')!;
    el('div', 'vig', root);
    const head = this.head = el('div', 'head', root);
    el('div', 'tag', head).appendChild(L('map.title'));
    el('h1', '', head).appendChild(L('map.city'));
    this.placeEl = el('div', 'place', head);
    const side = this.side = el('div', 'side', root);
    this.dest = el('div', 'card dest', side);
    this.destTag = el('h2', '', this.dest);
    this.destD = el('div', 'd', this.dest);
    this.destS = el('div', 's', this.dest);
    const legend = el('div', 'card legend', side);
    el('h2', '', legend).appendChild(L('map.legend'));
    const rows: [MarkKind | 'you' | 'route' | 'search', TKey][] = [['you', 'map.you'], ['waypoint', 'map.waypoint'], ['mission', 'map.mission'], ['pickup', 'map.pickup'], ['dropoff', 'map.dropoff'],
      ['police', 'map.police'], ['car', 'map.car'], ['landmark', 'map.landmark'], ['jump', 'map.jump'], ['collect', 'map.collect'], ['parking', 'map.parking'], ['shortcut', 'map.shortcut'], ['route', 'map.route'], ['search', 'map.search']];
    for (const [kind, key] of rows) {
      const r = el('div', 'row', legend);
      this.legendIcon(el('canvas', '', r), kind);
      el('span', '', r).appendChild(L(key));
    }
    this.loadEl = el('div', 'card', side);
    this.loadEl.style.cssText = 'padding:9px 14px;font:600 12px/1.2 inherit;color:' + C.muted;
    this.scaleEl = el('div', 'scale', root);
    this.scaleBar = el('i', '', this.scaleEl);
    this.scaleText = document.createTextNode('');
    this.scaleEl.appendChild(this.scaleText);
    const attr = this.attr = el('div', 'attr', root);
    attr.textContent = '© OpenStreetMap contributors (ODbL)';
    const keyRow = (items: [string[], TKey][]) => {
      const row = el('div', 'keys', root);
      for (const [keys, label] of items) {
        const it = el('div', '', row);
        for (const k of keys) { const kb = el('kbd', '', it); kb.append(k.startsWith('@') ? L(k.slice(1) as TKey) : k); }
        el('span', '', it).appendChild(L(label));
      }
      return row;
    };
    this.keysMouse = keyRow([[['@map.key.click'], 'map.set'], [['@map.key.rclick'], 'map.clear'], [['@map.key.drag', 'WASD'], 'map.pan'], [['@map.key.wheel', 'Q', 'E'], 'map.zoom'], [['Tab', 'Esc'], 'map.close']]);
    this.keysPad = keyRow([[['A'], 'map.set'], [['LS'], 'map.pan'], [['LT', 'RT'], 'map.zoom'], [['B'], 'map.close']]);
    this.keysPad.hidden = true;
    this.bindInput();
    window.addEventListener('resize', () => { if (this.open_) { this.fit(); this.drawn.version = -1; } });
  }

  get isOpen(): boolean { return this.open_; }
  private get nav(): NavSystem | undefined { return this.engine.get<NavSystem>('nav'); }
  private get ui(): UiApi | undefined { return this.engine.get<UiApi>('ui'); }

  /** Open over the game (only while driving or walking), paused like the pause menu. */
  open(): void {
    const nav = this.nav, ui = this.ui;
    if (this.open_ || !nav || !ui || ui.state !== 'playing') return;
    this.open_ = true;
    nav.setMapOpen(true);
    // 'paused' keeps ui's pointer-lock listener from opening the pause menu when the lock is released.
    ui.state = 'paused';
    const v = this.engine.get<VehicleApi>('vehicle');
    if (v) v.inputEnabled = false;
    this.engine.paused = true;
    this.engine.input.exitLock();
    this.engine.events.emit('game:pause', { paused: true });
    this.root.hidden = false;
    this.savedRender = this.engine.renderFrame;
    this.engine.renderFrame = this.noRender;
    this.drawn.version = -1;
    // One ODbL credit on screen: the city's own sits above everything; show ours only without it.
    this.attr.hidden = [...document.body.children].some((e) => !e.contains(this.root) && /OpenStreetMap/.test(e.textContent ?? '') && e.getClientRects().length > 0);
    this.reservedT = 0;
    this.fit();
    nav.player(this.me);
    this.focus(this.me.x, this.me.z, this.ts);
    this.held.clear();
    this.lastT = performance.now();
    this.draw(this.lastT / 1000);
  }

  /** Back to the game. */
  close(): void {
    if (!this.open_) return;
    this.hide();
    this.engine.events.emit('game:pause', { paused: false });
    this.ui?.start();
  }

  /** Centre on a world point at `scale` px per metre (poses, and opening on the player). */
  focus(x: number, z: number, scale = this.s): void {
    this.s = this.ts = Math.max(S_MIN, Math.min(S_MAX, scale));
    this.cx = x; this.cz = z;
    this.anchor.sx = -1;
  }

  /** Frame a world rectangle, leaving room for the side panel. */
  frame(x0: number, z0: number, x1: number, z1: number): void {
    const w = Math.max(100, this.w - 560), h = Math.max(100, this.h - 260);
    this.focus((x0 + x1) / 2 + 150 / Math.min(w / (x1 - x0), h / (z1 - z0)), (z0 + z1) / 2, Math.min(w / Math.max(1, x1 - x0), h / Math.max(1, z1 - z0)));
  }

  private hide(): void {
    this.open_ = false;
    this.root.hidden = true;
    this.root.classList.remove('drag');
    this.nav?.setMapOpen(false);
    if (this.savedRender && this.engine.renderFrame === this.noRender) this.engine.renderFrame = this.savedRender;
    this.savedRender = null;
  }

  private fit(): void {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = Math.max(1, this.root.clientWidth || window.innerWidth); this.h = Math.max(1, this.root.clientHeight || window.innerHeight);
    this.canvas.width = Math.round(this.w * this.dpr); this.canvas.height = Math.round(this.h * this.dpr);
  }

  private toWorld(sx: number, sy: number): [number, number] { return [this.cx + (sx - this.w / 2) / this.s, this.cz + (sy - this.h / 2) / this.s]; }

  private zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wz] = this.toWorld(sx, sy);
    this.anchor = { sx, sy, wx, wz };
    this.ts = Math.max(S_MIN, Math.min(S_MAX, this.ts * factor));
  }

  private bindInput(): void {
    const r = this.root, m = this.mouse;
    r.addEventListener('contextmenu', (e) => e.preventDefault());
    r.addEventListener('pointerdown', (e) => {
      if (!this.open_) return;
      this.padMode = false;
      if (e.button === 2) { this.clearWaypoint(); return; }
      if (e.button !== 0) return;
      m.down = true; m.dragged = false; m.sx = e.clientX; m.sy = e.clientY;
      r.setPointerCapture(e.pointerId);
    });
    r.addEventListener('pointermove', (e) => {
      if (!this.open_) return;
      const dx = e.clientX - m.x, dy = e.clientY - m.y;
      m.x = e.clientX; m.y = e.clientY;
      if (m.down && (m.dragged || Math.hypot(e.clientX - m.sx, e.clientY - m.sy) > 4)) {
        if (!m.dragged) { m.dragged = true; r.classList.add('drag'); }
        this.cx -= dx / this.s; this.cz -= dy / this.s; this.anchor.sx = -1;
      }
      this.padMode = false;
    });
    r.addEventListener('pointerup', (e) => {
      if (!this.open_ || e.button !== 0 || !m.down) return;
      m.down = false; r.classList.remove('drag');
      if (!m.dragged) this.pick(e.clientX, e.clientY);
    });
    r.addEventListener('wheel', (e) => {
      if (!this.open_) return;
      e.preventDefault();
      this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * (e.deltaMode === 1 ? 0.05 : 0.0018)));
    }, { passive: false });
    window.addEventListener('keydown', (e) => { if (this.open_ && !e.repeat) { this.held.add(e.code); this.padMode = false; } });
    window.addEventListener('keyup', (e) => this.held.delete(e.code));
    window.addEventListener('blur', () => this.held.clear());
  }

  /** Click: a waypoint there, or clear it when clicking the waypoint itself. */
  private pick(sx: number, sy: number): void {
    const nav = this.nav;
    if (!nav) return;
    const tg = nav.target;
    // The pin's head sits ~15 px above its tip (the waypoint itself).
    if (tg?.kind === 'waypoint' && Math.hypot(this.w / 2 + (tg.x - this.cx) * this.s - sx, this.h / 2 + (tg.z - this.cz) * this.s - 15 - sy) < 16) { nav.clearTarget('waypoint'); return; }
    // A place or interchange under the cursor: the waypoint goes there, with its name.
    let hit: MapHit | null = null, hd = 13;
    for (const h of this.hits) { const d = Math.hypot(h.sx - sx, h.sy - sy); if (d < hd) { hd = d; hit = h; } }
    if (hit) { nav.setTarget({ x: hit.x, z: hit.z, kind: 'waypoint', label: hit.label }); return; }
    const [x, z] = this.toWorld(sx, sy);
    nav.setTarget({ x, z, kind: 'waypoint' });
  }

  private clearWaypoint(): void { this.nav?.clearTarget('waypoint'); }

  update(): void {
    const inp = this.engine.input.state;
    if (!this.open_) {
      if (inp.mapPressed && this.ui?.state === 'playing' && this.nav) { inp.mapPressed = false; this.open(); }
      return;
    }
    // A new game or a shot pose took over: let go without touching the game state.
    if (this.ui?.state !== 'paused') { this.hide(); return; }
    if (inp.pausePressed || inp.mapPressed) { inp.pausePressed = false; inp.mapPressed = false; this.close(); return; }
    const now = performance.now(), dt = Math.min(0.1, (now - this.lastT) / 1000);
    this.lastT = now;
    this.controls(dt);
    // Ease the zoom, keeping the anchor under its screen point.
    if (Math.abs(this.ts - this.s) > 1e-4) {
      this.s *= Math.pow(this.ts / this.s, 1 - Math.exp(-dt * 14));
      if (Math.abs(this.ts / this.s - 1) < 0.002) this.s = this.ts;
      if (this.anchor.sx >= 0) { this.cx = this.anchor.wx - (this.anchor.sx - this.w / 2) / this.s; this.cz = this.anchor.wz - (this.anchor.sy - this.h / 2) / this.s; }
    }
    const b = this.nav!.bounds;
    this.cx = Math.max(b.x0 - 500, Math.min(b.x1 + 500, this.cx)); this.cz = Math.max(b.z0 - 500, Math.min(b.z1 + 500, this.cz));
    this.panels(now);
    const d = this.drawn, nav = this.nav!;
    if (d.cx !== this.cx || d.cz !== this.cz || d.s !== this.s || d.version !== nav.map.version || d.target !== nav.target || d.gps !== nav.gps
      || d.search !== nav.searchArea || d.pad !== this.padMode || now - d.t > 50) {
      d.cx = this.cx; d.cz = this.cz; d.s = this.s; d.version = nav.map.version; d.target = nav.target; d.gps = nav.gps; d.search = nav.searchArea; d.pad = this.padMode; d.t = now;
      this.draw(now / 1000);
    }
  }

  /** WASD / arrows / Q E and the gamepad. */
  private controls(dt: number): void {
    const k = (c: string) => this.held.has(c);
    let px = (k('KeyD') || k('ArrowRight') ? 1 : 0) - (k('KeyA') || k('ArrowLeft') ? 1 : 0);
    let pz = (k('KeyS') || k('ArrowDown') ? 1 : 0) - (k('KeyW') || k('ArrowUp') ? 1 : 0);
    let zoom = (k('KeyE') || k('Equal') || k('NumpadAdd') ? 1 : 0) - (k('KeyQ') || k('Minus') || k('NumpadSubtract') ? 1 : 0);
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    let pad: Gamepad | null = null;
    for (const g of pads) if (g && g.connected && g.mapping === 'standard') { pad = g; break; }
    if (pad) {
      const dz = (v: number) => (Math.abs(v) < 0.15 ? 0 : v);
      const sx = dz(pad.axes[0] ?? 0), sy = dz(pad.axes[1] ?? 0), rt = pad.buttons[7]?.value ?? 0, lt = pad.buttons[6]?.value ?? 0;
      const btn = (i: number) => pad!.buttons[i]?.pressed ?? false, edge = (i: number) => btn(i) && !this.padPrev[i];
      if (sx || sy || rt > 0.05 || lt > 0.05 || edge(0) || edge(1)) this.padMode = true;
      px += sx; pz += sy; zoom += rt - lt;
      if (edge(0)) this.pick(this.w / 2, this.h / 2);
      if (edge(1)) { this.padPrev = pad.buttons.map((b) => b.pressed); this.close(); return; }
      this.padPrev = pad.buttons.map((b) => b.pressed);
    }
    if (px || pz) { this.cx += px * 760 * dt / this.s; this.cz += pz * 760 * dt / this.s; this.anchor.sx = -1; }
    if (zoom) {
      const sx = this.padMode ? this.w / 2 : this.mouse.x >= 0 ? this.mouse.x : this.w / 2, sy = this.padMode ? this.h / 2 : this.mouse.y >= 0 ? this.mouse.y : this.h / 2;
      this.zoomAt(sx, sy, Math.exp(zoom * dt * 2.2));
    }
    this.keysPad.hidden = !this.padMode; this.keysMouse.hidden = this.padMode;
  }

  /** The DOM around the canvas: destination card, place under the cursor, scale bar, loading. */
  private panels(now: number): void {
    const nav = this.nav!, world = this.engine.get<WorldApi>('world');
    const tg = nav.target;
    const destKey = tg ? `${tg.kind}|${tg.label ?? ''}|${fmtDist(nav.routeLeft)}|${Math.round(tg.x)},${Math.round(tg.z)}|${lang()}|${nav.gps ? 1 : 0}` : '';
    if (destKey !== this.shownDest) {
      this.shownDest = destKey;
      this.dest.hidden = !tg;
      if (tg) {
        this.destTag.textContent = (tg.label ?? t(tg.kind === 'mission' ? 'nav.mission' : 'nav.waypoint')).toUpperCase();
        this.destD.textContent = fmtDist(nav.routeLeft);
        // The big number is already the distance; repeating it as "6.3 km to go" underneath said
        // nothing. Name the place when we know it, otherwise say what kind of target this is.
        const place = world?.placeName?.(tg.x, tg.z);
        this.destS.textContent = !nav.gps ? t('nav.noRoute')
          : place || t(tg.kind === 'mission' ? 'nav.mission' : 'nav.waypoint');
      }
    }
    if (now - this.placeT > 90) {
      this.placeT = now;
      const [x, z] = this.padMode || this.mouse.x < 0 ? [this.cx, this.cz] : this.toWorld(this.mouse.x, this.mouse.y);
      let name = world?.placeName?.(x, z) ?? '';
      for (const lm of nav.landmarks) if (Math.hypot(lm.x - x, lm.z - z) * this.s < 18) name = lm.name[lang()];
      if (this.placeEl.textContent !== name) this.placeEl.textContent = name;
    }
    if (this.s !== this.shownScale) {
      this.shownScale = this.s;
      const nice = [25, 50, 100, 200, 500, 1000, 2000, 5000];
      let m = nice[0];
      for (const n of nice) if (n * this.s <= 140) m = n;
      this.scaleBar.style.width = `${Math.round(m * this.s)}px`;
      this.scaleText.data = fmtDist(m);
    }
    if (now - this.reservedT > 500) {
      this.reservedT = now;
      const r: number[] = [];
      for (const e of [this.head, this.side, this.keysMouse.hidden ? this.keysPad : this.keysMouse, this.scaleEl, this.attr]) {
        const b = e.getBoundingClientRect();
        if (b.width) r.push(Math.round(b.left - 8), Math.round(b.top - 6), Math.round(b.right + 8), Math.round(b.bottom + 6));
      }
      // Panels moved (first frame, a card appeared): labels must be re-placed.
      if (r.join() !== this.reserved.join()) { this.reserved = r; this.drawn.version = -1; }
    }
    const map = nav.map, loading = !map.complete && map.tilesTotal > 0;
    this.loadEl.hidden = !loading;
    if (loading) this.loadEl.textContent = t('map.loading', { n: Math.floor(map.tilesLoaded / map.tilesTotal * 100) });
  }

  /** One redraw of the map canvas; public so a benchmark can time it. */
  draw(time: number): void {
    const nav = this.nav;
    if (!nav) return;
    const t0 = performance.now();
    const ctx = this.ctx, W = this.w, H = this.h, dpr = this.dpr, s = this.s, cx = this.cx, cz = this.cz;
    const x0 = cx - W / 2 / s, x1 = cx + W / 2 / s, z0 = cz - H / 2 / s, z1 = cz + H / 2 / s;
    const X = (x: number) => W / 2 + (x - cx) * s, Y = (z: number) => H / 2 + (z - cz) * s;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = OUTSIDE; ctx.fillRect(0, 0, W, H);
    ctx.setTransform(dpr * s, 0, 0, dpr * s, dpr * (W / 2 - cx * s), dpr * (H / 2 - cz * s));
    const b = nav.bounds;
    ctx.fillStyle = GROUND; ctx.fillRect(b.x0, b.z0, b.x1 - b.x0, b.z1 - b.z0);
    // A faint kilometre grid inside the play area.
    const step = s > 1.2 ? 250 : s > 0.4 ? 500 : 1000;
    ctx.beginPath();
    for (let x = Math.ceil(Math.max(b.x0, x0) / step) * step; x <= Math.min(b.x1, x1); x += step) { ctx.moveTo(x, Math.max(b.z0, z0)); ctx.lineTo(x, Math.min(b.z1, z1)); }
    for (let z = Math.ceil(Math.max(b.z0, z0) / step) * step; z <= Math.min(b.z1, z1); z += step) { ctx.moveTo(Math.max(b.x0, x0), z); ctx.lineTo(Math.min(b.x1, x1), z); }
    ctx.strokeStyle = 'rgba(244,241,232,0.04)'; ctx.lineWidth = 1 / s; ctx.stroke();

    const coarse = s < 0.3;
    const areas = nav.map.areaCells(x0, z0, x1, z1, coarse, this.areas);
    for (const a of areas) {
      if (a.plaza) { ctx.fillStyle = PLAZA; ctx.fill(a.plaza); }
      if (a.green) { ctx.fillStyle = GREEN; ctx.fill(a.green); }
      if (a.water) { ctx.fillStyle = WATER; ctx.fill(a.water); }
    }
    const bAlpha = smooth(0.5, 0.95, s);
    if (bAlpha > 0 && !coarse) {
      ctx.globalAlpha = bAlpha; ctx.fillStyle = BLD;
      for (const a of areas) if (a.bld) ctx.fill(a.bld);
      ctx.globalAlpha = 1;
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const cells = nav.map.roadCells(x0, z0, x1, z1, coarse, this.roads);
    for (let tier = 0; tier < TIERS; tier++) {
      if ((tier === 0 && s < 0.22) || (tier === 1 && s < 0.13)) continue;
      ctx.strokeStyle = ROAD[tier];
      ctx.lineWidth = Math.max(ROAD_MIN[tier] / s, ROAD_M[tier] * 0.85);
      for (const c of cells) { const p = c.roads[tier]; if (p) ctx.stroke(p); }
    }

    const sa = nav.searchArea;
    if (sa) {
      const red = Math.floor(time * 1.6) % 2 === 0;
      ctx.beginPath(); ctx.arc(sa.x, sa.z, sa.r, 0, Math.PI * 2);
      ctx.fillStyle = red ? 'rgba(226,64,47,0.18)' : 'rgba(47,123,255,0.18)'; ctx.fill();
      ctx.lineWidth = 2.5 / s; ctx.strokeStyle = red ? 'rgba(255,90,70,0.9)' : 'rgba(80,150,255,0.9)'; ctx.stroke();
    }
    const g = nav.gps;
    if (g && g.pts.length >= 4) {
      ctx.beginPath(); ctx.moveTo(g.x, g.z);
      for (let i = (g.i + 1) * 2; i < g.pts.length; i += 2) ctx.lineTo(g.pts[i], g.pts[i + 1]);
      ctx.strokeStyle = 'rgba(243,181,15,0.16)'; ctx.lineWidth = 16 / s; ctx.stroke();
      ctx.strokeStyle = 'rgba(9,11,13,0.7)'; ctx.lineWidth = 8 / s; ctx.stroke();
      ctx.strokeStyle = C.yellow; ctx.lineWidth = 4.5 / s; ctx.stroke();
    }

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.boxes.length = 0;
    for (const v of this.reserved) this.boxes.push(v);
    // Landmarks first (they win label space), then street names at street zoom.
    ctx.textBaseline = 'middle';
    const lg = lang();
    for (const lm of nav.landmarks) {
      const sx = X(lm.x), sy = Y(lm.z);
      if (sx < -60 || sx > W + 60 || sy < -20 || sy > H + 20) continue;
      drawBlip(ctx, 'landmark', sx, sy, s < 0.3 ? 4 : 5, NaN, time);
      if (s < 0.2) continue;
      ctx.font = `700 ${s > 1 ? 14 : 13}px ${F.ui}`;
      const name = lm.name[lg], w = ctx.measureText(name).width;
      if (this.label(sx + 10, sy - 9, sx + 14 + w, sy + 9)) this.halo(name, sx + 11, sy, C.paper, 'left');
    }
    this.mapLabels(nav, X, Y, W, H, x0, z0, x1, z1);

    for (const bl of nav.blips()) {
      const sx = X(bl.x), sy = Y(bl.z);
      if (sx < -20 || sx > W + 20 || sy < -20 || sy > H + 20) continue;
      drawBlip(ctx, bl.kind, sx, sy, 7, bl.heading === undefined ? NaN : screenAngle(bl.heading, Math.PI), time, bl.flash ?? false);
      if (bl.label && bl.kind !== 'police' && bl.kind !== 'car') this.halo(bl.label, sx + 11, sy, C.paper, 'left', `600 12px ${F.ui}`);
    }
    const tg = nav.target;
    if (tg) {
      const sx = X(tg.x), sy = Y(tg.z);
      drawBlip(ctx, tg.kind === 'mission' ? 'mission' : 'waypoint', sx, sy, tg.kind === 'mission' ? 8 : 9, NaN, time);
    }
    const me = nav.player(this.me), px = X(me.x), py = Y(me.z);
    const ph = (time * 0.8) % 1;
    ctx.beginPath(); ctx.arc(px, py, 10 + ph * 16, 0, Math.PI * 2);
    ctx.strokeStyle = `rgba(244,241,232,${(0.5 * (1 - ph)).toFixed(3)})`; ctx.lineWidth = 2; ctx.stroke();
    drawPlayer(ctx, px, py, screenAngle(me.heading, Math.PI), 20);
    if (this.padMode) this.reticle(W / 2, H / 2);

    const ms = performance.now() - t0, st = this.stats;
    st.n++; st.mean += (ms - st.mean) / Math.min(st.n, 120); st.max = Math.max(st.max, ms);
  }

  /**
   * The map's labels the way the map apps layer them: the big places, ring-road shields, the
   * interchanges, stations and districts, then road names and smaller places as the zoom allows.
   * Earlier layers win the space (`label`).
   */
  private mapLabels(nav: NavSystem, X: (x: number) => number, Y: (z: number) => number, W: number, H: number, x0: number, z0: number, x1: number, z1: number): void {
    const s = this.s, lb = nav.labels(), lg = lang();
    this.hits.length = 0;
    this.placedRoads.length = 0;
    const lm = this.landmarkNames ??= new Set(nav.landmarks.map((l) => l.name.zh));
    const places = (rank: number) => {
      if (s < RANK_S[rank]) return;
      for (const p of lb.places) {
        if (p.rank !== rank || p.x < x0 - 50 || p.x > x1 + 50 || p.z < z0 - 50 || p.z > z1 + 50) continue;
        if (p.cat === 'area' && s > AREA_MAX) continue;
        if (lm.has(p.name.zh) || (p.cat === 'sight' && nav.landmarks.some((l) => Math.abs(l.x - p.x) < 120 && Math.abs(l.z - p.z) < 120))) continue;
        this.place(p, X(p.x), Y(p.z), lg);
      }
    };
    places(0);
    // Interchanges and stations before the shields: a shield can sit anywhere along its ring.
    if (s >= 0.17) for (const b of lb.bridges) {
      if (b.x < x0 || b.x > x1 || b.z < z0 || b.z > z1) continue;
      this.bridge(b.name[lg], b.x, b.z, X(b.x), Y(b.z));
    }
    places(1);
    this.roadNames(lb.roads, 4, X, Y, W, H, x0, z0, x1, z1, lg);
    this.roadNames(lb.roads, 3, X, Y, W, H, x0, z0, x1, z1, lg);
    places(2);
    this.roadNames(lb.roads, 2, X, Y, W, H, x0, z0, x1, z1, lg);
    this.roadNames(lb.roads, 1, X, Y, W, H, x0, z0, x1, z1, lg);
    places(3);
  }

  /** A place: its icon and name to the right (or the left if that is taken); nothing if neither fits. */
  private place(p: Place, sx: number, sy: number, lg: 'zh' | 'en'): void {
    const ctx = this.ctx, [col, glyph] = PLACE_ICON[p.cat], name = p.name[lg];
    if (!col) {
      // District names: text only, quiet and spaced.
      const font = `600 ${p.rank <= 1 ? 14 : 12}px ${F.ui}`;
      ctx.font = font;
      const w = this.width(name, font);
      if (!this.label(sx - w / 2 - 4, sy - 9, sx + w / 2 + 4, sy + 9)) return;
      this.halo(name, sx, sy, 'rgba(196,202,208,0.62)', 'center', font);
      return;
    }
    const font = `${p.rank === 0 ? 700 : 600} ${p.rank === 0 ? 13 : 12}px ${F.ui}`;
    const w = this.width(name, font);
    if (!this.label(sx - 8, sy - 8, sx + 8, sy + 8)) return;
    const right = this.label(sx + 10, sy - 8, sx + 14 + w, sy + 8), left = !right && this.label(sx - 14 - w, sy - 8, sx - 10, sy + 8);
    if (!right && !left) { this.boxes.length -= 4; return; }
    const ctx2 = ctx;
    ctx2.beginPath(); ctx2.arc(sx, sy, 7, 0, Math.PI * 2);
    ctx2.fillStyle = col; ctx2.fill();
    ctx2.lineWidth = 1.5; ctx2.strokeStyle = 'rgba(9,11,13,0.9)'; ctx2.stroke();
    if (glyph === '+') {
      ctx2.fillStyle = '#fff'; ctx2.fillRect(sx - 1.3, sy - 4, 2.6, 8); ctx2.fillRect(sx - 4, sy - 1.3, 8, 2.6);
    } else {
      ctx2.font = `700 9px ${F.ui}`; ctx2.fillStyle = '#fff'; ctx2.textAlign = 'center'; ctx2.textBaseline = 'middle';
      ctx2.fillText(glyph, sx, sy + 0.5);
    }
    this.halo(name, right ? sx + 11 : sx - 11, sy, PLACE_TEXT[p.cat] ?? 'rgba(232,229,220,0.9)', right ? 'left' : 'right', font);
    this.hits.push({ sx, sy, x: p.x, z: p.z, label: name });
  }

  /** An interchange: a small bridge glyph and its name. */
  private bridge(name: string, x: number, z: number, sx: number, sy: number): void {
    const ctx = this.ctx, font = `700 12px ${F.ui}`, w = this.width(name, font);
    if (!this.label(sx - 8, sy - 8, sx + 14 + w, sy + 8)) return;
    ctx.beginPath(); ctx.roundRect(sx - 7, sy - 7, 14, 14, 3);
    ctx.fillStyle = '#2b3136'; ctx.fill(); ctx.lineWidth = 1.2; ctx.strokeStyle = '#d7b779'; ctx.stroke();
    ctx.beginPath(); ctx.moveTo(sx - 4.5, sy + 3); ctx.lineTo(sx - 4.5, sy); ctx.quadraticCurveTo(sx, sy - 5, sx + 4.5, sy); ctx.lineTo(sx + 4.5, sy + 3);
    ctx.moveTo(sx - 5, sy - 1); ctx.lineTo(sx + 5, sy - 1);
    ctx.strokeStyle = '#f0d9a6'; ctx.lineWidth = 1.2; ctx.stroke();
    this.halo(name, sx + 11, sy, '#f0d9a6', 'left', font);
    this.hits.push({ sx, sy, x, z, label: name });
  }

  /**
   * Names along the roads of one tier: at every ~250 px of a chain where the road runs straight
   * under the whole name, turned to it and kept upright; a name not repeated within 300 px.
   * Expressways and rings get a shield instead (their short name, 东三环, zoomed out).
   */
  private roadNames(roads: readonly RoadChain[], tier: number, X: (x: number) => number, Y: (z: number) => number, W: number, H: number, x0: number, z0: number, x1: number, z1: number, lg: 'zh' | 'en'): void {
    const s = this.s, ctx = this.ctx;
    if (s < ROAD_S[tier]) return;
    const shield = tier === 4;
    const font = shield ? `700 12px ${F.ui}` : `600 ${tier === 3 ? 13 : tier === 2 ? 12 : 11}px ${F.ui}`;
    const color = tier === 3 ? 'rgba(240,237,228,0.92)' : tier === 2 ? 'rgba(232,229,220,0.8)' : 'rgba(220,217,208,0.66)';
    const gap = shield ? 420 : 300, every = Math.max(2, Math.round((shield ? 330 : 250) / (s * CHAIN_STEP)));
    let n = 0;
    for (const c of roads) {
      if (c.tier !== tier) continue;
      if (c.x1 < x0 || c.x0 > x1 || c.z1 < z0 || c.z0 > z1) continue;
      const name = shield && s < 0.45 ? c.short[lg] : c.name[lg];
      const w = this.width(name, font);
      const half = (w / 2 + 10) / s, k = shield ? 1 : Math.ceil(half / CHAIN_STEP);
      const P = c.pts, m = P.length / 2;
      if (m < 2 * k + 1) continue;
      for (let i = k + Math.floor(every / 2) % Math.max(1, m - 2 * k); i < m - k; i += every) {
        const sx = X(P[i * 2]), sy = Y(P[i * 2 + 1]);
        if (sx < 40 || sx > W - 40 || sy < 28 || sy > H - 28) continue;
        if (this.placedRoads.some((q) => q.name === name && Math.hypot(q.sx - sx, q.sy - sy) < gap)) continue;
        if (shield) {
          const hw = w / 2 + 7;
          if (!this.label(sx - hw, sy - 10, sx + hw, sy + 10)) continue;
          ctx.beginPath(); ctx.roundRect(sx - hw, sy - 9, hw * 2, 18, 4);
          ctx.fillStyle = '#c98a2b'; ctx.fill(); ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(9,11,13,0.85)'; ctx.stroke();
          ctx.font = font; ctx.fillStyle = '#1b1206'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
          ctx.fillText(name, sx, sy + 0.5);
        } else {
          // Straight enough under the whole name: every sample within 3 px of the chord.
          const ax = P[(i - k) * 2], az = P[(i - k) * 2 + 1], bx = P[(i + k) * 2], bz = P[(i + k) * 2 + 1];
          const cl = Math.hypot(bx - ax, bz - az);
          if (cl < half * 1.8) continue;
          const ux = (bx - ax) / cl, uz = (bz - az) / cl;
          let bent = false;
          for (let j = i - k + 1; j < i + k && !bent; j++) bent = Math.abs((P[j * 2] - ax) * uz - (P[j * 2 + 1] - az) * ux) * s > 3;
          if (bent) continue;
          let ang = Math.atan2(uz, ux);
          if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
          const cs = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang)), hx = cs * w / 2 + sn * 8, hy = sn * w / 2 + cs * 8;
          if (!this.label(sx - hx, sy - hy, sx + hx, sy + hy)) continue;
          ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
          this.halo(name, 0, 0, color, 'center', font);
          ctx.restore();
        }
        this.placedRoads.push({ name, sx, sy });
        if (++n >= 90) return;
      }
    }
  }

  private width(text: string, font: string): number {
    const key = font + '|' + text;
    let w = this.widths.get(key);
    if (w === undefined) { this.ctx.font = font; w = this.ctx.measureText(text).width; this.widths.set(key, w); }
    return w;
  }

  /** Reserve a screen box for a label; false if it overlaps one already placed. */
  private label(ax: number, ay: number, bx: number, by: number): boolean {
    const bs = this.boxes;
    for (let i = 0; i < bs.length; i += 4) if (ax < bs[i + 2] && bx > bs[i] && ay < bs[i + 3] && by > bs[i + 1]) return false;
    bs.push(ax, ay, bx, by);
    return true;
  }

  private halo(text: string, x: number, y: number, color: string, align: CanvasTextAlign, font?: string): void {
    const ctx = this.ctx;
    if (font) ctx.font = font;
    ctx.textAlign = align; ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round'; ctx.lineWidth = 3.5; ctx.strokeStyle = 'rgba(9,11,13,0.85)';
    ctx.strokeText(text, x, y);
    ctx.fillStyle = color; ctx.fillText(text, x, y);
  }

  private reticle(x: number, y: number): void {
    const ctx = this.ctx;
    ctx.strokeStyle = C.paper; ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(x, y, 9, 0, Math.PI * 2);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { ctx.moveTo(x + dx * 13, y + dy * 13); ctx.lineTo(x + dx * 19, y + dy * 19); }
    ctx.stroke();
  }

  private legendIcon(cv: HTMLCanvasElement, kind: MarkKind | 'you' | 'route' | 'search'): void {
    const d = 2;
    cv.width = cv.height = 22 * d;
    const ctx = cv.getContext('2d')!;
    ctx.scale(d, d);
    if (kind === 'you') drawPlayer(ctx, 11, 11, 0.5, 16);
    else if (kind === 'route') {
      ctx.lineCap = 'round';
      ctx.strokeStyle = INK; ctx.lineWidth = 7; ctx.beginPath(); ctx.moveTo(3, 16); ctx.lineTo(10, 8); ctx.lineTo(19, 12); ctx.stroke();
      ctx.strokeStyle = C.yellow; ctx.lineWidth = 4; ctx.stroke();
    } else if (kind === 'search') {
      ctx.beginPath(); ctx.arc(11, 11, 8.5, Math.PI / 2, Math.PI * 1.5); ctx.fillStyle = 'rgba(226,64,47,0.45)'; ctx.fill(); ctx.strokeStyle = '#ff5a46'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(11, 11, 8.5, -Math.PI / 2, Math.PI / 2); ctx.fillStyle = 'rgba(47,123,255,0.45)'; ctx.fill(); ctx.strokeStyle = '#5096ff'; ctx.stroke();
    } else drawBlip(ctx, kind, 11, kind === 'waypoint' ? 19 : 11, kind === 'waypoint' ? 6.5 : 6.5, kind === 'police' || kind === 'car' ? 0.6 : NaN, 0);
  }
}
