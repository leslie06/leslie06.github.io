import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import { Rng } from '../core/Rng';
import type { Actor, Blip, CameraApi, CombatApi, DialogueApi, HudApi, MissionApi, NavApi, PeopleApi, PlayerApi, RenderApi, Speaker, VehicleApi, WantedApi, Wear, WorldApi } from '../game/Contracts';
import type { ContactsApi } from '../contacts';
import { CAST_ON, castModel, hasModel } from '../character/Cast';
import { journalOf } from '../npc/Journal';
import { Cats, type CatPose, type CatState } from './Cats';
import type { CollectApi } from '../collect';
import type { MusicSource } from '../audio/StreetMusic';
import { Gait } from '../character/Animator';
import { J, randomLook, type Look } from '../character/Body';
import { Fade } from '../campaign/Screens';
import { DanceGame } from '../life/DanceGame';
import { LifeProps } from '../life/Props';
import { css, el } from '../ui/theme';
import LAYOUT from './nanluo.layout.json';
import { agePrint, PhotoCard, ShopPanel, type Row } from './Panel';
import {
  blocked, CAT_REWARD, CATALOG, DANCE_PRICE, dancePrize, DEFAULT_WORN, deliveryPay, deliveryTime, HAIR, type Item, LISTEN_HEAL, loadSave, MAP_MARKS, ownKey,
  priceOf, RACKET_PAY, RACKET_SHOPS, type Save, SHOP_IDS, type ShopId, SONG_PRICE, SONGS, WARDROBE, type Wearable, wearable, type WearKind, type Worn,
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
    /** Round 3: start 黑豹's collection at the nearest shop that fits, a delivery, the lost cat; what is on. */
    racket(): boolean; deliver(): { x: number; z: number } | null; cat(): { x: number; z: number } | null; tasks(): Record<string, unknown>;
    catHere(): void; catSeats(): { x: number; z: number }[];
  };
}

type XY = [number, number];
interface ShopLayout {
  side: string; y0: number; y1: number; door: XY; counter: XY; keeper: XY; keeperFace: XY;
  inside?: XY; room?: [XY, XY]; stall?: boolean; smoke?: XY;
  chair?: XY; chairFace?: XY; camera?: XY; pad?: XY; padFace?: XY; stand?: XY; mirror?: XY;
  seats?: XY[]; stage?: XY; stageFace?: XY; mic?: XY;
  /** Round 3: the dumpling shop's takeaway shelf; the café's table to sit at and where its cats are ([u, s, height, face u, face s]). */
  bags?: XY; seatFace?: XY; cats?: [number, number, number, number, number][];
}
interface YardLayout { gate: XY; inside: XY; area: [XY, XY]; passage: [XY, XY]; elder: XY; elderFace: XY; cage: XY }

// The model's frame: Blender (bx, by) is the game's local (bx, -by), turned by -heading about the anchor (city/index.ts
// placeLandmarks). The layout's points are in nanluo.py's lane coordinates (u across, s along, unbent): the lane turns
// west at each of `lane.bends` (板厂, 东棉花, 菊儿胡同), each stretch north of one built turned about it. The north stretch
// is two more landmarks (nanluo_n1, nanluo_n2) in the same lane coordinates, only their origins moved.
// The lane's frame is the south mouth's (nanluo.py's GX, GZ, HEADING): the landmarks' own origins are each in the middle
// of their part, for their LOD.
const FRAME = (LAYOUT as unknown as { frame: { gx: number; gz: number; heading: number } }).frame;
const OX = FRAME.gx, OZ = FRAME.gz;
const ROT = -FRAME.heading * Math.PI / 180, RC = Math.cos(ROT), RS = Math.sin(ROT);
const LANE = LAYOUT.lane as unknown as { half: number; stretches: XY[]; bends: XY[]; crossings: XY[]; crossingsE: XY[] };
const BENDS = LANE.bends.map(([y, d]) => ({ y, a: d * Math.PI / 180, c: Math.cos(d * Math.PI / 180), s: Math.sin(d * Math.PI / 180) }));
const turn = (u: number, s: number, b: (typeof BENDS)[number], k: number): XY => { const dy = s - b.y, sn = b.s * k; return [u * b.c - dy * sn, b.y + u * sn + dy * b.c]; };
const bent = (u: number, s: number): XY => { let p: XY = [u, s]; for (let i = BENDS.length - 1; i >= 0; i--) if (s > BENDS[i].y) p = turn(p[0], p[1], BENDS[i], 1); return p; };
const unbent = (bx: number, by: number): XY => { let p: XY = [bx, by]; for (const b of BENDS) { if (p[1] <= b.y) break; p = turn(p[0], p[1], b, -1); } return p; };
const world = (u: number, s: number): { x: number; z: number } => { const [bx, by] = bent(u, s); return { x: OX + bx * RC - by * RS, z: OZ - bx * RS - by * RC }; };
const local = (x: number, z: number): XY => { const dx = x - OX, dz = z - OZ; return unbent(dx * RC - dz * RS, -(dx * RS + dz * RC)); };
/** The game's yaw (atan2(x, z)) of lane direction (du, ds) at lane position s. */
const yawOf = (du: number, ds: number, s: number): number => {
  const a = BENDS.reduce((t, b) => (s > b.y ? t + b.a : t), 0), c = Math.cos(a), sn = Math.sin(a);
  const dx = du * c - ds * sn, dy = du * sn + ds * c;
  return Math.atan2(dx * RC - dy * RS, -dx * RS - dy * RC);
};
const S0 = LANE.stretches[0][0], S1 = LANE.stretches[LANE.stretches.length - 1][1];
/** On (or right by) the lane: |u| within `r` of its fronts and s between its mouths. */
const onLane = (u: number, s: number, r = 0) => Math.abs(u) < LANE.half + r && s > S0 - 2 - r && s < S1 + 2 + r;

