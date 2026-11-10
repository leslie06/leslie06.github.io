import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { t, type TKey } from '../core/I18n';
import type { Blip, HudApi, MissionApi, NavApi, PlayerApi, VehicleApi, WorldApi } from '../game/Contracts';
import type { CityStreamer } from '../city/Streamer';
import { SHOP_STRIDE } from '../city/Buildings';
import { tileOf } from '../city/Geo';
import { shopSigns, type ShopSign } from '../city/visual/ShopSigns';
import { CJK } from '../world/Textures';
import type { ContactsApi } from '../contacts';
import type { DamageApi } from '../damage';
import type { DistrictApi } from '../district';
import { ShopPanel, type Row } from '../district/Panel';
import type { EstateApi } from '../estate';
import type { UiApi } from '../ui';
import { shotMode } from '../debug/ShotMode';
import {
  EAT_TRADES, GOODS, HOTEL_PRICE, KIT_AT, KIT_HEAL, KIT_MAX, SERVICE, TICKET_PRICE, ate, emptySave, goodOf, repairPrice, scratch,
  type Good, type Service, type StreetSave,
} from './Trades';

/**
 * 全城店面的柜台（2026-11-10，docs/street-level-design.md C1，「下车之后，几乎没事可做」）。
 *
 * 沿街店面本来是立面着色器画的装饰：全城 113 万间，每间在瓦片里都有位置、朝向、宽度和招牌（`CityStreamer.shops`，
 * city/Buildings.ts 的 `shops`），招牌带行当（city/visual/ShopSigns.ts）。这里把行当对到一种柜台（Trades.ts）：
 * 徒步走到开着门的店面前 3 米内，按 F 打开南锣鼓巷那张柜台面板（district/Panel.ts），东西按行当来——
 *   吃的 18 种行当：吃一样，记进「吃遍北京」（6 / 12 / 18 种各给一笔钱）；
 *   水果、烟酒、茶叶、花店：买一件礼物拿在手上，找熟人说话时多一个「送给他」（contacts/ 加好感）；
 *   药店：处理伤口、随身带急救包（血低于 25 自己用上）；便利店、超市：水和面包；足疗：回满血加减伤；
 *   理发、服装：南锣那套发色和衣服（district/ 的存档，同一份）；修车铺：车在 40 米内就地修；
 *   宾馆：睡到早上或傍晚（estate/ 的睡觉）；彩票：刮刮乐。
 * 其余行当（五金、文具、银行……）还只是门脸。没有室内：柜台就在门口。
 *
 * 看得见：徒步时 28 米内能用的店门上方有一块黄色小牌（一个字：吃、礼、药、发、衣、修、住、彩、买、足），小地图上有
 * 店的标记。省电档只出最近 4 块。存档 `drivecity.street.v1`（跟云存档走）。shot mode 不装，除非 `?street=1`。
 */
export interface StreetApi extends System {
  /** The gift in hand, or null. */
  readonly gift: Good | null;
  /** The gift handed over: its friendship points (0 when there was none). */
  giveGift(): number;
  readonly saved: Readonly<StreetSave>;
  /** A counter's panel is open. */
  readonly busy: boolean;
  /** The nearest usable shop of each kind within `r` of (x, z), nearest first (the 附近 panel). */
  nearby(x: number, z: number, r: number): { x: number; z: number; name: string; service: Service; d: number }[];
  debug: {
    /** The shop units in reach of a counter round (x, z): where to stand for each, its sign and service. */
    near(x: number, z: number, r: number): { x: number; z: number; sign: string; trade: string; service: Service }[];
    open(trade: string): boolean; buy(i: number): boolean; save(): StreetSave; rows(): string[];
  };
}

const KEY = 'drivecity.street.v1';
/** In front of the unit by up to this, and no further along the wall than half its width (at least `SIDE`). */
const FRONT = 3.2, SIDE = 1.3;
/** Badges over usable shops within this of the player on foot; the map's marks the same. */
const BADGE_R = 28, BADGES = 8, BADGES_LITE = 4;
const REPAIR_R = 40;
const BADGE: Record<Service, string> = { eat: '吃', snack: '买', gift: '礼', pharmacy: '药', care: '足', hair: '发', clothes: '衣', repair: '修', hotel: '住', lottery: '彩' };

interface Unit { x: number; z: number; nx: number; nz: number; w: number; gh: number; sign: ShopSign; service: Service; d: number }

