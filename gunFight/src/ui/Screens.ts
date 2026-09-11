/**
 * Full-screen menus layered over the live 3D scene (blurred/darkened): main menu, pause, death,
 * settings, controls. Pure DOM; the Hud owns game-flow side effects through `actions`.
 * Labels are `L()` nodes, so switching language re-labels every screen in place.
 */
import { div, span, el, setText, setClass, animate, fmtInt, pad2, type ShotAnim } from './dom';
import { L } from './lang';
import { t, lang, setLang, onLangChange, LANGS, LANG_NAME, type Lang, type TKey } from '../core/I18n';
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

/** Fixed text, or a live-translated `L()` node. */
type Label = Node | string;

const CONTROLS: [string[], TKey][] = [
  [['W', 'A', 'S', 'D'], 'ctl.move'], [['SHIFT'], 'ctl.sprint'], [['SPACE'], 'ctl.jump'], [['CTRL', 'C'], 'ctl.crouch'],
  [['LMB'], 'ctl.fire'], [['RMB'], 'ctl.ads'], [['R'], 'ctl.reload'], [['1', '2', '3'], 'ctl.slots'], [['SCROLL'], 'ctl.cycle'],
  [['V'], 'ctl.melee'], [['G'], 'ctl.grenade'], [['E'], 'ctl.interact'], [['F'], 'ctl.inspect'], [['ESC'], 'ctl.pause'],
];

/** Keycaps that are words rather than the legend printed on the key; the rest stay as printed. */
const KEY_WORDS: Record<string, TKey> = { SPACE: 'key.space', LMB: 'key.lmb', RMB: 'key.rmb', SCROLL: 'key.scroll' };
const keycap = (k: string): Label => (KEY_WORDS[k] ? L(KEY_WORDS[k]) : k);

const QUALITY_LABEL: Record<QualityTier, TKey> = { low: 'q.low', medium: 'q.medium', high: 'q.high', ultra: 'q.ultra' };

const sp = (cls: string, label: Label): HTMLSpanElement => el('span', cls, undefined, [label]);

function button(label: Label, idx: string, cls: string, onClick: () => void): HTMLDivElement {
  const b = div('btn ' + cls, [span('idx', idx), sp('', label)]);
  b.addEventListener('click', (e) => { e.stopPropagation(); onClick(); });
  return b;
}

function slider(min: number, max: number, step: number, value: number, fmt: (v: number) => string, onInput: (v: number) => void): HTMLDivElement {
  const input = el('input', 'sl', { type: 'range', min, max, step, value });
  const val = span('val', fmt(value));
  input.addEventListener('input', () => { const v = Number(input.value); setText(val, fmt(v)); onInput(v); });
  return div('ctl', [input, val]);
}

function segmented<T extends string>(options: readonly T[], value: T, label: (o: T) => Label, onPick: (v: T) => void): { el: HTMLDivElement; set(v: T): void } {
  const opts = options.map((o) => { const d = div('o' + (o === value ? ' on' : ''), [label(o)]); d.addEventListener('click', () => { set(o); onPick(o); }); return d; });
  const root = div('seg', opts);
  const set = (v: T) => opts.forEach((d, i) => setClass(d, 'on', options[i] === v));
  return { el: div('ctl', [root]), set };
}

export class Screens {
  root = div();
  current: ScreenName = 'none';
  private back: ScreenName = 'menu';
  private screens = new Map<ScreenName, HTMLDivElement>();
  private pauseSub = div('sub');
  private pauseWave = 1;
  private pauseKills = 0;
  private dead!: { kills: HTMLElement; wave: HTMLElement; score: HTMLElement; streak: HTMLElement; cd: HTMLElement; deploy: HTMLElement };
  private countdown = 0;
  private lastCd = -1;
  private cdAnim: ShotAnim | null = null;
  private qualitySeg!: { set(v: QualityTier): void };
  private langSegs: { set(v: Lang): void }[] = [];
  private bestWave!: HTMLElement; private bestScore!: HTMLElement; private bestKills!: HTMLElement;

