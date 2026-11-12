import type { Engine } from '../core/Engine';
import { lang } from '../core/I18n';
import type { PlayerApi, WorldApi } from '../game/Contracts';
import type { NavSystem } from '../nav';
import type { Name, Place } from '../nav/Places';
import { css, el } from './theme';
import { FAMOUS, famousAt } from '../city/Famous';

css(`
.hud .ptitle{position:absolute;left:50%;top:24%;transform:translate(-50%,6px);text-align:center;pointer-events:none;opacity:0;
  transition:opacity .9s,transform .9s;color:#fff;text-shadow:0 2px 10px rgba(0,0,0,.55),0 0 2px rgba(0,0,0,.6);white-space:nowrap}
.hud .ptitle.on{opacity:1;transform:translate(-50%,0)}
.hud .ptitle .main{font:700 44px/1.15 "Songti SC","STSong","Noto Serif SC","Noto Serif CJK SC","Source Han Serif SC",serif;letter-spacing:.22em;padding-left:.22em}
.hud .ptitle .rule{width:64px;height:2px;margin:9px auto 7px;background:rgba(255,255,255,.75);box-shadow:0 1px 4px rgba(0,0,0,.4)}
.hud .ptitle .sub{font:500 15px/1.3 system-ui,"PingFang SC",sans-serif;letter-spacing:.18em;opacity:.9}
.hud .ptitle.nosub .rule,.hud .ptitle.nosub .sub{display:none}
body.dc-touch .hud .ptitle{top:19%}
body.dc-touch .hud .ptitle .main{font-size:30px}
body.dc-touch .hud .ptitle .sub{font-size:12px}
body.cmp-cine .hud .ptitle{display:none}
`);

/** A district (区) from public/city/districts.json: its rings, [x, z, ...]. */
interface District { name: Name; rings: Float32Array[]; bb: [number, number, number, number] }

const SHOW_S = 3.6;
/** No title sooner than this after the last one (s)... */
const GAP_S = 20;
/** ...nor the same place again within this (s). */
const AGAIN_S = 600;
/** How near the centre of an area (by its OSM rank) counts as in it: a 街道/片区 point, a 小区 neighbourhood. */
const AREA_R = [0, 1100, 650, 450];
/** 离一座立交在 network.json 里的点这么近算开上了（米）。 */
const BRIDGE_R = 60;

const BASE: string = import.meta.env.BASE_URL ?? '/';
/** 截图模式不出（截图要确定），`?titles=1` 强制出；`?titles=0` 关掉。 */
const Q = new URLSearchParams(location.search);
const OFF = Q.get('titles') === '0' || (Q.has('shot') && Q.get('titles') !== '1');

function inRing(x: number, z: number, r: Float32Array): boolean {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const az = r[i + 1], bz = r[j + 1];
    if ((az > z) !== (bz > z) && x < (r[j] - r[i]) * (z - az) / (bz - az) + r[i]) c = !c;
  }
  return c;
}

/**
 * 地名标题（2026-11-09，docs/beijing-immersion-design.md A2：「让人能感觉在真实的北京城跑」）：开进一个有名字的片区
 * （OSM place=suburb|quarter|neighbourhood，`places.json` 的 area）屏幕中上方淡入「三里屯 · 朝阳区」，开上一座有名字
 * 的立交淡入「国贸桥 · 东三环中路」，跨区（区界 `districts.json`）时「朝阳区」；3.6 秒后淡出。两次之间至少 20 秒，
 * 同一个地方 10 分钟内不重复。GTA 的区域名做法：不看小地图也知道到了哪儿。
 */
export class PlaceTitle {
  private root: HTMLDivElement;
  private mainEl: HTMLDivElement;
  private subEl: HTMLDivElement;
  private poll = 1.5;
  private t = 0;
  private sinceAny = GAP_S;
  private clock = 0;
  private area: Place | null = null;
  private district: District | null = null;
  private bridge: string | null = null;
  /** 在哪条名片街上（city/Famous.ts 的序号 + 1，0 不在）。 */
  private famous = 0;
  private seen = new Map<string, number>();
  private districts: District[] | null = null;
  private loading = false;

  constructor(private engine: Engine, parent: HTMLElement) {
    this.root = el('div', 'ptitle', parent);
    this.mainEl = el('div', 'main', this.root);
    el('div', 'rule', this.root);
    this.subEl = el('div', 'sub', this.root);
  }

