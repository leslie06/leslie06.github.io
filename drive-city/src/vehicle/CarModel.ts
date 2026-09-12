import * as THREE from 'three';
import type { VehicleSpec } from './Spec';
import { bodyOfSpec, buildBody, type BodyOptions, type BodyParts, type BodyType } from './Bodies';
import { fullMaterials, paintMetal, setLampState, type CarMaterials } from './CarMaterials';
import { LAMP, TONE_FIXED, TONE_LOWER, TONE_UPPER } from './Mesher';

export interface Livery {
  upper: string;
  lower: string;
  /** Roof light text and colours, or null for none. */
  roofSign: { text: string; sub: string; bg: string; fg: string } | null;
  plate: { text: string; bg: string; fg: string };
  doorText?: string;
  /** Door lettering colour (white by default). */
  doorColor?: string;
  /** Red and blue police light bar on the roof (flashed with setBeacons). */
  beacons?: boolean;
}

/** 北京出租车: golden-yellow top, dark-green bottom, TAXI roof light, blue 京B plate. */
export const TAXI_LIVERY: Livery = {
  upper: '#f3b50f', lower: '#1f5e3c',
  roofSign: { text: '出租', sub: 'TAXI', bg: '#fff6cf', fg: '#c01d17' },
  plate: { text: '京B·T6618', bg: '#1d49b5', fg: '#ffffff' },
  doorText: '北京出租汽车',
};

/** 北京公安: white with a blue waist, red-blue light bar, 公安 POLICE on the doors. */
export const POLICE_LIVERY: Livery = {
  upper: '#f4f5f3', lower: '#1c47a8',
  roofSign: null, beacons: true,
  plate: { text: '京A·0110警', bg: '#f2f2ee', fg: '#111111' },
  doorText: '公安 POLICE', doorColor: '#1c47a8',
};

/** 教练车: white with a blue waist, 教练 roof sign, yellow 学 plate. */
export const COACH_LIVERY: Livery = {
  upper: '#f1f2f0', lower: '#2b62b9',
  roofSign: { text: '教练', sub: 'COACH', bg: '#ffe45c', fg: '#1b1b1b' },
  plate: { text: '京A·0371学', bg: '#f2c21b', fg: '#111111' },
};

/** Private cars: one colour (traffic repaints it), blue 京 plate, no lettering. */
export const PRIVATE_LIVERY: Livery = {
  upper: '#b9bcbf', lower: '#b9bcbf', roofSign: null,
  plate: { text: '京N·8K2D6', bg: '#1d49b5', fg: '#ffffff' },
};

/** 北京公交: white over red, route 1 on the LED destination board, yellow plate. */
export const BUS_LIVERY: Livery = {
  upper: '#f2f1ea', lower: '#c3232b', roofSign: null,
  plate: { text: '京A·C1024', bg: '#f2c21b', fg: '#111111' },
  doorText: '北京公交', doorColor: '#ffffff',
};

/** Box truck: white cab, white box with a logistics name, yellow plate. */
export const TRUCK_LIVERY: Livery = {
  upper: '#e9ebea', lower: '#f4f5f4', roofSign: null,
  plate: { text: '京A·H3571', bg: '#f2c21b', fg: '#111111' },
  doorText: '城市配送 CITY LOGISTICS', doorColor: '#1f5fa8',
};

/** The livery a body type wears when nothing else says (traffic kits, a rebuilt player car). */
export function defaultLivery(body: BodyType): Livery {
  return body === 'sedan' ? TAXI_LIVERY : body === 'bus' ? BUS_LIVERY : body === 'truck' ? TRUCK_LIVERY : PRIVATE_LIVERY;
}

export function bodyOptions(l: Livery): BodyOptions {
  return { roofSign: !!l.roofSign, beacons: !!l.beacons, doorText: !!l.doorText, doorTextHigh: !!l.doorColor };
}

export interface CarModel {
  root: THREE.Group;
  /** Leans with weight transfer; wheels stay put. */
  body: THREE.Group;
  /** Hub pivots (steer about Y) and their spinning children (roll about X). */
  hubs: THREE.Group[];
  spinners: THREE.Group[];
  setLights(o: { brake: boolean; reverse: boolean; head: boolean }): void;
  /** Light-bar lamp brightness (emissive intensity), police liveries only. */
  setBeacons(red: number, blue: number): void;
  /** The two body paints (for per-instance tinting of traffic cars). */
  paint: { upper: THREE.Material; lower: THREE.Material };
  /** Taxi-only parts (roof sign, door lettering), to hide on private cars. */
  taxiParts: THREE.Material[];
  /** Repaint (the player took another car). Hides the taxi sign and lettering on private cars. */
  setPaint(upper: THREE.Color, lower: THREE.Color, taxi: boolean): void;
  /** Body type this model was built as. */
  readonly type: BodyType;
  /** Headlamp centres in the body frame (for the night beams). */
  readonly headlamps: THREE.Vector3[];
  /** Painted body extents, metres. */
  readonly size: { length: number; width: number; height: number };
  /** Free the GPU resources (a rebuilt player car). */
  dispose(): void;
}

