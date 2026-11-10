import * as THREE from 'three';
import type { Engine } from '../../core/Engine';
import type { RenderApi, WorldApi } from '../../game/Contracts';
import type { RenderSystem } from '../../render/RenderSystem';
import { loadCity, unpackSkyline, type Skyline, type SkylinePack } from '../Data';

/**
 * 楼顶大字（2026-11-10，docs/beijing-immersion-design.md A4）：北京的饭店、商场、写字楼楼顶立着红色的大字（「京伦饭店」
 * 「国贸大厦」），晚上通红，远远一看就知道到了哪儿。`places.json` 里的饭店、商场和名字像商业楼的写字楼（大厦、中心、
 * 广场、饭店……；部委、使馆、机关、学校、研究院不要），配上远景楼群（skyline.json，20 米以上）里 60 米内最近、够高
 * 的那栋，在楼顶两条长边的边沿各立一排字，朝外。镜头 1.6 公里内才建网格，2 公里外放掉。`?roofsigns=0` 关。
 */
export interface RoofSign { x: number; y: number; z: number; nx: number; nz: number; w: number; h: number; name: string }

const OFFICE_OK = /大厦|中心|广场|大楼|SOHO|商务|国际|集团|银行|保险|证券|酒店|饭店|宾馆|公寓|世贸|财富|环球|金融|写字楼/;
const NO = /中华人民共和国|八一|国防|武警|部队|中央|国家安全|号院|号楼|部$|局|委员会|大使馆|使馆|政府|法院|检察|公安|军|机关|招待所|研究院|研究所|学院|大学|学校|医院|协会|办公|党|人大|政协|国务院|总署|总局|管理/;
const NEAR = 1600, FAR = 2000;

/** Which places get a sign, and where (pure: Node-testable). `places`: places.json's rows, `sky`: the unpacked skyline. */
export function roofSigns(places: (string | number)[][], cats: string[], sky: number[]): RoofSign[] {
  const hotel = cats.indexOf('hotel'), mall = cats.indexOf('mall'), office = cats.indexOf('office');
  // skyline boxes in a 100 m grid
  const grid = new Map<string, number[]>();
  for (let o = 0; o < sky.length; o += 8) { const k = `${Math.floor(sky[o] / 100)}_${Math.floor(sky[o + 1] / 100)}`; (grid.get(k) ?? grid.set(k, []).get(k)!).push(o); }
  const used = new Set<number>(), out: RoofSign[] = [];
  for (const p of places) {
    const [x, z, c] = p as number[];
    let name = String(p[5] ?? '').replace(/[（(].*?[)）]/g, '').trim();
    if (!name || [...name].length > 8 || [...name].length < 2 || NO.test(name)) continue;
    if (c !== hotel && c !== mall && !(c === office && OFFICE_OK.test(name))) continue;
    const minH = c === office ? 35 : 22;
    let best = -1, bd = 60;
    for (let i = Math.floor(x / 100) - 1; i <= Math.floor(x / 100) + 1; i++) for (let j = Math.floor(z / 100) - 1; j <= Math.floor(z / 100) + 1; j++) {
      for (const o of grid.get(`${i}_${j}`) ?? []) {
        if (sky[o + 5] < minH || used.has(o)) continue;
        const d = Math.hypot(sky[o] - x, sky[o + 1] - z) - Math.max(sky[o + 3], sky[o + 4]);
        if (d < bd) { bd = d; best = o; }
      }
    }
    if (best < 0) continue;
    used.add(best);
    const o = best, a = sky[o + 2], hx = sky[o + 3], hz = sky[o + 4], H = sky[o + 5];
    // the box's local axes in the world (Skyline.ts: rotated by -a about +Y)
    const ax = [Math.cos(a), Math.sin(a)], az = [-Math.sin(a), Math.cos(a)];
    // the letters run along the long side and face out across the short one
    const long = hx >= hz, half = long ? hx : hz, depth = long ? hz : hx, across = long ? az : ax;
    const h = Math.max(2.4, Math.min(6, H * 0.05)), chars = [...name].length;
    const w = Math.min(half * 2 * 0.85, h * chars * 1.05);
    if (w < h * chars * 0.6) continue;   // too short a roof for the name
    for (const s of [1, -1]) {
      const nx = across[0] * s, nz = across[1] * s;
      out.push({ x: sky[o] + nx * (depth - 0.4), y: H + h / 2 + 0.4, z: sky[o + 1] + nz * (depth - 0.4), nx, nz, w, h, name });
    }
  }
  return out;
}

