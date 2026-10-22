import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import type { Blip, CameraApi, NavApi, PlayerApi, RenderApi, VehicleApi } from '../game/Contracts';
import type { ParkingApi } from '../parking';
import type { MountainApi } from '../mountain';
import { Fade } from '../campaign/Screens';
import { CupHud } from './CupHud';
import { Marker } from './Marker';
import { WaterCup } from './WaterCup';

/**
 * 送豆腐 (2026-10-22, 头文字D: 「凌晨从豆腐店出发，跑山路送货，仪表台上放一杯水，横向 / 纵向 G 值太大水就会洒，洒光任务
 * 失败」). First in the city (a hotel 2-5 km away); since the road up 妙峰山 exists (mountain/), 「把送豆腐改成凌晨送上
 * 山顶」: at 藤原豆腐店 (亮马桥, landmarks tofushop) a light stands on the apron by the AE86. Walk into it (or stop in it
 * in an AE86): get in the AE86, the screen goes dark, the clock goes to 4:30 in the morning and the AE86 stands at the
 * foot of 妙峰山路 (the 25 km out of town are the cut, as in the film), a cup of water on the dashboard (WaterCup,
 * CupHud). Up: the tofu to the top (the turning circle past the 牌楼) on a clock, paid by the water left in the cup.
 * Then down: back to the foot against the stopwatch, the same cup, a bonus for the time and the water, the best time
 * kept. The cup empty, the time up, out of the car, out of the AE86, busted or reset (R) and the run is off.
 *
 * Side content: it never takes the navigation until the player starts it, and it does not start while a job, a fare,
 * a race, a chapter or the police are on (missions/index.ts). The shop's AE86 is parking/'s `FIXED` car; one driven off
 * and left is put back (`ParkingApi.restock`) when the run wants it.
 */

/** The light on the apron, north of the parked AE86 (the shop's frame: (4.4, 1.5)). */
const SHOP = { x: 5610.36, z: -4486.52 };
/** The lights (the shop's, the top's, the foot's): soy-milk beige - white glared at night (the column is additive). */
const MARK = '#d9c690';
/** Up: a base, so much for a full cup, a bonus for barely a drop spilt (≥ 95%). Down: per second under DOWN_PAR, and
 *  for the water still in the cup. A good run ~¥1000. */
const PAY = { base: 200, water: 300, full: 150, perSec: 2, downWater: 200 };
/** The run down's par (s): 9.5 km at ~52 km/h. The autopilot, braking hard for every bend at under 47 km/h, took 12:08. */
const DOWN_PAR = 660;
/** Within this of the top's turning circle's centre (it has a 17 m radius), stopped: delivered. Of the foot: down. */
const TOP_R = 22, FOOT_R = 14;
const BEST_KEY = 'drivecity.tofu.down';

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
const fmtT = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
type Stage = 'idle' | 'board' | 'dark' | 'up' | 'down';

export interface TofuDeps { addCash(n: number): void; toast(s: string): void; rnd(): number; lang(): 'zh' | 'en' }

export class Tofu {
  private stage: Stage = 'idle';
  private readonly marker: Marker;
  private readonly target: Marker;
  private readonly cup = new WaterCup();
  private readonly hud = new CupHud();
  private fade: Fade | null = null;
  private cooldown = 0;
  private hintT = 0;
  private darkT = 0;
  private offT = 0;
  private t = 0;
  private limit = 0;
  private hudT = 0;
  private markerOn = false;
  /** The mountain is in and the AE86 at its foot (set in the dark). */
  private placed = false;
  /** Our own teleport fires 'vehicle:reset': not the player's R. */
  private moving = false;
  private best = 0;
  private top = { x: 0, z: 0 };
  private foot = { x: 0, z: 0 };
  private readonly blips: Blip[] = [];
  objective: string | null = null;

  constructor(private engine: Engine, private deps: TofuDeps) {
    this.marker = new Marker(engine.scene);
    this.target = new Marker(engine.scene);
    try { this.best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0; } catch { /* private mode */ }
    engine.events.on('vehicle:impact', ({ strength }) => { if ((this.stage === 'up' || this.stage === 'down') && this.pl().mode === 'driving') this.cup.impact(strength); });
    engine.events.on('vehicle:reset', () => { if (this.stage !== 'idle' && !this.moving) this.end(t('tofu.abort'), false); });
    engine.events.on('wanted:busted', () => { if (this.stage !== 'idle') this.end(t('tofu.busted'), false); });
  }

