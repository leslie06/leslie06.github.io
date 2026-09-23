import * as THREE from 'three';
import { LAMP, Mesher, surf, TONE_LOWER, TONE_UPPER, type Surf } from './Mesher';
import type { BodyParts, BodyType, Detail } from './Bodies';
import type { VehicleSpec } from './Spec';

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

function moto(spec: VehicleSpec, detail: Detail): BodyParts {
  const m = new Mesher(), hi = detail === 'high';
  const paint = surf('paint', '#ffffff', 0.3, 0, TONE_UPPER), paintL = surf('paint', '#ffffff', 0.34, 0, TONE_LOWER);
  const black = surf('trim', '#141516', 0.6, 0), satin = surf('trim', '#5a5d62', 0.4, 0.8), chrome = surf('trim', '#d5d8db', 0.12, 1);
  const engine = surf('trim', '#2c2e31', 0.5, 0.6), seat = surf('trim', '#1d1d1f', 0.85, 0);
  const head = surf('lamp', '#ffffff', 0.08, 0.6, LAMP.head), tail = surf('lamp', '#ffffff', 0.12, 0.1, LAMP.tail);
  const zf = spec.wheels[0].z, zr = spec.wheels[2].z, r = spec.wheelRadius;
  const headTop: [number, number, number] = [0, 0.72, 0.42], pivot: [number, number, number] = [0, 0.22, -0.3];
  // Frame: twin spars from the steering head back to the swingarm pivot, a down tube, the subframe.
  for (const sx of [-0.07, 0.07]) {
    tube(m, paintL, [sx, 0.68, 0.38], [sx, 0.28, -0.28], 0.028);
    tube(m, paintL, [sx, 0.3, -0.3], [sx, 0.52, -0.9], 0.02);
    tube(m, satin, [sx * 1.4, 0.22, -0.3], [sx * 1.4, 0.0, zr], 0.022);   // swingarm
  }
  tube(m, paintL, [0, 0.66, 0.4], [0, 0.06, 0.2], 0.028);
  // Engine and gearbox block, exhaust down the right and out the back.
  box(m, engine, [0, 0.2, 0.0], [0.4, 0.34, 0.44]);
  box(m, black, [0, 0.36, 0.1], [0.34, 0.06, 0.3]);
  tube(m, chrome, [-0.14, 0.12, 0.2], [-0.2, 0.3, -0.85], 0.038);
  // Tank, seat, rear cowl, tail lamp and plate.
  box(m, paint, [0, 0.58, 0.12], [0.36, 0.24, 0.52], 0.12);
  box(m, seat, [0, 0.61, -0.36], [0.3, 0.09, 0.62]);
  box(m, paintL, [0, 0.58, -0.78], [0.3, 0.14, 0.34], -0.25);
  box(m, tail, [0, 0.57, -0.95], [0.16, 0.06, 0.03]);
  box(m, black, [0, 0.42, -0.92], [0.02, 0.1, 0.16]);
  // Forks, yokes, bars, headlamp, mirrors, mudguards, pegs.
  for (const sx of [-0.1, 0.1]) {
    tube(m, chrome, [sx, 0.02, zf], [sx, 0.62, zf - 0.13], 0.02);
    tube(m, black, [sx, 0.62, zf - 0.13], [sx, 0.8, zf - 0.17], 0.026);
    tube(m, black, [sx * 2.2, 0.06, -0.15], [sx * 1.4, 0.06, -0.15], 0.012);   // footpegs
  }
  box(m, black, [0, 0.78, 0.47], [0.28, 0.06, 0.1]);
  tube(m, chrome, [-0.34, 0.86, 0.5], [0.34, 0.86, 0.5], 0.013);
  for (const sx of [-0.3, 0.3]) { tube(m, black, [sx, 0.87, 0.5], [sx * 1.15, 1.0, 0.44], 0.006); box(m, black, [sx * 1.15, 1.02, 0.43], [0.09, 0.06, 0.012]); }
  box(m, head, [0, 0.7, zf - 0.12], [0.2, 0.15, 0.05]);
  box(m, black, [0, 0.7, zf - 0.16], [0.24, 0.19, 0.05]);
  ring(m, paint, [0, 0, zf], r + 0.03, 0.045, 4, hi ? 14 : 8, 1.7, Math.PI / 2 - 0.85);
  ring(m, paintL, [0, 0, zr], r + 0.03, 0.045, 4, hi ? 12 : 7, 1.2, Math.PI / 2 - 0.6);
  headTop[0] = 0;
  return {
    type: 'moto', body: m, wheel: spokedWheel(r, 0.062, 5, hi, true), wheelRear: null, dual: 0, calliper: null,
    headlamps: [new THREE.Vector3(-0.05, 0.7, zf - 0.09), new THREE.Vector3(0.05, 0.7, zf - 0.09)],
    size: { length: 2.1, width: 0.78, height: 1.1 },
  };
}

