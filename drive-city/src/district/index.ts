import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import { Rng } from '../core/Rng';
import type { Actor, Blip, CameraApi, HudApi, MissionApi, NavApi, PeopleApi, PlayerApi, RenderApi, VehicleApi, Wear, WorldApi } from '../game/Contracts';
import type { CollectApi } from '../collect';
import type { MusicSource } from '../audio/StreetMusic';
import { Gait } from '../character/Animator';
import { J, randomLook, type Look } from '../character/Body';
import { project } from '../city/Geo';
import { Fade } from '../campaign/Screens';
import { DanceGame } from '../life/DanceGame';
import { LifeProps } from '../life/Props';
import { css, el } from '../ui/theme';
import META from '../city/landmarks/glb/nanluo.meta.json';
import LAYOUT from './nanluo.layout.json';
import { agePrint, PhotoCard, ShopPanel, type Row } from './Panel';
import {
  blocked, CATALOG, DANCE_PRICE, dancePrize, DEFAULT_WORN, HAIR, type Item, LISTEN_HEAL, loadSave, MAP_MARKS, ownKey, type Save, SHOP_IDS,
  type ShopId, SONG_PRICE, SONGS, WARDROBE, type Wearable, wearable, type WearKind, type Worn,
} from './Shops';

css(`.nl-flash{position:fixed;inset:0;background:#fff;pointer-events:none;z-index:47;opacity:0;transition:opacity .5s ease-out}.nl-flash.on{opacity:.9;transition:none}`);

const KEY = 'drivecity.district.v1';
/** A keeper (and the singer, the old man in the yard) stands at their place while the player is this near it; gone past OFF. */
const ON = 70, OFF = 100;
/** A keeper calls out to a passer-by this near the door, at most every BARK_EVERY s. */
const BARK_R = 7, BARK_EVERY = 25;
/** The counter's reach (F). */
const COUNTER_R = 1.6;
/** Lane walkers, by tier (省电档: LITE). */
const WALKERS = { low: 16, medium: 26, high: 36 } as const, LITE = 9;
/** Every shop gone into once. */
const ALL_VISITED = 200;

export interface DistrictApi extends System {
  /** The player is in one of the shops (its id), or null. */
  readonly inShop: ShopId | null;
  /** Fast travel (the map's 快速前往, missions/ lists it after 送豆腐's): where it goes. */
  travelSpots(): readonly { label: string; x: number; z: number }[];
  /** Go there now (the caller has checked nothing is on). */
  travel(i: number): void;
  /** What is playing in the lane (the dance machine, the bar's singer, the yard's bird), for audio/. */
  readonly music: readonly MusicSource[];
  /** What the player keeps from the lane (the pause screen's progress line). */
  readonly saved: Readonly<Save>;
  /** In a shop, a chair, at a panel or in the courtyard: no street encounter starts (npc/). */
  readonly busy: boolean;
  debug: {
    shops(): Record<string, { door: { x: number; z: number }; counter: { x: number; z: number }; keeper: boolean }>;
    walkers(): number; save(): Save; open(id: ShopId): void; buy(id: ShopId, i: number): string | null;
    world(u: number, s: number): { x: number; z: number }; local(x: number, z: number): [number, number];
    point(name: string): { x: number; z: number } | null; seats(): { x: number; z: number }[]; actors(): Record<string, boolean>;
    wear(kind: WearKind, id: string | null): void;
  };
}

type XY = [number, number];
interface ShopLayout {
  side: string; y0: number; y1: number; door: XY; counter: XY; keeper: XY; keeperFace: XY;
  inside?: XY; room?: [XY, XY]; stall?: boolean; smoke?: XY;
  chair?: XY; chairFace?: XY; camera?: XY; pad?: XY; padFace?: XY; stand?: XY; mirror?: XY;
  seats?: XY[]; stage?: XY; stageFace?: XY; mic?: XY;
}
interface YardLayout { gate: XY; inside: XY; area: [XY, XY]; passage: [XY, XY]; elder: XY; elderFace: XY; cage: XY }

// The model's frame: Blender (bx, by) is the game's local (bx, -by), turned by -heading about the anchor (city/index.ts
// placeLandmarks). The layout's points are in nanluo.py's lane coordinates (u across, s along, unbent): the middle
// stretch was built turned BEND about (0, BY), where the lane bends at 板厂胡同.
const [OX, OZ] = project(META.lat, META.lon);
const ROT = -META.headingDeg * Math.PI / 180, RC = Math.cos(ROT), RS = Math.sin(ROT);
const LANE = LAYOUT.lane as unknown as { half: number; stretches: XY[]; bend: XY; crossings: XY[] };
const BY = LANE.bend[0], BR = LANE.bend[1] * Math.PI / 180, BC = Math.cos(BR), BS = Math.sin(BR);
const bent = (u: number, s: number): XY => (s <= BY ? [u, s] : [u * BC - (s - BY) * BS, BY + u * BS + (s - BY) * BC]);
const unbent = (bx: number, by: number): XY => (by <= BY ? [bx, by] : [bx * BC + (by - BY) * BS, BY - bx * BS + (by - BY) * BC]);
const world = (u: number, s: number): { x: number; z: number } => { const [bx, by] = bent(u, s); return { x: OX + bx * RC - by * RS, z: OZ - bx * RS - by * RC }; };
const local = (x: number, z: number): XY => { const dx = x - OX, dz = z - OZ; return unbent(dx * RC - dz * RS, -(dx * RS + dz * RC)); };
/** The game's yaw (atan2(x, z)) of lane direction (du, ds) at lane position s. */
const yawOf = (du: number, ds: number, s: number): number => {
  const dx = s > BY ? du * BC - ds * BS : du, dy = s > BY ? du * BS + ds * BC : ds;
  return Math.atan2(dx * RC - dy * RS, -dx * RS - dy * RC);
};

