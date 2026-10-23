import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import type { Blip, CameraApi, NavApi, PlayerApi, RenderApi, VehicleApi, WorldApi } from '../game/Contracts';
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
 * kept. The cup empty, the time up, out of the car, out of the AE86, busted or reset (R) and the run is off. It starts at
 * the shop or at the foot (`STARTS`): from the west of the city 亮马桥 is 20 km away.
 *
 * Side content: it never takes the navigation until the player starts it, and it does not start while a job, a fare,
 * a race, a chapter or the police are on (missions/index.ts). The shop's AE86 is parking/'s `FIXED` car; one driven off
 * and left is put back (`ParkingApi.restock`) when the run wants it.
 */

/** The light on the apron, north of the parked AE86 (the shop's frame: (4.4, 1.5)). */
const SHOP = { x: 5610.36, z: -4486.52 };
/** How overcast the sky over the shop's street is (render/'s `addOvercast`). */
const OVERCAST = 0.75;
/**
 * Where it starts: the shop, and (2026-10-22, 「我在西五环开车，我想去送豆腐，却要跑到亮马桥，很远」) the foot of 妙峰山, by a
 * second AE86 on 京拉路's verge (parking/'s `FIXED`): 8 m ahead of its nose (mountain.bin road 0 point 1233, 6.4 m right of
 * the centre line). `y`: the ground. Each has its light, its blip and its words.
 */
