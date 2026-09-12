import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar, defaultLivery, POLICE_LIVERY, TAXI_LIVERY, type Livery } from './CarModel';
import { BODY_TYPES, type BodyType } from './Bodies';
import { SPEC_OF } from './Spec';
import { CarKit } from '../traffic/CarKit';
import type { Vehicle } from './Vehicle';

/**
 * Body lab (dev only, `/src/vehicle/lab.html`): the car models on a plain lot, without the city,
 * for fast iteration on shapes and materials. `?view=hero|rear|side|chase|top|lineup|lineupRear`,
 * `?type=sedan`, `?night=1`, `?livery=taxi|police|private`. Sets `window.__labReady` when drawn.
 */
const q = new URLSearchParams(location.search);
const view = q.get('view') ?? 'hero';
const night = q.has('night');
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(1);
renderer.setSize(innerWidth, innerHeight);
renderer.toneMapping = THREE.AgXToneMapping;
renderer.toneMappingExposure = night ? 1.6 : 1.0;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
document.body.appendChild(renderer.domElement);
const scene = new THREE.Scene();
const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.03).texture;
scene.environmentIntensity = night ? 0.04 : 0.9;
scene.background = new THREE.Color(night ? '#05070c' : '#a9c1d6');
const sun = new THREE.DirectionalLight('#fff4e0', night ? 0 : 3.2);
sun.position.set(-9, 14, 7);
sun.castShadow = true;
sun.shadow.mapSize.set(4096, 4096);
Object.assign(sun.shadow.camera, { left: -16, right: 16, top: 16, bottom: -16, near: 1, far: 60 });
sun.shadow.bias = -0.0004;
sun.shadow.normalBias = 0.02;
scene.add(sun, new THREE.HemisphereLight(night ? '#1a2233' : '#cfe3ff', '#4a4640', night ? 0.15 : 0.6));
if (night) for (const [x, z] of [[-6, 4], [8, -3], [0, 12]]) { const l = new THREE.PointLight('#ffd6a0', 60, 30, 1.6); l.position.set(x, 6, z); scene.add(l); }
const ground = new THREE.Mesh(new THREE.PlaneGeometry(300, 300), new THREE.MeshStandardMaterial({ color: '#4d5054', roughness: 0.92 }));
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
scene.add(ground);
for (let z = -40; z < 40; z += 6) {
  const m = new THREE.Mesh(new THREE.PlaneGeometry(0.15, 3), new THREE.MeshStandardMaterial({ color: '#d8d8d0', roughness: 0.7 }));
  m.rotation.x = -Math.PI / 2; m.position.set(-3.4, 0.002, z); scene.add(m);
}

const liveryOf = (t: BodyType): Livery => {
  const l = q.get('livery');
  return l === 'police' ? POLICE_LIVERY : l === 'taxi' ? TAXI_LIVERY : l === 'private' ? { ...defaultLivery('hatch'), upper: '#26344f', lower: '#26344f' } : defaultLivery(t);
};
const place = (t: BodyType, livery: Livery, x: number, z: number, yaw: number, taxi = true) => {
  const spec = SPEC_OF[t];
  const car = buildCar(spec, livery, t);
  car.root.position.set(x, spec.wheelRadius, z);
  car.root.rotation.y = yaw;
  if (!taxi) car.setPaint(new THREE.Color(livery.upper), new THREE.Color(livery.upper), false);
  car.setLights({ brake: q.has('brake'), reverse: false, head: night });
  if (livery.beacons) car.setBeacons(q.has('flash') ? 8 : 0.25, 0.25);
  scene.add(car.root);
  return car;
};

const camera = new THREE.PerspectiveCamera(40, innerWidth / innerHeight, 0.1, 500);
const type = (q.get('type') ?? 'sedan') as BodyType;
if (view === 'kit' || view === 'kitRear') {
  // The traffic path: one CarKit per type, three instances each (taxi / private, brake on / off).
  const colours = ['#f2f2ef', '#161718', '#8c1d1d', '#26344f', '#b9bcbf'];
  let x = -9;
  for (const t of BODY_TYPES) {
    const spec = SPEC_OF[t];
    const kit = new CarKit(scene, 4, defaultLivery(t), t);
    console.log(`kit ${t}: ${kit.drawCalls} calls, ${kit.triangles} tris/car`);
    const w = t === 'bus' ? 3.2 : t === 'truck' ? 2.9 : 2.4;
    for (let i = 0; i < 3; i++) {
      const stub = { spec, brake: i === 1 ? 1 : 0, speed: 0, throttle: 1, handbrake: false, gear: i === 2 ? -1 : 1,
        wheels: spec.wheels.map(() => ({ springLen: spec.mountY, spin: i * 0.7, steer: i === 0 ? 0.3 : 0 })) } as unknown as Vehicle;
      const taxi = t === 'sedan' && i !== 2;
      const up = new THREE.Color(taxi ? '#f3b50f' : t === 'bus' ? '#f2f1ea' : colours[(i + t.length) % colours.length]);
      const lo = new THREE.Color(taxi ? '#1d49b5' : t === 'bus' ? '#c3232b' : t === 'truck' ? '#f4f5f4' : up.getStyle());
      kit.set(i, new THREE.Vector3(x, spec.wheelRadius, i * (t === 'bus' ? -14 : -7)), new THREE.Quaternion(), stub, up, lo, taxi);
    }
    kit.commit(3);
    kit.setHeadlights(night);
    x += w + 0.6;
  }
  const back = view === 'kitRear' ? -1 : 1;
  camera.position.set(8, 4.5, back * 16);
  camera.lookAt(0, 0.8, back * -2);
} else if (view === 'lineup' || view === 'lineupRear') {
  const types = (q.get('types')?.split(',') as BodyType[] | undefined) ?? BODY_TYPES.filter((t) => SPEC_OF[t]);
  let x = 0;
  const xs: number[] = [];
  for (const t of types) { const w = t === 'bus' ? 3.2 : t === 'truck' ? 2.9 : 2.5; xs.push(x + w / 2); x += w; }
  types.forEach((t, i) => place(t, liveryOf(t), xs[i] - x / 2, 0, 0));
  place('sedan', POLICE_LIVERY, x / 2 + 1.5, 0, 0);
  const back = view === 'lineupRear' ? -1 : 1;
  camera.position.set(x * 0.35, 3.2, back * (x * 0.9 + 4));
  camera.lookAt(0, 0.9, 0);
} else {
  place(type, liveryOf(type), 0, 0, 0, q.get('livery') !== 'private');
  const spec = SPEC_OF[type];
  const L = buildCar(spec, liveryOf(type), type).size.length / 2 + 0.9;
  const at = new THREE.Vector3(0, 0.55 + spec.wheelRadius * 0.6, 0);
  if (view === 'hero') camera.position.set(L * 1.0, 1.25, L * 1.25);
  else if (view === 'rear') camera.position.set(-L * 0.95, 1.35, -L * 1.25);
  else if (view === 'side') { camera.position.set(L * 2.1, 1.0, 0); camera.fov = 32; }
  else if (view === 'chase') { camera.position.set(0, 2.5, -6.9); at.set(0, 1.05, 2); camera.fov = 62; }
  else if (view === 'top') { camera.position.set(0.01, L * 2.4, 0); }
  else if (view === 'front') camera.position.set(0.4, 1.0, L * 2);
  camera.updateProjectionMatrix();
  camera.lookAt(at);
}
camera.updateProjectionMatrix();
let frames = 0;
renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
  if (++frames === 3) (window as unknown as { __labReady: boolean }).__labReady = true;
});
