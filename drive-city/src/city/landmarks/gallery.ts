import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { EnvUniforms, LandmarkDef, LandmarkModel } from '../../game/Contracts';
import { LANDMARKS } from './index';
import { pavingTex } from './kit/tex';

/**
 * Landmark preview (landmarks.html): one landmark at a time on a plaza, orbit camera, day/night.
 * URL: ?id=<landmark>&night=1&view=hero|close|far|top|back&lod=far. `?shot=1` hides the UI and
 * exposes window.__lm for scripts/landmark-shots.mjs. Lighting mirrors the game's render module:
 * ACES, a low south-west sun by day, moonlight and ~5.4x exposure at night.
 */
type View = 'hero' | 'close' | 'far' | 'top' | 'back';
/** Per-landmark hero azimuth (degrees from south towards east): the side the building is known from. */
const HINTS: Record<string, { az?: number; r?: number }> = { cctv: { az: -38 }, monument: { az: 200 }, station: { az: 200 }, huanqiu: { r: 48 } };
const q = new URLSearchParams(location.search);
const shot = q.has('shot');
if (shot) document.body.classList.add('shot');

const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance', preserveDrawingBuffer: shot });
renderer.setPixelRatio(shot ? 1 : Math.min(2, devicePixelRatio));
renderer.setSize(innerWidth, innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
document.getElementById('app')!.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.5, 9000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = !shot;

const env: EnvUniforms = { uNight: { value: 0 }, uWet: { value: 0 }, uTime: { value: 0 } };

// --- sky -----------------------------------------------------------------------------------------
const sunDir = new THREE.Vector3(-0.52, 0.44, 0.73).normalize();       // low, from the south-west
const moonDir = new THREE.Vector3(0.35, 0.55, 0.76).normalize();
const skyU = {
  uSunDir: { value: sunDir.clone() }, uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
  uGround: { value: new THREE.Color() }, uSun: { value: new THREE.Color() }, uGlow: { value: new THREE.Color() }, uDisc: { value: 22 },
};
const skyMat = new THREE.ShaderMaterial({
  uniforms: skyU, side: THREE.BackSide, depthWrite: false, fog: false,
  vertexShader: /* glsl */`varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0); gl_Position = p.xyww; }`,
  fragmentShader: /* glsl */`
    uniform vec3 uSunDir, uZenith, uHorizon, uGround, uSun, uGlow; uniform float uDisc; varying vec3 vDir;
    void main(){
      vec3 d = normalize(vDir); float h = d.y;
      float up = pow(clamp(h, 0.0, 1.0), 0.45);
      vec3 col = mix(uHorizon, uZenith, up);
      col += uGlow * pow(1.0 - clamp(h, 0.0, 1.0), 7.0);
      col = mix(col, uGround, smoothstep(0.0, -0.08, h));
      float mu = max(dot(d, uSunDir), 0.0);
      col += uSun * (0.28 * pow(mu, 6.0) + 0.5 * pow(mu, 64.0));
      col += uSun * uDisc * smoothstep(0.99955, 0.9998, mu);
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }`,
});
const sky = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 24), skyMat);
sky.scale.setScalar(6000); sky.frustumCulled = false; sky.renderOrder = -1000;
scene.add(sky);

const sun = new THREE.DirectionalLight('#ffe2bf', 4);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.05;
scene.add(sun, sun.target);
const hemi = new THREE.HemisphereLight('#c3d3e6', '#6e6556', 0.5);
scene.add(hemi);
scene.fog = new THREE.FogExp2('#c4c8c6', 0.00045);

// --- ground --------------------------------------------------------------------------------------
const groundMat = new THREE.MeshStandardMaterial({ color: '#8d8a82', roughness: 0.95 });
const ground = new THREE.Mesh(new THREE.PlaneGeometry(12000, 12000), groundMat);
ground.rotation.x = -Math.PI / 2; ground.receiveShadow = true;
scene.add(ground);
const pave = pavingTex().clone(); pave.repeat.set(200, 200); pave.needsUpdate = true;
const plaza = new THREE.Mesh(new THREE.PlaneGeometry(800, 800), new THREE.MeshStandardMaterial({ color: '#c4bfb4', map: pave, roughness: 0.9 }));
plaza.rotation.x = -Math.PI / 2; plaza.position.y = 0.01; plaza.receiveShadow = true;
scene.add(plaza);