const STARTS = [
  // `car`: where the map's 快速前往 puts a car (2026-10-22, 「并没有走到这家豆腐店门口，还差了几十米」: the nearest lane was
  // the far side's, and 25 m back from it put the shop behind the trees) - southbound in the shop's own lane, level with
  // its door (shop frame x 8.6, y 1; 2026-10-23, 「还是没停到豆腐店对面门口，还有一段距离」: 13 m south it read as down the
  // street); `look`: the camera turned that far right, onto the shop, the parked AE86 and the light (a chase camera
  // looks down the street, and from the far lane looking across it backed into the houses opposite)
  { ...SHOP, y: 0, car: { x: 5614.59, z: -4486.38, yaw: 0.0836, look: -0.7 }, place: 'travel.shop', name: 'tofu.name', hint: 'tofu.hint', board: 'tofu.board', boardOut: 'tofu.boardOut' },
  { x: -19562.47, z: -2385.3, y: 34.55, car: null, place: 'travel.foot', name: 'tofu.nameFoot', hint: 'tofu.hintFoot', board: 'tofu.boardFoot', boardOut: 'tofu.boardOutFoot' },
] as const;
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
  private readonly markers: Marker[];
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
  private readonly markerOn = STARTS.map(() => false);
  /** The start in use (STARTS). */
  private from = 0;
  /** The mountain is in and the AE86 at its foot (set in the dark). */
  private placed = false;
  /** Our own teleport fires 'vehicle:reset': not the player's R. */
  private moving = false;
  /** On the way to a start (`travel`): in the dark while it loads. */
  travelling = false;
  /** Put down by `travel`: the light starts nothing until the player has been out of reach of it. */
  private disarmed = false;
  private best = 0;
  private top = { x: 0, y: 0, z: 0 };
  private foot = { x: 0, y: 0, z: 0 };
  private readonly blips: Blip[] = [];
  objective: string | null = null;

  constructor(private engine: Engine, private deps: TofuDeps) {
    this.markers = STARTS.map(() => new Marker(engine.scene));
    this.target = new Marker(engine.scene);
    // the shop's street under the photo's grey sky (2026-10-23, 「照片里那种阴天的柔光」): overcast within 100 m (the
    // street kept low, scripts/city/lowrise.mjs), clearing by 220 m
    engine.get<RenderApi>('render')?.addOvercast?.(SHOP.x, SHOP.z, 100, 220, OVERCAST);
    try { this.best = Number(localStorage.getItem(BEST_KEY) ?? 0) || 0; } catch { /* private mode */ }
    engine.events.on('vehicle:impact', ({ strength }) => { if ((this.stage === 'up' || this.stage === 'down') && this.pl().mode === 'driving') this.cup.impact(strength); });
    engine.events.on('vehicle:reset', () => { if (this.stage !== 'idle' && !this.moving) this.end(t('tofu.abort'), false); });
    engine.events.on('wanted:busted', () => { if (this.stage !== 'idle') this.end(t('tofu.busted'), false); });
  }

  get busy(): boolean { return this.stage !== 'idle'; }
  /** Probes: where it starts, its stage, the cup, where it is going, the clock; the best time down. */
  get debug() {
    const dest = this.stage === 'up' ? this.top : this.stage === 'down' ? this.foot : null;
    return { shop: SHOP, starts: STARTS.map((s) => ({ x: s.x, z: s.z })), from: this.from, stage: this.stage, level: this.cup.level, dest, left: this.limit - this.t, t: this.t, best: this.best, cup: this.cup };
  }

  private pl(): PlayerApi { return this.engine.get<PlayerApi>('player')!; }
  private veh(): VehicleApi { return this.engine.get<VehicleApi>('vehicle')!; }
  private nav(): NavApi | undefined { return this.engine.get<NavApi>('nav'); }
  private inAe86(): boolean { return this.pl().mode === 'driving' && this.veh().look.body === 'ae86'; }

  provideBlips(): Blip[] {
    this.blips.length = 0;
    if (this.stage === 'idle' && this.cooldown <= 0) for (const s of STARTS) this.blips.push({ kind: 'target', x: s.x, z: s.z, label: t(s.name) });
    return this.blips;
  }

  /** Start at the shop (the light walked into): straight off in an AE86, else get in the one out front first. */
  start(): void {
    if (this.stage !== 'idle') return;
    if (this.inAe86()) { this.goDark(); return; }
    this.stage = 'board';
    this.engine.get<ParkingApi>('parking')?.restock();
  }

  /** The starts, for the map's 快速前往. */
  get starts(): readonly { x: number; z: number; name: string }[] { return STARTS.map((s) => ({ x: s.x, z: s.z, name: t(s.place) })); }

  /**
   * Fast travel to start `i` (the map's 快速前往, 2026-10-22: 「给个入口可以直接到藤原豆腐店或者妙峰山入口」): the screen goes
   * dark while the place loads (the city's tiles there; the mountain), then the car driven stands in the lane nearest the
   * light, or the player on foot between the light and that lane. The caller checks that nothing is on (missions/index.ts).
   */
  async travel(i: number): Promise<void> {
    if (this.travelling || this.stage !== 'idle') return;
    this.travelling = true;
    const S = STARTS[i], v = this.veh(), pl = this.pl(), driving = pl.mode === 'driving';
    this.fade ??= new Fade();
    this.fade.to(true);
    let ok = false;
    try {
      // the map closes first (closing gives the wheel back), then the wheel is held through the dark
      await new Promise((r) => setTimeout(r, 0));
      v.inputEnabled = false;
      await new Promise((r) => setTimeout(r, 700));
      // the kerb's parked cars keep off the spot (their tiles may not be in yet: held for a while)
      if (S.car && driving) this.engine.get<ParkingApi>('parking')?.clearAround(S.car.x, S.car.z, 5, 60);
      if (S.y > 0) await this.engine.get<MountainApi>('mountain')?.load();
      await this.engine.get<WorldApi>('world')?.preload?.(S.x, S.z);
      const lane = v.roadPoseNear?.(S.x, S.y + 0.5, S.z);
      if (lane) {
        if (driving) {
          // the start's own spot (as it is: the lane search faces a car out of the dead end south of the shop, which put it
          // in the far lane), else 25 m back down the nearest lane, the light ahead
          const back = S.car ? { pos: { x: S.car.x, y: S.y + 0.03 + v.car.spec.wheelRadius + 0.3, z: S.car.z }, yaw: S.car.yaw }
            : v.roadPoseNear?.(lane.pos.x - Math.sin(lane.yaw) * 25, lane.pos.y, lane.pos.z - Math.cos(lane.yaw) * 25) ?? lane;
          this.moving = true;
          v.reset(back.pos, back.yaw);
          this.moving = false;
        } else {
          // on foot: 40% of the way from the light to the lane (on the apron / the verge), facing the light
          const x = S.x + (lane.pos.x - S.x) * 0.4, z = S.z + (lane.pos.z - S.z) * 0.4;
          pl.setRiding(null, { x, y: S.y + 0.3, z, yaw: Math.atan2(S.x - x, S.z - z) });
        }
        this.engine.get<CameraApi>('camera')?.snap(driving ? S.car?.look : undefined);
        this.hintT = 0;
        this.disarmed = true;
        ok = true;
      }
    } finally {
      v.inputEnabled = true;
      this.fade.to(false, ok ? t('travel.arrived', { place: t(S.place) }) : undefined);
      this.travelling = false;
    }
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
      this.foot = { x: r[0], y: r[1], z: r[2] };
      this.top = { x: d.summit.x, y: d.summit.y, z: d.summit.z };
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

  private aim(p: { x: number; y: number; z: number }, label: string): void {
    this.nav()?.setTarget({ x: p.x, z: p.z, kind: 'mission', label });
    this.target.show(p.x, p.z, MARK, 1, p.y);
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
    // the nearer start (the one in use while boarding)
    if (this.stage === 'idle') this.from = Math.hypot(pos.x - STARTS[1].x, pos.z - STARTS[1].z) < Math.hypot(pos.x - SHOP.x, pos.z - SHOP.z) ? 1 : 0;
    const S = STARTS[this.from], dShop = Math.hypot(pos.x - S.x, pos.z - S.z);
    // the lights at the starts: shown while it can start
    const ready = this.stage === 'idle' && this.cooldown <= 0 && canStart;
    STARTS.forEach((s, i) => {
      const on = ready && Math.hypot(pos.x - s.x, pos.z - s.z) < 400;
      if (on !== this.markerOn[i]) { this.markerOn[i] = on; if (on) this.markers[i].show(s.x, s.z, MARK, 1, s.y); else this.markers[i].hide(); }
      this.markers[i].update(dt);
    });
    this.target.update(dt);
    if (this.stage === 'up' || this.stage === 'down') {
      this.t += dt;
      if (pl.mode === 'driving') { this.offT = 0; this.cup.step(dt, car.accel.x, car.accel.z); } else this.offT += dt;
    }
    const pct = Math.round(this.cup.level * 100);
    switch (this.stage) {
      case 'idle':
        if (!ready) return;
        if (this.disarmed) { if (dShop > 8) this.disarmed = false; else return; }
        if (dShop < 30 && this.hintT <= 0) { this.hintT = 60; this.deps.toast(t(S.hint)); }
        if (dShop < (pl.mode === 'driving' ? 6 : 3.5) && (pl.mode !== 'driving' || car.speed < 3)) this.start();
        return;
      case 'board':
        this.objective = pl.mode === 'driving' && !this.inAe86() ? t(S.boardOut) : t(S.board);
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
