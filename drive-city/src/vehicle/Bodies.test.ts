/**
 * Sanity checks for every body type on the shared physics (the taxi's handling suite pins the taxi;
 * this one keeps the other specs plausible): each type settles at its modelled ride height,
 * accelerates, stops straight, changes lanes at 60 km/h without lifting a wheel or flipping, and
 * its models fit the triangle budgets. Numbers land in `.scratch/bodies-report.txt`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import { Rig } from './Rig';
import { PathPilot } from './Autopilot';
import type { DriveInput } from './ControlFilter';
import { SPEC_OF } from './Spec';
import { BODY_TYPES, buildBody, type BodyType } from './Bodies';

const DT = 1 / 60, KMH = 3.6;
const deg = (r: number) => r * 180 / Math.PI;
const input = (o: Partial<DriveInput> = {}): DriveInput => ({ forward: 0, back: 0, steer: 0, analog: true, handbrake: false, ...o });
const report = new Map<BodyType, Record<string, number>>();
const put = (t: BodyType, k: string, v: number) => { const r = report.get(t) ?? {}; r[k] = v; report.set(t, r); };

/** Per type: speed to reach (km/h) and within how long, braking test speed and the longest stop. */
const EXPECT: Record<BodyType, { v: number; within: number; brakeFrom: number; stop: number; topMin: number }> = {
  sedan: { v: 100, within: 9, brakeFrom: 60, stop: 22, topMin: 165 },
  hatch: { v: 100, within: 11, brakeFrom: 60, stop: 22, topMin: 165 },
  suv: { v: 100, within: 11.5, brakeFrom: 60, stop: 23, topMin: 165 },
  mpv: { v: 100, within: 12.5, brakeFrom: 60, stop: 24, topMin: 160 },
  bus: { v: 50, within: 16, brakeFrom: 50, stop: 24, topMin: 70 },
  truck: { v: 60, within: 16, brakeFrom: 60, stop: 30, topMin: 90 },
};

const rigFor = (t: BodyType) => Rig.create({ spec: SPEC_OF[t], at: { x: 0, y: SPEC_OF[t].wheelRadius + 0.05, z: 0 } });

afterAll(() => {
  const keys = [...new Set([...report.values()].flatMap((r) => Object.keys(r)))];
  const w = Math.max(...keys.map((k) => k.length));
  const lines = ['BODY TYPES REPORT', `${''.padEnd(w)}  ${BODY_TYPES.map((t) => t.padStart(9)).join('')}`];
  for (const k of keys) lines.push(`${k.padEnd(w)}  ${BODY_TYPES.map((t) => { const v = report.get(t)?.[k]; return (v === undefined ? '-' : String(+v.toFixed(3))).padStart(9); }).join('')}`);
  fs.mkdirSync('.scratch', { recursive: true });
  fs.writeFileSync('.scratch/bodies-report.txt', lines.join('\n') + '\n');
});

