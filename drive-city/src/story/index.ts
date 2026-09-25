import type { Engine, System } from '../core/Engine';
import { lang, t, type TKey, type TParams } from '../core/I18n';
import { Rng } from '../core/Rng';
import { shotMode } from '../debug/ShotMode';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi, RaceApi, RenderApi, VehicleApi, WantedApi } from '../game/Contracts';
import type { GarageApi } from '../garage';
import type { IntroApi } from '../intro';
import { pickAddress, type Stop } from '../missions/Address';
import { Marker } from '../missions/Marker';
import type { LeaderboardApi } from '../online/Leaderboard';
import type { PoliceSystem } from '../police';
import type { TrafficApi } from '../traffic';
import type { UndergroundApi } from '../underground';
import { AT as UNDER_AT, toWorld as underWorld } from '../underground/Layout';
import { Banner } from '../ui/Banner';
import { Phone, type Sender } from './Phone';

const KEY = 'drivecity.story.v1';
/** Seconds of calm between one chapter's end and the next one's first text (the first after the start). */
const GAP = 30, FIRST = 20;
/** Chapter goals and pay. */
export const COMBO_GOAL = 2000;
const PAY = { combo: 300, race: 500, scout: 400, car: 300, heist: 6000, again: 3000 };
/** The heist: seconds the crew is inside, and when the alarm goes off. */
export const HEIST_WAIT = 20, HEIST_ALARM = 8;
/** Stars on the way out. */
const HEIST_STARS = 4;
/** Minutes of free time after the story before 老K offers the job again. */
const AGAIN_AFTER = 180;

type Who = 'laok' | 'xiaoyu' | 'daliu' | 'wang';
const COLOR: Record<Who, string> = { laok: '#f3b50f', xiaoyu: '#5ac8fa', daliu: '#ff6b5a', wang: '#6f9dff' };
const INITIAL: Record<Who, [string, string]> = { laok: ['K', 'K'], xiaoyu: ['雨', 'Y'], daliu: ['刘', 'L'], wang: ['警', 'W'] };

/** The chapters in order. 'end' is the story told; the heist can then be done again. */
const CHAPTERS = ['combo', 'race', 'scout', 'car', 'heist', 'end'] as const;
type Chapter = typeof CHAPTERS[number];
/** Within a chapter: waiting for the texts to be sent, or the task set and running. */
type Phase = 'wait' | 'task';
/** The heist, once the player pulls up at the door. */
type Heist = 'off' | 'go' | 'inside' | 'escape' | 'drop';

/** `combo`: the best banked while the combo chapter runs (its progress); `best`: the fastest getaway, seconds. */
interface Save { ch: number; heists: number; best: number; combo: number; store?: Stop; back?: Stop; escape?: Stop }

export interface StoryApi extends System {
  readonly chapter: Chapter;
  readonly heist: Heist;
  readonly phone: Phone;
  debug: {
    state(): { chapter: Chapter; phase: Phase; heist: Heist; calm: number; visited: boolean[]; spots: Stop[]; left: number; drop: Stop | null };
    /** Jump to a chapter with its texts sent and its task set. */
    go(ch: Chapter): void;
    /** Heist: skip to the getaway (the crew is out, the stars are up). */
    skipInside(): void;
  };
}

/**
 * The story, told in text messages (「用手机短信串起一条简单剧情线」). Four people: 老K the fixer,
 * 小雨 who does the tech and the scouting, 大刘 the driver who wants to be the driver, and 王队 of
 * the police. Each chapter is a few texts and one thing to do with what the game already has:
 *   combo   bank a street combo of COMBO_GOAL                          (老K)
 *   race    win a street race                                          (大刘)
 *   scout   drive slowly past the jewellers' front, its back lane and
 *           the way out (the underground car park's ramp)              (小雨)
 *   car     take a car off the street and hide it in the car park      (小雨)
 *   heist   pull up at the door, wait while the crew is inside (the alarm
 *           at HEIST_ALARM s), then HEIST_STARS stars: lose them and take
 *           the goods to a drop                                        (all of them)
 * A chapter's texts come only when things are calm (no stars, no race, not in the garage or the
 * getaway intro) and GAP seconds after the last one; its task is a line in the phone column, and it
 * can be done any time, alongside anything else. The heist is the exception: once the crew is in it
 * takes the objective line (`MissionApi.story`), which holds off street events and races. Busted or
 * wasted, it goes back to the door. After the end the heist comes round again every AGAIN_AFTER s of
 * free play, for less. The getaway's time goes on the `heist` leaderboard. Saved in
 * `drivecity.story.v1`; not in shot mode.
 */