function bike(spec: VehicleSpec, detail: Detail): BodyParts {
  const m = new Mesher(), hi = detail === 'high';
  const paint = surf('paint', '#ffffff', 0.32, 0, TONE_UPPER);
  const black = surf('trim', '#161718', 0.7, 0), steel = surf('trim', '#b9bcc0', 0.3, 0.9), saddle = surf('trim', '#1e1e20', 0.9, 0);
  const zf = spec.wheels[0].z, zr = spec.wheels[2].z, r = spec.wheelRadius;
  const bb: [number, number, number] = [0, -0.06, 0.02], seatTop: [number, number, number] = [0, 0.64, -0.2];
  const headTop: [number, number, number] = [0, 0.6, 0.36], headBot: [number, number, number] = [0, 0.44, 0.42];
  // The diamond frame.
  tube(m, paint, headTop, seatTop, 0.017);
  tube(m, paint, headBot, bb, 0.019);
  tube(m, paint, bb, seatTop, 0.017);
  tube(m, paint, headTop, headBot, 0.02);
  for (const sx of [-0.05, 0.05]) {
    tube(m, paint, [sx, -0.05, 0.02], [sx, 0, zr], 0.01);     // chain stays
    tube(m, paint, [sx * 0.6, 0.62, -0.2], [sx, 0, zr], 0.01);   // seat stays
    tube(m, steel, [sx * 0.8, 0.42, 0.43], [sx, 0, zf], 0.011);  // fork
  }
  // Saddle on its post, stem and bars.
  tube(m, steel, seatTop, [0, 0.72, -0.22], 0.012);
  box(m, saddle, [0, 0.73, -0.24], [0.15, 0.05, 0.27]);
  tube(m, steel, headTop, [0, 0.7, 0.4], 0.014);
  tube(m, black, [0, 0.7, 0.4], [0, 0.72, 0.5], 0.012);
  tube(m, black, [-0.27, 0.72, 0.48], [0.27, 0.72, 0.48], 0.012);
  // Crank, chainring, pedals, chain.
  tube(m, steel, [-0.08, -0.06, 0.02], [0.08, -0.06, 0.02], 0.012, 6);
  _m.makeRotationZ(Math.PI / 2).setPosition(-0.055, -0.06, 0.02);
  m.geo(steel, new THREE.CylinderGeometry(0.09, 0.09, 0.006, hi ? 24 : 10), _m.clone());
  for (const s of [-1, 1]) {
    tube(m, black, [s * 0.09, -0.06, 0.02], [s * 0.09, -0.06 + s * 0.16, 0.02 + s * 0.02], 0.009, 6);
    box(m, black, [s * 0.13, -0.06 + s * 0.16, 0.02 + s * 0.02], [0.08, 0.02, 0.06]);
  }
  tube(m, black, [-0.055, 0.03, 0.02], [-0.045, 0.03, zr], 0.005, 4);
  tube(m, black, [-0.055, -0.15, 0.02], [-0.045, -0.03, zr], 0.005, 4);
  // Mudguards, a rear rack and a reflector.
  ring(m, black, [0, 0, zf], r + 0.02, 0.035, 3, hi ? 12 : 7, 1.6, Math.PI / 2 - 0.9);
  ring(m, black, [0, 0, zr], r + 0.02, 0.035, 3, hi ? 12 : 7, 1.6, Math.PI / 2 - 0.7);
  box(m, black, [0, 0.5, -0.58], [0.14, 0.012, 0.3]);
  box(m, surf('trim', '#c8281f', 0.4, 0.2), [0, 0.5, -0.74], [0.05, 0.04, 0.01]);
  return {
    type: 'bike', body: m, wheel: spokedWheel(r, 0.022, 16, hi, false), wheelRear: null, dual: 0, calliper: null,
    headlamps: [], size: { length: 1.75, width: 0.56, height: 1.05 },
  };
}

export function buildTwoWheeler(type: TwoWheeler, spec: VehicleSpec, detail: Detail): BodyParts {
  return type === 'moto' ? moto(spec, detail) : bike(spec, detail);
}