describe.each(BODY_TYPES)('%s', (t) => {
  const spec = SPEC_OF[t], ex = EXPECT[t];

  it('settles at rest, level, at its modelled ride height', async () => {
    const rig = await rigFor(t);
    rig.settle(3);
    const c = rig.car;
    const load = c.wheels.reduce((a, w) => a + w.load, 0);
    const hSpeed = Math.hypot(c.vel.x, c.vel.z);
    const sag = Math.max(...c.wheels.map((w) => Math.abs(spec.mountY - w.springLen)));
    const lowest = Math.min(...spec.chassis.map((b) => b.at[1] - b.half[1])) + c.pos.y;
    put(t, 'rest.speed m/s', hSpeed); put(t, 'rest.load/weight', load / (spec.mass * 9.81));
    put(t, 'rest.hub y m', c.pos.y); put(t, 'rest.hub off model m', sag); put(t, 'rest.collider clearance m', lowest);
    expect(hSpeed).toBeLessThan(0.01);
    expect(c.wheels.every((w) => w.contact)).toBe(true);
    expect(Math.abs(load / (spec.mass * 9.81) - 1)).toBeLessThan(0.05);
    expect(c.up.y).toBeGreaterThan(0.999);
    // The model puts the hubs at mountY - springLen: at rest that must be ~0 (wheels in the arches).
    expect(sag).toBeLessThan(0.02);
    expect(Math.abs(c.pos.y - spec.wheelRadius)).toBeLessThan(0.03);
    expect(lowest).toBeGreaterThan(0.08);
  });

  it('accelerates and reaches a plausible top speed', async () => {
    const rig = await rigFor(t);
    rig.settle();
    const t0 = rig.time;
    let reached = NaN, minUp = 1, top = 0;
    // 40 s: the test ground is 3 km across, and a car at 185 km/h leaves it after ~60 s.
    for (let s = 0; s < 40; s += DT) {
      rig.stepInput(input({ forward: 1 }));
      if (isNaN(reached) && rig.car.forwardSpeed * KMH >= ex.v) reached = rig.time - t0;
      minUp = Math.min(minUp, rig.car.up.y);
      top = Math.max(top, rig.car.forwardSpeed * KMH);
    }
    put(t, `accel.0-${ex.v} s`, reached); put(t, 'accel.top km/h', top); put(t, 'accel.min up', minUp);
    expect(reached).toBeLessThan(ex.within);
    expect(top).toBeGreaterThan(ex.topMin);
    expect(top).toBeLessThan(spec.engine.limiterKmh + 6);
    expect(minUp).toBeGreaterThan(0.97);
  });

  it('stops straight under full braking', async () => {
    const rig = await rigFor(t);
    rig.settle();
    rig.launch(ex.brakeFrom / KMH);
    for (let i = 0; i < 12; i++) rig.stepInput(input());
    const x0 = rig.car.pos.clone(), h0 = Math.atan2(rig.car.fwd.x, rig.car.fwd.z);
    let s = 0;
    while (rig.car.speed > 0.3 && s < 15) { rig.stepInput(input({ back: 1 })); s += DT; }
    const dist = rig.car.pos.distanceTo(x0), lat = Math.abs(rig.car.pos.x - x0.x);
    const yaw = deg(Math.abs(Math.atan2(rig.car.fwd.x, rig.car.fwd.z) - h0));
    put(t, `brake.${ex.brakeFrom}-0 m`, dist); put(t, 'brake.lateral m', lat); put(t, 'brake.yaw deg', yaw);
    expect(dist).toBeLessThan(ex.stop);
    expect(dist).toBeGreaterThan(8);
    expect(lat).toBeLessThan(0.5);
    expect(yaw).toBeLessThan(3);
  });

  it('changes lanes at 60 km/h on all four wheels', async () => {
    const rig = await rigFor(t);
    rig.settle();
    rig.launch(60 / KMH);
    const path: [number, number][] = [];
    for (let z = 0; z <= 500; z += 2) {
      const u = z < 60 ? 0 : z < 100 ? (1 - Math.cos((z - 60) / 40 * Math.PI)) / 2 : z < 150 ? 1 : z < 190 ? (1 + Math.cos((z - 150) / 40 * Math.PI)) / 2 : 0;
      path.push([3.5 * u, z]);
    }
    const pilot = new PathPilot(path, { speed: 60 / KMH, lookahead: t === 'bus' ? 20 : 14, closed: false });
    let maxSlip = 0, maxCte = 0, minUp = 1, minGround = 4, maxRoll = 0;
    for (let s = 0; s < 14; s += DT) {
      rig.stepInput(pilot.update(rig.view(), DT));
      const c = rig.car;
      maxSlip = Math.max(maxSlip, Math.abs(c.bodySlip)); maxCte = Math.max(maxCte, pilot.crossTrack);
      minUp = Math.min(minUp, c.up.y); minGround = Math.min(minGround, c.grounded);
      maxRoll = Math.max(maxRoll, Math.abs(Math.asin(Math.max(-1, Math.min(1, c.left.y)))));
    }
    put(t, 'lane.max slip deg', deg(maxSlip)); put(t, 'lane.max track err m', maxCte);
    put(t, 'lane.max roll deg', deg(maxRoll)); put(t, 'lane.min wheels down', minGround); put(t, 'lane.speed end km/h', rig.car.forwardSpeed * KMH);
    expect(minUp).toBeGreaterThan(0.95);
    expect(minGround).toBe(4);
    expect(deg(maxSlip)).toBeLessThan(8);
    expect(maxCte).toBeLessThan(2);
  });

  it('fits the triangle and draw-call budgets (traffic < 10k / 8 calls, full detail < 40k)', () => {
    const opts = { roofSign: t === 'sedan', beacons: false, doorText: true, doorTextHigh: false };
    for (const [detail, max] of [['low', 10000], ['high', 40000]] as const) {
      const b = buildBody(t, spec, opts, detail);
      const wheels = spec.wheels.length + (b.dual > 0 ? 2 : 0);
      const tris = b.body.triangles() + wheels * b.wheel.triangles() + (b.calliper ? 4 * b.calliper.triangles() : 0);
      put(t, `tris.${detail}`, tris);
      expect(tris).toBeLessThan(max);
      if (detail !== 'low') continue;
      // What CarKit draws: paint, trim, lamps (the taxi-only parts merge into them) and the wheels.
      const calls = ['paint', 'trim'].filter((k) => b.body.has(k as 'paint')).length
        + (b.body.has('lamp') || b.body.has('taxi') ? 1 : 0) + (b.wheelRear ? 2 : 1);
      put(t, 'kit draw calls', calls);
      expect(calls).toBeLessThanOrEqual(8);
    }
  });
});
