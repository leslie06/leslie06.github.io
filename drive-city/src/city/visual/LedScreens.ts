import * as THREE from 'three';
import type { Engine } from '../../core/Engine';
import type { RenderApi, WorldApi } from '../../game/Contracts';
import type { RenderSystem } from '../../render/RenderSystem';
import { loadCity, unpackSkyline, type Network, type Skyline, type SkylinePack } from '../Data';
import type { Routes } from '../Routes';

/**
 * 商圈的 LED 大屏（2026-11-10，docs/beijing-immersion-design.md A4）：三里屯、国贸、西单、王府井、五道口、中关村、前门这几个
 * 商圈，楼的外墙上挂着大屏，一刻不停地换广告，晚上整条街被它们照得发亮。每个商圈中心 450 米内，挑 20 米以上、离大路
 * （primary / trunk / secondary）最近的几栋楼（最多 4 栋，彼此隔 80 米），在朝着那条路的墙面上挂一块 16:9 的屏，
 * 放游戏自己的虚构广告（和交通台的广告是一家：蛮牛跑车、南锣鼓巷饺子馆、光华路大刘修车、B城交通台……），
 * 6 秒一换，颜色和字各不相同。镜头 900 米内才建、才重画。`?leds=0` 关。
 */
const DISTRICTS: [string, number, number][] = [
  ['三里屯', 4411, -2936], ['国贸', 4959, 202], ['西单', -2508, 344], ['王府井', 658, 209],
  ['五道口', -5625, -9200], ['中关村', -7445, -8218], ['前门', -395, 1174],
];
const ADS: { top: string; big: string; sub: string; bg: [string, string]; fg: string }[] = [
  { top: '蛮牛跑车', big: '5万', sub: '开出去 倍儿有面儿', bg: ['#ff3b1f', '#ffb000'], fg: '#ffffff' },
  { top: 'B城交通台', big: 'FM 99.6', sub: '陪您一路畅通', bg: ['#0a3cff', '#00d0ff'], fg: '#ffffff' },
  { top: '南锣鼓巷饺子馆', big: '皮薄馅大', sub: '开车累了 进来坐坐', bg: ['#b30d2a', '#ff7a3d'], fg: '#fff3d6' },
  { top: '光华路大刘修车', big: '手艺地道', sub: '价钱公道', bg: ['#14532d', '#22c55e'], fg: '#ffffff' },
  { top: 'B城追车', big: '跑遍北京', sub: '二环 三环 四环 五环', bg: ['#111827', '#7c3aed'], fg: '#fde047' },
  { top: '后海蓝莲花', big: '今晚驻唱', sub: '银锭桥边 不见不散', bg: ['#1e1b4b', '#2563eb'], fg: '#a5f3fc' },
];
const NEAR = 900, FAR = 1100;

export interface Screen { x: number; y: number; z: number; nx: number; nz: number; w: number; h: number; seed: number }

/** Where the screens go (pure): `sky` the unpacked skyline. */
export function screens(net: Network, sky: number[]): Screen[] {
  const out: Screen[] = [];
  for (const [, cx, cz] of DISTRICTS) {
    // the big roads round the centre, as segments
    const segs: number[] = [];
    for (const e of net.edges) {
      if (!/^(primary|trunk|secondary)$/.test(e.c) || e.br) continue;
      if (Math.abs(e.p[0] - cx) > 700 || Math.abs(e.p[1] - cz) > 700) continue;
      for (let i = 0; i + 3 < e.p.length; i += 2) segs.push(e.p[i], e.p[i + 1], e.p[i + 2], e.p[i + 3]);
    }
    const roadDist = (x: number, z: number): [number, number, number] => {
      let best = Infinity, bx = 0, bz = 0;
      for (let k = 0; k < segs.length; k += 4) {
        const ax = segs[k], az = segs[k + 1], vx = segs[k + 2] - ax, vz = segs[k + 3] - az, L2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)), px = ax + vx * t, pz = az + vz * t, d = Math.hypot(px - x, pz - z);
        if (d < best) { best = d; bx = px; bz = pz; }
      }
      return [best, bx, bz];
    };
    const cands: { o: number; d: number; rx: number; rz: number }[] = [];
    for (let o = 0; o < sky.length; o += 8) {
      if (sky[o + 5] < 20 || Math.hypot(sky[o] - cx, sky[o + 1] - cz) > 450) continue;
      const [d, rx, rz] = roadDist(sky[o], sky[o + 1]);
      if (d < 120) cands.push({ o, d: d - Math.max(sky[o + 3], sky[o + 4]), rx, rz });
    }
    cands.sort((a, b) => a.d - b.d);
    const picked: Screen[] = [];
    for (const c of cands) {
      if (picked.length >= 4) break;
      const o = c.o, a = sky[o + 2], hx = sky[o + 3], hz = sky[o + 4], H = sky[o + 5];
      // the face whose outward normal points at the road
      const axes: [number, number, number, number][] = [[Math.cos(a), Math.sin(a), hx, hz], [-Math.sin(a), Math.cos(a), hz, hx]];
      let best: [number, number, number, number] | null = null, bd = -Infinity;
      for (const [ux, uz, depth, along] of axes) for (const s of [1, -1]) {
        const nx = ux * s, nz = uz * s, dot = (c.rx - sky[o]) * nx + (c.rz - sky[o + 1]) * nz;
        if (dot > bd) { bd = dot; best = [nx, nz, depth, along]; }
      }
      const [nx, nz, depth, along] = best!;
      const w = Math.min(along * 2 * 0.7, 26), h = w * 9 / 16;
      if (w < 8 || H < h + 10) continue;
      const x = sky[o] + nx * (depth + 0.3), z = sky[o + 1] + nz * (depth + 0.3);
      if (picked.some((p) => Math.hypot(p.x - x, p.z - z) < 80)) continue;
      picked.push({ x, y: Math.min(H - h / 2 - 3, 10 + h / 2 + (o % 7)), z, nx, nz, w, h, seed: o });
    }
    out.push(...picked);
  }
  return out;
}