const SHOPS = LAYOUT.shops as unknown as Record<ShopId, ShopLayout>;
const MOUTHS = LAYOUT.mouths as unknown as Record<string, XY>;
const YARD = (LAYOUT as unknown as { yard: YardLayout }).yard;
const GATES = (LAYOUT as unknown as { gates: { no: string; side: string; door: XY; in: XY }[] }).gates;
/** The lane between its crossing hutongs (roads: the walkers turn before them, and before 小菊儿胡同's mouth). */
const RUNS: XY[] = [];
for (const [s0, s1] of LANE.stretches) {
  let a = s0;
  for (const [c0, c1] of [...LANE.crossings, ...LANE.crossingsE].sort((p, q) => p[0] - q[0])) if (c0 > s0 && c0 < s1) { RUNS.push([a, c0]); a = c1; }
  RUNS.push([a, s1]);
}
/** The lane's runs clipped to [a, b]. */
const runsIn = (a: number, b: number): XY[] => RUNS.map(([r0, r1]): XY => [Math.max(r0, a), Math.min(r1, b)]).filter(([r0, r1]) => r1 - r0 > 4);

interface Keeper { id: ShopId; actor: Actor | null; barkT: number; faceT: number }
interface Walker { u: number; s: number; lo: number; hi: number; dir: number; speed: number; pause: number; lookT: number; gait: Gait; look: Look; seed: number; pos: THREE.Vector3; prev: THREE.Vector3; yaw: number }
/** A chair the player is held in: the barber's, a seat at the bar's tables (listening). */
type Seated = { kind: 'barber'; t: number } | { kind: 'listen' | 'pet'; t: number; seat: number } | null;

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
  const south = W(MOUTHS.south), north = W(MOUTHS.north);
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
  /** A shop the player stood up for against 黑豹's collectors: 熟客价 there (Shops.REGULAR). */
  const regular = (id: ShopId) => save.regulars.includes(id);
  /** Buy item `it` in shop `id`: null when done, else why not. */
  const buy = (id: ShopId, it: Item): string | null => {
    const m = missions();
    if (!m) return 'no missions';
    const price = priceOf(it, regular(id));
    const why = blocked(it, { cash: m.cash, health: pl.health, rabbitsLeft: rabbitsLeft().length, price });
    if (why) return t(why.key, { n: why.n ?? 0 });
    m.addCash(-price);
    engine.events.emit('district:buy', { shop: id, item: it.id, price });
    if (it.heal) pl.heal(it.heal);
    if (it.guard) { pl.guard?.(it.guard.scale, it.guard.secs); toast(t('nl.guard', { m: Math.round(it.guard.secs / 60) }), 3); }
    if (it.act === 'map') {
      const P = pl.position;
      const nearest = rabbitsLeft().sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z)).slice(0, MAP_MARKS);
      marks.length = 0; marks.push(...nearest);
      toast(t('nl.mapDone', { n: nearest.length }), 3);
    }
    if (it.act === 'souvenir') { save.souvenirs++; store(); toast(t('nl.souvenir', { n: save.souvenirs }), 3); }
    if (!it.guard && it.act !== 'map' && it.act !== 'souvenir') toast(t('nl.bought', { item: t(it.name), n: price }), 2);
    thanks(id);
    if (it.act === 'photo') { panel.close(); startPhoto(); }
    return null;
  };
  const itemRows = (id: ShopId, again: () => void, section?: string): Row[] => {
    const m = missions();
    return CATALOG[id].items.map((it, i) => {
      const price = priceOf(it, regular(id));
      const why = blocked(it, { cash: m?.cash ?? 0, health: pl.health, rabbitsLeft: rabbitsLeft().length, price });
      return { label: t(it.name), detail: describe(it), price: why ? t(why.key, { n: why.n ?? 0 }) : regular(id) ? t('nl.regularPrice', { n: price }) : `¥${price}`, disabled: !!why,
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
    if (id === 'noodle') rows.push(deliveryRow());
    if (id === 'cats') rows.push(catRow());
    panel.render(t(shop.name), regular(id) ? t('nl.greet.regular') : t(shop.greet), m?.cash ?? 0, rows);
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
      const s = SHOPS[was.kind === 'pet' ? 'cats' : 'bar'], p = W(s.seats![was.seat]), st = W(was.kind === 'pet' ? s.seatFace! : s.stage!);
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
  /** The café's table: sit with the cats (one hops up beside you), health back a second like the bar's. */
  const sitWithCats = (i: number) => {
    const s = SHOPS.cats;
    if (!s.seats || !s.seatFace || seated) return;
    const p = W(s.seats[i]), f = W(s.seatFace);
    pl.setRiding({ pos: new THREE.Vector3(p.x, 0.04, p.z), yaw: Math.atan2(f.x - p.x, f.z - p.z) });
    pl.setPose?.('sit', 0);
    seated = { kind: 'pet', t: 0, seat: i };
    const dx = p.x - f.x, dz = p.z - f.z, L = Math.hypot(dx, dz) || 1, ux = dx / L, uz = dz / L;
    shot({ x: f.x - ux * 1.5 - uz * 0.9, z: f.z - uz * 1.5 + ux * 0.9 }, 1.5, { x: (p.x + f.x) / 2, z: (p.z + f.z) / 2 }, 0.75, 0, 58);
    toast(t('nl.cats.pet'), 4);
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
  /** The crowd is round the camera: 800 m of lane is too long to fill, so walkers are put within WIN of where it is along it. */
  const WIN = 140;
  let clock = 0;
  const addWalker = (cs: number) => {
    // a run near the camera by its length, a place in it
    const near = runsIn(cs - WIN, cs + WIN);
    if (!near.length) return false;
    const len = near.reduce((a, [r0, r1]) => a + (r1 - r0), 0);
    let k = rnd.next() * len, run = near[0];
    for (const r of near) { if (k < r[1] - r[0]) { run = r; break; } k -= r[1] - r[0]; }
    // the turning points are the whole run's (a crossing, a mouth), not the window's
    const whole = RUNS.find(([r0, r1]) => r0 <= run[0] + 1e-6 && r1 >= run[1] - 1e-6) ?? run;
    const lo = whole[0] + (whole[0] < 2 ? 3 : 1.5), hi = whole[1] - 1.5;
    const seed = rnd.next();
    const s0 = Math.max(lo, run[0]), s1 = Math.min(hi, run[1]);
    const w: Walker = { u: (rnd.next() - 0.5) * 2 * 2.3, s: s0 + rnd.next() * Math.max(0, s1 - s0), lo, hi, dir: rnd.next() < 0.5 ? 1 : -1, speed: 0.8 + rnd.next() * 0.45, pause: 0, lookT: 4 + rnd.next() * 14,
      gait: new Gait(), look: randomLook(() => rnd.next()), seed, pos: new THREE.Vector3(), prev: new THREE.Vector3(), yaw: 0 };
    const p = world(w.u, w.s);
    w.pos.set(p.x, 0.03, p.z); w.prev.copy(w.pos); w.yaw = yawOf(0, w.dir, w.s);
    walkers.push(w);
    return true;
  };
  const stepWalkers = (dt: number) => {
    const cam = engine.camera.position;
    const [cu, cs] = local(cam.x, cam.z);
    if (!onLane(cu, cs, 230)) { walkers.length = 0; return; }
    // the ones left far behind go, new ones come in round the camera
    for (let i = walkers.length - 1; i >= 0; i--) if (Math.abs(walkers[i].s - cs) > WIN + 40) walkers.splice(i, 1);
    while (walkers.length < cap()) if (!addWalker(cs)) break;
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
      // keep out of the player's way (and a fight's): step aside
      const du = w.u - pu, ds = w.s - ps, d = Math.hypot(du, ds);
      if (d < 1.1) w.u = Math.max(-2.6, Math.min(2.6, w.u + Math.sign(du || 1) * (1.1 - d) * 4 * dt));
      if (racket) {
        const dr = Math.hypot(w.u - racket.u, w.s - racket.s);
        if (dr < 6) { w.dir = w.s > racket.s ? 1 : -1; w.pause = 0; w.yaw = yawOf(0, w.dir, w.s); }
      }
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

  // --- fast travel: to 地安门东大街 at the lane's south mouth, or 鼓楼东大街 at its north one ---
  let fade: Fade | null = null, travelling = false;
  const travel = async (i: number) => {
    const n = i === 1, end = n ? S1 : S0, dir = n ? 1 : -1;
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
      // the near carriageway, a little short of the mouth: the lane opens on the right (地安门东大街's westbound, from
      // the east; 鼓楼东大街's eastbound, from the west)
      const kerb = n ? world(-14, end + 7.5) : world(14, -4);   // the kerb side: the lane nearest the median has the railings at its door
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
            // 鼓楼东大街's kerb lane is narrower: 7 m over is the pavement behind the railings
            if (n && local(c.x, c.z)[1] < end + 5) continue;
            let hit = false;
            pw.intersectionsWithShape({ x: c.x, y: c.y + 0.95, z: c.z }, qq, box, (col) => { if (col.parent() !== v.car.body) { hit = true; return false; } return true; });
            if (!hit) { pos = c; break; }
          }
          v.reset(pos, lane.yaw); ok = true; hintedCar = true;
        }
      } else {
        // on the pavement before the mouth (by the bollards' gaps), facing in
        const at = world(n ? 0.75 : 0, n ? end + 2.5 : -2.5), to = world(n ? 0.75 : 0, end - dir * 9);
        pl.setRiding(null, { x: at.x, y: 0.3, z: at.z, yaw: Math.atan2(to.x - at.x, to.z - at.z) });
        ok = true;
      }
      // the camera turned to the mouth (to the car's right), as if the player had looked
      camApi()?.snap(driving ? -0.55 : undefined);
    } finally {
      v.inputEnabled = true;
      fade.to(false, ok ? t(driving ? (n ? 'nl.arrivedN' : 'nl.arrived') : 'nl.arrivedFoot', { n: SHOP_IDS.length }) : undefined);
      travelling = false;
    }
  };

  // --- the map: a lantern at the mouth, one at each shop when near, the hutong map's marks ---
  const nav = engine.get<NavApi>('nav');
  const blips: Blip[] = [];
  nav?.addBlips(() => {
    blips.length = 0;
    blips.push({ kind: 'shop', x: south.x, z: south.z, label: t('nl.name') });
    blips.push({ kind: 'shop', x: north.x, z: north.z, label: t('nl.nameN') });
    const P = pl.position;
    for (const id of SHOP_IDS) { const d = W(SHOPS[id].door); if (Math.hypot(P.x - d.x, P.z - d.z) < 300) blips.push({ kind: 'shop', x: d.x, z: d.z }); }
    taskBlips(blips);
    for (const m of marks) blips.push({ kind: 'collect', x: m.x, z: m.z, flash: true });
    return blips;
  });
  engine.events.on('collect:found', () => {
    const left = rabbitsLeft();
    for (let i = marks.length - 1; i >= 0; i--) if (!left.some((l) => Math.hypot(l.x - marks[i].x, l.z - marks[i].z) < 1)) marks.splice(i, 1);
  });

  // ================= round 3: deliveries, the lost cat, 黑豹's collectors, friends at a table =================
  const journal = journalOf(engine);
  const dlg = () => engine.get<DialogueApi>('dialogue');
  /** The HUD's line while one of these is on (cleared only if it is still ours). */
  let said: string | null = null;
  const say = (line: string) => { const m = missions(); if (m && m.story !== line) { m.story = line; said = line; } };
  const unsay = () => { const m = missions(); if (m && said && m.story === said) m.story = null; said = null; };
  /** Nothing else on: no job, no story beat, no police, no street encounter, no fight. */
  const calm = () => {
    const m = missions(), ui = engine.get<{ name: string; state: string }>('ui');
    return (!ui || ui.state === 'playing') && !m?.busy && (!m?.story || m.story === said) && (engine.get<WantedApi>('wanted')?.level ?? 0) === 0
      && !engine.get<{ name: string; active: unknown }>('npc')?.active && !engine.get<CombatApi>('combat')?.engaged;
  };
  const laneS = (p: { x: number; z: number }) => local(p.x, p.z)[1];
  const taskOn = () => !!order || !!lost || !!racket;

  // --- the dumpling shop's deliveries: a bag to a numbered gate up or down the lane, against the clock ---
  interface Order { gate: (typeof GATES)[number]; limit: number; left: number; resident: Actor | null; done: number }
  let order: Order | null = null;
  const noodleS = (SHOPS.noodle.y0 + SHOPS.noodle.y1) / 2;
  const deliveryRow = (): Row => {
    const m = missions(), off = taskOn() || !!m?.busy || (!!m?.story && m.story !== said);
    return { label: t('nl.deliver.offer'), detail: t('nl.deliver.d'), section: t('nl.sec.jobs'), price: order ? t('nl.task.on') : off ? t('nl.task.busy') : t('nl.deliver.pay'),
      disabled: off, buy: () => { panel.close(); startDelivery(); } };
  };
  const startDelivery = () => {
    const far = GATES.filter((g) => { const d = Math.abs(g.door[1] - noodleS); return d > 80 && d < 360; });
    const gate = far[Math.floor(rnd.next() * far.length)];
    if (!gate) return;
    const limit = deliveryTime(Math.abs(gate.door[1] - noodleS) + 4);
    order = { gate, limit, left: limit, resident: null, done: -1 };
    keeperOf('noodle')?.say(t('nl.deliver.go', { no: gate.no }), 4);
    toast(t('nl.deliver.start', { no: gate.no, s: limit }), 4);
  };
  const endDelivery = () => { if (order?.resident?.alive) order.resident.release('vanish'); order = null; unsay(); };
  const handOver = () => {
    const o = order;
    if (!o || o.done >= 0) return;
    o.done = 0;
    const late = o.left <= 0, pay = deliveryPay(o.left, o.limit);
    missions()?.addCash(pay);
    save.deliveries++; store();
    if (o.resident?.alive) { o.resident.say(t(late ? 'nl.deliver.cold' : 'nl.deliver.thanks'), 3); o.resident.act('wave', { t: 0 }); }
    toast(t(late ? 'nl.deliver.paidLate' : 'nl.deliver.paid', { n: pay }), 3);
    engine.events.emit('district:delivered', { pay, late });
    unsay();
  };
  const deliveryStep = (dt: number) => {
    const o = order;
    if (!o) return;
    const d = W(o.gate.door);
    if (o.done >= 0) {
      // handed over: the one who ordered goes back in once the player has walked on
      o.done += dt;
      if (o.done > 15 || (o.done > 3 && !near(d, 9))) { if (o.resident?.alive) o.resident.release('vanish'); order = null; }
      return;
    }
    o.left -= dt;
    say(o.left > 0 ? t('nl.deliver.obj', { no: o.gate.no, s: Math.ceil(o.left) }) : t('nl.deliver.late', { no: o.gate.no }));
    // the one who ordered waits at their gate once the player is near
    if (!o.resident?.alive && near(d, 40)) {
      const p = W(o.gate.in);
      o.resident = people.spawnActor!(p.x, p.z, { yaw: Math.atan2(d.x - p.x, d.z - p.z), seed: 6100 + Number(o.gate.no) }) ?? null;
      if (o.resident) { o.resident.stop(); o.resident.face(d.x, d.z); }
    }
    // given up on: far off, or two minutes late
    if (!near(d, 600) || o.left < -120) { endDelivery(); toast(t('nl.deliver.lost'), 3); }
  };

  // --- the cat café: its cats, and 大橘 who got out - found by its mewing, it follows the player home ---
  const cats = new Cats(engine.scene, engine.get<RenderApi>('render')?.uniforms);
  const cafe = SHOPS.cats, cafeDoor = W(cafe.door), cafeS = (cafe.y0 + cafe.y1) / 2;
  /** Each spot's cat: pose and coat (spot 2's is 大橘, the ginger one, whose cushion it is). */
  const CAFE_CATS: [CatPose, number][] = [['curl', 1], ['loaf', 3], ['curl', 0], ['loaf', 2], ['sit', 4], ['loaf', 1]];
  interface Lost { x: number; z: number; yaw: number; pose: CatPose; follow: boolean; meowT: number; heard: boolean; hint: { x: number; z: number } }
  let lost: Lost | null = null, catCool = 0, cafeMeow = 6;
  const catState: CatState = { x: 0, y: 0, z: 0, yaw: 0, pose: 'sit', coat: 0, t: 0 };
  const catRow = (): Row => {
    const m = missions(), off = taskOn() || catCool > 0 || !!m?.busy || (!!m?.story && m.story !== said);
    return { label: t('nl.cat.offer'), detail: t('nl.cat.d'), section: t('nl.sec.jobs'),
      price: lost ? t('nl.task.on') : catCool > 0 ? t('nl.cat.home') : off ? t('nl.task.busy') : `+¥${save.cat ? 60 : CAT_REWARD}`,
      disabled: off, buy: () => { panel.close(); startCat(); } };
  };
  const startCat = () => {
    // somewhere along the lane 60-260 m from the café, against a front (not in a doorway), sitting low
    for (let k = 0; k < 60 && !lost; k++) {
      const s = cafeS + (60 + rnd.next() * 200) * (rnd.next() < 0.5 ? -1 : 1), side = rnd.next() < 0.5 ? -1 : 1;
      if (!RUNS.some(([a, b]) => s > a + 3 && s < b - 3)) continue;
      if (SHOP_IDS.some((id) => (SHOPS[id].side === 'e') === side > 0 && s > SHOPS[id].y0 - 0.8 && s < SHOPS[id].y1 + 0.8)) continue;
      const p = world(side * 3.3, s), h = world(side * 1.5, s + (rnd.next() - 0.5) * 36);
      lost = { x: p.x, z: p.z, yaw: yawOf(-side, (rnd.next() - 0.5), s), pose: rnd.next() < 0.5 ? 'loaf' : 'sit', follow: false, meowT: 2, heard: false, hint: h };
    }
    if (!lost) return;
    keeperOf('cats')?.say(t('nl.cat.go'), 4.5);
    toast(t('nl.cat.start'), 4);
  };
  const catStep = (dt: number) => {
    const c = lost;
    if (!c) return;
    const f = pl.foot, P = f?.pos ?? pl.position, d = Math.hypot(P.x - c.x, P.z - c.z);
    if (near({ x: c.x, z: c.z }, 400)) say(t(c.follow ? 'nl.cat.bring' : 'nl.cat.obj')); else unsay();
    // mewing: often while lost (the way to find it), now and then on the way home
    c.meowT -= dt;
    if (c.meowT <= 0 && d < 40) { c.meowT = c.follow ? 8 + rnd.next() * 6 : 3 + rnd.next() * 3; engine.events.emit('district:meow', { x: c.x, z: c.z }); }
    if (!c.follow && !c.heard && d < 14) { c.heard = true; toast(t('nl.cat.hear'), 3); }
    if (!c.follow) return;
    // at heel: a metre behind, trotting to catch up, sitting when the player stops
    if (!f || d > 60) { c.follow = false; c.pose = 'sit'; toast(t('nl.cat.stay'), 3); return; }
    const tx = f.pos.x - Math.sin(f.yaw) * 1.0, tz = f.pos.z - Math.cos(f.yaw) * 1.0, dx = tx - c.x, dz = tz - c.z, dd = Math.hypot(dx, dz);
    if (dd > 0.35) {
      const step = Math.min(dd, Math.min(6, 0.8 + dd * 2.2) * dt);
      c.x += dx / dd * step; c.z += dz / dd * step; c.yaw = Math.atan2(dx, dz); c.pose = 'walk';
    } else { c.pose = 'sit'; c.yaw = Math.atan2(f.pos.x - c.x, f.pos.z - c.z); }
    // home: in through the café's door
    if (shopAt(c.x, c.z) === 'cats') {
      const pay = save.cat ? 60 : CAT_REWARD;
      missions()?.addCash(pay);
      save.cat = true; store();
      lost = null; catCool = 600; unsay();
      thanks('cats', t('nl.cat.thanks'));
      toast(t('nl.cat.done', { n: pay }), 4);
      engine.events.emit('district:meow', { x: c.x, z: c.z });
    }
  };
  const drawCats = () => {
    cats.begin();
    const sitting = seated?.kind === 'pet';
    if (cafe.cats && near(cafeDoor, 60)) cafe.cats.forEach(([u, s, h, fu, fs], j) => {
      if (j === 2 && lost) return;
      const [pose, coat] = CAFE_CATS[j];
      let p = world(u, s), y = h, yaw = Math.atan2(world(fu, fs).x - p.x, world(fu, fs).z - p.z);
      // sat at the table, the grey one hops up beside you
      if (j === 3 && sitting && cafe.seatFace) { p = W(cafe.seatFace); y = 0.78; yaw = Math.atan2(pl.position.x - p.x, pl.position.z - p.z); }
      catState.x = p.x; catState.y = y; catState.z = p.z; catState.yaw = yaw; catState.pose = j === 3 && sitting ? 'loaf' : pose; catState.coat = coat; catState.t = clock + j * 1.7;
      cats.add(catState);
    });
    if (lost) { catState.x = lost.x; catState.y = 0.035; catState.z = lost.z; catState.yaw = lost.yaw; catState.pose = lost.pose; catState.coat = 0; catState.t = clock; cats.add(catState); }
    cats.commit();
  };

  // --- 黑豹's collectors at a shop's door: the keeper out in the lane, three of them round him, a fight if you step in ---
  interface Racket { shop: ShopId; u: number; s: number; brawl: ReturnType<CombatApi['brawl']>; keeper: Actor | null; t: number; fight: boolean; lineT: number; line: number; over: boolean }
  let racket: Racket | null = null, racketCool = 50;
  const RACKET_WAIT = 150;
  const startRacket = (): boolean => {
    const cb = engine.get<CombatApi>('combat'), f = pl.foot;
    if (!cb || !f) return false;
    const ps = laneS(f.pos);
    // a shop 25-95 m along from the player (not one already stood up for, if there is another)
    const cands = RACKET_SHOPS.filter((id) => { const d = Math.abs(laneS(W(SHOPS[id].door)) - ps); return d > 25 && d < 95; })
      .sort((a, b) => Number(regular(a)) - Number(regular(b)) || Math.abs(laneS(W(SHOPS[a].door)) - ps) - Math.abs(laneS(W(SHOPS[b].door)) - ps));
    const id = cands[0];
    if (!id) return false;
    const [du, ds] = SHOPS[id].door, side = du > 0 ? 1 : -1, ku = du - side * 0.9;
    const kp = world(ku, ds), at = [world(du - side * 2.3, ds), world(du - side * 1.8, ds - 1.3), world(du - side * 1.8, ds + 1.3)];
    const b = cb.brawl(kp.x, kp.z, engine.lite ? 2 : 3, { at, wait: kp });
    if (!b.actors.length) return false;
    // the keeper steps out (a fresh one of the same face: the one at the counter is put away)
    const k = keepers.find((q) => q.id === id)!;
    keeperDrop(k);
    const ka = people.spawnActor!(kp.x, kp.z, { yaw: Math.atan2(at[0].x - kp.x, at[0].z - kp.z), seed: 911 + SHOP_IDS.indexOf(id) * 37 }) ?? null;
    if (ka) { ka.stop(); ka.face(at[0].x, at[0].z); ka.act('talk', { t: 0 }); }
    racket = { shop: id, u: ku, s: ds, brawl: b, keeper: ka, t: 0, fight: false, lineT: 0.5, line: 0, over: false };
    const r = racket;
    toast(t('nl.racket.news', { shop: t(CATALOG[id].name) }), 4);
    void b.done.then((res) => {
      if (racket !== r) return;
      r.over = true;
      unsay();
      const name = t(CATALOG[r.shop].name);
      if (res === 'won') {
        const pay = RACKET_PAY * b.actors.length;
        missions()?.addCash(pay);
        const first = !regular(r.shop);
        if (first) save.regulars.push(r.shop);
        save.rackets++; store();
        if (r.keeper?.alive) { r.keeper.say(t('nl.racket.thanks'), 4); r.keeper.act('cheer', { t: 0 }); }
        toast(t('nl.racket.won', { n: pay }), 3.5);
        if (first) after(3.2, () => toast(t('nl.racket.regular', { shop: name }), 4.5));
        journal.meet('nl.racket');
        racketCool = 600;
      } else if (res === 'fled' && !r.fight) {
        // nobody stepped in: they took the money and went
        if (r.keeper?.alive) r.keeper.say(t('nl.racket.paid'), 3.5);
        toast(t('nl.racket.gone', { shop: name }), 3.5);
        racketCool = 300;
      } else {
        if (res === 'fled') toast(t('npc.gang.fled'), 2.5);
        racketCool = 300;
      }
      engine.events.emit('district:racket', { shop: r.shop, result: res === 'fled' && !r.fight ? 'paid' : res });
      // back behind the counter in a while (the keeper loop puts the indoor one back once this is gone)
      after(6, () => { if (r.keeper?.alive) r.keeper.release('vanish'); if (racket === r) racket = null; });
    });
    return true;
  };
  const racketStep = (dt: number) => {
    const r = racket;
    if (!r || r.over) return;
    r.t += dt;
    const lead = r.brawl.actors[0], f = pl.foot;
    say(t(r.fight ? 'nl.racket.fight' : 'nl.racket.obj', { shop: t(CATALOG[r.shop].name) }));
    if (r.fight) return;
    // leaning on him: a line from them, a plea from him, turn about
    r.lineT -= dt;
    if (r.lineT <= 0) {
      r.lineT = 3.4;
      const who = r.line % 2 === 0 ? lead : r.keeper;
      if (who?.alive) who.say(t(`nl.racket.${r.line % 2 === 0 ? 't' : 'k'}${Math.floor(r.line / 2) % 3}` as 'nl.racket.t0'), 3);
      r.line++;
    }
    const go = !!f && !!lead?.alive && Math.hypot(f.pos.x - lead.pos.x, f.pos.z - lead.pos.z) < 5.5;
    if (go) {
      r.fight = true;
      r.brawl.go();
      if (lead?.alive) lead.say(t('nl.racket.go'), 2.5);
      if (r.keeper?.alive) { const kp = world(r.u + (r.u > 0 ? 0.7 : -0.7), r.s); r.keeper.goTo(kp.x, kp.z, 1.6); r.keeper.act(null); }
      return;
    }
    // nobody came (or the player went off): they collect and go
    if (r.t > RACKET_WAIT || !near(world(r.u, r.s), 220)) r.brawl.end();
  };
  engine.events.on('combat:swing', ({ x, z }) => {
    const r = racket;
    if (r && !r.fight && !r.over && Math.hypot(x - world(r.u, r.s).x, z - world(r.u, r.s).z) < 7) { r.fight = true; r.brawl.go(); }
  });

  // --- 小飞龙 and 小雨 at a 象棋 table in the north stretch (contacts/: their looks, models, friendship) ---
  const MEET = { u: -2.55, s: 583.0 };
  interface Friend { id: 'feilong' | 'xiaoyu'; name: string; color: string; ds: number; actor: Actor | null }
  const friends: Friend[] = [{ id: 'feilong', name: 'con.who.feilong', color: '#ff3b6b', ds: -0.72, actor: null }, { id: 'xiaoyu', name: 'who.xiaoyu', color: '#5ac8fa', ds: 0.72, actor: null }];
  const meetAt = world(MEET.u, MEET.s);
  let chatted = false, treated = false, meetLine = 0;
  const contacts = () => engine.get<ContactsApi>('contacts');
  const friendSpawn = () => {
    const c = contacts();
    if (!c) return;
    for (const fr of friends) {
      const p = world(MEET.u, MEET.s + fr.ds), look = c.appearance(fr.id);
      c.reserve(fr.id, true);
      const a = people.spawnActor!(p.x, p.z, { look, yaw: Math.atan2(meetAt.x - p.x, meetAt.z - p.z), seed: fr.id === 'feilong' ? 7701 : 7702 }) ?? null;
      if (!a) continue;
      a.stop(); a.face(meetAt.x, meetAt.z); a.act('chess', { seat: 0.42 });
      fr.actor = a;
      if (CAST_ON) void hasModel(fr.id).then((yes) => { if (yes) castModel(engine, fr.id, look).then((m) => { if (a.alive) a.model = m; else m.hide(); }).catch(() => {}); });
    }
  };
  const friendDrop = () => { for (const fr of friends) { if (fr.actor?.alive) fr.actor.release('vanish'); fr.actor = null; contacts()?.reserve(fr.id, false); } };
  const speakerOf = (fr: Friend): Speaker => {
    const h = contacts()?.hearts(fr.id) ?? 0;
    return { name: `${t(fr.name as 'who.xiaoyu')} ${'♥'.repeat(h)}${'♡'.repeat(5 - h)}`, color: fr.color, look: contacts()?.appearance(fr.id), voice: fr.actor ? { ...fr.actor.voice, character: fr.id } : undefined, at: fr.actor?.pos ?? null };
  };
  const meetTalk = () => {
    const [f, x] = friends, c = contacts(), d = dlg();
    if (!c || !d || !f.actor?.alive) return;
    for (const fr of friends) { journal.meet(`con.${fr.id}`); fr.actor?.face(pl.position.x, pl.position.z); }
    const k = meetLine++ % 3;
    d.ask(speakerOf(f), t(k === 0 ? 'nl.meet.greet' : 'nl.meet.again'), [t('nl.meet.chat'), t('nl.meet.treat', { n: 45 }), t('nl.meet.bye')], (i) => {
      if (i === 0) {
        d.say(speakerOf(f), t(`nl.meet.f${k}` as 'nl.meet.f0'), { prio: 2 });
        after(3.8, () => dlg()?.say(speakerOf(x), t(`nl.meet.x${k}` as 'nl.meet.x0'), { prio: 2 }));
        if (!chatted) { chatted = true; c.addFriendship('feilong', 3); c.addFriendship('xiaoyu', 3); }
      } else if (i === 1) {
        const m = missions();
        if (treated) { d.say(speakerOf(x), t('nl.meet.full'), { prio: 2 }); return; }
        if (!m || m.cash < 45) { toast(t('nl.panel.short', { n: 45 - (m?.cash ?? 0) }), 2); return; }
        m.addCash(-45); treated = true;
        c.addFriendship('feilong', 8); c.addFriendship('xiaoyu', 8);
        d.say(speakerOf(f), t('nl.meet.thanksF'), { prio: 2 });
        after(3.4, () => dlg()?.say(speakerOf(x), t('nl.meet.thanksX'), { prio: 2 }));
      }
    }, { prio: 3, timeout: 15, fallback: 2 });
  };

  /** The map's marks for what is on: the door to deliver to, where the cat was last seen (then the café), the racket, the friends. */
  const taskBlips = (out: Blip[]) => {
    if (order && order.done < 0) { const d = W(order.gate.door); out.push({ kind: 'dropoff', x: d.x, z: d.z, flash: true }); }
    if (lost) out.push(lost.follow ? { kind: 'dropoff', x: cafeDoor.x, z: cafeDoor.z, flash: true } : { kind: 'target', x: lost.hint.x, z: lost.hint.z, flash: true });
    if (racket && !racket.over) { const p = world(racket.u, racket.s); out.push({ kind: 'encounter', x: p.x, z: p.z, flash: true }); }
    if (contacts() && Math.hypot(pl.position.x - meetAt.x, pl.position.z - meetAt.z) < 400) out.push({ kind: 'contact', x: meetAt.x, z: meetAt.z, label: t('nl.meet.map'), color: '#ff3b6b' });
  };

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
    get busy() { return !!inShop || !!seated || !!photo || dancing || panel.open || card.open || yardNow || near(W(SHOPS.grill.counter), 3) || taskOn(); },
    travelSpots: () => [{ label: t('travel.nanluo'), x: south.x, z: south.z }, { label: t('travel.nanluoN'), x: north.x, z: north.z }],
    travel: (i) => { void travel(i); },
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
      racket: () => { racketCool = 0; return !racket && startRacket(); },
      deliver: () => { if (!order) startDelivery(); return order ? W(order.gate.door) : null; },
      cat: () => { if (!lost) startCat(); return lost ? { x: lost.x, z: lost.z } : null; },
      catHere: () => { const f = pl.foot; if (lost && f) { lost.x = f.pos.x - Math.sin(f.yaw); lost.z = f.pos.z - Math.cos(f.yaw); } },
      catSeats: () => (SHOPS.cats.seats ?? []).map(W),
      tasks: () => ({
        racket: racket ? { shop: racket.shop, fight: racket.fight, over: racket.over, thugs: racket.brawl.actors.map((a) => ({ x: a.pos.x, z: a.pos.z, alive: a.alive })) } : null,
        order: order ? { no: order.gate.no, left: order.left, done: order.done, resident: !!order.resident?.alive } : null,
        cat: lost ? { x: lost.x, z: lost.z, follow: lost.follow } : null,
        friends: friends.map((f) => !!f.actor?.alive), meet: meetAt,
      }),
    },
    fixedUpdate(dt) {
      clock += dt; danceT += dt; songT += dt;
      for (let i = later.length - 1; i >= 0; i--) { later[i].t -= dt; if (later[i].t <= 0) { const f = later[i].fn; later.splice(i, 1); f(); } }
      stepWalkers(dt);
      for (const k of keepers) {
        if (k.actor && !k.actor.alive) k.actor = null;
        if (racket?.shop === k.id) continue;   // out in the lane with the collectors
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
      // round 3: the jobs on, the collectors, the friends at their table
      deliveryStep(dt); catStep(dt); racketStep(dt);
      catCool = Math.max(0, catCool - dt);
      if (!racket) {
        const f = pl.foot;
        const [fu, fs] = f ? local(f.pos.x, f.pos.z) : [1e9, 0];
        if (f && pl.mode === 'onfoot' && !pl.riding && onLane(fu, fs)) {
          racketCool -= dt;
          if (racketCool <= 0) {
            racketCool = 20;   // not now: look again in a while
            if (calm() && !taskOn() && !inShop && !seated && !panel.open && !yardNow) startRacket();
          }
        }
      }
      if (!friends[0].actor?.alive && near(meetAt, ON)) { friendDrop(); friendSpawn(); }
      else if (friends[0].actor && !near(meetAt, OFF)) friendDrop();
      // the café's cats mew now and then while the player is inside
      if (inShop === 'cats' && (cafeMeow -= dt) <= 0) { cafeMeow = 10 + rnd.next() * 12; const c = cafe.cats?.[Math.floor(rnd.next() * 6)]; if (c) { const p = world(c[0], c[1]); engine.events.emit('district:meow', { x: p.x, z: p.z }); } }
      // the grill's smoke while anyone is near enough to see it
      smokeT -= dt;
      if (smokeT <= 0 && near(smokeAt, 70)) { smokeT = 0.28; fx()?.smoke(smokeAt.x + (rnd.next() - 0.5) * 0.6, 1.2, smokeAt.z + (rnd.next() - 0.5) * 0.3, 0, 0.55, 0, 0.45, 2.6, 0.18); }
      if (seated?.kind === 'listen' || seated?.kind === 'pet') { seated.t += dt; if (pl.health < 100) pl.heal(LISTEN_HEAL * dt); }
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
      // the friends' 象棋 table and stools
      if (friends[0].actor?.alive) {
        const yaw = yawOf(0, 1, MEET.s);
        lifeProps.place('chess', meetAt.x, 0.03, meetAt.z, yaw);
        for (const fr of friends) { const p = world(MEET.u, MEET.s + fr.ds * 1.08); lifeProps.place('stool', p.x, 0.03, p.z, yaw); }
      }
      lifeProps.commit();
      drawCats();
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
      if ((seated?.kind === 'listen' || seated?.kind === 'pet') && seated.t > 0.5 && engine.input.state.enterPressed) standUp();
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
        if ((inShop === 'bar' || inShop === 'cats') && s.seats) s.seats.forEach((xy, i) => {
          const p = W(xy), cafe = inShop === 'cats';
          if (Math.hypot(foot.pos.x - p.x, foot.pos.z - p.z) < 0.95) pl.offer?.({ x: p.x, z: p.z, r: 0.95, label: t(cafe ? 'nl.offer.pet' : 'nl.offer.seat'), use: () => (cafe ? sitWithCats(i) : sitToListen(i)) });
        });
      }
      // the jobs: the bag handed over at the gate, 大橘 picked up, the friends' table
      if (order && order.done < 0) {
        const d = W(order.gate.door);
        if (Math.hypot(foot.pos.x - d.x, foot.pos.z - d.z) < 1.8) pl.offer?.({ x: d.x, z: d.z, r: 1.8, label: t('nl.offer.deliver', { no: order.gate.no }), use: handOver });
      }
      if (lost && !lost.follow && Math.hypot(foot.pos.x - lost.x, foot.pos.z - lost.z) < 1.5) {
        const c = lost;
        pl.offer?.({ x: c.x, z: c.z, r: 1.5, label: t('nl.offer.cat'), use: () => { c.follow = true; c.meowT = 0; toast(t('nl.cat.found'), 3.5); } });
      }
      if (friends[0].actor?.alive && Math.hypot(foot.pos.x - meetAt.x, foot.pos.z - meetAt.z) < 2.4 && !dlg()?.asking) pl.offer?.({ x: meetAt.x, z: meetAt.z, r: 2.4, label: t('nl.meet.offer'), use: meetTalk });
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