/**
 * The full-detail car: a body shell from Bodies (rounded, bevelled panels with door seams, glass
 * with pillars and frames, lamp clusters, grille, mirrors, handles, plates) drawn with the car
 * materials (clearcoat paint, reflective glass, one trim material, one lamp material), and four
 * wheels with sidewalls, alloys, discs and callipers. ~9 draw calls. Body frame as in Spec: +Z
 * forward, +X left, y = 0 at hub height. `body` defaults to the spec's type (the taxi is a sedan).
 */
export function buildCar(spec: VehicleSpec, livery: Livery, body: BodyType = bodyOfSpec(spec)): CarModel {
  const parts = buildBody(body, spec, bodyOptions(livery), 'high');
  const mats = fullMaterials(livery);
  return assemble(parts, spec, mats);
}

function assemble(parts: BodyParts, spec: VehicleSpec, mats: CarMaterials): CarModel {
  const root = new THREE.Group();
  const bodyG = new THREE.Group();
  root.add(bodyG);
  const geos: THREE.BufferGeometry[] = [];
  const add = (g: THREE.BufferGeometry | null, mat: THREE.Material, parent: THREE.Object3D, shadow = true): THREE.Mesh | null => {
    if (!g) return null;
    geos.push(g);
    const m = new THREE.Mesh(g, mat);
    m.castShadow = shadow; m.receiveShadow = true;
    parent.add(m);
    return m;
  };
  const b = parts.body;
  add(b.build('paint', (k) => k === TONE_UPPER), mats.paintU, bodyG);
  add(b.build('paint', (k) => k === TONE_LOWER), mats.paintL, bodyG);
  add(b.build('paint', (k) => k === TONE_FIXED), mats.glass, bodyG);
  add(b.build('trim'), mats.trim, bodyG);
  add(b.build('lamp'), mats.lamp, bodyG);
  const taxiMesh = add(b.build('taxi'), mats.taxi, bodyG);

  const hubs: THREE.Group[] = [], spinners: THREE.Group[] = [];
  const wf = parts.wheel.build('trim'), wr = parts.wheelRear?.build('trim') ?? null, cal = parts.calliper?.build('trim') ?? null;
  if (wf) geos.push(wf);
  if (wr) geos.push(wr);
  if (cal) geos.push(cal);
  for (let i = 0; i < 4; i++) {
    const w = spec.wheels[i];
    const hub = new THREE.Group();
    hub.position.set(w.x, 0, w.z);
    const spin = new THREE.Group();
    hub.add(spin);
    const side = w.x > 0 ? 1 : -1;   // +X is the car's left; the rim faces outward
    const geo = !w.front && wr ? wr : wf!;
    const place = (dx: number) => {
      const m = new THREE.Mesh(geo, mats.wheel);
      m.castShadow = true; m.receiveShadow = true;
      if (side < 0) m.rotation.y = Math.PI;
      m.position.x = dx * side;
      spin.add(m);
    };
    if (!w.front && parts.dual > 0) { place(parts.dual / 2); place(-parts.dual / 2); }
    else place(0);
    if (cal) {
      const c = new THREE.Mesh(cal, mats.trim);
      if (side < 0) c.rotation.y = Math.PI;
      hub.add(c);
    }
    root.add(hub);
    hubs.push(hub); spinners.push(spin);
  }

  const levels = mats.lampLevels;
  const model: CarModel = {
    root, body: bodyG, hubs, spinners, type: parts.type, headlamps: parts.headlamps, size: parts.size,
    paint: { upper: mats.paintU, lower: mats.paintL },
    taxiParts: [mats.taxi],
    setPaint(upper, lower, taxi) {
      mats.paintU.color.copy(upper); mats.paintU.metalness = paintMetal(upper);
      mats.paintL.color.copy(lower); mats.paintL.metalness = paintMetal(lower);
      if (taxiMesh) taxiMesh.visible = taxi;
    },
    setBeacons(red, blue) { levels[LAMP.beaconR] = red; levels[LAMP.beaconB] = blue; },
    setLights(o) { setLampState(levels, o, false); },
    dispose() {
      for (const g of geos) g.dispose();
      for (const m of [mats.paintU, mats.paintL, mats.glass, mats.trim, mats.lamp, mats.taxi, mats.wheel]) m.dispose();
    },
  };
  model.setLights({ brake: false, reverse: false, head: false });
  return model;
}