export async function install(engine: Engine): Promise<void> {
  const pl = engine.get<PlayerApi>('player');
  const tr = engine.get<TrafficApi>('traffic');
  if (!pl || !tr || shotMode && new URLSearchParams(location.search).get('story') !== '1') return;
  const phone = new Phone();
  const banner = new Banner();
  const markers = [new Marker(engine.scene), new Marker(engine.scene), new Marker(engine.scene)];
  const rng = new Rng(7117);

  let save: Save = { ch: 0, heists: 0, best: 0, combo: 0 };
  try { save = { ...save, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Save> }; } catch { /* private mode */ }
  const persist = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* ignore */ } };

  let phase: Phase = 'wait', calm = 0, started = false, heist: Heist = 'off', clock = 0, hT = 0, getaway = 0, again = false;
  let visited = [false, false, false], seen = [0, 0, 0], jacked: unknown = null, drop: Stop | null = null, alarm = false, lastLv = 0, aimed = false, dropCd = 0;
  again = save.heists > 0;
  const outbox: { at: number; who: Who; key: TKey; p?: TParams }[] = [];

  const chapter = (): Chapter => CHAPTERS[Math.min(save.ch, CHAPTERS.length - 1)];
  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const missions = () => engine.get<MissionApi>('missions');
  const nav = () => engine.get<NavApi>('nav');
  const police = () => engine.get<PoliceSystem>('wanted');
  const level = () => engine.get<WantedApi>('wanted')?.level ?? 0;
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const story = (s: string | null) => { const m = missions(); if (m) m.story = s; };
  const sender = (w: Who): Sender => ({ id: w, name: t(`who.${w}` as TKey), initial: INITIAL[w][lang() === 'zh' ? 0 : 1], color: COLOR[w] });
  /** Texts, `gap` seconds apart from `delay` on. */
  const say = (lines: [Who, TKey, TParams?][], delay = 0, gap = 2.6) => lines.forEach(([who, key, p], i) => outbox.push({ at: clock + delay + i * gap, who, key, p }));
  const pay = (n: number) => { missions()?.addCash(n); };
  const flash = (s: string, colour = '#ffc21f') => { banner.show(s, colour); setTimeout(() => banner.hide(), 1500); };

  /** The three places: the jewellers', its back lane, the way out. Picked once and kept in the save. */
  const places = (): boolean => {
    if (save.store && save.back && save.escape) return true;
    const n = nav(), g = tr.graph;
    if (!n) return false;
    const [ex, ez] = UNDER_AT ? underWorld(0, -5) : [4480, -60];
    const r = () => rng.next();
    // By road the one-ways round 国贸 make most kerbs 700 m+ from the car park, and a 250-700 m window
    // found nothing on some draws; widen it, then fall back to a straight-line pick.
    const store = pickAddress(g, n, r, ex, ez, 250, 1200) ?? pickAddress(g, n, r, ex, ez, 250, 700, [], 120, false);
    if (!store) return false;
    const back = pickAddress(g, n, r, store.x, store.z, 90, 260, [store], 60, false);
    if (!back) return false;
    save.store = store; save.back = back;
    save.escape = UNDER_AT ? { x: ex, z: ez, label: t('story.carpark') } : pickAddress(g, n, r, store.x, store.z, 300, 600, [store, back], 100, false) ?? back;
    persist();
    return true;
  };
  const spots = (): Stop[] => save.store && save.back && save.escape ? [save.store, save.back, save.escape] : [];

  /** Nothing else on: a new chapter's texts may come. */
  const isCalm = () => {
    const intro = engine.get<IntroApi>('intro')?.step;
    return started && level() === 0 && !engine.get<RaceApi>('races')?.active && !engine.get<GarageApi>('garage')?.open
      && (intro === undefined || intro === 'off' || intro === 'done') && heist === 'off' && !missions()?.story;
  };

  /** Send the chapter's opening texts and set its task. */
  const open = (ch: Chapter) => {
    phase = 'task';
    switch (ch) {
      case 'combo': say([['laok', 'story.combo1'], ['laok', 'story.combo2'], ['laok', 'story.combo3', { n: COMBO_GOAL }]]); break;
      case 'race': say([['daliu', 'story.race1'], ['daliu', 'story.race2']]); break;
      case 'scout':
        if (!places()) { phase = 'wait'; calm = GAP - 5; return; }
        visited = [false, false, false]; seen = [0, 0, 0];
        say([['xiaoyu', 'story.scout1'], ['xiaoyu', 'story.scout2', { place: save.store!.label }], ['xiaoyu', 'story.scout3']]);
        break;
      case 'car': jacked = null; say([['xiaoyu', 'story.car1'], ['xiaoyu', UNDER_AT ? 'story.car2' : 'story.car2b']]); break;
      case 'heist':
        if (!places()) { phase = 'wait'; calm = GAP - 5; return; }
        heist = 'go';
        if (again) say([['laok', 'story.again1'], ['laok', 'story.heist3', { place: save.store!.label }]]);
        else say([['laok', 'story.heist1'], ['laok', 'story.heist2'], ['daliu', 'story.heist2b'], ['laok', 'story.heist3', { place: save.store!.label }]]);
        break;
      case 'end': phase = 'wait'; break;
    }
  };
  /** The chapter's task is done: pay, the closing texts, on to the next. */
  const close = (lines: [Who, TKey, TParams?][], cash: number) => {
    if (cash) pay(cash);
    say(lines, 0.8);
    if (cash) toast(t('story.paid', { n: cash }));
    save.ch = Math.min(save.ch + 1, CHAPTERS.length - 1);
    persist();
    phase = 'wait'; calm = 0;
    for (const m of markers) m.hide();
  };

  // --- the heist ----------------------------------------------------------------------------------------
  const heistTarget = (s: Stop | null, label: string) => {
    const n = nav();
    aimed = !!s;
    if (s) { n?.setTarget({ x: s.x, z: s.z, kind: 'mission', label }); markers[0].show(s.x, s.z, '#ff4d4d'); }
    else { n?.clearTarget('mission'); markers[0].hide(); }
  };
  const heistFail = (key: TKey) => {
    if (heist === 'off' || heist === 'go') return;
    heist = 'go'; drop = null; story(null); heistTarget(null, '');
    say([['laok', key], ['laok', 'story.retry', { place: save.store!.label }]], 1.5);
  };
  const heistInside = () => {
    heist = 'inside'; hT = 0; alarm = false;
    heistTarget(null, '');
    flash(t('story.goBanner'), '#ff4d4d');
    say([['daliu', 'story.in1']], 0.5);
  };
  const heistOut = () => {
    heist = 'escape'; getaway = clock;
    police()?.debug.setLevel(HEIST_STARS);
    flash(t('story.outBanner'), '#ff4d4d');
    say([['daliu', 'story.out1'], ['xiaoyu', 'story.out2']], 0.3, 2.2);
  };
  const heistDone = () => {
    const secs = clock - getaway, first = !again;
    heist = 'off'; drop = null; story(null); heistTarget(null, '');
    const cash = first ? PAY.heist : PAY.again;
    save.heists++;
    if (!save.best || secs < save.best) save.best = secs;
    engine.get<LeaderboardApi>('leaderboard')?.submit('heist', secs * 1000);
    flash(t('story.doneBanner'));
    const m = Math.floor(secs / 60), s = Math.round(secs % 60);
    toast(t('story.heistPaid', { n: cash, time: `${m}:${String(s).padStart(2, '0')}` }));
    pay(cash);
    if (first) { say([['laok', 'story.done1', { n: cash }], ['daliu', 'story.done2'], ['xiaoyu', 'story.done3'], ['wang', 'story.wang1'], ['wang', 'story.wang2']], 1.2, 3); save.ch = CHAPTERS.indexOf('end'); }
    else say([['laok', 'story.againDone', { n: cash }], ['wang', 'story.wang3']], 1.2, 3);
    again = true; phase = 'wait'; calm = 0;
    persist();
  };

  engine.events.on('game:start', () => { started = true; calm = GAP - FIRST; });
  engine.events.on('stunt:bank', ({ points, lost }) => {
    if (chapter() !== 'combo' || phase !== 'task' || lost) return;
    if (points >= COMBO_GOAL) close([['laok', 'story.comboDone']], PAY.combo);
    else if (points > (save.combo || 0)) { save.combo = points; persist(); }
  });
  engine.events.on('race:finish', ({ place }) => {
    if (chapter() !== 'race' || phase !== 'task') return;
    if (place === 1) close([['daliu', 'story.raceDone1'], ['daliu', 'story.raceDone2']], PAY.race);
    else say([['daliu', 'story.raceLost', { place }]], 1);
  });
  engine.events.on('player:mode', ({ mode, carjacked }) => {
    if (chapter() === 'car' && phase === 'task' && mode === 'driving' && carjacked) {
      jacked = vehicle().car;
      if (!UNDER_AT) close([['xiaoyu', 'story.carDone']], PAY.car);
      else say([['xiaoyu', 'story.carGot']], 1);
    }
  });
  engine.events.on('wanted:busted', () => heistFail('story.busted'));

  const blips: Blip[] = [];
  let blipsOn = false;
  const api: StoryApi = {
    name: 'story',
    get chapter() { return chapter(); },
    get heist() { return heist; },
    phone,
    debug: {
      state: () => ({ chapter: chapter(), phase, heist, calm, visited: [...visited], spots: spots(), left: heist === 'inside' ? HEIST_WAIT - hT : 0, drop }),
      go: (ch) => { save.ch = CHAPTERS.indexOf(ch); heist = 'off'; story(null); persist(); open(ch); },
      skipInside: () => { if (heist === 'go' || heist === 'inside') heistOut(); },
    },
    fixedUpdate(dt) {
      clock += dt;
      // The outbox: texts arrive on their own clock, with a ding.
      for (let i = 0; i < outbox.length; i++) {
        const o = outbox[i];
        if (o.at > clock) continue;
        outbox.splice(i--, 1);
        phone.push(sender(o.who), t(o.key, o.p));
        engine.events.emit('phone:sms', { from: o.who });
      }
      if (!started) return;
      const ch = chapter(), v = vehicle(), c = v.car, driving = pl.mode === 'driving' && v.occupied;
      const P = pl.position;

      // A new chapter, once it is calm for long enough.
      if (phase === 'wait') {
        const offer = ch !== 'end' || (again || save.heists > 0);
        if (!offer || !isCalm()) return;
        calm += dt;
        if (calm < (ch === 'end' ? AGAIN_AFTER : GAP)) return;
        if (ch === 'end') { again = true; open('heist'); }
        else open(ch);
        return;
      }

      if (ch === 'scout') {
        const sp = spots();
        sp.forEach((s, i) => {
          if (visited[i]) return;
          const near = Math.hypot(P.x - s.x, P.z - s.z) < 13 && (!driving || c.speed < 7.5);
          seen[i] = near ? seen[i] + dt : 0;
          if (seen[i] < 1.5) return;
          visited[i] = true;
          const n = visited.filter(Boolean).length;
          toast(t('story.photo', { n, of: 3 }));
          if (n === 3) close([['xiaoyu', 'story.scoutDone1'], ['xiaoyu', 'story.scoutDone2']], PAY.scout);
        });
      }
      if (ch === 'car' && jacked && driving && c === jacked && c.speed < 2
        && engine.get<UndergroundApi>('underground')?.contains(c.pos.x, c.pos.y, c.pos.z)) close([['xiaoyu', 'story.carDone']], PAY.car);

      if (heist === 'go') {
        const s = save.store!;
        // Point the GPS at the door when nothing else is using it (a fare or a job takes it over).
        if (missions()?.objective) aimed = false;
        else if (!aimed) heistTarget(s, t('story.storeLabel'));
        if (driving && Math.hypot(c.pos.x - s.x, c.pos.z - s.z) < 9 && c.speed < 1.5) {
          if (level() > 0) { if (hT <= 0) { toast(t('story.hot')); hT = 5; } else hT -= dt; }
          else heistInside();
        }
      } else if (heist === 'inside') {
        hT += dt;
        const s = save.store!, away = !driving || Math.hypot(c.pos.x - s.x, c.pos.z - s.z) > 30;
        if (away) { heistFail('story.left'); return; }
        if (!alarm && hT > HEIST_ALARM) { alarm = true; police()?.debug.setLevel(1); say([['xiaoyu', 'story.alarm']]); }
        story(t('story.inside', { s: Math.max(0, Math.ceil(HEIST_WAIT - hT)) }));
        if (hT >= HEIST_WAIT) heistOut();
      } else if (heist === 'escape') {
        const lv = level();
        story(t('story.escape', { n: lv }));
        dropCd -= dt;
        if (lv === 0 && dropCd <= 0) {
          dropCd = 1;
          const n = nav();
          const rr = () => rng.next();
          drop = pickAddress(tr.graph, n, rr, c.pos.x, c.pos.z, 700, 1400, [save.store!]) ?? pickAddress(tr.graph, n, rr, c.pos.x, c.pos.z, 500, 1100, [save.store!], 120, false);
          if (drop) { heist = 'drop'; heistTarget(drop, t('story.dropLabel')); say([['laok', 'story.drop', { place: drop.label }]], 0.5); }
        }
      } else if (heist === 'drop' && drop) {
        const lv = level();
        if (lv > 0 && lastLv === 0) { heist = 'escape'; heistTarget(null, ''); }
        else {
          story(t('story.dropLine', { place: drop.label }));
          if (driving && Math.hypot(c.pos.x - drop.x, c.pos.z - drop.z) < 11 && c.speed < 2) heistDone();
        }
      }
      if (heist !== 'off' && heist !== 'go' && pl.health <= 0) heistFail('story.wasted');
      lastLv = level();
    },
    update(dt) {
      const ch = chapter(), ui = engine.get<{ name: string; state: string }>('ui')?.state;
      if (engine.input.state.phonePressed) phone.toggle();
      phone.clock = () => {
        const h = engine.get<RenderApi>('render')?.timeOfDay ?? 12;
        return `${Math.floor(h)}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`;
      };
      // The task line.
      let who: Who | null = null, text: string | null = null;
      if (phase === 'task') {
        if (ch === 'combo') { who = 'laok'; text = t('story.t.combo', { n: COMBO_GOAL, best: (save.combo || 0).toLocaleString() }); }
        else if (ch === 'race') { who = 'daliu'; text = t('story.t.race'); }
        else if (ch === 'scout') { who = 'xiaoyu'; text = t('story.t.scout', { n: visited.filter(Boolean).length, of: 3 }); }
        else if (ch === 'car') { who = 'xiaoyu'; text = t(jacked ? 'story.t.hide' : 'story.t.jack'); }
        else if (heist === 'go') { who = 'laok'; text = t('story.t.go', { place: save.store?.label ?? '' }); }
      }
      phone.setTask(who ? sender(who) : null, text);
      phone.update(dt, ui === 'playing');
      // Scouting: a ring at each place still to photograph.
      if (ch === 'scout' && phase === 'task') spots().forEach((s, i) => { if (visited[i]) markers[i].hide(); else markers[i].show(s.x, s.z, '#5ac8fa'); });
      for (const m of markers) m.update(dt);
      const n = nav();
      if (n && !blipsOn) {
        blipsOn = true;
        n.addBlips(() => {
          blips.length = 0;
          if (chapter() === 'scout' && phase === 'task') spots().forEach((s, i) => { if (!visited[i]) blips.push({ kind: 'target', x: s.x, z: s.z, label: t('story.scoutLabel') }); });
          if (heist === 'go' && save.store) blips.push({ kind: 'target', x: save.store.x, z: save.store.z, label: t('story.storeLabel'), flash: true });
          return blips;
        });
      }
    },
  };
  engine.add(api);
}
