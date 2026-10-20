import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { t, type TKey } from '../core/I18n';
import { Rng } from '../core/Rng';
import type { Actor, AdventureApi, Blip, CarLook, DialogueApi, HudApi, MissionApi, PeopleApi, PlayerApi, Speaker, VehicleApi, WorldApi } from '../game/Contracts';
import type { TrafficApi } from '../traffic';
import type { NavSystem } from '../nav';
import type { ContactsApi } from '../contacts';
import { crashDamage, type DamageApi } from '../damage';
import type { StoryApi } from '../story';
import type { CampaignApi } from '../campaign';
import { Vehicle } from '../vehicle/Vehicle';
import { TAXI } from '../vehicle/Spec';
import { ControlFilter } from '../vehicle/ControlFilter';
import { CarKit } from '../traffic/CarKit';
import { Pursuit } from '../police/Pursuit';
import { nearestKerb } from '../people/Pavement';
import { clearOfWorld } from '../life/Props';
import { pickAddress } from '../missions/Address';
import { Gait } from '../character/Animator';
import { J, SKELETON, randomLook } from '../character/Body';
import { NearbyPanel, type Action } from './Panel';
import { borrow, fresh, giveBack, isActive, keep, nextCheckpoint, restore, secure, type Layout, type Method, type Save, type Spot } from './State';

const STORE = 'drivecity.adventure.fly07.v1';
const LIVERY = { upper: '#9639d9', lower: '#151722', roofSign: null, plate: { text: '京N·FLY07', bg: '#1d49b5', fg: '#fff' }, doorText: 'FLY-07', doorColor: '#f8df53' };
const HOLD = { throttle: 0, brake: 1, steer: 0, handbrake: true, reverse: false, burnout: false };
interface Race { points: { x: number; z: number }[]; me: number; rival: number; countdown: number; running: boolean; elapsed: number }
interface Companion { mode: 'base' | 'follow' | 'ride' | 'work'; car: Vehicle | null; work: number; blocked: number }

