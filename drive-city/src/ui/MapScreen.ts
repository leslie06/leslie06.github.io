import type { Engine, System } from '../core/Engine';
import { lang, t, type TKey } from '../core/I18n';
import type { VehicleApi, WorldApi } from '../game/Contracts';
import type { NavSystem } from '../nav';
import { TIERS, type AreaCell, type RoadCell } from '../nav/MapData';
import { INK, drawBlip, drawPlayer, screenAngle, type MarkKind } from '../nav/Draw';
import type { UiApi } from '.';
import { fmtDist } from './Minimap';
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
const ROAD = ['#2c3439', '#3c454b', '#525b62', '#6c747a', '#8a9093'];
/** Road widths: metres at street zoom, and the thinnest they get in px. */
const ROAD_M = [5, 8, 13, 20, 28], ROAD_MIN = [0.6, 0.9, 1.4, 2, 2.6];
const S_MIN = 0.1, S_MAX = 5, S_OPEN = 0.42;
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
  private labelStamp = new Uint32Array(0);
  private stamp = 0;
  private readonly widths = new Map<string, number>();
  private readonly tmp = { x: 0, z: 0, dx: 0, dz: 0 };
  private readonly cand: { id: number; rank: number }[] = [];

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
      ['police', 'map.police'], ['car', 'map.car'], ['landmark', 'map.landmark'], ['route', 'map.route'], ['search', 'map.search']];
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
        this.destS.textContent = nav.gps ? (world?.placeName?.(tg.x, tg.z) || t('map.left', { d: fmtDist(nav.routeLeft) })) : t('nav.noRoute');
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
    if (s >= 1) this.streetNames(nav, X, Y, W, H, x0, z0, x1, z1);

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

  /** Street names along their roads, biggest roads first, never overlapping or repeating nearby. */
  private streetNames(nav: NavSystem, X: (x: number) => number, Y: (z: number) => number, W: number, H: number, x0: number, z0: number, x1: number, z1: number): void {
    const ctx = this.ctx, graph = nav.graph, s = this.s;
    if (this.labelStamp.length !== graph.links.length) this.labelStamp = new Uint32Array(graph.links.length);
    const st = ++this.stamp, cand = this.cand;
    cand.length = 0;
    for (const c of nav.map.roadCells(x0, z0, x1, z1, false, this.roads)) for (const id of c.named) {
      if (this.labelStamp[id] === st) continue;
      this.labelStamp[id] = st;
      const l = graph.links[id];
      if (l.len * s < 110) continue;
      cand.push({ id, rank: -(l.hw * 4 + l.len * 0.02) });
    }
    cand.sort((a, b) => a.rank - b.rank || a.id - b.id);
    const font = `600 ${s > 2.5 ? 13 : 12}px ${F.ui}`;
    ctx.font = font;
    const placed: [string, number, number][] = [];
    let n = 0;
    for (const { id } of cand) {
      if (n >= 60) break;
      const l = graph.links[id];
      const p = graph.at(l, l.len / 2, 0, this.tmp);
      const sx = X(p.x), sy = Y(p.z);
      if (sx < 30 || sx > W - 30 || sy < 20 || sy > H - 20) continue;
      let w = this.widths.get(l.name);
      if (w === undefined) { w = ctx.measureText(l.name).width; this.widths.set(l.name, w); }
      if (w + 30 > l.len * s) continue;
      if (placed.some(([nm, x, y]) => nm === l.name && Math.hypot(x - sx, y - sy) < 320)) continue;
      let ang = Math.atan2(p.dz, p.dx);
      if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      const c = Math.abs(Math.cos(ang)), sn = Math.abs(Math.sin(ang)), hx = c * w / 2 + sn * 8, hy = sn * w / 2 + c * 8;
      if (!this.label(sx - hx, sy - hy, sx + hx, sy + hy)) continue;
      ctx.save(); ctx.translate(sx, sy); ctx.rotate(ang);
      this.halo(l.name, 0, 0, 'rgba(244,241,232,0.82)', 'center', font);
      ctx.restore();
      placed.push([l.name, sx, sy]);
      n++;
    }
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
