import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import { shotMode } from '../debug/ShotMode';
import type { Blip, MissionApi, RaceApi, Speaker, WantedApi } from '../game/Contracts';
import type { GarageApi } from '../garage';
import type { IntroApi } from '../intro';
import type { StoryApi } from '../story';
import type { TrafficApi } from '../traffic';
import { Marker } from '../missions/Marker';
import { Env } from './Kit';
import { Runner } from './Runner';
import { chapter1, type M1 } from './missions/m1';

/**
 * The main story as missions (docs/gta-plan.md §4): system `campaign`. The next chapter's start is a gold corona and a
 * map blip; walking or driving into it (calm: no stars, no heist, race or garage) shows the chapter's title and runs
 * it. Failing shows why and asks: retry from the checkpoint, or give up. Passing shows the results card, pays, and is
 * saved in `drivecity.campaign.v1` with the best medal. Off in shot mode unless `?campaign=1`; `?campaign=0` off.
 */
export interface CampaignApi extends System {
  /** The chapter running, or null. */
  readonly running: string | null;
  readonly done: readonly string[];
  debug: {
    runner(): Runner<unknown> | null;
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
  let save: Save = { done: [], best: {} };
  try { save = { ...save, ...JSON.parse(localStorage.getItem(KEY) ?? '{}') as Save }; } catch { /* fresh */ }
  const write = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* private mode */ } };

  const chapters: M1[] = [chapter1(env)];
  let runner: Runner<unknown> | null = null, def: M1 | null = null, failT = -1, asked = false, cool = 0;
  const next = () => chapters.find((c) => !save.done.includes(c.id)) ?? null;

  // the mission's cars: F takes the mission car; a mission car the player left is kept simulated by us
  tr.addExternalCars({
    cars: () => [...env.cars].filter((c) => c.on && c.takeable && env.v.car !== c.car).map((c) => c.car),
    canTake: (car) => [...env.cars].some((c) => c.car === car && c.takeable && car.speed < 4),
    take: (car) => { const c = [...env.cars].find((x) => x.car === car && x.takeable); return c ? { ...c.look, parked: true } : null; },
    park: (car) => [...env.cars].some((c) => c.car === car && runner?.state === 'running'),
  });

  /** Nothing else going on that the chapter would trample. */
  const calm = () => {
    const intro = engine.get<IntroApi>('intro')?.step;
    return (engine.get<WantedApi>('wanted')?.level ?? 0) === 0 && !engine.get<RaceApi>('races')?.active
      && (engine.get<StoryApi>('story')?.heist ?? 'off') === 'off' && !engine.get<GarageApi>('garage')?.open
      && (intro === undefined || intro === 'off' || intro === 'done') && !engine.get<MissionApi>('missions')?.busy;
  };

  const begin = (c: M1) => {
    def = c; runner = new Runner(c as never) as Runner<unknown>;
    failT = -1; asked = false;
    startMark.hide();
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
    debug: {
      runner: () => runner,
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
          engine.get<MissionApi>('missions')?.addCash(res.pay);
          engine.events.emit('campaign:passed', { id: c.id, medal: res.medal });
          env.card.passed(`${c.kick} · ${c.title}`, res.rows, res.medal, res.pay, () => {});
        }
      } else {
        // the next chapter's start
        const c = next(), at = c?.start();
        if (c && at) {
          startMark.show(at.x, at.z, '#ffc21f', 0.8);
          env.blips.push({ kind: 'target', x: at.x, z: at.z, label: c.blip, color: '#ffc21f' });
          const P = env.pl.position, d = Math.hypot(P.x - at.x, P.z - at.z);
          const slow = env.pl.mode === 'onfoot' || env.v.car.speed < 3;
          if (d < 3.4 && slow && cool <= 0) {
            if (calm()) { startMark.hide(); begin(c); }
            else if ((engine.get<WantedApi>('wanted')?.level ?? 0) > 0) { env.hud?.toast(t('cmp.busyWanted')); cool = 6; }
          }
        } else startMark.hide();
      }
      for (const car of env.cars) car.draw(alpha);
    },
  };
  env.nav.addBlips(() => env.blips.slice());
  engine.add(api);
}