  constructor(private settings: Settings, private actions: ScreenActions, private version: string, private isShot: boolean) {
    this.root.id = 'screens';
    this.buildMenu();
    this.buildPause();
    this.buildDead();
    this.buildSettings();
    this.buildControls();
    this.setPauseInfo(1, 0);
    // L() nodes re-label themselves; these are the bits that are formatted or selected, not labelled.
    onLangChange((l) => {
      for (const s of this.langSegs) s.set(l);
      this.setPauseInfo(this.pauseWave, this.pauseKills);
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  /**
   * Every screen sits on the live scene. Three stacked backdrop layers do the work: `bg` blurs and
   * *keeps* the colour (a flat desaturating blur is what made this read as dead grey), `bloom`
   * over-exposes and screens the bright end back in so the sun and sky glow through, and `vig`
   * darkens the corners. `bg` drifts slowly so the plate is never a still grey wall.
   */
  private frame(cls: string, left: Label, right: Label, extras: Label[] = []): HTMLDivElement {
    const s = div('screen ' + cls, [
      div('bg'), div('bloom'), div('vig'),
      div('edge top'), div('edge bot'), div('corner', [left]), div('corner r', [right]),
      div('ver', [`GUNFIGHT v${this.version} · THREE.JS`]), ...extras,
    ]);
    this.root.append(s);
    return s;
  }

  /** Keycap + action, the way a shipped shooter prints its footer hints. */
  private static hint(...pairs: [Label, Label][]): HTMLDivElement {
    return div('hint', pairs.map(([k, a]) => div('hi', [sp('k', k), sp('a', a)])));
  }

  /** 中文 | ENGLISH. Each option is written in its own language, so it can be found from either side. */
  private langSwitch(): HTMLDivElement {
    const seg = segmented<Lang>(LANGS, lang(), (o) => LANG_NAME[o], (v) => setLang(v));
    this.langSegs.push(seg);
    return seg.el;
  }

  private buildMenu(): void {
    const title = div('title', [div('name', ['GUNFIGHT', el('i')]), div('tag', [L('menu.tag')])]);
    const list = div('menu-list', [
      button(L('menu.play'), '01', 'primary', () => this.actions.play()),
      button(L('menu.settings'), '02', '', () => this.show('settings', 'menu')),
      button(L('menu.controls'), '03', '', () => this.show('controls', 'menu')),
    ]);
    const hint = Screens.hint(['WASD', L('hint.move')], ['SHIFT', L('hint.sprint')], [keycap('RMB'), L('hint.aim')], ['R', L('hint.reload')]);
    const best = this.loadBest();
    this.bestWave = span('v', pad2(best.wave)); this.bestScore = span('v', fmtInt(best.score)); this.bestKills = span('v', String(best.kills));
    const brief = div('brief', [
      div('h', [L('brief.head')]),
      div('t', [L('brief.title')]),
      div('d', [L('brief.body')]),
      div('best', [div('st', [sp('l', L('best.wave')), this.bestWave]), div('st', [sp('l', L('best.score')), this.bestScore]), div('st', [sp('l', L('best.kills')), this.bestKills])]),
    ]);
    // The right-hand corner is the language switch here rather than a "MAIN MENU" caption: the
    // first screen is where someone who can't read the current language has to find it.
    const s = this.frame('menu', L('frame.ops'), this.langSwitch(), [title, list, brief, hint]);
    this.screens.set('menu', s);
  }

  private buildPause(): void {
    const title = div('title sm', [div('name', [L('pause.title')]), this.pauseSub]);
    const list = div('menu-list lower', [
      button(L('pause.resume'), '01', 'primary', () => this.actions.resume()),
      button(L('menu.settings'), '02', '', () => this.show('settings', 'pause')),
      button(L('menu.controls'), '03', '', () => this.show('controls', 'pause')),
      button(L('pause.quit'), '04', 'danger', () => this.actions.quit()),
    ]);
    const hint = Screens.hint(['ESC', L('hint.resume')]);
    const s = this.frame('pause', L('frame.ops'), L('frame.paused'), [title, list, hint]);
    this.screens.set('pause', s);
  }

  private buildDead(): void {
    const st = (k: TKey) => { const v = span('v', '0'); return { el: div('st', [sp('l', L(k)), v]), v }; };
    const kills = st('stat.kills'), wave = st('stat.wave'), score = st('stat.score'), streak = st('stat.streak');
    const cd = div('cd', ['3']);
    const deployBtn = div('btn', [L('dead.deploy')]);
    deployBtn.addEventListener('click', (e) => { e.stopPropagation(); this.actions.respawn(); });
    const deploy = div('deploy', [div('l', [L('dead.deployIn')]), cd, deployBtn]);
    const kia = div('kia', [div('big', [L('dead.big')]), div('sub', [L('dead.sub')]), div('ln'), div('stats', [kills.el, wave.el, score.el, streak.el])]);
    const hint = Screens.hint([keycap('SPACE'), L('hint.deploy')]);
    const s = this.frame('dead', L('frame.afterAction'), L('frame.kia'), [kia, deploy, hint]);
    s.addEventListener('click', () => { if (this.countdown <= 0) this.actions.respawn(); });
    this.dead = { kills: kills.v, wave: wave.v, score: score.v, streak: streak.v, cd, deploy };
    this.screens.set('dead', s);
  }

  private buildSettings(): void {
    const d = this.settings.data;
    const rows: HTMLElement[] = [];
    const row = (label: Label, sub: Label | null, ctl: HTMLElement) => {
      const lab = div('lab', [label]);
      if (sub) lab.append(el('small', '', undefined, [sub]));
      rows.push(div('row', [lab, ctl]));
    };
    row(L('set.lang'), null, this.langSwitch());
    row(L('set.sens'), null, slider(0.2, 3, 0.05, d.sensitivity, (v) => v.toFixed(2) + '×', (v) => this.settings.set('sensitivity', v)));
    const inv = segmented(['off', 'on'], d.invertY ? 'on' : 'off', (o) => L(o === 'on' ? 'opt.on' : 'opt.off'), (v) => this.settings.set('invertY', v === 'on'));
    row(L('set.invert'), null, inv.el);
    row(L('set.fov'), L('set.fovSub'), slider(60, 110, 1, d.fov, (v) => `${v}°`, (v) => this.settings.set('fov', v)));
    const q = segmented<QualityTier>(['low', 'medium', 'high', 'ultra'], d.quality, (o) => L(QUALITY_LABEL[o]), (v) => { if (v !== this.settings.data.quality) this.settings.applyQualityAndReload(v); });
    this.qualitySeg = q;
    row(L('set.quality'), L('set.qualitySub'), q.el);
    row(L('set.master'), null, slider(0, 1, 0.05, d.master, (v) => `${Math.round(v * 100)}%`, (v) => this.settings.set('master', v)));
    row(L('set.sfx'), null, slider(0, 1, 0.05, d.sfx, (v) => `${Math.round(v * 100)}%`, (v) => this.settings.set('sfx', v)));
    row(L('set.music'), null, slider(0, 1, 0.05, d.music, (v) => `${Math.round(v * 100)}%`, (v) => this.settings.set('music', v)));
    const backBtn = button(L('ui.back'), '', '', () => this.goBack());
    const panel = div('panel', [div('ph', [L('set.title')]), div('ps', [L('set.sub')]), div('rows', rows), div('foot', [backBtn, sp('note', L('ui.escBack'))])]);
    const s = this.frame('settings', L('frame.ops'), L('frame.settings'), [panel, Screens.hint(['ESC', L('hint.back')])]);
    this.screens.set('settings', s);
  }

  private buildControls(): void {
    const rows = CONTROLS.map(([keys, action]) => div('row', [div('lab', [L(action)]), div('ctl', [div('keys', keys.map((k) => sp('key', keycap(k))))])]));
    const backBtn = button(L('ui.back'), '', '', () => this.goBack());
    const panel = div('panel', [div('ph', [L('ctl.title')]), div('ps', [L('ctl.sub')]), div('rows', rows), div('foot', [backBtn, sp('note', L('ui.escBack'))])]);
    const s = this.frame('controls', L('frame.ops'), L('frame.controls'), [panel, Screens.hint(['ESC', L('hint.back')])]);
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

  setPauseInfo(wave: number, kills: number): void {
    this.pauseWave = wave; this.pauseKills = kills;
    setText(this.pauseSub, t('pause.sub', { n: wave, nn: pad2(wave), k: kills }));
  }

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
