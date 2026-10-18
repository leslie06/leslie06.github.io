import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import { shotMode } from '../debug/ShotMode';
import type { Blip, MissionApi, RaceApi, Speaker, WantedApi } from '../game/Contracts';
import type { GarageApi } from '../garage';
import type { IntroApi } from '../intro';
import type { StoryApi } from '../story';
import type { TrafficApi } from '../traffic';
import { Marker } from '../missions/Marker';
import { Env, type Chapter } from './Kit';
import { Runner } from './Runner';
import { Nudge } from './Screens';
import { chapter1 } from './missions/m1';
import { chapter2 } from './missions/m2';
import { chapter3 } from './missions/m3';
import { chapter4 } from './missions/m4';
import { chapter5 } from './missions/m5';

/** The start's circle: walk into it, or stop a car in it (its edge, a little wider: K stands on the pavement). */
const START_R = 4, START_R_CAR = 6.5;
/** Near enough to the start to be told to step in. */
const NEAR_R = 45;

/**
 * The main story as missions (docs/gta-plan.md §4): system `campaign`. The next chapter's start is a gold corona, a
 * lettered gold blip pinned to the radar's edge, and the GPS's `story` target (a route there whenever nothing else is
 * being led to; 2026-10-14, 「模仿gta5，让玩家能容易找到玩剧情的入口」), with a nudge at the top of the screen when it is
 * first open and on the way in; walking or driving into it (calm: no stars, no heist, race or garage) shows the chapter's title and runs
 * it. Failing shows why and asks: retry from the checkpoint, or give up. Passing shows the results card, pays, and is
 * saved in `drivecity.campaign.v1` with the best medal. Off in shot mode unless `?campaign=1`; `?campaign=0` off.
 */
export interface CampaignApi extends System {
  /** The chapter running, or null. */
  readonly running: string | null;
  readonly done: readonly string[];
  /** The chapter select (pause screen): every chapter and where the player stands with it. */
  list(): { id: string; kick: string; title: string; state: 'gold' | 'silver' | 'bronze' | 'skipped' | 'next' | 'locked' }[];
  /** Why no chapter can be started from the menu now (one running, stars, a race...), or null. */
  blocked(): string | null;
  /**
   * Start chapter `id` from the chapter select, wherever the player is (its first cutscene puts them in place): a
   * cleared one is a replay (the medal can improve, no pay), a locked one marks those before it skipped first.
   */
  play(id: string): boolean;
  /** Give up the running chapter (the chapter select's button): as the failure card's 放弃. */
  quit(): void;
  debug: {
    runner(): Runner<unknown> | null;
    /** The chapter running (its `debug` hooks), or null. */
    chapter(): Chapter<unknown> | null;
    /** Start a chapter now (wherever the player is: the cutscene puts them in place). */
    start(id?: string): void;
    /** Jump to step `id` of the running chapter (a probe), restoring at the checkpoint before it. */
    skipTo(id: string): void;
  };
}

const KEY = 'drivecity.campaign.v1';
interface Save { done: string[]; best: Record<string, { medal: string; secs: number }> }
const MEDAL_RANK = { gold: 3, silver: 2, bronze: 1 } as Record<string, number>;

