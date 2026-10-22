import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import type { Blip, NavApi, PlayerApi, RenderApi, VehicleApi } from '../game/Contracts';
import type { ParkingApi } from '../parking';
import { nearestKerb } from '../people/Pavement';
import type { TrafficApi } from '../traffic';
import { Fade } from '../campaign/Screens';
import { CupHud } from './CupHud';
import { Marker } from './Marker';
import { WaterCup } from './WaterCup';

/**
 * 送豆腐 (2026-10-22, 头文字D: 「凌晨从豆腐店出发…仪表台上放一杯水，横向 / 纵向 G 值太大水就会洒，洒光任务失败」; the
 * user: 「先做水杯和送货任务」 - in the city first, the mountain road later). At 藤原豆腐店 (亮马桥, landmarks tofushop)
 * a light stands on the apron by the AE86. Walk into it (or stop in it in an AE86): get in the AE86, the screen goes
 * dark, the clock goes to 4:30 in the morning, and the tofu is for a hotel 2-5 km away by road; a cup of water rides on
 * the dashboard (WaterCup, CupHud). Stop at the hotel before the clock runs out with water in the cup: paid by what is
 * left in it, a bonus for not a drop spilt. The cup empty, the time up, out of the car, out of the AE86, busted or
 * reset (R) and the run is off.
 *
 * Side content: it never takes the navigation until the player starts it, and it does not start while a job, a fare,
 * a race, a chapter or the police are on (missions/index.ts). The shop's AE86 is parking/'s `FIXED` car; one driven off
 * and left is put back (`ParkingApi.restock`) when the run wants it.
 */

/** The light on the apron, north of the parked AE86 (the shop's frame: (4.4, 1.5)). */
const SHOP = { x: 5610.36, z: -4486.52 };
/** Hotels round 亮马桥 (public/city/places.json, category hotel), tried in turn for one 2-5 km away by road. */
const HOTELS = [
  { zh: '北京丽都维景酒店', en: 'Beijing Lido Hotel', x: 6472, z: -7502 },
  { zh: '北京康莱德酒店', en: 'Conrad Beijing', x: 4839, z: -1890 },
  { zh: '北京东隅酒店', en: 'East Beijing Hotel', x: 7569, z: -6535 },
  { zh: '三里屯通盈中心洲际酒店', en: 'InterContinental Sanlitun', x: 4373, z: -2494 },
  { zh: '渔阳饭店', en: 'Yu Yang Hotel', x: 3756, z: -3974 },
];
const MIN_ROUTE = 2000, MAX_ROUTE = 5000;
/** The lights (the shop's, the hotel's): soy-milk beige - white glared at night (the column is additive). */
const MARK = '#d9c690';
/** Pay: a base, so much for a full cup, a bonus for barely a drop spilt (≥ 95%), and 0.3 yuan a second to spare:
 *  a good run ¥500-700 (a 外卖 job of three drops ~¥300, a chase ¥300). */
const PAY = { base: 150, water: 300, full: 150, perSec: 0.3 };

