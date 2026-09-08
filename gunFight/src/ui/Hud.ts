/**
 * The HUD system (implements HudApi). Owns the #ui root: the in-game HUD layer, overlays, and the
 * screens layer. Gathers a HudState snapshot once per frame from the other modules (all optional)
 * and pushes it into the components; reacts to bus events for one-shot effects.
 */
import type { Engine } from '../core/Engine';
import type { HudApi, WeaponsApi, PlayerApi, GameApi, EnemiesApi, LevelApi, AudioApi, WeaponState } from '../game/Contracts';
import { shotMode } from '../debug/ShotMode';
import { STYLES } from './styles';
import { div, freezeAnimations, unfreezeAnimations, setVar, setClass } from './dom';
import { Settings } from './Settings';
import { Screens, type ScreenName, type DeadStats } from './Screens';
import { Crosshair } from './Crosshair';
import { Hitmarker, DamageIndicators } from './Hitmarker';
import { Health } from './Health';
import { Ammo, SlotsPopup } from './Ammo';
import { Killfeed } from './Killfeed';
import { ScorePopups } from './ScorePopups';
import { Compass } from './Compass';
import { Minimap } from './Minimap';
import { WaveBanner, Message, Prompt, Objective } from './Banner';
import { yawToHeading, type HudState, type HudOverride, type HudEnemy } from './HudState';
import { animate } from './dom';
import { version } from '../../package.json';

const SCREENS: ScreenName[] = ['menu', 'pause', 'dead', 'settings', 'controls', 'none'];

export class Hud implements HudApi {
  name = 'hud';
  root = div();
  private layer = div();
  private screens: Screens;
  readonly settings: Settings;

  private crosshair = new Crosshair();
  private hitmarker = new Hitmarker();
  private dmg = new DamageIndicators();
  private health = new Health();
  private ammo = new Ammo();
  private slots = new SlotsPopup();
  private killfeed = new Killfeed();
  private popups = new ScorePopups();
  private compass = new Compass();
  private minimap = new Minimap();
  private wave = new WaveBanner();
  private message = new Message();
  private prompt = new Prompt();
  private objective = new Objective();
  private sprintFrame = div('ovl sprintf');
  private dmgFlash = div('ovl dmgflash');

  private visible = true;
  private started = false;
  private heightPx = 1080;
  private override: HudOverride | null = null;
  private frozen: number | null = null;
  private poseFrame = -1;
  private lastWall = 0;