export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search);
  if (q.get('campaign') === '0' || (shotMode && q.get('campaign') !== '1')) return;
  const tr = engine.get<TrafficApi>('traffic');
  if (!tr) return;
  const env = new Env(engine);
  const startMark = new Marker(engine.scene);
  const nudge = new Nudge();
  /** Where the GPS's story target was put (set only when it moves: a new target object redraws the maps). */
  let guided: { x: number; z: number } | null = null;
  const guide = (c: Chapter<unknown> | null, at: { x: number; z: number } | null) => {
    if (!c || !at) { if (guided) { env.nav.clearTarget('story'); guided = null; } return; }
    if (guided && Math.hypot(guided.x - at.x, guided.z - at.z) < 1) return;
    guided = { x: at.x, z: at.z };
    env.nav.setTarget({ x: at.x, z: at.z, kind: 'story', label: c.blip });
  };
  /** The chapters already pointed out this session, and the one the player was told to step into. */
  const nudged = new Set<string>();
  let nearNudged = '';
  let save: Save = { done: [], best: {} };
  try { save = { ...save, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') as Save }; } catch { /* fresh */ }
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* private mode */ } };

  const chapters = [chapter1(env), chapter2(env), chapter3(env), chapter4(env), chapter5(env)] as unknown as Chapter<unknown>[];
  let runner: Runner<unknown> | null = null, def: Chapter<unknown> | null = null, failT = -1, asked = false, cool = 0;
  const next = () => chapters.find((c) => !save.done.includes(c.id)) ?? null;

  // the mission's cars: F takes the mission car; a mission car the player left is kept simulated by us
  tr.addExternalCars({
    cars: () => [...env.cars].filter((c) => c.on && c.takeable && env.v.car !== c.car).map((c) => c.car),
    canTake: (car) => [...env.cars].some((c) => c.car === car && c.takeable && car.speed < 4),
    take: (car) => { const c = [...env.cars].find((x) => x.car === car && x.takeable); return c ? { ...c.look, parked: true } : null; },
    park: (car) => [...env.cars].some((c) => c.car === car && runner?.state === 'running'),
  });

  /** Nothing else going on that the chapter would trample. */
  /**
   * What the chapter would trample, as the chapter select says it, or null. The opening's adventure (FLY-07) is not
   * one: a chapter runs alongside it as it always did (2026-10-15 it was briefly counted, and a player with the
   * adventure left half done could start no chapter at all - 「现在不行」 with no reason given).
   */
  const busyWith = (): string | null => {
    const intro = engine.get<IntroApi>('intro')?.step;
    if ((engine.get<WantedApi>('wanted')?.level ?? 0) > 0) return t('cmp.sel.why.wanted');
    if (engine.get<RaceApi>('races')?.active) return t('cmp.sel.why.race');
    if ((engine.get<StoryApi>('story')?.heist ?? 'off') !== 'off') return t('cmp.sel.why.heist');
    if (engine.get<GarageApi>('garage')?.open) return t('cmp.sel.why.garage');
    if (!(intro === undefined || intro === 'off' || intro === 'done')) return t('cmp.sel.why.intro');
    if (engine.get<MissionApi>('missions')?.busy) return t('cmp.sel.why.job');
    return null;
  };
  /** Nothing else going on that the chapter would trample. */
  const calm = () => busyWith() === null;

  /** The running chapter was started again from the chapter select after it was cleared: no pay. */
  let replay = false;
  const begin = (c: Chapter<unknown>, again = false) => {
    replay = again;
    def = c; runner = new Runner(c as never) as Runner<unknown>;
    failT = -1; asked = false;
    startMark.hide(); guide(null, null); nudge.hide();
    env.card.title(c.kick, c.title, c.who);
    runner.start();
  };
  const finish = () => {
    env.objective(null); startMark.hide();
    env.nav.clearTarget('mission');
    for (const m of env.markers) m.hide();
    runner = null; def = null; cool = 8;
  };
  const system: Speaker = { name: '', color: '#ff5a4a' };

  const api: CampaignApi = {
    name: 'campaign',
    get running() { return runner?.state === 'running' || runner?.state === 'failed' ? def?.id ?? null : null; },
    get done() { return save.done; },
    list: () => {
      const n = next();
      return chapters.map((c) => {
        const b = save.best[c.id];
        const state = b ? b.medal as 'gold' | 'silver' | 'bronze' : save.done.includes(c.id) ? 'skipped' : c === n ? 'next' : 'locked';
        return { id: c.id, kick: c.kick, title: c.title, state };
      });
    },
    blocked: () => { if (runner) return t('cmp.sel.busy'); const w = busyWith(); return w ? t('cmp.sel.notCalm', { why: w }) : null; },
    play: (id) => {
      const i = chapters.findIndex((c) => c.id === id);
      if (i < 0 || api.blocked()) return false;
      const c = chapters[i], again = save.done.includes(c.id);
      // a locked chapter: the ones before it skipped (done, no medal: the chapter select says 已跳过)
      if (!again) { for (const p of chapters.slice(0, i)) if (!save.done.includes(p.id)) save.done.push(p.id); write(); }
      begin(c, again);
      return true;
    },
    quit: () => { if (!runner) return; env.card.hide(); env.dialogue?.clear(5); runner.abandon(); finish(); },
    debug: {
      runner: () => runner,
      chapter: () => def,
      start: (id) => { const c = chapters.find((x) => x.id === (id ?? next()?.id)); if (c && !runner) begin(c); },
      skipTo: (id) => {
        if (!runner || !def) return;
        const i = def.steps.findIndex((s) => s.id === id);
        if (i < 0) return;
        // fail quietly and retry from the checkpoint at or before `id`
        let cp = i; while (cp > 0 && !def.steps[cp].checkpoint) cp--;
        const r = runner as unknown as { saved: { index: number; state: string } | null; ctx: { state: unknown } | null };
        runner.fail('skip');
        r.saved = { index: cp, state: JSON.stringify(r.ctx?.state ?? def.init()) };
        runner.retry();
        failT = -1; asked = false;
      },
    },
    fixedUpdate(dt) { for (const c of env.cars) c.fixed(dt); },
    postStep(dt) { for (const c of env.cars) c.post(dt); },
    update(dt, alpha) {
      env.blips.length = 0;
      for (const m of env.markers) m.update(dt);
      startMark.update(dt);
      cool = Math.max(0, cool - dt);
      if (runner && def) {
        if (runner.state === 'running') { def.tick(dt, runner.data as never); runner.update(dt); }
        if (runner.state === 'failed') {
          // say why, then (once the wasted or busted scene is over) ask
          if (failT < 0) { failT = 0; env.objective(null); env.card.failed(runner.reason); }
          failT += dt;
          if (!asked && failT > (runner.reason === t('cmp.why.wasted') || runner.reason === t('cmp.why.busted') ? 6 : 2.2) && env.v.inputEnabled !== undefined) {
            asked = true; env.card.hide();
            env.dialogue?.ask(system, t('cmp.failAsk', { why: runner.reason }), [t('cmp.retry'), t('cmp.quit')], (i) => {
              if (!runner) return;
              if (i === 0) { failT = -1; asked = false; runner.retry(); }
              else { runner.abandon(); finish(); }
            }, { prio: 5, timeout: 60, fallback: 0 });
          }
        } else if (runner.state === 'passed') {
          const c = def, clock = runner.clock, st = runner.data;
          // the mission car stays the player's if they are in it
          const res = c.result(clock, (st ?? c.init()) as never);
          finish();
          if (!save.done.includes(c.id)) save.done.push(c.id);
          const old = save.best[c.id];
          if (!old || MEDAL_RANK[res.medal] > MEDAL_RANK[old.medal] || (res.medal === old.medal && clock < old.secs)) save.best[c.id] = { medal: res.medal, secs: Math.round(clock) };
          write();
          // a replay from the chapter select: the medal counts, the money does not (no farming a chapter)
          if (!replay) engine.get<MissionApi>('missions')?.addCash(res.pay);
          engine.events.emit('campaign:passed', { id: c.id, medal: res.medal });
          env.card.passed(`${c.kick} · ${c.title}`, res.rows, res.medal, replay ? 0 : res.pay, () => {}, replay ? t('cmp.sel.noPay') : undefined);
        }
      } else {
        // the next chapter's start
        const c = next(), at = c?.start();
        guide(c, at ?? null);
        if (c && at) {
          startMark.show(at.x, at.z, '#ffc21f', START_R / 2.1);
          env.blips.push({ kind: 'story', x: at.x, z: at.z, label: c.blip, glyph: c.glyph });
          const P = env.pl.position, d = Math.hypot(P.x - at.x, P.z - at.z);
          const onFoot = env.pl.mode === 'onfoot', slow = onFoot || env.v.car.speed < 3;
          // point it out: once a session when it opens (nothing else on), and again on the way in
          // not over the title or the pause screen (it sat on top of the menu): only once in the city
          const inGame = engine.get<{ name: string; state: string }>('ui')?.state === 'playing';
          const quiet = inGame && calm() && cool <= 0 && !env.dialogue?.busy;
          const head = t('cmp.nudge.head', { kick: c.kick, title: c.title });
          if (quiet && !nudged.has(c.id) && d > NEAR_R) { nudged.add(c.id); nudge.show(c.glyph, head, t('cmp.nudge.go', { who: c.giver })); }
          if (d < NEAR_R && nearNudged !== c.id && inGame && calm()) { nearNudged = c.id; nudged.add(c.id); nudge.show(c.glyph, head, t('cmp.nudge.here'), 6); }
          if (d > NEAR_R * 2 && nearNudged === c.id) nearNudged = '';
          if (d < (onFoot ? START_R : START_R_CAR) && slow && cool <= 0) {
            if (calm()) { startMark.hide(); begin(c); }
            else if ((engine.get<WantedApi>('wanted')?.level ?? 0) > 0) { env.hud?.toast(t('cmp.busyWanted')); cool = 6; }
          }
        } else { startMark.hide(); guide(null, null); }
      }
      for (const car of env.cars) car.draw(alpha);
    },
  };
  // a note still up when the game is paused goes (it would sit over the menu)
  engine.events.on('game:pause', () => nudge.hide());
  env.nav.addBlips(() => env.blips.slice());
  engine.add(api);
}
