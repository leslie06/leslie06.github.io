import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { t } from '../core/I18n';
import type { Rng } from '../core/Rng';
import { CG, groups } from '../core/Physics';
import type { Actor, Blip, MissionApi, PeopleApi, PlayerApi, RenderApi } from '../game/Contracts';
import type { MusicSource } from '../audio/StreetMusic';
import { J, randomLook } from '../character/Body';
import type { LifeProps } from '../life/Props';
import type { RenderSystem } from '../render/RenderSystem';
import type { TravelApi } from '../travel';
import type { EstateApi, EstateId } from '../estate';
import { capOf, dailyOf, ESTATE_IDS, PROPERTIES, SAFEHOUSE_PRICE } from '../estate/Ledger';
import { hhWorld } from './Houhai';
import type { Row, ShopPanel } from './Panel';
import { CATALOG, priceOf, type Item } from './Shops';
import LAYOUT from './nanluo.layout.json';

type XY = [number, number];
type P = { x: number; z: number };
interface BarLayout { door: XY; inside: XY; room: [XY, XY]; seats: XY[]; stage: XY; stageFace: XY; counter: XY; keeper: XY; keeperFace: XY }
interface RoomLayout {
  door: XY; inside: XY; doorway: [XY, XY]; area: [XY, XY]; bed: XY; bedFace: XY; wardrobe: XY; wardrobeFace: XY; ledger: XY; ledgerFace: XY; camera: XY;
}
const HB = (LAYOUT as unknown as { hhbar: BarLayout }).hhbar;
const ROOM = (LAYOUT as unknown as { yard: { gate: XY; room: RoomLayout } }).yard.room;
const YARD_GATE = (LAYOUT as unknown as { yard: { gate: XY } }).yard.gate;
interface LaneShop { door: XY; counter: XY; keeper: XY; keeperFace: XY; stage?: XY; stageFace?: XY; seats?: XY[] }

/** What a raid needs from the lane's racket (district/index.ts): where, and the keeper to bring out. */
export interface RaidSpot { name: string; door: P; out: P; seed: number; estate: EstateId; dropKeeper?(): void }

export interface OwnedDeps {
  /** Lane (u, s) to world. */
  W(xy: XY): P;
  shops: { grill: LaneShop; bar: LaneShop };
  rnd: Rng;
  panel: ShopPanel;
  toast(s: string, secs?: number): void;
  after(secs: number, fn: () => void): void;
  shot(from: P, fy: number, at: P, ay: number, side: number, fov: number): void;
  unshot(): void;
  /** Sit at `at` facing `face`, back up to `out` when F stands you up; health back a second (the bar's seats'). */
  sit(at: P, face: P, out: P, line: string, cam?: P): void;
  /** The clothes shop's rows, only what is owned (the wardrobe). */
  wearRows(again: () => void): Row[];
  /** The lane's racket at a door: true if it began. */
  racket(spot: RaidSpot): boolean;
  /** The lane racket is on (a raid waits for it). */
  racketOn(): boolean;
}

export interface OwnedApi {
  /** The estate rows for the counter's panel of `id` (grill, bar, hhbar), after what it sells. */
  rows(id: EstateId, again: () => void): Row[];
  /** Food and drink are on the house in a place of one's own. */
  free(id: string): boolean;
  /** A seat of the lane bar's taken by a regular (the 装修 improvement). */
  taken(i: number): boolean;
  /** In 蓝莲花 or the 东厢房: indoors (the close camera), and no street encounter starts. */
  readonly indoor: boolean;
  readonly busy: boolean;
  fixedUpdate(dt: number): void;
  /** Each frame with the player's feet (null in a car, a seat, a boat): the F offers. */
  update(dt: number, foot: { pos: THREE.Vector3 } | null): void;
  /** Props in hands and on the ground, inside the lane's LifeProps begin/commit. */
  props(lp: LifeProps, m: THREE.Matrix4): void;
  music(out: MusicSource[], t: number): void;
  blips(out: Blip[]): void;
  debug: { bar(): BarLayout; room(): RoomLayout; actors(): Record<string, boolean>; rent(): string | null; points(): Record<string, P> };
}

