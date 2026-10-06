import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t, type TKey } from '../core/I18n';
import { Rng } from '../core/Rng';
import { project } from '../city/Geo';
import type { Actor, Blip, DialogueApi, HudApi, MissionApi, NavApi, PeopleApi, PlayerApi, RenderApi, Speaker, VehicleApi, WantedApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import type { DamageApi } from '../damage';
import type { GarageApi } from '../garage';
import type { StoryApi } from '../story';
import type { Action } from '../character/Animator';
import { randomLook, type Look } from '../character/Body';
import { nearestKerb, SIDEWALK } from '../people/Pavement';
import { journalOf } from '../npc/Journal';
import { clearOfWorld, LifeProps, PropBodies, type PropKind } from '../life/Props';
import { setPoliceOnEdge } from '../ui/Minimap';

export type ContactId = 'laok' | 'xiaoyu' | 'daliu' | 'wang' | 'laozhang' | 'liujie' | 'feilong';
const IDS: ContactId[] = ['laok', 'xiaoyu', 'daliu', 'wang', 'laozhang', 'liujie', 'feilong'];
const KEY = 'drivecity.contacts.v1';
/** Friendship points for each heart (0..5). */
const HEARTS = [0, 10, 30, 60, 100, 150];
/** Perks: hearts needed -> what it is (contacts/ and the systems that ask `perk`). */
const PERKS: Partial<Record<ContactId, [number, TKey][]>> = {
  daliu: [[2, 'perk.daliu2'], [4, 'perk.daliu4']], xiaoyu: [[2, 'perk.xiaoyu2'], [4, 'perk.xiaoyu4']], wang: [[2, 'perk.wang2'], [4, 'perk.wang4']],
  laozhang: [[2, 'perk.laozhang2'], [4, 'perk.laozhang4']], liujie: [[1, 'perk.liujie1'], [3, 'perk.liujie3']], laok: [[3, 'perk.laok3']],
};
/** Drawn when the camera is this close to their place. */
const NEAR = 240;

export interface ContactsApi extends System {
  /** Hearts 0..5. */
  hearts(id: ContactId): number;
  /** The perk of `id` that comes at `n` hearts is on. */
  perk(id: ContactId, n: number): boolean;
  /** Garage price multiplier (大刘), bust fine multiplier (王队), the time the police take to lose you (小雨), fares (老张). */
  readonly discount: number; readonly fineScale: number; readonly evadeScale: number; readonly fareScale: number; readonly specialPax: number;
  debug: { add(id: ContactId, pts: number): void; where(): { id: ContactId; x: number; z: number; here: boolean }[]; reset(): void };
}

interface Def {
  id: ContactId; name: TKey; color: string; lat: number; lon: number;
  /** Where on the pavement (0 kerb .. 1 wall), sitting or standing, what they are at. */
  frac: number; act: Action | null; seat?: number; props: [PropKind, number, number, number][];
  look(rnd: () => number): Look; chat: TKey[];
}
const C = (h: string) => new THREE.Color(h);
const DEFS: Def[] = [
  { id: 'laok', name: 'who.laok', color: '#f3b50f', lat: 39.9093, lon: 116.4248, frac: 0.8, act: 'drink', seat: 0.36, props: [['table', 0, 0.75, 0], ['stool', 0, 0, 0]],
    look: (r) => ({ ...randomLook(r), fem: 0, age: 0.62, top: 'jacket', shirt: C('#16171a'), inner: C('#7a1f22'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: C('#1a1b1e'), hairStyle: 'buzz', glasses: true, beard: true, cap: null, mask: null, print: false, build: 0.4 }),
    chat: ['con.laok.chat1', 'con.laok.chat2'] },
  { id: 'xiaoyu', name: 'who.xiaoyu', color: '#5ac8fa', lat: 39.9087, lon: 116.4508, frac: 0.8, act: 'chess', seat: 0.36, props: [['table', 0, 0.7, 0], ['stool', 0, 0, 0]],
    look: (r) => ({ ...randomLook(r), fem: 1, age: 0.18, top: 'hoodie', shirt: C('#2b3f6b'), inner: C('#2b3f6b'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: C('#1b1c22'), hairStyle: 'bob', fringe: true, glasses: true, cap: null, mask: null, print: false }),
    chat: ['con.xiaoyu.chat1', 'con.xiaoyu.chat2'] },
  { id: 'daliu', name: 'who.daliu', color: '#ff6b5a', lat: 39.9140, lon: 116.4545, frac: 0.6, act: null, props: [],
    look: (r) => ({ ...randomLook(r), fem: 0, age: 0.4, top: 'jacket', shirt: C('#2f4a6b'), inner: C('#9a6a3a'), sleeve: 0.36, bottom: 'trousers', hem: 0.8, pants: C('#2d3a52'), hairStyle: 'short', beard: true, cap: C('#2f4a6b'), mask: null, print: false, build: 0.7 }),
    chat: ['con.daliu.chat1', 'con.daliu.chat2'] },
  { id: 'wang', name: 'who.wang', color: '#6f9dff', lat: 39.9068, lon: 116.4335, frac: 0.55, act: null, props: [],
    look: (r) => ({ ...randomLook(r), fem: 0, age: 0.5, top: 'jacket', shirt: C('#1d2a44'), inner: C('#9fb7d9'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: C('#1d2a44'), hairStyle: 'short', cap: C('#1d2a44'), mask: null, glasses: false, print: false, build: 0.3 }),
    chat: ['con.wang.chat1', 'con.wang.chat2'] },
  { id: 'laozhang', name: 'con.who.laozhang', color: '#e6b35c', lat: 39.9035, lon: 116.4215, frac: 0.4, act: null, props: [],
    look: (r) => ({ ...randomLook(r), fem: 0, age: 0.75, top: 'jacket', shirt: C('#4a5a3a'), inner: C('#e8e6df'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: C('#2a2c2f'), hairStyle: 'buzz', cap: C('#3a3a36'), mask: null, print: false }),
    chat: ['con.laozhang.chat1', 'con.laozhang.chat2'] },
  { id: 'liujie', name: 'con.who.liujie', color: '#ff9f1c', lat: 39.9065, lon: 116.4492, frac: 0.55, act: 'cook', props: [['cart', 0, -0.8, 0]],
    look: (r) => ({ ...randomLook(r), fem: 1, age: 0.48, top: 'shirt', shirt: C('#f2f1ec'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: C('#2a2c2f'), hairStyle: 'bun', cap: C('#d8202a'), mask: null, print: false, build: 0.4 }),
    chat: ['con.liujie.chat1'] },
  { id: 'feilong', name: 'con.who.feilong', color: '#ff3b6b', lat: 39.9045, lon: 116.4615, frac: 0.5, act: 'talk', props: [],
    look: (r) => ({ ...randomLook(r), fem: 0, age: 0.12, top: 'hoodie', shirt: C('#c4231c'), inner: C('#c4231c'), sleeve: 0.53, bottom: 'trousers', hem: 0.8, pants: C('#141518'), hairStyle: 'short', cap: C('#111214'), mask: null, print: true, build: -0.2 }),
    chat: ['con.feilong.chat1'] },
];

/**
 * The people of the story met in person (P3 of the NPC plan): 老K at his tea table, 小雨 at her phone stall,
 * 大刘 by his garage, 王队 outside the police station, and three new ones - 老张 the old cabbie at the
 * station's rank, 刘姐 at her 煎饼 cart, 小飞龙 who races. Each stands at their place (on the map as a
 * contact) when the camera comes near; F to talk: the job going (the story's task, told again), a chat,
 * and what their friendship gives. Friendship (0-5 hearts, `drivecity.contacts.v1`) grows with their
 * chapters done, fares (老张), food bought (刘姐), races won (小飞龙) and a chat a visit, and opens perks:
 *   大刘    free repairs, then 20% off at the garage
 *   小雨    the police at the radar's edge, then losing them faster
 *   王队    fines halved, then at one star a stop is a warning
 *   老张    fares +20%, then more special passengers
 *   刘姐    a free 煎饼, then the street's news (gossip on the map)
 *   老K     more from the heist
 *   小飞龙  beat him three times and his tuning is yours.
 */
export async function install(engine: Engine): Promise<void> {
  const pl = engine.get<PlayerApi>('player');
  const people = engine.get<PeopleApi>('people');
  const tr = engine.get<TrafficApi>('traffic');
  if (!pl || !people?.spawnActor || !tr) return;
  const g = tr.graph;
  // Off in shot mode (the poses' streets stay as they were) unless ?contacts=1.
  const q = new URLSearchParams(location.search);
  const show = !q.has('shot') || q.get('contacts') === '1';
  const rng = new Rng(9393);
  const rnd = () => rng.next();
  const journal = journalOf(engine);
  const props = new LifeProps(engine.scene, engine.get<RenderApi>('render')?.uniforms);
  const bodies = new PropBodies(engine);
  const _pm = new THREE.Matrix4();
  const dlg = () => engine.get<DialogueApi>('dialogue');
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s);
  const missions = () => engine.get<MissionApi>('missions');
  const at = { x: 0, z: 0, dx: 0, dz: 0 };

  let pts: Record<string, number> = {}, wins = 0;
  try { const s = JSON.parse(localStorage.getItem(KEY) ?? '{}'); pts = s.pts ?? {}; wins = s.wins ?? 0; } catch { /* private mode */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({ pts, wins })); } catch { /* ignore */ } };
  const heartsOf = (id: ContactId) => { const p = pts[id] ?? 0; let h = 0; while (h < 5 && p >= HEARTS[h + 1]) h++; return h; };
  const heartText = (n: number) => '♥'.repeat(n) + '♡'.repeat(5 - n);
  const def = (id: ContactId) => DEFS.find((d) => d.id === id)!;

  /** Friendship up: a heart (and a perk) is said out loud. */
  const add = (id: ContactId, n: number) => {
    const before = heartsOf(id);
    pts[id] = (pts[id] ?? 0) + n;
    save();
    const after = heartsOf(id);
    if (after <= before) return;
    const name = t(def(id).name);
    toast(t('con.hearts', { name, hearts: heartText(after) }));
    for (const [h, key] of PERKS[id] ?? []) if (h > before && h <= after) setTimeout(() => toast(t('con.unlock', { perk: t(key) })), 2200);
  };

  // Where each one is: the pavement nearest their place (resolved once the graph is in).
  interface Here { d: Def; x: number; z: number; yaw: number; actor: Actor | null; chatted: boolean; looks: Look; bodies: (ReturnType<PropBodies['add']>)[];
    /** Their pavement (link, arc length, side), and whether the spot has been checked clear of trees and posts. */
    k: { link: number; s: number; side: number } | null; settled: boolean }
  const here: Here[] = DEFS.map((d) => {
    const [ax, az] = project(d.lat, d.lon);
    const k = nearestKerb(g, ax, az, 220, 0.8);
    let x = ax, z = az, yaw = 0;
    if (k) {
      const l = g.links[k.link], w = SIDEWALK[l.cls] ?? 2.5;
      g.at(l, k.s, k.side * (l.hw + w * d.frac), at);
      x = at.x; z = at.z; yaw = Math.atan2(-k.side * at.dz, k.side * at.dx);   // facing the road
    }
    return { d, x, z, yaw, actor: null, chatted: false, looks: d.look(rnd), bodies: [], k: k ? { link: k.link, s: k.s, side: k.side } : null, settled: false };
  });

  // Their voice carries who they are: their lines are recorded in their own voice (audio/VoiceClips.ts).
  const speakerOf = (h: Here): Speaker => ({ name: `${t(h.d.name)} ${heartText(heartsOf(h.d.id))}`, color: h.d.color, look: h.looks, voice: h.actor ? { ...h.actor.voice, character: h.d.id } : undefined, at: h.actor?.pos ?? null });

  // 小飞龙's race: agreed on foot, it starts once the player is driving off near him.
  let duel = 0;
  engine.events.on('challenge:result', ({ won }) => {
    if (duel <= 0) return;
    duel = 0;
    const h = here.find((q) => q.d.id === 'feilong')!;
    const sp = { name: t(h.d.name), color: h.d.color, look: h.looks };
    if (!won) { add('feilong', 3); dlg()?.say(sp, t('con.feilong.lost'), { prio: 2 }); return; }
    wins++; save(); add('feilong', 15);
    toast(t('con.feilong.wins', { n: Math.min(3, wins), of: 3 }));
    if (wins === 3) {
      dlg()?.say(sp, t('con.feilong.pink'), { prio: 2 });
      const gar = engine.get<GarageApi>('garage'), p = gar?.profile;
      gar?.adopt({ engine: Math.min(3, (p?.engine ?? 0) + 1), tyres: p?.tyres ?? 0, nitro: Math.min(3, (p?.nitro ?? 0) + 1) });
    } else dlg()?.say(sp, t('con.feilong.won'), { prio: 2 });
  });

  // Friendship from what the player does.
  engine.events.on('story:done', ({ chapter, who }) => {
    if (chapter === 'heist') for (const id of ['laok', 'xiaoyu', 'daliu'] as ContactId[]) add(id, 30);
    else if (IDS.includes(who as ContactId)) add(who as ContactId, 25);
    if (chapter === 'heist') add('wang', 10);   // he knows, and he is watching
  });
  engine.events.on('taxi:fare', () => add('laozhang', 2));

  const talk = (h: Here) => {
    const id = h.d.id, sp = speakerOf(h), story = engine.get<StoryApi>('story');
    if (!pts[id]) journal.meet(`con.${id}`);
    if (!h.chatted) { h.chatted = true; add(id, 3); }
    h.actor?.face(pl.position.x, pl.position.z);
    const opts: { label: string; go: () => void }[] = [];
    const task = story?.task;
    if (IDS.slice(0, 4).includes(id)) opts.push({ label: t('con.optTask'), go: () => dlg()?.say(sp, task && task.who === id ? t('con.task', { task: task.text }) : t('con.noTask'), { prio: 2 }) });
    if (id === 'daliu' && heartsOf(id) >= 2) opts.push({ label: t('con.daliu.optRepair'), go: () => { engine.get<DamageApi>('damage')?.repair(); dlg()?.say(sp, t('con.daliu.repaired'), { prio: 2 }); } });
    if (id === 'liujie') {
      opts.push({ label: t('con.liujie.optFood'), go: () => {
        const free = heartsOf(id) >= 1;
        if (!free) { const m = missions(); if (!m || m.cash < 8) { toast(t('life.noCash')); return; } m.addCash(-8); }
        pl.heal(free ? 60 : 35); add(id, 5);
        dlg()?.say(sp, t(free ? 'con.liujie.free' : 'life.jianbing.buy'), { prio: 2 });
      } });
      if (heartsOf(id) >= 3) opts.push({ label: t('con.liujie.optNews'), go: () => { engine.get<{ name: string; gossip(s: Speaker): boolean }>('life')?.gossip(sp); } });
    }
    if (id === 'feilong') opts.push({ label: t('con.feilong.optDuel'), go: () => { duel = 60; dlg()?.say(sp, t('con.feilong.duelOn'), { prio: 2 }); } });
    if (opts.length < 2) opts.push({ label: t('con.optChat'), go: () => dlg()?.say(sp, t(h.d.chat[Math.floor(rnd() * h.d.chat.length)]), { prio: 2 }) });
    opts.push({ label: t('con.optBye'), go: () => {} });
    dlg()?.ask(sp, t(`con.${id}.greet` as TKey), opts.slice(0, 3).map((o) => o.label), (i) => opts[i]?.go(), { prio: 3, timeout: 15, fallback: opts.length - 1 });
  };

  // 王队's warning: one star, stopped near a police car for 3 s.
  let comply = 0;
  const blips: Blip[] = [];
  const api: ContactsApi = {
    name: 'contacts',
    hearts: heartsOf,
    perk: (id, n) => heartsOf(id) >= n,
    get discount() { return heartsOf('daliu') >= 4 ? 0.2 : 0; },
    get fineScale() { return heartsOf('wang') >= 2 ? 0.5 : 1; },
    get evadeScale() { return heartsOf('xiaoyu') >= 4 ? 0.7 : 1; },
    get fareScale() { return heartsOf('laozhang') >= 2 ? 1.2 : 1; },
    get specialPax() { return heartsOf('laozhang') >= 4 ? 2 : 1; },
    debug: {
      add: (id, n) => add(id, n),
      where: () => here.map((h) => ({ id: h.d.id, x: h.x, z: h.z, here: !!h.actor?.alive })),
      reset: () => { pts = {}; wins = 0; save(); },
    },
    fixedUpdate(dt) {
      const cam = engine.camera.position;
      for (const h of here) {
        const d = Math.hypot(h.x - cam.x, h.z - cam.z);
        if (show && d < NEAR && !h.actor?.alive) {
          // Their spot clear of the street trees and posts (their colliders are in by now) - room for a table
          // or a cart, or just to stand: along the same pavement, nearest first.
          const room = h.d.props.length ? [1.1, 1.3] : [0.7, 0.7];
          if (!h.settled && h.k) {
            h.settled = true;
            const l = g.links[h.k.link], w = SIDEWALK[l.cls] ?? 2.5;
            for (const ds of [0, 2, -2, 4, -4, 6, -6, 8, -8, 10, -10, 13, -13]) {
              const s2 = h.k.s + ds;
              if (s2 < 2 || s2 > l.len - 2) continue;
              g.at(l, s2, h.k.side * (l.hw + w * h.d.frac), at);
              const yaw = Math.atan2(-h.k.side * at.dz, h.k.side * at.dx);
              if (!clearOfWorld(engine.physics, at.x, at.z, yaw, room[0], room[1])) continue;
              h.x = at.x; h.z = at.z; h.yaw = yaw;
              break;
            }
          }
          h.actor = people.spawnActor!(h.x, h.z, { look: h.looks, yaw: h.yaw });
          h.actor?.act(h.d.act, { seat: h.d.seat });
          h.chatted = false;
          // their table, stool or cart, solid (put back where it belongs each time they are)
          for (const b of h.bodies) bodies.remove(b);
          h.bodies = h.d.props.map(([k, ox, oz, yaw]) => { const c = Math.cos(h.yaw), s = Math.sin(h.yaw); return bodies.add(k, h.x + ox * c + oz * s, 0.045, h.z - ox * s + oz * c, h.yaw + yaw); });
        } else if (d > NEAR + 40 && h.actor?.alive) { h.actor.release('vanish'); h.actor = null; for (const b of h.bodies) bodies.remove(b); h.bodies = []; }
        // Knocked off their spot: back to it.
        const a = h.actor;
        if (a?.alive && a.state === 'script' && Math.hypot(a.pos.x - h.x, a.pos.z - h.z) > 0.5 && a.arrived) a.goTo(h.x, h.z, 1.3);
      }
      bodies.update();
      setPoliceOnEdge(heartsOf('xiaoyu') >= 2);
      const story = engine.get<StoryApi>('story');
      if (story) story.payScale = heartsOf('laok') >= 3 ? 1.25 : 1;
      // 小飞龙: the race starts when the player drives off near him.
      if (duel > 0) {
        duel -= dt;
        const v = engine.get<VehicleApi>('vehicle'), f = here.find((q) => q.d.id === 'feilong')!;
        if (pl.mode === 'driving' && v && v.car.speed > 4 && Math.hypot(v.car.pos.x - f.x, v.car.pos.z - f.z) < 300) {
          const ev = engine.get<{ name: string; active: unknown; debug: { start(k: string): boolean } }>('events');
          if (!ev?.active && ev?.debug.start('challenge')) duel = 1e9;   // until its result
        }
        if (duel <= 0) duel = 0;
      }
      // 王队's word: at one star, stop the car with a police car close by.
      const w = engine.get<WantedApi>('wanted');
      if (w && w.level === 1 && heartsOf('wang') >= 4) {
        const v = engine.get<VehicleApi>('vehicle')!, P = pl.position;
        const near = w.policeCars().some((c) => Math.hypot(c.pos.x - P.x, c.pos.z - P.z) < 40);
        comply = near && (pl.mode !== 'driving' || v.car.speed < 0.8) ? comply + dt : 0;
        if (comply > 3) { comply = 0; w.clear(); toast(t('con.warning')); }
      } else comply = 0;
    },
    update() {
      props.begin();
      const f = pl.foot;
      for (const h of here) {
        const a = h.actor;
        if (!a?.alive) continue;
        h.d.props.forEach(([k, ox, oz, yaw], i) => {
          const b = h.bodies[i];
          if (b) { props.add(k, bodies.matrix(b, _pm)); return; }
          const c = Math.cos(h.yaw), s = Math.sin(h.yaw);
          props.place(k, h.x + ox * c + oz * s, 0.045, h.z - ox * s + oz * c, h.yaw + yaw);
        });
        if (f && Math.hypot(a.pos.x - f.pos.x, a.pos.z - f.pos.z) < 2.6 && !dlg()?.asking) {
          pl.offer?.({ x: a.pos.x, z: a.pos.z, r: 2.6, label: t('con.talk', { name: t(h.d.name) }), use: () => talk(h) });
        }
      }
      props.commit();
    },
  };
  engine.events.on('vehicle:reset', () => { duel = 0; });
  engine.get<NavApi>('nav')?.addBlips(() => {
    blips.length = 0;
    if (show) for (const h of here) blips.push({ kind: 'contact', x: h.x, z: h.z, label: t('con.mapLabel', { name: t(h.d.name), role: t(`con.role.${h.d.id}` as TKey) }), color: h.d.color });
    return blips;
  });
  engine.add(api);
}