  // per-frame state (reused, no allocations)
  private state: HudState = { t: 0, dt: 0, enemies: [], heading: 0, fovRad: 80 * Math.PI / 180, heightPx: 1080 };
  private playerBuf = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, health: 100, maxHealth: 100, alive: true, sprinting: false, aiming: false };
  private gameBuf = { wave: 1, kills: 0, score: 0, running: false, grenades: undefined as number | undefined, remaining: undefined as number | undefined, interact: undefined as string | undefined, phase: undefined as string | undefined, breatherLeft: undefined as number | undefined };
  private enemyPool: HudEnemy[] = [];

  // event bookkeeping
  private hmFrame = -1;
  private killFrame = -1;
  private pendingKill: { headshot: boolean; frame: number } | null = null;
  private localStreak = 0;
  private lastKillTime = -10;
  private bestStreak = 0;
  private switchPending = false;
  private promptDriven = false;

  constructor(private engine: Engine, container: HTMLElement) {
    const style = document.createElement('style');
    style.textContent = STYLES;
    document.head.appendChild(style);

    this.root.id = 'ui';
    if (shotMode) this.root.classList.add('shot');
    this.layer.id = 'hud';
    this.layer.append(
      this.sprintFrame, this.health.vignette, this.dmgFlash,
      this.dmg.root, this.crosshair.root, this.hitmarker.root,
      this.health.root, this.ammo.root, this.slots.root,
      this.killfeed.root, this.popups.root, this.compass.root, this.objective.root, this.minimap.root,
      this.wave.root, this.message.root, this.prompt.root,
    );

    this.settings = new Settings(engine);
    this.screens = new Screens(this.settings, {
      play: () => this.play(),
      resume: () => this.resume(),
      quit: () => this.quit(),
      respawn: () => this.respawn(),
    }, version, shotMode);
    this.settings.onChange((d) => this.screens.refreshSettings(d));

    this.root.append(this.layer, this.screens.root);
    container.appendChild(this.root);

    this.wireEvents();
    if (!shotMode) {
      document.addEventListener('pointerlockchange', () => this.onLockChange());
      document.addEventListener('pointerlockerror', () => this.onLockChange());
      this.showScreen('menu');
    }
    this.settings.apply();
  }

  // ------------------------------------------------------------------ events
  private wireEvents(): void {
    const ev = this.engine.events;
    ev.on('ui:hitmarker', (p) => { this.hmFrame = this.engine.frame; this.hitmarker.fire(p); this.crosshair.flash(this.engine.time); });
    ev.on('hit:enemy', (p) => {
      if (this.hmFrame === this.engine.frame) return; // weapons already emitted ui:hitmarker this frame
      this.hmFrame = this.engine.frame;
      this.hitmarker.fire({ headshot: p.headshot, kill: p.killed }); this.crosshair.flash(this.engine.time);
    });
    ev.on('player:damage', (p) => this.onDamage(p.from));
    ev.on('player:death', () => { if (!shotMode) this.onDeath(); });
    ev.on('enemy:death', (p) => {
      const w = this.engine.get<WeaponsApi>('weapons')?.current;
      this.killfeed.push(w ?? { kind: 'rifle', name: 'RIFLE' }, p.headshot);
      this.pendingKill = { headshot: p.headshot, frame: this.engine.frame };
    });
    ev.on('game:kill', (p) => { this.killFrame = this.engine.frame; this.popups.kill(p.headshot, p.streak); this.bestStreak = Math.max(this.bestStreak, p.streak); });
    ev.on('enemy:fire', (p) => this.minimap.enemyFired(p.enemyId, p.origin[0], p.origin[2], this.engine.time));
    ev.on('game:wave', (p) => this.wave.show(p.wave));
    ev.on('game:start', () => { this.localStreak = 0; this.bestStreak = 0; if (!shotMode) this.showScreen('none'); });
    ev.on('game:over', (p) => this.screens.setDeadStats({ kills: p.kills, wave: p.wave, score: this.engine.get<GameApi>('game')?.score ?? 0, streak: this.bestStreak }));
    ev.on('weapon:switch', () => { this.switchPending = true; });
  }

  private onDamage(from: [number, number, number]): void {
    this.dmg.hit(from, this.engine.time);
    animate(this.dmgFlash, [{ opacity: 0.9 }, { opacity: 0 }], { duration: 380, easing: 'ease-out' }, 90);
  }

  private onDeath(): void {
    const g = this.engine.get<GameApi>('game');
    this.screens.setDeadStats({ kills: g?.kills ?? 0, wave: g?.wave ?? 1, score: g?.score ?? 0, streak: this.bestStreak });
    this.showScreen('dead');
  }

  // --------------------------------------------------------------- game flow
  private play(): void {
    // Both must run synchronously inside the click gesture.
    this.engine.get<AudioApi>('audio')?.unlock();
    this.engine.input.requestLock();
    const g = this.engine.get<GameApi>('game');
    if (g) { if (g.running) g.restart(); else g.start(); }
    this.started = true;
    this.showScreen('none');
  }

  private resume(): void {
    this.engine.get<AudioApi>('audio')?.unlock();
    this.engine.input.requestLock();
    this.showScreen('none');
  }

  private quit(): void {
    this.engine.input.exitLock();
    this.started = false;
    this.showScreen('menu');
  }

  private respawn(): void {
    this.engine.get<AudioApi>('audio')?.unlock();
    this.engine.input.requestLock();
    this.engine.get<GameApi>('game')?.restart();
    this.localStreak = 0; this.bestStreak = 0;
    this.started = true;
    this.showScreen('none');
  }

  private onLockChange(): void {
    if (this.engine.input.locked) return;
    if (this.started && this.screens.current === 'none') {
      const g = this.engine.get<GameApi>('game');
      this.screens.setPauseInfo(g?.wave ?? 1, g?.kills ?? 0);
      this.showScreen('pause');
    }
  }

  // ------------------------------------------------------------------ HudApi
  setVisible(v: boolean): void {
    this.visible = v;
    this.root.style.display = v ? '' : 'none';
  }

  showMessage(text: string, ms?: number): void { this.message.show(text, ms); }

  showScreen(name: string): void {
    const n = (SCREENS.includes(name as ScreenName) ? name : 'none') as ScreenName;
    this.screens.show(n);
    setClass(this.layer, 'hidden', n !== 'none');
    if (!shotMode) {
      this.engine.input.enabled = n === 'none';
      this.engine.paused = n === 'pause';
      if (n !== 'none' && n !== 'dead' && this.engine.input.locked) this.engine.input.exitLock();
    }
  }

  showPrompt(key: string, text: string): void { this.prompt.show(key, text); }
  hidePrompt(): void { this.prompt.hide(); }

  // ------------------------------------------------------------------ frame
  resize(_w: number, h: number): void {
    this.heightPx = h;
    this.minimap.resize();
  }

  update(dt: number): void {
    const now = performance.now();
    const wall = this.lastWall ? Math.min(0.1, (now - this.lastWall) / 1000) : 0;
    this.lastWall = now;
    this.screens.update(shotMode ? 0 : wall);

    if (shotMode && this.poseFrame >= 0 && this.engine.frame - this.poseFrame > 28) this.debug.reset();
    if (!this.visible) return;

    const s = this.gather(dt);
    if (this.switchPending) {
      this.switchPending = false;
      const w = this.engine.get<WeaponsApi>('weapons');
      if (w && w.slots.length > 1) this.slots.show(w.slots, w.current);
    }
    if (this.pendingKill && this.pendingKill.frame < this.engine.frame) {
      if (this.killFrame < this.pendingKill.frame) { // game module didn't score it: local streak
        this.localStreak = s.t - this.lastKillTime < 4 ? this.localStreak + 1 : 1;
        this.lastKillTime = s.t;
        this.bestStreak = Math.max(this.bestStreak, this.localStreak);
        this.popups.kill(this.pendingKill.headshot, this.localStreak);
      }
      this.pendingKill = null;
    }

    this.crosshair.update(s);
    this.dmg.update(s);
    this.health.update(s);
    this.ammo.update(s);
    this.compass.update(s);
    this.minimap.update(s);
    let alive = 0; for (const e of s.enemies) if (e.alive) alive++;
    // The objective line is the only persistent read on wave state, so it has to change between
    // phases. A player who cleared the field and saw "ELIMINATE ALL HOSTILES · 0 REMAINING" for the
    // whole breather reasonably concluded the game was stuck.
    const ph = s.game?.phase;
    if (ph === 'breather') this.objective.set('Wave clear · next wave in', Math.max(0, Math.ceil(s.game?.breatherLeft ?? 0)), 'seconds');
    else this.objective.set('Eliminate all hostiles', s.game?.remaining ?? alive, 'remaining');
    this.objective.update(s);
    // The game module owns the interaction hint; while it publishes one, it drives the prompt and
    // showPrompt/hidePrompt stay out of the way (they still work when no game module is present).
    const interact = s.game?.interact;
    if (interact !== undefined) { this.promptDriven = true; this.prompt.setRaw(interact); }
    else if (this.promptDriven) { this.promptDriven = false; this.prompt.hide(); }
    setVar(this.sprintFrame, '--o', s.player?.sprinting && !s.player.aiming ? '1' : '0');

    if (this.frozen !== null) freezeAnimations(this.frozen);
  }

  private gather(dt: number): HudState {
    const e = this.engine, s = this.state, ov = this.override;
    s.t = e.time; s.dt = dt;
    s.heightPx = this.heightPx;
    s.fovRad = ov?.fovRad ?? e.camera.fov * Math.PI / 180;
    const weapons = e.get<WeaponsApi>('weapons');
    s.weapon = ov?.weapon ?? weapons?.current;
    s.slots = ov?.slots ?? weapons?.slots;
    const p = e.get<PlayerApi>('player');
    if (ov?.player) s.player = ov.player;
    else if (p) {
      const b = this.playerBuf;
      b.x = p.position.x; b.y = p.position.y; b.z = p.position.z; b.yaw = p.yaw; b.pitch = p.pitch;
      b.health = p.health; b.maxHealth = p.maxHealth; b.alive = p.alive; b.sprinting = p.sprinting; b.aiming = p.aiming;
      s.player = b;
    } else s.player = undefined;
    const g = e.get<GameApi>('game');
    if (ov?.game) s.game = ov.game;
    else if (g) {
      const b = this.gameBuf;
      b.wave = g.wave; b.kills = g.kills; b.score = g.score; b.running = g.running;
      b.grenades = g.grenades; b.remaining = g.enemiesRemaining; b.interact = g.interactPrompt;
      b.phase = g.phase; b.breatherLeft = g.breatherLeft;
      s.game = b;
    }
    else s.game = undefined;
    if (ov?.enemies) s.enemies = ov.enemies;
    else {
      const list = e.get<EnemiesApi>('enemies')?.list() ?? [];
      s.enemies = this.enemyPool;
      this.enemyPool.length = list.length;
      for (let i = 0; i < list.length; i++) {
        const src = list[i];
        const dst = this.enemyPool[i] ?? (this.enemyPool[i] = { id: 0, x: 0, z: 0, alive: false });
        dst.id = src.id; dst.x = src.position.x; dst.z = src.position.z; dst.alive = src.alive;
      }
    }
    s.level = ov?.level ?? e.get<LevelApi>('level');
    s.heading = ov?.heading ?? (s.player ? yawToHeading(s.player.yaw) : 0);
    return s;
  }

  // ------------------------------------------------------------------ debug
  /** Hooks for screenshot poses; fake any state without other modules. */
  readonly debug = {
    reset: (): void => {
      this.override = null; this.frozen = null; this.poseFrame = -1;
      this.minimap.setFakeMap(false);
      unfreezeAnimations();
      for (const a of document.getAnimations()) a.cancel();
      this.killfeed.root.replaceChildren(); this.popups.root.replaceChildren();
      this.prompt.hide(); this.promptDriven = false;
      this.screens.show('none'); setClass(this.layer, 'hidden', false);
    },
    stampPose: (): void => { this.poseFrame = this.engine.frame; },
    override: (o: HudOverride | null): void => { this.override = o; this.minimap.setFakeMap(!!o?.fakeMap); },
    freeze: (ms: number | null): void => { this.frozen = ms; if (ms !== null) freezeAnimations(ms); else unfreezeAnimations(); },
    hitmarker: (o: { headshot: boolean; kill: boolean }): void => { this.hitmarker.fire(o); this.crosshair.flash(this.engine.time); },
    damage: (from: [number, number, number]): void => this.onDamage(from),
    kill: (headshot: boolean, streak: number, w?: Pick<WeaponState, 'kind' | 'name'>): void => {
      this.killfeed.push(w ?? this.override?.weapon ?? { kind: 'rifle', name: 'RIFLE' }, headshot);
      this.popups.kill(headshot, streak);
    },
    wave: (n: number): void => this.wave.show(n),
    message: (t: string, ms?: number): void => this.message.show(t, ms),
    prompt: (k: string, t: string): void => this.prompt.show(k, t),
    enemyFired: (id: number, x: number, z: number): void => this.minimap.enemyFired(id, x, z, this.engine.time),
    switchPopup: (slots: WeaponState[], cur: WeaponState): void => this.slots.show(slots, cur),
    deadStats: (s: DeadStats): void => this.screens.setDeadStats(s),
    countdown: (n: number): void => this.screens.startCountdown(n),
    pauseInfo: (wave: number, kills: number): void => this.screens.setPauseInfo(wave, kills),
    screen: (n: ScreenName): void => { this.screens.show(n); setClass(this.layer, 'hidden', n !== 'none'); },
  };
}
