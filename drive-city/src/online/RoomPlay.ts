import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import type { Blip, CarLook, HudApi, NavApi, PlayerApi, RaceApi, VehicleApi, WantedApi } from '../game/Contracts';
import type { CampaignApi } from '../campaign';
import { Marker } from '../missions/Marker';
import { POLICE } from '../police';
import type { TrialApi } from '../trials';
import { Banner } from '../ui/Banner';
import { C, F, css, el } from '../ui/theme';
import { POLICE_LIVERY } from '../vehicle/CarModel';
import { Vehicle } from '../vehicle/Vehicle';
import { beaconFlash, type MultiplayerApi } from './Multiplayer';

/**
 * Things to do together in a room (2026-10-30, 「现在感觉联机就是互相开车，没什么意思，怎么增加联机的趣味性」; the user
 * chose: getting together, a race, 警匪追逃). All of it rides on the room's one-off events (`mp.send` / `mp.onEvent`):
 * the relay passes them on as they are, so nothing changes on the server.
 *
 * - **G: the room's quick menu** - four lines to shout (over your head for the others, a toast for those far off),
 *   「集合到我这」 (everyone's GPS to where you are), 「把导航点发给大家」 (your map waypoint, to everyone), and
 *   「导航到 X」 (the GPS follows a friend until you are with them).
 * - **联机赛跑**: whoever starts it picks one of the 计时赛 courses; everyone in the city who is free is put on a grid
 *   behind its gate (the starter's game says go once all are there, or after READY_WAIT), 3-2-1, and the course's
 *   checkpoints in turn; each game times its own player and says when they are in. Places live on the panel (by how far
 *   along each one is), the results at the end (everyone in, or FINISH_WAIT after the first).
 * - **警匪追逃**: one runner, the rest police - in a police car with its light bar (sent to the others), put down
 *   COP_RING m from the runner and held for HEAD_START s. The police see the runner only within SEEN m, else a flash on
 *   the map every PULSE s. The runner is caught when a police car is within CATCH_D m while they are all but stopped
 *   (under CATCH_V) for CATCH_T s; they win by lasting CHASE_S s. The runner's game decides: it says caught or escaped.
 *
 * The one who starts a game runs it (the go, the end); if they leave, it ends. Stars are wiped at the start; a story
 * chapter, a street race or a time trial keeps a player out.
 */
export interface PlayResult { kind: 'race' | 'chase'; title: string; rows: { name: string; text: string; win: boolean }[] }
export interface PlayScore { name: string; raceWins: number; escapes: number; catches: number }
export interface PlayApi extends System {
  /** A game is running with this player in it. */
  readonly active: boolean;
  /** What is on in the room now, for the room's panel: its name, and whether we started it; null for nothing. */
  readonly running: { title: string; mine: boolean } | null;
  readonly last: PlayResult | null;
  readonly scores: readonly PlayScore[];
  readonly courses: readonly { name: string; len: number }[];
  /** Start a race on this course / a chase with this runner: what is wrong, or null. */
  startRace(course: number): string | null;
  startChase(runner: number): string | null;
  /** The one who started it calls it off. */
  stop(): void;
  /** The quick menu's things, for probes. */
  shout(i: number): void;
  gather(): void;
  follow(id: number | null): void;
  readonly following: number | null;
}

const SHOUTS = 4;
const READY_WAIT = 14, FINISH_WAIT = 90, RACE_OFF = 90, RACE_OFF_T = 8, OUT_OF_CAR_T = 8;
const CHASE_S = 180, HEAD_START = 15, COP_RING = 220, SEEN = 150, PULSE = 10, PULSE_SHOW = 3;
const CATCH_D = 8, CATCH_V = 1.6, CATCH_T = 3;
const FOLLOW_EVERY = 2, FOLLOW_NEAR = 40;
const RACE_COLOR = '#35e0c2', FINISH_COLOR = '#7dff8a';
const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toFixed(1).padStart(4, '0')}`;
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

css(`
.mpq-btn{position:fixed;left:calc(var(--hud-x,38px) + 96px);top:calc(var(--mm-top,18px) + var(--mm-h,0px) + 114px);z-index:26;pointer-events:auto;display:flex;align-items:center;gap:7px;
  min-height:44px;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid rgba(53,224,194,.55);background:${C.inkGlass};color:${C.paper};font:700 13px/1.2 ${F.ui};cursor:pointer}
