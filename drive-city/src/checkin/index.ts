import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { lang, t } from '../core/I18n';
import type { HudApi, MissionApi, NavApi, PlayerApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { NavSystem, LandmarkPin } from '../nav';

/** Each landmark checked in pays this; the whole set pays SET_PRIZE on top. */
export const CHECKIN_PRIZE = 200;
export const SET_PRIZE = 8000;
/** Within this many metres of a footprint (or on it)... */
const REACH = 25;
/** ...and slower than this (m/s, ~43 km/h): a look, not a blur. On foot always. */
const SLOW = 12;
/**
 * Or photographed from further off: the camera pointing within VIEW_ANGLE of it (in the frame, near its middle), within its view distance (1.2 x its
 * size, VIEW_MIN-VIEW_MAX m), and a ray from the camera meeting its own colliders first - a third of the landmarks
 * stand in squares and parks a lane never comes within REACH of (the Monument 125 m, 祈年殿 430 m inside 天坛's walls).
 */
const VIEW_ANGLE = 35 * Math.PI / 180, VIEW_MIN = 60, VIEW_MAX = 220;
const KEY = 'drivecity.checkins.v1';
/** Not a sight: the player's own house. */
const SKIP = new Set(['home']);

export interface CheckinApi extends System {
  readonly found: number;
  readonly total: number;
  debug: { targets(): { id: string; x: number; z: number }[]; reset(): void; checkIn(id: string): void; has(id: string): boolean };
}

interface Target { pin: LandmarkPin; rings: readonly number[][]; box: [number, number, number, number]; cx: number; cz: number; cy: number; view: number }

const segDist = (x: number, z: number, ax: number, az: number, bx: number, bz: number) => {
  const vx = bx - ax, vz = bz - az, L = vx * vx + vz * vz || 1, u = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L));
  return Math.hypot(x - ax - vx * u, z - az - vz * u);
};
const inside = (x: number, z: number, r: readonly number[]) => {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) if ((r[i + 1] > z) !== (r[j + 1] > z) && x < (r[j] - r[i]) * (z - r[i + 1]) / (r[j + 1] - r[i + 1]) + r[i]) c = !c;
  return c;
};
/** Metres from (x, z) to the nearest of the rings (0 on one). */
const distTo = (x: number, z: number, rings: readonly number[][]) => {
  let d = Infinity;
  for (const r of rings) {
    if (inside(x, z, r)) return 0;
    for (let i = 0; i < r.length; i += 2) d = Math.min(d, segDist(x, z, r[i], r[i + 1], r[(i + 2) % r.length], r[(i + 3) % r.length]));
  }
  return d;
};

const CSS = `
.dc-flash{position:fixed;inset:0;background:#fff;pointer-events:none;z-index:40;opacity:0;transition:opacity .45s ease-out}
.dc-flash.on{opacity:.85;transition:none}
.dc-card{position:fixed;left:50%;top:14%;z-index:41;pointer-events:none;background:#f7f4ec;padding:10px 10px 0;box-shadow:0 10px 30px rgba(0,0,0,.45);
  transform:translateX(-50%) rotate(-3deg) scale(1.12);opacity:0;transition:transform .35s cubic-bezier(.2,1.4,.4,1),opacity .3s}
.dc-card.on{transform:translateX(-50%) rotate(-2deg) scale(1);opacity:1}
.dc-card canvas{display:block;width:280px;height:180px;background:#222;filter:saturate(1.08) contrast(1.04)}
.dc-card .cap{padding:8px 4px 10px;color:#1d1d1f;font-family:"Kaiti SC","STKaiti","KaiTi",serif;text-align:center}
.dc-card .zh{font-size:22px;font-weight:700;letter-spacing:2px}
.dc-card .en{font:600 11px system-ui,sans-serif;color:#6b6760;margin-top:2px}
.dc-card .ok{font:800 11px system-ui,sans-serif;color:#c8231d;letter-spacing:3px;margin-top:6px}
.dc-hint{position:fixed;left:50%;bottom:24%;transform:translateX(-50%);z-index:30;pointer-events:none;padding:7px 14px;border-radius:16px;
  background:rgba(9,11,13,.62);color:#f4f1e8;font:600 14px system-ui,sans-serif;border-left:3px solid #d4b264;white-space:nowrap;transition:opacity .4s;opacity:0}
.dc-hint.on{opacity:1}
.dc-touch .dc-card{top:8%}.dc-touch .dc-hint{bottom:34%;font-size:12px}.dc-touch .dc-card canvas{width:200px;height:128px}.dc-touch .dc-card .zh{font-size:17px}
`;