const ON = 70, OFF = 100;
const R2 = (x: number, z: number, yaw: number): P => ({ x: x * Math.cos(yaw) + z * Math.sin(yaw), z: -x * Math.sin(yaw) + z * Math.cos(yaw) });
const yawTo = (a: P, b: P) => Math.atan2(b.x - a.x, b.z - a.z);
const dist = (a: P, b: P) => Math.hypot(a.x - b.x, a.z - b.z);
const yuan = (n: number) => `¥${Math.round(n).toLocaleString()}`;

/**
 * 产业和安全屋 in 南锣鼓巷 and 后海 (2026-11-04, docs/gta-plan.md §14; estate/ keeps the books):
 *   - the 「盘下 / 老板」 rows in the 烤串摊's, the 小酒馆's and 蓝莲花's panels (buy with a second tap, collect, improve);
 *   - what the improvements look like: a second grill and a lad calling out at the stall, an erhu player on the tavern's
 *     stage and its regulars in the seats, a singer on 蓝莲花's corner stage and its tables out front filled;
 *   - 蓝莲花 itself (nanluo.py's 后海 part: the one bar there you can go into): its barman, drinks, seats to sit in;
 *   - the 东厢房 in the courtyard: shut until rented (a door here, a collider), then a bed to sleep in, the wardrobe of
 *     what has been bought, the books on the desk, a 快速前往 spot;
 *   - 黑豹's raids (estate/ picks when): the lane's racket at the door, once the player is close enough to see it.
 */
