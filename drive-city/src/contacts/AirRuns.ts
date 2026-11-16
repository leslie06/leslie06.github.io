import type { Engine } from '../core/Engine';
import { lang, t, type TKey } from '../core/I18n';
import type { Actor, Blip, DialogueApi, HudApi, MissionApi, NavApi, PeopleApi, PlayerApi, RaceApi, RenderApi, Speaker, VehicleApi, WantedApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import type { Place } from '../nav/Places';
import { nearestKerb, type Kerb } from '../people/Pavement';
import { paxLook } from '../missions/Passengers';
import { Marker } from '../missions/Marker';
import { Luggage } from '../missions/Luggage';
import { pickAddress } from '../missions/Address';
import { kerbReach, placeLabel, rankPlaces } from '../missions/Dest';
import { voiceOf } from '../character/Voice';
import {
  AIRPORT_NEAR, atDepartures, CALL_FIRST, CALL_GAP, FLIGHT_PICK_MAX, FLIGHT_PICK_MIN, flightLimit, flightNo, flightPay, GAME_MIN, IN_MAX, IN_MIN,
  inboundWeights, meetDelay, meetLimit, meetPay, T3_ARR, T3_DEP,
} from '../missions/AirFares';
import type { ContactId } from '.';

/**
 * 熟人的机场活（2026-11-16，首都机场第三批，「接着做第三批」，docs/airport-design.md §7）：
 *   赶飞机  老张来电：「我一老主顾四十分钟后的飞机，我这车趴窝了」——去城里一个地方接上他，在时限内送到 T3 出发层（高架上）；
 *           值机截止就算没赶上。走机场高速还是京密路自己挑。
 *   接机    小雨来电：「我表姐坐 XX123 从深圳回来」——去 T3 到达层，航班可能晚点（等的时候目标行写「晚点 x 分钟」），
 *           落地了到达层的人行道上站着一个拖箱子的人，开到她旁边她上车，送回城里。
 * 来电和主线来电一样走对话框（接 / 不接）；接了才设导航（支线不抢导航）。也可以去老张那儿当面问「有机场的活吗？」。
 * 进城玩满 CALL_FIRST 秒、两次之间隔 CALL_GAP 秒、手上没别的事、开着四轮车、人在城里时才打。办的时候占着
 * `MissionApi.story`（出租车不拉别的客、街头事件和路人委托都等着）。没录音：台词只有字幕。
 */
export type AirKind = 'flight' | 'meet';

interface Job {
  kind: AirKind;
  phase: 'go' | 'wait' | 'find' | 'board' | 'ride';
  /** 谁打的电话（给好感度）。 */
  from: ContactId;
  /** 接人的地方（赶飞机：城里；接机：到达层的人行道），送去的地方（赶飞机：T3 出发层；接机：城里）。 */
  pick: { x: number; z: number; label: string };
  drop: { x: number; z: number; label: string; y?: number };
  /** 送的那一段的路程（米）、时限（秒）、上车以后走了多久。 */
  len: number; limit: number; clock: number;
  /** 接机：航班号、晚点几分钟（游戏分钟）、还要等几秒。 */
  flight: string; delay: number; wait: number;
  who: Actor | null; sp: Speaker; bag: number;
  /** 放箱子的秒数、下车多久了、催过几回、提醒过「出发在楼上」；还没接上人的时候过了多久。 */
  stow: number; off: number; nag: number; up: number; age: number;
}

export interface AirRunsOpts {
  /** 熟人的说话人（名字、颜色、长相）。 */
  speaker(id: ContactId): Speaker;
  addFriendship(id: ContactId, n: number): void;
  rnd(): number;
}

export class AirRuns {
  job: Job | null = null;
  private played = 0;
  private next = CALL_FIRST;
  private turn: AirKind = 'flight';
  private readonly marker: Marker;
  private readonly luggage: Luggage;
  private readonly blips: Blip[] = [];

  constructor(private readonly engine: Engine, private readonly o: AirRunsOpts) {
    this.marker = new Marker(engine.scene);
    this.luggage = new Luggage(engine.scene);
    engine.get<NavApi>('nav')?.addBlips(() => this.provideBlips());
    engine.events.on('vehicle:reset', () => { if (this.job) this.end(t('air.dropped')); });
    engine.events.on('wanted:busted', () => { if (this.job) this.end(t('air.dropped')); });
  }

  get active(): AirKind | null { return this.job?.kind ?? null; }

  private get pl() { return this.engine.get<PlayerApi>('player')!; }
  private get v() { return this.engine.get<VehicleApi>('vehicle')!; }
  private nav() { return this.engine.get<NavApi>('nav'); }
  private dlg() { return this.engine.get<DialogueApi>('dialogue'); }
  private toast(s: string, secs = 3) { this.engine.get<HudApi>('hud')?.toast(s, secs); }
  private story(s: string | null) { const m = this.engine.get<MissionApi>('missions'); if (m) m.story = s; }
  private fmt(s: number) { return `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`; }

  /** 这会儿能不能来电：手上没别的事、开着四轮车、在城里、对话框空着。 */
  private free(): boolean {
    const e = this.engine, m = e.get<MissionApi>('missions'), pl = this.pl, v = this.v;
    if (this.job || e.get<{ name: string; state: string }>('ui')?.state !== 'playing') return false;
    if (m?.busy || m?.story || e.get<RaceApi>('races')?.active || (e.get<WantedApi>('wanted')?.level ?? 0) > 0) return false;
    if (e.get<{ name: string; running: string | null }>('campaign')?.running || e.get<DialogueApi>('dialogue')?.busy) return false;
    for (const s of ['npc', 'events', 'favours', 'errands'] as const) if (e.get<{ name: string; active: unknown }>(s)?.active) return false;
    if (e.get<{ name: string; active: boolean }>('adventure')?.active) return false;
    const step = e.get<{ name: string; step: string }>('intro')?.step;
    if (step && step !== 'off' && step !== 'done') return false;
    if (pl.mode !== 'driving' || pl.riding || v.car.spec.single) return false;
    return Math.hypot(v.car.pos.x - T3_DEP.x, v.car.pos.z - T3_DEP.z) > AIRPORT_NEAR;
  }

  /** 城里一个地方：(x, z) 直线 `min`–`max` 米，`weights` 那几类，路程在 `lmin`–`lmax`；`from` 路程从哪儿量（默认就是这一点）。 */
  private placeNear(x: number, z: number, min: number, max: number, lmin: number, lmax: number, toward: boolean): { x: number; z: number; label: string; len: number } | null {
    const all = this.engine.get<{ name: string; places?: readonly Place[] }>('nav')?.places, nav = this.nav(), tr = this.engine.get<TrafficApi>('traffic');
    if (!all?.length || !nav || !tr) return null;
    const zh = lang() === 'zh', hour = this.engine.get<RenderApi>('render')?.timeOfDay ?? 15;
    for (const p of rankPlaces(all, x, z, min, max, hour, this.o.rnd, zh, 12, undefined, inboundWeights(hour))) {
      const k = nearestKerb(tr.graph, p.x, p.z, kerbReach(p), 0.8);
      if (!k) continue;
      // toward：从 (x, z) 开过去；否则从那个地方开到 (x, z)（赶飞机：从接人的地方到机场）
      const len = toward ? nav.route(x, z, NaN, k.x, k.z)?.len : nav.route(k.x, k.z, NaN, x, z)?.len;
      if (len === undefined || len < lmin || len > lmax) continue;
      return { x: k.x, z: k.z, label: placeLabel(p, zh), len };
    }
    return null;
  }

  /** 赶飞机：接人的地方（玩家附近路上 350–1600 米），从那儿到 T3 出发层多远、给多少秒。 */
  private planFlight(): Job | null {
    const car = this.v.car, nav = this.nav(), tr = this.engine.get<TrafficApi>('traffic');
    if (!nav || !tr) return null;
    let pick = this.placeNear(car.pos.x, car.pos.z, FLIGHT_PICK_MIN / 1.5, FLIGHT_PICK_MAX / 1.2, FLIGHT_PICK_MIN, FLIGHT_PICK_MAX, true);
    if (!pick) {
      const a = pickAddress(tr.graph, nav, this.o.rnd, car.pos.x, car.pos.z, FLIGHT_PICK_MIN, FLIGHT_PICK_MAX);
      if (a) pick = { ...a, len: 0 };
    }
    if (!pick) return null;
    const r = nav.route(pick.x, pick.z, NaN, T3_DEP.x, T3_DEP.z);
    if (!r || r.len < 6000) return null;
    const jam = r.links ? tr.jamSlack?.(r.links, 17) ?? 0 : 0;
    const look = paxLook('rush', this.o.rnd);
    return this.blank('flight', 'laozhang', { x: pick.x, z: pick.z, label: pick.label }, { x: T3_DEP.x, z: T3_DEP.z, y: T3_DEP.y, label: t('air.t3dep') }, r.len,
      flightLimit(r.len) + Math.round(jam), { name: t('air.flight.who'), color: '#7fb2ff', look, voice: voiceOf(look, this.o.rnd()), at: null });
  }

  /** 接机：到达层人行道上等人的地方，送回城里的哪儿（离机场 11–26 公里）。 */
  private planMeet(): Job | null {
    const tr = this.engine.get<TrafficApi>('traffic');
    if (!tr) return null;
    const k: Kerb | null = nearestKerb(tr.graph, T3_ARR.x, T3_ARR.z, 40, 0.8);
    const home = this.placeNear(T3_ARR.x, T3_ARR.z, IN_MIN, IN_MAX, IN_MIN, 45000, true);
    if (!k || !home) return null;
    const look = paxLook('normal', this.o.rnd);
    look.fem = 1; look.age = 0.3 + this.o.rnd() * 0.15;
    const j = this.blank('meet', 'xiaoyu', { x: k.x, z: k.z, label: t('air.t3arr') }, { x: home.x, z: home.z, label: home.label }, home.len, meetLimit(home.len),
      { name: t('air.meet.who'), color: '#9fd3ff', look, voice: voiceOf(look, this.o.rnd()), at: null });
    j.flight = flightNo(this.o.rnd); j.delay = meetDelay(this.o.rnd);
    return j;
  }

  private blank(kind: AirKind, from: ContactId, pick: Job['pick'], drop: Job['drop'], len: number, limit: number, sp: Speaker): Job {
    return { kind, phase: 'go', from, pick, drop, len, limit, clock: 0, flight: '', delay: 0, wait: 0, who: null, sp, bag: 1 + Math.floor(this.o.rnd() * 6), stow: 0, off: 0, nag: 0, up: 0, age: 0 };
  }

  /** 熟人来电（或者当面问老张）：先把活想好（地方、时限），说给玩家听，接了才开始。`inPerson`：当面说的，不是电话。 */
  offer(kind: AirKind = this.turn, inPerson = false): boolean {
    const j = kind === 'flight' ? this.planFlight() : this.planMeet();
    if (!j) return false;
    this.turn = kind === 'flight' ? 'meet' : 'flight';
    const who = this.o.speaker(j.from);
    const text = kind === 'flight' ? t('air.flight.call', { place: j.pick.label, min: Math.ceil(j.limit / 60) }) : t('air.meet.call', { flight: j.flight, place: j.drop.label });
    const sp = inPerson ? who : { ...who, name: t('cmp.call.who', { who: who.name }), at: null };
    this.dlg()?.ask(sp, text, [t('air.call.yes'), t('air.call.no')], (i) => {
      if (i !== 0 || this.job) { this.dlg()?.say(who, t('air.call.declined'), { prio: 2 }); return; }
      this.begin(j);
    }, { prio: 3, timeout: 20, fallback: 1 });
    return true;
  }

  /** 接下了：导航指去接人的地方（接机是到达层）。 */
  begin(j: Job): void {
    this.job = j;
    const tgt = j.pick;
    this.nav()?.setTarget({ x: tgt.x, z: tgt.z, kind: 'mission', label: j.kind === 'meet' ? t('air.meet.obj.go', { flight: j.flight }) : tgt.label });
    this.marker.show(tgt.x, tgt.z, '#3fa9ff', 0.8);
    this.engine.events.emit('airjob:taken', { kind: j.kind });
  }

  end(msg: string | null): void {
    const j = this.job;
    if (!j) return;
    if (msg) this.toast(msg, 3.5);
    if (j.who?.alive) j.who.release(j.phase === 'ride' ? 'vanish' : 'walk');
    this.job = null;
    this.story(null);
    this.nav()?.clearTarget('mission');
    this.marker.hide();
    this.played = 0; this.next = CALL_GAP;
  }

  private done(): void {
    const j = this.job!;
    const left = j.limit - j.clock, late = left < 0;
    const pay = j.kind === 'flight' ? flightPay(left) : meetPay(j.len, late);
    this.engine.get<MissionApi>('missions')?.addCash(pay);
    this.dlg()?.say(j.sp, t(j.kind === 'flight' ? 'air.flight.thanks' : 'air.meet.thanks'), { prio: 2 });
    this.toast(t(j.kind === 'flight' ? 'air.flight.paid' : 'air.meet.paid', { n: pay }), 4);
    this.o.addFriendship(j.from, 8);
    this.engine.events.emit('airjob:done', { kind: j.kind, toAirport: j.kind === 'flight', pay });
    this.engine.events.emit('job:done', { kind: j.kind });
    this.end(null);
  }

  fixedUpdate(dt: number): void {
    const ui = this.engine.get<{ name: string; state: string }>('ui')?.state;
    if (ui !== 'playing') return;
    const j = this.job;
    if (!j) {
      // 来电：只在空闲、开着车在城里时累计
      if (this.free()) { this.played += dt; if (this.played > this.next) { this.played = 0; this.next = CALL_GAP; this.offer(); } }
      return;
    }
    const pl = this.pl, car = this.v.car, driving = pl.mode === 'driving' && !car.spec.single;
    if (pl.health <= 0) { this.end(t('air.dropped')); return; }
    if ((this.engine.get<WantedApi>('wanted')?.level ?? 0) > 0 && (j.phase === 'ride' || j.phase === 'board')) {
      this.dlg()?.say(j.sp, t('air.wanted'), { prio: 2 });
      this.end(t('air.dropped'));
      return;
    }
    // 接下了却一直不去：赶飞机的那位等六分钟，接机的等半小时（去机场本来就远），人到了车不来等三分钟
    if (j.phase !== 'ride' && (j.age += dt) > (j.phase === 'find' || j.phase === 'board' ? 180 : j.kind === 'meet' ? 1800 : 360)) {
      this.end(t('air.gone'));
      return;
    }
    switch (j.phase) {
      case 'go': this.stepGo(j); break;
      case 'wait': this.stepWait(j, dt); break;
      case 'find': case 'board': this.stepBoard(j, dt, driving); break;
      case 'ride': this.stepRide(j, dt, driving); break;
    }
  }

  /** 往接人的地方开：赶飞机 70 米内那位出来招手；接机到了到达层，晚点的要等。 */
  private stepGo(j: Job): void {
    const P = this.pl.position, d = Math.hypot(P.x - j.pick.x, P.z - j.pick.z);
    this.story(j.kind === 'flight' ? t('air.flight.obj.pick', { place: j.pick.label, m: Math.round(d) }) : t('air.meet.obj.go', { flight: j.flight }));
    if (d > (j.kind === 'flight' ? 70 : 140)) return;
    if (j.kind === 'meet' && j.delay > 0) {
      j.wait = j.delay * GAME_MIN;
      j.phase = 'wait';
      this.toast(t('air.meet.delayed', { flight: j.flight, min: j.delay }), 4);
      return;
    }
    this.appear(j);
  }

  private stepWait(j: Job, dt: number): void {
    j.wait -= dt;
    this.story(t('air.meet.obj.wait', { flight: j.flight, min: j.delay, left: Math.max(1, Math.ceil(j.wait / GAME_MIN)) }));
    if (j.wait <= 0) { this.toast(t('air.meet.landed', { flight: j.flight }), 4); this.appear(j); }
  }

  /** 那位站到人行道上，朝玩家招手。 */
  private appear(j: Job): void {
    const P = this.pl.position;
    const a = this.engine.get<PeopleApi>('people')?.spawnActor?.(j.pick.x, j.pick.z, { look: j.sp.look, yaw: Math.atan2(P.x - j.pick.x, P.z - j.pick.z) }) ?? null;
    a?.act('wave');
    j.who = a;
    j.phase = 'find'; j.age = 0;
    this.marker.show(j.pick.x, j.pick.z, '#3fa9ff', 0.45);
    this.nav()?.setTarget({ x: j.pick.x, z: j.pick.z, kind: 'mission', label: j.sp.name });
    if (j.kind === 'meet') this.dlg()?.say(j.sp, t(j.delay > 0 ? 'air.meet.hello' : 'air.meet.hello0'), { prio: 2 });
  }

  /** 车停到他旁边（12 米内、停稳），他拖着箱子走到右后门，放好箱子上车。 */
  private stepBoard(j: Job, dt: number, driving: boolean): void {
    const a = j.who, car = this.v.car, P = this.pl.position;
    if (!a?.alive) {
      // 人被清掉了（镜头走远）：等玩家回来再放一个
      if (Math.hypot(P.x - j.pick.x, P.z - j.pick.z) < 90) this.appear(j);
      return;
    }
    const sx = car.pos.x - car.left.x * 1.35, sz = car.pos.z - car.left.z * 1.35;   // 右边的车门
    const near = driving && car.speed < 2.5 && (this.engine.get<WantedApi>('wanted')?.level ?? 0) === 0 && Math.hypot(car.pos.x - a.pos.x, car.pos.z - a.pos.z) < 12;
    this.story(t(!driving ? 'air.objCar' : j.kind === 'flight' ? 'air.flight.obj.board' : j.phase === 'board' ? 'air.meet.obj.board' : 'air.meet.obj.find'));
    if (j.phase === 'find') {
      a.face(P.x, P.z);
      if (near) { j.phase = 'board'; a.act(null); a.goTo(sx, sz, 1.0); j.stow = 3; }
      return;
    }
    // 上车中：车开走了就回去等
    if (!driving || car.speed > 4 || Math.hypot(car.pos.x - a.pos.x, car.pos.z - a.pos.z) > 20) { j.phase = 'find'; a.stop(); a.act('wave'); return; }
    // 车停着也会往前蹭一点：车门挪了就跟过去
    const d = Math.hypot(a.pos.x - sx, a.pos.z - sz);
    if (d > 0.9) { if (a.arrived) a.goTo(sx, sz, 1.0); return; }
    a.face(car.pos.x, car.pos.z);
    if ((j.stow -= dt) > 0) { this.story(t('air.taxi.bags')); return; }
    a.release('vanish');
    j.who = null;
    j.phase = 'ride'; j.clock = 0; j.off = 0;
    // 从这儿开过去的路线（赶飞机的时限按接人地方算好的，不再改）
    this.nav()?.setTarget({ x: j.drop.x, z: j.drop.z, kind: 'mission', label: j.drop.label });
    this.marker.show(j.drop.x, j.drop.z, '#3fa9ff', 1, j.drop.y ?? 0);
    if (j.kind === 'flight') this.dlg()?.say(j.sp, t('air.flight.board'), { prio: 1 });
  }

  private stepRide(j: Job, dt: number, driving: boolean): void {
    const car = this.v.car, left = j.limit - j.clock;
    j.clock += dt;
    this.story(t(j.kind === 'flight' ? 'air.flight.obj.ride' : 'air.meet.obj.ride', { time: this.fmt(left), place: j.drop.label }));
    // 下车四十五秒不回来：人自己走了
    j.off = driving ? 0 : j.off + dt;
    if (j.off > 45) { this.end(t('air.gone')); return; }
    if (j.kind === 'flight') {
      // 催两回：剩三分钟、剩一分钟
      if (j.nag === 0 && left < 180) { j.nag = 1; this.dlg()?.say(j.sp, t('air.flight.hurry1'), { prio: 1 }); }
      if (j.nag === 1 && left < 60) { j.nag = 2; this.dlg()?.say(j.sp, t('air.flight.hurry2'), { prio: 1 }); }
      if (left < 0) { this.dlg()?.say(j.sp, t('air.flight.missed'), { prio: 2 }); this.end(t('air.flight.fail')); return; }
      if (!driving || car.speed > 2.5) return;
      if (atDepartures(car.pos.x, car.pos.y, car.pos.z)) { this.done(); return; }
      // 停在了底下的到达层：出发在楼上
      if ((j.up -= dt) <= 0 && Math.hypot(car.pos.x - j.drop.x, car.pos.z - j.drop.z) < 120 && car.pos.y < 3) { j.up = 12; this.toast(t('air.taxi.upstairs')); }
      return;
    }
    // 接机送回家：晚了少给，晚到两倍时限她就自己走了
    if (j.clock > j.limit * 2) { this.end(t('air.gone')); return; }
    if (driving && car.speed < 2.5 && Math.hypot(car.pos.x - j.drop.x, car.pos.z - j.drop.z) < 14) this.done();
  }

  update(dt: number): void {
    this.marker.update(dt);
    this.luggage.begin();
    const a = this.job?.who;
    if (a?.alive) this.luggage.add(a.pos.x, a.pos.z, a.yaw, !a.arrived && this.job?.phase === 'board', a.pos.y, this.job!.bag);
    this.luggage.commit();
  }

  private provideBlips(): Blip[] {
    const b = this.blips, j = this.job;
    b.length = 0;
    if (!j) return b;
    if (j.phase === 'ride') b.push({ kind: 'dropoff', x: j.drop.x, z: j.drop.z, label: j.drop.label });
    else b.push({ kind: 'pickup', x: j.pick.x, z: j.pick.z, label: j.kind === 'meet' ? t('air.meet.who') : j.sp.name, flash: j.phase === 'find' || j.phase === 'board' });
    return b;
  }

  /** 探针：这会儿的状态。 */
  state(): Record<string, unknown> {
    const j = this.job;
    return j ? { kind: j.kind, phase: j.phase, pick: j.pick, drop: j.drop, len: Math.round(j.len), limit: j.limit, clock: j.clock, flight: j.flight, delay: j.delay, wait: j.wait, who: !!j.who?.alive }
      : { kind: null, played: this.played, next: this.next, free: this.free() };
  }
  /** 探针：不打电话直接接下一单（同 `offer` 选「这就去」）。 */
  start(kind: AirKind): boolean {
    const j = kind === 'flight' ? this.planFlight() : this.planMeet();
    if (!j || this.job) return false;
    this.begin(j);
    return true;
  }
  /** 探针：跳过晚点的等待。 */
  skipWait(): void { if (this.job?.phase === 'wait') this.job.wait = 0; }
  /** 探针：时限只剩 `secs` 秒（看超时）。 */
  expire(secs: number): void { if (this.job) this.job.limit = this.job.clock + secs; }
}

/** 老张面板上的那一行（contacts/index.ts 的 `talk`）。 */
export const AIR_OPT: TKey = 'con.laozhang.optAir';