/**
 * 地标打卡 (2026-10-03): every landmark in the city (LANDMARKS, less 我家) can be checked in - come within REACH m of
 * its footprint slower than SLOW, or on foot, and the moment is photographed: a flash, a card with a snapshot
 * of the frame, its name and 打卡成功, a shutter. CHECKIN_PRIZE each, SET_PRIZE for all of them, saved in
 * `drivecity.checkins.v1`. The map and the radar draw checked-in ones as a muted diamond with a tick (LandmarkPin.visited),
 * the rest as before.
 */
export async function install(engine: Engine): Promise<void> {
  const pl = engine.get<PlayerApi>('player');
  const nav = engine.get<NavApi>('nav') as NavSystem | undefined;
  const areas = engine.get<WorldApi>('world')?.landmarkAreas;
  if (!pl || !nav || !areas) return;
  let found = new Set<string>();
  try { found = new Set(JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[]); } catch { /* private mode */ }
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify([...found])); } catch { /* ignore */ } };

  const byId = new Map(areas.map((a) => [a.id, a]));
  const targets: Target[] = [];
  for (const pin of nav.landmarks) {
    const area = byId.get(pin.id), rings = area?.rings;
    if (SKIP.has(pin.id) || !area || !rings?.length) continue;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const r of rings) for (let i = 0; i < r.length; i += 2) { x0 = Math.min(x0, r[i]); x1 = Math.max(x1, r[i]); z0 = Math.min(z0, r[i + 1]); z1 = Math.max(z1, r[i + 1]); }
    // the largest footprint's middle, at a third of the height (capped: a tower's top is not where to aim)
    const main = rings.reduce((a, b) => (b.length > a.length ? b : a));
    let cx = 0, cz = 0; for (let i = 0; i < main.length; i += 2) { cx += main[i]; cz += main[i + 1]; } cx /= main.length / 2; cz /= main.length / 2;
    const view = Math.max(VIEW_MIN, Math.min(VIEW_MAX, 1.2 * Math.max(x1 - x0, z1 - z0, area.height)));
    targets.push({ pin, rings, box: [x0 - REACH, z0 - REACH, x1 + REACH, z1 + REACH], cx, cz, cy: Math.min(20, Math.max(2, area.height / 3)), view });
    pin.visited = found.has(pin.id);
  }
  const total = targets.length;

  // --- the card ------------------------------------------------------------------------------------------
  const style = document.createElement('style');
  style.textContent = CSS;
  document.head.appendChild(style);
  const flash = document.createElement('div'); flash.className = 'dc-flash';
  const card = document.createElement('div'); card.className = 'dc-card';
  const photo = document.createElement('canvas'); photo.width = 560; photo.height = 360;
  const cap = document.createElement('div'); cap.className = 'cap';
  card.append(photo, cap);
  const hint = document.createElement('div'); hint.className = 'dc-hint';
  document.body.append(flash, card, hint);
  let hintFor = '';
  let cardT = 0;
  /** The frame as it is drawn next, cropped to the card: renderFrame wrapped for one call (the drawing buffer is read before it is cleared). */
  const proj = new THREE.Vector3();
  /** The frame as it is drawn next, cropped round the landmark where it is on screen: renderFrame wrapped for one call (the drawing buffer is read before it is cleared). */
  const snapshot = (tg: Target) => {
    const orig = engine.renderFrame;
    engine.renderFrame = (dt: number) => {
      orig(dt);
      engine.renderFrame = orig;
      const src = engine.renderer.domElement, g = photo.getContext('2d');
      if (!g || !src.width) return;
      const k = Math.min(src.width / photo.width, src.height / photo.height) * 0.62;
      const w = photo.width * k, h = photo.height * k;
      proj.set(tg.cx, tg.cy, tg.cz).project(engine.camera);
      const on = proj.z < 1 && Math.abs(proj.x) < 1.2 && Math.abs(proj.y) < 1.2;
      const fx = on ? (proj.x + 1) / 2 * src.width : src.width / 2, fy = on ? (1 - proj.y) / 2 * src.height : src.height * 0.45;
      const sx = Math.max(0, Math.min(src.width - w, fx - w / 2)), sy = Math.max(0, Math.min(src.height - h, fy - h * 0.55));
      try { g.drawImage(src, sx, sy, w, h, 0, 0, photo.width, photo.height); } catch { /* tainted or lost: the card keeps its dark ground */ }
    };
  };
  const show = (tg: Target) => {
    const pin = tg.pin, zh = pin.name.zh, en = pin.name.en;
    cap.innerHTML = '';
    const a = document.createElement('div'); a.className = 'zh'; a.textContent = lang() === 'zh' ? zh : en;
    const b = document.createElement('div'); b.className = 'en'; b.textContent = lang() === 'zh' ? en : zh;
    const c = document.createElement('div'); c.className = 'ok'; c.textContent = `✓ ${t('checkin.card')}`;
    cap.append(a, b, c);
    photo.getContext('2d')?.clearRect(0, 0, photo.width, photo.height);
    snapshot(tg);
    flash.classList.add('on');
    requestAnimationFrame(() => requestAnimationFrame(() => flash.classList.remove('on')));
    card.classList.add('on');
    cardT = 3.6;
  };

  const checkIn = (tg: Target) => {
    const pin = tg.pin;
    found.add(pin.id); save();
    pin.visited = true;
    const m = engine.get<MissionApi>('missions');
    m?.addCash(CHECKIN_PRIZE);
    const hud = engine.get<HudApi>('hud');
    if (found.size >= total) { m?.addCash(SET_PRIZE); hud?.toast(t('checkin.all', { n: SET_PRIZE })); }
    else hud?.toast(t('checkin.found', { name: pin.name[lang()], i: found.size, of: total, n: CHECKIN_PRIZE }));
    show(tg);
    engine.events.emit('checkin', { id: pin.id, x: pin.x, z: pin.z, found: found.size, total });
  };

  let step = 0;
  const look = new THREE.Vector3();
  const api: CheckinApi = {
    name: 'checkins',
    get found() { return found.size; },
    total,
    debug: {
      targets: () => targets.map((tg) => ({ id: tg.pin.id, x: tg.pin.x, z: tg.pin.z })),
      reset: () => { found.clear(); save(); for (const tg of targets) tg.pin.visited = false; },
      has: (id) => found.has(id),
      checkIn: (id) => { const tg = targets.find((q) => q.pin.id === id); if (tg && !found.has(id)) checkIn(tg); },
    },
    fixedUpdate() {
      // Six times a second is plenty for something this size.
      if (++step % 10) return;
      if (engine.get<{ name: string; state: string }>('ui')?.state !== 'playing') return;
      const at = pl.position, v = engine.get<VehicleApi>('vehicle');
      const speed = pl.mode === 'driving' && v ? v.car.speed : 0;
      if (speed > SLOW) { if (hintFor) { hintFor = ''; hint.classList.remove('on'); } return; }
      const cam = engine.camera;
      cam.getWorldDirection(look);
      const lh = Math.hypot(look.x, look.z) || 1;
      let near: Target | null = null;
      for (const tg of targets) {
        if (found.has(tg.pin.id)) continue;
        const [x0, z0, x1, z1] = tg.box;
        if (at.x > x0 && at.x < x1 && at.z > z0 && at.z < z1 && distTo(at.x, at.z, tg.rings) <= REACH) { checkIn(tg); break; }
        // In view: near enough, the camera turned to it, nothing in between.
        const cp = cam.position, dx = tg.cx - cp.x, dz = tg.cz - cp.z, d = Math.hypot(dx, dz);
        if (d > tg.view + 60 || d < 1) continue;
        if (distTo(cp.x, cp.z, tg.rings) > tg.view) continue;
        near = tg;
        if ((dx * look.x + dz * look.z) / (d * lh) < Math.cos(VIEW_ANGLE)) continue;
        const dy = tg.cy - cp.y, L = Math.hypot(dx, dy, dz);
        const hit = engine.physics.raycast({ x: cp.x, y: cp.y, z: cp.z }, { x: dx / L, y: dy / L, z: dz / L }, L + 5, groups(CG.CAR, CG.WORLD), true, v?.car.body);
        if (hit?.userData?.tag === `landmark:${tg.pin.id}`) { checkIn(tg); near = null; break; }
      }
      // A nudge while one is in range and not yet photographed: turn the camera to it.
      const id = near ? near.pin.id : '';
      if (id !== hintFor) {
        hintFor = id;
        if (near) hint.textContent = t(document.body.classList.contains('dc-touch') ? 'checkin.hintTouch' : 'checkin.hint', { name: near.pin.name[lang()] });
        hint.classList.toggle('on', !!near);
      }
    },
    update(dt) {
      if (cardT > 0) { cardT -= dt; if (cardT <= 0) card.classList.remove('on'); }
      // Only over the play: not on the title, the pause screen or the garage's.
      const playing = engine.get<{ name: string; state: string }>('ui')?.state === 'playing';
      if (!playing && hintFor) { hintFor = ''; hint.classList.remove('on'); }
    },
  };
  engine.add(api);
}