function nameTexture(name: string): THREE.CanvasTexture {
  const chars = [...name].length, H = 128, W = Math.ceil(chars * H * 1.05 / 4) * 4;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.font = `900 ${Math.round(H * 0.86)}px "PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC","Source Han Sans SC",sans-serif`;
  g.textAlign = 'center'; g.textBaseline = 'middle';
  // spread over the width whatever the font's own advance
  const step = W / chars;
  [...name].forEach((ch, i) => {
    g.lineWidth = H * 0.05; g.strokeStyle = 'rgba(70,8,6,0.9)'; g.strokeText(ch, step * (i + 0.5), H * 0.54);
    g.fillStyle = '#e2261e'; g.fillText(ch, step * (i + 0.5), H * 0.54);
  });
  const tex = new THREE.CanvasTexture(cv);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 4;
  return tex;
}

export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search);
  if (q.get('roofsigns') === '0' || !engine.get<WorldApi>('world')) return;
  const signs: RoofSign[] = [];
  let asked = false, waited = 0;
  const ask = () => void Promise.all([
    loadCity<{ cats: string[]; p: (string | number)[][] }>('places.json'),
    loadCity<Skyline | SkylinePack>('skyline.json').then(unpackSkyline),
  ]).then(([pl, sky]) => { signs.push(...roofSigns(pl.p, pl.cats, sky.b)); }).catch(() => { /* no signs */ });
  const render = engine.get<RenderSystem & RenderApi>('render');
  const root = new THREE.Group();
  root.name = 'roof-signs';
  engine.scene.add(root);
  const live = new Map<RoofSign, THREE.Mesh>();
  const mats = new Map<string, { mat: THREE.MeshStandardMaterial; refs: number }>();
  const matFor = (name: string) => {
    let m = mats.get(name);
    if (!m) {
      const tex = nameTexture(name);
      const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ff3a2a'), emissiveIntensity: 0.1, alphaTest: 0.5, roughness: 0.5, metalness: 0.1 });
      m = { mat, refs: 0 };
      mats.set(name, m);
    }
    m.refs++;
    return m.mat;
  };
  const release = (name: string) => {
    const m = mats.get(name);
    if (!m || --m.refs > 0) return;
    m.mat.map?.dispose(); m.mat.dispose(); mats.delete(name);
  };
  let poll = 0;
  engine.add({
    name: 'roofSigns',
    update(dt) {
      // not during the boot: the skyline is one of the extras the first drive does not wait for (shot mode: at once)
      if (!asked && (waited += dt) > (q.has('shot') ? 0 : 25)) { asked = true; ask(); }
      if ((poll -= dt) > 0 || !signs.length) return;
      poll = 1;
      const cam = engine.camera.position;
      for (const s of signs) {
        const d = Math.hypot(s.x - cam.x, s.z - cam.z), m = live.get(s);
        if (!m && d < NEAR) {
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), matFor(s.name));
          mesh.position.set(s.x, s.y, s.z);
          mesh.rotation.y = Math.atan2(s.nx, s.nz);
          render?.prepare?.(mesh);
          root.add(mesh);
          live.set(s, mesh);
        } else if (m && d > FAR) {
          root.remove(m); m.geometry.dispose(); release(s.name); live.delete(s);
        }
      }
      const n = render?.night ?? 0;
      for (const { mat } of mats.values()) mat.emissiveIntensity = 0.1 + 2.2 * n;
    },
  });
}
