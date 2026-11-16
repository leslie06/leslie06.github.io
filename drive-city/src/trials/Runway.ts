import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { HudApi, PlayerApi, VehicleApi } from '../game/Contracts';
import type { AirportApi } from '../airport';
import { RUNWAYS } from './Courses';

/** 这一趟最高不到这么快（km/h）或者在跑道上开了不到这么远（米）不算成绩。 */
export const MIN_KMH = 60, MIN_DIST = 150;
/** 离开跑道：跑道两边外扩这么多米以外（开始时只外扩 START_PAD），连续 OFF_T 秒。 */
const START_PAD = 2, STAY_PAD = 14, OFF_T = 0.3;
/** 跑出过速度以后停在跑道上（不到 STILL_V 米/秒）超过 STILL_T 秒也算结束（撞停了、堵在飞机前面）。 */
const STILL_V = 2, STILL_T = 4;
const KEY = 'drivecity.runway.v1';
const COLOR = '#ffb02e';

const CSS = `
.dc-rwy{position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:30;pointer-events:none;min-width:220px;padding:8px 16px 9px;border-radius:10px;
  background:rgba(9,11,13,.66);color:#f4f1e8;font:600 13px system-ui,sans-serif;text-align:center;border-top:3px solid ${COLOR}}
.dc-rwy[hidden]{display:none}
.dc-rwy .n{font-size:12px;color:#ffd68a;letter-spacing:1px}
.dc-rwy .t{font:800 30px/1.1 ui-monospace,Menlo,monospace;letter-spacing:1px}
.dc-rwy .t small{font-size:14px;margin-left:4px;color:#cfcac0}
.dc-rwy .s{font-size:12px;color:#cfcac0}
.dc-touch .dc-rwy{top:44px;min-width:170px}.dc-touch .dc-rwy .t{font-size:22px}
`;

/** 一趟跑道极速的记分：纯逻辑，单元测试直接用。 */
export class RunwayRun {
  max = 0; dist = 0; off = 0; still = 0; t = 0;
  constructor(readonly id: string) {}
  /** 走一步：水平速度（米/秒）、还在不在这条跑道上。返回 true 表示这一趟结束了。 */
  step(dt: number, speed: number, onRunway: boolean): boolean {
    this.t += dt;
    this.dist += speed * dt;
    this.max = Math.max(this.max, speed * 3.6);
    this.off = onRunway ? 0 : this.off + dt;
    this.still = this.max > 40 && speed < STILL_V ? this.still + dt : 0;
    return this.off > OFF_T || this.still > STILL_T;
  }
  /** 够不够算成绩。 */
  get counts(): boolean { return this.max >= MIN_KMH && this.dist >= MIN_DIST; }
}

export interface RunwaySpeedApi extends System {
  readonly active: boolean;
  /** 各跑道的个人最好（km/h），按 `RUNWAYS` 的 id。 */
  readonly best: Readonly<Record<string, number>>;
  debug: { state(): { id: string; max: number; dist: number; t: number } | null; reset(): void };
}

const kmh = (v: number) => v.toFixed(1);

/**
 * 跑道极速（2026-11-16，首都机场第三批）：开着车上了三条跑道里的哪一条（`AirportApi.runwayAt`，从哪头、从侧面滑行道上去都行），
 * 这一趟就开始；离开跑道（或者跑出过速度后停住 4 秒、下车）结束，记下这一趟的最高时速。个人最好存 `drivecity.runway.v1`，
 * 发 `runway:finish`，online/Leaderboard.ts 拿去交排行榜 `rwy_<id>` 和纪录史。被通缉时照样算（本来就是闯进来的）。
 * HUD：跑着的时候屏幕上方一块，当前时速、本趟最高、最好。
 */
export function installRunway(engine: Engine): void {
  const pl = engine.get<PlayerApi>('player');
  if (!pl) return;
  let best: Record<string, number> = {};
  try { best = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Record<string, number>; } catch { /* 隐私模式 */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(best)); } catch { /* ignore */ } };

  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const panel = document.createElement('div'); panel.className = 'dc-rwy'; panel.hidden = true;
  const pName = document.createElement('div'); pName.className = 'n';
  const pSpeed = document.createElement('div'); pSpeed.className = 't';
  const pNum = document.createElement('span'), pUnit = document.createElement('small'); pUnit.textContent = 'km/h';
  pSpeed.append(pNum, pUnit);
  const pSub = document.createElement('div'); pSub.className = 's';
  panel.append(pName, pSpeed, pSub);
  document.body.appendChild(panel);

  let run: RunwayRun | null = null;
  let ref = '', speedNow = 0, cool = 0, uiT = 0;
  const toast = (s: string, sec?: number) => engine.get<HudApi>('hud')?.toast(s, sec);
  /** 房间里的联机玩法开着：不算。 */
  const roomGame = () => !!engine.get<{ name: string; active: boolean }>('play')?.active;

  const finish = () => {
    const r = run!;
    run = null; panel.hidden = true; cool = 2;
    if (!r.counts) return;
    const prev = best[r.id], isBest = prev === undefined || r.max > prev;
    if (isBest) { best[r.id] = Math.round(r.max * 10) / 10; save(); }
    toast(t('rwy.done', { rwy: ref, kmh: kmh(r.max), best: kmh(best[r.id]) }) + (isBest && prev !== undefined ? ` · ${t('rwy.newBest')}` : ''), 5);
    engine.events.emit('runway:finish', { id: r.id, kmh: r.max, best: isBest });
  };

  const api: RunwaySpeedApi = {
    name: 'runwaySpeed',
    get active() { return !!run; },
    get best() { return best; },
    debug: {
      state: () => (run ? { id: run.id, max: run.max, dist: run.dist, t: run.t } : null),
      reset: () => { best = {}; save(); },
    },
    fixedUpdate(dt) {
      cool = Math.max(0, cool - dt);
      const ap = engine.get<AirportApi>('airport');
      const v = engine.get<VehicleApi>('vehicle');
      const driving = pl.mode === 'driving' && !!v?.occupied && !pl.riding;
      if (run) {
        if (!driving || !ap) { finish(); return; }
        const car = v!.car;
        const r = car.pos.y < 6 ? ap.runwayAt(car.pos.x, car.pos.z, STAY_PAD) : null;
        speedNow = Math.hypot(car.vel.x, car.vel.z);
        if (run.step(dt, speedNow, !!r && r.ref === ref)) finish();
        return;
      }
      if (!driving || !ap || cool > 0 || roomGame()) return;
      const car = v!.car;
      if (car.pos.y > 4) return;
      const r = ap.runwayAt(car.pos.x, car.pos.z, START_PAD);
      const def = r && RUNWAYS.find((w) => w.ref === r.ref);
      if (!r || !def) return;
      run = new RunwayRun(def.id); ref = r.ref;
      pName.textContent = `${t('rwy.name')} · ${ref} · ${(r.len / 1000).toFixed(1)} km`;
      panel.hidden = false; uiT = 0;
      toast(t('rwy.go', { rwy: ref }));
      engine.events.emit('runway:start', { id: def.id });
    },
    update(dt) {
      if (!run) return;
      // 十分之一秒刷一次字
      if ((uiT -= dt) > 0) return;
      uiT = 0.1;
      pNum.textContent = String(Math.round(speedNow * 3.6));
      const b = best[run.id];
      pSub.textContent = b === undefined ? t('rwy.subNew', { max: kmh(run.max) }) : t('rwy.sub', { max: kmh(run.max), best: kmh(b) });
    },
  };
  engine.add(api);
}