export function installOwned(engine: Engine, d: OwnedDeps): OwnedApi {
  const pl = engine.get<PlayerApi>('player')!, people = engine.get<PeopleApi>('people')!;
  const estate = () => engine.get<EstateApi>('estate');
  const missions = () => engine.get<MissionApi>('missions');
  const near = (p: P, r: number) => dist(pl.position, p) < r;
  const H = (xy: XY) => hhWorld(xy[0], xy[1]);
  const doors: Record<EstateId, P> = { grill: d.W(d.shops.grill.door), bar: d.W(d.shops.bar.door), hhbar: H(HB.door) };
  for (const id of ESTATE_IDS) estate()?.register({ id, x: doors[id].x, z: doors[id].z });

  // --- the 「盘下 / 老板」 rows ---
  let confirm: EstateId | 'room' | null = null;
  const rows = (id: EstateId, again: () => void): Row[] => {
    const e = estate(), m = missions();
    if (!e) return [];
    const cash = m?.cash ?? 0, p = PROPERTIES[id];
    if (!e.owns(id)) {
      const short = cash < p.price, sure = confirm === id;
      return [{ section: t('est.sec.buy'), label: sure ? t('est.row.confirm') : t('est.row.buy', { name: t(p.name) }), detail: t('est.row.buyD', { n: yuan(p.income) }), on: sure,
        price: short ? t('nl.panel.short', { n: p.price - cash }) : yuan(p.price), disabled: short,
        buy: () => {
          if (confirm !== id) { confirm = id; again(); return; }
          confirm = null;
          const why = e.buy(id);
          if (why) d.toast(why, 2.5);
          again();
        } }];
    }
    const h = e.saved.owned[id]!, till = e.till(id);
    const out: Row[] = [{ section: t('est.sec.owner'), label: t('est.row.collect'), detail: t('est.row.collectD', { n: yuan(till), cap: yuan(capOf(id, h)) }),
      price: till >= 1 ? yuan(till) : t('est.row.nothing'), disabled: till < 1,
      buy: () => { const n = e.collect(id); if (n) d.toast(t('est.collected', { name: t(p.name), n: yuan(n) }), 3); again(); } }];
    for (const u of p.ups) {
      const done = h.ups.includes(u.id), short = !done && cash < u.price;
      out.push({ label: t(u.name), detail: t('est.row.upD', { detail: t(u.detail), n: yuan(u.income) }), on: done, disabled: done || short,
        price: done ? t('est.row.upDone') : short ? t('nl.panel.short', { n: u.price - cash }) : yuan(u.price),
        buy: () => { const why = e.upgrade(id, u.id); if (why) d.toast(why, 2.5); again(); } });
    }
    return out;
  };
  const free = (id: string) => (ESTATE_IDS as readonly string[]).includes(id) && !!estate()?.owns(id as EstateId);
  const has = (id: EstateId, up: string) => !!estate()?.has(id, up);

  /** The property 黑豹's men are at now (its keeper is out at the door with them). */
  let raiding: EstateId | null = null;

  // --- the people the improvements bring: each spawned near, dropped far (actor slots run out: null is fine) ---
  interface Cast { key: string; at: P; face: P; want(): boolean; pose(a: Actor): void; actor: Actor | null; look?: () => ReturnType<typeof randomLook>; seed: number }
  const cast: Cast[] = [];
  const add = (c: Omit<Cast, 'actor'>) => cast.push({ ...c, actor: null });
  const g = d.shops.grill, bar = d.shops.bar;
  // the lad at the stall: grilling beside the keeper, calling out now and then
  const gk = d.W(g.keeper), gf = d.W(g.keeperFace), gside = R2(1.25, 0, yawTo(gk, gf));
  const handAt = { x: gk.x + gside.x, z: gk.z + gside.z };
  add({ key: 'hand', at: handAt, face: { x: gf.x + gside.x, z: gf.z + gside.z }, want: () => has('grill', 'hand'), pose: (a) => a.act('cook'), seed: 6101 });
  const stoveAt = { x: gk.x - gside.x * 1.1, z: gk.z - gside.z * 1.1 }, stoveYaw = yawTo(gk, gf);
  // the erhu beside the tavern's singer, the regulars in its seats
  const stage = bar.stage ? d.W(bar.stage) : d.W(bar.door), stageFace = bar.stageFace ? d.W(bar.stageFace) : stage;
  const eo = R2(-1.1, 0.2, yawTo(stage, stageFace));
  const erhuAt = { x: stage.x + eo.x, z: stage.z + eo.z };
  add({ key: 'erhu', at: erhuAt, face: stageFace, want: () => has('bar', 'erhu'), pose: (a) => a.act('erhu', { seat: 0.46 }), seed: 6203,
    look: () => { const l = randomLook(() => d.rnd.next()); l.fem = 0; l.age = 0.8; l.cap = null; l.mask = null; return l; } });
  const REGULARS = [1, 2, 5];
  for (const i of REGULARS) {
    const s = bar.seats?.[i];
    if (s) add({ key: `reg${i}`, at: d.W(s), face: stage, want: () => has('bar', 'decor'), pose: (a) => a.act(i % 2 ? 'drink' : 'sit', { seat: 0.46, t: i * 1.7 }), seed: 6300 + i });
  }
  // 蓝莲花: its barman always; the singer, the tables out front with the improvements
  const hbStage = H(HB.stage), hbFace = H(HB.stageFace);
  add({ key: 'barman', at: H(HB.keeper), face: H(HB.keeperFace), want: () => true, pose: (a) => a.act(null), seed: 6401 });
  add({ key: 'hbsinger', at: hbStage, face: hbFace, want: () => has('hhbar', 'singer'), pose: (a) => a.act('strum', { seat: 0.46 }), seed: 6402,
    look: () => { const l = randomLook(() => d.rnd.next()); l.fem = 1; l.age = 0.3; l.hairStyle = 'long'; l.cap = null; l.mask = null; return l; } });
  // two tables on the pavement before 蓝莲花 (props: life/'s table and stools), two at each
  const tables = [39.4, 43.0].map((s) => ({ c: hhWorld(-4.1, s), a: hhWorld(-4.1, s - 0.68), b: hhWorld(-4.1, s + 0.68) }));
  tables.forEach((tb, k) => {
    for (const [j, at] of [tb.a, tb.b].entries()) add({ key: `ter${k}${j}`, at, face: tb.c, want: () => has('hhbar', 'terrace'), pose: (a) => a.act(j ? 'drink' : 'sit', { seat: 0.46, t: k * 2 + j }), seed: 6500 + k * 2 + j });
  });
  const castStep = () => {
    const lite = engine.lite;
    for (const c of cast) {
      if (c.actor && !c.actor.alive) c.actor = null;
      const want = c.want() && (!lite || c.key === 'barman' || c.key === 'hand' || c.key === 'hbsinger' || c.key === 'erhu');
      if (!c.actor && want && near(c.at, ON) && !outForRaid(c.key)) {
        const a = people.spawnActor?.(c.at.x, c.at.z, { yaw: yawTo(c.at, c.face), seed: c.seed, ...(c.look ? { look: c.look() } : {}) }) ?? null;
        if (a) { a.stop(); a.face(c.face.x, c.face.z); c.pose(a); c.actor = a; }
      } else if (c.actor && (!want || !near(c.at, OFF) || outForRaid(c.key))) { c.actor.release('vanish'); c.actor = null; }
    }
  };
  const actorOf = (key: string) => cast.find((c) => c.key === key)?.actor ?? null;
  /** The barman steps out for a raid on 蓝莲花: not at the counter meanwhile. */
  const outForRaid = (key: string) => key === 'barman' && raiding === 'hhbar';

  // --- 蓝莲花's inside: its counter's panel, its seats ---
  const hbRoom = (() => { const [a, b] = HB.room; return { u0: Math.min(a[0], b[0]), u1: Math.max(a[0], b[0]), s0: Math.min(a[1], b[1]), s1: Math.max(a[1], b[1]) }; })();
  const hhLocal = (x: number, z: number): XY => {
    // the inverse of hhWorld (a rotation and a translation)
    const o = hhWorld(0, 0), ex = hhWorld(1, 0), es = hhWorld(0, 1), dx = x - o.x, dz = z - o.z;
    return [dx * (ex.x - o.x) + dz * (ex.z - o.z), dx * (es.x - o.x) + dz * (es.z - o.z)];
  };
  const inBar = (x: number, z: number) => { const [u, s] = hhLocal(x, z); return u > hbRoom.u0 && u < hbRoom.u1 && s > hbRoom.s0 && s < hbRoom.s1; };
  const hbCounter = H(HB.counter), hbDoor = H(HB.door);
  const DRINKS: readonly Item[] = CATALOG.bar.items;
  const openHb = () => {
    const m = missions(), cash = m?.cash ?? 0, own = free('hhbar');
    const again = () => { if (d.panel.open) openHb(); };
    const list: Row[] = DRINKS.map((it, i) => {
      const price = own ? 0 : priceOf(it, false), short = cash < price, full = pl.health >= 100;
      return { section: i === 0 ? t('nl.sec.drinks') : undefined, label: t(it.name), detail: t('nl.eff.heal', { n: it.heal ?? 0 }), disabled: short || full,
        price: full ? t('nl.panel.full') : short ? t('nl.panel.short', { n: price - cash }) : own ? t('est.free') : `¥${price}`,
        buy: () => {
          const mm = missions();
          if (!mm || mm.cash < price || pl.health >= 100) return;
          if (price) mm.addCash(-price);
          pl.heal(it.heal ?? 0);
          engine.events.emit('district:buy', { shop: 'hhbar', item: it.id, price });
          d.toast(t('nl.bought', { item: t(it.name), n: price }), 2);
          const a = actorOf('barman'); if (a?.alive) { a.say(t('nl.thanks'), 2.5); a.act('talk', { t: 0 }); }
          again();
        } };
    });
    d.panel.render(t('est.hhbar'), own ? t('est.greetOwner') : t('est.hh.greet'), cash, [...list, ...rows('hhbar', again)], () => { confirm = null; });
    actorOf('barman')?.act('talk', { t: 0 });
  };
  const hbSeats = HB.seats.map((s) => H(s));
  const sitHb = (i: number) => {
    const at = hbSeats[i], face = has('hhbar', 'singer') ? hbStage : hbCounter;
    // the camera inside the door, across the room at the seat (behind a seat by the wall is the wall)
    d.sit(at, face, { x: at.x + (hbCounter.x - at.x) * 0.25, z: at.z + (hbCounter.z - at.z) * 0.25 }, t('nl.listen'), H([HB.inside[0] + 0.4, HB.inside[1]]));
  };

  // --- the 东厢房: shut until rented, then the bed, the wardrobe, the books ---
  const rm = {
    door: d.W(ROOM.door), inside: d.W(ROOM.inside), a: d.W(ROOM.doorway[0]), b: d.W(ROOM.doorway[1]), bed: d.W(ROOM.bed), bedFace: d.W(ROOM.bedFace),
    wardrobe: d.W(ROOM.wardrobe), wardrobeFace: d.W(ROOM.wardrobeFace), ledger: d.W(ROOM.ledger), ledgerFace: d.W(ROOM.ledgerFace), camera: d.W(ROOM.camera),
  };
  const area = (() => { const p = ROOM.area; return { u0: Math.min(p[0][0], p[1][0]), u1: Math.max(p[0][0], p[1][0]), s0: Math.min(p[0][1], p[1][1]), s1: Math.max(p[0][1], p[1][1]) }; })();
  // the shut door: two red leaves across the doorway, and a collider, until the room is rented
  const shut = new THREE.Group();
  shut.name = 'nl-roomdoor';
  const leafMat = new THREE.MeshStandardMaterial({ color: 0x8e2219, roughness: 0.5 });
  const dw = dist(rm.a, rm.b), mid = { x: (rm.a.x + rm.b.x) / 2, z: (rm.a.z + rm.b.z) / 2 }, along = Math.atan2(rm.b.x - rm.a.x, rm.b.z - rm.a.z);
  for (const s of [-1, 1]) {
    const leaf = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.18, dw / 2 - 0.02), leafMat);
    leaf.position.set(0, 1.2, s * dw / 4);
    shut.add(leaf);
  }
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.05, 0.012, 6, 12), new THREE.MeshStandardMaterial({ color: 0xc49a3c, metalness: 0.8, roughness: 0.35 }));
  ring.position.set(-0.05, 1.15, 0); ring.rotation.y = Math.PI / 2;
  shut.add(ring);
  shut.position.set(mid.x, 0, mid.z);
  shut.rotation.y = along;
  engine.scene.add(shut);
  queueMicrotask(() => engine.get<RenderSystem>('render')?.prepare?.(shut));
  const { R, world } = engine.physics;
  const doorBody = world.createRigidBody(R.RigidBodyDesc.fixed().setTranslation(mid.x, 1.2, mid.z).setRotation({ x: 0, y: Math.sin(along / 2), z: 0, w: Math.cos(along / 2) }));
  const doorCol = world.createCollider(R.ColliderDesc.cuboid(0.08, 1.2, dw / 2).setCollisionGroups(groups(CG.WORLD, CG.ALL)), doorBody);
  const rented = () => !!estate()?.safehouse;
  const fitDoor = () => { const open = rented(); shut.visible = !open; doorCol.setEnabled(!open); };
  fitDoor();
  // the room's rectangle by three of its corners (lane coordinates: W turns them with the stretch)
  const ra = d.W([area.u0, area.s0]), rc = d.W([area.u1, area.s0]), rb = d.W([area.u1, area.s1]);
  const eu = { x: rc.x - ra.x, z: rc.z - ra.z }, es = { x: rb.x - rc.x, z: rb.z - rc.z };
  const inRoom = (x: number, z: number) => {
    if (!rented()) return false;
    const px = x - ra.x, pz = z - ra.z;
    const ku = (px * eu.x + pz * eu.z) / (eu.x * eu.x + eu.z * eu.z), ks = (px * es.x + pz * es.z) / (es.x * es.x + es.z * es.z);
    return ku > 0 && ku < 1 && ks > 0 && ks < 1;
  };
  const rentPanel = () => {
    const m = missions(), cash = m?.cash ?? 0, short = cash < SAFEHOUSE_PRICE, sure = confirm === 'room';
    d.panel.render(t('est.room.title'), t('est.room.greet'), cash, [{
      label: sure ? t('est.row.confirm') : t('est.room.offer', { n: yuan(SAFEHOUSE_PRICE) }), detail: t('est.room.d'), on: sure, disabled: short,
      price: short ? t('nl.panel.short', { n: SAFEHOUSE_PRICE - cash }) : yuan(SAFEHOUSE_PRICE),
      buy: () => {
        if (confirm !== 'room') { confirm = 'room'; rentPanel(); return; }
        confirm = null;
        const e = estate();
        if (!e) return;
        const why = e.rentSafehouse();
        d.panel.close();
        if (why) { d.toast(why, 2.5); return; }
        fitDoor(); registerTravel();
        d.toast(t('est.room.rented'), 6);
      } }], () => { confirm = null; });
  };
  const openWardrobe = () => {
    // the camera in front of the player, the sheet at the left (the clothes shop's mirror does the same)
    const at = rm.wardrobe, face = rm.wardrobeFace, back = yawTo(face, at);
    pl.setRiding(null, { x: at.x, y: 0.2, z: at.z, yaw: back });
    const cam = { x: at.x + Math.sin(back) * 2.1, z: at.z + Math.cos(back) * 2.1 };
    d.shot(cam, 1.45, at, 1.15, 0.45, 50);
    const again = () => { if (!d.panel.render(t('est.wardrobe.title'), t('est.wardrobe.greet'), missions()?.cash ?? 0, d.wearRows(again), () => d.unshot(), true)) d.unshot(); };
    d.after(0.35, again);
  };
  const openLedger = () => {
    const e = estate();
    if (!e) return;
    const list: Row[] = ESTATE_IDS.map((id) => {
      const h = e.saved.owned[id], p = PROPERTIES[id];
      if (!h) return { label: t(p.name), detail: t('est.ledger.sale', { n: yuan(p.price) }), price: '', disabled: true, buy: () => {} };
      const ups = h.ups.length ? t('est.ledger.ups', { n: h.ups.length }) : '';
      const raid = e.raid?.id === id ? t('est.ledger.raid') : '';
      return { label: t(p.name), detail: t('est.ledger.rowD', { day: yuan(dailyOf(id, h)), till: yuan(h.till), cap: yuan(capOf(id, h)), ups }) + raid,
        price: yuan(h.till), on: true, disabled: false, buy: () => {} };
    });
    const owned = ESTATE_IDS.some((id) => e.owns(id));
    d.panel.render(t('est.ledger.title'), owned ? t('est.ledger.total', { n: yuan(e.saved.earned) }) : t('est.ledger.none'), missions()?.cash ?? 0, list);
  };
  const sleep = () => {
    const why = estate()?.sleep();
    if (why) d.toast(why, 3);
  };
  // 快速前往: the courtyard once it is yours (the home group: on foot at its gate; a car on 东棉花胡同 by the lane)
  let registered = false;
  const registerTravel = () => {
    const tr = engine.get<TravelApi>('travel');
    if (!tr || registered || !rented()) return;
    registered = true;
    const gate = d.W(YARD_GATE), lane = d.W([0, YARD_GATE[1]]), road = d.W([16, 221.2]);
    tr.register({ id: 'yard', group: 'home', label: 'travel.yard', x: gate.x, z: gate.z, go: () => {
      void tr.land({ foot: { x: lane.x, z: lane.z, yaw: yawTo(lane, gate) }, road: { x: road.x, z: road.z, yaw: 0 }, caption: t('travel.yardArrived'), footCaption: t('travel.yardArrivedFoot') });
    } });
  };
  registerTravel();
  engine.events.on('game:start', () => { fitDoor(); registerTravel(); });

  // --- 黑豹's raids: the lane's racket at the door once the player is near enough to see it ---
  const RAID_NEAR = 60;
  const spotOf = (id: EstateId): RaidSpot => {
    if (id === 'hhbar') {
      const dr = hbDoor, o = H([HB.door[0] + 1, HB.door[1]]);
      return { name: t('est.hhbar'), door: dr, out: { x: o.x - dr.x, z: o.z - dr.z }, seed: 6401, estate: id, dropKeeper: () => { const c = cast.find((q) => q.key === 'barman'); c?.actor?.release('vanish'); if (c) c.actor = null; } };
    }
    const s = d.shops[id], dr = d.W(s.door), side = s.door[0] > 0 ? 1 : -1, o = d.W([s.door[0] - side, s.door[1]]);
    return { name: t(CATALOG[id].name), door: dr, out: { x: o.x - dr.x, z: o.z - dr.z }, seed: 911 + (id === 'grill' ? 8 : 7) * 37, estate: id };
  };
  engine.events.on('estate:raidOver', () => { raiding = null; });

  let stoveSmoke = 0, barkT = 12;
  const fx = () => engine.get<{ name: string; smoke(x: number, y: number, z: number, vx: number, vy: number, vz: number, size: number, life: number, shade?: number): void }>('fx');
  let indoor = false;
  const api: OwnedApi = {
    rows, free,
    taken: (i) => has('bar', 'decor') && REGULARS.includes(i),
    get indoor() { return indoor; },
    get busy() { return indoor; },
    fixedUpdate(dt) {
      castStep();
      const r = estate()?.raid;
      if (r && !r.fighting && !raiding && !d.racketOn() && near(doors[r.id], RAID_NEAR) && pl.mode === 'onfoot') {
        if (d.racket(spotOf(r.id))) { raiding = r.id; estate()?.raidFight(); }
      }
      // the second grill's smoke, the lad calling out
      if (has('grill', 'stove') && near(stoveAt, 70) && (stoveSmoke -= dt) <= 0) {
        stoveSmoke = 0.3;
        fx()?.smoke(stoveAt.x + (d.rnd.next() - 0.5) * 0.5, 1.15, stoveAt.z + (d.rnd.next() - 0.5) * 0.3, 0, 0.6, 0, 0.45, 2.6, 0.18);
      }
      const hand = actorOf('hand');
      if (hand?.alive && (barkT -= dt) <= 0) { barkT = 18 + d.rnd.next() * 10; if (near(handAt, 12)) hand.say(t('est.hand.bark'), 3); }
      if (!pl.foot && indoor) indoor = false;
    },
    update(_dt, foot) {
      if (!foot) { indoor = false; return; }
      const p = foot.pos;
      const inHb = inBar(p.x, p.z), inRm = inRoom(p.x, p.z);
      indoor = inHb || inRm;
      // 蓝莲花: the counter, the seats
      if (inHb) {
        if (dist(p, hbCounter) < 1.6) pl.offer?.({ x: hbCounter.x, z: hbCounter.z, r: 1.6, label: t('nl.offer', { shop: t('est.hhbar') }), use: openHb });
        hbSeats.forEach((s, i) => { if (dist(p, s) < 0.95) pl.offer?.({ x: s.x, z: s.z, r: 0.95, label: t('nl.offer.seat'), use: () => sitHb(i) }); });
      }
      // the 东厢房: its door (shut: rent it), then what is inside
      if (!rented()) {
        if (dist(p, rm.door) < 1.8) pl.offer?.({ x: rm.door.x, z: rm.door.z, r: 1.8, label: t('est.room.offer', { n: yuan(SAFEHOUSE_PRICE) }), use: rentPanel });
      } else if (inRm) {
        if (dist(p, rm.bed) < 1.3) pl.offer?.({ x: rm.bed.x, z: rm.bed.z, r: 1.3, label: t('est.offer.bed'), use: sleep });
        if (dist(p, rm.wardrobe) < 1.2) pl.offer?.({ x: rm.wardrobe.x, z: rm.wardrobe.z, r: 1.2, label: t('est.offer.wardrobe'), use: openWardrobe });
        if (dist(p, rm.ledger) < 1.2) pl.offer?.({ x: rm.ledger.x, z: rm.ledger.z, r: 1.2, label: t('est.offer.ledger'), use: openLedger });
      }
    },
    props(lp, m) {
      // the second grill; the erhu and its bow in the player's hands; the singer's guitar; the tables out front
      if (has('grill', 'stove') && near(stoveAt, ON)) lp.place('grill', stoveAt.x, 0.045, stoveAt.z, stoveYaw);
      const v = new THREE.Vector3();
      const e = actorOf('erhu');
      if (e?.alive) {
        const fy = e.yaw;
        e.joint(J.pelvis, m); v.setFromMatrixPosition(m);
        const o = R2(0.06, 0.32, fy);
        lp.place('erhu', v.x + o.x, v.y + 0.02, v.z + o.z, fy);
        e.joint(J.wristR, m); v.setFromMatrixPosition(m);
        lp.place('bow', v.x, v.y, v.z, fy + Math.PI);
        lp.place('stool', erhuAt.x, 0.03, erhuAt.z, fy);
      }
      const s = actorOf('hbsinger');
      if (s?.alive) {
        const fy = s.yaw;
        s.joint(J.chest, m); v.setFromMatrixPosition(m);
        const o = R2(0, 0.2, fy);
        m.compose(v.set(v.x + o.x, v.y - 0.3, v.z + o.z), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, fy, 0.35, 'YXZ')), new THREE.Vector3(1, 1, 1));
        lp.add('guitar', m);
      }
      if (has('hhbar', 'terrace') && near(tables[0].c, ON)) {
        for (const tb of tables) {
          const yaw = yawTo(tb.a, tb.b);
          lp.place('table', tb.c.x, 0.03, tb.c.z, yaw);
          lp.place('stool', tb.a.x, 0.03, tb.a.z, yaw);
          lp.place('stool', tb.b.x, 0.03, tb.b.z, yaw);
        }
      }
    },
    music(out, time) {
      if (actorOf('hbsinger')?.alive) out.push({ id: 'hh-bar', kind: 'ballad', x: hbStage.x, z: hbStage.z, t: time, song: 2 });
    },
    blips(out) {
      if (rented()) out.push({ kind: 'safehouse', x: rm.door.x, z: rm.door.z, label: t('travel.yard') });
    },
    debug: {
      bar: () => HB, room: () => ROOM,
      actors: () => Object.fromEntries(cast.map((c) => [c.key, !!c.actor?.alive])),
      points: () => ({ door: hbDoor, out: H([HB.door[0] + 3, HB.door[1]]), counter: hbCounter, seat: hbSeats[0], terraceView: H([0.5, 36.5]) }),
      rent: () => { const e = estate(); const why = e ? e.rentSafehouse() : 'no estate'; if (!why) { fitDoor(); registerTravel(); } return why; },
    },
  };
  return api;
}