  get busy(): boolean { return this.stage !== 'idle'; }
  /** Probes: where it starts, its stage, the cup, where it is going, the clock; the best time down. */
  get debug() {
    const dest = this.stage === 'up' ? this.top : this.stage === 'down' ? this.foot : null;
    return { shop: SHOP, stage: this.stage, level: this.cup.level, dest, left: this.limit - this.t, t: this.t, best: this.best, cup: this.cup };
  }

  private pl(): PlayerApi { return this.engine.get<PlayerApi>('player')!; }
  private veh(): VehicleApi { return this.engine.get<VehicleApi>('vehicle')!; }
  private nav(): NavApi | undefined { return this.engine.get<NavApi>('nav'); }
  private inAe86(): boolean { return this.pl().mode === 'driving' && this.veh().look.body === 'ae86'; }

  provideBlips(): Blip[] {
    this.blips.length = 0;
    if (this.stage === 'idle' && this.cooldown <= 0) this.blips.push({ kind: 'target', x: SHOP.x, z: SHOP.z, label: t('tofu.name') });
    return this.blips;
  }

  /** Start at the shop (the light walked into): straight off in an AE86, else get in the one out front first. */
  start(): void {
    if (this.stage !== 'idle') return;
    if (this.inAe86()) { this.goDark(); return; }
    this.stage = 'board';
    this.engine.get<ParkingApi>('parking')?.restock();
  }

  /** Dark: the mountain loaded, the clock to dawn, the AE86 at the foot of 妙峰山路 facing up; then the lights come up. */
  private goDark(): void {
    this.stage = 'dark'; this.darkT = 0; this.placed = false;
    this.fade ??= new Fade();
    this.fade.to(true);
    this.veh().inputEnabled = false;
    const m = this.engine.get<MountainApi>('mountain');
    if (!m) { this.end(t('tofu.nowhere'), false); return; }
    // the fade's 0.7 s first, then the mountain
    void new Promise((r) => setTimeout(r, 700)).then(() => m.load()).then(() => {
      const d = m.data;
      if (this.stage !== 'dark' || !d) return;
      const r = d.roads[1].p, n = d.roads[1].n;
      // a few metres up from the foot, in the right-hand lane, facing up
      const k = 4, dx = r[(k + 2) * 4] - r[k * 4], dz = r[(k + 2) * 4 + 2] - r[k * 4 + 2], L = Math.hypot(dx, dz);
      const x = r[k * 4] - (dz / L) * 1.9, z = r[k * 4 + 2] + (dx / L) * 1.9;
      this.moving = true;
      const v = this.veh();
      v.reset({ x, y: r[k * 4 + 1] + v.car.spec.wheelRadius + 0.3, z }, Math.atan2(dx, dz));
      this.moving = false;
      this.engine.get<CameraApi>('camera')?.snap();
      this.foot = { x: r[0], z: r[2] };
      this.top = { x: d.summit.x, z: d.summit.z };
      void n;
      const rd = this.engine.get<RenderApi>('render');
      if (rd && !(rd.timeOfDay >= 3.5 && rd.timeOfDay <= 5.5)) { rd.timeOfDay = 4.5; rd.settle?.(); }
      this.placed = true;
    });
  }

  /** The lights up at the foot: the climb on its clock (the road's length at ~27 km/h and a minute), the cup full. */
  private setOff(): void {
    const n = this.nav(), c = this.veh().car;
    const len = n?.route(c.pos.x, c.pos.z, Math.atan2(c.fwd.x, c.fwd.z), this.top.x, this.top.z)?.len ?? 9600;
    this.t = 0; this.limit = len / 7.5 + 60;
    this.cup.reset(); this.offT = 0;
    this.aim(this.top, t('tofu.top'));
    this.hud.show(true);
    this.stage = 'up';
    this.veh().inputEnabled = true;
    this.fade!.to(false, t('tofu.dawn'));
  }

  private aim(p: { x: number; z: number }, label: string): void {
    this.nav()?.setTarget({ x: p.x, z: p.z, kind: 'mission', label });
    this.target.show(p.x, p.z, MARK);
  }

  private end(msg: string | null, ok: boolean): void {
    if (msg) this.deps.toast(msg);
    if (this.stage === 'dark') { this.fade?.to(false); this.veh().inputEnabled = true; }
    if (this.stage === 'up' || this.stage === 'down') this.nav()?.clearTarget('mission');
    this.target.hide();
    this.stage = 'idle'; this.objective = null;
    this.cooldown = ok ? 20 : 8;
    this.hudT = this.cup.level > 0 && ok ? 3 : 1.5;
  }