const SHOPS = LAYOUT.shops as unknown as Record<ShopId, ShopLayout>;
const MOUTHS = LAYOUT.mouths as unknown as Record<string, XY>;
const YARD = (LAYOUT as unknown as { yard: YardLayout }).yard;
/** The lane between its crossing hutongs (roads: the walkers turn before them). */
const RUNS: XY[] = [];
for (const [s0, s1] of LANE.stretches) {
  let a = s0;
  for (const [c0, c1] of [...LANE.crossings].sort((p, q) => p[0] - q[0])) if (c0 > s0 && c0 < s1) { RUNS.push([a, c0]); a = c1; }
  RUNS.push([a, s1]);
}

interface Keeper { id: ShopId; actor: Actor | null; barkT: number; faceT: number }
interface Walker { u: number; s: number; lo: number; hi: number; dir: number; speed: number; pause: number; lookT: number; gait: Gait; look: Look; seed: number; pos: THREE.Vector3; prev: THREE.Vector3; yaw: number }
/** A chair the player is held in: the barber's, a seat at the bar's tables (listening). */
type Seated = { kind: 'barber'; t: number } | { kind: 'listen'; t: number; seat: number } | null;

/**
 * 南锣鼓巷 (2026-11-03, docs/gta-plan.md §12, 「先做精华街区，要求街区精美，可以进入商店，让用户不只是开车，还能下车活动」): the
 * lane is a landmark (scripts/blender/landmarks/nanluo.py); this runs what happens in it. Shops with a keeper behind
 * the counter (F there: a panel of what they sell), the camera closing in indoors, a crowd strolling the lane, a keeper
 * calling out to passers-by, a hint at the mouths, the map's lantern blip and 快速前往.
 *   snack   food: health back
 *   tea     drinks: a little health and less damage for a few minutes (PlayerApi.guard)
 *   crafts  a hutong map (the three nearest 兔儿爷 on the map) and clay 兔儿爷 to keep
 *   photo   sit before the painted backdrop: a flash, the frame toned as an old print, saved if they like
 *   arcade  the dance machine (life/'s DanceGame on its own clock, music from audio/'s dance voice): prizes by cues hit
 * Round 2 (the middle stretch, 「服装帽子店……剃头铺、小酒馆驻唱、烤串摊。一处四合院院子能走进去」):
 *   clothes hats, sunglasses, jacket and trouser colours tried on at the mirror (PlayerApi.dress; kept, worn online)
 *   barber  hair dyed in the chair before the mirror, a wash, a shave
 *   bar     a singer with a guitar on the stage (audio/'s ballad), a song to request, seats to sit and listen (health)
 *   grill   a skewer stall open to the lane, smoking
 *   yard    a 四合院 behind a gate: an old man at his chess who chats, his bird singing in its cage
 */