// --- day / night ---------------------------------------------------------------------------------
const pmrem = new THREE.PMREMGenerator(renderer);
const envCache = new Map<string, THREE.Texture>();
function envMap(night: boolean): THREE.Texture {
  const key = night ? 'n' : 'd';
  let t = envCache.get(key);
  if (!t) {
    const es = new THREE.Scene();
    const s2 = new THREE.Mesh(sky.geometry, skyMat); s2.scale.setScalar(100); es.add(s2);
    const g = new THREE.Mesh(new THREE.CircleGeometry(90, 32), new THREE.MeshBasicMaterial({ color: night ? '#0a0a0c' : '#4a4843' }));
    g.rotation.x = -Math.PI / 2; g.position.y = -2; es.add(g);
    t = pmrem.fromScene(es, 0, 0.5, 400).texture;
    envCache.set(key, t);
  }
  return t;
}
let night = q.get('night') === '1';
function setNight(n: boolean): void {
  night = n;
  env.uNight.value = n ? 1 : 0;
  if (!n) {
    skyU.uZenith.value.set('#4a7cb6'); skyU.uHorizon.value.set('#d2d0c4'); skyU.uGround.value.set('#8b877c');
    skyU.uSun.value.set('#ffd9a6'); skyU.uGlow.value.set('#000000'); skyU.uDisc.value = 22; skyU.uSunDir.value.copy(sunDir);
    sun.color.set('#ffe2bf'); sun.intensity = 4.2; hemi.color.set('#c3d3e6'); hemi.groundColor.set('#6e6556'); hemi.intensity = 0.45;
    renderer.toneMappingExposure = 1.0;
    (scene.fog as THREE.FogExp2).color.set('#c4c8c6');
  } else {
    skyU.uZenith.value.set('#020409'); skyU.uHorizon.value.set('#0b0e17'); skyU.uGround.value.set('#050506');
    skyU.uSun.value.set('#141a28'); skyU.uGlow.value.set('#120c08'); skyU.uDisc.value = 3; skyU.uSunDir.value.copy(moonDir);
    sun.color.set('#a9bcff'); sun.intensity = 0.22; hemi.color.set('#1c2740'); hemi.groundColor.set('#0c0a09'); hemi.intensity = 0.03;
    renderer.toneMappingExposure = 5.4;
    (scene.fog as THREE.FogExp2).color.set('#07090e');
  }
  scene.environment = envMap(n);
  scene.environmentIntensity = n ? 1.0 : 1.0;
  fitSun();
}

// --- landmark ------------------------------------------------------------------------------------
const built = new Map<string, LandmarkModel>();
let current: { def: LandmarkDef; model: LandmarkModel } | null = null;
let forceFar = q.get('lod') === 'far';
const box = new THREE.Box3(), sphere = new THREE.Sphere();

function select(id: string): void {
  const def = LANDMARKS.find((d) => d.id === id) ?? LANDMARKS[0];
  if (current) scene.remove(current.model.group);
  let model = built.get(def.id);
  if (!model) {
    const t0 = performance.now();
    model = def.build(env);
    model.group.userData.buildMs = performance.now() - t0;
    model.group.rotation.y = -def.headingDeg * Math.PI / 180;
    model.group.updateMatrixWorld(true);
    built.set(def.id, model);
  }
  scene.add(model.group);
  current = { def, model };
  applyLod();
  // frame the building itself: the optional extras (bridges, columns) would push the camera away
  const detail = model.group.getObjectByName('detail')!;
  box.makeEmpty();
  for (const c of detail.children) if (c.name !== 'extras') box.expandByObject(c);
  box.getBoundingSphere(sphere);
  fitSun();
  refreshUi();
}
function applyLod(): void {
  const lod = current?.model.group.getObjectByName('lod') as THREE.LOD | undefined;
  if (!lod) return;
  lod.autoUpdate = !forceFar;
  if (forceFar) lod.levels.forEach((l, i) => { l.object.visible = i === lod.levels.length - 1; });
}
function fitSun(): void {
  const r = Math.max(40, sphere.radius * 1.15);
  const dir = night ? moonDir : sunDir;
  sun.target.position.copy(sphere.center);
  sun.position.copy(sphere.center).addScaledVector(dir, r * 2 + 60);
  const c = sun.shadow.camera;
  c.left = -r; c.right = r; c.top = r; c.bottom = -r; c.near = 1; c.far = r * 4 + 120;
  c.updateProjectionMatrix();
}
function frame(view: View): void {
  const size = box.getSize(new THREE.Vector3()), c = box.getCenter(new THREE.Vector3());
  const fov = THREE.MathUtils.degToRad(camera.fov);
  const flatR = Math.hypot(size.x, size.z) / 2;
  // fit the width, and the height for towers
  let dist = Math.max((flatR / Math.sin(fov / 2)) * 1.0, (size.y * 0.62) / Math.tan(fov / 2));
  const hint = HINTS[current?.def.id ?? ''] ?? {};
  if (hint.r) dist = (hint.r / Math.sin(fov / 2)) * 1.0;
  let az = hint.az ?? 28, el = 12, ty = size.y * 0.45;
  if (view === 'close') { dist = Math.max(45, Math.min(flatR * 1.1, 160)); el = 6; az = (hint.az ?? 20) - 8; ty = Math.min(size.y * 0.3, 24); }
  if (view === 'far') { dist = 1150; el = 4; }
  if (view === 'top') { el = 52; }
  if (view === 'back') { az = 205; }
  const a = THREE.MathUtils.degToRad(az), e = THREE.MathUtils.degToRad(el);
  controls.target.set(c.x, ty, c.z);
  camera.position.set(c.x + Math.sin(a) * Math.cos(e) * dist, ty + Math.sin(e) * dist, c.z + Math.cos(a) * Math.cos(e) * dist);
  camera.position.y = Math.max(1.7, camera.position.y);
  camera.near = Math.max(0.3, dist / 2000); camera.far = 9000; camera.updateProjectionMatrix();
  controls.update();
}

