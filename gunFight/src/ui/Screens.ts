/**
 * Full-screen menus layered over the live 3D scene (blurred/darkened): main menu, pause, death,
 * settings, controls. Pure DOM; the Hud owns game-flow side effects through `actions`.
 */
import { div, span, el, setText, setClass, animate, fmtInt, pad2, type ShotAnim } from './dom';
import type { Settings, SettingsData } from './Settings';
import type { QualityTier } from '../core/Quality';

export type ScreenName = 'menu' | 'pause' | 'dead' | 'settings' | 'controls' | 'none';

export interface ScreenActions {
  play(): void;
  resume(): void;
  quit(): void;
  respawn(): void;
}

export interface DeadStats { kills: number; wave: number; score: number; streak: number }

const CONTROLS: [string[], string][] = [
  [['W', 'A', 'S', 'D'], 'Move'], [['SHIFT'], 'Sprint'], [['SPACE'], 'Jump'], [['CTRL', 'C'], 'Crouch / Slide'],
  [['LMB'], 'Fire'], [['RMB'], 'Aim down sights'], [['R'], 'Reload'], [['1', '2', '3'], 'Weapon slots'], [['SCROLL'], 'Cycle weapon'],
  [['V'], 'Melee'], [['G'], 'Grenade'], [['E'], 'Interact'], [['F'], 'Inspect weapon'], [['ESC'], 'Pause'],
];

