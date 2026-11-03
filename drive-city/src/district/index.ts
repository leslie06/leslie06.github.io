import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t } from '../core/I18n';
import { Rng } from '../core/Rng';
import type { Actor, Blip, CameraApi, HudApi, MissionApi, NavApi, PeopleApi, PlayerApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { CollectApi } from '../collect';
import type { MusicSource } from '../audio/StreetMusic';
import { Gait } from '../character/Animator';
import { randomLook, type Look } from '../character/Body';
import { project } from '../city/Geo';
import { Fade } from '../campaign/Screens';
import { DanceGame } from '../life/DanceGame';
import { css, el } from '../ui/theme';
import META from '../city/landmarks/glb/nanluo.meta.json';
import LAYOUT from './nanluo.layout.json';
import { agePrint, PhotoCard, ShopPanel, type Row } from './Panel';
import { blocked, CATALOG, DANCE_PRICE, dancePrize, type Item, loadSave, MAP_MARKS, type Save, SHOP_IDS, type ShopId } from './Shops';

css(`.nl-flash{position:fixed;inset:0;background:#fff;pointer-events:none;z-index:47;opacity:0;transition:opacity .5s ease-out}.nl-flash.on{opacity:.9;transition:none}`);

const KEY = 'drivecity.district.v1';
/** Keepers stand in their shops while the player is this near the lane, and go past OFF. */
const ON = 90, OFF = 130;
/** A keeper calls out to a passer-by this near the door, at most every BARK_EVERY s. */
const BARK_R = 7, BARK_EVERY = 25;
/** The counter's reach (F). */
const COUNTER_R = 1.6;
/** Lane walkers, by tier (省电档: LITE). */
const WALKERS = { low: 14, medium: 22, high: 30 } as const, LITE = 8;
/** Every shop gone into once. */
const ALL_VISITED = 200;

export interface DistrictApi extends System {
  /** The player is in one of the shops (its id), or null. */
  readonly inShop: ShopId | null;
  /** Fast travel (the map's 快速前往, missions/ lists it after 送豆腐's): where it goes. */
  travelSpots(): readonly { label: string; x: number; z: number }[];
  /** Go there now (the caller has checked nothing is on). */
  travel(i: number): void;
  /** What is playing in the lane (the dance machine), for audio/. */
  readonly music: readonly MusicSource[];
  /** What the player keeps from the lane (the pause screen's progress line). */
  readonly saved: Readonly<Save>;
  debug: { shops(): Record<string, { door: { x: number; z: number }; counter: { x: number; z: number }; keeper: boolean }>; walkers(): number; save(): Save; open(id: ShopId): void; buy(id: ShopId, i: number): string | null; world(bx: number, by: number): { x: number; z: number } };
}

type XY = [number, number];
interface ShopLayout { side: string; y0: number; y1: number; door: XY; inside: XY; room: [XY, XY]; counter: XY; keeper: XY; keeperFace: XY; chair?: XY; camera?: XY; pad?: XY; padFace?: XY }

// The model's frame: Blender (bx, by) is the game's local (bx, -by), turned by -heading about the anchor (city/index.ts
// placeLandmarks).
const [OX, OZ] = project(META.lat, META.lon);
const ROT = -META.headingDeg * Math.PI / 180, RC = Math.cos(ROT), RS = Math.sin(ROT);
const world = (bx: number, by: number): { x: number; z: number } => ({ x: OX + bx * RC - by * RS, z: OZ - bx * RS - by * RC });
const local = (x: number, z: number): XY => { const dx = x - OX, dz = z - OZ; return [dx * RC - dz * RS, -(dx * RS + dz * RC)]; };
/** The game's yaw (atan2(x, z)) of Blender direction (dx, dy). */
const yawOf = (dx: number, dy: number): number => Math.atan2(dx * RC - dy * RS, -dx * RS - dy * RC);

const LANE = LAYOUT.lane as { half: number; y0: number; y1: number };
const SHOPS = LAYOUT.shops as unknown as Record<ShopId, ShopLayout>;
const MOUTHS = LAYOUT.mouths as Record<'south' | 'north' | 'fuxiang', XY>;

interface Keeper { id: ShopId; actor: Actor | null; barkT: number; faceT: number }
interface Walker { bx: number; by: number; dir: number; speed: number; pause: number; lookT: number; face: number; gait: Gait; look: Look; seed: number; pos: THREE.Vector3; prev: THREE.Vector3; yaw: number }

/**
 * 南锣鼓巷 (2026-11-03, docs/gta-plan.md §12, 「先做精华街区，要求街区精美，可以进入商店，让用户不只是开车，还能下车活动」): the
 * lane is a landmark (scripts/blender/landmarks/nanluo.py); this runs what happens in it. Five shops with a keeper behind
 * the counter (F there: a panel of what they sell), the camera closing in indoors, a crowd strolling the lane, a keeper
 * calling out to passers-by, a hint at the mouths, the map's lantern blip and 快速前往.
 *   snack   food: health back
 *   tea     drinks: a little health and less damage for a few minutes (PlayerApi.guard)
 *   crafts  a hutong map (the three nearest 兔儿爷 on the map) and clay 兔儿爷 to keep
 *   photo   sit before the painted backdrop: a flash, the frame toned as an old print, saved if they like
 *   arcade  the dance machine (life/'s DanceGame on its own clock, music from audio/'s dance voice): prizes by cues hit
 */
export async function install(engine: Engine): Promise<void> {
  const pl = engine.get<PlayerApi>('player'), people = engine.get<PeopleApi>('people');
  if (!pl || !people?.spawnActor) return;
  const q = new URLSearchParams(location.search);
  if (q.has('shot') && !q.has('district')) return;

  let save = loadSave(null);
  try { save = loadSave(localStorage.getItem(KEY)); } catch { /* private mode */ }
  engine.events.on('game:start', () => { try { save = loadSave(localStorage.getItem(KEY)); } catch { /* ignore */ } });
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* ignore */ } };
  const missions = () => engine.get<MissionApi>('missions');
  const hud = () => engine.get<HudApi>('hud');
  const toast = (s: string, secs?: number) => hud()?.toast(s, secs);
  const rnd = new Rng(7307);

  const W = (b: XY) => world(b[0], b[1]);
  const south = W(MOUTHS.south), centre = world(0, (LANE.y0 + LANE.y1) / 2);
  const roomOf = (s: ShopLayout) => {
    const [a, b] = s.room;
    return { x0: Math.min(a[0], b[0]), x1: Math.max(a[0], b[0]), y0: Math.min(a[1], b[1]), y1: Math.max(a[1], b[1]) };
  };
  const rooms = Object.fromEntries(SHOP_IDS.map((id) => [id, roomOf(SHOPS[id])])) as Record<ShopId, ReturnType<typeof roomOf>>;
  const shopAt = (x: number, z: number): ShopId | null => {
    const [bx, by] = local(x, z);
    for (const id of SHOP_IDS) { const r = rooms[id]; if (bx > r.x0 - 0.35 && bx < r.x1 + 0.35 && by > r.y0 - 0.35 && by < r.y1 + 0.35) return id; }
    return null;
  };

  // --- keepers ---
  const keepers: Keeper[] = SHOP_IDS.map((id) => ({ id, actor: null, barkT: 8 + rnd.next() * 10, faceT: 0 }));
  const keeperSpawn = (k: Keeper) => {
    const s = SHOPS[k.id], p = W(s.keeper), f = W(s.keeperFace);
    const a = people.spawnActor!(p.x, p.z, { yaw: Math.atan2(f.x - p.x, f.z - p.z), seed: 911 + SHOP_IDS.indexOf(k.id) * 37 });
    if (!a) return;
    a.stop(); a.face(f.x, f.z);
    k.actor = a;
  };
  const keeperDrop = (k: Keeper) => { if (k.actor?.alive) k.actor.release('vanish'); k.actor = null; };

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
      const near = rabbitsLeft().sort((a, b) => Math.hypot(a.x - P.x, a.z - P.z) - Math.hypot(b.x - P.x, b.z - P.z)).slice(0, MAP_MARKS);
      marks.length = 0; marks.push(...near);
      toast(t('nl.mapDone', { n: near.length }), 3);
    }
    if (it.act === 'souvenir') { save.souvenirs++; store(); toast(t('nl.souvenir', { n: save.souvenirs }), 3); }
    if (!it.guard && it.act !== 'map' && it.act !== 'souvenir') toast(t('nl.bought', { item: t(it.name), n: it.price }), 2);
    const k = keepers.find((q) => q.id === id);
    if (k?.actor?.alive) { k.actor.say(t('nl.thanks'), 2.5); k.actor.act('talk', { t: 0 }); }
    if (it.act === 'photo') { panel.close(); startPhoto(); }
    return null;
  };
  const openShop = (id: ShopId) => {
    const shop = CATALOG[id], m = missions();
    const rows: Row[] = shop.items.map((it) => {
      const why = blocked(it, { cash: m?.cash ?? 0, health: pl.health, rabbitsLeft: rabbitsLeft().length });
      return { label: t(it.name), detail: describe(it), price: why ? t(why.key, { n: why.n ?? 0 }) : `¥${it.price}`, disabled: !!why,
        buy: () => { if (!buy(id, it) && panel.open) openShop(id); } };
    });
    if (id === 'arcade') {
      const short = (m?.cash ?? 0) < DANCE_PRICE;
      rows.push({ label: t('nl.offer.dance', { n: DANCE_PRICE }), detail: t('nl.greet.arcade'), price: short ? t('nl.panel.short', { n: DANCE_PRICE - (m?.cash ?? 0) }) : `¥${DANCE_PRICE}`,
        disabled: short, buy: () => { panel.close(); startDance(); } });
    }
    panel.render(t(shop.name), t(shop.greet), m?.cash ?? 0, rows);
    const k = keepers.find((q) => q.id === id);
    if (k?.actor?.alive) k.actor.act('talk', { t: 0 });
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
    const camApi = engine.get<CameraApi>('camera');
    if (camApi) camApi.override = (cm) => {
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
    const camApi = engine.get<CameraApi>('camera');
    if (camApi) camApi.override = null;
    pl.setPose?.(null);
    const ax = c.x + (cam.x - c.x) * 0.35, az = c.z + (cam.z - c.z) * 0.35;
    pl.setRiding(null, { x: ax, y: 0.2, z: az, yaw: Math.atan2(cam.x - c.x, cam.z - c.z) });
    camApi?.snap();
    photo = null;
  };

  // --- the dance machine ---
  let danceT = 0, dancing = false;
  const music: MusicSource[] = [];
  const dance = new DanceGame(engine, (hits, of) => {
    dancing = false;
    music.length = 0;
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
    music.length = 0;
    music.push({ id: 'nl-arcade', kind: 'dance', x: p.x, z: p.z, t: danceT });
  };

  // --- the lane's crowd: strolling up and down, stopping at the windows, turning at the ends ---
  const cap = () => (engine.lite ? LITE : WALKERS[engine.quality.tier]);
  const walkers: Walker[] = [];
  const crowd = pl.crowd, camDir = new THREE.Vector3(), draw = new THREE.Vector3();
  let clock = 0;
  const addWalker = (by: number) => {
    const seed = rnd.next();
    const w: Walker = { bx: (rnd.next() - 0.5) * 2 * 2.3, by, dir: rnd.next() < 0.5 ? 1 : -1, speed: 0.8 + rnd.next() * 0.45, pause: 0, lookT: 4 + rnd.next() * 14, face: 0,
      gait: new Gait(), look: randomLook(() => rnd.next()), seed, pos: new THREE.Vector3(), prev: new THREE.Vector3(), yaw: 0 };
    const p = world(w.bx, w.by);
    w.pos.set(p.x, 0.03, p.z); w.prev.copy(w.pos); w.yaw = yawOf(0, w.dir);
    walkers.push(w);
  };
  const stepWalkers = (dt: number) => {
    const cam = engine.camera.position;
    const near = Math.hypot(cam.x - centre.x, cam.z - centre.z) < 230;
    if (!near) { walkers.length = 0; return; }
    while (walkers.length < cap()) addWalker(LANE.y0 + 4 + rnd.next() * (LANE.y1 - LANE.y0 - 6));
    while (walkers.length > cap()) walkers.pop();
    const foot = pl.foot;
    const [px, py] = foot ? local(foot.pos.x, foot.pos.z) : [1e9, 1e9];
    for (const w of walkers) {
      w.prev.copy(w.pos);
      if (w.pause > 0) {
        w.pause -= dt;
        if (w.pause <= 0) w.yaw = yawOf(0, w.dir);
      } else {
        w.by += w.dir * w.speed * dt;
        w.lookT -= dt;
        // at a window now and then: turn to the nearer front and stand a while
        if (w.lookT <= 0 && Math.abs(w.bx) > 1.4) {
          w.pause = 2 + rnd.next() * 5; w.lookT = 8 + rnd.next() * 18;
          w.yaw = yawOf(w.bx > 0 ? 1 : -1, 0);
        }
        // the ends: turn back (the bollards and the main road are beyond)
        if (w.by > LANE.y1 - 1.5 || w.by < LANE.y0 + 3) {
          w.dir = w.by > LANE.y1 - 1.5 ? -1 : 1;
          w.pause = 0.6 + rnd.next() * 1.4;
          w.yaw = yawOf(0, w.dir);
        }
      }
      // keep out of the player's way: step aside
      const dx = w.bx - px, dy = w.by - py, d = Math.hypot(dx, dy);
      if (d < 1.1) w.bx = Math.max(-2.6, Math.min(2.6, w.bx + Math.sign(dx || 1) * (1.1 - d) * 4 * dt));
      const p = world(w.bx, w.by);
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
          const { R, world: pw } = engine.physics, box = new R.Cuboid(0.95, 0.6, 2.1), q = { x: 0, y: Math.sin(lane.yaw / 2), z: 0, w: Math.cos(lane.yaw / 2) };
          let pos = lane.pos;
          for (const k of [7, 3.5]) {
            const c = { x: lane.pos.x - fz * k, y: lane.pos.y, z: lane.pos.z + fx * k };
            let hit = false;
            pw.intersectionsWithShape({ x: c.x, y: c.y + 0.95, z: c.z }, q, box, (col) => { if (col.parent() !== v.car.body) { hit = true; return false; } return true; });
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
      engine.get<CameraApi>('camera')?.snap(driving ? -0.55 : undefined);
    } finally {
      v.inputEnabled = true;
      fade.to(false, ok ? t(driving ? 'nl.arrived' : 'nl.arrivedFoot') : undefined);
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
    if (Math.hypot(P.x - centre.x, P.z - centre.z) < 260) for (const id of SHOP_IDS) { const d = W(SHOPS[id].door); blips.push({ kind: 'shop', x: d.x, z: d.z }); }
    for (const m of marks) blips.push({ kind: 'collect', x: m.x, z: m.z, flash: true });
    return blips;
  });
  engine.events.on('collect:found', () => {
    const left = rabbitsLeft();
    for (let i = marks.length - 1; i >= 0; i--) if (!left.some((l) => Math.hypot(l.x - marks[i].x, l.z - marks[i].z) < 1)) marks.splice(i, 1);
  });

  let inShop: ShopId | null = null, hinted = false, hintedCar = false;
  const api: DistrictApi = {
    name: 'district',
    get inShop() { return inShop; },
    get music() { return music; },
    get saved() { return save; },
    travelSpots: () => [{ label: t('travel.nanluo'), x: south.x, z: south.z }],
    travel: () => { void travel(); },
    debug: {
      shops: () => Object.fromEntries(SHOP_IDS.map((id) => [id, { door: W(SHOPS[id].door), counter: W(SHOPS[id].counter), keeper: !!keepers.find((k) => k.id === id)?.actor?.alive }])),
      walkers: () => walkers.length,
      save: () => save,
      open: (id) => openShop(id),
      buy: (id, i) => buy(id, CATALOG[id].items[i]),
      world: (bx, by) => world(bx, by),
    },
    fixedUpdate(dt) {
      clock += dt; danceT += dt;
      if (music.length) music[0].t = danceT;
      stepWalkers(dt);
      const P = pl.position, dist = Math.hypot(P.x - centre.x, P.z - centre.z);
      for (const k of keepers) {
        if (k.actor && !k.actor.alive) k.actor = null;
        if (dist < ON && !k.actor) keeperSpawn(k);
        else if (dist > OFF && k.actor) keeperDrop(k);
      }
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
      const cam = engine.get<CameraApi>('camera');
      const foot = pl.foot;
      const was = inShop;
      inShop = foot ? shopAt(foot.pos.x, foot.pos.z) : null;
      if (cam) cam.indoor = inShop && !photo ? 1 : 0;
      // into a shop: the keeper's welcome, the visit noted (all five: a prize)
      if (inShop && inShop !== was) {
        const k = keepers.find((q) => q.id === inShop);
        if (k?.actor?.alive) { k.actor.say(t(CATALOG[inShop].greet), 3.5); k.actor.act('wave', { t: 0 }); }
        if (!save.visited.includes(inShop)) {
          save.visited.push(inShop); store();
          if (save.visited.length === SHOP_IDS.length) { missions()?.addCash(ALL_VISITED); toast(t('nl.allVisited', { n: ALL_VISITED }), 4); }
        }
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
          if (Math.hypot(foot.pos.x - p.x, foot.pos.z - p.z) < 12) { hinted = true; toast(t('nl.hint'), 5); break; }
        }
      }
      // F at a counter, at the dance pad
      if (inShop) {
        const s = SHOPS[inShop], c = W(s.counter);
        if (Math.hypot(foot.pos.x - c.x, foot.pos.z - c.z) < COUNTER_R) {
          const id = inShop;
          pl.offer?.({ x: c.x, z: c.z, r: COUNTER_R, label: t('nl.offer', { shop: t(CATALOG[id].name) }), use: () => openShop(id) });
        }
        if (inShop === 'arcade' && s.pad) {
          const p = W(s.pad);
          if (Math.hypot(foot.pos.x - p.x, foot.pos.z - p.z) < 1.3) pl.offer?.({ x: p.x, z: p.z, r: 1.3, label: t('nl.offer.dance', { n: DANCE_PRICE }), use: () => startDance() });
        }
      }
    },
  };
  engine.add(api);
}

export type { ShopId } from './Shops';