.mpq-btn kbd{font:800 11px/1 ${F.num};color:#35e0c2}
.mpq-btn[hidden],.mpq[hidden]{display:none}
.mpq{position:fixed;left:calc(var(--hud-x,38px) + 96px);top:calc(var(--mm-top,18px) + var(--mm-h,0px) + 164px);z-index:29;min-width:220px;max-width:min(320px,calc(100vw - 32px));max-height:calc(100vh - 220px);overflow:auto;
  display:flex;flex-direction:column;padding:6px;border-radius:10px;background:#15191c;border:1px solid ${C.line};box-shadow:0 14px 40px rgba(0,0,0,.45);pointer-events:auto}
.mpq button{display:flex;gap:10px;align-items:center;text-align:left;padding:9px 10px;border:0;border-radius:6px;background:transparent;color:${C.paper};font:700 14px/1.2 ${F.ui};cursor:pointer}
.mpq button:hover{background:rgba(244,241,232,.08)}
.mpq button kbd{min-width:14px;font:800 12px/1 ${F.num};color:#35e0c2}
.mpq .sep{height:1px;margin:4px 6px;background:${C.line}}
body:not(.dc-playing) .mpq-btn,body:not(.dc-playing) .mpq,body.cmp-cine .mpq-btn{display:none}
/* a phone: beside the chat key over the arrows (the chat's new lines move along while in a room), the menu opening to
   their right */
body.dc-touch .mpq-btn{top:auto;left:calc(118px + env(safe-area-inset-left,0px));bottom:calc(108px + env(safe-area-inset-bottom,0px));min-height:34px;padding:6px 10px}
body.dc-touch .mpq-btn kbd{display:none}
body.dc-touch .mpq{top:auto;left:calc(200px + env(safe-area-inset-left,0px));bottom:calc(108px + env(safe-area-inset-bottom,0px));max-height:calc(100vh - 120px - env(safe-area-inset-bottom,0px));min-width:190px}
body.dc-touch .mpq button{padding:7px 10px}
body.dc-touch.mp-in .chat-feed{left:calc(220px + env(safe-area-inset-left,0px))}
.mpg{position:fixed;left:50%;top:70px;transform:translateX(-50%);z-index:30;pointer-events:none;min-width:240px;padding:8px 16px 9px;border-radius:10px;
  background:rgba(9,11,13,.7);color:#f4f1e8;font:600 13px ${F.ui};text-align:center;border-top:3px solid ${RACE_COLOR}}
.mpg[hidden]{display:none}
.mpg.cop{border-top-color:#3d7bff}.mpg.run{border-top-color:#ff5a4a}
.mpg .n{font-size:12px;color:#9fdcf2;letter-spacing:1px}
.mpg .t{font:800 30px/1.1 ${F.num};letter-spacing:1px}
.mpg .s{font-size:12px;color:#cfcac0}
.mpg .bar{height:5px;margin-top:5px;border-radius:3px;background:rgba(244,241,232,.15);overflow:hidden}
.mpg .bar i{display:block;height:100%;width:0;background:#ff5a4a}
.mpg .bar[hidden]{display:none}
.dc-touch .mpg{top:44px;min-width:180px}.dc-touch .mpg .t{font-size:22px}
.mpg-res{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:31;width:min(420px,calc(100vw - 32px));box-sizing:border-box;padding:16px 18px;border-radius:12px;
  background:#15191c;border:1px solid ${C.line};box-shadow:0 18px 60px rgba(0,0,0,.5);color:${C.paper};font-family:${F.ui};pointer-events:auto;cursor:pointer}
.mpg-res[hidden]{display:none}
body:not(.dc-playing) .mpg-res,body:not(.dc-playing) .mpg{display:none}
.mpg-res h3{margin:0 0 10px;font:800 16px/1.3 ${F.ui};color:#35e0c2}
.mpg-res .r{display:flex;gap:10px;padding:7px 0;border-top:1px solid ${C.line};font:700 14px/1.3 ${F.ui}}
.mpg-res .r .k{width:22px;color:${C.muted};font-family:${F.num}}
.mpg-res .r .n{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.mpg-res .r.win{color:#ffc21f}
.mpg-res .tip{margin-top:10px;font:500 12px/1.4 ${F.ui};color:${C.muted}}
`);

type Phase = 'prep' | 'count' | 'run' | 'over';
interface Game {
  kind: 'race' | 'chase'; gid: string; org: number; ps: number[];
  /** Still in it (not out, not gone). */
  in: Set<number>;
  ready: Set<number>;
  phase: Phase;
  /** This player plays (else they only watch it end). */
  mine: boolean;
  /** Seconds in this phase (our clock). */
  clock: number;
  course: number; runner: number;
  /** Race: who is in, with their time (null: out of it). */
  fin: Map<number, number | null>;
  firstFin: number;
}

export function install(engine: Engine): PlayApi | null {
  const mp = engine.get<MultiplayerApi>('mp');
  const pl = engine.get<PlayerApi>('player');
  if (!mp || !pl) return null;
  const veh = () => engine.get<VehicleApi>('vehicle')!;
  const nav = () => engine.get<NavApi>('nav');
  const trials = () => engine.get<TrialApi>('trials');
  const toast = (s: string, secs = 3) => engine.get<HudApi>('hud')?.toast(s, secs);
  const meId = () => mp.me?.id ?? -1;
  const nameOf = (id: number) => (id === meId() ? mp.me?.name ?? '' : mp.peers.find((p) => p.id === id)?.name ?? '?');
  const shoutText = (i: number) => t(`play.shout${i}` as 'play.shout0');

  // --- the panel, the countdown, the results card -----------------------------------------------------------
  const banner = new Banner();
  const panel = el('div', 'mpg', document.body); panel.hidden = true;
  const pName = el('div', 'n', panel), pTime = el('div', 't', panel), pSub = el('div', 's', panel);
  const pBar = el('div', 'bar', panel), pFill = el('i', '', pBar); pBar.hidden = true;
  const res = el('div', 'mpg-res', document.body); res.hidden = true;
  let resTimer = 0;
  res.addEventListener('click', () => { res.hidden = true; });
  const showResult = (r: PlayResult) => {
    res.textContent = '';
    el('h3', '', res).textContent = r.title;
    r.rows.forEach((row, i) => {
      const d = el('div', `r${row.win ? ' win' : ''}`, res);
      el('span', 'k', d).textContent = r.kind === 'race' ? String(i + 1) : '';
      el('span', 'n', d).textContent = row.name;
      el('span', '', d).textContent = row.text;
    });
    el('div', 'tip', res).textContent = t('play.resTip');
    res.hidden = false;
    clearTimeout(resTimer);
    resTimer = window.setTimeout(() => { res.hidden = true; }, 10000);
  };
  const nextMark = new Marker(engine.scene), finishMark = new Marker(engine.scene);

  // --- scores for this room ------------------------------------------------------------------------------------
  const scores = new Map<number, PlayScore>();
  const score = (id: number) => { let s = scores.get(id); if (!s) { s = { name: nameOf(id), raceWins: 0, escapes: 0, catches: 0 }; scores.set(id, s); } s.name = nameOf(id); return s; };
  let last: PlayResult | null = null;

  // --- the game ------------------------------------------------------------------------------------------------
  let game: Game | null = null;
  const hint = new Map<number, number>();
  let myS = 0, myHint = 0, next = 0, raceT = 0, offT = 0, outT = 0, myFin = false;
  let chaseT = 0, pulseT = 0, pulseAt: { x: number; z: number } | null = null, pulseShow = 0, holdT = 0, pulseTold = false;
  /** The player's own car while they drive a police car, and the police car (kept for the next round). */
  let ownCar: { car: Vehicle; look: CarLook } | null = null, copCar: Vehicle | null = null;

  const free = (): string | null => {
    const ui = engine.get<System & { state: string }>('ui')?.state;
    if (ui !== 'playing' && ui !== 'paused') return t('play.notInCity');
    if (engine.get<CampaignApi>('campaign')?.running) return t('play.busyStory');
    if (engine.get<RaceApi>('races')?.active || trials()?.active) return t('play.busyRace');
    return null;
  };
  const sendG = (op: string, data: Record<string, unknown> = {}) => { if (game) mp.send('g', { ...data, op, gid: game.gid }); };

  /** Out of the police car, back into your own, where it stands. */
  const ownBack = () => {
    mp.beacons = false;
    if (!ownCar) return;
    const v = veh(), cop = v.car, own = ownCar;
    ownCar = null;
    own.car.body.setEnabled(true);
    own.car.reset({ x: cop.pos.x, y: cop.pos.y + 0.1, z: cop.pos.z }, Math.atan2(cop.fwd.x, cop.fwd.z));
    const prev = v.swapCar(own.car, own.look);
    prev.car.body.setTranslation({ x: 0, y: -600, z: 0 }, false); prev.car.body.setEnabled(false);
  };
  /** Into a police car where your car stands; yours waits under the map. */
  const intoCopCar = () => {
    const v = veh(), was = v.car;
    copCar ??= new Vehicle(engine.physics, POLICE, { x: 0, y: -600, z: 0 }, 0);
    copCar.body.setEnabled(true);
    copCar.reset({ x: was.pos.x, y: was.pos.y + 0.1, z: was.pos.z }, Math.atan2(was.fwd.x, was.fwd.z));
    const prev = v.swapCar(copCar, { upper: new THREE.Color(POLICE_LIVERY.upper), lower: new THREE.Color(POLICE_LIVERY.lower), taxi: false, body: 'sedan', livery: POLICE_LIVERY });
    prev.car.body.setTranslation({ x: 0, y: -600, z: 0 }, false); prev.car.body.setEnabled(false);
    ownCar = prev;
  };

  /** This player's part is over: everything back as it was. */
  const wrapUp = () => {
    panel.hidden = true; pBar.hidden = true; banner.hide();
    nextMark.hide(); finishMark.hide();
    nav()?.clearTarget('mission');
    mp.hidden.clear();
    if (ownCar) ownBack();
    mp.beacons = false;
    veh().inputEnabled = true;
    pulseAt = null;
  };

  const finish = (r: PlayResult) => {
    if (game?.mine) wrapUp();
    game = null;
    last = r;
    showResult(r);
    changed();
  };

  const raceResult = (g: Game, list: [number, number | null][]): PlayResult => {
    const rows = list.slice().sort((a, b) => (a[1] ?? 1e9) - (b[1] ?? 1e9));
    const best = rows[0]?.[1] ?? null;
    if (best !== null) score(rows[0][0]).raceWins++;
    return {
      kind: 'race', title: t('play.raceDone', { course: trials()?.lines[g.course]?.name ?? '' }),
      rows: rows.map(([id, tm], i) => ({ name: nameOf(id), text: tm === null ? t('play.dnf') : i === 0 ? fmt(tm) : `${fmt(tm)}  +${(tm - best!).toFixed(1)}`, win: i === 0 && tm !== null })),
    };
  };
  const chaseResult = (g: Game, how: string, by: number, tm: number): PlayResult => {
    const runner = nameOf(g.runner);
    if (how === 'caught') { score(by).catches++; return { kind: 'chase', title: t('play.caughtTitle', { runner, cop: nameOf(by) }), rows: [{ name: runner, text: t('play.lasted', { t: mmss(tm) }), win: false }, { name: nameOf(by), text: t('play.gotHim'), win: true }] }; }
    if (how === 'escaped') { score(g.runner).escapes++; return { kind: 'chase', title: t('play.escapedTitle', { runner }), rows: [{ name: runner, text: t('play.lasted', { t: mmss(tm) }), win: true }] }; }
    return { kind: 'chase', title: t('play.chaseOff'), rows: [] };
  };

  // --- starting --------------------------------------------------------------------------------------------------
  const begin = (g: Game) => {
    game = g;
    hint.clear();
    if (!g.mine) { changed(); return; }
    const why = free();
    if (why) { g.mine = false; sendG('out'); toast(t('play.sittingOut', { why }), 4); changed(); return; }
    engine.get<WantedApi>('wanted')?.clear();
    res.hidden = true;
    myFin = false; next = 0; myS = 0; myHint = 0; raceT = 0; offT = 0; outT = 0; chaseT = 0; pulseT = 0; holdT = 0; pulseTold = false;
    const tr = trials();
    if (g.kind === 'race' && tr) {
      // the grid: two by two behind the gate, in the order of the list
      const k = g.ps.indexOf(meId()), [x, y, z, yaw] = tr.grid(g.course, 14 + Math.floor(k / 2) * 9, k % 2 ? 1.8 : -1.8);
      toast(t('play.raceStart', { who: nameOf(g.org), course: tr.lines[g.course].name }), 4);
      void mp.warp({ x, y, z, yaw }, { exact: true, hold: true }).then((ok) => {
        if (game !== g || !g.mine) { if (ok) veh().inputEnabled = true; return; }
        if (!ok) { g.mine = false; sendG('out'); changed(); return; }
        ready(g, meId());
        sendG('ready');
      });
    } else if (g.kind === 'chase') {
      if (g.runner === meId()) {
        toast(t('play.youRun'), 5);
        ready(g, meId()); sendG('ready');
      } else {
        // a lane COP_RING m from the runner, the police spread round them (turning on until one has a lane)
        const r = mp.peers.find((p) => p.id === g.runner), v = veh();
        const cops = g.ps.filter((id) => id !== g.runner), k = Math.max(0, cops.indexOf(meId()));
        let at: { x: number; y: number; z: number; yaw: number } | null = null;
        for (let j = 0; r && !at && j < 12; j++) {
          const a = (k / Math.max(1, cops.length)) * Math.PI * 2 + 0.7 + j * 0.5, d = COP_RING * (j < 6 ? 1 : 0.7);
          const lane = v.roadPoseNear?.(r.x + Math.sin(a) * d, 2, r.z + Math.cos(a) * d);
          if (lane) at = { x: lane.pos.x, y: lane.pos.y, z: lane.pos.z, yaw: lane.yaw };
        }
        const go = at ? mp.warp(at, { exact: true, hold: true }) : Promise.resolve(true);
        toast(t('play.youCop', { runner: nameOf(g.runner) }), 5);
        void go.then((ok) => {
          if (game !== g || !g.mine) { if (ok) veh().inputEnabled = true; return; }
          intoCopCar();
          veh().inputEnabled = false;
          ready(g, meId()); sendG('ready');
        });
      }
    }
    changed();
  };

  const ready = (g: Game, id: number) => {
    g.ready.add(id);
    if (g.org === meId() && g.phase === 'prep' && [...g.in].every((p) => g.ready.has(p))) go(g);
  };
  /** The starter's word: off we go (everyone counts down from it). */
  const go = (g: Game) => {
    if (g.phase !== 'prep') return;
    // whoever is not ready by now is not in it (the starter's word; the others take its list)
    if (g.org === meId()) {
      for (const id of [...g.in]) if (!g.ready.has(id)) g.in.delete(id);
      sendG('go', { in: [...g.in] });
    }
    g.phase = 'count'; g.clock = 0;
    if (g.mine) {
      panel.hidden = false;
      panel.className = g.kind === 'race' ? 'mpg' : g.runner === meId() ? 'mpg run' : 'mpg cop';
      if (g.kind === 'chase' && g.runner === meId()) veh().inputEnabled = true;
    }
  };

  // --- what the others say ---------------------------------------------------------------------------------------
  mp.onEvent((from, m) => {
    if (m.k === 'say') {
      const i = Number(m.i);
      if (!(i >= 0 && i < SHOUTS)) return;
      mp.say(from, shoutText(i));
      const p = mp.peers.find((q) => q.id === from);
      if (!p || p.dist < 0 || p.dist > 80) toast(`${nameOf(from)}：${shoutText(i)}`);
      return;
    }
    if (m.k === 'ping') {
      const x = Number(m.x), z = Number(m.z);
      if (!Number.isFinite(x) || !Number.isFinite(z) || Math.abs(x) > 1e5 || Math.abs(z) > 1e5) return;
      if (game?.mine && game.phase !== 'over') return;
      following = null;
      nav()?.setTarget({ x, z, kind: 'waypoint', label: t('play.pingLabel', { name: nameOf(from) }) });
      toast(t(m.w ? 'play.pingWaypoint' : 'play.pingHere', { name: nameOf(from) }), 4);
      return;
    }
    if (m.k !== 'g') return;
    const gid = String(m.gid ?? '');
    if (m.op === 'start') {
      if (game && game.phase !== 'over') return;
      const ps = Array.isArray(m.ps) ? (m.ps as unknown[]).map(Number).filter(Number.isFinite) : [];
      const kind = m.g === 'chase' ? 'chase' : 'race';
      const g: Game = { kind, gid, org: from, ps, in: new Set(ps), ready: new Set(), phase: 'prep', mine: ps.includes(meId()), clock: 0,
        course: Number(m.c) || 0, runner: Number(m.runner), fin: new Map(), firstFin: -1 };
      if (kind === 'race' && !trials()?.lines[g.course]) return;
      begin(g);
      return;
    }
    const g = game;
    if (!g || gid !== g.gid) return;
    if (m.op === 'out') { g.in.delete(from); if (g.org === meId() && g.phase === 'prep' && [...g.in].every((p) => g.ready.has(p))) go(g); changed(); }
    else if (m.op === 'ready') ready(g, from);
    else if (m.op === 'go' && from === g.org) {
      if (Array.isArray(m.in)) {
        g.in = new Set((m.in as unknown[]).map(Number));
        for (const id of g.in) g.ready.add(id);
        if (!g.in.has(meId()) && g.mine) { g.mine = false; wrapUp(); toast(t('play.tooSlow')); }
      }
      go(g);
    } else if (m.op === 'fin' && g.kind === 'race') {
      const tm = m.tm === null ? null : Number(m.tm);
      g.fin.set(from, tm !== null && Number.isFinite(tm) ? tm : null);
      if (tm !== null && Number.isFinite(tm)) { if (g.firstFin < 0) g.firstFin = g.clock; toast(t('play.finToast', { name: nameOf(from), t: fmt(tm) })); }
      raceMaybeDone(g);
    } else if (m.op === 'end' && from === g.org && g.kind === 'race') {
      const list = Array.isArray(m.res) ? (m.res as unknown[]).map((r) => (Array.isArray(r) ? [Number(r[0]), r[1] === null ? null : Number(r[1])] as [number, number | null] : null)).filter((r): r is [number, number | null] => !!r) : [];
      finish(raceResult(g, list));
    } else if (m.op === 'chase' && g.kind === 'chase' && (from === g.runner || from === g.org)) {
      finish(chaseResult(g, String(m.how), Number(m.by), Number(m.tm) || 0));
    } else if (m.op === 'stop' && from === g.org) {
      if (g.mine) toast(t('play.stopped', { name: nameOf(from) }));
      finish({ kind: g.kind, title: t('play.called'), rows: [] });
    }
  });

  mp.onGone((id) => {
    if (following === id) following = null;
    const g = game;
    if (!g) return;
    if (id === g.org && id !== meId()) { toast(t('play.orgLeft', { name: nameOf(id) })); finish({ kind: g.kind, title: t('play.called'), rows: [] }); return; }
    g.in.delete(id);
    if (g.kind === 'chase' && id === g.runner) { finish(chaseResult(g, 'left', 0, 0)); return; }
    if (g.kind === 'race') { if (!g.fin.has(id)) g.fin.set(id, null); raceMaybeDone(g); }
    if (g.org === meId() && g.phase === 'prep' && [...g.in].every((p) => g.ready.has(p))) go(g);
  });

  /** The starter's game ends the race once everyone is in (or out). */
  const raceMaybeDone = (g: Game) => {
    if (g.org !== meId() || g.phase === 'over') return;
    const all = [...g.in].every((id) => g.fin.has(id));
    const late = g.firstFin >= 0 && g.clock - g.firstFin > FINISH_WAIT;
    if (!all && !late) return;
    const list: [number, number | null][] = [...new Set([...g.ps])].filter((id) => g.ready.has(id)).map((id) => [id, g.fin.get(id) ?? null]);
    g.phase = 'over';
    mp.send('g', { op: 'end', gid: g.gid, res: list });
    finish(raceResult(g, list));
  };

  // --- each step ---------------------------------------------------------------------------------------------------
  const raceStep = (g: Game, dt: number) => {
    const tr = trials(); if (!tr) return;
    const ln = tr.lines[g.course], v = veh(), car = v.car;
    if (g.phase === 'count') {
      const n = 3 - Math.floor(g.clock);
      banner.show(n > 0 ? String(n) : t('race.go'), n > 0 ? '#f4f4f1' : '#ffc21f');
      if (g.clock >= 3) { g.phase = 'run'; g.clock = 0; v.inputEnabled = true; showRaceMarks(ln); }
      return;
    }
    if (g.phase !== 'run') return;
    if (g.clock > 1) banner.hide();
    if (myFin) return;
    raceT += dt;
    const a = tr.along(g.course, car.pos.x, car.pos.z, myHint);
    myHint = a.i; myS = Math.max(myS, a.s);
    if (a.s >= ln.cps[next] - 4 && a.d < ln.hw + 14) {
      next++;
      if (next >= ln.cps.length) {
        myFin = true;
        g.fin.set(meId(), raceT);
        if (g.firstFin < 0) g.firstFin = g.clock;
        sendG('fin', { tm: Math.round(raceT * 100) / 100 });
        const place = [...g.fin.values()].filter((x) => x !== null).length;
        banner.show(t('play.place', { n: place }), place === 1 ? '#ffc21f' : '#f4f4f1');
        setTimeout(() => banner.hide(), 3000);
        nextMark.hide(); finishMark.hide(); nav()?.clearTarget('mission');
        raceMaybeDone(g);
        return;
      }
      showRaceMarks(ln);
    }
    offT = a.d > RACE_OFF ? offT + dt : 0;
    outT = pl.mode !== 'driving' || v.power <= 0 ? outT + dt : 0;
    if (offT > RACE_OFF_T || outT > OUT_OF_CAR_T) {
      myFin = true;
      g.fin.set(meId(), null);
      sendG('fin', { tm: null });
      toast(t('play.youDnf'));
      nextMark.hide(); finishMark.hide(); nav()?.clearTarget('mission');
      raceMaybeDone(g);
    }
  };
  const showRaceMarks = (ln: { cps: readonly number[]; len: number }) => {
    const tr = trials()!, i = game!.course;
    const [nx, nz] = tr.pointAt(i, ln.cps[next]), [fx, fz] = tr.pointAt(i, ln.len);
    if (next < ln.cps.length - 1) nextMark.show(nx, nz, RACE_COLOR, 1.8); else nextMark.hide();
    finishMark.show(fx, fz, FINISH_COLOR, 2.2);
    nav()?.setTarget({ x: nx, z: nz, kind: 'mission', label: t('play.raceLabel') });
  };
  /** Where the others are along the course, and so this player's place. */
  const racePlace = (g: Game): number => {
    const tr = trials()!;
    let ahead = 0;
    const mine = g.fin.get(meId());
    for (const p of mp.peers) {
      if (!g.in.has(p.id)) continue;
      const f = g.fin.get(p.id);
      if (f !== undefined) { if (f !== null && (mine === undefined || mine === null || f < mine)) ahead++; continue; }
      if (mine !== undefined && mine !== null) continue;
      const a = tr.along(g.course, p.x, p.z, hint.get(p.id) ?? 0, 60);
      hint.set(p.id, a.i);
      if (a.s > myS) ahead++;
    }
    return ahead + 1;
  };

  const chaseStep = (g: Game, dt: number) => {
    const runner = g.runner === meId(), v = veh();
    if (g.phase === 'count') {
      // the police wait HEAD_START s; the runner is off at once
      const left = HEAD_START - g.clock;
      if (!runner) banner.show(left > 0 ? t('play.copsWait', { n: Math.ceil(left) }) : t('play.copsGo'), left > 0 ? '#9fc3ff' : '#ffc21f');
      else banner.show(left > 0 ? t('play.runNow', { n: Math.ceil(left) }) : t('play.copsOut'), '#ff8a7a');
      if (left <= 0) { g.phase = 'run'; g.clock = 0; if (!runner) { v.inputEnabled = true; mp.beacons = true; } }
      if (g.phase === 'count') { chaseT += dt; return; }
    }
    if (g.phase !== 'run') return;
    if (g.clock > 2) banner.hide();
    chaseT += dt;
    if (runner) {
      // caught: a police car close by while we are all but stopped, for CATCH_T s
      let near = Infinity, by = -1;
      for (const p of mp.peers) if (g.in.has(p.id) && p.id !== g.runner && p.dist >= 0 && p.dist < near) { near = p.dist; by = p.id; }
      const speed = pl.mode === 'driving' ? v.car.speed : Math.hypot(pl.foot?.vel.x ?? 0, pl.foot?.vel.z ?? 0);
      holdT = near < CATCH_D && speed < CATCH_V ? holdT + dt : Math.max(0, holdT - dt * 2);
      if (holdT >= CATCH_T && by >= 0) { sendG('chase', { how: 'caught', by, tm: Math.round(chaseT) }); finish(chaseResult(g, 'caught', by, chaseT)); return; }
      if (chaseT >= CHASE_S + HEAD_START) { sendG('chase', { how: 'escaped', by: 0, tm: CHASE_S }); finish(chaseResult(g, 'escaped', 0, CHASE_S)); return; }
      return;
    }
    // police: the runner seen close by, else a flash on the map now and then
    const r = mp.peers.find((p) => p.id === g.runner);
    const seen = !!r && r.dist >= 0 && r.dist < SEEN;
    if (seen) mp.hidden.delete(g.runner); else mp.hidden.add(g.runner);
    pulseT -= dt; pulseShow -= dt;
    if (pulseT <= 0 && r && r.dist >= 0) {
      pulseT = PULSE; pulseShow = PULSE_SHOW; pulseAt = { x: r.x, z: r.z };
      if (!pulseTold) { pulseTold = true; toast(t('play.pulseTip'), 5); }
    }
  };

  // --- the quick menu (G) ------------------------------------------------------------------------------------------
  let following: number | null = null, followT = 0, followSet = false;
  const followLabel = (id: number) => t('play.followLabel', { name: nameOf(id) });
  const hudRoot = () => document.querySelector('.hud') as HTMLElement | null ?? document.body;
  const qBtn = el('button', 'mpq-btn', hudRoot());
  qBtn.innerHTML = '';
  const qLabel = el('span', '', qBtn); qLabel.textContent = t('play.menu');
  el('kbd', '', qBtn).textContent = 'G';
  qBtn.hidden = true;
  const menu = el('div', 'mpq', document.body); menu.hidden = true;
  for (const ev of ['pointerdown', 'pointerup', 'mousedown'] as const) { qBtn.addEventListener(ev, (e) => e.stopPropagation()); menu.addEventListener(ev, (e) => e.stopPropagation()); }
  qBtn.addEventListener('click', () => toggleMenu());
  let items: (() => void)[] = [];
  const toggleMenu = (open = menu.hidden) => {
    menu.hidden = !open;
    if (!open) return;
    menu.textContent = '';
    items = [];
    const add = (label: string, fn: () => void) => {
      const n = items.length + 1;
      const b = el('button', '', menu);
      el('kbd', '', b).textContent = n <= 9 ? String(n) : '';
      el('span', '', b).textContent = label;
      items.push(fn);
      b.addEventListener('click', () => { toggleMenu(false); fn(); });
    };
    for (let i = 0; i < SHOUTS; i++) add(shoutText(i), () => api.shout(i));
    el('div', 'sep', menu);
    add(t('play.gather'), () => api.gather());
    const wp = nav()?.target;
    if (wp?.kind === 'waypoint') add(t('play.shareWaypoint'), () => { mp.send('ping', { x: Math.round(wp.x), z: Math.round(wp.z), w: 1 }); toast(t('play.sentWaypoint')); });
    if (mp.peers.length) el('div', 'sep', menu);
    for (const p of mp.peers) {
      if (p.dist < 0 || mp.hidden.has(p.id)) continue;
      add(following === p.id ? t('play.unfollow', { name: p.name }) : t('play.follow', { name: p.name }), () => api.follow(following === p.id ? null : p.id));
    }
  };
  // G, and a number while the menu is up (before the game's own keys: 1-3 also pick a dialogue's answers)
  addEventListener('keydown', (e: KeyboardEvent) => {
    if (mp.status !== 'in' || !document.body.classList.contains('dc-playing') || e.repeat) return;
    const tg = e.target as HTMLElement | null;
    if (tg && (tg.tagName === 'INPUT' || tg.tagName === 'TEXTAREA')) return;
    if (e.code === 'KeyG') { toggleMenu(); e.stopImmediatePropagation(); return; }
    if (!menu.hidden) {
      const n = /^(Digit|Numpad)(\d)$/.exec(e.code);
      if (n) { const fn = items[Number(n[2]) - 1]; toggleMenu(false); fn?.(); e.stopImmediatePropagation(); }
      else if (e.code === 'Escape') { toggleMenu(false); e.stopImmediatePropagation(); }
    }
  }, true);

  // radar: where the runner was last seen
  const blips: Blip[] = [];
  let blipsOn = false;

  const listeners: (() => void)[] = [];
  const changed = () => { for (const fn of listeners) fn(); };

  const api: PlayApi & { listen(fn: () => void): void } = {
    name: 'play',
    get active() { return !!game?.mine && game.phase !== 'over'; },
    get running() {
      if (!game || game.phase === 'over') return null;
      const title = game.kind === 'race' ? t('play.runningRace', { course: trials()?.lines[game.course]?.name ?? '' }) : t('play.runningChase', { runner: nameOf(game.runner) });
      return { title, mine: game.org === meId() };
    },
    get last() { return last; },
    get scores() { return [...scores.values()]; },
    get courses() { return (trials()?.lines ?? []).map((l) => ({ name: l.name, len: l.len })); },
    listen(fn) { listeners.push(fn); },
    startRace(course) {
      if (game && game.phase !== 'over') return t('play.already');
      const why = free(); if (why) return why;
      if (!trials()?.lines[course]) return t('play.noCourse');
      const ps = [meId(), ...mp.peers.filter((p) => p.dist >= 0).map((p) => p.id)];
      const gid = `${meId()}-${Date.now().toString(36)}`;
      mp.send('g', { op: 'start', g: 'race', gid, ps, c: course });
      begin({ kind: 'race', gid, org: meId(), ps, in: new Set(ps), ready: new Set(), phase: 'prep', mine: true, clock: 0, course, runner: -1, fin: new Map(), firstFin: -1 });
      return null;
    },
    startChase(runner) {
      if (game && game.phase !== 'over') return t('play.already');
      const why = free(); if (why) return why;
      const ps = [meId(), ...mp.peers.filter((p) => p.dist >= 0).map((p) => p.id)];
      if (ps.length < 2) return t('play.needTwo');
      if (!ps.includes(runner)) return t('play.noRunner');
      const gid = `${meId()}-${Date.now().toString(36)}`;
      mp.send('g', { op: 'start', g: 'chase', gid, ps, runner });
      begin({ kind: 'chase', gid, org: meId(), ps, in: new Set(ps), ready: new Set(), phase: 'prep', mine: true, clock: 0, course: 0, runner, fin: new Map(), firstFin: -1 });
      return null;
    },
    stop() {
      const g = game;
      if (!g || g.org !== meId()) return;
      sendG('stop');
      finish({ kind: g.kind, title: t('play.called'), rows: [] });
    },
    shout(i) {
      if (mp.status !== 'in' || i < 0 || i >= SHOUTS) return;
      mp.send('say', { i });
      toast(`${t('play.me')}：${shoutText(i)}`);
    },
    gather() {
      const p = pl.position;
      mp.send('ping', { x: Math.round(p.x), z: Math.round(p.z), w: 0 });
      toast(t('play.gathered'));
    },
    follow(id) {
      following = id; followT = 0; followSet = false;
      if (id === null) { if (nav()?.target?.kind === 'waypoint') nav()?.clearTarget('waypoint'); return; }
      toast(t('play.following', { name: nameOf(id) }));
    },
    get following() { return following; },
    fixedUpdate(dt) {
      const g = game;
      if (g) {
        g.clock += dt;
        if (g.phase === 'prep' && g.org === meId() && g.clock > READY_WAIT) go(g);
        if (g.mine && g.phase !== 'prep' && g.phase !== 'over') { if (g.kind === 'race') raceStep(g, dt); else chaseStep(g, dt); }
        if (g.kind === 'race' && g.phase === 'run') raceMaybeDone(g);
      }
      // the GPS after a friend
      if (following !== null) {
        followT -= dt;
        if (followT <= 0) {
          followT = FOLLOW_EVERY;
          const p = mp.peers.find((q) => q.id === following), n = nav();
          const tg = n?.target;
          // a waypoint of the player's own (or none: cleared on the map) ends it
          if (!p || !n || p.dist < 0 || (followSet && (tg?.kind !== 'waypoint' || tg.label !== followLabel(p.id)))) following = null;
          else if (p.dist < FOLLOW_NEAR) { toast(t('mp.arrived', { name: p.name })); following = null; if (n.target?.kind === 'waypoint') n.clearTarget('waypoint'); }
          else { n.setTarget({ x: p.x, z: p.z, kind: 'waypoint', label: followLabel(p.id) }); followSet = true; }
        }
      }
    },
    update(dt) {
      const inRoom = mp.status === 'in';
      qBtn.hidden = !inRoom;
      document.body.classList.toggle('mp-in', inRoom);
      if (!inRoom && !menu.hidden) menu.hidden = true;
      if (!inRoom && game) { if (game.mine) wrapUp(); game = null; changed(); }
      nextMark.update(dt); finishMark.update(dt);
      const n = nav();
      if (n && !blipsOn) {
        blipsOn = true;
        n.addBlips(() => {
          blips.length = 0;
          if (pulseAt && pulseShow > 0 && game?.kind === 'chase' && game.runner !== meId()) blips.push({ kind: 'suspect', x: pulseAt.x, z: pulseAt.z, flash: true, label: nameOf(game.runner) });
          return blips;
        });
      }
      const g = game;
      if (!g || !g.mine || g.phase === 'prep' || g.phase === 'over') return;
      // the police car's light bar
      if (mp.beacons) { const [r, b] = beaconFlash(performance.now() / 1000); veh().model.setBeacons(r, b); }
      if (g.kind === 'race') {
        const tr = trials(); if (!tr) return;
        const ln = tr.lines[g.course];
        pName.textContent = `${t('play.raceName')} · ${ln.name} · ${(ln.len / 1000).toFixed(1)} km`;
        pTime.textContent = fmt(raceT);
        const total = g.in.size;
        pSub.textContent = myFin ? t('play.waitOthers') : t('play.raceSub', { i: next, n: ln.cps.length, pos: racePlace(g), of: total });
        pBar.hidden = true;
      } else {
        const runner = g.runner === meId();
        const left = Math.max(0, CHASE_S - (g.phase === 'run' ? g.clock : 0));
        pName.textContent = runner ? t('play.youAreRunner') : t('play.youAreCop', { runner: nameOf(g.runner) });
        pTime.textContent = mmss(left);
        if (runner) {
          let near = Infinity;
          for (const p of mp.peers) if (g.in.has(p.id) && p.dist >= 0) near = Math.min(near, p.dist);
          pSub.textContent = near < Infinity ? t('play.nearestCop', { d: Math.round(near) }) : '';
          pBar.hidden = holdT <= 0; pFill.style.width = `${Math.min(100, (holdT / CATCH_T) * 100)}%`;
        } else {
          const r = mp.peers.find((p) => p.id === g.runner);
          pSub.textContent = r && r.dist >= 0 && r.dist < SEEN ? t('play.runnerHere', { d: Math.round(r.dist) }) : t('play.runnerPulse', { n: Math.max(0, Math.ceil(pulseT)) });
          pBar.hidden = true;
        }
      }
    },
  };
  engine.add(api);
  return api;
}
