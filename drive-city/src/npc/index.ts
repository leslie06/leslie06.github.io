import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { lang, t, type TKey } from '../core/I18n';
import { Rng } from '../core/Rng';
import type { Actor, Blip, DialogueApi, HudApi, MissionApi, NavApi, PeopleApi, PlayerApi, RaceApi, Speaker, VehicleApi, WantedApi } from '../game/Contracts';
import type { GarageApi } from '../garage';
import type { IntroApi } from '../intro';
import type { NavSystem } from '../nav';
import type { TrafficApi } from '../traffic';
import type { Link } from '../traffic/LaneGraph';
import type { Vehicle } from '../vehicle/Vehicle';
import { randomLook, type Look } from '../character/Body';
import { nearestKerb, SIDEWALK } from '../people/Pavement';
import { Marker } from '../missions/Marker';
import { PLAYER_LOOK } from '../player';
import { journalOf } from './Journal';
import { pickAddress, type Stop } from '../missions/Address';
import { LANDMARKS } from '../city/landmarks';
import { project } from '../city/Geo';
import { SPEC_OF } from '../vehicle/Spec';
import { Vehicle as VehicleClass } from '../vehicle/Vehicle';
import type { RenderApi } from '../game/Contracts';
import type { Action } from '../character/Animator';

/** Seconds of free play before the first encounter, and between them. */
const FIRST = [30, 50], GAP = [50, 90];
/** Pay. */
export const BAG_REWARD = 200, BAG_KEEP = 300, SCAM_ASK = 200, RAGE_ASK = 100;
const THIEF_SPEED = 5.0;
const DASHCAM_KEY = 'drivecity.dashcam';

type Kind = 'thief' | 'scam' | 'pregnant' | 'rage' | 'courier' | 'daijia' | 'tail' | 'foreigner';

export interface NpcApi extends System {
  /** The encounter running now, or null. */
  readonly active: Kind | null;
  /** A dashcam is fitted (the garage sells it; a scammer who sees it runs). */
  dashcam: boolean;
  debug: { start(kind: Kind): boolean; wait(): number; state(): Record<string, unknown> };
}

const C = { victim: '#7fc8ff', thief: '#ff6b5a', scam: '#d9a441', rage: '#ff5a3c', husband: '#6fd18a', wife: '#ff8fb8', you: '#f3b50f' };

/**
 * Street encounters (P1 of the NPC plan): people in the world who want something from the player,
 * a minute or two each, one at a time, never over a mission, a race, the story or the police -
 *   thief      a bag snatched on the pavement nearby: run or drive the thief down, then give the bag
 *              back (BAG_REWARD) or keep it (BAG_KEEP and a star when the owner calls it in);
 *   scam       碰瓷: a man throws himself at your slow car and wants SCAM_ASK; pay, drive off (he
 *              reports it) or show the dashcam (he is suddenly well enough to sprint);
 *   pregnant   a husband waving at the kerb: his wife is in labour, the nearest hospital, and every
 *              bump costs you;
 *   rage       not scheduled: ram a car and its driver may get out and come for you.
 * Everyone here is a scripted pedestrian (PeopleApi.spawnActor), talks in the dialogue box or over
 * their head, and goes in the journal (人物志).
 */