function badgeTexture(ch: string): THREE.CanvasTexture {
  const cv = document.createElement('canvas'); cv.width = cv.height = 96;
  const g = cv.getContext('2d')!;
  g.fillStyle = '#f3b50f'; g.strokeStyle = '#1b1b1b'; g.lineWidth = 5;
  g.beginPath(); g.roundRect(6, 6, 84, 84, 18); g.fill(); g.stroke();
  g.fillStyle = '#1b1b1b'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.font = `bold 58px ${CJK}`;
  g.fillText(ch, 48, 52);
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search);
  if ((shotMode && q.get('street') !== '1') || q.get('street') === '0') return;
  const world = engine.get<WorldApi & { streamer?: CityStreamer }>('world');
  const streamer = world?.streamer, pl = engine.get<PlayerApi>('player');
  if (!streamer || !pl) return;
  const missions = () => engine.get<MissionApi>('missions');
  const toast = (s: string, secs?: number) => engine.get<HudApi>('hud')?.toast(s, secs);
  const signs = shopSigns();
  const panel = new ShopPanel(engine);

  let save: StreetSave = emptySave();
  try { const raw = localStorage.getItem(KEY); if (raw) save = { ...emptySave(), ...JSON.parse(raw) as Partial<StreetSave> }; } catch { /* private mode, a broken save */ }
  const store = () => { try { localStorage.setItem(KEY, JSON.stringify(save)); } catch { /* private mode */ } };

  // --- which shop the player stands in front of, and the usable ones round about ---
  const near: Unit[] = [];
  let at: Unit | null = null;
  const scan = (px: number, pz: number, r: number, out: Unit[]): void => {
    out.length = 0;
    const [ix, iz] = tileOf(px, pz);
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
      const list = streamer.shops.get(`${ix + dx}_${iz + dz}`);
      if (!list) continue;
      for (let i = 0; i < list.length; i += SHOP_STRIDE) {
        const x = list[i], z = list[i + 1], d = Math.hypot(x - px, z - pz);
        if (d > r) continue;
        const si = list[i + 6], fl = list[i + 7];
        if (si < 0 || (fl & 1)) continue;   // no sign, or the shutter is down
        const sign = signs[si], service = sign && SERVICE[sign.trade];
        if (!service) continue;
        out.push({ x, z, nx: list[i + 2], nz: list[i + 3], w: list[i + 4], gh: list[i + 5], sign, service, d });
      }
    }
    out.sort((a, b) => a.d - b.d);
  };
  /** The unit (x, z) is in front of, close enough for its counter. */
  const inFront = (u: Unit, x: number, z: number): boolean => {
    const rx = x - u.x, rz = z - u.z, front = rx * u.nx + rz * u.nz, side = Math.abs(-rx * u.nz + rz * u.nx);
    return front > 0.1 && front < FRONT && side < Math.max(SIDE, u.w / 2);
  };

  // --- the badges over the doors ---
  const mats = new Map<Service, THREE.SpriteMaterial>();
  const matOf = (s: Service) => {
    let m = mats.get(s);
    if (!m) { m = new THREE.SpriteMaterial({ map: badgeTexture(BADGE[s]), depthWrite: false, fog: false }); mats.set(s, m); }
    return m;
  };
  const badges: THREE.Sprite[] = [];
  for (let i = 0; i < BADGES; i++) { const s = new THREE.Sprite(); s.scale.setScalar(0.62); s.visible = false; s.name = 'street-badge'; s.renderOrder = 3; engine.scene.add(s); badges.push(s); }
  const showBadges = (on: boolean) => {
    const n = on ? Math.min(near.length, engine.lite ? BADGES_LITE : BADGES) : 0;
    for (let i = 0; i < badges.length; i++) {
      const b = badges[i], u = near[i];
      b.visible = i < n;
      if (i >= n) continue;
      b.material = matOf(u.service);
      // head high, out past an awning's edge (1.05 m deep, its valance down to ~2.45 m): seen from along the pavement
      b.position.set(u.x + u.nx * 1.15, 2.05, u.z + u.nz * 1.15);
    }
  };

  const blips: Blip[] = [];
  engine.get<NavApi>('nav')?.addBlips(() => {
    blips.length = 0;
    if (pl.mode === 'onfoot') for (let i = 0; i < Math.min(near.length, BADGES); i++) blips.push({ kind: 'shop', x: near[i].x, z: near[i].z });
    return blips;
  });

  // --- the counter ---
  let open: Unit | null = null;
  const albumLine = () => t('st.album', { n: save.eaten.length, of: EAT_TRADES.length });
  const describe = (g: Good, trade: string): string => {
    const parts: string[] = [];
    if (g.heal) parts.push(g.heal >= 100 ? t('nl.eff.full') : t('nl.eff.heal', { n: g.heal }));
    if (g.guard) parts.push(t('nl.eff.guard', { p: Math.round((1 - g.guard.scale) * 100), m: Math.round(g.guard.secs / 60) }));
    if (g.gift) parts.push(t('st.eff.gift', { n: g.gift }));
    if (g.kit) parts.push(t('st.eff.kit', { n: save.kits, max: KIT_MAX }));
    if (SERVICE[trade] === 'eat' && !save.eaten.includes(trade)) parts.push(t('st.eff.album'));
    return parts.join(' · ');
  };
  const buy = (u: Unit, g: Good): void => {
    const m = missions();
    if (!m || m.cash < g.price) return;
    m.addCash(-g.price);
    save.bought++;
    engine.events.emit('street:buy', { trade: u.sign.trade, item: g.id, price: g.price });
    if (g.heal) pl.heal?.(g.heal);
    if (g.guard) { pl.guard?.(g.guard.scale, g.guard.secs); toast(t('nl.guard', { m: Math.round(g.guard.secs / 60) }), 3); }
    if (g.kit) save.kits = Math.min(KIT_MAX, save.kits + 1);
    if (g.gift) { save.gift = g.id; toast(t('st.gift.bought', { item: t(g.name) }), 3.5); }
    else if (!g.guard) toast(t('nl.bought', { item: t(g.name), n: g.price }), 2);
    const a = ate(save, u.sign.trade);
    if (a.fresh) {
      toast(t('st.album.new', { n: save.eaten.length, of: EAT_TRADES.length, trade: u.sign.trade }), 3.5);
      if (a.reward) { m.addCash(a.reward); setTimeout(() => toast(t('st.album.reward', { n: save.eaten.length, cash: a.reward.toLocaleString() }), 5), 2600); }
    }
    store();
  };
  const goodsRows = (u: Unit, again: () => void): Row[] => {
    const cash = missions()?.cash ?? 0;
    return (GOODS[u.sign.trade] ?? []).map((g) => {
      const why = cash < g.price ? t('nl.panel.short', { n: g.price - cash })
        : g.kit && save.kits >= KIT_MAX ? t('st.kit.full', { n: save.kits })
        : g.heal && !g.guard && SERVICE[u.sign.trade] !== 'eat' && pl.health >= 100 ? t('nl.panel.full') : '';
      const swap = g.gift && save.gift && save.gift !== g.id ? ` · ${t('st.gift.swap', { item: t(goodOf(save.gift)?.name ?? g.name) })}` : '';
      return { label: t(g.name), detail: describe(g, u.sign.trade) + swap, price: why || `¥${g.price}`, disabled: !!why, buy: () => { buy(u, g); if (panel.open) again(); } };
    });
  };
  const repairRows = (u: Unit, again: () => void): Row[] => {
    const v = engine.get<VehicleApi>('vehicle'), dmg = engine.get<DamageApi>('damage'), cash = missions()?.cash ?? 0;
    const far = !v || Math.hypot(v.car.pos.x - u.x, v.car.pos.z - u.z) > REPAIR_R;
    const price = repairPrice(dmg?.health() ?? 100);
    const why = !dmg || price <= 0 ? t('st.repair.fine') : far ? t('st.repair.far') : cash < price ? t('nl.panel.short', { n: price - cash }) : '';
    return [{ label: t('st.repair.row'), detail: t('st.repair.detail'), price: why || `¥${price}`, disabled: !!why, buy: () => {
      missions()?.addCash(-price); dmg!.repair(); save.bought++; store();
      engine.events.emit('street:buy', { trade: u.sign.trade, item: 'repair', price });
      toast(t('st.repair.done', { n: price }), 3);
      if (panel.open) again();
    } }];
  };
  const hotelRows = (u: Unit): Row[] => {
    const est = engine.get<EstateApi>('estate'), cash = missions()?.cash ?? 0;
    const why = !est ? '—' : est.sleepBlocked() ?? (cash < HOTEL_PRICE ? t('nl.panel.short', { n: HOTEL_PRICE - cash }) : '');
    return [{ label: t('st.hotel.row'), detail: t('st.hotel.detail'), price: why || `¥${HOTEL_PRICE}`, disabled: !!why, buy: () => {
      panel.close();
      if (est!.sleep()) return;
      missions()?.addCash(-HOTEL_PRICE); save.bought++; store();
      engine.events.emit('street:buy', { trade: u.sign.trade, item: 'room', price: HOTEL_PRICE });
    } }];
  };
  const lotteryRows = (u: Unit, again: () => void): Row[] => {
    const cash = missions()?.cash ?? 0, why = cash < TICKET_PRICE ? t('nl.panel.short', { n: TICKET_PRICE - cash }) : '';
    return [{ label: t('st.lottery.row'), detail: t('st.lottery.detail'), price: why || `¥${TICKET_PRICE}`, disabled: !!why, buy: () => {
      const m = missions(); if (!m) return;
      m.addCash(-TICKET_PRICE); save.bought++; store();
      const win = scratch(Math.random());
      if (win) m.addCash(win);
      engine.events.emit('street:buy', { trade: u.sign.trade, item: 'ticket', price: TICKET_PRICE });
      toast(win ? t('st.lottery.win', { n: win }) : t('st.lottery.lose'), 2.5);
      if (panel.open) again();
    } }];
  };
  const openShop = (u: Unit): boolean => {
    const name = u.sign.text, s = u.service, greet = t(`st.greet.${s}` as TKey);
    if (s === 'hair' || s === 'clothes') return engine.get<DistrictApi>('district')?.wearPanel(s, name, greet) ?? false;
    const again = (): boolean => {
      const rows = s === 'repair' ? repairRows(u, () => { again(); }) : s === 'hotel' ? hotelRows(u) : s === 'lottery' ? lotteryRows(u, () => { again(); }) : goodsRows(u, () => { again(); });
      return panel.render(name, s === 'eat' ? `${greet}  ·  ${albumLine()}` : greet, missions()?.cash ?? 0, rows, () => { open = null; });
    };
    open = u;
    if (!again()) { open = null; return false; }
    return true;
  };

  let scanT = 0;
  const api: StreetApi = {
    name: 'street',
    get gift() { return goodOf(save.gift); },
    giveGift() { const g = goodOf(save.gift); if (!g) return 0; save.gift = null; store(); return g.gift ?? 0; },
    get saved() { return save; },
    get busy() { return panel.open; },
    nearby(x, z, r) {
      const out: Unit[] = [], seen = new Set<Service>();
      scan(x, z, Math.min(r, 256), out);
      return out.filter((u) => !seen.has(u.service) && !!seen.add(u.service)).map((u) => ({ x: u.x + u.nx * 1.4, z: u.z + u.nz * 1.4, name: u.sign.text, service: u.service, d: u.d }));
    },
    debug: {
      near(x, z, r) { const out: Unit[] = []; scan(x, z, r, out); return out.map((u) => ({ x: u.x + u.nx * 1.4, z: u.z + u.nz * 1.4, sign: u.sign.text, trade: u.sign.trade, service: u.service })); },
      open(trade) {
        const P = pl.position, out: Unit[] = [];
        scan(P.x, P.z, 400, out);
        const u = out.find((o) => o.sign.trade === trade);
        return !!u && openShop(u);
      },
      buy(i) { const u = open; if (!u) return false; const g = (GOODS[u.sign.trade] ?? [])[i]; if (!g) return false; const b = save.bought; buy(u, g); return save.bought > b; },
      save: () => save,
      rows: () => [...document.querySelectorAll('.nl-panel:not([hidden]) .items button')].map((b) => (b as HTMLElement).innerText.replace(/\n/g, ' | ')),
    },
    update(dt) {
      const foot = pl.mode === 'onfoot' ? pl.foot : null;
      // a first-aid kit, by itself, when it is bad
      if (save.kits > 0 && pl.health > 0 && pl.health < KIT_AT && !engine.paused) {
        save.kits--; store();
        pl.heal?.(KIT_HEAL);
        toast(t('st.kit.used', { n: save.kits }), 3);
      }
      if (!foot || pl.riding || engine.get<UiApi>('ui')?.state !== 'playing') {
        if (at || near.length) { at = null; near.length = 0; showBadges(false); }
        return;
      }
      scanT -= dt;
      if (scanT <= 0) {
        scanT = 0.25;
        scan(foot.pos.x, foot.pos.z, BADGE_R, near);
        showBadges(true);
      }
      // the nearest one the player stands in front of (checked every frame: the offer must be made every frame)
      at = null;
      for (const u of near) if (inFront(u, foot.pos.x, foot.pos.z)) { at = u; break; }
      if (at) {
        const u = at;
        pl.offer?.({ x: u.x + u.nx * 1.2, z: u.z + u.nz * 1.2, r: FRONT + 0.6, label: t(`st.offer.${u.service}` as TKey, { shop: u.sign.text }), use: () => { openShop(u); } });
      }
    },
  };
  engine.add(api);
}
