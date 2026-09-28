import * as THREE from 'three';
import { addModel, LAMP, Mesher, surf, TONE_LOWER, TONE_UPPER, type Model, type Surf } from './Mesher';
import type { BodyParts, BodyType, Detail } from './Bodies';
import type { VehicleSpec } from './Spec';
import MOTO_MODEL from './models/moto.json';
import STREET from '../city/visual/street.json';

/**
 * The two-wheelers: a naked sports motorcycle and a city bicycle, built from primitives rather than
 * the car mesher's cap-and-wall shell (a bike is tubes, not panels). Same body frame as every car:
 * +Z forward, +X left, y = 0 at hub height. One wheel mesh at the origin, axle along X, drawn once per
 * axle at x = 0 (`VehicleSpec.single`). Paint goes through the same two tone buckets, so a taken bike
 * keeps its tank colour and traffic's parked ones vary like the cars.
 */
export type TwoWheeler = Extract<BodyType, 'moto' | 'bike'>;

/** Where the rider's pelvis sits, in the body frame. */
export const SEAT: Record<TwoWheeler, [number, number, number]> = { moto: [0, 0.6, -0.18], bike: [0, 0.7, -0.2] };

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _p = new THREE.Vector3(), _s = new THREE.Vector3();
const Y = new THREE.Vector3(0, 1, 0);