export async function install(engine: Engine): Promise<void> {
  const tr = engine.get<TrafficApi>('traffic');
  const pl = engine.get<PlayerApi>('player');
  const people = engine.get<PeopleApi>('people');
  if (!tr || !pl || !people?.spawnActor) return;
  const g = tr.graph;
  const q = new URLSearchParams(location.search);
  const auto = !q.has('shot') || q.get('npc') === '1';
  const rng = new Rng(5150);
  const rnd = () => rng.next();
  const journal = journalOf(engine);
  const marker = new Marker(engine.scene), marker2 = new Marker(engine.scene);
  let dashcam = false;
  try { dashcam = localStorage.getItem(DASHCAM_KEY) === '1'; } catch { /* private mode */ }

  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const missions = () => engine.get<MissionApi>('missions');
  const dlg = () => engine.get<DialogueApi>('dialogue');
  const nav = () => engine.get<NavApi>('nav');
  const wanted = () => engine.get<WantedApi>('wanted');
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const story = (s: string | null) => { const m = missions(); if (m) m.story = s; };
  const cash = () => missions()?.cash ?? 0;
  const pay = (n: number) => missions()?.addCash(n);
  const fmt = (s: number) => `${Math.floor(Math.max(0, s) / 60)}:${String(Math.floor(Math.max(0, s) % 60)).padStart(2, '0')}`;
  const speaker = (a: Actor | null, key: TKey, color: string, look?: Look): Speaker => ({ name: t(key), color, look: a?.look ?? look, voice: a?.voice, at: a ? a.pos : null });
  const you = (): Speaker => ({ name: t('npc.who.you'), color: C.you, look: PLAYER_LOOK });
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  /** Where the player is and which way they look (the car's nose, or the camera on foot). */
  const camDir = new THREE.Vector3();
  const facing = () => {
    if (pl.mode === 'driving') { const c = vehicle().car; return { x: c.fwd.x, z: c.fwd.z }; }
    engine.camera.getWorldDirection(camDir); const l = Math.hypot(camDir.x, camDir.z) || 1; return { x: camDir.x / l, z: camDir.z / l };
  };

  // ---------------------------------------------------------------- looks

  const looks = {
    victim: (): Look => { const l = randomLook(rnd); l.fem = rnd() < 0.65 ? 1 : 0; return l; },
    thief: (): Look => {
      const l = randomLook(rnd);
      l.fem = 0; l.top = 'hoodie'; l.shirt = new THREE.Color(pick(['#1d1f23', '#2b2f36', '#3a3f2c'])); l.inner = l.shirt.clone(); l.sleeve = 0.53;
      l.bottom = 'trousers'; l.hem = 0.8; l.pants = new THREE.Color('#15171b'); l.age = 0.2; l.mask = rnd() < 0.5 ? new THREE.Color('#1b1c1e') : null;
      l.cap = rnd() < 0.5 ? new THREE.Color('#121314') : null; l.print = false;
      return l;
    },
    oldMan: (): Look => {
      const l = randomLook(rnd);
      l.fem = 0; l.age = 0.72 + rnd() * 0.2; l.top = pick(['jacket', 'shirt'] as const); l.shirt = new THREE.Color(pick(['#4a4f45', '#5b5246', '#2f3a4a', '#6b6b63'])); l.inner = new THREE.Color('#d9d6cc');
      l.bottom = 'trousers'; l.hem = 0.8; l.pants = new THREE.Color(pick(['#2a2c2f', '#3b3a36'])); l.hairStyle = pick(['buzz', 'bald', 'short'] as const); l.cap = null; l.print = false;
      return l;
    },
    driver: (): Look => { const l = randomLook(rnd); l.fem = rnd() < 0.2 ? 1 : 0; l.age = 0.3 + rnd() * 0.35; if (l.top === 'tee' && rnd() < 0.5) l.top = 'shirt'; return l; },
    husband: (): Look => { const l = randomLook(rnd); l.fem = 0; l.age = 0.25 + rnd() * 0.15; l.top = 'shirt'; l.print = false; return l; },
    wife: (): Look => {
      const l = randomLook(rnd);
      l.fem = 1; l.age = 0.25 + rnd() * 0.12; l.build = 0.75; l.top = 'coat'; l.shirt = new THREE.Color(pick(['#e7b9c4', '#d9c6a5', '#b7c9d9'])); l.inner = new THREE.Color('#f2efe8'); l.sleeve = 0.53;
      l.bottom = 'trousers'; l.hem = 0.8; l.mask = null; l.cap = null;
      return l;
    },
  };

  // ---------------------------------------------------------------- geometry

  /** Links arriving at each node (LaneGraph keeps the ones leaving). */
  const inn: number[][] = g.out.map(() => []);
  for (const l of g.links) inn[l.to].push(l.id);
  /** A run along the pavements from near (x, z), heading away from (ax, az): [x, z, ...] every 3 m, `len` m. */
  const pavementRun = (x: number, z: number, ax: number, az: number, len: number): number[] | null => {
    const k = nearestKerb(g, x, z, 18, 1.2);
    if (!k) return null;
    let l: Link = g.links[k.link], s = k.s, side = k.side;
    g.at(l, s, 0, at);
    let dir = at.dx * (x - ax) + at.dz * (z - az) >= 0 ? 1 : -1;
    const pts: number[] = [];
    let left = len, hx = at.dx * dir, hz = at.dz * dir;
    for (let guard = 0; guard < 40 && left > 0; guard++) {
      const end = dir > 0 ? l.len : 0;
      for (let u = s; dir > 0 ? u < end : u > end; u += dir * 3) {
        g.at(l, u, side * (l.hw + 0.6), at);   // along the kerb edge (a car can brush him off it)
        pts.push(at.x, at.z); hx = at.dx * dir; hz = at.dz * dir;
        if ((left -= 3) <= 0) break;
      }
      if (left <= 0) break;
      // On round the corner: the straightest road on from this node, either way along it (not back
      // the way it came). A one-way street is run against its traffic as happily as with it.
      const node = dir > 0 ? l.to : l.from;
      let best = -1, bd = -0.2, bdir = 1;
      const consider = (c: number, d: number) => {
        if (c === l.id || c === l.rev) return;
        const o = g.links[c];
        if (o.hmax > 0.3 || o.len < 4) return;
        g.at(o, d > 0 ? Math.min(4, o.len / 2) : Math.max(o.len - 4, o.len / 2), 0, at);
        const dot = (at.dx * hx + at.dz * hz) * d;
        if (dot > bd) { bd = dot; best = c; bdir = d; }
      };
      for (const c of g.out[node]) consider(c, 1);
      for (const c of inn[node]) consider(c, -1);
      if (best < 0) break;
      side = side * dir * bdir; dir = bdir; l = g.links[best]; s = dir > 0 ? 0 : l.len;
    }
    return pts.length >= 6 ? pts : null;
  };

  /** The player's road and how far along it they are (the link heading their way). */
  const onRoad = (c: Vehicle): { l: Link; s: number } | null => {
    let best: Link | null = null, bd = 12, bs = 0;
    for (const id of g.near(c.pos.x, c.pos.z, 30)) {
      const l = g.links[id], pr = g.project(l, c.pos.x, c.pos.z, l.len / 2);
      g.at(l, pr.s, 0, at);
      if (at.dx * c.fwd.x + at.dz * c.fwd.z < 0.5 || pr.d >= bd) continue;
      bd = pr.d; best = l; bs = pr.s;
    }
    return best ? { l: best, s: bs } : null;
  };

  // ---------------------------------------------------------------- state

  let active: Kind | null = null, wait = FIRST[0] + rnd() * (FIRST[1] - FIRST[0]), clock = 0, phase = '', phaseT = 0, rageCool = 20;
  let cast: Actor[] = [];
  const later: { t: number; fn: () => void }[] = [];
  const after = (secs: number, fn: () => void) => later.push({ t: secs, fn });
  const blips: Blip[] = [];
  const setPhase = (p: string) => { phase = p; phaseT = 0; };

  const end = (msg: string | null) => {
    if (msg) toast(msg);
    for (const a of cast) if (a.alive) a.release('walk');
    cast = [];
    active = null; phase = '';
    story(null);
    nav()?.clearTarget('mission');
    marker.hide(); marker2.hide();
    wait = GAP[0] + rnd() * (GAP[1] - GAP[0]);
  };
  /** Let a cast member go now (and out of `end`'s hands). */
  const letGo = (a: Actor, how: 'walk' | 'flee' | 'vanish') => { a.release(how); cast = cast.filter((x) => x !== a); };

  const free = () => {
    const ui = engine.get<{ name: string; state: string }>('ui');
    if (ui && ui.state !== 'playing') return false;
    const v = vehicle(), m = missions(), intro = engine.get<IntroApi>('intro')?.step;
    return v.inputEnabled && !v.autopilot && !pl.riding && (wanted()?.level ?? 0) === 0 && !engine.get<RaceApi>('races')?.active
      && !m?.busy && !m?.story && !engine.get<GarageApi>('garage')?.open && (intro === undefined || intro === 'off' || intro === 'done')
      && !engine.get<{ name: string; active: unknown }>('events')?.active && !dlg()?.busy;
  };

  // ---------------------------------------------------------------- thief

  const T = { victim: null as Actor | null, thief: null as Actor | null, home: new THREE.Vector3(), bag: new THREE.Vector3(), lost: 0, run: null as number[] | null };

  const startThief = (): boolean => {
    const P = pl.position, f = facing();
    for (let k = 0; k < 24; k++) {
      const ang = (rnd() - 0.5) * 1.2, d = 28 + rnd() * 26;
      const dx = f.x * Math.cos(ang) - f.z * Math.sin(ang), dz = f.x * Math.sin(ang) + f.z * Math.cos(ang);
      const kb = nearestKerb(g, P.x + dx * d, P.z + dz * d, 14, 1.4);
      if (!kb) continue;
      const kd = Math.hypot(kb.x - P.x, kb.z - P.z);
      if (kd < 20 || kd > 65) continue;
      // The thief comes from behind the victim and runs on away from the player.
      const run = pavementRun(kb.x, kb.z, P.x, P.z, 300);
      if (!run || run.length < 120) continue;   // 60 m of pavement at least
      const yaw = Math.atan2(run[2] - run[0], run[3] - run[1]);
      const victim = people.spawnActor!(kb.x, kb.z, { look: looks.victim(), yaw: yaw + Math.PI });
      const thief = people.spawnActor!(kb.x - Math.sin(yaw) * 2.2, kb.z - Math.cos(yaw) * 2.2, { look: looks.thief(), yaw });
      if (!victim || !thief) { victim?.release('vanish'); thief?.release('vanish'); return false; }
      thief.fair = true; thief.downFor = 2.6;
      T.victim = victim; T.thief = thief; T.home.set(kb.x, 0, kb.z); T.lost = 0; T.run = run;
      cast = [victim, thief];
      active = 'thief'; clock = 0; setPhase('snatch');
      thief.goTo(kb.x, kb.z, 2.4);
      return true;
    }
    return false;
  };

  const thiefStep = (dt: number) => {
    const v = T.victim!, th = T.thief!, P = pl.position;
    const dThief = Math.hypot(th.pos.x - P.x, th.pos.z - P.z);
    if (phase === 'snatch') {
      if (phaseT > 0.9) {
        v.act('point'); v.face(th.pos.x, th.pos.z);
        v.say(t('npc.thief.cry1'), 3, t('npc.who.victim'));
        th.follow(T.run!, THIEF_SPEED);
        setPhase('chase');
        after(2.2, () => { if (active === 'thief' && phase === 'chase') th.say(t('npc.thief.taunt'), 2); });
        after(3.5, () => { if (active === 'thief') v.say(t('npc.thief.cry2'), 2.5, t('npc.who.victim')); });
      }
      return;
    }
    if (phase === 'chase') {
      story(t('npc.obj.thief', { m: Math.round(dThief) }));
      if (phaseT > 1.5) v.face(th.pos.x, th.pos.z);
      if (th.hits > 0) {
        th.say(t('npc.thief.down'), 2.6, t('npc.who.thief'));
        T.bag.set(th.pos.x + 0.6, 0, th.pos.z + 0.4);
        marker.show(T.bag.x, T.bag.z, '#ffc21f', 0.3);
        setPhase('bag');
        return;
      }
      // At the end of his run he takes another, away from the player again (or just keeps going).
      if (th.arrived) {
        const run = pavementRun(th.pos.x, th.pos.z, P.x, P.z, 250);
        if (run && run.length >= 20) th.follow(run, THIEF_SPEED);
        else { const dx = th.pos.x - P.x, dz = th.pos.z - P.z, l = Math.hypot(dx, dz) || 1; th.goTo(th.pos.x + dx / l * 60, th.pos.z + dz / l * 60, THIEF_SPEED); }
      }
      T.lost = dThief > 130 ? T.lost + dt : 0;
      if (T.lost > 5 || clock > 110) { letGo(th, 'flee'); end(t('npc.thiefGone')); }
      return;
    }
    if (phase === 'bag') {
      // He gets up and runs (empty-handed): a passer-by from here.
      if (th.alive && th.state === 'script') letGo(th, 'flee');
      story(t('npc.obj.bag'));
      const foot = pl.foot, car = vehicle().car;
      const take = () => {
        marker.hide();
        toast(t('npc.bagGot'));
        setPhase('ask');
        dlg()?.ask(you(), t('npc.thief.ask'), [t('npc.thief.optReturn'), t('npc.thief.optKeep')], (i) => {
          if (active !== 'thief') return;
          if (i === 1) {
            pay(BAG_KEEP); toast(t('npc.kept', { n: BAG_KEEP }));
            journal.meet('enc.thief');
            const vv = v;
            after(3.5, () => { if (!vv.alive) return; vv.act('phone'); vv.say(t('npc.thief.angry'), 3, t('npc.who.victim')); wanted()?.crime('report', vv.pos.x, vv.pos.z); });
            after(9, () => { if (vv.alive) vv.release('walk'); });
            cast = cast.filter((x) => x !== v);
            end(null);
          } else {
            setPhase('return');
            v.act('wave');
            nav()?.setTarget({ x: v.pos.x, z: v.pos.z, kind: 'mission', label: t('npc.who.victim') });
            marker.show(v.pos.x, v.pos.z, C.victim, 0.5);
          }
        }, { prio: 2, timeout: 14, fallback: 0 });
      };
      if (foot) {
        const d = Math.hypot(T.bag.x - foot.pos.x, T.bag.z - foot.pos.z);
        if (d < 1.6) pl.offer?.({ x: T.bag.x, z: T.bag.z, r: 1.6, label: t('npc.pickBag'), use: take });
      } else if (Math.hypot(T.bag.x - car.pos.x, T.bag.z - car.pos.z) < 3.5 && car.speed < 3) take();
      if (clock > 160) end(null);
      return;
    }
    if (phase === 'return') {
      const foot = pl.foot, car = vehicle().car, Q = foot?.pos ?? car.pos;
      const d = Math.hypot(v.pos.x - Q.x, v.pos.z - Q.z);
      story(t('npc.obj.return', { m: Math.round(d) }));
      v.face(Q.x, Q.z);
      if (d < (foot ? 3 : 7) && (foot || car.speed < 2)) {
        v.act('talk');
        const sp = speaker(v, 'npc.who.victim', C.victim);
        dlg()?.say(sp, t('npc.thief.thanks1'), { prio: 2 });
        dlg()?.say(sp, t('npc.thief.thanks2'), { prio: 2 });
        pay(BAG_REWARD); toast(t('npc.returned', { n: BAG_REWARD }));
        engine.events.emit('stunt:event', { kind: 'takedown', points: 150 });
        journal.meet('enc.thief');
        const vv = v;
        cast = cast.filter((x) => x !== v);
        after(6, () => { if (vv.alive) vv.release('walk'); });
        end(null);
      } else if (clock > 240) end(null);
    }
  };

  // ---------------------------------------------------------------- scam (碰瓷)

  const S = { man: null as Actor | null, asked: false, gone: 0 };

  const startScam = (): boolean => {
    if (pl.mode !== 'driving') return false;
    const c = vehicle().car;
    if (c.speed < 3 || c.speed > 14) return false;
    const r = onRoad(c);
    if (!r || !SIDEWALK[r.l.cls]) return false;
    let l = r.l, s = r.s + 34 + rnd() * 10;
    while (s > l.len - 3) { const n = g.next(l.id, rnd); if (n < 0) return false; s -= l.len; l = g.links[n]; }
    if (!SIDEWALK[l.cls] || l.hmax > 0.3) return false;
    g.at(l, s, -(l.hw + 0.9), at);   // the kerb on the right of the player's lane
    const man = people.spawnActor!(at.x, at.z, { look: looks.oldMan(), yaw: Math.atan2(-at.dz, at.dx) });
    if (!man) return false;
    man.fair = true; man.downFor = 60;
    S.man = man; S.asked = false; S.gone = 0;
    cast = [man];
    active = 'scam'; clock = 0; setPhase('lurk');
    return true;
  };

  const scamAsk = () => {
    const man = S.man!;
    S.asked = true;
    story(t('npc.obj.scam'));
    const sp = speaker(man, 'npc.who.scammer', C.scam);
    const opts = [t('npc.scam.optPay', { n: SCAM_ASK }), t('npc.scam.optLeave')];
    if (dashcam) opts.push(t('npc.scam.optCam'));
    dlg()?.ask(sp, t('npc.scam.demand'), opts, (i) => {
      if (active !== 'scam') return;
      journal.meet('enc.scam');
      if (i === 0) {
        const n = Math.min(cash(), SCAM_ASK);
        pay(-n); if (n > 0) toast(t('npc.scamPaid', { n }));
        man.getUp();
        dlg()?.say(sp, t(n < SCAM_ASK ? 'npc.scam.paidShort' : 'npc.scam.paid'), { prio: 2 });
        after(2.5, () => end(null));
        setPhase('done');
      } else if (i === 2) {
        dlg()?.say(you(), t('npc.scam.cam1'), { prio: 2 });
        dlg()?.say(sp, t('npc.scam.cam2'), { prio: 2 });
        after(3.2, () => { if (active !== 'scam') return; man.getUp(); after(1.1, () => { if (man.alive) letGo(man, 'flee'); toast(t('npc.scamFled')); engine.events.emit('stunt:event', { kind: 'takedown', points: 100 }); end(null); }); });
        setPhase('done');
      } else scamReport();
    }, { prio: 2, timeout: 12, fallback: 1 });
  };

  /** Driven off (or told to get lost): he sits up, phones it in, a star. */
  const scamReport = () => {
    const man = S.man!;
    setPhase('done');
    journal.meet('enc.scam');
    man.getUp();
    after(1.2, () => { if (!man.alive) return; man.act('phone'); man.say(t('npc.scam.report'), 3, t('npc.who.scammer')); });
    after(4.2, () => { if (man.alive) wanted()?.crime('report', man.pos.x, man.pos.z); end(null); });
  };

  const scamStep = (dt: number) => {
    const man = S.man!, c = vehicle().car, driving = pl.mode === 'driving';
    const rx = man.pos.x - c.pos.x, rz = man.pos.z - c.pos.z, along = rx * c.fwd.x + rz * c.fwd.z, dist = Math.hypot(rx, rz);
    if (phase === 'lurk') {
      // Out into the car's path just in front of it.
      if (driving && c.speed > 1 && along > 2 && along < 9 + c.speed * 0.7 && Math.abs(rx * c.left.x + rz * c.left.z) < 7) {
        man.goTo(c.pos.x + c.fwd.x * (along - 1), c.pos.z + c.fwd.z * (along - 1), 2.6);
        setPhase('step');
      } else if (along < -4 || dist > 140 || clock > 40) end(null);
      return;
    }
    if (phase === 'step') {
      if (man.hits > 0 || dist < 3.6 || (man.arrived && phaseT > 0.4)) {
        if (man.hits === 0) man.fall(c.fwd.x * 1.4 + (rx / (dist || 1)) * 0.5, c.fwd.z * 1.4 + (rz / (dist || 1)) * 0.5);
        man.say(t(c.speed > 9 ? 'npc.scam.hit' : rnd() < 0.5 ? 'npc.scam.fall1' : 'npc.scam.fall2'), 2.6, t('npc.who.scammer'));
        setPhase('down');
      } else if (phaseT > 4) end(null);
      return;
    }
    if (phase === 'down') {
      const foot = pl.foot, d = foot ? Math.hypot(man.pos.x - foot.pos.x, man.pos.z - foot.pos.z) : dist;
      if (!S.asked && phaseT > 1.2 && ((driving && c.speed < 1.2 && d < 30) || (!driving && d < 7))) scamAsk();
      // Gone without a word (well past him and still going): he reports it.
      S.gone = d > 45 ? S.gone + dt : 0;
      // Asked and answered with the throttle: that is leaving too.
      const drivingOff = S.asked && driving && c.speed > 3 && d > 22;
      if (S.gone > 2 || drivingOff || (!S.asked && phaseT > 14)) { dlg()?.clear(2); scamReport(); }
    }
  };

  // ---------------------------------------------------------------- pregnant

  const B = { husband: null as Actor | null, wife: null as Actor | null, kerb: new THREE.Vector3(), dest: null as { x: number; z: number; label: string } | null,
    limit: 0, elapsed: 0, smooth: 100, lineT: 0, prevV: new THREE.Vector3(), waved: false, looks: null as [Look, Look] | null };

  const startPregnant = (): boolean => {
    if (pl.mode !== 'driving') return false;
    const v = vehicle(), c = v.car;
    if (v.look.taxi) return false;
    const ids = g.near(c.pos.x, c.pos.z, 170);
    for (let k = 0; k < 30 && ids.length; k++) {
      const l = g.links[ids[Math.floor(rnd() * ids.length)]];
      if (!SIDEWALK[l.cls] || l.len < 20 || l.hmax > 0.3) continue;
      const s = 6 + rnd() * (l.len - 12), side = l.oneway ? -1 : rnd() < 0.5 ? 1 : -1;
      g.at(l, s, side * (l.hw + 0.9), at);
      const dx = at.x - c.pos.x, dz = at.z - c.pos.z, d = Math.hypot(dx, dz);
      if (d < 70 || d > 170 || (dx * c.fwd.x + dz * c.fwd.z) / d < 0.35) continue;
      const yaw = Math.atan2(-side * at.dz, side * at.dx);
      const husband = people.spawnActor!(at.x, at.z, { look: looks.husband(), yaw });
      const wife = people.spawnActor!(at.x + at.dx * 0.9, at.z + at.dz * 0.9, { look: looks.wife(), yaw });
      if (!husband || !wife) { husband?.release('vanish'); wife?.release('vanish'); return false; }
      husband.act('wave');
      B.husband = husband; B.wife = wife; B.kerb.set(at.x, 0, at.z); B.waved = false; B.dest = null;
      cast = [husband, wife];
      marker.show(at.x, at.z, C.wife, 0.6);
      active = 'pregnant'; clock = 0; setPhase('wait');
      return true;
    }
    return false;
  };

  /** The nearest hospital by road (OSM's, from the map's places), and its kerb. */
  const hospital = (x: number, z: number, heading: number): { x: number; z: number; label: string; len: number } | null => {
    const ns = engine.get<NavSystem>('nav');
    // Somewhere that delivers babies: not a children's, dental, eye, chest, cancer or mental hospital.
    const SPECIAL = /儿童|儿研|口腔|牙|眼|精神|胸科|肿瘤|皮肤|传染|康复|整形|安定|结核|Children|Dental|Stomat|Eye|Ophthal|Psychi|Chest|Cancer|Tumou?r|Dermat|Infect|Rehab|Plastic/i;
    const list = (ns?.labels?.().places ?? []).filter((p) => p.cat === 'hospital' && !SPECIAL.test(p.name.zh + ' ' + p.name.en)).map((p) => ({ p, d: Math.hypot(p.x - x, p.z - z) })).sort((a, b) => a.d - b.d).slice(0, 4);
    let best: { x: number; z: number; label: string; len: number } | null = null;
    for (const { p } of list) {
      const k = nearestKerb(g, p.x, p.z, 160, 0.8);
      if (!k) continue;
      const len = nav()?.route(x, z, heading, k.x, k.z)?.len ?? Infinity;
      if (len < 150 || len > 6000) continue;
      if (!best || len < best.len) best = { x: k.x, z: k.z, label: lang() === 'zh' ? p.name.zh : p.name.en, len };
    }
    return best;
  };

  const pregStep = (dt: number) => {
    const v = vehicle(), c = v.car, h = B.husband, w = B.wife;
    const husbandSp = speaker(h, 'npc.who.husband', C.husband, h?.look), wifeSp = speaker(w, 'npc.who.wife', C.wife, w?.look);
    if (phase === 'wait') {
      const d = Math.hypot(c.pos.x - B.kerb.x, c.pos.z - B.kerb.z);
      story(t('npc.obj.pregWave'));
      if (!B.waved && d < 45) { B.waved = true; h!.say(t('npc.preg.wave'), 2.6, t('npc.who.husband')); }
      if (pl.mode === 'driving' && d < 8.5 && c.speed < 3) {
        dlg()?.say(husbandSp, t('npc.preg.ask'), { prio: 2 });
        const side = Math.sign((B.kerb.x - c.pos.x) * c.left.x + (B.kerb.z - c.pos.z) * c.left.z) || 1;
        h!.act(null);
        w!.goTo(c.pos.x + c.left.x * side * 1.2 - c.fwd.x * 0.5, c.pos.z + c.left.z * side * 1.2 - c.fwd.z * 0.5, 1.2);
        h!.goTo(c.pos.x + c.left.x * side * 1.2 + c.fwd.x * 0.6, c.pos.z + c.left.z * side * 1.2 + c.fwd.z * 0.6, 1.6);
        setPhase('board');
      } else if (d > 350 || clock > 80) end(t('npc.pregGone'));
      return;
    }
    if (phase === 'board') {
      if (c.speed > 3 || pl.mode !== 'driving') { w!.goTo(B.kerb.x, B.kerb.z, 1.2); h!.goTo(B.kerb.x, B.kerb.z, 1.4); h!.act('wave'); setPhase('wait'); return; }
      if ((w!.arrived && h!.arrived) || phaseT > 5) {
        const dest = hospital(c.pos.x, c.pos.z, Math.atan2(c.fwd.x, c.fwd.z));
        if (!dest) { end(null); return; }
        // Both in the back: they live on as speakers, not as people on the pavement.
        const hl = h!.look, wl = w!.look;
        letGo(h!, 'vanish'); letGo(w!, 'vanish');
        B.husband = null; B.wife = null;
        B.looks = [hl, wl];
        B.dest = dest; B.limit = dest.len / 9.5 + 25; B.elapsed = 0; B.smooth = 100; B.lineT = 6; B.prevV.copy(c.vel);
        nav()?.setTarget({ x: dest.x, z: dest.z, kind: 'mission', label: dest.label });
        marker.show(dest.x, dest.z, '#3ccf72');
        setPhase('ride');
      }
      return;
    }
    if (phase === 'ride') {
      const [hl, wl] = B.looks!;
      const hs: Speaker = { ...husbandSp, look: hl }, ws: Speaker = { ...wifeSp, look: wl };
      B.elapsed += dt;
      // Bumps: braking, cornering or accelerating harder than 5.5 m/s² costs smoothness.
      const ax = (c.vel.x - B.prevV.x) / dt, az = (c.vel.z - B.prevV.z) / dt, a = Math.hypot(ax, az);
      B.prevV.copy(c.vel);
      if (a > 5.5 && a < 60) B.smooth = Math.max(0, B.smooth - (a - 5.5) * dt * 3);
      B.lineT -= dt;
      if (B.lineT <= 0) { B.lineT = 13 + rnd() * 7; const k = pick(['npc.preg.ride1', 'npc.preg.ride2', 'npc.preg.ride3', 'npc.preg.ride4'] as const); dlg()?.say(k === 'npc.preg.ride4' ? hs : ws, t(k), { prio: 1 }); }
      const left = B.limit - B.elapsed;
      story(t('npc.obj.pregRide', { place: B.dest!.label, time: fmt(left), n: Math.round(B.smooth) }));
      if (pl.mode !== 'driving' || (wanted()?.level ?? 0) > 0) { end(t('taxi.scared')); return; }
      if (left <= 0) { dlg()?.say(ws, t('npc.preg.late'), { prio: 2 }); journal.meet('enc.pregnant'); pay(50); end(t('npc.pregLate')); return; }
      if (Math.hypot(c.pos.x - B.dest!.x, c.pos.z - B.dest!.z) < 14 && c.speed < 2.5) {
        const total = 250 + Math.round(B.smooth * 2.5) + (left / B.limit > 0.3 ? 120 : 0);
        pay(total);
        dlg()?.say(hs, t('npc.preg.done'), { prio: 2 });
        journal.meet('enc.pregnant');
        // Out on the kerb side and off to the hospital doors.
        const side = Math.sign((B.dest!.x - c.pos.x) * c.left.x + (B.dest!.z - c.pos.z) * c.left.z) || 1;
        const ox = c.pos.x + c.left.x * side * 1.3, oz = c.pos.z + c.left.z * side * 1.3;
        const hh = people.spawnActor!(ox, oz, { look: hl }), ww = people.spawnActor!(ox - c.fwd.x * 0.8, oz - c.fwd.z * 0.8, { look: wl });
        for (const p of [hh, ww]) if (p) { p.goTo(B.dest!.x + c.left.x * side * 4, B.dest!.z + c.left.z * side * 4, 1.3); after(4.5, () => { if (p.alive) p.release('walk'); }); }
        end(t('npc.pregDone', { n: total }));
      }
    }
  };
  engine.events.on('vehicle:impact', ({ strength }) => {
    if (active !== 'pregnant' || phase !== 'ride' || strength < 1.5) return;
    B.smooth = Math.max(0, B.smooth - strength * 4);
    const wl = B.looks?.[1];
    if (rnd() < 0.7) dlg()?.say({ name: t('npc.who.wife'), color: C.wife, look: wl }, t(rnd() < 0.5 ? 'npc.preg.bump1' : 'npc.preg.bump2'), { prio: 1 });
  });
  engine.events.on('vehicle:land', ({ airTime }) => {
    if (active !== 'pregnant' || phase !== 'ride' || airTime < 0.25) return;
    B.smooth = Math.max(0, B.smooth - 15);
    dlg()?.say({ name: t('npc.who.wife'), color: C.wife, look: B.looks?.[1] }, t('npc.preg.air'), { prio: 1 });
  });

  // ---------------------------------------------------------------- road rage (not scheduled)

  const R = { man: null as Actor | null, car: null as Vehicle | null, sayT: 0, punchT: 0, asked: false };

  engine.events.on('vehicle:impact', ({ strength }) => {
    if (active || rageCool > 0 || strength < 3 || pl.mode !== 'driving' || !auto) return;
    const v = vehicle(), m = missions();
    if ((wanted()?.level ?? 0) > 0 || m?.busy || m?.story || !v.inputEnabled || engine.get<RaceApi>('races')?.active) return;
    rageCool = 25;
    if (rnd() > 0.45) return;
    startRage();
  });

  function startRage(): boolean {
    const c = vehicle().car;
    // The nearest driven car (not one parked, a scooter or a getaway car: `hold` says no to those).
    const near = tr!.cars().filter((o) => !o.spec.single && Math.hypot(o.pos.x - c.pos.x, o.pos.z - c.pos.z) < 9).sort((a, b) => a.pos.distanceTo(c.pos) - b.pos.distanceTo(c.pos));
    const other = near.find((o) => tr!.hold?.(o, true));
    if (!other) return false;
    R.man = null; R.car = other; R.sayT = 0; R.punchT = 0; R.asked = false;
    active = 'rage'; clock = 0; setPhase('stop');
    return true;
  }

  const rageStep = (dt: number) => {
    const car = R.car!, c = vehicle().car, foot = pl.foot;
    const carGone = !tr!.cars().includes(car);
    if (phase === 'stop') {
      if (carGone) { end(null); return; }
      if (phaseT > 1.1) {
        const out = 1.3;
        const man = people.spawnActor!(car.pos.x + car.left.x * out, car.pos.z + car.left.z * out, { look: looks.driver(), yaw: Math.atan2(car.left.x, car.left.z) });
        if (!man) { tr!.hold?.(car, false); end(null); return; }
        R.man = man; cast = [man];
        man.act('angry');
        man.say(t('npc.rage.out1'), 2.6, t('npc.who.rager'));
        setPhase('approach');
      }
      return;
    }
    const man = R.man!;
    if (!man.alive) { if (!carGone) tr!.hold?.(car, false); end(null); return; }
    const P = foot ? foot.pos : c.pos;
    const doorX = foot ? P.x : c.pos.x + c.left.x * 1.6, doorZ = foot ? P.z : c.pos.z + c.left.z * 1.6;
    const d = Math.hypot(man.pos.x - doorX, man.pos.z - doorZ);
    if (phase === 'approach') {
      story(t('npc.obj.rage'));
      if (man.state === 'down') { if (man.hits > 0 && phaseT > 0.5) { /* knocked down: he gives up */ man.say(t('npc.rage.down'), 2.4, t('npc.who.rager')); journal.meet('enc.rage'); setPhase('back'); } return; }
      R.sayT -= dt;
      if (R.sayT <= 0) { R.sayT = 3.5; man.say(t(pick(['npc.rage.out2', 'npc.rage.out3'] as const)), 2.4, t('npc.who.rager')); }
      if (phaseT % 0.5 < dt) man.goTo(doorX, doorZ, d > 6 ? 3.2 : 1.8);
      // Driven off: he shouts after you and films the plate.
      if (!foot && c.speed > 3 && d > 25) { man.stop(); man.face(c.pos.x, c.pos.z); man.act('phone'); man.say(t('npc.rage.left'), 2.6, t('npc.who.rager')); journal.meet('enc.rage');
        after(3, () => { if (active === 'rage' && rnd() < 0.55) wanted()?.crime('report', man.pos.x, man.pos.z); }); setPhase('film'); return; }
      if (!foot && d < 2.4 && c.speed < 1.5 && !R.asked) {
        R.asked = true; man.stop(); man.face(c.pos.x, c.pos.z); man.act('angry');
        rageAsk();
        setPhase('argue');
        return;
      }
      if (foot) {
        // On foot he squares up: F to talk him down, or a fist every 1.3 s until he is put down.
        if (d < 2.6 && !R.asked) pl.offer?.({ x: man.pos.x, z: man.pos.z, r: 2.6, label: t('npc.talk'), use: () => { R.asked = true; man.stop(); man.face(P.x, P.z); rageAsk(); setPhase('argue'); } });
        R.punchT -= dt;
        if (d < 1.4 && R.punchT <= 0) {
          R.punchT = 1.3; man.face(P.x, P.z); man.act('punch'); after(0.45, () => { if (man.alive) man.act('angry'); });
          man.fair = true;
          pl.hurt(6); man.say(t('npc.rage.punch'), 1.4, t('npc.who.rager'));
        }
      }
      if (clock > 45) setPhase('back');
      return;
    }
    if (phase === 'argue' || phase === 'film') {
      if (phase === 'film' && phaseT > 4) setPhase('back');
      if (phase === 'argue' && man.state === 'down') setPhase('back');
      return;
    }
    if (phase === 'back') {
      if (man.state !== 'script') return;
      man.act(null);
      if (carGone) { letGo(man, 'walk'); end(null); return; }
      const bx = car.pos.x + car.left.x * 1.2, bz = car.pos.z + car.left.z * 1.2;
      if (phaseT % 0.5 < dt) man.goTo(bx, bz, 2.2);
      if (Math.hypot(man.pos.x - bx, man.pos.z - bz) < 0.6 || phaseT > 20) { letGo(man, 'vanish'); tr!.hold?.(car, false); end(null); }
    }
  };

  const rageAsk = () => {
    const man = R.man!, sp = speaker(man, 'npc.who.rager', C.rage);
    dlg()?.ask(sp, t('npc.rage.ask'), [t('npc.rage.optPay', { n: RAGE_ASK }), t('npc.rage.optRude')], (i) => {
      if (active !== 'rage') return;
      journal.meet('enc.rage');
      if (i === 0) {
        const n = Math.min(cash(), RAGE_ASK);
        pay(-n); if (n > 0) toast(t('npc.ragePaid', { n }));
        man.act('talk'); dlg()?.say(sp, t('npc.rage.paid'), { prio: 2 });
        after(2.5, () => { if (active === 'rage') setPhase('back'); });
      } else {
        man.act('phone'); dlg()?.say(sp, t('npc.rage.film'), { prio: 2 });
        after(3, () => { if (active === 'rage' && man.alive && rnd() < 0.6) wanted()?.crime('report', man.pos.x, man.pos.z); if (active === 'rage') setPhase('back'); });
      }
    }, { prio: 2, timeout: 12, fallback: 1 });
  };


  // ---------------------------------------------------------------- P3: four more

  /** A kerb ahead of the player, min..max m away, in front: where someone waves from. */
  const kerbAhead = (min: number, max: number): { x: number; z: number; yaw: number; side: number; l: Link; s: number } | null => {
    const P = pl.position, f = facing();
    const ids = g.near(P.x, P.z, max);
    for (let k = 0; k < 30 && ids.length; k++) {
      const l = g.links[ids[Math.floor(rnd() * ids.length)]];
      if (!SIDEWALK[l.cls] || l.len < 20 || l.hmax > 0.3) continue;
      const s = 6 + rnd() * (l.len - 12), side = l.oneway ? -1 : rnd() < 0.5 ? 1 : -1;
      g.at(l, s, side * (l.hw + 0.9), at);
      const dx = at.x - P.x, dz = at.z - P.z, d = Math.hypot(dx, dz);
      if (d < min || d > max || (dx * f.x + dz * f.z) / d < 0.35) continue;
      return { x: at.x, z: at.z, yaw: Math.atan2(-side * at.dz, side * at.dx), side, l, s };
    }
    return null;
  };
  const night = () => { const h = engine.get<RenderApi>('render')?.timeOfDay ?? 15; return h >= 19.5 || h < 3; };
  const fmtLeft = (s: number) => fmt(s);
  /** Stopped (or on foot) by a point: arrived. */
  const arrived = (x: number, z: number, r = 12) => {
    const c = vehicle().car, P = pl.position;
    return Math.hypot(P.x - x, P.z - z) < r && (pl.mode !== 'driving' || c.speed < 2.5);
  };
  /** Someone waiting at a kerb: speak when the player is near, board (walk to the car and vanish) when they stop. */
  const W = { who: null as Actor | null, kerb: new THREE.Vector3(), waved: false, looks: null as Look | null, dest: null as { x: number; z: number; label: string } | null, limit: 0, elapsed: 0, n: 0, lineT: 0 };
  const waiter = (kind: Kind, look: Look, act: Action | null, seat?: number): boolean => {
    const driving = pl.mode === 'driving';
    const k = kerbAhead(driving ? 60 : 25, driving ? 160 : 90);
    if (!k) return false;
    const a = people.spawnActor!(k.x, k.z, { look, yaw: k.yaw });
    if (!a) return false;
    a.act(act, { seat });
    W.who = a; W.kerb.set(k.x, 0, k.z); W.waved = false; W.looks = look; W.dest = null; W.n = 0; W.lineT = 8;
    cast = [a];
    marker.show(k.x, k.z, '#ff9f1c', 0.6);
    active = kind; clock = 0; setPhase('wait');
    return true;
  };
  const waiterSpeaker = (key: TKey, color: string): Speaker => ({ name: t(key), color, look: W.looks ?? undefined, voice: W.who?.voice, at: W.who?.alive ? W.who.pos : null });
  /** Within reach to be asked: driving and stopped by them, or on foot beside them. */
  const reached = () => {
    const a = W.who; if (!a?.alive) return false;
    const c = vehicle().car, P = pl.position, d = Math.hypot(a.pos.x - P.x, a.pos.z - P.z);
    return pl.mode === 'driving' ? d < 8.5 && c.speed < 3 : d < 3;
  };
  /** Into the car on the kerb side: they walk to the door and are gone (riding along). */
  const board = () => {
    const a = W.who, c = vehicle().car;
    if (!a?.alive) return;
    if (pl.mode !== 'driving') { letGo(a, 'vanish'); W.who = null; return; }
    const side = Math.sign((a.pos.x - c.pos.x) * c.left.x + (a.pos.z - c.pos.z) * c.left.z) || 1;
    a.act(null); a.goTo(c.pos.x + c.left.x * side * 1.2 - c.fwd.x * 0.5, c.pos.z + c.left.z * side * 1.2 - c.fwd.z * 0.5, 1.4);
    after(2.5, () => { if (a.alive) letGo(a, 'vanish'); });
    W.who = null;
  };
  const toTarget = (d: { x: number; z: number; label: string }) => { nav()?.setTarget({ x: d.x, z: d.z, kind: 'mission', label: d.label }); marker.show(d.x, d.z, '#3ccf72'); };

  // --- 外卖小哥摔了
  const courierLook = (): Look => {
    const l = randomLook(rnd), c = new THREE.Color(pick(['#f6c300', '#1b8ff0']));
    l.fem = 0; l.top = 'jacket'; l.shirt = c; l.inner = c.clone(); l.sleeve = 0.53; l.cap = c.clone(); l.bottom = 'trousers'; l.hem = 0.8; l.pants = new THREE.Color('#1d1f24'); l.print = false; l.mask = null;
    return l;
  };
  const stops: Stop[] = [];
  const startCourier = (): boolean => waiter('courier', courierLook(), 'sit', 0.15);
  const courierStep = () => {
    const sp = waiterSpeaker('npc.who.courier', '#f6c300');
    if (phase === 'wait') {
      story(t('npc.obj.courierWave'));
      if (!W.waved && W.who && Math.hypot(W.who.pos.x - pl.position.x, W.who.pos.z - pl.position.z) < 40) { W.waved = true; W.who.act('wave'); }
      if (reached()) {
        setPhase('ask');
        dlg()?.ask(sp, t('npc.courier.ask'), [t('npc.courier.optYes'), t('npc.courier.optNo')], (i) => {
          if (active !== 'courier') return;
          journal.meet('enc.courier');
          if (i !== 0) { end(null); return; }
          const P = pl.position, n = nav(), r = () => rnd();
          stops.length = 0;
          const a1 = pickAddress(g, n, r, P.x, P.z, 300, 900) ?? pickAddress(g, n, r, P.x, P.z, 300, 900, [], 100, false);
          const a2 = a1 && (pickAddress(g, n, r, a1.x, a1.z, 300, 900, [a1]) ?? pickAddress(g, n, r, a1.x, a1.z, 300, 900, [a1], 100, false));
          if (!a1 || !a2) { end(null); return; }
          stops.push(a1, a2);
          dlg()?.say(sp, t('npc.courier.thanks'), { prio: 2 });
          W.n = 0; startLeg();
        }, { prio: 2, timeout: 12, fallback: 1 });
      } else if (clock > 90 || Math.hypot(W.kerb.x - pl.position.x, W.kerb.z - pl.position.z) > 350) end(null);
      return;
    }
    if (phase === 'run') {
      const d = stops[W.n];
      W.elapsed += 1 / 60;
      story(t('npc.obj.courier', { i: W.n + 1, place: d.label, time: fmtLeft(W.limit - W.elapsed) }));
      if (W.elapsed > W.limit) { end(t('npc.courierLate')); return; }
      if (arrived(d.x, d.z)) {
        const n = 30 + Math.round((W.limit - W.elapsed) * 0.6);
        pay(n); toast(t('npc.courierDrop', { n }));
        W.n++;
        if (W.n >= stops.length) { pay(60); after(1.8, () => toast(t('npc.courierDone', { n: 60 }))); end(null); }
        else startLeg();
      }
    }
  };
  const startLeg = () => {
    const d = stops[W.n], P = pl.position;
    const len = nav()?.route(P.x, P.z, Math.atan2(facing().x, facing().z), d.x, d.z)?.len ?? Math.hypot(d.x - P.x, d.z - P.z) * 1.4;
    W.limit = len / 8 + 30; W.elapsed = 0;
    toTarget(d);
    setPhase('run');
  };

  // --- 代驾 (night)
  const D = { car: null as Vehicle | null, dmg: 0, fee: 260 };
  const startDaijia = (): boolean => {
    if (!night()) return false;
    const look = randomLook(rnd);
    look.fem = 0; look.age = 0.45; look.top = 'jacket'; look.shirt = new THREE.Color('#1a1b20'); look.inner = new THREE.Color('#eef0f2'); look.pants = new THREE.Color('#1a1b20'); look.cap = null; look.mask = null; look.build = 0.8; look.glasses = rnd() < 0.5;
    if (!waiter('daijia', look, 'stagger')) return false;
    // his car, parked at the kerb beside him
    const a = W.who!, k = { x: a.pos.x, z: a.pos.z };
    let best: Link | null = null, bd = 20, bs = 0;
    for (const id of g.near(k.x, k.z, 25)) { const l = g.links[id], pr = g.project(l, k.x, k.z, l.len / 2); if (pr.d < bd) { bd = pr.d; best = l; bs = pr.s; } }
    if (!best) { end(null); return false; }
    g.at(best, Math.min(best.len - 3, bs + 4), 0, at);
    const lat = ((k.x - at.x) * at.dz - (k.z - at.z) * at.dx) >= 0 ? 1 : -1;
    g.at(best, Math.min(best.len - 3, bs + 4), lat * (best.hw - 1.2), at);
    const car = new VehicleClass(engine.physics, SPEC_OF.suv, { x: at.x, y: 0.6, z: at.z }, Math.atan2(at.dx, at.dz));
    tr.parkCar(car, { upper: new THREE.Color('#121316'), lower: new THREE.Color('#121316'), taxi: false, parked: true, body: 'suv' });
    D.car = car; D.dmg = 0;
    return true;
  };
  const daijiaStep = () => {
    const sp = waiterSpeaker('npc.who.boss', '#9aa0a5');
    const v = vehicle();
    if (phase === 'wait') {
      if (!W.waved && W.who && Math.hypot(W.who.pos.x - pl.position.x, W.who.pos.z - pl.position.z) < 35) { W.waved = true; W.who.say(t('npc.daijia.wave'), 2.4, t('npc.who.boss')); }
      const f = pl.foot, a = W.who;
      if (f && a?.alive && Math.hypot(a.pos.x - f.pos.x, a.pos.z - f.pos.z) < 2.6) pl.offer?.({ x: a.pos.x, z: a.pos.z, r: 2.6, label: t('npc.talk'), use: () => {
        setPhase('ask');
        dlg()?.ask(sp, t('npc.daijia.ask', { n: D.fee }), [t('npc.daijia.optYes'), t('npc.daijia.optNo')], (i) => {
          if (active !== 'daijia') return;
          journal.meet('enc.daijia');
          if (i !== 0) { end(null); return; }
          setPhase('getin');
          const c = D.car!;
          a.goTo(c.pos.x + c.left.x * -1.2, c.pos.z + c.left.z * -1.2, 1.0);
        }, { prio: 2, timeout: 12, fallback: 1 });
      } });
      if (clock > 120 || Math.hypot(W.kerb.x - pl.position.x, W.kerb.z - pl.position.z) > 350) end(null);
      return;
    }
    if (phase === 'getin') {
      story(t('npc.obj.daijiaGetIn'));
      const a = cast[0];
      if (a?.alive && a.arrived) letGo(a, 'vanish');
      if (pl.mode === 'driving' && v.car === D.car) {
        if (cast[0]?.alive) letGo(cast[0], 'vanish');
        const P = pl.position, n = nav(), r = () => rnd();
        const d = pickAddress(g, n, r, P.x, P.z, 800, 1600) ?? pickAddress(g, n, r, P.x, P.z, 600, 1400, [], 100, false);
        if (!d) { end(null); return; }
        W.dest = d;
        const len = n?.route(P.x, P.z, Math.atan2(v.car.fwd.x, v.car.fwd.z), d.x, d.z)?.len ?? 1500;
        W.limit = len / 9 + 45; W.elapsed = 0; W.lineT = 10;
        toTarget(d);
        setPhase('drive');
      } else if (phaseT > 75) end(null);
      return;
    }
    if (phase === 'drive') {
      const d = W.dest!;
      W.elapsed += 1 / 60; W.lineT -= 1 / 60;
      story(t('npc.obj.daijia', { place: d.label, time: fmtLeft(W.limit - W.elapsed) }));
      if (W.lineT <= 0) { W.lineT = 14 + rnd() * 6; dlg()?.say({ ...sp, at: null }, t(pick(['npc.daijia.ride1', 'npc.daijia.ride2', 'npc.daijia.ride3'] as const)), { prio: 1 }); }
      if (pl.mode !== 'driving' || v.car !== D.car || W.elapsed > W.limit + 60) { end(null); return; }
      if (arrived(d.x, d.z, 14)) {
        const dmg = Math.min(D.fee - 40, Math.round(D.dmg)), n = D.fee - dmg;
        pay(n); dlg()?.say({ ...sp, at: null }, t('npc.daijia.done'), { prio: 2 });
        toast(t('npc.daijiaPaid', { n, dmg }));
        end(null);
      }
    }
  };
  engine.events.on('vehicle:impact', ({ strength }) => {
    if (active !== 'daijia' || phase !== 'drive' || strength < 2) return;
    D.dmg += (strength - 2) * 12;
    if (rnd() < 0.6) dlg()?.say({ name: t('npc.who.boss'), color: '#9aa0a5', look: W.looks ?? undefined }, t('npc.daijia.bump'), { prio: 1 });
  });

  // --- 跟上那辆车 (in a taxi)
  const TL = { run: null as { car: Vehicle; release(): void; bolt(): void } | null, close: 0, far: 0, said: 0, t: 0 };
  const startTail = (): boolean => {
    if (pl.mode !== 'driving' || !vehicle().look.taxi) return false;
    const look = randomLook(rnd);
    look.top = 'coat'; look.shirt = new THREE.Color('#2a2622'); look.cap = new THREE.Color('#2a2622'); look.glasses = true; look.mask = null;
    return waiter('tail', look, 'wave');
  };
  const tailStep = (dt: number) => {
    const sp = waiterSpeaker('npc.who.client', '#c79bff');
    const c = vehicle().car;
    if (phase === 'wait') {
      story(t('npc.obj.pregWave'));
      if (!W.waved && W.who && Math.hypot(W.who.pos.x - c.pos.x, W.who.pos.z - c.pos.z) < 45) { W.waved = true; W.who.say(t('npc.tail.wave'), 2, t('npc.who.client')); }
      if (reached() && pl.mode === 'driving') {
        board();
        dlg()?.say({ ...sp, at: null }, t('npc.tail.ask'), { prio: 2 });
        after(2.5, () => {
          if (active !== 'tail') return;
          const r = tr.spawnRunner(c.pos.x, c.pos.z, c.fwd.x, c.fwd.z, { calm: true });
          if (!r) { end(null); return; }
          TL.run = r; TL.close = 0; TL.far = 0; TL.said = 0; TL.t = 0;
          setPhase('tail');
        });
        setPhase('boarding');
      } else if (clock > 90 || Math.hypot(W.kerb.x - c.pos.x, W.kerb.z - c.pos.z) > 350) end(null);
      return;
    }
    if (phase === 'tail' && TL.run) {
      const rc = TL.run.car, d = Math.hypot(rc.pos.x - c.pos.x, rc.pos.z - c.pos.z), csp = { ...sp, at: null };
      TL.t += dt; TL.said -= dt;
      story(t('npc.obj.tail', { m: Math.round(d), time: fmtLeft(70 - TL.t) }));
      TL.close = d < 14 ? TL.close + dt : Math.max(0, TL.close - dt);
      TL.far = d > 130 ? TL.far + dt : 0;
      if (d < 24 && TL.said <= 0) { TL.said = 6; dlg()?.say(csp, t('npc.tail.close'), { prio: 1 }); }
      if (d > 100 && TL.said <= 0) { TL.said = 6; dlg()?.say(csp, t('npc.tail.far'), { prio: 1 }); }
      if (TL.close > 2.5) { TL.run.bolt(); dlg()?.say(csp, t('npc.tail.spotted'), { prio: 2 }); journal.meet('enc.tail'); const r = TL.run; TL.run = null; after(8, () => r.release()); end(t('npc.tailFail')); return; }
      if (TL.far > 6 || pl.mode !== 'driving') { journal.meet('enc.tail'); TL.run.release(); TL.run = null; end(t('npc.tailFail')); return; }
      if (TL.t > 70) {
        dlg()?.say(csp, t('npc.tail.done'), { prio: 2 });
        pay(260); toast(t('npc.tailPaid', { n: 260 })); journal.meet('enc.tail');
        const r = TL.run; TL.run = null; after(6, () => r.release());
        end(null);
      }
    }
  };

  // --- 老外问路
  const lmPts = LANDMARKS.filter((l) => l.id !== 'home').map((l) => { const [x, z] = project(l.lat, l.lon); return { id: l.id, x, z, zh: l.name.zh, en: l.name.en }; });
  const told = new Set<string>();
  const startForeigner = (): boolean => {
    if (pl.mode !== 'driving') return false;
    const look = randomLook(rnd);
    look.skin = new THREE.Color('#f2d6c4'); look.hair = new THREE.Color(pick(['#c9a46a', '#8a5a33', '#d8c08a'])); look.height = 1.84; look.age = 0.3; look.cap = rnd() < 0.5 ? new THREE.Color('#2f6db5') : null; look.mask = null;
    if (!waiter('foreigner', look, 'wave')) return false;
    // somewhere famous 700-2500 m by road
    const c = vehicle().car, n = nav();
    for (const l of lmPts.slice().sort(() => rnd() - 0.5)) {
      const d = Math.hypot(l.x - c.pos.x, l.z - c.pos.z);
      if (d < 600 || d > 2500) continue;
      const k = nearestKerb(g, l.x, l.z, 220, 0.8);
      if (!k) continue;
      const len = n?.route(c.pos.x, c.pos.z, Math.atan2(c.fwd.x, c.fwd.z), k.x, k.z)?.len ?? d * 1.4;
      if (len > 3200) continue;
      W.dest = { x: k.x, z: k.z, label: lang() === 'zh' ? l.zh : l.en }; W.limit = len / 9 + 40;
      (W as { lm?: string }).lm = l.id;
      return true;
    }
    end(null);
    return false;
  };
  const foreignerStep = () => {
    const sp = waiterSpeaker('npc.who.foreigner', '#5fd1ff');
    const c = vehicle().car;
    if (phase === 'wait') {
      if (!W.waved && W.who && Math.hypot(W.who.pos.x - c.pos.x, W.who.pos.z - c.pos.z) < 45) { W.waved = true; W.who.say(t('npc.foreigner.wave'), 2, t('npc.who.foreigner')); }
      if (reached() && pl.mode === 'driving') {
        setPhase('ask');
        dlg()?.ask(sp, t('npc.foreigner.ask', { place: W.dest!.label }), [t('npc.foreigner.optYes'), t('npc.foreigner.optNo')], (i) => {
          if (active !== 'foreigner') return;
          journal.meet('enc.foreigner');
          if (i !== 0) { end(null); return; }
          board(); told.clear(); W.n = 0; W.elapsed = 0;
          toTarget(W.dest!);
          setPhase('ride');
        }, { prio: 2, timeout: 12, fallback: 1 });
      } else if (clock > 90 || Math.hypot(W.kerb.x - c.pos.x, W.kerb.z - c.pos.z) > 350) end(null);
      return;
    }
    if (phase === 'ride') {
      const d = W.dest!, csp = { ...sp, at: null };
      W.elapsed += 1 / 60;
      story(t('npc.obj.foreigner', { place: d.label, time: fmtLeft(W.limit - W.elapsed) }));
      if (phaseT % 1 < 1 / 60) for (const l of lmPts) {
        if (told.has(l.id) || l.id === (W as { lm?: string }).lm || Math.hypot(l.x - c.pos.x, l.z - c.pos.z) > 170) continue;
        told.add(l.id); W.n++; dlg()?.say(csp, t('npc.foreigner.wow', { place: lang() === 'zh' ? l.zh : l.en }), { prio: 1 }); break;
      }
      if (pl.mode !== 'driving' || (wanted()?.level ?? 0) > 0 || W.elapsed > W.limit + 90) { end(t('taxi.scared')); return; }
      if (arrived(d.x, d.z, 14)) {
        const n = 150 + 20 * W.n + (W.elapsed < W.limit ? 60 : 0);
        pay(n); dlg()?.say(csp, t('npc.foreigner.done'), { prio: 2 }); toast(t('npc.foreignerPaid', { n }));
        end(null);
      }
    }
  };

  // ---------------------------------------------------------------- the director

  const starters: Record<Exclude<Kind, 'rage'>, () => boolean> = { thief: startThief, scam: startScam, pregnant: startPregnant, courier: startCourier, daijia: startDaijia, tail: startTail, foreigner: startForeigner };
  const start = (kind: Kind): boolean => (kind === 'rage' ? startRage() : starters[kind]());

  engine.events.on('vehicle:reset', () => { if (active) { if (active === 'rage' && R.car) tr.hold?.(R.car, false); end(null); } });
  engine.events.on('wanted:busted', () => { if (active) { if (active === 'rage' && R.car) tr.hold?.(R.car, false); end(null); } });

  const api: NpcApi = {
    name: 'npc',
    get active() { return active; },
    get dashcam() { return dashcam; },
    set dashcam(on: boolean) { dashcam = on; try { localStorage.setItem(DASHCAM_KEY, on ? '1' : '0'); } catch { /* ignore */ } },
    debug: {
      start: (kind) => { if (active) end(null); return start(kind); },
      wait: () => wait,
      state: () => ({ active, phase, clock, cast: cast.map((a) => ({ x: a.pos.x, z: a.pos.z, state: a.state, hits: a.hits, alive: a.alive })),
        bag: phase === 'bag' ? { x: T.bag.x, z: T.bag.z } : null, dest: B.dest, smooth: B.smooth, rageCar: R.car ? { x: R.car.pos.x, z: R.car.pos.z } : null }),
    },
    fixedUpdate(dt) {
      rageCool -= dt;
      for (let i = later.length - 1; i >= 0; i--) { const l = later[i]; l.t -= dt; if (l.t <= 0) { later.splice(i, 1); l.fn(); } }
      if (!active) {
        if (!auto || !free()) return;
        wait -= dt;
        if (wait > 0) return;
        const v = vehicle(), driving = pl.mode === 'driving';
        const nt = night(), taxi = v.look.taxi;
        const kinds: Exclude<Kind, 'rage'>[] = !driving ? ['thief', 'courier', ...(nt ? ['daijia', 'daijia'] as const : [])]
          : v.car.speed > 14 ? ['pregnant', 'courier', 'foreigner', ...(taxi ? ['tail'] as const : [])]
          : ['thief', 'scam', 'scam', 'pregnant', 'courier', 'foreigner', ...(taxi ? ['tail', 'tail'] as const : []), ...(nt ? ['daijia'] as const : [])];
        const first = pick(kinds);
        if (!starters[first]() && !kinds.some((k) => k !== first && starters[k]())) wait = 6;
        return;
      }
      clock += dt; phaseT += dt;
      if (active === 'thief') thiefStep(dt);
      else if (active === 'scam') scamStep(dt);
      else if (active === 'pregnant') pregStep(dt);
      else if (active === 'rage') rageStep(dt);
      else if (active === 'courier') courierStep();
      else if (active === 'daijia') daijiaStep();
      else if (active === 'tail') tailStep(dt);
      else if (active === 'foreigner') foreignerStep();
    },
    update(dt) {
      marker.update(dt); marker2.update(dt);
    },
  };
  const navApi = nav();
  navApi?.addBlips(() => {
    blips.length = 0;
    if (active === 'thief' && T.thief?.alive && phase === 'chase') blips.push({ kind: 'suspect', x: T.thief.pos.x, z: T.thief.pos.z, flash: true });
    if (active === 'thief' && phase === 'bag') blips.push({ kind: 'target', x: T.bag.x, z: T.bag.z });
    if (active === 'thief' && phase === 'return' && T.victim?.alive) blips.push({ kind: 'encounter', x: T.victim.pos.x, z: T.victim.pos.z });
    if (active === 'pregnant' && (phase === 'wait' || phase === 'board')) blips.push({ kind: 'encounter', x: B.kerb.x, z: B.kerb.z, flash: true });
    if (active === 'pregnant' && phase === 'ride' && B.dest) blips.push({ kind: 'dropoff', x: B.dest.x, z: B.dest.z, label: B.dest.label });
    if ((active === 'courier' || active === 'daijia' || active === 'tail' || active === 'foreigner') && phase === 'wait') blips.push({ kind: 'encounter', x: W.kerb.x, z: W.kerb.z, flash: true });
    if (active === 'courier' && phase === 'run' && stops[W.n]) blips.push({ kind: 'dropoff', x: stops[W.n].x, z: stops[W.n].z, label: stops[W.n].label });
    if ((active === 'daijia' && phase === 'drive' || active === 'foreigner' && phase === 'ride') && W.dest) blips.push({ kind: 'dropoff', x: W.dest.x, z: W.dest.z, label: W.dest.label });
    if (active === 'daijia' && phase === 'getin' && D.car) blips.push({ kind: 'target', x: D.car.pos.x, z: D.car.pos.z });
    if (active === 'tail' && TL.run) blips.push({ kind: 'suspect', x: TL.run.car.pos.x, z: TL.run.car.pos.z, heading: Math.atan2(TL.run.car.fwd.x, TL.run.car.fwd.z) });
    return blips;
  });
  engine.add(api);
}
