import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t, type TKey } from '../core/I18n';
import { Rng } from '../core/Rng';
import type { Actor, DialogueApi, HudApi, MissionApi, NavApi, PeopleApi, PlayerApi, RenderApi, Speaker, VehicleApi, WantedApi, WorldApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import type { Link } from '../traffic/LaneGraph';
import type { MusicKind, MusicSource } from '../audio/StreetMusic';
import type { CollectApi } from '../collect';
import type { JumpApi } from '../stunts/Jumps';
import { loadCity } from '../city/Data';
import { J, randomLook, type Look } from '../character/Body';
import type { Action } from '../character/Animator';
import { nearestKerb, SIDEWALK } from '../people/Pavement';
import { journalOf } from '../npc/Journal';
import { DanceGame } from './DanceGame';
import { LifeProps, type PropKind } from './Props';

type Kind = 'dance' | 'taichi' | 'chess' | 'birds' | 'jianbing' | 'bbq' | 'busker' | 'tour' | 'police' | 'sweeper';
const KINDS: Kind[] = ['dance', 'taichi', 'chess', 'birds', 'jianbing', 'bbq', 'busker', 'tour', 'police', 'sweeper'];

/** When each happens (hours; an end past 24 runs on into the night), and which stop in the rain. */
const HOURS: Record<Kind, [number, number][]> = {
  dance: [[18.5, 21.5]], taichi: [[6, 9.5]], chess: [[8.5, 18]], birds: [[6.5, 10.5]], jianbing: [[6, 10.5]], bbq: [[18.5, 26]],
  busker: [[10, 22]], tour: [[9, 17]], police: [[7, 9.5], [17, 19.5]], sweeper: [[5, 8.5]],
};
const DRY = new Set<Kind>(['dance', 'taichi', 'chess', 'birds', 'bbq', 'busker', 'tour']);
/** How many of each at once round the player. */
const MAX: Record<Kind, number> = { dance: 1, taichi: 1, chess: 1, birds: 1, jianbing: 2, bbq: 1, busker: 1, tour: 1, police: 1, sweeper: 1 };
/** People in scenes at most, by tier (they come out of the passers-by's share of the crowd). */
const BUDGET = { low: 14, medium: 22, high: 30 } as const;
/** Scenes come up this far from the camera and go beyond OFF. */
const ON = [55, 210], OFF = 270;
export const PRICE = { jianbing: 8, bbq: 25, tip: 10, photo: 20 };

export interface LifeApi extends System {
  /** Where the nearest 兔儿爷 or stunt ramp not done yet is, said by `who` and marked on the map. */
  gossip(who: Speaker): boolean;
  /** What is playing in the street, for audio/. */
  readonly music: readonly MusicSource[];
  debug: { spawn(kind: Kind, x?: number, z?: number): boolean; sites(): { square: number[][]; park: number[][] }; scenes(): { kind: Kind; x: number; z: number; yaw: number; cast: number; state: string; join: { x: number; z: number } | null; people: { x: number; z: number }[] }[]; clear(): void };
}

interface Placed { kind: PropKind; x: number; y: number; z: number; yaw: number }
interface Scene {
  kind: Kind; x: number; z: number; yaw: number; cast: Actor[]; props: Placed[]; t: number; state: string;
  /** Where the music comes from and its clock. */
  music?: { kind: MusicKind; x: number; z: number };
  site: string;
  /** Where the player can join in (the dance's empty place, the tai chi's), for probes. */
  joinAt?: { x: number; z: number };
  step(dt: number): void;
  /** Each frame: offers to the player, hand-held props. */
  frame?(dt: number): void;
}

/**
 * Street life by the clock (P2 of the NPC plan): the city's daily round, put up near the player and
 * taken down behind them -
 *   dance     广场舞 in a square in the evening, a speaker playing; F at the empty place in the back
 *             row to join (DanceGame: arrows on the beat); drive through them and they scatter
 *   taichi    tai chi in a park in the morning; join for a minute and health comes back
 *   chess     two old men over a 象棋 board, two more watching; birds: cages hung on a tree, their
 *             keepers chatting under it - both give gossip: where a 兔儿爷 or a stunt ramp is
 *   jianbing  a 煎饼果子 cart by a subway exit in the morning; bbq: a 烤串 stall at night, a lantern,
 *             people on 马扎 drinking - food heals
 *   busker    a guitar or an 二胡 by a subway exit; tip them
 *   tour      a group behind a flag by a landmark; take their photo
 *   police    a traffic officer at a lit junction at rush hour: run his red and he blows the whistle
 *   sweeper   an orange-coated sweeper on the pavement at dawn
 * Squares and parks come from public/city/sites.json (scripts/city/sites.mjs), the stalls from the
 * subway entrances and the pavements. Everyone is a scripted pedestrian (PeopleApi.spawnActor).
 */
export async function install(engine: Engine): Promise<void> {
  const pl = engine.get<PlayerApi>('player');
  const people = engine.get<PeopleApi>('people');
  const tr = engine.get<TrafficApi>('traffic');
  if (!pl || !people?.spawnActor || !tr) return;
  const g = tr.graph;
  const q = new URLSearchParams(location.search);
  const auto = q.get('life') !== '0' && (!q.has('shot') || q.get('life') === '1');
  const rng = new Rng(6161);
  const rnd = () => rng.next();
  const pick = <T>(xs: readonly T[]) => xs[Math.floor(rnd() * xs.length)];
  const journal = journalOf(engine);
  const props = new LifeProps(engine.scene, engine.get<RenderApi>('render')?.uniforms);
  const budget = BUDGET[engine.quality.tier];
  const dance = new DanceGame(engine, (hits, of) => danceDone(hits, of));

  let sites: { square: number[][]; park: number[][] } = { square: [], park: [] };
  let kiosks: number[][] = [];
  let loaded = false;
  const load = () => {
    if (loaded) return;
    loaded = true;
    void loadCity<{ square: number[][]; park: number[][] }>('sites.json').then((s) => { sites = s; }).catch(() => {});
    void loadCity<{ e: number[][] }>('entrances.json').then((e) => { kiosks = e.e; }).catch(() => {});
  };
  engine.events.on('game:start', load);
  if (!q.has('shot') || q.get('life') === '1') load();

  const dlg = () => engine.get<DialogueApi>('dialogue');
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const missions = () => engine.get<MissionApi>('missions');
  const render = () => engine.get<RenderApi>('render');
  const vehicle = () => engine.get<VehicleApi>('vehicle')!;
  const camDir = new THREE.Vector3();
  const at = { x: 0, z: 0, dx: 0, dz: 0 };
  const C = (h: string) => new THREE.Color(h);
  const speaker = (a: Actor, key: TKey, color: string): Speaker => ({ name: t(key), color, look: a.look, voice: a.voice, at: a.pos });
  const pay = (n: number): boolean => { const m = missions(); if (!m || m.cash < n) { toast(t('life.noCash')); return false; } m.addCash(-n); return true; };

  // ---------------------------------------------------------------- looks

  const looks = {
    auntie: (): Look => {
      const l = randomLook(rnd);
      l.fem = 1; l.age = 0.5 + rnd() * 0.25; l.build = 0.2 + rnd() * 0.5; l.hairStyle = pick(['bob', 'short', 'bun'] as const); l.cap = null; l.mask = null;
      l.top = pick(['tee', 'shirt', 'jacket'] as const); l.shirt = C(pick(['#d6304a', '#e86aa0', '#8b4fc4', '#f2f0ea', '#e8562a', '#2fa3d8'])); l.inner = C('#f2efe8');
      l.bottom = 'trousers'; l.hem = 0.8; l.pants = C(pick(['#1d1f24', '#2e2a3a', '#f1efe8'])); l.print = rnd() < 0.3;
      return l;
    },
    elder: (fem = rnd() < 0.4): Look => {
      const l = randomLook(rnd);
      l.fem = fem ? 1 : 0; l.age = 0.72 + rnd() * 0.22; l.hairStyle = fem ? pick(['bob', 'short'] as const) : pick(['buzz', 'bald', 'short'] as const); l.cap = null; l.mask = null; l.print = false;
      l.top = pick(['shirt', 'jacket'] as const); l.shirt = C(pick(['#e9e6dc', '#4a4f45', '#5a5246', '#2f3a4a', '#8a8d91', '#c9c3b3'])); l.inner = C('#e2ddd0');
      l.bottom = 'trousers'; l.hem = 0.8; l.pants = C(pick(['#1f2023', '#3a3936', '#2c2e33']));
      return l;
    },
    taichi: (): Look => { const l = looks.elder(); l.top = 'shirt'; l.shirt = C(pick(['#f4f2ec', '#e8e4da', '#d8202a'])); l.sleeve = 0.53; l.pants = C(pick(['#f4f2ec', '#1b1c1f'])); return l; },
    vendor: (): Look => { const l = randomLook(rnd); l.fem = rnd() < 0.6 ? 1 : 0; l.age = 0.4 + rnd() * 0.2; l.top = 'shirt'; l.shirt = C('#f2f1ec'); l.sleeve = 0.53; l.cap = rnd() < 0.5 ? C('#f2f1ec') : null; l.mask = rnd() < 0.3 ? C('#e9eef2') : null; return l; },
    tourist: (): Look => { const l = randomLook(rnd); l.cap = rnd() < 0.6 ? C(pick(['#d8202a', '#f2c21a', '#f2f1ec'])) : null; l.age = 0.2 + rnd() * 0.6; return l; },
    police: (): Look => {
      const l = randomLook(rnd);
      l.fem = rnd() < 0.15 ? 1 : 0; l.age = 0.3 + rnd() * 0.2; l.top = 'jacket'; l.shirt = C('#c6e23a'); l.inner = C('#1d2a44'); l.sleeve = 0.53;
      l.bottom = 'trousers'; l.hem = 0.8; l.pants = C('#1d2a44'); l.cap = C('#f2f2ee'); l.mask = null; l.print = false; l.hairStyle = 'short';
      return l;
    },
    sweeper: (): Look => { const l = looks.elder(rnd() < 0.5); l.age = 0.55 + rnd() * 0.2; l.top = 'jacket'; l.shirt = C('#f06a1c'); l.inner = C('#f06a1c'); l.sleeve = 0.53; l.pants = C('#f06a1c'); l.cap = C('#f06a1c'); return l; },
    busker: (): Look => { const l = randomLook(rnd); l.fem = rnd() < 0.3 ? 1 : 0; l.age = 0.2 + rnd() * 0.15; l.hairStyle = l.fem ? 'long' : pick(['short', 'long'] as const); l.top = pick(['hoodie', 'jacket', 'tee'] as const); l.mask = null; return l; },
  };

  // ---------------------------------------------------------------- places

  /** Probes: look round this point instead of the camera, with no care for being seen. */
  let focus: { x: number; z: number } | null = null;
  const centre = () => focus ?? engine.camera.position;
  const camOK = (x: number, z: number, near: number, far: number): boolean => {
    const cam = centre(), dx = x - cam.x, dz = z - cam.z, d = Math.hypot(dx, dz);
    if (focus) return d < far + 150;
    if (d < near || d > far) return false;
    engine.camera.getWorldDirection(camDir);
    // not popping up in plain view close by
    return !(d < 95 && (dx * camDir.x + dz * camDir.z) / d > 0.35);
  };
  const landmarks = () => engine.get<WorldApi>('world')?.landmarkAreas ?? [];
  const inLandmark = (x: number, z: number) => landmarks().some((a) => a.rings.some((r) => { let c = false; for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > z) !== (r[j + 1] > z) && x < (r[j] - r[i]) * (z - r[i + 1]) / (r[j + 1] - r[i + 1]) + r[i]) c = !c; return c; }));
  const used = new Map<string, number>();   // site -> game seconds when it may be used again
  let clock = 0;
  const free = (site: string) => (used.get(site) ?? -1) < clock && !scenes.some((s) => s.site === site);
  const R2 = (ox: number, oz: number, yaw: number) => ({ x: ox * Math.cos(yaw) + oz * Math.sin(yaw), z: -ox * Math.sin(yaw) + oz * Math.cos(yaw) });

  /** A pavement spot near (x, z): on the kerb side `frac` across the pavement, the road's heading. */
  const pavementAt = (x: number, z: number, r: number, frac = 0.75): { x: number; z: number; yaw: number; side: number; l: Link; s: number } | null => {
    const k = nearestKerb(g, x, z, r, 0.8);
    if (!k) return null;
    const l = g.links[k.link], w = SIDEWALK[l.cls] ?? 2.5;
    g.at(l, k.s, k.side * (l.hw + w * frac), at);
    return { x: at.x, z: at.z, yaw: Math.atan2(at.dx, at.dz), side: k.side, l, s: k.s };
  };

  // ---------------------------------------------------------------- scenes

  const scenes: Scene[] = [];
  const castCount = () => scenes.reduce((n, s) => n + s.cast.length, 0);
  const spawn = (x: number, z: number, look: Look, yaw: number): Actor | null => people.spawnActor!(x, z, { look, yaw });
  const end = (s: Scene, how: 'walk' | 'vanish' = 'walk') => {
    for (const a of s.cast) if (a.alive) a.release(how);
    s.cast = [];
    used.set(s.site, clock + 240);
    scenes.splice(scenes.indexOf(s), 1);
    if (joined?.scene === s) leaveJoin();
  };
  const make = (kind: Kind, x: number, z: number, yaw: number, site: string, cast: (Actor | null)[]): Scene | null => {
    if (cast.some((a) => !a)) { for (const a of cast) a?.release('vanish'); return null; }
    const s: Scene = { kind, x, z, yaw, cast: cast as Actor[], props: [], t: 0, state: 'on', site, step: () => {} };
    scenes.push(s);
    return s;
  };

  // A player joining in (the dance, the tai chi): held in place and posed, released after.
  let joined: { scene: Scene; x: number; z: number; yaw: number; t: number } | null = null;
  const join = (s: Scene, x: number, z: number, action: Action, t0: number) => {
    const f = pl.foot;
    if (!f || joined) return;
    joined = { scene: s, x, z, yaw: s.yaw, t: 0 };
    pl.setRiding({ pos: new THREE.Vector3(x, f.pos.y, z), yaw: s.yaw });
    pl.setPose?.(action, t0);
  };
  function leaveJoin(): void {
    if (!joined) return;
    const j = joined;
    joined = null;
    dance.cancel();
    pl!.setPose?.(null);
    pl!.setRiding(null, { x: j.x - Math.sin(j.yaw) * 1.2, y: 0.2, z: j.z - Math.cos(j.yaw) * 1.2, yaw: j.yaw });
  }

  // --- 广场舞
  const DANCE_ROWS = budget >= 22 ? 3 : 2, DANCE_COLS = budget >= 30 ? 5 : 4;
  const startDance = (site: number[], id: string): Scene | null => {
    const [x, z] = site, yaw = Math.round((Math.sin(x * 0.13 + z * 0.07) * 0.5 + 0.5) * 4) * Math.PI / 2;
    const slot = (r: number, c: number) => { const o = R2((c - (DANCE_COLS - 1) / 2) * 1.7, -1.2 - r * 1.8, yaw); return { x: x + o.x, z: z + o.z }; };
    const cast: (Actor | null)[] = [];
    const lead = R2(0, 2.4, yaw);
    cast.push(spawn(x + lead.x, z + lead.z, looks.auntie(), yaw + Math.PI));
    for (let r = 0; r < DANCE_ROWS; r++) for (let c = 0; c < DANCE_COLS; c++) {
      if (r === DANCE_ROWS - 1 && c === DANCE_COLS - 1) continue;   // the player's place
      const p = slot(r, c); cast.push(spawn(p.x, p.z, looks.auntie(), yaw));
    }
    const s = make('dance', x, z, yaw, id, cast);
    if (!s) return null;
    const free0 = slot(DANCE_ROWS - 1, DANCE_COLS - 1), spk = R2(2.2, 2.6, yaw);
    s.joinAt = free0;
    s.props.push({ kind: 'speaker', x: x + spk.x, y: 0.045, z: z + spk.z, yaw: yaw + Math.PI });
    s.music = { kind: 'dance', x: x + spk.x, z: z + spk.z };
    const homes = s.cast.map((a) => ({ x: a.pos.x, z: a.pos.z }));
    let danceT = 0, back = 0;
    const startMoves = () => s.cast.forEach((a, i) => { a.goTo(homes[i].x, homes[i].z, 1.4); a.act('dance', { t: danceT }); });
    startMoves();
    s.step = (dt) => {
      if (s.state === 'on') {
        danceT += dt;
        // Driven into: they scatter, shout, and come back when it is gone.
        const c = vehicle().car;
        if (pl.mode === 'driving' && c.speed > 3 && Math.hypot(c.pos.x - x, c.pos.z - z) < 8.5) {
          s.state = 'scattered'; back = 0;
          for (const a of s.cast) {
            const dx = a.pos.x - c.pos.x, dz = a.pos.z - c.pos.z, d = Math.hypot(dx, dz) || 1;
            a.act(null); a.goTo(a.pos.x + dx / d * 7, a.pos.z + dz / d * 7, 3.6);
          }
          s.cast[0].say(t('life.dance.scatter1'), 2.6, t('life.who.auntie'));
          s.cast[Math.min(3, s.cast.length - 1)].say(t('life.dance.scatter2'), 2.6, t('life.who.auntie'));
        }
      } else if (s.state === 'scattered') {
        const c = vehicle().car;
        back = Math.hypot(c.pos.x - x, c.pos.z - z) > 15 ? back + dt : 0;
        if (back > 6) { s.state = 'on'; startMoves(); }
      }
      if (joined?.scene === s) dance.update(dt, danceT);
    };
    s.frame = () => {
      if (s.music) (s.music as { t?: number }).t = danceT;
      const f = pl.foot;
      if (s.state === 'on' && f && !joined && Math.hypot(f.pos.x - free0.x, f.pos.z - free0.z) < 2) {
        pl.offer?.({ x: free0.x, z: free0.z, r: 2, label: t('life.join.dance'), use: () => {
          join(s, free0.x, free0.z, 'dance', danceT);
          dlg()?.say(speaker(s.cast[0], 'life.who.auntie', '#e86aa0'), t('life.dance.join'), { prio: 2 });
          dance.begin(danceT);
          journal.meet('life.dance');
        } });
      }
    };
    return s;
  };
  function danceDone(hits: number, of: number): void {
    const s = joined?.scene;
    leaveJoin();
    const n = 10 + hits * 4;
    missions()?.addCash(n);
    toast(t('life.dance.reward', { hits, of, n }));
    if (s?.cast[0]?.alive) dlg()?.say(speaker(s.cast[0], 'life.who.auntie', '#e86aa0'), t(hits >= of * 0.6 ? 'life.dance.good' : 'life.dance.bad'), { prio: 2 });
  }

  // --- 太极
  const startTaichi = (site: number[], id: string): Scene | null => {
    const [x, z] = site, yaw = Math.round((Math.sin(x * 0.11 - z * 0.05) * 0.5 + 0.5) * 4) * Math.PI / 2;
    const n = Math.min(6, budget >= 22 ? 6 : 4), cast: (Actor | null)[] = [];
    const spot = (i: number) => { const o = R2(((i % 3) - 1) * 2.0, -Math.floor(i / 3) * 2.0, yaw); return { x: x + o.x, z: z + o.z }; };
    for (let i = 0; i < n; i++) { const p = spot(i); cast.push(spawn(p.x, p.z, looks.taichi(), yaw)); }
    const s = make('taichi', x, z, yaw, id, cast);
    if (!s) return null;
    s.music = { kind: 'taichi', x, z };
    let tt = 0;
    s.cast.forEach((a) => a.act('taichi', { t: 0 }));
    const place = spot(n);
    s.joinAt = place;
    s.step = (dt) => {
      tt += dt;
      if (joined?.scene === s) {
        joined.t += dt;
        if (joined.t > 16) {
          leaveJoin();
          pl.heal(100);
          toast(t('life.taichi.done'));
        }
      }
    };
    s.frame = () => {
      const f = pl.foot;
      if (f && !joined && Math.hypot(f.pos.x - place.x, f.pos.z - place.z) < 2.2) {
        pl.offer?.({ x: place.x, z: place.z, r: 2.2, label: t('life.join.taichi'), use: () => {
          join(s, place.x, place.z, 'taichi', tt);
          dlg()?.say(speaker(s.cast[0], 'life.who.master', '#e9e6dc'), t('life.taichi.join'), { prio: 2 });
          journal.meet('life.taichi');
        } });
      }
    };
    return s;
  };

  /** The old men's gossip: where the nearest 兔儿爷 or stunt ramp not done yet is (marked on the map). */
  const gossip = (who: Speaker): boolean => {
    const P = pl.position, nav = engine.get<NavApi>('nav');
    const cands: { x: number; z: number; thing: TKey }[] = [
      ...(engine.get<CollectApi>('collect')?.left?.() ?? []).map((p) => ({ ...p, thing: 'life.thing.rabbit' as TKey })),
      ...(engine.get<JumpApi>('jumps')?.left?.() ?? []).map((p) => ({ ...p, thing: 'life.thing.jump' as TKey })),
    ].filter((c) => { const d = Math.hypot(c.x - P.x, c.z - P.z); return d > 60 && d < 2500; });
    if (!cands.length) { dlg()?.say(who, t('life.chess.none'), { prio: 2 }); return false; }
    const c = cands.reduce((a, b) => (Math.hypot(a.x - P.x, a.z - P.z) < Math.hypot(b.x - P.x, b.z - P.z) ? a : b));
    const dx = c.x - P.x, dz = c.z - P.z, m = Math.round(Math.hypot(dx, dz) / 50) * 50;
    const dir = Math.abs(dx) > Math.abs(dz) ? (dx > 0 ? 'life.dir.e' : 'life.dir.w') : (dz > 0 ? 'life.dir.s' : 'life.dir.n');
    dlg()?.say(who, t('life.chess.hint', { thing: t(c.thing), m, dir: t(dir as TKey) }), { prio: 2 });
    nav?.setTarget({ x: c.x, z: c.z, kind: 'waypoint', label: t(c.thing) });
    setTimeout(() => toast(t('life.hintSet')), 1800);
    return true;
  };

  /** Someone in the scene to talk to with F: the nearest of `who` to the player within reach. */
  const talkOffer = (cast: Actor[], label: string, r: number, use: (a: Actor) => void) => {
    const f = pl.foot;
    if (!f) return;
    let best: Actor | null = null, bd = r;
    for (const a of cast) { if (!a.alive || a.state !== 'script') continue; const d = Math.hypot(a.pos.x - f.pos.x, a.pos.z - f.pos.z); if (d < bd) { bd = d; best = a; } }
    if (best) { const b = best; pl.offer?.({ x: b.pos.x, z: b.pos.z, r, label, use: () => use(b) }); }
  };

  // --- 下棋
  const startChess = (site: number[], id: string): Scene | null => {
    const [x, z] = site, yaw = rnd() * Math.PI * 2;
    const a = R2(0.62, 0, yaw), b = R2(-0.62, 0, yaw), k1 = R2(0.2, 1.0, yaw), k2 = R2(-0.5, -1.05, yaw);
    const s = make('chess', x, z, yaw, id, [
      spawn(x + a.x, z + a.z, looks.elder(false), yaw - Math.PI / 2), spawn(x + b.x, z + b.z, looks.elder(false), yaw + Math.PI / 2),
      spawn(x + k1.x, z + k1.z, looks.elder(), yaw + Math.PI), spawn(x + k2.x, z + k2.z, looks.elder(), yaw),
    ]);
    if (!s) return null;
    s.cast[0].act('chess', { seat: 0.36, t: 0 }); s.cast[1].act('chess', { seat: 0.36, t: 4.5 });
    s.cast[2].act('talk'); s.cast[3].act('point');
    for (const i of [0, 1]) s.cast[i].face(x, z);
    s.cast[2].face(x, z); s.cast[3].face(x, z);
    s.props.push({ kind: 'chess', x, y: 0.045, z, yaw }, { kind: 'stool', x: x + a.x, y: 0.045, z: z + a.z, yaw }, { kind: 'stool', x: x + b.x, y: 0.045, z: z + b.z, yaw });
    let sayT = 4;
    s.step = (dt) => {
      sayT -= dt;
      if (sayT <= 0) { sayT = 9 + rnd() * 8; const who = s.cast[Math.floor(rnd() * 4)]; if (who.alive) who.say(t(rnd() < 0.5 ? 'life.chess.talk1' : 'life.chess.talk2'), 2.2, t('life.who.chess')); }
    };
    s.frame = () => talkOffer(s.cast, t('npc.talk'), 2.2, (who) => { journal.meet('life.chess'); gossip(speaker(who, 'life.who.chess', '#c9b38a')); });
    return s;
  };

  // --- 遛鸟
  const startBirds = (site: number[], id: string): Scene | null => {
    if (site.length < 5) return null;
    const [x, z, , tx, tz] = site, yaw = Math.atan2(x - tx, z - tz);
    const p1 = R2(0.6, 1.4, yaw), p2 = R2(-0.8, 1.6, yaw);
    const s = make('birds', tx, tz, yaw, id, [spawn(tx + p1.x, tz + p1.z, looks.elder(false), yaw + Math.PI * 0.8), spawn(tx + p2.x, tz + p2.z, looks.elder(false), yaw - Math.PI * 0.8)]);
    if (!s) return null;
    s.cast[0].act('talk'); s.cast[1].act(null);
    s.cast[0].face(s.cast[1].pos.x, s.cast[1].pos.z); s.cast[1].face(s.cast[0].pos.x, s.cast[0].pos.z);
    for (const [ox, oy] of [[0.9, 1.95], [-0.8, 2.15]]) { const o = R2(ox, 0.3, yaw); s.props.push({ kind: 'cage', x: tx + o.x, y: oy, z: tz + o.z, yaw }); }
    s.music = { kind: 'birds', x: tx, z: tz };
    s.frame = () => talkOffer(s.cast, t('npc.talk'), 2.2, (who) => {
      journal.meet('life.birds');
      const sp = speaker(who, 'life.who.birds', '#c9b38a');
      dlg()?.say(sp, t('life.birds.talk'), { prio: 2 });
      gossip(sp);
    });
    return s;
  };

  /** A subway kiosk within reach: its middle, its axis, its length. */
  const kioskNear = (taken: (k: number[]) => boolean): { x: number; z: number; yaw: number; len: number; id: string } | null => {
    const cands = kiosks.filter((k) => camOK(k[0], k[1], ON[0] - 15, ON[1]) && !taken(k));
    if (!cands.length) return null;
    const k = pick(cands);
    return { x: k[0], z: k[1], yaw: k[2], len: k[3], id: `k${k[0].toFixed(0)}_${k[1].toFixed(0)}` };
  };

  // --- 煎饼摊
  const startJianbing = (): Scene | null => {
    const k = kioskNear((kk) => !free(`k${kk[0].toFixed(0)}_${kk[1].toFixed(0)}`));
    if (!k) return null;
    const ax = Math.sin(k.yaw), az = Math.cos(k.yaw), d = k.len / 2 + 3;
    const p = pavementAt(k.x + ax * d, k.z + az * d, 12, 0.55);
    if (!p || inLandmark(p.x, p.z)) return null;
    const yaw = Math.atan2(-p.side * at.dz, p.side * at.dx);   // the customers' side to the road
    const cook = R2(0, 0.8, yaw);
    const cast: (Actor | null)[] = [spawn(p.x + cook.x, p.z + cook.z, looks.vendor(), yaw + Math.PI)];
    const queue = 1 + Math.floor(rnd() * 3);
    for (let i = 0; i < queue; i++) { const o = R2(0.4 - i * 0.3, -1.0 - i * 0.8, yaw); cast.push(spawn(p.x + o.x, p.z + o.z, randomLook(rnd), yaw)); }
    const s = make('jianbing', p.x, p.z, yaw, k.id, cast);
    if (!s) return null;
    s.cast[0].act('cook');
    for (let i = 1; i < s.cast.length; i++) s.cast[i].act(i === 1 ? null : 'phone');
    s.props.push({ kind: 'cart', x: p.x, y: 0.045, z: p.z, yaw });
    s.frame = () => talkOffer([s.cast[0]], t('life.buy.jianbing', { n: PRICE.jianbing }), 2.8, (who) => {
      if (!pay(PRICE.jianbing)) return;
      pl.heal(35); journal.meet('life.jianbing');
      dlg()?.say(speaker(who, 'life.who.jianbing', '#f2c21a'), t('life.jianbing.buy'), { prio: 2 });
      setTimeout(() => toast(t('life.jianbing.done', { n: 35 })), 1500);
    });
    return s;
  };

  // --- 烤串
  const startBbq = (): Scene | null => {
    const cam = centre();
    for (let k = 0; k < 16; k++) {
      const ang = rnd() * Math.PI * 2, d = ON[0] + rnd() * (ON[1] - ON[0]) * 0.7;
      const p = pavementAt(cam.x + Math.sin(ang) * d, cam.z + Math.cos(ang) * d, 30, 0.7);
      if (!p || !['residential', 'tertiary', 'unclassified'].includes(p.l.cls) || !camOK(p.x, p.z, ON[0], ON[1]) || inLandmark(p.x, p.z)) continue;
      const id = `b${p.x.toFixed(0)}_${p.z.toFixed(0)}`;
      if (!free(id)) continue;
      const yaw = p.yaw, cast: (Actor | null)[] = [];
      const cookAt = R2(0, 0.6, yaw);
      cast.push(spawn(p.x + cookAt.x, p.z + cookAt.z, looks.vendor(), yaw + Math.PI));
      const tables = budget >= 22 ? 2 : 1, placed: Placed[] = [];
      for (let ti = 0; ti < tables; ti++) {
        const c = R2(0, 2.4 + ti * 2.4, yaw), cx = p.x + c.x, cz = p.z + c.z;   // along the pavement
        placed.push({ kind: 'table', x: cx, y: 0.045, z: cz, yaw });
        for (const [ox, oz] of [[0, 0.75], [0, -0.75], [-0.7, 0]]) {
          const o = R2(ox, oz, yaw), sx = cx + o.x, sz = cz + o.z;
          placed.push({ kind: 'stool', x: sx, y: 0.045, z: sz, yaw: yaw + Math.PI / 2 });
          const a = spawn(sx, sz, randomLook(rnd), Math.atan2(cx - sx, cz - sz));
          cast.push(a);
        }
      }
      const s = make('bbq', p.x, p.z, yaw, id, cast);
      if (!s) return null;
      s.cast[0].act('cook');
      for (let i = 1; i < s.cast.length; i++) s.cast[i].act(rnd() < 0.6 ? 'drink' : 'chess', { seat: 0.36, t: rnd() * 6 });
      const ln = R2(0, -1.0, yaw);
      s.props.push({ kind: 'grill', x: p.x, y: 0.045, z: p.z, yaw }, { kind: 'lantern', x: p.x + ln.x, y: 0.045, z: p.z + ln.z, yaw }, ...placed);
      let smokeT = 0, toastT = 6;
      s.step = (dt) => {
        smokeT -= dt; toastT -= dt;
        if (smokeT <= 0) { smokeT = 0.25; engine.get<{ name: string; smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, shade?: number): void }>('fx')?.smoke(p.x + (rnd() - 0.5) * 0.8, 0.95, p.z, 0, 0.6, 0, 0.5, 2.5, 0.15); }
        if (toastT <= 0) { toastT = 12 + rnd() * 10; const who = s.cast[1 + Math.floor(rnd() * (s.cast.length - 1))]; if (who?.alive) who.say(t('life.bbq.toast'), 2, t('npc.who.passer')); }
      };
      s.frame = () => talkOffer([s.cast[0]], t('life.buy.bbq', { n: PRICE.bbq }), 2.8, (who) => {
        if (!pay(PRICE.bbq)) return;
        pl.heal(50); journal.meet('life.bbq');
        dlg()?.say(speaker(who, 'life.who.bbq', '#ff6a1c'), t('life.bbq.buy'), { prio: 2 });
        setTimeout(() => toast(t('life.bbq.done', { n: 50 })), 1500);
      });
      return s;
    }
    return null;
  };

  // --- 街头艺人
  const startBusker = (): Scene | null => {
    const k = kioskNear((kk) => !free(`k${kk[0].toFixed(0)}_${kk[1].toFixed(0)}`));
    if (!k) return null;
    const ax = Math.sin(k.yaw), az = Math.cos(k.yaw), d = -(k.len / 2 + 2.5);
    const p = pavementAt(k.x + ax * d, k.z + az * d, 12, 0.85);
    if (!p || inLandmark(p.x, p.z)) return null;
    const erhu = rnd() < 0.45, yaw = Math.atan2(-p.side * at.dz, p.side * at.dx);
    const s = make('busker', p.x, p.z, yaw, k.id, [spawn(p.x, p.z, erhu ? looks.elder(false) : looks.busker(), yaw + Math.PI)]);
    if (!s) return null;
    const a = s.cast[0];
    a.act(erhu ? 'erhu' : 'strum', { seat: 0.36 });
    if (erhu) s.props.push({ kind: 'stool', x: p.x, y: 0.045, z: p.z, yaw: yaw + Math.PI / 2 });
    s.music = { kind: erhu ? 'erhu' : 'guitar', x: p.x, z: p.z };
    s.state = erhu ? 'erhu' : 'guitar';
    let tipped = false;
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    s.frame = () => {
      // the instrument in the hands
      if (!a.alive) return;
      const fy = a.yaw;
      if (erhu) {
        a.joint(J.pelvis, m); v.setFromMatrixPosition(m);
        const o = R2(0.06, 0.32, fy);
        props.place('erhu', v.x + o.x, v.y + 0.02, v.z + o.z, fy);
        a.joint(J.wristR, m); v.setFromMatrixPosition(m);
        props.place('bow', v.x, v.y, v.z, fy + Math.PI);
      } else {
        a.joint(J.chest, m); v.setFromMatrixPosition(m);
        const o = R2(0, 0.2, fy);
        _q.setFromEuler(new THREE.Euler(0, fy, 0.35, 'YXZ')); _m.compose(v.set(v.x + o.x, v.y - 0.3, v.z + o.z), _q, _one);
        props.add('guitar', _m);
      }
      if (!tipped) talkOffer([a], t('life.tip', { n: PRICE.tip }), 2.6, (who) => {
        if (!pay(PRICE.tip)) return;
        tipped = true; journal.meet(erhu ? 'life.erhu' : 'life.busker');
        dlg()?.say(speaker(who, erhu ? 'life.who.erhu' : 'life.who.busker', '#7fd1ff'), t('life.busker.thanks'), { prio: 2 });
        toast(t('life.busker.done', { n: PRICE.tip }));
      });
    };
    return s;
  };

  // --- 旅游团
  const startTour = (): Scene | null => {
    const cam = centre();
    const lm = landmarks().map((a) => { const r = a.rings[0]; let x = 0, z = 0; for (let i = 0; i < r.length; i += 2) { x += r[i]; z += r[i + 1]; } return { id: a.id, x: x / (r.length / 2), z: z / (r.length / 2) }; })
      .filter((l) => Math.hypot(l.x - cam.x, l.z - cam.z) < 450 && free(`t${l.id}`));
    if (!lm.length) return null;
    const l = pick(lm);
    // the pavement nearest the landmark, towards the player
    const dx = cam.x - l.x, dz = cam.z - l.z, d = Math.hypot(dx, dz) || 1;
    let p: ReturnType<typeof pavementAt> = null;
    for (let r = 30; r < 220 && !p; r += 30) { const c = pavementAt(l.x + dx / d * r, l.z + dz / d * r, 40, 0.5); if (c && !inLandmark(c.x, c.z) && camOK(c.x, c.z, 30, 260)) p = c; }
    if (!p) return null;
    const face = Math.atan2(l.x - p.x, l.z - p.z), n = budget >= 22 ? 9 : 6, cast: (Actor | null)[] = [];
    const g0 = R2(0, 1.6, face);
    cast.push(spawn(p.x + g0.x, p.z + g0.z, looks.tourist(), face + Math.PI));
    for (let i = 0; i < n; i++) { const o = R2((i % 3 - 1) * 1.0 + (rnd() - 0.5) * 0.4, -Math.floor(i / 3) * 1.0 + (rnd() - 0.5) * 0.4, face); cast.push(spawn(p.x + o.x, p.z + o.z, looks.tourist(), face + (rnd() - 0.5) * 0.6)); }
    const s = make('tour', p.x, p.z, face, `t${l.id}`, cast);
    if (!s) return null;
    s.cast[0].act('talk');
    s.cast.forEach((a, i) => { if (i > 0) a.act(rnd() < 0.4 ? 'photo' : rnd() < 0.5 ? 'point' : null); });
    let sayT = 2, asked = false;
    const m = new THREE.Matrix4(), v = new THREE.Vector3();
    s.step = (dt) => { sayT -= dt; if (sayT <= 0) { sayT = 14 + rnd() * 8; if (s.cast[0].alive) s.cast[0].say(t(rnd() < 0.5 ? 'life.tour.guide1' : 'life.tour.guide2'), 3, t('life.who.guide')); } };
    s.frame = () => {
      const gd = s.cast[0];
      if (gd.alive) { gd.joint(J.wristR, m); v.setFromMatrixPosition(m); props.place('flag', v.x, v.y, v.z, gd.yaw); }
      if (!asked) talkOffer(s.cast.slice(1), t('npc.talk'), 2.2, (who) => {
        asked = true;
        const sp = speaker(who, 'life.who.tourist', '#ffb35c');
        dlg()?.ask(sp, t('life.tour.ask'), [t('life.tour.optYes'), t('life.tour.optNo')], (i) => {
          if (i !== 0) return;
          missions()?.addCash(PRICE.photo); journal.meet('life.tour');
          s.cast.forEach((a, k) => { if (k > 0 && a.alive) { a.face(pl.position.x, pl.position.z); a.act('cheer'); } });
          dlg()?.say(sp, t('life.tour.thanks'), { prio: 2 });
          toast(t('life.tour.done', { n: PRICE.photo }));
        }, { prio: 2, timeout: 10, fallback: 1 });
      });
    };
    return s;
  };

  // --- 交警
  let whistleCool = 0;
  const startPolice = (): Scene | null => {
    const cam = centre();
    const nodes: number[] = [], into: number[] = [];
    for (const id of g.near(cam.x, cam.z, ON[1])) {
      const l = g.links[id], n = l.to;
      if (l.len < 30) continue;
      if (tr.signals.junctionOf(n) < 0 || l.hmax > 0.3 || !['primary', 'secondary', 'trunk', 'tertiary'].includes(l.cls)) continue;
      if (!camOK(g.nodeX[n], g.nodeZ[n], ON[0], ON[1]) || !free(`p${n}`)) continue;
      nodes.push(n); into.push(id);
    }
    if (!nodes.length) return null;
    const i = Math.floor(rnd() * nodes.length), n = nodes[i], nx = g.nodeX[n], nz = g.nodeZ[n], l = g.links[into[i]];
    // On the pavement of a road into it, short of the corner (the junction's mouth has no pavement).
    g.at(l, l.len - 12, 0, at);
    const p = pavementAt(at.x, at.z, 20, 0.35);
    if (!p || Math.hypot(p.x - nx, p.z - nz) > 25) return null;
    const face = Math.atan2(nx - p.x, nz - p.z);
    const s = make('police', p.x, p.z, face, `p${n}`, [spawn(p.x, p.z, looks.police(), face)]);
    if (!s) return null;
    s.cast[0].act('direct');
    s.frame = () => talkOffer(s.cast, t('npc.talk'), 2.2, (who) => { journal.meet('life.police'); dlg()?.say(speaker(who, 'life.who.police', '#c6e23a'), t('life.police.talk'), { prio: 2 }); });
    return s;
  };
  // Through his red light under his nose: the whistle, and a star.
  engine.events.on('stunt:event', ({ kind }) => {
    if (kind !== 'redlight' || whistleCool > 0) return;
    const s = scenes.find((x) => x.kind === 'police');
    const P = pl.position;
    if (!s || !s.cast[0]?.alive || Math.hypot(s.x - P.x, s.z - P.z) > 80) return;
    whistleCool = 45;
    engine.events.emit('life:whistle', { x: s.x, z: s.z });
    s.cast[0].act('point'); s.cast[0].face(P.x, P.z);
    s.cast[0].say(t('life.police.stop'), 2.5, t('life.who.police'));
    setTimeout(() => s.cast[0]?.alive && s.cast[0].act('direct'), 3000);
    journal.meet('life.police');
    engine.get<WantedApi>('wanted')?.crime('report', s.x, s.z);
  });

  // --- 环卫工
  const startSweeper = (): Scene | null => {
    const cam = centre();
    for (let k = 0; k < 10; k++) {
      const ang = rnd() * Math.PI * 2, d = 40 + rnd() * 100;
      const p = pavementAt(cam.x + Math.sin(ang) * d, cam.z + Math.cos(ang) * d, 30, 0.5);
      if (!p || !camOK(p.x, p.z, 35, 160)) continue;
      const w = SIDEWALK[p.l.cls] ?? 2.5, pts: number[] = [];
      for (let u = Math.max(2, p.s - 25); u < Math.min(p.l.len - 2, p.s + 25); u += 3) { g.at(p.l, u, p.side * (p.l.hw + w * 0.5), at); pts.push(at.x, at.z); }
      if (pts.length < 8) continue;
      const s = make('sweeper', p.x, p.z, p.yaw, `s${p.x.toFixed(0)}_${p.z.toFixed(0)}`, [spawn(pts[0], pts[1], looks.sweeper(), p.yaw)]);
      if (!s) return null;
      const a = s.cast[0], back = [...pts];
      for (let i = pts.length - 2; i >= 0; i -= 2) back.push(pts[i], pts[i + 1]);
      a.act('sweep'); a.follow(back, 0.45);
      const m = new THREE.Matrix4(), v = new THREE.Vector3();
      s.step = () => { if (a.alive && a.arrived) a.follow(back, 0.45); };
      s.frame = () => {
        if (!a.alive) return;
        a.joint(J.wristL, m); v.setFromMatrixPosition(m);
        _q.setFromEuler(new THREE.Euler(-0.45, a.yaw, 0, 'YXZ')); _m.compose(v, _q, _one);
        props.add('broom', _m);
        talkOffer(s.cast, t('npc.talk'), 2.2, (who) => { journal.meet('life.sweeper'); dlg()?.say(speaker(who, 'life.who.sweeper', '#f06a1c'), t('life.sweeper.talk'), { prio: 2 }); });
      };
      return s;
    }
    return null;
  };

  /** Start one of `kind` near the camera (the director checks the clock and the budget first). */
  const start = (kind: Kind): Scene | null => {
    const near = (list: number[][], prefix: string) => list.filter((s) => camOK(s[0], s[1], ON[0], ON[1]) && free(`${prefix}${s[0]}_${s[1]}`) && !inLandmark(s[0], s[1]))
      .sort((a, b) => Math.hypot(a[0] - centre().x, a[1] - centre().z) - Math.hypot(b[0] - centre().x, b[1] - centre().z));
    switch (kind) {
      case 'dance': { const c = near(sites.square, 'q')[0]; return c ? startDance(c, `q${c[0]}_${c[1]}`) : null; }
      case 'taichi': { const c = near([...sites.park, ...sites.square], 'q')[0]; return c ? startTaichi(c, `q${c[0]}_${c[1]}`) : null; }
      case 'chess': { const c = near(sites.park, 'q').find((s) => s.length < 5) ?? near(sites.park, 'q')[0]; return c ? startChess(c, `q${c[0]}_${c[1]}`) : null; }
      case 'birds': { const c = near(sites.park, 'q').find((s) => s.length >= 5); return c ? startBirds(c, `q${c[0]}_${c[1]}`) : null; }
      case 'jianbing': return startJianbing();
      case 'bbq': return startBbq();
      case 'busker': return startBusker();
      case 'tour': return startTour();
      case 'police': return startPolice();
      case 'sweeper': return startSweeper();
    }
  };
  /** Its cast size, for the budget. */
  const SIZE: Record<Kind, number> = { dance: DANCE_ROWS * DANCE_COLS, taichi: budget >= 22 ? 6 : 4, chess: 4, birds: 2, jianbing: 3, bbq: budget >= 22 ? 7 : 4, busker: 1, tour: budget >= 22 ? 10 : 7, police: 1, sweeper: 1 };

  const inHours = (kind: Kind, h: number) => HOURS[kind].some(([a, b]) => (h >= a && h < b) || (b > 24 && h < b - 24));

  let dirT = 0;
  const music: MusicSource[] = [];
  const api: LifeApi = {
    name: 'life',
    get music() { return music; },
    gossip: (who) => gossip(who),
    debug: {
      spawn: (kind, x, z) => { load(); focus = x !== undefined && z !== undefined ? { x, z } : null; const ok = !!start(kind); focus = null; return ok; },
      sites: () => sites,
      scenes: () => scenes.map((s) => ({ kind: s.kind, x: s.x, z: s.z, yaw: s.yaw, cast: s.cast.length, state: s.state, join: s.joinAt ?? null, people: s.cast.map((a) => ({ x: a.pos.x, z: a.pos.z })) })),
      clear: () => { while (scenes.length) end(scenes[0], 'vanish'); },
    },
    fixedUpdate(dt) {
      clock += dt; whistleCool -= dt;
      for (const s of [...scenes]) { s.t += dt; s.step(dt); }
      // A cast member knocked down and gone (a car, a shove): the scene carries on without them.
      for (const s of scenes) s.cast = s.cast.filter((a) => a.alive);
      dirT -= dt;
      if (dirT > 0) return;
      dirT = 1.5;
      const r = render(), h = r?.timeOfDay ?? 15, rain = (r?.rain ?? 0) > 0.35;
      const cam = engine.camera.position;
      // Down behind the player, or out of their hours.
      for (const s of [...scenes]) {
        if (joined?.scene === s) continue;
        if (Math.hypot(s.x - cam.x, s.z - cam.z) > OFF || (!inHours(s.kind, h) && s.t > 20) || (rain && DRY.has(s.kind)) || !s.cast.length) end(s);
      }
      if (!auto || !loaded) return;
      const ui = engine.get<{ name: string; state: string }>('ui');
      if (ui && ui.state !== 'playing') return;
      for (const kind of KINDS) {
        if (!inHours(kind, h) || (rain && DRY.has(kind))) continue;
        if (scenes.filter((s) => s.kind === kind).length >= MAX[kind]) continue;
        if (castCount() + SIZE[kind] > budget) continue;
        if (rnd() < 0.5) start(kind);
      }
    },
    update(dt) {
      props.begin();
      music.length = 0;
      for (const s of scenes) {
        for (const p of s.props) props.place(p.kind, p.x, p.y, p.z, p.yaw);
        s.frame?.(dt);
        if (s.music && s.state !== 'scattered') music.push({ id: s.site, kind: s.music.kind, x: s.music.x, z: s.music.z, t: (s.music as { t?: number }).t ?? s.t });
      }
      props.commit();
    },
  };
  engine.add(api);
}
const _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _one = new THREE.Vector3(1, 1, 1);