export async function install(engine: Engine): Promise<void> {
  const query = new URLSearchParams(location.search);
  if (query.get('adventure') === '0' || query.has('shot') && query.get('adventure') !== '1') return;
  const tr = engine.get<TrafficApi>('traffic'), nav = engine.get<NavSystem>('nav');
  const pl = engine.get<PlayerApi>('player'), people = engine.get<PeopleApi>('people'), contacts = engine.get<ContactsApi>('contacts');
  const world = engine.get<WorldApi>('world');
  if (!tr || !nav || !pl || !people?.spawnActor || !contacts || !world) return;
  const rng = new Rng(1047), random = () => rng.next();
  const v = () => engine.get<VehicleApi>('vehicle')!;
  const damage = () => engine.get<DamageApi>('damage')!;
  const dialogue = () => engine.get<DialogueApi>('dialogue');
  const toast = (key: TKey, params?: Record<string, string | number>) => engine.get<HudApi>('hud')?.toast(t(key, params));
  let state: Save;
  try { state = restore(query.has('shot') && query.get('save') !== '1' ? null : localStorage.getItem(STORE)); } catch { state = fresh(); }
  const roadside = (point: { x: number; z: number }): Spot => {
    const k = nearestKerb(tr.graph, point.x, point.z, 30, 1);
    return k ? { x: k.x - k.side * k.dz * 1.5, z: k.z + k.side * k.dx * 1.5, yaw: Math.atan2(k.dx, k.dz) } : { ...point, yaw: 0 };
  };
  const makeLayout = (): Layout | null => {
    const p = world.spawn, g = tr.graph, at = { x: 0, z: 0, dx: 0, dz: 0 };
    const candidates = g.near(p.x, p.z, 150).map(id => g.links[id]).filter(l => l.len > 50 && l.hmax < .3 && !['motorway', 'motorway_link'].includes(l.cls));
    candidates.sort((a, b) => g.project(a, p.x, p.z, a.len / 2).d - g.project(b, p.x, p.z, b.len / 2).d);
    const road = candidates[0]; if (!road) return null;
    const projection = g.project(road, p.x, p.z, road.len / 2);
    const s = Math.min(road.len - 10, projection.s + 65);
    g.at(road, s, g.laneOffset(road, 0), at);
    const source = { x: at.x, z: at.z, yaw: Math.atan2(at.dx, at.dz) };
    const parking = pickAddress(g, nav, random, source.x, source.z, 230, 600, [], 60, true)
      ?? pickAddress(g, nav, random, source.x, source.z, 180, 420, [], 60, false);
    const garage = pickAddress(g, nav, random, source.x, source.z, 70, 250, parking ? [parking] : [], 60, false);
    if (!parking || !garage) return null;
    const finish = pickAddress(g, nav, random, parking.x, parking.z, 500, 1100, [], 100, true) ?? source;
    const result = { source, parking: roadside(parking), garage: roadside(garage), finish: roadside(finish) };
    return nav.route(source.x, source.z, source.yaw, result.parking.x, result.parking.z) && nav.route(result.parking.x, result.parking.z, NaN, result.finish.x, result.finish.z) ? result : null;
  };
  state.layout ??= makeLayout();
  if (!state.layout) { console.warn('[adventure] no connected streets for the encounter'); return; }
  const layout = state.layout;
  // Streaming has one shared camera/focus pin: preloads must never run concurrently.
  await world.preload?.(layout.source.x, layout.source.z);
  const car = new Vehicle(engine.physics, TAXI, { x: 0, y: -700, z: 0 }, 0);
  car.body.setEnabled(false); car.tune.torque = 1.18; car.tune.grip = 1.08; car.tune.nitro = 1;
  const kit = new CarKit(engine.scene, 1, LIVERY), filter = new ControlFilter(), driver = new Pursuit();
  const look: CarLook = { upper: new THREE.Color(LIVERY.upper), lower: new THREE.Color(LIVERY.lower), taxi: false, body: 'sedan', parked: true, livery: LIVERY };
  const previous = new THREE.Vector3(), current = new THREE.Vector3(), pq = new THREE.Quaternion(), cq = new THREE.Quaternion(), rendered = new THREE.Vector3(), rq = new THREE.Quaternion();
  let initialized = false, started = false, clock = 0, saveClock = 0, lastDamage = -10;
  let closeTime = 0, stopped = 0, motionStall = 0, alert = 0, parkingNotified = false, pendingMethod: Method = 'tail';
  let race: Race | null = null, returningToYard = false, repairRequested = false;
  let lastObjective: string | null = null;
  let previousCar: Vehicle | null = null;
  const companion: Companion = { mode: 'base', car: null, work: 0, blocked: 0 };
  let owner: Actor | null = null, mechanic: Actor | null = null, culprit: Actor | null = null;
  const culpritLook = randomLook(random), ownerLook = contacts.appearance('feilong'), mechanicLook = contacts.appearance('daliu');
  const gait = new Gait(), seated = new THREE.Vector3(), forward = new THREE.Vector3();
  const keySpot = new THREE.Vector3(), paperSpot = roadside(layout.source), mechanicBase = roadside(layout.garage);
  paperSpot.x += Math.cos(paperSpot.yaw) * 3; paperSpot.z -= Math.sin(paperSpot.yaw) * 3;
  mechanicBase.x += Math.cos(mechanicBase.yaw) * 3; mechanicBase.z -= Math.sin(mechanicBase.yaw) * 3;
  const panel = new NearbyPanel(engine);
  const dist = (a: { x: number; z: number }, b: { x: number; z: number }) => Math.hypot(a.x - b.x, a.z - b.z);
  const persist = () => {
    if (!initialized || query.has('shot') && query.get('save') !== '1') return;
    state.pose = { x: car.pos.x, z: car.pos.z, yaw: Math.atan2(car.fwd.x, car.fwd.z) };
    state.condition = damage().health(car);
    state.returning = returningToYard;
    try { localStorage.setItem(STORE, JSON.stringify(state)); } catch { /* Play remains possible without storage. */ }
  };
  const placeKeys = () => {
    for (const [side, front] of [[3.2, 0], [-3.2, 0], [0, -3.8], [0, 3.8], [3.2, -3], [-3.2, -3]]) {
      const x = car.pos.x + car.left.x * side + car.fwd.x * front, z = car.pos.z + car.left.z * side + car.fwd.z * front;
      if (clearOfWorld(engine.physics, x, z, 0, .35, .35)) { keySpot.set(x, .7, z); return; }
    }
    keySpot.copy(car.pos).addScaledVector(car.left, 3.2); keySpot.y = .7;
  };
  const setPose = (p: Spot) => {
    car.body.setEnabled(true); car.reset({ x: p.x, y: .03 + car.spec.wheelRadius + .12, z: p.z }, p.yaw);
    previous.copy(car.pos); current.copy(car.pos); pq.copy(car.quat); cq.copy(car.quat); filter.reset(); driver.reset();
    placeKeys();
  };
  const target = (p: { x: number; z: number }, key: TKey) => nav.setTarget({ x: p.x, z: p.z, kind: 'mission', label: t(key) });
  const speaker = (kind: 'owner' | 'mechanic' | 'driver'): Speaker => {
    const a = kind === 'owner' ? owner : kind === 'mechanic' ? mechanic : culprit;
    return { name: t(kind === 'owner' ? 'con.who.feilong' : kind === 'mechanic' ? 'who.daliu' : 'adv.driver'), color: kind === 'mechanic' ? '#ff6b5a' : '#c78bff', look: kind === 'owner' ? ownerLook : kind === 'mechanic' ? mechanicLook : culpritLook, at: a?.pos };
  };
  const groundObject = (color: string, size: [number, number, number]) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), new THREE.MeshStandardMaterial({ color, roughness: .55 }));
    mesh.castShadow = true; engine.scene.add(mesh); return mesh;
  };
  const paper = groundObject('#fff1bd', [.55, .06, .4]); paper.position.set(paperSpot.x, .12, paperSpot.z);
  const keys = new THREE.Group();
  const ring = new THREE.Mesh(new THREE.TorusGeometry(.12, .035, 6, 12), new THREE.MeshStandardMaterial({ color: '#ffc94a', metalness: .7, roughness: .3 }));
  const stem = new THREE.Mesh(new THREE.BoxGeometry(.06, .3, .05), ring.material); stem.position.y = -.24; keys.add(ring, stem); engine.scene.add(keys);
  const tool = new THREE.Group(), box = groundObject('#eb7436', [.55, .3, .28]); engine.scene.remove(box); tool.add(box);
  const handle = new THREE.Mesh(new THREE.TorusGeometry(.11, .025, 6, 12, Math.PI), new THREE.MeshStandardMaterial({ color: '#292d35' })); handle.position.y = .18; tool.add(handle); engine.scene.add(tool);
  const makeSign = (label: string, p: Spot, color: string) => {
    const canvas = document.createElement('canvas'); canvas.width = 512; canvas.height = 128;
    const c = canvas.getContext('2d')!; c.fillStyle = '#111923'; c.fillRect(0, 0, 512, 128); c.strokeStyle = color; c.lineWidth = 8; c.strokeRect(4, 4, 504, 120);
    c.fillStyle = color; c.font = 'bold 42px "PingFang SC", sans-serif'; c.textAlign = 'center'; c.fillText(label, 256, 80);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(canvas) })); sprite.position.set(p.x, 3.5, p.z); sprite.scale.set(6, 1.5, 1); engine.scene.add(sprite); return sprite;
  };
  const garageSign = makeSign(t('adv.garage'), mechanicBase, '#ffae65'), yardSign = makeSign(t('adv.parking'), layout.parking, '#c78bff');
  const goalRing = new THREE.Mesh(new THREE.TorusGeometry(3, .08, 6, 32), new THREE.MeshBasicMaterial({ color: '#ffd14c' })); goalRing.rotation.x = -Math.PI / 2; goalRing.visible = false; engine.scene.add(goalRing);
  const paperRing = new THREE.Mesh(new THREE.TorusGeometry(.55, .035, 6, 24), new THREE.MeshBasicMaterial({ color: '#ffd14c' })); paperRing.rotation.x = -Math.PI / 2; paperRing.position.set(paperSpot.x, .08, paperSpot.z); engine.scene.add(paperRing);
  const toolMatrix = new THREE.Matrix4(), carryPoint = new THREE.Vector3();

  const park = (method: Method = 'tail') => {
    state.phase = 'parked'; state.method = pendingMethod = method; returningToYard = false; driver.reset(); filter.reset();
    placeKeys();
    if (method === 'intercept') toast('adv.intercepted'); else if (!parkingNotified) { toast('adv.found'); parkingNotified = true; }
    if (method !== 'tail') target(car.pos, 'adv.title');
    persist();
  };
  const busy = () => {
    const heist = engine.get<StoryApi>('story')?.heist;
    return !!(engine.get<MissionApi>('missions')?.busy || heist && heist !== 'off'
      || engine.get<{ name: string; active: boolean }>('races')?.active
      || engine.get<{ name: string; active: unknown }>('npc')?.active
      || engine.get<{ name: string; active: unknown }>('events')?.active
      || engine.get<CampaignApi>('campaign')?.running);
  };
  const start = () => {
    if (state.phase === 'returned' || state.phase === 'borrowed') return;
    if (busy()) { toast('adv.busy'); return; }
    const m = engine.get<MissionApi>('missions');
    state.tracking = true;
    if (state.phase === 'available') { state.phase = 'search'; driver.reset(); closeTime = stopped = 0; car.setMoving(8); owner?.say(t('adv.shout'), 6, t('con.who.feilong')); toast('adv.tailTip'); }
    if (m) m.story = lastObjective = t('adv.search');
    target(state.keys ? layout.garage : state.informed ? layout.parking : layout.source, state.keys ? 'adv.garage' : state.informed ? 'adv.parking' : 'adv.source'); persist();
  };
  const inspect = () => { if (!state.clue) { state.clue = true; toast('adv.clueFound'); persist(); } dialogue()?.say(speaker('owner'), t('adv.inspectText'), { prio: 3 }); };
  const inform = () => { state.informed = true; target(layout.parking, 'adv.parking'); dialogue()?.say(speaker('mechanic'), t('adv.info'), { prio: 3 }); persist(); };
  const takeKeys = () => {
    if (state.keys || state.phase !== 'parked' || returningToYard || car.speed >= 1.5) return;
    if (pendingMethod === 'tail' && culprit && dist(culprit.pos, keySpot) < 5 && culprit.state !== 'down') { toast('adv.keyBlocked'); return; }
    secure(state, pendingMethod); keys.visible = false; target(layout.garage, 'adv.garage'); persist();
  };
  const checkpoints = (pts: Float32Array) => {
    const points: { x: number; z: number }[] = []; let accumulated = 0;
    for (let i = 2; i < pts.length; i += 2) {
      accumulated += Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      if (accumulated >= 160 || i === pts.length - 2) { points.push({ x: pts[i], z: pts[i + 1] }); accumulated = 0; }
    }
    return points;
  };
  const challenge = () => {
    if (state.phase !== 'parked' || state.keys || returningToYard || car.speed >= 1.5) return;
    if (busy()) { toast('adv.busy'); return; }
    if (!state.informed) { toast('adv.needClue'); return; }
    const route = nav.route(car.pos.x, car.pos.z, Math.atan2(car.fwd.x, car.fwd.z), layout.finish.x, layout.finish.z);
    if (!route) { toast('adv.routeFail'); return; }
    race = { points: checkpoints(route.pts), me: 0, rival: 0, countdown: 3, running: false, elapsed: 0 };
    if (!race.points.length) { race = null; toast('adv.routeFail'); return; }
    state.tracking = true; state.phase = 'race'; returningToYard = false; driver.reset(); culprit?.goTo(car.pos.x + car.left.x * 1.5, car.pos.z + car.left.z * 1.5, 2);
    toast('adv.raceReady'); persist();
  };
  const negotiate = () => dialogue()?.ask(speaker('driver'), t('adv.driverText'), [t('adv.raceOffer'), t('adv.later')], i => { if (i === 0) challenge(); }, { prio: 3, timeout: 30, fallback: 1 });
  const handBack = () => {
    if (!state.keys || !['secured', 'kept', 'borrowed'].includes(state.phase)) return;
    if (pl.mode !== 'onfoot' || dist(car.pos, layout.garage) > 12 || car.speed > 1.5) { toast('adv.returnNeed'); return; }
    const first = giveBack(state);
    // Transfer ownership without deleting the vehicle or swallowing the player's other parked car.
    if (v().car === car) {
      const parkedLook = previousCar ? tr.takeCar(previousCar) : null;
      const replacement = parkedLook && previousCar ? previousCar : new Vehicle(engine.physics, TAXI, { x: layout.garage.x - Math.cos(layout.garage.yaw) * 6, y: .6, z: layout.garage.z + Math.sin(layout.garage.yaw) * 6 }, layout.garage.yaw);
      v().swapCar(replacement, parkedLook ?? { upper: new THREE.Color('#f3b50f'), lower: new THREE.Color('#1f5e3c'), taxi: true, body: 'sedan' });
      v().occupied = false;
    }
    if (first) { contacts.addFriendship('feilong', 25); contacts.addFriendship('daliu', 10); engine.get<MissionApi>('missions')?.addCash(300); toast('adv.reward'); }
    else dialogue()?.say(speaker('owner'), t('adv.borrowedText'), { prio: 3 });
    owner?.goTo(car.pos.x + car.left.x * 2, car.pos.z + car.left.z * 2, 1.5); persist();
  };
  const discussReturn = () => dialogue()?.ask(speaker('owner'), t('adv.returnText'), [t('adv.giveBack'), t('adv.keep'), t('adv.later')], i => {
    if (i === 0) handBack();
    if (i === 1 && keep(state)) { nav.clearTarget('mission'); persist(); }
  }, { prio: 3, timeout: 30, fallback: 2 });
  const lend = () => {
    if (pl.mode !== 'onfoot') { toast('adv.borrowNeed'); return; }
    if (borrow(state)) { dialogue()?.say(speaker('owner'), t('adv.borrowedText'), { prio: 3 }); persist(); }
  };
  const call = () => {
    if (!state.keys) return;
    if (state.tool !== 'held') { toast('adv.needTool'); return; }
    companion.mode = 'follow'; companion.blocked = 0; companion.car = null; repairRequested = true;
    if (!mechanic?.alive) mechanic = people.spawnActor!(mechanicBase.x, mechanicBase.z, { look: mechanicLook });
    dialogue()?.say(speaker('mechanic'), t('adv.repairText'), { prio: 3 }); persist();
  };
  const offer = (p: { x: number; z: number }, key: TKey, use: () => void, r = 2.6) => {
    if (pl.mode === 'onfoot' && dist(pl.position, p) < r && !dialogue()?.asking) pl.offer?.({ x: p.x, z: p.z, r, label: t(key), use });
  };
  tr.addExternalCars({
    cars: () => initialized && v().car !== car ? [car] : [],
    canTake: c => c === car && state.keys && state.phase !== 'returned' && car.speed < 4,
    take(c) { if (c !== car || !state.keys || state.phase === 'returned') return null; previousCar = v().car; persist(); return { ...look, parked: true }; },
    park: c => c === car,
  });
  contacts.reserve('feilong', true); contacts.reserve('daliu', true);
  const blips: Blip[] = [];
  nav.addBlips(() => {
    if (!started) return [];
    blips.length = 0;
    blips.push({ kind: 'contact', x: mechanicBase.x, z: mechanicBase.z, label: t('who.daliu'), color: '#ff6b5a' });
    const ownerAt = state.keys ? layout.garage : paperSpot;
    blips.push({ kind: 'contact', x: ownerAt.x, z: ownerAt.z, label: t('con.who.feilong'), color: '#c78bff' });
    if (!state.clue) blips.push({ kind: 'encounter', x: paperSpot.x, z: paperSpot.z, label: t('adv.source') });
    if (state.informed) blips.push({ kind: 'parking', x: layout.parking.x, z: layout.parking.z, label: t('adv.parking') });
    if (state.keys || dist(pl.position, car.pos) < 110) blips.push({ kind: 'car', x: car.pos.x, z: car.pos.z, heading: Math.atan2(car.fwd.x, car.fwd.z), label: 'FLY-07', color: '#c78bff' });
    if (race?.running && race.points[race.me]) blips.push({ kind: 'target', ...race.points[race.me], label: t('adv.finish') });
    return blips;
  });
  const initialize = () => {
    if (initialized) return;
    initialized = true;
    setPose(state.pose ?? (state.phase === 'available' || state.phase === 'search' ? layout.source : layout.parking));
    damage().setHealth(car, state.condition);
    pendingMethod = state.method ?? 'tail';
    if (state.phase === 'parked') placeKeys();
    if (state.phase !== 'available') toast('adv.resume');
  };
  engine.events.on('game:start', () => { started = true; initialize(); });
  engine.events.on('wanted:busted', () => {
    if (v().car === car && state.keys) { state.phase = state.rewarded ? 'borrowed' : 'secured'; target(layout.garage, 'adv.garage'); persist(); }
  });
  window.addEventListener('pagehide', persist);
  document.addEventListener('visibilitychange', () => { if (document.hidden) persist(); });

  const objective = (): string => {
    if (companion.mode === 'follow') return t('adv.follow');
    if (companion.mode === 'ride') return t('adv.riding');
    if (companion.mode === 'work') return t('adv.repairing', { n: Math.ceil(8 - companion.work) });
    if (race) return !race.running ? t(v().occupied && pl.mode === 'driving' && dist(pl.position, car.pos) < 50 ? 'adv.countdown' : 'adv.raceReady', { n: Math.ceil(race.countdown) }) : t('adv.race', { n: Math.min(race.me + 1, race.points.length), of: race.points.length });
    return t(`adv.${state.phase}` as TKey);
  };
  const actions = (): Action[] => {
    const a: Action[] = [];
    if (state.phase === 'available') a.push({ label: t('adv.start'), run: start });
    else if (!state.tracking && isActive({ ...state, tracking: true })) a.push({ label: t('adv.resumeAction'), run: start });
    if (race) a.push({ label: t('adv.cancelRace'), run: () => { race = null; state.phase = 'parked'; returningToYard = true; driver.reset(); persist(); } });
    if (!state.clue) a.push({ label: t('adv.trackSource'), run: () => target(paperSpot, 'adv.source') });
    a.push({ label: t('adv.trackGarage'), run: () => target(mechanicBase, 'adv.garage') });
    if (state.tool === 'held' && !repairRequested) a.push({ label: t('adv.toolDrop'), run: () => {
      const ft = pl.foot;
      if (!ft) { toast('adv.toolDropFoot'); return; }
      state.tool = 'ground'; state.toolAt = { x: ft.pos.x + Math.sin(ft.yaw) * .7, z: ft.pos.z + Math.cos(ft.yaw) * .7 }; persist();
    } });
    if (state.informed) a.push({ label: t('adv.trackParking'), run: () => target(layout.parking, 'adv.parking') });
    if (state.keys) a.unshift({ label: t('adv.trackCar'), run: () => target(car.pos, 'adv.title') });
    if (state.phase === 'secured') a.push({ label: t('adv.keep'), run: () => { keep(state); nav.clearTarget('mission'); persist(); } });
    if (state.phase === 'returned') a.push({ label: t('adv.replay'), run: () => {
      if (busy()) { toast('adv.busy'); return; }
      state = { ...fresh(), layout, rewarded: state.rewarded };
      race = null; returningToYard = false; pendingMethod = 'tail'; parkingNotified = false;
      companion.mode = 'base'; companion.car = null; repairRequested = false;
      setPose(layout.source); damage().repair(car); persist();
    } });
    if (state.tracking && (api.active || state.phase === 'available')) a.push({ label: t('adv.defer'), run: () => {
      if (race) { race = null; state.phase = 'parked'; returningToYard = true; driver.reset(); }
      state.tracking = false; nav.clearTarget('mission'); persist();
    } });
    a.push({ label: t('adv.messages'), run: () => engine.get<StoryApi>('story')?.phone.toggle() });
    // the 车行 delivers wherever you are (garage/, 2026-10-19)
    a.push({ label: t('garage.dealerApp'), run: () => engine.get<{ name: string; dealer(): void }>('garage')?.dealer() });
    return a;
  };
  const nearbyCard = () => {
    const items = [state.clue && t('adv.itemSlip'), state.keys && t('adv.itemKeys'), state.tool === 'held' && t('adv.itemTool')].filter(Boolean).join(' · ') || t('adv.noItems');
    return { title: t('adv.title'), status: objective(), detail: t('adv.desc'), inventory: t('adv.inventory', { hp: Math.round(initialized ? damage().health(car) : state.condition), items }), actions: actions() };
  };
  const spawnNear = (actor: Actor | null, p: { x: number; z: number }, which: 'owner' | 'mechanic' | 'driver'): Actor | null => {
    if (actor?.alive && dist(pl.position, actor.pos) > 400 && which !== 'mechanic') { actor.release('vanish'); return null; }
    if (actor?.alive) return actor;
    if (dist(pl.position, p) > 180) return null;
    const a = people.spawnActor!(p.x, p.z, { look: which === 'owner' ? ownerLook : which === 'mechanic' ? mechanicLook : culpritLook, yaw: layout.garage.yaw });
    if (a) a.act(which === 'owner' ? 'wave' : 'talk');
    return a;
  };
  const animateSeat = (vehicle: Vehicle, who: 'mechanic' | 'driver', dt: number) => {
    gait.update({ action: 'sit', speed: 0, t: clock, seat: .42 }, dt, .35);
    const side = who === 'mechanic' ? -.38 : .38;
    seated.set(side, .48 - SKELETON[J.pelvis].offset[1] * gait.scale, .22).applyQuaternion(vehicle.quat).add(vehicle.pos);
    forward.set(0, 0, 1).applyQuaternion(vehicle.quat);
    pl.crowd.add(seated, Math.atan2(forward.x, forward.z), gait, who === 'mechanic' ? mechanicLook : culpritLook);
  };
  const api: AdventureApi & { debug: { state(): Save & { race: unknown; companion: string; car: Spot; actors: unknown }; car(): Vehicle } } = {
    name: 'adventure', get active() { return isActive(state); }, available: true,
    openNearby: () => panel.toggle(),
    debug: { state: () => ({ ...JSON.parse(JSON.stringify(state)), race, companion: companion.mode, car: { x: car.pos.x, z: car.pos.z, yaw: Math.atan2(car.fwd.x, car.fwd.z) }, actors: { owner: owner?.pos.toArray(), mechanic: mechanic?.pos.toArray(), driver: culprit?.pos.toArray(), keys: keySpot.toArray() } }), car: () => car },
    fixedUpdate(dt) {
      if (!started || !initialized) return;
      clock += dt; saveClock += dt;
      if (saveClock > 1) { saveClock = 0; persist(); }
      // No start by itself (2026-10-18): it began 14 s into every new game, took the GPS's route away from 老K's
      // first chapter and kept it - 30 of 32 sessions in the city had it on, 2 started a chapter. Like GTA's side
      // jobs it waits to be picked up: 小飞龙 at the kerb (F), or the Nearby panel.
      if (v().car !== car) {
        previous.copy(car.pos); pq.copy(car.quat);
        const moving = state.phase === 'search' || returningToYard || race?.running;
        if (moving) {
          let goal = layout.parking;
          if (race?.running) goal = { ...(race.points[race.rival] ?? layout.finish), yaw: 0 };
          driver.topSpeed = race?.running ? 20 : alert > 0 ? 23 : 13;
          const intent = driver.update(car, { x: goal.x, z: goal.z, vx: 0, vz: 0 }, false, dt, (x, z, h, tx, tz) => nav.route(x, z, h, tx, tz), true);
          car.step(filter.update(intent, car.speed, dt), dt);
          motionStall = car.speed < .8 ? motionStall + dt : 0;
          if (!race?.running && (dist(car.pos, layout.parking) < 20 && car.speed < 3 || motionStall > 20)) {
            // A narrow kerb or obstruction can stop the driver short: the encounter continues here.
            layout.parking = { x: car.pos.x, z: car.pos.z, yaw: Math.atan2(car.fwd.x, car.fwd.z) };
            park(); motionStall = 0;
          }
        } else car.step(HOLD, dt);
      }
      if (state.phase === 'search') {
        const near = dist(pl.position, car.pos);
        closeTime = near < 16 ? closeTime + dt : Math.max(0, closeTime - dt);
        if (closeTime > 2 && alert <= 0) { alert = 5; toast('adv.alert'); }
        alert = Math.max(0, alert - dt);
        const ahead = (v().car.pos.x - car.pos.x) * car.fwd.x + (v().car.pos.z - car.pos.z) * car.fwd.z;
        const side = (v().car.pos.x - car.pos.x) * car.left.x + (v().car.pos.z - car.pos.z) * car.left.z;
        const blocked = car.speed < 1.5 && near < 12 && (car.impact > 3 || ahead > 0 && ahead < 8 && Math.abs(side) < 3.5 && v().car.speed < 1.5);
        stopped = blocked ? stopped + dt : 0;
        if (stopped > 2 || car.flippedTime > 2) park('intercept');
      }
      if (race) {
        race.elapsed += dt;
        if (!race.running) {
          if (pl.mode === 'driving' && v().occupied && v().car !== car && dist(pl.position, car.pos) < 50) {
            race.countdown -= dt;
            if (race.countdown <= 0) { race.running = true; race.elapsed = 0; culprit?.release('vanish'); culprit = null; driver.reset(); }
          } else race.countdown = 3;
        } else {
          race.me = nextCheckpoint(race.points, race.me, pl.position.x, pl.position.z);
          race.rival = nextCheckpoint(race.points, race.rival, car.pos.x, car.pos.z);
          if (race.me === race.points.length && pl.mode === 'driving') { race = null; park('race'); toast('adv.raceWon'); }
          else if (race.rival === race.points.length || pl.mode !== 'driving' || race.elapsed > 180) { race = null; state.phase = 'parked'; returningToYard = true; driver.reset(); toast('adv.raceLost'); persist(); }
        }
      }
      if (car.pos.y < -8 || car.pos.y > 30 || car.flippedTime > 10) {
        if (v().car === car) { pl.getOut(); v().reset({ x: layout.parking.x, y: .7, z: layout.parking.z }, layout.parking.yaw); pl.getOut(); }
        else setPose(layout.parking);
        if (!state.keys) park('intercept'); toast('adv.recovery'); persist();
      }
      // A lost or despawned companion can always be invited again at the repair bay.
      if ((companion.mode === 'follow' || companion.mode === 'work') && !mechanic?.alive) {
        companion.mode = 'base'; companion.car = null; repairRequested = false; toast('adv.mechanicWait');
      }
      // A companion walks to the door, then is rendered in the passenger seat until arrival.
      if (companion.mode === 'follow' && mechanic?.alive) {
        const c = v().car;
        const door = { x: c.pos.x - c.left.x * 1.7, z: c.pos.z - c.left.z * 1.7 };
        mechanic.goTo(pl.mode === 'driving' ? door.x : pl.position.x, pl.mode === 'driving' ? door.z : pl.position.z, 2.2);
        mechanic.act(null);
        if (pl.mode === 'driving' && c.speed < 1 && !c.spec.single && dist(mechanic.pos, door) < 1.4) {
          companion.mode = 'ride'; companion.car = c; mechanic.release('vanish'); mechanic = null; toast('adv.riding');
        }
        companion.blocked = !mechanic || mechanic.arrived || dist(mechanic.pos, pl.position) < 4 ? 0 : companion.blocked + dt;
        if (companion.blocked > 20) { companion.blocked = 0; toast('adv.mechanicWait'); }
      }
      if (companion.mode === 'ride' && companion.car) {
        const c = companion.car;
        if (c.speed < 1 && (dist(c.pos, car.pos) < 12 || pl.mode === 'onfoot' || v().car !== c)) {
          const x = c.pos.x - c.left.x * 1.8, z = c.pos.z - c.left.z * 1.8;
          mechanic = people.spawnActor!(x, z, { look: mechanicLook });
          if (mechanic) { companion.mode = dist(c.pos, car.pos) < 12 ? 'work' : 'follow'; companion.car = null; companion.work = 0; }
        }
      }
      if (companion.mode === 'work' && mechanic?.alive) {
        const hood = { x: car.pos.x + car.fwd.x * 2.8, z: car.pos.z + car.fwd.z * 2.8 };
        mechanic.goTo(hood.x, hood.z, 1.8);
        if (dist(mechanic.pos, hood) < 1.6 && car.speed < 1) {
          mechanic.stop(); mechanic.face(car.pos.x, car.pos.z); mechanic.act('cook'); companion.work += dt;
          if (companion.work >= 8) { damage().repair(car); companion.mode = 'base'; repairRequested = false; mechanic.act('cheer'); state.tool = 'base'; state.toolAt = null; toast('adv.repaired'); persist(); }
        }
      }
    },
    postStep(dt) {
      if (!initialized || v().car === car) return;
      car.afterStep(dt); current.copy(car.pos); cq.copy(car.quat);
      if (crashDamage(car.impact) > 0 && clock - lastDamage > .35) { lastDamage = clock; damage().setHealth(car, damage().health(car) - crashDamage(car.impact)); }
    },
    update(dt, alpha) {
      if (engine.input.state.phonePressed) { engine.input.state.phonePressed = false; panel.toggle(); }
      if (panel.open && engine.input.state.pausePressed) { engine.input.state.pausePressed = false; panel.close(); }
      panel.update(nearbyCard);
      if (!started || !initialized) { paper.visible = keys.visible = tool.visible = garageSign.visible = yardSign.visible = paperRing.visible = false; return; }
      const m = engine.get<MissionApi>('missions');
      // a chapter running owns the objective line (it went on showing the adventure's over 老K's errand)
      if (m && api.active && !engine.get<CampaignApi>('campaign')?.running) m.story = lastObjective = objective();
      else if (m && lastObjective && m.story === lastObjective) { m.story = null; lastObjective = null; }
      if (v().car !== car) { rendered.lerpVectors(previous, current, alpha); rq.slerpQuaternions(pq, cq, alpha); kit.set(0, rendered, rq, car, look.upper, look.lower, false); }
      kit.commit(v().car === car ? 0 : 1);
      garageSign.visible = dist(pl.position, layout.garage) < 150; yardSign.visible = dist(pl.position, layout.parking) < 100 && (state.informed || dist(pl.position, car.pos) < 80);
      paper.visible = paperRing.visible = !state.clue;
      if (!state.keys && state.phase === 'parked' && (car.speed > 1.5 || !clearOfWorld(engine.physics, keySpot.x, keySpot.z, 0, .35, .35))) placeKeys();
      keys.visible = !state.keys && state.phase === 'parked' && !returningToYard && car.speed < 1.5; keys.position.copy(keySpot); keys.rotation.y += dt;
      const ownerAt = state.keys ? { x: mechanicBase.x + 4, z: mechanicBase.z } : paperSpot;
      // Move contacts between scenes only out of the player's view; never duplicate or visibly teleport them.
      if (owner && dist(owner.pos, ownerAt) > 30 && dist(pl.position, owner.pos) > 80) { owner.release('vanish'); owner = null; }
      owner = spawnNear(owner, ownerAt, 'owner');
      if (owner && state.phase === 'kept' && dist(pl.position, owner.pos) < 50) { owner.goTo(pl.position.x, pl.position.z, 1.6); owner.act('angry'); }
      else if (owner && dist(owner.pos, ownerAt) > 2) owner.goTo(ownerAt.x, ownerAt.z, 1.8);
      if (companion.mode === 'base') mechanic = spawnNear(mechanic, mechanicBase, 'mechanic');
      if (state.phase === 'parked' && !returningToYard && !state.keys && car.speed < 1.5) {
        const at = { x: car.pos.x + car.left.x * 2.8, z: car.pos.z + car.left.z * 2.8 };
        culprit = spawnNear(culprit, at, 'driver');
        if (culprit?.alive) {
          culprit.fair = true;
          const walking = clock % 18 < 12;
          culprit.goTo(at.x + (walking ? Math.cos(layout.parking.yaw) * 10 : 0), at.z - (walking ? Math.sin(layout.parking.yaw) * 10 : 0), 1.4);
          if (culprit.arrived) culprit.act('phone');
          offer(culprit.pos, 'adv.talkDriver', negotiate);
        }
        const watched = pendingMethod === 'tail' && culprit && dist(culprit.pos, keySpot) < 5 && culprit.state !== 'down';
        offer(keySpot, watched ? 'adv.keyBlocked' : 'adv.key', takeKeys, 2.2);
      } else if (culprit?.alive && !race) { culprit.release('walk'); culprit = null; }
      if (state.phase === 'search' || returningToYard || race?.running) animateSeat(car, 'driver', dt);
      if (companion.mode === 'ride' && companion.car) animateSeat(companion.car, 'mechanic', dt);
      if (!state.clue) offer(paperSpot, 'adv.inspect', inspect);
      if (mechanic?.alive && companion.mode === 'base') {
        if (state.clue && !state.informed) offer(mechanic.pos, 'adv.askMechanic', inform);
        else if (state.keys) offer(mechanic.pos, 'adv.callRepair', call);
      }
      if (owner?.alive) {
        if (state.phase === 'returned') offer(owner.pos, 'adv.borrow', lend);
        else if (state.keys) offer(owner.pos, 'adv.return', discussReturn);
        else if (state.phase === 'available') offer(owner.pos, 'adv.start', start);
      }
      const toolAt = { x: mechanicBase.x - 2, z: mechanicBase.z };
      tool.visible = true;
      tool.rotation.set(0, 0, 0);
      if (state.tool !== 'held') {
        // at the bay, or where the player put it down
        const at = state.tool === 'ground' && state.toolAt ? state.toolAt : toolAt;
        tool.position.set(at.x, .15, at.z);
        offer(at, 'adv.tool', () => { state.tool = 'held'; state.toolAt = null; toast('adv.toolCollected'); persist(); });
      } else {
        const ft = pl.foot;
        if (ft) {
          // in the right hand by its handle, its long side along the way the player faces
          const s = Math.sin(ft.yaw), c = Math.cos(ft.yaw);
          tool.position.set(ft.pos.x - c * .3 + s * .05, ft.pos.y + .5, ft.pos.z + s * .3 + c * .05);
          tool.rotation.y = ft.yaw + Math.PI / 2;
        } else { tool.position.set(-.45, .2, -1).applyQuaternion(v().renderQuat).add(v().renderPos); }
        if (companion.mode === 'work' && mechanic) { mechanic.joint(J.wristR, toolMatrix); carryPoint.setFromMatrixPosition(toolMatrix); tool.position.copy(carryPoint); }
        if (!repairRequested) offer(toolAt, 'adv.toolReturn', () => { state.tool = 'base'; state.toolAt = null; persist(); });
      }
      goalRing.visible = !!race?.running;
      if (race?.running && race.points[race.me]) {
        const p = race.points[race.me]; goalRing.position.set(p.x, .12, p.z);
        const existing = nav.target;
        if (!existing || existing.x !== p.x || existing.z !== p.z) target(p, 'adv.finish');
      }
    },
  };
  engine.add(api);
}
