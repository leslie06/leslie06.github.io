import * as THREE from 'three';
import type { Engine } from '../../core/Engine';
import type { RenderApi, WorldApi } from '../../game/Contracts';
import { loadCity, unpackSkyline, type Skyline, type SkylinePack } from '../Data';
import { seasonAt } from '../../render/Season';

/**
 * 供暖季楼顶的白汽（2026-11-10，docs/beijing-immersion-design.md D1）：北京 11 月 15 日起集中供暖，冷天的早上一栋栋
 * 住宅楼顶冒白汽。远景楼群（skyline.json，20 米以上的楼）里挑一成多的住宅楼，镜头 1.8 公里内最近的 PLUMES 栋各冒一缕：
 * 几团软的白雾从楼顶升起、变大、顺风飘散，全在顶点着色器里动（一次 draw call）。早上最浓，白天淡，晚上被城市的灯
 * 映成暖灰。供暖季：11 月 15 日到 3 月 15 日；`?steam=1` 强制打开、`?steam=0` 关；shot mode 默认关。
 */
const PLUMES = 40, PUFFS = 6;
const RANGE = 1800;

export function heatingSeason(day: number): boolean { return day >= 318 || day <= 73; }

const VERT = /* glsl */`
attribute vec4 aBase;   // x, y (roof), z, seed
attribute float aPuff;  // 0..PUFFS-1
uniform float uTime;
uniform vec2 uWind;
uniform float uAmount;
varying float vAlpha;
varying vec2 vUv;
varying float vSeed;
void main() {
  vUv = position.xy + 0.5;
  float seed = aBase.w;
  float ph = fract(uTime * (0.045 + 0.02 * seed) + aPuff / ${PUFFS.toFixed(1)} + seed * 7.0);
  float rise = ph * (22.0 + 12.0 * seed);
  float size = 4.5 + ph * (15.0 + 7.0 * seed);
  vec3 c = aBase.xyz + vec3(uWind.x, 0.0, uWind.y) * ph * (14.0 + 10.0 * seed) + vec3(0.0, rise, 0.0);
  c.x += sin(ph * 6.0 + seed * 20.0) * 1.2;
  vec4 mv = viewMatrix * vec4(c, 1.0);
  mv.xy += position.xy * size;
  float dist = -mv.z;
  vAlpha = uAmount * smoothstep(0.0, 0.15, ph) * (1.0 - ph) * (1.0 - smoothstep(${(RANGE * 0.6).toFixed(1)}, ${RANGE.toFixed(1)}, dist)) * step(0.5, aBase.y);
  vSeed = seed + aPuff * 0.37;
  gl_Position = projectionMatrix * mv;
}`;

const FRAG = /* glsl */`
uniform vec3 uColor;
varying float vAlpha;
varying vec2 vUv;
varying float vSeed;
float h(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f); return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + 1.0), f.x), f.y); }
void main() {
  vec2 d = vUv - 0.5;
  float r = length(d) * 2.0;
  float blob = (1.0 - smoothstep(0.35, 1.0, r)) * (0.65 + 0.35 * n(vUv * 4.0 + vSeed * 13.0));
  float a = blob * vAlpha * 0.8;
  if (a < 0.004) discard;
  // lit from above: the underside a little grey
  gl_FragColor = vec4(uColor * mix(0.8, 1.05, vUv.y), a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export function install(engine: Engine): void {
  const q = new URLSearchParams(location.search), forced = q.get('steam');
  if (forced === '0' || !engine.get<WorldApi>('world')) return;
  if (forced !== '1' && (q.has('shot') || !heatingSeason(seasonAt().day))) return;
  const render = engine.get<RenderApi>('render');
  const n = (engine.lite ? PLUMES / 2 : PLUMES) * PUFFS;
  const quad = new THREE.PlaneGeometry(1, 1);
  const geo = new THREE.InstancedBufferGeometry();
  geo.index = quad.index;
  geo.setAttribute('position', quad.getAttribute('position'));
  const base = new THREE.InstancedBufferAttribute(new Float32Array(n * 4), 4);
  base.setUsage(THREE.DynamicDrawUsage);
  const puff = new THREE.InstancedBufferAttribute(new Float32Array(n).map((_, i) => i % PUFFS), 1);
  geo.setAttribute('aBase', base);
  geo.setAttribute('aPuff', puff);
  geo.instanceCount = n;
  const uniforms = { uTime: { value: 0 }, uWind: { value: new THREE.Vector2(0.8, 0.35) }, uAmount: { value: 1 }, uColor: { value: new THREE.Color() } };
  const mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, uniforms, transparent: true, depthWrite: false });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 2;
  mesh.name = 'steam';
  engine.scene.add(mesh);

  // the candidates: one residential tower in eight or so, picked by its own random number (the same every visit)
  let cand: Float32Array | null = null, asked = false, waited = 0;
  // not during the boot: the skyline (0.36 MB) is one of the extras the first drive does not wait for
  const ask = () => void loadCity<Skyline | SkylinePack>('skyline.json').then(unpackSkyline).then((s) => {
    const out: number[] = [];
    for (let i = 0; i < s.b.length; i += 8) if (s.b[i + 6] === 2 && s.b[i + 7] < 0.12 && s.b[i + 5] >= 20) out.push(s.b[i], s.b[i + 5], s.b[i + 1], s.b[i + 7] / 0.12);
    cand = Float32Array.from(out);
  }).catch(() => { /* no skyline: no steam */ });

  let poll = 0;
  const near: number[] = [];
  engine.add({
    name: 'steam',
    update(dt) {
      uniforms.uTime.value += engine.paused ? 0 : dt;
      if (!asked && (waited += dt) > (forced === '1' ? 0 : 25)) { asked = true; ask(); }
      const hour = render?.timeOfDay ?? 12, night = render?.night ?? 0;
      // thick in the cold morning, thin by afternoon; the city's glow tints it at night
      const morning = Math.max(0, 1 - Math.abs(hour - 7.5) / 4);
      uniforms.uAmount.value = (0.45 + 0.55 * morning) * (1 - 0.6 * (render?.rain ?? 0));
      const haze = render?.hazeColor;
      uniforms.uColor.value.setRGB(0.88, 0.89, 0.92).multiplyScalar(1 - 0.75 * night);
      if (haze) uniforms.uColor.value.lerp(haze, 0.25);
      if ((poll -= dt) > 0 || !cand) return;
      poll = 1;
      const cam = engine.camera.position, c = cand, a = base.array as Float32Array;
      near.length = 0;
      for (let i = 0; i < c.length; i += 4) {
        const d = Math.hypot(c[i] - cam.x, c[i + 2] - cam.z);
        if (d < RANGE) near.push(d, i);
      }
      // the nearest ones (pairs of distance, index)
      const idx = Array.from({ length: near.length / 2 }, (_, k) => k).sort((x, y) => near[x * 2] - near[y * 2]);
      const plumes = n / PUFFS;
      for (let p = 0; p < plumes; p++) {
        const k = idx[p];
        for (let j = 0; j < PUFFS; j++) {
          const o = (p * PUFFS + j) * 4;
          if (k === undefined) { a[o + 1] = 0; continue; }
          const i = near[k * 2 + 1];
          a[o] = c[i]; a[o + 1] = c[i + 1] + 1; a[o + 2] = c[i + 2]; a[o + 3] = c[i + 3];
        }
      }
      base.needsUpdate = true;
    },
  });
}
