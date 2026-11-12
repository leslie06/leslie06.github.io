import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { lang, t, type TKey } from '../core/I18n';
import { Rng } from '../core/Rng';
import { CG, groups } from '../core/Physics';
import type { Actor, Blip, CameraApi, DialogueApi, HudApi, MissionApi, NavApi, Passer, PeopleApi, PlayerApi, RaceApi, RenderApi, Speaker, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import type { StreetApi } from '../street';
import type { Place } from '../nav/Places';
import type { UiApi } from '../ui';
import { randomLook } from '../character/Body';
import { voiceOf } from '../character/Voice';
import { nearestKerb } from '../people/Pavement';
import { clearOfWorld } from '../life/Props';
import { Marker } from '../missions/Marker';
import { kerbReach, placeLabel, rankPlaces } from '../missions/Dest';
import { PhotoCard } from '../district/Panel';
import { CJK } from '../world/Textures';
import { css, el } from '../ui/theme';
import { shotMode } from '../debug/ShotMode';
import { thingsNear } from './Around';
import { compass, deliverPay, FIND_PAY, liftPay, pickFavour, reachOf, roughly, warmth, type Chances, type FavourKind } from './Way';

export type { FavourKind } from './Way';

/**
 * 路人不只一句话（2026-11-11，docs/street-level-design.md C4，「下车之后，几乎没事可做」）。
 *
 * 徒步对着路人按 F 原来只换来一句应景的话。现在：
 *   问路    头一回问一个人，他指给你看：有导航目标（地图上点的、任务的、主线的）就说它在哪个方向、多远，转过去
 *           用手指；没有目标就说身边最近的一件能做的事（`Around.ts`，和「身边」面板一个来源），并替你标到地图上。
 *           再问同一个人才是原来的闲聊。北京人指路说东南西北。
 *   小委托  路人里约八个有一个（people/ 的 `ask`）有事相求：走近了头顶有个黄色的「！」，七米内朝你招手喊一声，
 *           小地图上有标。按 F 听他说，应下来才开始（不抢导航，见 CLAUDE.md「支线内容不能自己抢导航」）：
 *             deliver  捎一袋东西到 50–240 米外一家开着门的店，走到店门口就算送到（开车去也得下车）；
 *             photo    游客要合影：他站到你旁边，镜头转到正面，闪一下，出一张能存的相片；
 *             lift     车停在 90 米内时才有：捎他去一公里上下的一个真地方（`places.json`），他跟着你上车；
 *                      车是出租车也行，这一趟路边招手的乘客先撤掉（missions/ 的 `other`）；
 *             find     他的钥匙掉在附近人行道上：目标栏说远了近了，他隔一阵朝钥匙那边指一下，捡到还给他。
 *           方案里的「推抛锚的车」没做：停着的车由车流模块拉着手刹步进，徒步的人推不动它，要动车流的核心。
 * 一次一件，不和任务、街头遭遇、街头事件、通缉、比赛同时出现；办完或回绝后 25 秒内不再有人相求。
 * 系统名 `favours`；shot mode 不装，除非 `?favours=1`；`?favours=0` 关掉。探针：`.scratch/streetlevel/favprobe.mjs`。
 */
export interface FavoursApi extends System {
  /** 正在办的委托，没有是 null。 */
  readonly active: FavourKind | null;
  debug: {
    /** 身边 `r` 米内有事相求的路人。 */
    askers(r?: number): { x: number; z: number }[];
    /** 下一个委托定成这一种（探针用）；null 恢复随机。 */
    force(kind: FavourKind | null): void;
    /** 这会儿为什么没人相求（哪几条挡着）；空的是没挡。 */
    why(): string[];
    state(): Record<string, unknown>;
  };
}

/** 走近到多少米头顶出「！」，多少米内招呼一声；最多几个「！」。 */
const MARK_R = 18, HAIL_R = 7, MARKS = 3;
/** 办完或回绝后多久没人再求。 */
const COOL = 25;
const C = { asker: '#ffd166', keeper: '#9fe08a', drop: '#3ccf72', keys: '#ffc21f' };

css(`.fav-flash{position:fixed;inset:0;background:#fff;pointer-events:none;z-index:47;opacity:0;transition:opacity .5s ease-out}.fav-flash.on{opacity:.9;transition:none}`);

function markTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 96;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#ffd166'; g.strokeStyle = '#1b1b1b'; g.lineWidth = 5;
  g.beginPath(); g.arc(48, 44, 36, 0, Math.PI * 2); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(38, 76); g.lineTo(48, 94); g.lineTo(58, 76); g.closePath(); g.fill(); g.stroke();
  g.fillStyle = '#1b1b1b'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold 60px ${CJK}`;
  g.fillText('!', 48, 46);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function keysTexture(): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 64;
  const g = cv.getContext('2d')!;
  g.strokeStyle = '#c0392b'; g.lineWidth = 4; g.beginPath(); g.arc(20, 22, 12, 0, Math.PI * 2); g.stroke();   // 红绳
  g.strokeStyle = '#e8d27a'; g.lineWidth = 6; g.lineCap = 'round';
  for (const [x, y] of [[50, 30], [44, 48], [56, 44]]) { g.beginPath(); g.moveTo(26, 28); g.lineTo(x, y); g.stroke(); }
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

interface Job {
  kind: FavourKind;
  who: Actor | null;
  phase: string; t: number; clock: number;
  /** 去哪：店门口、乘客要去的地方、钥匙掉的地方。 */
  x: number; z: number; label: string;
  /** 路程（捎东西是直线，搭车是路上的），报酬按它算。 */
  len: number;
  /** 说好的报酬。 */
  pay: number;
  /** 搭车：按时到的时限；找钥匙：下一次指的时间。 */
  limit: number;
  said: boolean;
  /** 搭车的人上车以后说话用的（人已经不在街上了）。 */
  sp: Speaker;
}

export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search);
  if ((shotMode && q.get('favours') !== '1') || q.get('favours') === '0') return;
  const tr = engine.get<TrafficApi>('traffic'), pl = engine.get<PlayerApi>('player'), people = engine.get<PeopleApi>('people');
  if (!tr || !pl || !people?.passersNear || !people.spawnActor) return;
  const g = tr.graph;
  const rng = new Rng(8118), rnd = () => rng.next();
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];

  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const missions = () => engine.get<MissionApi>('missions');
  const dlg = () => engine.get<DialogueApi>('dialogue');
  const nav = () => engine.get<NavApi>('nav');
  const wantedLevel = () => engine.get<WantedApi>('wanted')?.level ?? 0;
  const toast = (s: string, secs?: number) => engine.get<HudApi>('hud')?.toast(s, secs);
  const story = (s: string | null) => { const m = missions(); if (m) m.story = s; };
  const pay = (n: number) => { missions()?.addCash(n); toast(t('npc.favPaid', { n }), 2.6); };
  const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  const speaker = (a: Actor, inCar = false): Speaker => ({ name: t('npc.who.passer'), color: C.asker, look: a.look, voice: a.voice, at: inCar ? null : a.pos });
  const dirWord = (dx: number, dz: number) => t(`npc.way.name.${compass(dx, dz)}` as TKey);
  const farWord = (d: number) => { const r = roughly(d); return t(r.km ? 'npc.way.name.km' : 'npc.way.name.m', { n: r.n }); };

  /** 这会儿能不能开始一件委托：和街头遭遇（npc/ 的 `free`）一个规矩，再加上主线章节和柜台。 */
  const free = (): boolean => {
    if (engine.get<UiApi>('ui')?.state !== 'playing') return false;
    const v = vehicle(), m = missions(), intro = engine.get<{ name: string; step?: string }>('intro')?.step;
    return v.inputEnabled && !v.autopilot && !pl.riding && pl.health > 0 && wantedLevel() === 0 && !engine.get<RaceApi>('races')?.active
      && !m?.busy && !m?.story && (intro === undefined || intro === 'off' || intro === 'done')
      && !engine.get<{ name: string; active: unknown }>('npc')?.active && !engine.get<{ name: string; active: unknown }>('events')?.active
      && !engine.get<{ name: string; running?: boolean }>('campaign')?.running && !dlg()?.busy
      && !engine.get<{ name: string; busy?: boolean }>('district')?.busy && !engine.get<StreetApi>('street')?.busy
      && !engine.get<{ name: string; open?: boolean }>('garage')?.open;
  };

  // ---------------------------------------------------------------- state

  let job: Job | null = null, cool = 8, last: FavourKind | null = null, forced: FavourKind | null = null, done = 0;
  let cast: Actor[] = [];
  const later: { t: number; fn: () => void }[] = [];
  const after = (secs: number, fn: () => void) => later.push({ t: secs, fn });
  const marker = new Marker(engine.scene);
  const keys = new THREE.Sprite(new THREE.SpriteMaterial({ map: keysTexture(), depthWrite: false, fog: false }));
  keys.scale.setScalar(0.34); keys.visible = false; keys.name = 'favour-keys'; engine.scene.add(keys);
  const markMat = new THREE.SpriteMaterial({ map: markTexture(), depthWrite: false, fog: false });
  const marks: THREE.Sprite[] = [];
  for (let i = 0; i < MARKS; i++) { const s = new THREE.Sprite(markMat); s.scale.setScalar(0.5); s.visible = false; s.name = 'favour-mark'; s.renderOrder = 3; engine.scene.add(s); marks.push(s); }
  const flash = el('div', 'fav-flash', document.body);
  const card = new PhotoCard(engine);

  const setPhase = (p: string) => { if (job) { job.phase = p; job.t = 0; } };
  const letGo = (a: Actor, how: 'walk' | 'flee' | 'vanish') => { if (a.alive) a.release(how); cast = cast.filter((x) => x !== a); };
  const end = (msg?: string | null) => {
    if (msg) toast(msg, 2.6);
    if (photo) endPhoto();
    for (const a of cast) if (a.alive) a.release('walk');
    cast = [];
    if (job) { story(null); nav()?.clearTarget('mission'); }
    job = null;
    marker.hide(); keys.visible = false;
    cool = COOL;
  };
  const finish = (kind: FavourKind) => {
    done++; last = kind;
    engine.events.emit('favour:done', { kind });
  };

  // ---------------------------------------------------------------- 问路

  const tellWay = (p: Passer): void => {
    const P = pl.position, n = nav(), tg = n?.target ?? null;
    let text: string, fx = P.x, fz = P.z, point = false;
    const say = (name: string, x: number, z: number, near: boolean) => {
      const dx = x - p.pos.x, dz = z - p.pos.z, d = Math.hypot(dx, dz), reach = reachOf(d);
      if (reach === 'here') return t('npc.way.here', { place: name });
      fx = x; fz = z; point = true;
      // 远的按路上的里程说（绕路的地方直线差得多）
      const len = reach === 'drive' ? n?.route(P.x, P.z, Math.atan2(dx, dz), x, z)?.len ?? d * 1.3 : d;
      if (reach === 'walk') return near ? t('npc.way.near', { dir: dirWord(dx, dz), d: farWord(d), what: name }) : t('npc.way.walk', { place: name, dir: dirWord(dx, dz), d: farWord(d) });
      return t('npc.way.drive', { place: name, dir: dirWord(dx, dz), d: farWord(len) });
    };
    if (tg) text = say(tg.label || t('npc.way.name.it'), tg.x, tg.z, false);
    else {
      const th = thingsNear(engine, P).find((x) => x.d > 40);
      if (th) {
        text = say(th.name, th.x, th.z, true);
        if (point) { n?.setTarget({ x: th.x, z: th.z, kind: 'waypoint', label: th.name }); toast(t('npc.way.hintMarked', { name: th.name }), 2.6); }
      } else text = t('npc.way.none');
    }
    p.hold(3.8, fx, fz, point ? 'point' : 'talk');
    p.say(text, 4.4, t('npc.who.passer'));
    engine.events.emit('favour:way', { target: !!tg });
  };

  // ---------------------------------------------------------------- 委托：挑哪一种

  const places = () => engine.get<{ name: string; places?: readonly Place[] }>('nav')?.places;
  /** 捎东西送去的店：离这个人 50–240 米、开着门的一家，远近随机。 */
  const shopFor = (x: number, z: number) => {
    const fr = (engine.get<StreetApi>('street')?.fronts(x, z, 240) ?? []).filter((s) => s.d >= 50);
    return fr.length ? pick(fr) : null;
  };
  /** 搭车去哪：玩家的车停在身边时，从 `places.json` 里挑一个路上 500–1800 米的真地方（和出租车乘客一个挑法）。 */
  const liftFor = (): { x: number; z: number; label: string; len: number } | null => {
    const v = vehicle(), car = v.car, P = pl.position, all = places(), n = nav();
    if (pl.mode !== 'onfoot' || car.spec.single || !all || !n) return null;
    if (Math.hypot(car.pos.x - P.x, car.pos.z - P.z) > 90 || car.up.y < 0.7) return null;
    const hour = engine.get<RenderApi>('render')?.timeOfDay ?? 15, zh = lang() === 'zh';
    for (const p of rankPlaces(all, car.pos.x, car.pos.z, 350, 1300, hour, rnd, zh, 8)) {
      const k = nearestKerb(g, p.x, p.z, kerbReach(p), 0.8);
      if (!k) continue;
      const len = n.route(car.pos.x, car.pos.z, Math.atan2(car.fwd.x, car.fwd.z), k.x, k.z)?.len;
      if (len === undefined || len < 500 || len > 1800) continue;
      return { x: k.x, z: k.z, label: placeLabel(p, zh), len };
    }
    return null;
  };
  /** 钥匙掉在哪：离这个人 14–38 米的一块人行道，不在树坑、灯杆、摊子里，也不在玩家脚边。 */
  const dropFor = (x: number, z: number): { x: number; z: number } | null => {
    const P = pl.position;
    for (let k = 0; k < 16; k++) {
      const a = rnd() * Math.PI * 2, d = 16 + rnd() * 20;
      const kb = nearestKerb(g, x + Math.sin(a) * d, z + Math.cos(a) * d, 10, 1.3);
      if (!kb) continue;
      const dk = Math.hypot(kb.x - x, kb.z - z);
      if (dk < 14 || dk > 38 || Math.hypot(kb.x - P.x, kb.z - P.z) < 12) continue;
      if (!clearOfWorld(engine.physics, kb.x, kb.z, 0, 0.35, 0.35)) continue;
      return { x: kb.x, z: kb.z };
    }
    return null;
  };
  const sightNear = (x: number, z: number): boolean => {
    const ck = engine.get<{ name: string; sites?: readonly { x: number; z: number }[] }>('checkin');
    return !!ck?.sites?.some((s) => Math.hypot(s.x - x, s.z - z) < 350);
  };

  // ---------------------------------------------------------------- 委托：开口

  const offer = (p: Passer): boolean => {
    const foot = pl.foot;
    if (!foot) return false;
    const x = p.pos.x, z = p.pos.z;
    const shop = shopFor(x, z), lift = liftFor(), drop = dropFor(x, z);
    const chances: Chances = { shop: !!shop, car: !!lift, sight: sightNear(x, z), ground: !!drop };
    const can: Record<FavourKind, boolean> = { deliver: chances.shop, lift: chances.car, find: chances.ground, photo: true };
    const kind = forced && can[forced] ? forced : pickFavour(chances, rnd, last);
    if (!kind) return false;
    p.ask = false;
    const a = p.take();
    if (!a) return false;
    cast = [a];
    a.face(foot.pos.x, foot.pos.z); a.act('talk');
    const sp = speaker(a);
    const j: Job = { kind, who: a, phase: 'ask', t: 0, clock: 0, x: 0, z: 0, label: '', len: 0, pay: 0, limit: 0, said: false, sp: speaker(a, true) };
    let text: string;
    if (kind === 'deliver') {
      j.x = shop!.x; j.z = shop!.z; j.label = shop!.name; j.len = shop!.d; j.pay = deliverPay(shop!.d);
      text = t('npc.fav.deliver.ask', { shop: shop!.name, dir: dirWord(shop!.x - x, shop!.z - z), d: farWord(shop!.d) });
    } else if (kind === 'lift') {
      j.x = lift!.x; j.z = lift!.z; j.label = lift!.label; j.len = lift!.len; j.pay = liftPay(lift!.len);
      text = t('npc.fav.lift.ask', { place: lift!.label, n: j.pay });
    } else if (kind === 'find') {
      j.x = drop!.x; j.z = drop!.z; j.pay = FIND_PAY;
      text = t('npc.fav.find.ask');
    } else text = t('npc.fav.photo.ask');
    job = j;
    dlg()?.ask(sp, text, [t(`npc.fav.${kind}.optYes` as TKey), t(`npc.fav.${kind}.optNo` as TKey)], (i) => {
      if (job !== j || j.phase !== 'ask') return;
      const yes = i === 0 && a.alive;
      engine.events.emit('favour:asked', { kind, taken: yes });
      if (yes) accept(j, a, sp); else decline(j);
    }, { prio: 2, timeout: 14, fallback: 1 });
    return true;
  };
  /** 回绝了（或者没理他）：他说一句，过两秒接着走他的路。 */
  const decline = (j: Job): void => {
    const a = j.who;
    job = null; cast = []; cool = COOL;
    if (!a?.alive) return;
    a.act(null); a.say(t(pick(['npc.fav.no1', 'npc.fav.no2'] as const)), 2.6, t('npc.who.passer'));
    after(2.2, () => { if (a.alive) a.release('walk'); });
  };

  const accept = (j: Job, a: Actor, sp: Speaker): void => {
    j.clock = 0;
    if (j.kind === 'deliver') {
      dlg()?.say(sp, t('npc.fav.deliver.thanks'), { prio: 2 });
      toast(t('npc.fav.hintGot'), 2.2);
      a.act('wave');
      after(3.5, () => letGo(a, 'walk'));
      j.who = null;
      nav()?.setTarget({ x: j.x, z: j.z, kind: 'mission', label: j.label });
      marker.show(j.x, j.z, C.drop, 0.45);
      setPhase('carry');
    } else if (j.kind === 'lift') {
      dlg()?.say(sp, t('npc.fav.lift.thanks'), { prio: 2 });
      a.act(null);
      setPhase('tocar');
    } else if (j.kind === 'find') {
      dlg()?.say(sp, t('npc.fav.find.thanks'), { prio: 2 });
      a.act(null);
      keys.position.set(j.x, 0.16, j.z); keys.visible = true;
      j.limit = 9;
      setPhase('search');
    } else {
      a.act(null);
      setPhase('gather');
    }
  };

  // ---------------------------------------------------------------- 委托：一步一步

  const stepDeliver = (j: Job): void => {
    const foot = pl.foot, P = pl.position, d = Math.hypot(j.x - P.x, j.z - P.z);
    story(foot || d > 18 ? t('npc.obj.fav.deliver', { shop: j.label, m: Math.round(d) }) : t('npc.obj.fav.deliverCar', { shop: j.label }));
    if (foot && d < 3.2) {
      const look = randomLook(rnd);
      dlg()?.say({ name: t('npc.who.keeper'), color: C.keeper, look, voice: voiceOf(look, rnd()), at: { x: j.x, z: j.z } }, t('npc.fav.deliver.done'), { prio: 2 });
      pay(j.pay);
      finish('deliver'); end(null);
    } else if (j.clock > 300 || d > 700) end(t('npc.fav.hintLate'));
  };

  let offCar = 0;
  const stepLift = (j: Job, dt: number): void => {
    const v = vehicle(), car = v.car, a = j.who;
    if (j.phase === 'tocar') {
      story(t('npc.obj.fav.lift0', { place: j.label }));
      if (!a?.alive) { end(null); return; }
      const sx = car.pos.x - car.left.x * 1.35, sz = car.pos.z - car.left.z * 1.35;   // 右边的车门
      const d = Math.hypot(a.pos.x - sx, a.pos.z - sz);
      if (j.t % 0.5 < dt && d > 0.6) a.goTo(sx, sz, d > 12 ? 2.6 : 1.6);
      if (a.arrived) a.face(car.pos.x, car.pos.z);
      if (pl.mode === 'driving' && d < 9 && car.speed < 2.5) {
        letGo(a, 'vanish'); j.who = null;
        const r = nav()?.route(car.pos.x, car.pos.z, Math.atan2(car.fwd.x, car.fwd.z), j.x, j.z), len = r?.len ?? j.len;
        j.limit = len / 7 + 50 + (r?.links ? tr.jamSlack?.(r.links, 7) ?? 0 : 0); j.clock = 0; offCar = 0;   // 守规矩开、等一两个红灯也来得及
        nav()?.setTarget({ x: j.x, z: j.z, kind: 'mission', label: j.label });
        marker.show(j.x, j.z, C.drop);
        setPhase('ride');
        return;
      }
      // 等不来（一分半没上车），或者车开走了
      if (j.clock > 90 || d > 150) {
        a.act(null); a.say(t('npc.fav.lift.gone'), 2.6, t('npc.who.passer'));
        end(null);
      }
      return;
    }
    const sp = j.sp;
    story(t('npc.obj.fav.lift', { place: j.label, time: fmt(j.limit - j.clock) }));
    if (!j.said && j.t > 7) { j.said = true; dlg()?.say(sp, t('npc.fav.lift.ride'), { prio: 1 }); }
    if (wantedLevel() > 0) { dlg()?.say(sp, t('npc.fav.lift.scared'), { prio: 2 }); end(t('npc.fav.hintLate')); return; }
    // 下了车四十五秒不回来，或者八分钟还没到：他自己走了
    offCar = pl.mode === 'driving' ? 0 : offCar + dt;
    if (offCar > 45 || j.clock > 480) { end(t('npc.fav.hintLate')); return; }
    if (pl.mode === 'driving' && Math.hypot(j.x - car.pos.x, j.z - car.pos.z) < 14 && car.speed < 2.5) {
      dlg()?.say(sp, t('npc.fav.lift.done'), { prio: 2 });
      pay(j.pay + (j.clock <= j.limit ? 20 : 0));
      finish('lift'); end(null);
    }
  };

  const stepFind = (j: Job, dt: number): void => {
    const a = j.who, foot = pl.foot, P = pl.position;
    if (!a?.alive) { end(null); return; }
    if (j.phase === 'search') {
      const d = Math.hypot(j.x - P.x, j.z - P.z), w = warmth(d);
      story(t(`npc.obj.fav.find${w}` as TKey));
      if (w === 3) marker.show(j.x, j.z, C.keys, 0.22); else marker.hide();
      if (foot && d < 1.8) pl.offer?.({ x: j.x, z: j.z, r: 1.8, label: t('npc.fav.pick.talk'), kind: 'favour', use: () => {
        if (job !== j || j.phase !== 'search') return;
        keys.visible = false; marker.hide();
        toast(t('npc.fav.hintKeys'), 2.2);
        a.act('wave'); a.face(P.x, P.z);
        marker.show(a.pos.x, a.pos.z, C.asker, 0.4);
        setPhase('back');
      } });
      // 隔一阵朝钥匙那边指一下
      j.limit -= dt;
      if (j.limit <= 0) {
        j.limit = 16;
        a.face(j.x, j.z); a.act('point'); a.say(t('npc.fav.find.point'), 3, t('npc.who.passer'));
        after(2.6, () => { if (job === j && j.phase === 'search' && a.alive) a.act(null); });
      }
      if (j.clock > 200 || Math.hypot(a.pos.x - P.x, a.pos.z - P.z) > 160) { a.act(null); a.say(t('npc.fav.find.gone'), 2.8, t('npc.who.passer')); end(t('npc.fav.hintLate')); }
      return;
    }
    // 还回去
    const d = Math.hypot(a.pos.x - P.x, a.pos.z - P.z);
    story(t('npc.obj.fav.findBack'));
    a.face(P.x, P.z);
    const give = () => {
      if (job !== j || j.phase !== 'back') return;
      a.act('talk');
      dlg()?.say(speaker(a), t('npc.fav.find.done'), { prio: 2 });
      pay(j.pay);
      finish('find'); end(null);
    };
    if (foot && d < 2.6) pl.offer?.({ x: a.pos.x, z: a.pos.z, r: 2.6, label: t('npc.fav.give.talk'), kind: 'favour', use: give });
    if (j.clock > 320 || d > 200) end(t('npc.fav.hintLate'));
  };

  // --- 合影：他站到旁边，镜头转到两人正面，闪一下，出相片 ---
  let photo: { cx: number; cz: number; mx: number; mz: number; shot: boolean; shown: boolean; back: { x: number; y: number; z: number; yaw: number } } | null = null;
  const camApi = () => engine.get<CameraApi>('camera');
  const wallGroups = groups(CG.PED, CG.WORLD);
  /** 往哪边摆镜头：先朝马路那边（背景是店面），那边 4 米内有墙就换别的方向。 */
  const cameraDir = (x: number, y: number, z: number): { x: number; z: number } => {
    let rx = 0, rz = 1;
    let bd = 40;
    for (const id of g.near(x, z, 40)) { const l = g.links[id], pr = g.nearestOn(l, x, z); if (pr.d < bd) { bd = pr.d; const o = { x: 0, z: 0, dx: 0, dz: 0 }; g.at(l, pr.s, 0, o); rx = o.x - x; rz = o.z - z; } }
    const L = Math.hypot(rx, rz) || 1; rx /= L; rz /= L;
    for (const a of [0, 0.6, -0.6, 1.2, -1.2, 1.9, -1.9, Math.PI]) {
      const dx = rx * Math.cos(a) - rz * Math.sin(a), dz = rx * Math.sin(a) + rz * Math.cos(a);
      if (!engine.physics.raycast({ x, y: y + 1.3, z }, { x: dx, y: 0, z: dz }, 4.2, wallGroups, true)) return { x: dx, z: dz };
    }
    return { x: rx, z: rz };
  };
  const snap = () => {
    const orig = engine.renderFrame;
    engine.renderFrame = (dt: number) => {
      orig(dt);
      engine.renderFrame = orig;
      const src = engine.renderer.domElement, c2 = card.canvas.getContext('2d');
      if (!c2 || !src.width) return;
      const h = src.height * 0.9, w = h * card.canvas.width / card.canvas.height;
      try { c2.drawImage(src, (src.width - w) / 2, src.height * 0.05, w, h, 0, 0, card.canvas.width, card.canvas.height); } catch { /* 画布读不了：卡片留着底色 */ }
    };
  };
  const endPhoto = () => {
    const ph = photo;
    if (!ph) return;
    photo = null;
    const ca = camApi();
    if (ca) ca.override = null;
    pl.setPose?.(null);
    if (pl.riding) pl.setRiding(null, ph.back);
    ca?.snap();
  };
  const stepPhoto = (j: Job): void => {
    const a = j.who, foot = pl.foot;
    if (!a?.alive) { end(null); return; }
    story(t('npc.obj.fav.photo'));
    if (j.phase === 'gather') {
      if (!foot) { end(null); return; }
      // 他走到玩家右手边站好
      if (!photo) {
        const d = cameraDir(foot.pos.x, foot.pos.y, foot.pos.z);
        const sx = foot.pos.x + d.z * 0.72, sz = foot.pos.z - d.x * 0.72;
        a.goTo(sx, sz, 1.5);
        photo = { cx: foot.pos.x + d.z * 0.36 + d.x * 3.2, cz: foot.pos.z - d.x * 0.36 + d.z * 3.2, mx: foot.pos.x + d.z * 0.36, mz: foot.pos.z - d.x * 0.36, shot: false, shown: false,
          back: { x: foot.pos.x, y: foot.pos.y + 0.15, z: foot.pos.z, yaw: Math.atan2(d.x, d.z) } };
      }
      if ((a.arrived && j.t > 0.3) || j.t > 2.5) {
        const ph = photo!;
        a.face(ph.cx, ph.cz); a.act('cheer');
        pl.setRiding({ pos: new THREE.Vector3(ph.back.x, foot.pos.y, ph.back.z), yaw: ph.back.yaw });
        pl.setPose?.('wave', 0);
        const ca = camApi(), y = foot.pos.y;
        if (ca) ca.override = (cm) => { cm.position.set(ph.cx, y + 1.5, ph.cz); cm.lookAt(ph.mx, y + 1.12, ph.mz); cm.fov = 40; cm.updateProjectionMatrix(); };
        dlg()?.say(speaker(a), t('npc.fav.photo.pose'), { prio: 2, secs: 1.6 });
        toast(t('npc.fav.hintSmile'), 1.6);
        setPhase('pose');
      }
      return;
    }
    if (j.phase === 'pose') {
      const ph = photo;
      if (!ph) { end(null); return; }
      if (!ph.shot && j.t > 1.7) {
        ph.shot = true;
        flash.classList.add('on');
        requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.remove('on')));
        engine.events.emit('favour:photo', {});
        snap();
      }
      if (ph.shot && !ph.shown && j.t > 2.3) {
        ph.shown = true;
        const where = engine.get<WorldApi>('world')?.placeName?.(ph.mx, ph.mz) || t('npc.who.passer');
        const closed = () => {
          endPhoto();
          if (job !== j || !a.alive) return;
          a.act('talk'); a.face(pl.position.x, pl.position.z);
          dlg()?.say(speaker(a), t('npc.fav.photo.done'), { prio: 2 });
          toast(t('npc.fav.hintDone'), 2.4);
          finish('photo');
          after(3.2, () => letGo(a, 'walk'));
          cast = []; j.who = null;
          setPhase('bye');
        };
        if (!card.present(closed, { title: t('npc.fav.name.photo'), where, file: 'bcity-street' })) closed();
      }
      return;
    }
    if (j.phase === 'bye' && j.t > 1) end(null);
  };

  // ---------------------------------------------------------------- 路人头顶的「！」、招呼、地图上的标

  const near: Passer[] = [], askers: Passer[] = [];
  let hailT = 3, bob = 0;
  const showMarks = (dt: number): void => {
    askers.length = 0;
    const foot = pl.foot;
    if (foot && !job && cool <= 0 && free()) {
      people.passersNear!(foot.pos.x, foot.pos.z, MARK_R, near);
      for (const p of near) if (p.ask) askers.push(p);
      askers.sort((a, b) => a.pos.distanceToSquared(foot.pos) - b.pos.distanceToSquared(foot.pos));
      // 最近的那个走到七米内：朝玩家招手，喊一声
      hailT -= dt;
      const p = askers[0];
      if (p && hailT <= 0 && !(p.note & 1) && p.pos.distanceTo(foot.pos) < HAIL_R) {
        p.note |= 1; hailT = 6;
        p.hold(2.6, foot.pos.x, foot.pos.z, 'wave');
        p.say(t(pick(['npc.fav.hail1', 'npc.fav.hail2', 'npc.fav.hail3'] as const)), 2.6, t('npc.who.passer'));
      }
    }
    bob += dt;
    const n = Math.min(askers.length, engine.lite ? 1 : MARKS);
    for (let i = 0; i < marks.length; i++) {
      const s = marks[i];
      s.visible = i < n;
      if (i < n) s.position.set(askers[i].pos.x, askers[i].pos.y + 2.12 + Math.sin(bob * 3 + i) * 0.05, askers[i].pos.z);
    }
  };

  people.talk = {
    label(p) {
      if (!pl.foot) return null;
      if (p.ask && !job && cool <= 0 && free()) return t('npc.fav.talk');
      return !(p.note & 2) && wantedLevel() === 0 ? t('npc.way.talk') : null;
    },
    use(p) {
      if (!pl.foot) return false;
      if (p.ask && !job && cool <= 0 && free() && offer(p)) return true;
      if (wantedLevel() > 0 || (p.note & 2)) return false;   // 通缉时还是那句「我什么都没看见」；问过路的再问是闲聊
      p.note |= 2;
      tellWay(p);
      return true;
    },
  };

  const blips: Blip[] = [];
  nav()?.addBlips(() => {
    blips.length = 0;
    for (const p of askers) blips.push({ kind: 'encounter', x: p.pos.x, z: p.pos.z });
    if (job?.kind === 'deliver' && job.phase === 'carry') blips.push({ kind: 'dropoff', x: job.x, z: job.z, label: job.label, flash: true });
    if (job?.kind === 'lift' && job.phase === 'ride') blips.push({ kind: 'dropoff', x: job.x, z: job.z, label: job.label });
    if (job?.kind === 'lift' && job.phase === 'tocar') { const c = vehicle().car; blips.push({ kind: 'target', x: c.pos.x, z: c.pos.z }); }
    if (job?.kind === 'find' && job.phase === 'back' && job.who?.alive) blips.push({ kind: 'encounter', x: job.who.pos.x, z: job.who.pos.z, flash: true });
    return blips;
  });

  engine.events.on('vehicle:reset', () => { if (job) end(null); });
  engine.events.on('wanted:busted', () => { if (job) end(null); });

  const api: FavoursApi = {
    name: 'favours',
    get active() { return job && job.phase !== 'ask' ? job.kind : null; },
    debug: {
      askers: (r = 60) => { const P = pl.position, out: Passer[] = []; return people.passersNear!(P.x, P.z, r, out).filter((p) => p.ask).map((p) => ({ x: p.pos.x, z: p.pos.z })); },
      force: (kind) => { forced = kind; cool = 0; },
      why: () => {
        const v = vehicle(), m = missions(), intro = engine.get<{ name: string; step?: string }>('intro')?.step, out: string[] = [];
        if (engine.get<UiApi>('ui')?.state !== 'playing') out.push('ui');
        if (!v.inputEnabled) out.push('input'); if (v.autopilot) out.push('autopilot'); if (pl.riding) out.push('riding'); if (wantedLevel() > 0) out.push('wanted');
        if (engine.get<RaceApi>('races')?.active) out.push('race'); if (m?.busy) out.push('missions.busy'); if (m?.story) out.push(`story:${m.story}`);
        if (!(intro === undefined || intro === 'off' || intro === 'done')) out.push(`intro:${intro}`);
        if (engine.get<{ name: string; active: unknown }>('npc')?.active) out.push('npc'); if (engine.get<{ name: string; active: unknown }>('events')?.active) out.push('events');
        if (engine.get<{ name: string; running?: boolean }>('campaign')?.running) out.push('campaign'); if (dlg()?.busy) out.push('dialogue');
        if (engine.get<{ name: string; busy?: boolean }>('district')?.busy) out.push('district'); if (engine.get<StreetApi>('street')?.busy) out.push('street');
        if (engine.get<{ name: string; open?: boolean }>('garage')?.open) out.push('garage');
        if (cool > 0) out.push(`cool:${cool.toFixed(0)}`);
        return out;
      },
      state: () => ({ kind: job?.kind ?? null, phase: job?.phase ?? null, t: job?.t ?? 0, clock: job?.clock ?? 0, x: job?.x, z: job?.z, label: job?.label, len: job?.len,
        who: job?.who?.alive ? { x: job.who.pos.x, z: job.who.pos.z } : null, cool, done, free: free(), marks: marks.filter((s) => s.visible).length, near: askers.map((p) => Math.round(p.pos.distanceTo(pl.position) * 10) / 10), photo: !!photo }),
    },
    fixedUpdate(dt) {
      cool = Math.max(0, cool - dt);
      for (let i = later.length - 1; i >= 0; i--) { const l = later[i]; l.t -= dt; if (l.t <= 0) { later.splice(i, 1); l.fn(); } }
      const j = job;
      if (!j) return;
      j.t += dt; j.clock += dt;
      // 问话被别的对白顶掉了（没有回音）：当回绝
      if (j.phase === 'ask') { if (j.t > 1 && !dlg()?.asking) decline(j); return; }
      if (pl.health <= 0) { end(null); return; }
      if (j.kind === 'deliver') stepDeliver(j);
      else if (j.kind === 'lift') stepLift(j, dt);
      else if (j.kind === 'find') stepFind(j, dt);
      else stepPhoto(j);
    },
    update(dt) {
      marker.update(dt);
      showMarks(dt);
    },
  };
  engine.add(api);
}