/** A cylinder from a to b of radius r (a tube of the frame, a fork leg, a bar). */
function tube(m: Mesher, s: Surf, a: [number, number, number], b: [number, number, number], r: number, seg = 8): void {
  const d = _p.set(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
  const len = d.length();
  _q.setFromUnitVectors(Y, d.normalize());
  _m.compose(_s.set((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2), _q, new THREE.Vector3(1, 1, 1));
  m.geo(s, new THREE.CylinderGeometry(r, r, len, seg), _m.clone());
}

function box(m: Mesher, s: Surf, at: [number, number, number], size: [number, number, number], pitch = 0): void {
  _m.makeRotationX(pitch).setPosition(at[0], at[1], at[2]);
  m.geo(s, new THREE.BoxGeometry(size[0], size[1], size[2]), _m.clone());
}

/** A torus (or an arc of one) with its axis along X at `at`: tyres, rims, mudguards. */
function ring(m: Mesher, s: Surf, at: [number, number, number], R: number, r: number, seg: number, tub: number, arc = Math.PI * 2, start = 0): void {
  _m.makeRotationZ(start).premultiply(new THREE.Matrix4().makeRotationY(Math.PI / 2)).setPosition(at[0], at[1], at[2]);
  m.geo(s, new THREE.TorusGeometry(R, r, seg, tub, arc), _m.clone());
}

function spokedWheel(r: number, tyreR: number, spokes: number, hi: boolean, alloy: boolean): Mesher {
  const m = new Mesher();
  const tyre = surf('trim', '#1a1a1b', 0.88, 0), rim = surf('trim', alloy ? '#2b2c2e' : '#c7cace', alloy ? 0.5 : 0.25, alloy ? 0.5 : 1);
  const hub = surf('trim', '#8e9297', 0.4, 0.8), disc = surf('trim', '#55585c', 0.35, 0.85);
  ring(m, tyre, [0, 0, 0], r - tyreR, tyreR, hi ? 10 : 5, hi ? 40 : 16);
  ring(m, rim, [0, 0, 0], r - tyreR * 2 - 0.006, 0.012, hi ? 6 : 4, hi ? 36 : 14);
  // Spokes: thin rods on a bicycle, plates on an alloy motorcycle wheel.
  const n = hi ? spokes : Math.max(3, Math.round(spokes / 2));
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, ro = r - tyreR * 2 - 0.01;
    if (alloy) box(m, rim, [0, Math.cos(a) * ro / 2, Math.sin(a) * ro / 2], [0.03, ro - 0.05, 0.045], -a);
    else tube(m, hub, [0.012 * (i % 2 ? 1 : -1), 0, 0], [0, Math.cos(a) * ro, Math.sin(a) * ro], 0.003, 4);
  }
  _m.makeRotationZ(Math.PI / 2).setPosition(0, 0, 0);
  m.geo(hub, new THREE.CylinderGeometry(alloy ? 0.07 : 0.035, alloy ? 0.07 : 0.035, alloy ? 0.14 : 0.08, 10), _m.clone());
  if (alloy) { _m.makeRotationZ(Math.PI / 2).setPosition(0.045, 0, 0); m.geo(disc, new THREE.CylinderGeometry(0.14, 0.14, 0.008, hi ? 24 : 12), _m.clone()); }
  return m;
}

/**
 * The motorcycle (2026-09-27): a naked sports bike modelled in Blender (scripts/blender/vehicles/moto.py) - a
 * pillowed tank and shrouds, seat and upswept tail, an aluminium twin-spar frame, an inline four with finned
 * cylinders, four headers into an upswept silencer, the shock's red spring, upside-down forks, an angular
 * headlamp under a flyscreen, indicators. It replaced a stack of boxes. The wheels are still built here.
 */
function moto(spec: VehicleSpec, detail: Detail): BodyParts {
  const m = new Mesher(), hi = detail === 'high';
  const zf = spec.wheels[0].z, r = spec.wheelRadius;
  addModel(m, MOTO_MODEL as Model, {
    paintU: surf('paint', '#ffffff', 0.3, 0, TONE_UPPER), paintL: surf('paint', '#ffffff', 0.34, 0, TONE_LOWER),
    black: surf('trim', '#141516', 0.6, 0), satin: surf('trim', '#8d9196', 0.35, 0.85), chrome: surf('trim', '#d5d8db', 0.12, 1),
    engine: surf('trim', '#2c2e31', 0.5, 0.6), seat: surf('trim', '#1d1d1f', 0.85, 0), spring: surf('trim', '#b8322a', 0.4, 0.3),
    plate: surf('trim', '#e0c23a', 0.5, 0),
    head: surf('lamp', '#ffffff', 0.08, 0.6, LAMP.head), tail: surf('lamp', '#ffffff', 0.12, 0.1, LAMP.tail), amber: surf('lamp', '#ffffff', 0.2, 0.1, LAMP.amber),
  });
  return {
    type: 'moto', body: m, wheel: spokedWheel(r, 0.062, 5, hi, true), wheelRear: null, dual: 0, calliper: null,
    headlamps: [new THREE.Vector3(-0.05, 0.655, zf - 0.05), new THREE.Vector3(0.05, 0.655, zf - 0.05)],
    size: { length: 2.1, width: 0.78, height: 1.1 },
  };
}

/**
 * The bicycle (2026-09-28): the street's shared bike modelled in Blender (scripts/blender/props/street.py `bikeRide`:
 * a step-through frame, front basket, mudguards, chain cover, the smart lock and QR plate, crank and pedals, the
 * saddle and bars where the rider's rig puts the pelvis and hands) and its moulded wheel (`bikeWheel`), both turned
 * from the model's frame (along +x, ground at y 0) into the body frame (+Z forward, y 0 at the hubs).
 */
function bike(spec: VehicleSpec, _detail: Detail): BodyParts {
  const r = spec.wheelRadius;
  const toBody = new THREE.Matrix4().set(0, 0, -1, 0, 0, 1, 0, -r, 1, 0, 0, 0, 0, 0, 0, 1);
  const turn = new THREE.Matrix4().set(0, 0, -1, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 1);
  const black = surf('trim', '#161718', 0.7, 0), steel = surf('trim', '#b9bcc0', 0.3, 0.9);
  const surfs: Record<string, Surf> = {
    frame: surf('paint', '#ffffff', 0.32, 0, TONE_UPPER), dark: black, tyre: surf('trim', '#1a1a1b', 0.88, 0), hub: steel,
    seat: surf('trim', '#1e1e20', 0.9, 0), lock: surf('trim', '#3a3d40', 0.5, 0.3), qr: surf('trim', '#e8e8e2', 0.5, 0),
    reflector: surf('trim', '#c8281f', 0.4, 0.2),
  };
  const m = new Mesher(), wheel = new Mesher();
  const street = STREET as unknown as Record<string, Model>;
  addModel(m, street.bikeRide, surfs, toBody);
  addModel(wheel, street.bikeWheel, surfs, turn);
  return {
    type: 'bike', body: m, wheel, wheelRear: null, dual: 0, calliper: null,
    headlamps: [], size: { length: 1.75, width: 0.6, height: 1.05 },
  };
}

export function buildTwoWheeler(type: TwoWheeler, spec: VehicleSpec, detail: Detail): BodyParts {
  return type === 'moto' ? moto(spec, detail) : bike(spec, detail);
}