function button(label: string, idx: string, cls: string, onClick: () => void): HTMLDivElement {
  const b = div('btn ' + cls, [span('idx', idx), span('', label)]);
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function slider(min: number, max: number, step: number, value: number, fmt: (v: number) => string, onInput: (v: number) => void): HTMLDivElement {
  const input = el('input', 'sl', { type: 'range', min, max, step, value });
  const val = span('val', fmt(value));
  input.addEventListener('input', () => { const v = Number(input.value); setText(val, fmt(v)); onInput(v); });
  return div('ctl', [input, val]);
}

function segmented<T extends string>(options: T[], value: T, onPick: (v: T) => void): { el: HTMLDivElement; set(v: T): void } {
  const opts = options.map((o) => { const d = div('o' + (o === value ? ' on' : ''), [o.toUpperCase()]); d.addEventListener('click', () => { set(o); onPick(o); }); return d; });
  const root = div('seg', opts);
  const set = (v: T) => opts.forEach((d, i) => setClass(d, 'on', options[i] === v));
  return { el: div('ctl', [root]), set };
}

export class Screens {
  root = div();
  current: ScreenName = 'none';
  private back: ScreenName = 'menu';
  private screens = new Map<ScreenName, HTMLDivElement>();
  private pauseSub = div('sub', ['WAVE 01 · 0 KILLS']);
  private dead!: { kills: HTMLElement; wave: HTMLElement; score: HTMLElement; streak: HTMLElement; cd: HTMLElement; deploy: HTMLElement };
  private countdown = 0;
  private lastCd = -1;
  private cdAnim: ShotAnim | null = null;
  private qualitySeg!: { set(v: QualityTier): void };
  private bestWave!: HTMLElement; private bestScore!: HTMLElement; private bestKills!: HTMLElement;

  constructor(private settings: Settings, private actions: ScreenActions, private version: string, private isShot: boolean) {
    this.root.id = 'screens';
    this.buildMenu();
    this.buildPause();
    this.buildDead();
    this.buildSettings();
    this.buildControls();
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /**
   * Every screen sits on the live scene. Three stacked backdrop layers do the work: `bg` blurs and
   * *keeps* the colour (a flat desaturating blur is what made this read as dead grey), `bloom`
   * over-exposes and screens the bright end back in so the sun and sky glow through, and `vig`
   * darkens the corners. `bg` drifts slowly so the plate is never a still grey wall.
   */
  private frame(cls: string, left: string, right: string, extras: (Node | string)[] = []): HTMLDivElement {
    const s = div('screen ' + cls, [
      div('bg'), div('bloom'), div('vig'),
      div('edge top'), div('edge bot'), div('corner', [left]), div('corner r', [right]),
      div('ver', [`GUNFIGHT v${this.version} · THREE.JS`]), ...extras,
    ]);
    this.root.append(s);
    return s;
  }

  /** Keycap + action, the way a shipped shooter prints its footer hints. */
  private static hint(...pairs: [string, string][]): HTMLDivElement {
    return div('hint', pairs.map(([k, a]) => div('hi', [span('k', k), span('a', a)])));
  }

  private buildMenu(): void {
    const title = div('title', [div('name', ['GUNFIGHT', el('i')]), div('tag', ['SURVIVAL · HOLD THE LINE'])]);
    const list = div('menu-list', [
      button('PLAY', '01', 'primary', () => this.actions.play()),
      button('SETTINGS', '02', '', () => this.show('settings', 'menu')),
      button('CONTROLS', '03', '', () => this.show('controls', 'menu')),
    ]);
    const hint = Screens.hint(['WASD', 'MOVE'], ['SHIFT', 'SPRINT'], ['RMB', 'AIM'], ['R', 'RELOAD']);
    const best = this.loadBest();
    this.bestWave = span('v', pad2(best.wave)); this.bestScore = span('v', fmtInt(best.score)); this.bestKills = span('v', String(best.kills));
    const brief = div('brief', [
      div('h', ['MISSION BRIEFING']),
      div('t', ['HOLD THE LINE']),
      div('d', ['Hostile squads push the compound in escalating waves. Scavenge ammo, use cover, and survive as long as you can. Headshots score more.']),
      div('best', [div('st', [span('l', 'BEST WAVE'), this.bestWave]), div('st', [span('l', 'BEST SCORE'), this.bestScore]), div('st', [span('l', 'MOST KILLS'), this.bestKills])]),
    ]);
    const s = this.frame('menu', 'GUNFIGHT // OPERATIONS', 'MAIN MENU', [title, list, brief, hint]);
    this.screens.set('menu', s);
  }

  private buildPause(): void {
    const title = div('title sm', [div('name', ['PAUSED']), this.pauseSub]);
    const list = div('menu-list lower', [
      button('RESUME', '01', 'primary', () => this.actions.resume()),
      button('SETTINGS', '02', '', () => this.show('settings', 'pause')),
      button('CONTROLS', '03', '', () => this.show('controls', 'pause')),
      button('QUIT TO MENU', '04', 'danger', () => this.actions.quit()),
    ]);
    const hint = Screens.hint(['ESC', 'RESUME']);
    const s = this.frame('pause', 'GUNFIGHT // OPERATIONS', 'PAUSED', [title, list, hint]);
    this.screens.set('pause', s);
  }

  private buildDead(): void {
    const st = (l: string) => { const v = span('v', '0'); return { el: div('st', [span('l', l), v]), v }; };
    const kills = st('KILLS'), wave = st('WAVE'), score = st('SCORE'), streak = st('BEST STREAK');
    const cd = div('cd', ['3']);
    const deployBtn = div('btn', ['DEPLOY']);
    deployBtn.addEventListener('click', (e) => { e.stopPropagation(); this.actions.respawn(); });
    const deploy = div('deploy', [div('l', ['DEPLOYING IN']), cd, deployBtn]);
    const kia = div('kia', [div('big', ['K.I.A.']), div('sub', ['YOU WERE ELIMINATED']), div('ln'), div('stats', [kills.el, wave.el, score.el, streak.el])]);
    const hint = Screens.hint(['SPACE', 'DEPLOY']);
    const s = this.frame('dead', 'GUNFIGHT // AFTER ACTION', 'KILLED IN ACTION', [kia, deploy, hint]);
    s.addEventListener('click', () => { if (this.countdown <= 0) this.actions.respawn(); });
    this.dead = { kills: kills.v, wave: wave.v, score: score.v, streak: streak.v, cd, deploy };
    this.screens.set('dead', s);
  }

  private buildSettings(): void {
    const d = this.settings.data;
    const rows: HTMLElement[] = [];
    const row = (label: string, sub: string | null, ctl: HTMLElement) => {
      const lab = div('lab', [label]);
      if (sub) lab.append(el('small', '', undefined, [sub]));
      rows.push(div('row', [lab, ctl]));
    };
    row('MOUSE SENSITIVITY', null, slider(0.2, 3, 0.05, d.sensitivity, (v) => v.toFixed(2) + '×', (v) => this.settings.set('sensitivity', v)));
    const inv = segmented(['off', 'on'], d.invertY ? 'on' : 'off', (v) => this.settings.set('invertY', v === 'on'));
    row('INVERT LOOK Y', null, inv.el);
    row('FIELD OF VIEW', 'Horizontal FOV, degrees', slider(60, 110, 1, d.fov, (v) => `${v}°`, (v) => this.settings.set('fov', v)));
    const q = segmented<QualityTier>(['low', 'medium', 'high', 'ultra'], d.quality, (v) => { if (v !== this.settings.data.quality) this.settings.applyQualityAndReload(v); });
    this.qualitySeg = q;
    row('GRAPHICS QUALITY', 'Changing quality reloads the game', q.el);
    row('MASTER VOLUME', null, slider(0, 1, 0.05, d.master, (v) => `${Math.round(v * 100)}%`, (v) => this.settings.set('master', v)));
    row('SFX VOLUME', null, slider(0, 1, 0.05, d.sfx, (v) => `${Math.round(v * 100)}%`, (v) => this.settings.set('sfx', v)));
    row('MUSIC VOLUME', null, slider(0, 1, 0.05, d.music, (v) => `${Math.round(v * 100)}%`, (v) => this.settings.set('music', v)));
    const backBtn = button('BACK', '', '', () => this.goBack());
    const panel = div('panel', [div('ph', ['SETTINGS']), div('ps', ['APPLIED INSTANTLY · SAVED IN THIS BROWSER']), div('rows', rows), div('foot', [backBtn, span('note', 'Esc to go back')])]);
    const s = this.frame('settings', 'GUNFIGHT // OPERATIONS', 'SETTINGS', [panel, Screens.hint(['ESC', 'BACK'])]);
    this.screens.set('settings', s);
  }

  private buildControls(): void {
    const rows = CONTROLS.map(([keys, action]) => div('row', [div('lab', [action.toUpperCase()]), div('ctl', [div('keys', keys.map((k) => span('key', k)))])]));
    const backBtn = button('BACK', '', '', () => this.goBack());
    const panel = div('panel', [div('ph', ['CONTROLS']), div('ps', ['KEYBOARD & MOUSE']), div('rows', rows), div('foot', [backBtn, span('note', 'Esc to go back')])]);
    const s = this.frame('controls', 'GUNFIGHT // OPERATIONS', 'CONTROLS', [panel, Screens.hint(['ESC', 'BACK'])]);
    this.screens.set('controls', s);
  }

  show(name: ScreenName, back?: ScreenName): void {
    if (back) this.back = back;
    if (name === this.current) return;
    for (const [n, s] of this.screens) setClass(s, 'show', n === name);
    this.current = name;
    if (name === 'dead') this.startCountdown(3);
  }

  goBack(): void { this.show(this.back); }

  setPauseInfo(wave: number, kills: number): void { setText(this.pauseSub, `WAVE ${pad2(wave)} · ${kills} KILLS`); }

  setDeadStats(s: DeadStats): void {
    setText(this.dead.kills, String(s.kills)); setText(this.dead.wave, pad2(s.wave));
    setText(this.dead.score, fmtInt(s.score)); setText(this.dead.streak, String(s.streak));
    const best = this.loadBest();
    const next = { wave: Math.max(best.wave, s.wave), score: Math.max(best.score, s.score), kills: Math.max(best.kills, s.kills) };
    if (next.wave !== best.wave || next.score !== best.score || next.kills !== best.kills) {
      try { localStorage.setItem('gunfight.best.v1', JSON.stringify(next)); } catch { /* ignore */ }
      setText(this.bestWave, pad2(next.wave)); setText(this.bestScore, fmtInt(next.score)); setText(this.bestKills, String(next.kills));
    }
  }

  private loadBest(): { wave: number; score: number; kills: number } {
    try { const raw = localStorage.getItem('gunfight.best.v1'); if (raw) return { wave: 0, score: 0, kills: 0, ...JSON.parse(raw) }; } catch { /* ignore */ }
    return { wave: 0, score: 0, kills: 0 };
  }

  startCountdown(seconds: number): void {
    this.countdown = seconds; this.lastCd = -1;
    setClass(this.dead.deploy, 'ready', false);
    this.tickCountdown();
  }

  private tickCountdown(): void {
    const n = Math.ceil(this.countdown - 1e-6);
    if (n === this.lastCd) return;
    this.lastCd = n;
    if (n <= 0) { setClass(this.dead.deploy, 'ready', true); return; }
    setText(this.dead.cd, String(n));
    this.cdAnim?.cancel();
    this.cdAnim = animate(this.dead.cd, [
      { opacity: 0, transform: 'scale(1.6)' }, { opacity: 1, transform: 'scale(1)', offset: 0.18 }, { opacity: 1, transform: 'scale(1)', offset: 0.82 }, { opacity: 0.35, transform: 'scale(.92)' },
    ], { duration: 1000, easing: 'cubic-bezier(.2,.8,.2,1)' }, 300);
  }

  /** Wall-clock countdown on the death screen (not engine time: the engine may be paused). */
  update(dtWall: number): void {
    if (this.current !== 'dead' || this.countdown <= 0) return;
    this.countdown -= dtWall;
    this.tickCountdown();
  }

  refreshSettings(d: SettingsData): void { this.qualitySeg.set(d.quality); }

  private onKey(e: KeyboardEvent): void {
    if (this.current === 'none') return;
    if (e.code === 'Escape') {
      if (this.current === 'pause') this.actions.resume();
      else if (this.current === 'settings' || this.current === 'controls') this.goBack();
      e.preventDefault();
    } else if ((e.code === 'Space' || e.code === 'Enter') && this.current === 'dead' && this.countdown <= 0) {
      this.actions.respawn();
    }
    void this.isShot;
  }
}