function draw(g: CanvasRenderingContext2D, W: number, H: number, ad: (typeof ADS)[number], t: number): void {
  const grad = g.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, ad.bg[0]); grad.addColorStop(1, ad.bg[1]);
  g.fillStyle = grad; g.fillRect(0, 0, W, H);
  // a light sweep across, so it is never quite still
  const sx = ((t * 0.37) % 1) * W * 1.6 - W * 0.3, sweep = g.createLinearGradient(sx - 80, 0, sx + 80, 0);
  sweep.addColorStop(0, 'rgba(255,255,255,0)'); sweep.addColorStop(0.5, 'rgba(255,255,255,0.25)'); sweep.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = sweep; g.fillRect(0, 0, W, H);
  const font = '"PingFang SC","Hiragino Sans GB","Microsoft YaHei","Noto Sans CJK SC",sans-serif';
  g.fillStyle = ad.fg; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 ${H * 0.13}px ${font}`; g.fillText(ad.top, W / 2, H * 0.2);
  g.font = `900 ${H * 0.34}px ${font}`; g.fillText(ad.big, W / 2, H * 0.52);
  g.font = `600 ${H * 0.11}px ${font}`; g.fillText(ad.sub, W / 2, H * 0.83);
}

export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search);
  if (q.get('leds') === '0') return;
  const net = engine.get<WorldApi & { routes?: Routes }>('world')?.routes?.net;
  if (!net) return;
  const list: Screen[] = [];
  let asked = false, waited = 0;
  const render = engine.get<RenderSystem & RenderApi>('render');
  const root = new THREE.Group();
  root.name = 'led-screens';
  engine.scene.add(root);
  const live = new Map<Screen, { mesh: THREE.Mesh; cv: HTMLCanvasElement; tex: THREE.CanvasTexture; mat: THREE.MeshStandardMaterial; shown: number }>();
  let poll = 0, clock = 0;
  engine.add({
    name: 'ledScreens',
    update(dt) {
      clock += engine.paused ? 0 : dt;
      if (!asked && (waited += dt) > (q.has('shot') ? 0 : 25)) {
        asked = true;
        void loadCity<Skyline | SkylinePack>('skyline.json').then(unpackSkyline).then((s) => { list.push(...screens(net, s.b)); }).catch(() => { /* none */ });
      }
      if ((poll -= dt) > 0 || !list.length) return;
      poll = engine.lite ? 1 : 0.25;
      const cam = engine.camera.position, night = render?.night ?? 0;
      for (const s of list) {
        const d = Math.hypot(s.x - cam.x, s.z - cam.z);
        let l = live.get(s);
        if (!l && d < NEAR) {
          const cv = document.createElement('canvas');
          cv.width = 512; cv.height = 288;
          const tex = new THREE.CanvasTexture(cv);
          tex.colorSpace = THREE.SRGBColorSpace;
          // redrawn four times a second: core/Assets.compact must not free its canvas
          tex.userData.keepImage = true;
          const mat = new THREE.MeshStandardMaterial({ color: '#000000', emissive: '#ffffff', emissiveMap: tex, roughness: 0.3 });
          const mesh = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.h), mat);
          mesh.position.set(s.x, s.y, s.z);
          mesh.rotation.y = Math.atan2(s.nx, s.nz);
          render?.prepare?.(mesh);
          root.add(mesh);
          l = { mesh, cv, tex, mat, shown: -1 };
          live.set(s, l);
        } else if (l && d > FAR) {
          root.remove(l.mesh); l.mesh.geometry.dispose(); l.tex.dispose(); l.mat.dispose(); live.delete(s);
          continue;
        }
        if (!l) continue;
        // a new ad every 6 s (each screen on its own beat), the sweep moving in between
        const ad = ADS[(Math.floor(clock / 6) + s.seed) % ADS.length];
        draw(l.cv.getContext('2d')!, l.cv.width, l.cv.height, ad, clock + s.seed);
        l.tex.needsUpdate = true;
        l.mat.emissiveIntensity = 0.55 - 0.2 * night;
      }
    },
  });
}