const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
type Stage = 'idle' | 'board' | 'dark' | 'drive';

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
  private last = -1;
  private markerOn = false;
  private dest: { x: number; z: number; label: string } | null = null;
  private readonly blips: Blip[] = [];
  objective: string | null = null;

  constructor(private engine: Engine, private deps: TofuDeps) {
    this.marker = new Marker(engine.scene);
    this.target = new Marker(engine.scene);
    engine.events.on('vehicle:impact', ({ strength }) => { if (this.stage === 'drive' && this.pl().mode === 'driving') this.cup.impact(strength); });
    engine.events.on('vehicle:reset', () => { if (this.stage !== 'idle') this.end(t('tofu.abort'), false); });
    engine.events.on('wanted:busted', () => { if (this.stage !== 'idle') this.end(t('tofu.busted'), false); });
  }

  get busy(): boolean { return this.stage !== 'idle'; }
  /** Probes: where it starts, its stage, the cup, the hotel; and starting it without walking in. */
  get debug() {
    return { shop: SHOP, stage: this.stage, level: this.cup.level, dest: this.dest, left: this.limit - this.t, cup: this.cup };
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

  private goDark(): void {
    this.stage = 'dark'; this.darkT = 0;
    this.fade ??= new Fade();
    this.fade.to(true);
  }

  /** In the dark: the clock to dawn, a hotel 2-5 km away by road, the cup filled; then the lights come up. */
  private setOff(): boolean {
    const r = this.engine.get<RenderApi>('render');
    if (r && !(r.timeOfDay >= 3.5 && r.timeOfDay <= 5.5)) { r.timeOfDay = 4.5; r.settle?.(); }
    const g = this.engine.get<TrafficApi>('traffic')!.graph, c = this.veh().car, n = this.nav();
    const order = HOTELS.map((h, i) => ({ h, i, k: this.deps.rnd() + (i === this.last ? 2 : 0) })).sort((a, b) => a.k - b.k);
    for (const { h, i } of order) {
      const kerb = nearestKerb(g, h.x, h.z, 300, 0.8);
      if (!kerb) continue;
      const len = n?.route(c.pos.x, c.pos.z, Math.atan2(c.fwd.x, c.fwd.z), kerb.x, kerb.z)?.len ?? Math.hypot(kerb.x - c.pos.x, kerb.z - c.pos.z) * 1.4;
      if (len < MIN_ROUTE || len > MAX_ROUTE) continue;
      this.last = i;
      const label = this.deps.lang() === 'en' ? h.en : h.zh;
      this.dest = { x: kerb.x, z: kerb.z, label };
      // a phone player in traffic averages 25-30 km/h; the clock is a pressure against the cup, not a wall
      this.t = 0; this.limit = len / 8 + 45;
      this.cup.reset(); this.offT = 0;
      n?.setTarget({ x: kerb.x, z: kerb.z, kind: 'mission', label });
      this.target.show(kerb.x, kerb.z, MARK);
      this.hud.show(true);
      this.stage = 'drive';
      this.fade!.to(false, t('tofu.dawn', { place: label }));
      return true;
    }
    return false;
  }

  private end(msg: string | null, ok: boolean): void {
    if (msg) this.deps.toast(msg);
    if (this.stage === 'dark') this.fade?.to(false);
    if (this.stage === 'drive') this.nav()?.clearTarget('mission');
    this.target.hide();
    this.stage = 'idle'; this.objective = null; this.dest = null;
    this.cooldown = ok ? 20 : 8;
    this.hudT = this.cup.level > 0 && ok ? 3 : 1.5;
  }

  fixedUpdate(dt: number, canStart: boolean): void {
    this.cooldown -= dt; this.hintT -= dt;
    const pl = this.pl(), pos = pl.position, car = this.veh().car;
    const dShop = Math.hypot(pos.x - SHOP.x, pos.z - SHOP.z);
    // the light at the shop: shown while it can start
    const ready = this.stage === 'idle' && this.cooldown <= 0 && canStart;
    if ((ready && dShop < 400) !== this.markerOn) { this.markerOn = !this.markerOn; if (this.markerOn) this.marker.show(SHOP.x, SHOP.z, MARK); else this.marker.hide(); }
    this.marker.update(dt); this.target.update(dt);
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
        if ((this.darkT += dt) > 0.8 && !this.setOff()) this.end(t('tofu.nowhere'), false);
        return;
      case 'drive': {
        this.t += dt;
        const left = this.limit - this.t;
        if (pl.mode === 'driving') { this.offT = 0; this.cup.step(dt, car.accel.x, car.accel.z); } else this.offT += dt;
        const d = this.dest!;
        this.objective = t('tofu.drive', { place: d.label, time: fmt(left), pct: Math.round(this.cup.level * 100) });
        if (this.cup.empty) this.end(t('tofu.empty'), false);
        else if (this.offT > 1.5) this.end(t('tofu.out'), false);
        else if (pl.mode === 'driving' && this.veh().look.body !== 'ae86') this.end(t('tofu.switch'), false);
        else if (left <= 0) this.end(t('tofu.late'), false);
        else if (Math.hypot(pos.x - d.x, pos.z - d.z) < 9 && car.speed < 2.5) {
          const level = this.cup.level, full = level >= 0.95;
          const pay = PAY.base + Math.round(level * PAY.water) + Math.round(left * PAY.perSec) + (full ? PAY.full : 0);
          this.deps.addCash(pay);
          if (full) this.deps.toast(t('tofu.full', { n: PAY.full }));
          this.end(t('tofu.done', { n: pay, pct: Math.round(level * 100) }), true);
        }
        return;
      }
    }
  }

  /** The cup on screen: while the run is on, and a moment after it ends. */
  update(dt: number): void {
    if (this.stage === 'drive') { this.hud.update(dt, this.cup, t('tofu.cup')); return; }
    if (this.hudT > 0) { this.hudT -= dt; this.hud.update(dt, this.cup, t('tofu.cup')); if (this.hudT <= 0) this.hud.show(false); }
  }
}