function render(): void {
  env.uTime.value = performance.now() / 1000;
  sky.position.copy(camera.position);
  renderer.render(scene, camera);
}
function stats() {
  const s = current?.model.group.userData.stats ?? {};
  return {
    id: current?.def.id, calls: renderer.info.render.calls, triangles: renderer.info.render.triangles,
    model: s, buildMs: Math.round(current?.model.group.userData.buildMs ?? 0), height: current?.model.height,
    colliders: current?.model.colliders.length,
  };
}

// --- UI ------------------------------------------------------------------------------------------
const ui = document.getElementById('ui')!;
function refreshUi(): void {
  if (shot) return;
  const st = stats();
  ui.innerHTML = `<h1>b城追车<em>地标</em></h1>
  <div class="list">${LANDMARKS.map((d) => `<button data-id="${d.id}" class="${d.id === current?.def.id ? 'on' : ''}">${d.name.zh}</button>`).join('')}</div>
  <div class="row"><button data-act="night" class="${night ? 'on' : ''}">夜 night (N)</button><button data-act="far" class="${forceFar ? 'on' : ''}">far LOD (L)</button>
  ${(['hero', 'close', 'far', 'top', 'back'] as View[]).map((v) => `<button data-view="${v}">${v}</button>`).join('')}</div>
  <div id="stats">${current ? `${current.def.name.zh} ${current.def.name.en}\nlat ${current.def.lat} lon ${current.def.lon} hdg ${current.def.headingDeg}\nh ${current.model.height} m  tris ${st.model.triangles} calls ${st.model.drawCalls}\nfar tris ${st.model.farTriangles} calls ${st.model.farDrawCalls}  build ${st.buildMs} ms` : ''}</div>`;
}
ui.addEventListener('click', (e) => {
  const b = (e.target as HTMLElement).closest('button'); if (!b) return;
  if (b.dataset.id) { select(b.dataset.id); frame('hero'); history.replaceState(null, '', `?id=${b.dataset.id}${night ? '&night=1' : ''}`); }
  if (b.dataset.act === 'night') setNight(!night);
  if (b.dataset.act === 'far') { forceFar = !forceFar; applyLod(); }
  if (b.dataset.view) frame(b.dataset.view as View);
  refreshUi();
});
addEventListener('keydown', (e: KeyboardEvent) => {
  if (e.key === 'n' || e.key === 'N') { setNight(!night); refreshUi(); }
  if (e.key === 'l' || e.key === 'L') { forceFar = !forceFar; applyLod(); refreshUi(); }
});
addEventListener('resize', () => { renderer.setSize(innerWidth, innerHeight); camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); });

setNight(night);
select(q.get('id') ?? LANDMARKS[0].id);
frame((q.get('view') as View) ?? 'hero');
if (!shot) renderer.setAnimationLoop(() => { controls.update(); render(); });

declare global { interface Window { __lm?: unknown } }
window.__lm = {
  ids: LANDMARKS.map((d) => d.id),
  async show(id: string, o: { night?: boolean; view?: View; far?: boolean } = {}) {
    forceFar = !!o.far;
    select(id);
    setNight(!!o.night);
    frame(o.view ?? 'hero');
    await renderer.compileAsync(scene, camera);
    render(); render();
    return stats();
  },
  /** Every landmark, every level: triangles, draw calls, and any NaN / zero-length attribute (must be none). */
  audit() {
    const out: Record<string, unknown> = {};
    for (const def of LANDMARKS) {
      let model = built.get(def.id);
      if (!model) { model = def.build(env); model.group.rotation.y = -def.headingDeg * Math.PI / 180; built.set(def.id, model); }
      let nan = 0, zeroNormals = 0, verts = 0;
      model.group.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        for (const name of ['position', 'normal', 'uv', 'aGlow']) {
          const a = m.geometry.getAttribute(name) as THREE.BufferAttribute | undefined;
          if (!a) continue;
          for (let i = 0; i < a.count; i++) {
            let len = 0;
            for (let k = 0; k < a.itemSize; k++) { const x = a.array[i * a.itemSize + k]; if (!Number.isFinite(x)) nan++; len += x * x; }
            if (name === 'normal' && len < 1e-8) zeroNormals++;
            if (name === 'position') verts++;
          }
        }
      });
      out[def.id] = { ...model.group.userData.stats, verts, nan, zeroNormals, colliders: model.colliders.length, footprint: model.footprint.length, height: model.height };
    }
    return out;
  },
  ready: true,
};