  private load(): void {
    if (this.loading) return;
    this.loading = true;
    fetch(`${BASE}city/districts.json`).then((r) => (r.ok ? r.json() : { d: [] })).then((d: { d: { zh: string; en: string; r: number[][] }[] }) => {
      this.districts = d.d.map((x) => {
        const rings = x.r.map((r) => Float32Array.from(r));
        const bb: [number, number, number, number] = [Infinity, Infinity, -Infinity, -Infinity];
        for (const r of rings) for (let i = 0; i < r.length; i += 2) { bb[0] = Math.min(bb[0], r[i]); bb[1] = Math.min(bb[1], r[i + 1]); bb[2] = Math.max(bb[2], r[i]); bb[3] = Math.max(bb[3], r[i + 1]); }
        return { name: { zh: x.zh, en: x.en || x.zh }, rings, bb };
      });
    }).catch(() => { this.districts = []; });
  }

  private districtAt(x: number, z: number): District | null {
    for (const d of this.districts ?? []) {
      if (x < d.bb[0] || x > d.bb[2] || z < d.bb[1] || z > d.bb[3]) continue;
      if (d.rings.some((r) => inRing(x, z, r))) return d;
    }
    return null;
  }

  /** The area the point is in: the nearest area point relative to its reach, held a little past it (hysteresis). */
  private areaAt(x: number, z: number, places: readonly Place[]): Place | null {
    let best: Place | null = null, bs = 1;
    for (const p of places) {
      if (p.cat !== 'area') continue;
      const R = AREA_R[p.rank] ?? 500, dx = p.x - x, dz = p.z - z;
      if (Math.abs(dx) > R || Math.abs(dz) > R) continue;
      const s = Math.hypot(dx, dz) / R * (p === this.area ? 0.8 : 1);
      if (s < bs) { bs = s; best = p; }
    }
    return best;
  }

  private show(key: string, main: string, sub: string): boolean {
    if (this.sinceAny < GAP_S) return false;
    const last = this.seen.get(key);
    if (last !== undefined && this.clock - last < AGAIN_S) return false;
    this.seen.set(key, this.clock);
    this.mainEl.textContent = main;
    this.subEl.textContent = sub;
    this.root.classList.toggle('nosub', !sub);
    this.t = SHOW_S;
    this.sinceAny = 0;
    return true;
  }

  update(dt: number): void {
    if (OFF) return;
    this.clock += dt; this.sinceAny += dt;
    if (this.t > 0) this.t -= dt;
    this.root.classList.toggle('on', this.t > 0);
    this.poll -= dt;
    if (this.poll > 0) return;
    this.poll = 0.5;
    if (!this.districts) this.load();
    const pl = this.engine.get<PlayerApi>('player'), nav = this.engine.get<NavSystem>('nav');
    if (!pl || !nav) return;
    const { x, z } = pl.position, en = lang() === 'en';
    const nm = (n: Name) => (en ? n.en || n.zh : n.zh);
    const dist = this.districtAt(x, z);
    const area = this.areaAt(x, z, nav.places);
    // An interchange the player drives onto (only in a car: on foot under one is no event).
    // 立交：车下的路段本身叫「国贸桥」（匝道和桥面在车道图里按立交命名），或者离 network 的立交点 60 米内
    const road = this.engine.get<WorldApi>('world')?.placeName?.(x, z) ?? '';
    const bridge = pl.mode === 'onfoot' ? null : /桥$/.test(road) ? (nav.bridgeAt(x, z, 400)?.zh === road ? nav.bridgeAt(x, z, 400) : { zh: road, en: road }) : nav.bridgeAt(x, z, BRIDGE_R);
    // 名片街：一进街就出街名（走廊里，离中线不超过街本身的宽度）
    const fam = famousAt(x, z, -Math.min(20, FAMOUS.reduce((a, f) => Math.min(a, f.r), 99) / 2));
    if (bridge && bridge.zh !== this.bridge) {
      this.show(`b:${bridge.zh}`, nm(bridge), dist ? nm(dist.name) : '');
    } else if (fam && fam !== this.famous) {
      this.show(`f:${FAMOUS[fam - 1].id}`, nm(FAMOUS[fam - 1].name), dist ? nm(dist.name) : '');
    } else if (area && area !== this.area) {
      this.show(`a:${area.name.zh}`, nm(area.name), dist ? nm(dist.name) : '');
    } else if (dist && dist !== this.district && this.district) {
      this.show(`d:${dist.name.zh}`, nm(dist.name), '');
    }
    this.bridge = bridge?.zh ?? null;
    this.famous = fam;
    this.area = area;
    if (dist) this.district = dist;
  }
}
