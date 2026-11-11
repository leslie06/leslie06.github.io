import type { Engine, System } from '../core/Engine';
import { lang, t } from '../core/I18n';
import type { HudApi, MissionApi, PlayerApi, RenderApi, WantedApi } from '../game/Contracts';
import { ShopPanel, type Row } from '../district/Panel';
import { shotMode } from '../debug/ShotMode';
import type { TravelApi } from './index';

/**
 * 坐地铁（2026-11-10，docs/street-level-design.md C3，「下车之后，几乎没事可做」）。地铁口的亭子全城有 694 个，原来只是
 * 摆设。徒步走到亭子开口前按 F：列出这一站所在线路上的各站（有亭子的才能去），选一站，付车费，黑一下屏，从那一站
 * 的一个口走出来。车留在原地——所以这不是「快速前往」那张表里的瞬移（「不能太杂，挑几个值得瞬移的场景」），是没车
 * 的时候在城里走动的办法；要车就用手机叫车行送。车费 ¥3 起，每 4 站加 ¥1，最多 ¥8；每站算 2.5 分钟，游戏里的钟
 * 跟着走。被通缉、任务不让走的时候不能坐。
 * 数据：`public/city/metro.json`（线路和站序）、`entrances.json`（亭子：位置、朝向、哪一站、哪个口）。
 */
interface MetroFile { lines: { ref: string; name: string; colour: string; st: [number, number, string][] }[] }
interface EntrancesFile { names: [string, string][]; e: [number, number, number, number, number, number, string][] }
interface Gate { x: number; z: number; yaw: number; len: number; station: number; exit: string }

const REACH = 3.2;
export const fareOf = (stops: number): number => Math.min(8, 3 + Math.floor(Math.abs(stops) / 4));
/** Game minutes a ride of `stops` takes. */
export const minutesOf = (stops: number): number => Math.round(Math.abs(stops) * 2.5 + 3);

export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search);
  if ((shotMode && q.get('metro') !== '1') || q.get('metro') === '0') return;
  const pl = engine.get<PlayerApi>('player');
  if (!pl) return;
  const BASE = import.meta.env.BASE_URL;
  let gates: Gate[] = [], names: [string, string][] = [];
  /** Per line: its name and the stations on it that have a kiosk, in order (indices into `names`). */
  let lines: { name: string; stops: number[] }[] = [];
  const load = async () => {
    const [m, e] = await Promise.all([fetch(`${BASE}city/metro.json`).then((r) => r.json() as Promise<MetroFile>), fetch(`${BASE}city/entrances.json`).then((r) => r.json() as Promise<EntrancesFile>)]);
    names = e.names;
    gates = e.e.filter((g) => g[5] >= 0).map(([x, z, yaw, len, , station, exit]) => ({ x, z, yaw, len, station, exit }));
    const idx = new Map(names.map((n, i) => [n[0], i]));
    const has = new Set(gates.map((g) => g.station));
    lines = m.lines.map((l) => ({ name: l.name, stops: l.st.map((s) => idx.get(s[2]) ?? -1).filter((i, k, a) => i >= 0 && has.has(i) && a.indexOf(i) === k) })).filter((l) => l.stops.length > 1);
  };
  engine.events.on('game:start', () => { void load().catch((err) => console.warn('[metro]', err)); });

  const panel = new ShopPanel(engine);
  const missions = () => engine.get<MissionApi>('missions');
  const toast = (s: string) => engine.get<HudApi>('hud')?.toast(s, 3);
  const nameOf = (i: number) => names[i]?.[lang() === 'zh' ? 0 : 1] ?? '';
  /** In front of a kiosk's open end (local +z), where F is offered and where a rider comes out. */
  const mouth = (g: Gate, out: number) => ({ x: g.x + Math.sin(g.yaw) * (g.len / 2 + out), z: g.z + Math.cos(g.yaw) * (g.len / 2 + out) });

  const ride = (from: Gate, to: number, stops: number) => {
    const m = missions(), fare = fareOf(stops);
    if (!m || m.cash < fare) return;
    const outs = gates.filter((g) => g.station === to);
    if (!outs.length) return;
    const g = outs[Math.floor(Math.random() * outs.length)], at = mouth(g, 2.6);
    panel.close();
    m.addCash(-fare);
    const r = engine.get<RenderApi>('render');
    if (r) r.timeOfDay = (r.timeOfDay + minutesOf(stops) / 60) % 24;
    engine.events.emit('metro:ride', { from: nameOf(from.station), to: nameOf(to), stops });
    void engine.get<TravelApi>('travel')?.land({ foot: { x: at.x, z: at.z, yaw: g.yaw }, caption: t('metro.arrive', { station: nameOf(to), exit: g.exit || '' }) });
  };
  const open = (g: Gate) => {
    if ((engine.get<WantedApi>('wanted')?.level ?? 0) > 0) { toast(t('travel.wanted')); return; }
    if (missions()?.travelBlocked?.()) { toast(t('travel.busy')); return; }
    const cash = missions()?.cash ?? 0, rows: Row[] = [];
    for (const l of lines) {
      const here = l.stops.indexOf(g.station);
      if (here < 0) continue;
      let first = true;   // the line's name over its first row
      l.stops.forEach((s, k) => {
        if (s === g.station) return;
        const stops = k - here, fare = fareOf(stops);
        rows.push({ label: nameOf(s), detail: t('metro.detail', { n: Math.abs(stops), m: minutesOf(stops) }), price: cash < fare ? t('nl.panel.short', { n: fare - cash }) : `¥${fare}`, disabled: cash < fare,
          section: first ? l.name : undefined, buy: () => ride(g, s, stops) });
        first = false;
      });
    }
    if (!rows.length) { toast(t('metro.none')); return; }
    panel.render(t('metro.sign', { station: nameOf(g.station) }), t('metro.greet'), cash, rows);
  };

  const sys: System = {
    name: 'metro',
    update() {
      const f = pl.mode === 'onfoot' ? pl.foot : null;
      if (!f || pl.riding || !gates.length) return;
      for (const g of gates) {
        if (Math.abs(g.x - f.pos.x) > 30 || Math.abs(g.z - f.pos.z) > 30) continue;
        const m = mouth(g, 1.2);
        if (Math.hypot(m.x - f.pos.x, m.z - f.pos.z) > REACH) continue;
        pl.offer?.({ x: m.x, z: m.z, r: REACH, label: t('metro.offer', { station: nameOf(g.station) }), use: () => open(g) });
        break;
      }
    },
  };
  engine.add(Object.assign(sys, { debug: { gates: () => gates, lines: () => lines.map((l) => ({ name: l.name, stops: l.stops.map(nameOf) })), mouth: (i: number) => mouth(gates[i], 1.2), open: (i: number) => open(gates[i]) } }));
}