export async function install(engine: Engine): Promise<void> {
  const pl = engine.get<PlayerApi>('player'), people = engine.get<PeopleApi>('people');
  if (!pl || !people?.spawnActor) return;
  const q = new URLSearchParams(location.search);
  if (q.has('shot') && !q.has('district')) return;

  let save = loadSave(null);
  try { save = loadSave(localStorage.getItem(KEY)); } catch { /* private mode */ }
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* ignore */ } };
  const missions = () => engine.get<MissionApi>('missions');
  const hud = () => engine.get<HudApi>('hud');
  const toast = (s: string, secs?: number) => hud()?.toast(s, secs);
  const rnd = new Rng(7307);

  // --- what the player wears (bought here; kept in the save, put on at boot) ---
  const wearOf = (w: Worn): Wear => {
    const hat = wearable('hat', w.hat), col = (k: WearKind, id: string) => (id === DEFAULT_WORN[k as 'jacket'] ? null : wearable(k, id)?.color ?? null);
    return { hat: hat?.id ?? null, hatColor: hat?.color ?? null, glasses: w.glasses, jacket: col('jacket', w.jacket), pants: col('pants', w.pants), hair: col('hair', w.hair) };
  };
  const dressUp = () => pl.dress?.(wearOf(save.worn));
  dressUp();
  engine.events.on('game:start', () => { try { save = loadSave(localStorage.getItem(KEY)); } catch { /* ignore */ } dressUp(); });

  const W = (b: XY) => world(b[0], b[1]);
  const south = W(MOUTHS.south), centre = world(0, (LANE.stretches[0][0] + LANE.stretches[LANE.stretches.length - 1][1]) / 2);
  const roomOf = (s: ShopLayout) => {
    if (!s.room) return null;
    const [a, b] = s.room;
    return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) };
  };
  const rooms = SHOP_IDS.map((id) => [id, roomOf(SHOPS[id])] as const);
  const shopAt = (x: number, z: number): ShopId | null => {
    const [u, s] = local(x, z);
    for (const [id, r] of rooms) if (r && u > r.x0 - 0.35 && u < r.x1 + 0.35 && s > r.y0 - 0.35 && s < r.y1 + 0.35) return id;
    return null;
  };
  const yardBox = (() => { const [a, b] = YARD.area; return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) }; })();
  const inYard = (x: number, z: number) => { const [u, s] = local(x, z); return u > yardBox.x0 && u < yardBox.x1 && s > yardBox.y0 && s < yardBox.y1; };
  const near = (p: { x: number; z: number }, r: number) => Math.hypot(pl.position.x - p.x, pl.position.z - p.z) < r;
  const visit = (id: ShopId) => {
    if (save.visited.includes(id)) return;
    save.visited.push(id); store();
    if (save.visited.length === SHOP_IDS.length) { missions()?.addCash(ALL_VISITED); toast(t('nl.allVisited', { n: ALL_VISITED, k: SHOP_IDS.length }), 4); }
  };

  // --- keepers ---
  const keepers: Keeper[] = SHOP_IDS.map((id) => ({ id, actor: null, barkT: 8 + rnd.next() * 10, faceT: 0 }));
  const keeperSpawn = (k: Keeper) => {
    const s = SHOPS[k.id], p = W(s.keeper), f = W(s.keeperFace);
    const a = people.spawnActor!(p.x, p.z, { yaw: Math.atan2(f.x - p.x, f.z - p.z), seed: 911 + SHOP_IDS.indexOf(k.id) * 37 });
    if (!a) return;
    a.stop(); a.face(f.x, f.z);
    if (k.id === 'grill') a.act('cook');
    k.actor = a;
  };
  const keeperDrop = (k: Keeper) => { if (k.actor?.alive) k.actor.release('vanish'); k.actor = null; };

  // --- the camera held on a shot (the mirror's view of the player, the stage from a seat) ---
  const camApi = () => engine.get<CameraApi>('camera');
  /** From `from` (at height fy) towards `at` (height ay), aimed `side` m to the left of it: what is at `at` sits right of centre. */
  const shot = (from: { x: number; z: number }, fy: number, at: { x: number; z: number }, ay: number, side: number, fov: number) => {
    const c = camApi();
    if (!c) return;
    const tall = innerWidth < 640 && innerHeight > 560;   // a phone upright: the sheet is below, the player above it
    const fx = at.x - from.x, fz = at.z - from.z, L = Math.hypot(fx, fz) || 1, rx = -fz / L, rz = fx / L, sd = tall ? 0 : side;
    c.override = (cm) => {
      cm.position.set(from.x, fy, from.z);
      cm.lookAt(at.x - rx * sd, ay - (tall ? 0.35 : 0), at.z - rz * sd);
      cm.fov = fov; cm.updateProjectionMatrix();
    };
  };
  const unshot = () => { const c = camApi(); if (c) { c.override = null; c.snap(); } };
  /** Something to do in a moment (a sit settling before its panel opens: the world pauses under a panel). */
  const later: { t: number; fn: () => void }[] = [];
  const after = (secs: number, fn: () => void) => later.push({ t: secs, fn });

  // --- the counter's panel ---
  const panel = new ShopPanel(engine);
  const card = new PhotoCard(engine);
  const marks: { x: number; z: number }[] = [];
  const describe = (it: Item): string => {
    const parts: string[] = [];
    if (it.heal) parts.push(it.heal >= 100 ? t('nl.eff.full') : t('nl.eff.heal', { n: it.heal }));
    if (it.guard) parts.push(t('nl.eff.guard', { p: Math.round((1 - it.guard.scale) * 100), m: Math.round(it.guard.secs / 60) }));
    if (it.act === 'map') parts.push(t('nl.eff.map'));
    if (it.act === 'souvenir') parts.push(t('nl.eff.souvenir'));
    if (it.act === 'photo') parts.push(t('nl.eff.photo'));
    return parts.join(' · ');
  };
  const rabbitsLeft = () => engine.get<CollectApi>('collect')?.left?.() ?? [];
  const keeperOf = (id: ShopId) => keepers.find((q) => q.id === id)?.actor ?? null;
  const thanks = (id: ShopId, line = t('nl.thanks')) => { const a = keeperOf(id); if (a?.alive) { a.say(line, 2.5); a.act('talk', { t: 0 }); } };
  /** Buy item `it` in shop `id`: null when done, else why not. */
  const buy = (id: ShopId, it: Item): string | null => {
    const m = missions();
    if (!m) return 'no missions';
    const why = blocked(it, { cash: m.cash, health: pl.health, rabbitsLeft: rabbitsLeft().length });
    if (why) return t(why.key, { n: why.n ?? 0 });
    m.addCash(-it.price);
    engine.events.emit('district:buy', { shop: id, item: it.id, price: it.price });
    if (it.heal) pl.heal(it.heal);
    if (it.guard) { pl.guard?.(it.guard.scale, it.guard.secs); toast(t('nl.guard', { m: Math.round(it.guard.secs / 60) }), 3); }
    if (it.act === 'map') {
      const P = pl.position;
      const nearest = rabbitsLeft().sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z)).slice(0, MAP_MARKS);
      marks.length = 0; marks.push(...nearest);
      toast(t('nl.mapDone', { n: nearest.length }), 3);
    }
    if (it.act === 'souvenir') { save.souvenirs++; store(); toast(t('nl.souvenir', { n: save.souvenirs }), 3); }
    if (!it.guard && it.act !== 'map' && it.act !== 'souvenir') toast(t('nl.bought', { item: t(it.name), n: it.price }), 2);
    thanks(id);
    if (it.act === 'photo') { panel.close(); startPhoto(); }
    return null;
  };
  const itemRows = (id: ShopId, again: () => void, section?: string): Row[] => {
    const m = missions();
    return CATALOG[id].items.map((it, i) => {
      const why = blocked(it, { cash: m?.cash ?? 0, health: pl.health, rabbitsLeft: rabbitsLeft().length });
      return { label: t(it.name), detail: describe(it), price: why ? t(why.key, { n: why.n ?? 0 }) : `¥${it.price}`, disabled: !!why,
        section: i === 0 ? section : undefined, buy: () => { if (!buy(id, it) && panel.open) again(); } };
    });
  };
  const openShop = (id: ShopId) => {
    const shop = CATALOG[id], m = missions();
    if (id === 'clothes') return openWardrobe();
    if (id === 'barber') return startBarber();
    if (id === 'bar') return openBar();
    const rows = itemRows(id, () => openShop(id));
    if (id === 'arcade') {
      const short = (m?.cash ?? 0) < DANCE_PRICE;
      rows.push({ label: t('nl.offer.dance', { n: DANCE_PRICE }), detail: t('nl.greet.arcade'), price: short ? t('nl.panel.short', { n: DANCE_PRICE - (m?.cash ?? 0) }) : `¥${DANCE_PRICE}`,
        disabled: short, buy: () => { panel.close(); startDance(); } });
    }
    if (id === 'grill') visit('grill');
    panel.render(t(shop.name), t(shop.greet), m?.cash ?? 0, rows);
    keeperOf(id)?.act('talk', { t: 0 });
  };

  // --- wearing things: the clothes shop's rows and the barber's dyes ---
  const wearRows = (list: readonly Wearable[], again: () => void): Row[] => {
    const m = missions(), cash = m?.cash ?? 0;
    let last: WearKind | null = null;
    return list.map((w) => {
      const worn = save.worn[w.kind] === w.id, owned = w.price === 0 || save.owned.includes(ownKey(w));
      const removable = w.kind === 'hat' || w.kind === 'glasses';
      const short = !owned && cash < w.price;
      const section = w.kind !== last ? t(`nl.sec.${w.kind}`) : undefined;
      last = w.kind;
      const price = worn ? t(removable ? 'nl.wear.off' : 'nl.wear.on') : owned ? (w.price ? t('nl.wear.mine') : t('nl.wear.free')) : short ? t('nl.panel.short', { n: w.price - cash }) : `¥${w.price}`;
      return {
        label: t(w.name), section, on: worn, disabled: short || (worn && !removable),
        detail: t(w.kind === 'hat' ? 'nl.wear.d.hat' : w.kind === 'glasses' ? 'nl.wear.d.glasses' : w.kind === 'hair' ? 'nl.wear.d.hair' : 'nl.wear.d.color'),
        price,
        buy: () => {
          const mm = missions();
          if (worn && removable) { (save.worn as unknown as Record<WearKind, string | null>)[w.kind] = null; toast(t('nl.wear.removed', { item: t(w.name) }), 2); }
          else if (owned) { (save.worn as unknown as Record<WearKind, string | null>)[w.kind] = w.id; toast(t('nl.wear.changed', { item: t(w.name) }), 2); }
          else {
            if (!mm || mm.cash < w.price) return;
            mm.addCash(-w.price);
            save.owned.push(ownKey(w));
            (save.worn as unknown as Record<WearKind, string | null>)[w.kind] = w.id;
            engine.events.emit('district:buy', { shop: w.kind === 'hair' ? 'barber' : 'clothes', item: ownKey(w), price: w.price });
            toast(t('nl.wear.bought', { item: t(w.name), n: w.price }), 2.5);
            thanks(w.kind === 'hair' ? 'barber' : 'clothes', w.kind === 'hair' ? t('nl.barber.done') : t('nl.thanks'));
          }
          store(); dressUp();
          if (panel.open) again();
        },
      };
    });
  };
  const openWardrobe = () => {
    const s = SHOPS.clothes;
    if (!s.stand || !s.mirror) return;
    const st = W(s.stand), mi = W(s.mirror);
    pl.setRiding(null, { x: st.x, y: 0.2, z: st.z, yaw: Math.atan2(mi.x - st.x, mi.z - st.z) });
    shot(mi, 1.45, st, 1.2, 0.5, 48);
    // a moment to stand still before the world pauses under the sheet
    after(0.35, () => renderWardrobe());
  };
  const renderWardrobe = () => {
    const m = missions();
    if (!panel.render(t(CATALOG.clothes.name), t(CATALOG.clothes.greet), m?.cash ?? 0, wearRows(WARDROBE, renderWardrobe), () => unshot(), true)) unshot();
  };

  // --- the barber's chair ---
  let seated: Seated = null;
  const startBarber = () => {
    const s = SHOPS.barber;
    if (!s.chair || !s.chairFace || !s.camera || seated) return;
    const c = W(s.chair), f = W(s.chairFace), cam = W(s.camera);
    pl.setRiding({ pos: new THREE.Vector3(c.x, 0.06, c.z), yaw: Math.atan2(f.x - c.x, f.z - c.z) });
    pl.setPose?.('sit', 0);
    seated = { kind: 'barber', t: 0 };
    shot(cam, 1.32, c, 1.12, 0.32, 56);
    keeperOf('barber')?.say(t('nl.greet.barber'), 2.5);
    after(0.9, () => renderBarber());
  };
  const renderBarber = () => {
    const m = missions();
    const rows = [...wearRows(HAIR, renderBarber), ...itemRows('barber', renderBarber, t('nl.sec.care'))];
    if (!panel.render(t(CATALOG.barber.name), t(CATALOG.barber.greet), m?.cash ?? 0, rows, () => standUp(), true)) standUp();
  };
  const standUp = () => {
    const was = seated;
    seated = null;
    pl.setPose?.(null);
    unshot();
    if (!was) return;
    if (was.kind === 'barber') {
      const s = SHOPS.barber, c = W(s.chair!), d = W(s.counter);
      pl.setRiding(null, { x: d.x, y: 0.2, z: d.z, yaw: Math.atan2(d.x - c.x, d.z - c.z) });
    } else {
      const s = SHOPS.bar, p = W(s.seats![was.seat]), st = W(s.stage!);
      // a step back from the table, towards the room's middle
      const r = W(s.counter), dx = r.x - p.x, dz = r.z - p.z, L = Math.hypot(dx, dz) || 1;
      pl.setRiding(null, { x: p.x + dx / L * 0.55, y: 0.2, z: p.z + dz / L * 0.55, yaw: Math.atan2(st.x - p.x, st.z - p.z) });
    }
    camApi()?.snap();
  };

  // --- the bar: the singer, the songs, the seats ---
  let singer: Actor | null = null, song = 0, songT = 0;
  const lifeProps = new LifeProps(engine.scene, engine.get<RenderApi>('render')?.uniforms);
  const _m = new THREE.Matrix4(), _v = new THREE.Vector3(), _q = new THREE.Quaternion(), _one = new THREE.Vector3(1, 1, 1), _e = new THREE.Euler();
  const openBar = () => {
    const m = missions(), cash = m?.cash ?? 0;
    const rows = itemRows('bar', openBar, t('nl.sec.drinks'));
    SONGS.forEach((k, i) => {
      const playing = i === song, short = cash < SONG_PRICE;
      rows.push({ label: `《${t(k)}》`, detail: playing ? t('nl.song.playing') : t('nl.song.d'), on: playing, section: i === 0 ? t('nl.sec.songs') : undefined,
        price: playing ? t('nl.song.playing') : short ? t('nl.panel.short', { n: SONG_PRICE - cash }) : `¥${SONG_PRICE}`, disabled: playing || short,
        buy: () => {
          const mm = missions();
          if (!mm || mm.cash < SONG_PRICE) return;
          mm.addCash(-SONG_PRICE);
          song = i; songT = 0;
          engine.events.emit('district:buy', { shop: 'bar', item: `song${i}`, price: SONG_PRICE });
          if (singer?.alive) singer.say(t('nl.song.next', { song: t(k) }), 4);
          if (panel.open) openBar();
        } });
    });
    panel.render(t(CATALOG.bar.name), t(CATALOG.bar.greet), cash, rows);
    keeperOf('bar')?.act('talk', { t: 0 });
  };
  const sitToListen = (i: number) => {
    const s = SHOPS.bar;
    if (!s.seats || !s.stage || seated) return;
    const p = W(s.seats[i]), st = W(s.stage);
    pl.setRiding({ pos: new THREE.Vector3(p.x, 0.04, p.z), yaw: Math.atan2(st.x - p.x, st.z - p.z) });
    pl.setPose?.('sit', 0);
    seated = { kind: 'listen', t: 0, seat: i };
    // over the shoulder at the stage: behind and to one side, so the head is not in the way
    const dx = p.x - st.x, dz = p.z - st.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    shot({ x: p.x + ux * 1.25 - uz * 0.75, z: p.z + uz * 1.25 + ux * 0.75 }, 1.6, st, 1.1, 0, 56);
    toast(t('nl.listen'), 4);
  };
  const singerSpawn = () => {
    const s = SHOPS.bar;
    if (!s.stage || !s.stageFace) return;
    const p = W(s.stage), f = W(s.stageFace);
    const look = randomLook(() => rnd.next());
    look.fem = 1; look.age = 0.25; look.hairStyle = 'long'; look.cap = null; look.mask = null; look.top = 'shirt';
    look.shirt = new THREE.Color('#e8e2d4'); look.bottom = 'trousers'; look.pants = new THREE.Color('#2a3448'); look.hem = 0.8;
    const a = people.spawnActor!(p.x, p.z, { yaw: Math.atan2(f.x - p.x, f.z - p.z), look, seed: 4401 });
    if (!a) return;
    a.stop(); a.face(f.x, f.z); a.act('strum', { seat: 0.46 });
    singer = a;
  };

  // --- the yard: the old man at his chess, his bird ---
  let elder: Actor | null = null, elderLine = 0, yardHinted = false;
  const elderSpawn = () => {
    const p = W(YARD.elder), f = W(YARD.elderFace);
    const look = randomLook(() => rnd.next());
    look.fem = 0; look.age = 0.85; look.hairStyle = 'buzz'; look.cap = null; look.mask = null; look.top = 'shirt';
    look.shirt = new THREE.Color('#e9e6dc'); look.bottom = 'trousers'; look.pants = new THREE.Color('#2c2e33'); look.hem = 0.8; look.glasses = false;
    const a = people.spawnActor!(p.x, p.z, { yaw: Math.atan2(f.x - p.x, f.z - p.z), look, seed: 5501 });
    if (!a) return;
    a.stop(); a.face(f.x, f.z); a.act('chess', { seat: 0.42 });
    elder = a;
  };

  // --- the photo: sit in the chair, the camera's view of you, a flash, the print ---
  const flash = el('div', 'nl-flash', document.body);
  let photo: { t: number; shot: boolean } | null = null;
  const startPhoto = () => {
    const s = SHOPS.photo;
    if (!s.chair || !s.camera) return;
    const c = W(s.chair), cam = W(s.camera);
    pl.setRiding({ pos: new THREE.Vector3(c.x, 0.04, c.z), yaw: Math.atan2(cam.x - c.x, cam.z - c.z) });
    pl.setPose?.('sit', 0);
    photo = { t: 0, shot: false };
    toast(t('nl.photo.sit'), 2.4);
    const ca = camApi();
    if (ca) ca.override = (cm) => {
      cm.position.set(cam.x, 1.5, cam.z);
      cm.lookAt(c.x, 1.05, c.z);
      cm.fov = 42; cm.updateProjectionMatrix();
    };
  };
  const snap = () => {
    const orig = engine.renderFrame;
    engine.renderFrame = (dt: number) => {
      orig(dt);
      engine.renderFrame = orig;
      const src = engine.renderer.domElement, g = card.canvas.getContext('2d');
      if (!g || !src.width) return;
      // a portrait crop from the middle of the frame
      const h = src.height * 0.9, w = h * card.canvas.width / card.canvas.height;
      try { g.drawImage(src, (src.width - w) / 2, src.height * 0.05, w, h, 0, 0, card.canvas.width, card.canvas.height); } catch { /* the card keeps its ground */ }
      agePrint(card.canvas, save.photos + 1);
    };
  };
  const endPhoto = () => {
    const s = SHOPS.photo, c = W(s.chair!), cam = W(s.camera!);
    const ca = camApi();
    if (ca) ca.override = null;
    pl.setPose?.(null);
    const ax = c.x + (cam.x - c.x) * 0.35, az = c.z + (cam.z - c.z) * 0.35;
    pl.setRiding(null, { x: ax, y: 0.2, z: az, yaw: Math.atan2(cam.x - c.x, cam.z - c.z) });
    ca?.snap();
    photo = null;
  };

  // --- the dance machine ---
  let danceT = 0, dancing = false;
  const music: MusicSource[] = [];
  const dance = new DanceGame(engine, (hits, of) => {
    dancing = false;
    const s = SHOPS.arcade, p = W(s.pad!), f = W(s.padFace!);
    pl.setPose?.(null);
    const back = Math.atan2(p.x - f.x, p.z - f.z);
    pl.setRiding(null, { x: p.x + Math.sin(back) * 0.9, y: 0.2, z: p.z + Math.cos(back) * 0.9, yaw: back + Math.PI });
    const prize = dancePrize(hits, of);
    if (prize) missions()?.addCash(prize);
    const best = hits > save.danceBest;
    if (best) { save.danceBest = hits; store(); }
    toast((prize ? t('nl.dance.win', { hits, of, n: prize }) : t('nl.dance.lose', { hits, of })) + (best ? `  ${t('nl.dance.best')}` : ''), 4);
    engine.events.emit('district:dance', { hits, of, prize });
  });
  const startDance = () => {
    const m = missions();
    if (dancing || !m || m.cash < DANCE_PRICE) { if (m && m.cash < DANCE_PRICE) toast(t('nl.panel.short', { n: DANCE_PRICE - m.cash })); return; }
    const s = SHOPS.arcade;
    if (!s.pad || !s.padFace) return;
    m.addCash(-DANCE_PRICE);
    const p = W(s.pad), f = W(s.padFace);
    pl.setRiding({ pos: new THREE.Vector3(p.x, 0.06, p.z), yaw: Math.atan2(f.x - p.x, f.z - p.z) });
    pl.setPose?.('dance', danceT);
    dance.begin(danceT);
    dancing = true;
  };
  /** The lane's music this step: the dance machine while played, the singer while she is on, the yard's bird. */
  const arcadeAt = W(SHOPS.arcade.pad ?? SHOPS.arcade.door), stageAt = W(SHOPS.bar.stage ?? SHOPS.bar.door), cageAt = W(YARD.cage);
  const playing = () => {
    music.length = 0;
    if (dancing) music.push({ id: 'nl-arcade', kind: 'dance', x: arcadeAt.x, z: arcadeAt.z, t: danceT });
    if (singer?.alive) music.push({ id: `nl-bar${song}`, kind: 'ballad', x: stageAt.x, z: stageAt.z, t: songT, song });
    if (elder?.alive) music.push({ id: 'nl-cage', kind: 'birds', x: cageAt.x, z: cageAt.z, t: songT });
  };

  // --- the lane's crowd: strolling up and down, stopping at the windows, turning at the crossings and the ends ---
  const cap = () => (engine.lite ? LITE : WALKERS[engine.quality.tier]);
  const walkers: Walker[] = [];
  const crowd = pl.crowd, camDir = new THREE.Vector3(), draw = new THREE.Vector3();
  const runLen = RUNS.reduce((a, [r0, r1]) => a + (r1 - r0), 0);
  let clock = 0;
  const addWalker = () => {
    // a run by its length, a place in it
    let k = rnd.next() * runLen, run = RUNS[0];
    for (const r of RUNS) { if (k < r[1] - r[0]) { run = r; break; } k -= r[1] - r[0]; }
    const lo = run[0] + (run[0] < 2 ? 3 : 1.5), hi = run[1] - 1.5;
    const seed = rnd.next();
    const w: Walker = { u: (rnd.next() - 0.5) * 2 * 2.3, s: lo + rnd.next() * (hi - lo), lo, hi, dir: rnd.next() < 0.5 ? 1 : -1, speed: 0.8 + rnd.next() * 0.45, pause: 0, lookT: 4 + rnd.next() * 14,
      gait: new Gait(), look: randomLook(() => rnd.next()), seed, pos: new THREE.Vector3(), prev: new THREE.Vector3(), yaw: 0 };
    const p = world(w.u, w.s);
    w.pos.set(p.x, 0.03, p.z); w.prev.copy(w.pos); w.yaw = yawOf(0, w.dir, w.s);
    walkers.push(w);
  };
  const stepWalkers = (dt: number) => {
    const cam = engine.camera.position;
    const close = Math.hypot(cam.x - centre.x, cam.z - centre.z) < 260;
    if (!close) { walkers.length = 0; return; }
    while (walkers.length < cap()) addWalker();
    while (walkers.length > cap()) walkers.pop();
    const foot = pl.foot;
    const [pu, ps] = foot ? local(foot.pos.x, foot.pos.z) : [1e9, 1e9];
    for (const w of walkers) {
      w.prev.copy(w.pos);
      if (w.pause > 0) {
        w.pause -= dt;
        if (w.pause <= 0) w.yaw = yawOf(0, w.dir, w.s);
      } else {
        w.s += w.dir * w.speed * dt;
        w.lookT -= dt;
        // at a window now and then: turn to the nearer front and stand a while
        if (w.lookT <= 0 && Math.abs(w.u) > 1.4) {
          w.pause = 2 + rnd.next() * 5; w.lookT = 8 + rnd.next() * 18;
          w.yaw = yawOf(w.u > 0 ? 1 : -1, 0, w.s);
        }
        // the ends of the run: turn back (a crossing hutong's traffic, the bollards, the main road)
        if (w.s > w.hi || w.s < w.lo) {
          w.dir = w.s > w.hi ? -1 : 1;
          w.pause = 0.6 + rnd.next() * 1.4;
          w.yaw = yawOf(0, w.dir, w.s);
        }
      }
      // keep out of the player's way: step aside
      const du = w.u - pu, ds = w.s - ps, d = Math.hypot(du, ds);
      if (d < 1.1) w.u = Math.max(-2.6, Math.min(2.6, w.u + Math.sign(du || 1) * (1.1 - d) * 4 * dt));
      const p = world(w.u, w.s);
      w.pos.set(p.x, 0.03, p.z);
    }
  };
  const drawWalkers = (dt: number, alpha: number) => {
    if (!walkers.length) return;
    const cam = engine.camera.position;
    engine.camera.getWorldDirection(camDir);
    for (const w of walkers) {
      const dx = w.pos.x - cam.x, dz = w.pos.z - cam.z, d = Math.hypot(dx, dz);
      if (d > 8 && dx * camDir.x + dz * camDir.z < -0.2 * d) continue;
      if (d > 160) continue;
      w.gait.update({ speed: w.pause > 0 ? 0 : w.speed, action: 'move', t: clock }, dt, w.seed);
      draw.lerpVectors(w.prev, w.pos, alpha);
      crowd.add(draw, w.yaw, w.gait, w.look);
    }
  };

  // --- fast travel: to 地安门东大街 at the lane's mouth ---
  let fade: Fade | null = null, travelling = false;
  const travel = async () => {
    if (travelling) return;
    travelling = true;
    const v = engine.get<VehicleApi>('vehicle')!, driving = pl.mode === 'driving';
    fade ??= new Fade();
    fade.to(true);
    let ok = false;
    try {
      await new Promise((r) => setTimeout(r, 0));
      v.inputEnabled = false;
      await new Promise((r) => setTimeout(r, 700));
      // the near (westbound) carriageway of 地安门东大街, a little east of the mouth: the lane opens on the right
      const kerb = world(14, -4);   // the kerb side: the lane nearest the median has the railings at its door
      await engine.get<WorldApi>('world')?.preload?.(kerb.x, kerb.z);
      if (driving) {
        const lane = v.roadPoseNear?.(kerb.x, 0.5, kerb.z);
        if (lane) {
          // roadPoseNear gives the lane by the median: one or two lanes over to the right (the kerb's), where nothing is
          const fx = Math.sin(lane.yaw), fz = Math.cos(lane.yaw);
          const { R, world: pw } = engine.physics, box = new R.Cuboid(0.95, 0.6, 2.1), qq = { x: 0, y: Math.sin(lane.yaw / 2), z: 0, w: Math.cos(lane.yaw / 2) };
          let pos = lane.pos;
          for (const k of [7, 3.5]) {
            const c = { x: lane.pos.x - fz * k, y: lane.pos.y, z: lane.pos.z + fx * k };
            let hit = false;
            pw.intersectionsWithShape({ x: c.x, y: c.y + 0.95, z: c.z }, qq, box, (col) => { if (col.parent() !== v.car.body) { hit = true; return false; } return true; });
            if (!hit) { pos = c; break; }
          }
          v.reset(pos, lane.yaw); ok = true; hintedCar = true;
        }
      } else {
        const at = world(0, -2.5), to = world(0, 10);
        pl.setRiding(null, { x: at.x, y: 0.3, z: at.z, yaw: Math.atan2(to.x - at.x, to.z - at.z) });
        ok = true;
      }
      // the camera turned to the mouth (to the car's right), as if the player had looked
      camApi()?.snap(driving ? -0.55 : undefined);
    } finally {
      v.inputEnabled = true;
      fade.to(false, ok ? t(driving ? 'nl.arrived' : 'nl.arrivedFoot', { n: SHOP_IDS.length }) : undefined);
      travelling = false;
    }
  };

  // --- the map: a lantern at the mouth, one at each shop when near, the hutong map's marks ---
  const nav = engine.get<NavApi>('nav');
  const blips: Blip[] = [];
  nav?.addBlips(() => {
    blips.length = 0;
    blips.push({ kind: 'shop', x: south.x, z: south.z, label: t('nl.name') });
    const P = pl.position;
    if (Math.hypot(P.x - centre.x, P.z - centre.z) < 300) for (const id of SHOP_IDS) { const d = W(SHOPS[id].door); blips.push({ kind: 'shop', x: d.x, z: d.z }); }
    for (const m of marks) blips.push({ kind: 'collect', x: m.x, z: m.z, flash: true });
    return blips;
  });
  engine.events.on('collect:found', () => {
    const left = rabbitsLeft();
    for (let i = marks.length - 1; i >= 0; i--) if (!left.some((l) => Math.hypot(l.x - marks[i].x, l.z - marks[i].z) < 1)) marks.splice(i, 1);
  });

  const point = (name: string): { x: number; z: number } | null => {
    const [shop, key] = name.split('.');
    if (shop === 'yard') { const p = (YARD as unknown as Record<string, XY>)[key]; return p ? W(p) : null; }
    const s = SHOPS[shop as ShopId] as unknown as Record<string, XY> | undefined, p = s?.[key];
    return p && typeof p[0] === 'number' ? W(p) : null;
  };
  const smokeAt = W(SHOPS.grill.smoke ?? SHOPS.grill.counter);
  let smokeT = 0;
  const fx = () => engine.get<{ name: string; smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, shade?: number): void }>('fx');

  let inShop: ShopId | null = null, hinted = false, hintedCar = false, yardNow = false;
  const api: DistrictApi = {
    name: 'district',
    get inShop() { return inShop; },
    get music() { return music; },
    get saved() { return save; },
    get busy() { return !!inShop || !!seated || !!photo || dancing || panel.open || card.open || yardNow || near(W(SHOPS.grill.counter), 3); },
    travelSpots: () => [{ label: t('travel.nanluo'), x: south.x, z: south.z }],
    travel: () => { void travel(); },
    debug: {
      shops: () => Object.fromEntries(SHOP_IDS.map((id) => [id, { door: W(SHOPS[id].door), counter: W(SHOPS[id].counter), keeper: !!keeperOf(id)?.alive }])),
      walkers: () => walkers.length,
      save: () => save,
      open: (id) => openShop(id),
      buy: (id, i) => buy(id, CATALOG[id].items[i]),
      world: (u, s) => world(u, s),
      local: (x, z) => local(x, z),
      point,
      seats: () => (SHOPS.bar.seats ?? []).map(W),
      actors: () => ({ singer: !!singer?.alive, elder: !!elder?.alive }),
      wear: (kind, id) => { (save.worn as unknown as Record<WearKind, string | null>)[kind] = id; if (id) { const w = wearable(kind, id); if (w && !save.owned.includes(ownKey(w))) save.owned.push(ownKey(w)); } store(); dressUp(); },
    },
    fixedUpdate(dt) {
      clock += dt; danceT += dt; songT += dt;
      for (let i = later.length - 1; i >= 0; i--) { later[i].t -= dt; if (later[i].t <= 0) { const f = later[i].fn; later.splice(i, 1); f(); } }
      stepWalkers(dt);
      for (const k of keepers) {
        if (k.actor && !k.actor.alive) k.actor = null;
        const d = W(SHOPS[k.id].door);
        if (!k.actor && near(d, ON)) keeperSpawn(k);
        else if (k.actor && !near(d, OFF)) keeperDrop(k);
      }
      if (singer && !singer.alive) singer = null;
      if (!singer && near(stageAt, ON)) singerSpawn();
      else if (singer && !near(stageAt, OFF)) { singer.release('vanish'); singer = null; }
      const ep = W(YARD.elder);
      if (elder && !elder.alive) elder = null;
      if (!elder && near(ep, ON)) elderSpawn();
      else if (elder && !near(ep, OFF)) { elder.release('vanish'); elder = null; }
      playing();
      // the grill's smoke while anyone is near enough to see it
      smokeT -= dt;
      if (smokeT <= 0 && near(smokeAt, 70)) { smokeT = 0.28; fx()?.smoke(smokeAt.x + (rnd.next() - 0.5) * 0.6, 1.2, smokeAt.z + (rnd.next() - 0.5) * 0.3, 0, 0.55, 0, 0.45, 2.6, 0.18); }
      if (seated?.kind === 'listen') { seated.t += dt; if (pl.health < 100) pl.heal(LISTEN_HEAL * dt); }
      if (seated?.kind === 'barber') seated.t += dt;
      if (photo) {
        photo.t += dt;
        if (!photo.shot && photo.t > 2.6) {
          photo.shot = true;
          flash.classList.add('on');
          requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.remove('on')));
          engine.events.emit('district:photo', {});
          snap();
          save.photos++; store();
        }
        if (photo.shot && photo.t > 3.1 && !card.open) {
          if (!card.present(() => endPhoto())) endPhoto();
        }
      }
    },
    update(dt, alpha) {
      drawWalkers(dt, alpha);
      if (dancing) dance.update(dt, danceT);
      // the singer's guitar in her hands
      lifeProps.begin();
      if (singer?.alive) {
        const fy = singer.yaw;
        singer.joint(J.chest, _m); _v.setFromMatrixPosition(_m);
        _q.setFromEuler(_e.set(0, fy, 0.35, 'YXZ'));
        _m.compose(_v.set(_v.x + Math.sin(fy) * 0.2, _v.y - 0.3, _v.z + Math.cos(fy) * 0.2), _q, _one);
        lifeProps.add('guitar', _m);
      }
      lifeProps.commit();
      const cam = camApi();
      const foot = pl.foot;
      const was = inShop;
      inShop = foot ? shopAt(foot.pos.x, foot.pos.z) : null;
      if (cam) cam.indoor = inShop && !photo && !seated && !panel.open ? 1 : 0;
      // into a shop: the keeper's welcome, the visit noted (all of them: a prize)
      if (inShop && inShop !== was) {
        const a = keeperOf(inShop);
        if (a?.alive) { a.say(t(CATALOG[inShop].greet), 3.5); if (inShop !== 'grill') a.act('wave', { t: 0 }); }
        visit(inShop);
      }
      for (const k of keepers) {
        const a = k.actor;
        if (!a?.alive) continue;
        k.faceT -= dt;
        if (k.faceT <= 0) {
          k.faceT = 0.7;
          const s = SHOPS[k.id];
          // the keeper looks at you while you are in the shop, else out to the lane
          const f = inShop === k.id && foot ? foot.pos : W(s.keeperFace);
          if (a.state === 'script') a.face(f.x, f.z);
        }
        // calling out to a passer-by
        k.barkT -= dt;
        if (foot && inShop !== k.id && k.barkT <= 0) {
          const d = W(SHOPS[k.id].door);
          if (Math.hypot(foot.pos.x - d.x, foot.pos.z - d.z) < BARK_R) { a.say(t(CATALOG[k.id].bark), 3); k.barkT = BARK_EVERY; }
        }
      }
      // held in a seat: F (or Esc on a seat with no panel) stands up
      if (seated?.kind === 'listen' && seated.t > 0.5 && engine.input.state.enterPressed) standUp();
      if (!foot || pl.riding || photo || dancing) {
        // the hint for a car at the mouth
        if (!hintedCar && pl.mode === 'driving' && Math.hypot(pl.position.x - south.x, pl.position.z - south.z) < 22) {
          const v = engine.get<VehicleApi>('vehicle');
          if (v && Math.abs(v.car.speed) < 9) { hintedCar = true; toast(t('nl.hintCar'), 4); }
        }
        return;
      }
      // the hint at a mouth
      if (!hinted) {
        for (const m of Object.values(MOUTHS)) {
          const p = W(m);
          if (Math.hypot(foot.pos.x - p.x, foot.pos.z - p.z) < 12) { hinted = true; toast(t('nl.hint', { n: SHOP_IDS.length }), 5); break; }
        }
      }
      // F at a counter, at the dance pad, at a seat in the bar, at the stall, by the old man
      if (inShop) {
        const s = SHOPS[inShop], c = W(s.counter), id = inShop;
        if (Math.hypot(foot.pos.x - c.x, foot.pos.z - c.z) < COUNTER_R) {
          const label = id === 'clothes' ? t('nl.offer.clothes') : id === 'barber' ? t('nl.offer.barber') : id === 'bar' ? t('nl.offer.bar') : t('nl.offer', { shop: t(CATALOG[id].name) });
          pl.offer?.({ x: c.x, z: c.z, r: COUNTER_R, label, use: () => openShop(id) });
        }
        if (inShop === 'arcade' && s.pad) {
          const p = W(s.pad);
          if (Math.hypot(foot.pos.x - p.x, foot.pos.z - p.z) < 1.3) pl.offer?.({ x: p.x, z: p.z, r: 1.3, label: t('nl.offer.dance', { n: DANCE_PRICE }), use: () => startDance() });
        }
        if (inShop === 'bar' && s.seats) s.seats.forEach((xy, i) => {
          const p = W(xy);
          if (Math.hypot(foot.pos.x - p.x, foot.pos.z - p.z) < 0.95) pl.offer?.({ x: p.x, z: p.z, r: 0.95, label: t('nl.offer.seat'), use: () => sitToListen(i) });
        });
      }
      const gc = W(SHOPS.grill.counter);
      if (Math.hypot(foot.pos.x - gc.x, foot.pos.z - gc.z) < COUNTER_R) pl.offer?.({ x: gc.x, z: gc.z, r: COUNTER_R, label: t('nl.offer.grill'), use: () => openShop('grill') });
      yardNow = inYard(foot.pos.x, foot.pos.z);
      if (yardNow) {
        if (!yardHinted) { yardHinted = true; toast(t('nl.yard.found'), 3.5); if (!save.yard) { save.yard = true; store(); } }
        if (elder?.alive && Math.hypot(foot.pos.x - elder.pos.x, foot.pos.z - elder.pos.z) < 1.8) {
          const a = elder;
          pl.offer?.({ x: a.pos.x, z: a.pos.z, r: 1.8, label: t('nl.offer.elder'), use: () => { a.say(t(`nl.elder.${elderLine % 5}` as 'nl.elder.0'), 5.5, t('nl.who.elder')); elderLine++; } });
        }
      }
    },
  };
  engine.add(api);
}

export type { ShopId } from './Shops';