  /** What ends a leg whatever it is: the cup empty, out of the car, out of the AE86. */
  private broken(): string | null {
    if (this.cup.empty) return t('tofu.empty');
    if (this.offT > 1.5) return t('tofu.out');
    if (this.pl().mode === 'driving' && this.veh().look.body !== 'ae86') return t('tofu.switch');
    return null;
  }

  fixedUpdate(dt: number, canStart: boolean): void {
    this.cooldown -= dt; this.hintT -= dt;
    const pl = this.pl(), pos = pl.position, car = this.veh().car;
    const dShop = Math.hypot(pos.x - SHOP.x, pos.z - SHOP.z);
    // the light at the shop: shown while it can start
    const ready = this.stage === 'idle' && this.cooldown <= 0 && canStart;
    if ((ready && dShop < 400) !== this.markerOn) { this.markerOn = !this.markerOn; if (this.markerOn) this.marker.show(SHOP.x, SHOP.z, MARK); else this.marker.hide(); }
    this.marker.update(dt); this.target.update(dt);
    if (this.stage === 'up' || this.stage === 'down') {
      this.t += dt;
      if (pl.mode === 'driving') { this.offT = 0; this.cup.step(dt, car.accel.x, car.accel.z); } else this.offT += dt;
    }
    const pct = Math.round(this.cup.level * 100);
    switch (this.stage) {
      case 'idle':
        if (!ready) return;
        if (dShop < 30 && this.hintT <= 0) { this.hintT = 60; this.deps.toast(t('tofu.hint')); }
        if (dShop < (pl.mode === 'driving' ? 6 : 3.5) && (pl.mode !== 'driving' || car.speed < 3)) this.start();
        return;
      case 'board':
        this.objective = pl.mode === 'driving' && !this.inAe86() ? t('tofu.boardOut') : t('tofu.board');
        if (this.inAe86()) { this.objective = null; this.goDark(); }
        else if (dShop > 80) this.end(null, false);
        return;
      case 'dark':
        this.objective = null;
        this.veh().inputEnabled = false;
        if ((this.darkT += dt) > 0.8 && this.placed) this.setOff();
        else if (this.darkT > 30) this.end(t('tofu.nowhere'), false);
        return;
      case 'up': {
        const left = this.limit - this.t;
        this.objective = t('tofu.drive', { time: fmt(left), pct });
        const why = this.broken();
        if (why) this.end(why, false);
        else if (left <= 0) this.end(t('tofu.late'), false);
        else if (Math.hypot(pos.x - this.top.x, pos.z - this.top.z) < TOP_R && car.speed < 2.5) {
          const level = this.cup.level, full = level >= 0.95;
          const pay = PAY.base + Math.round(level * PAY.water) + (full ? PAY.full : 0);
          this.deps.addCash(pay);
          if (full) this.deps.toast(t('tofu.full', { n: PAY.full }));
          this.deps.toast(t('tofu.delivered', { n: pay, pct }));
          // now down: the stopwatch from here
          this.stage = 'down'; this.t = 0;
          this.aim(this.foot, t('tofu.footLabel'));
        }
        return;
      }
      case 'down': {
        this.objective = t('tofu.down', { time: fmtT(this.t), pct, best: this.best ? t('tofu.bestIs', { time: fmtT(this.best) }) : '' });
        const why = this.broken();
        if (why) this.end(why, false);
        else if (this.t > DOWN_PAR * 2) this.end(t('tofu.slow'), false);
        else if (Math.hypot(pos.x - this.foot.x, pos.z - this.foot.z) < FOOT_R) {
          const time = this.t, level = this.cup.level;
          const pay = Math.round(Math.max(0, DOWN_PAR - time) * PAY.perSec) + Math.round(level * PAY.downWater);
          if (pay > 0) this.deps.addCash(pay);
          if (!this.best || time < this.best) {
            const had = this.best;
            this.best = time;
            try { localStorage.setItem(BEST_KEY, String(time)); } catch { /* private mode */ }
            if (had) this.deps.toast(t('tofu.record', { time: fmtT(time) }));
          }
          this.end(t('tofu.downDone', { time: fmtT(time), n: pay, pct }), true);
        }
        return;
      }
    }
  }

  /** The cup on screen: while the run is on, and a moment after it ends. */
  update(dt: number): void {
    if (this.stage === 'up' || this.stage === 'down') { this.hud.update(dt, this.cup, t('tofu.cup')); return; }
    if (this.hudT > 0) { this.hudT -= dt; this.hud.update(dt, this.cup, t('tofu.cup')); if (this.hudT <= 0) this.hud.show(false); }
  }
}
