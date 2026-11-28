/**
 * The player's arcade drift (Vehicle.ts `ARCADE`, QQ飞车-style): held with a direction it swings the tail out to a steady
 * angle and carves an arc without spinning, let go the car comes out straight with a short push. Numbers go to
 * `.scratch/drift-report.txt`.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import { Rig } from './Rig';
import type { DriveInput } from './ControlFilter';

const DT = 1 / 60;
const KMH = 3.6;
const deg = (r: number) => r * 180 / Math.PI;
const report: Record<string, number> = {};
const input = (o: Partial<DriveInput> = {}): DriveInput => ({ forward: 1, back: 0, steer: 0, analog: false, handbrake: false, drift: false, ...o });
const heading = (rig: Rig) => Math.atan2(rig.car.fwd.x, rig.car.fwd.z);
const travel = (rig: Rig) => Math.atan2(rig.car.vel.x, rig.car.vel.z);
const unwrap = (a: number, ref: number) => ref + Math.atan2(Math.sin(a - ref), Math.cos(a - ref));

afterAll(() => {
  fs.mkdirSync('.scratch', { recursive: true });
  fs.writeFileSync('.scratch/drift-report.txt', Object.entries(report).map(([k, v]) => `${k.padEnd(34)} ${+v.toFixed(2)}`).join('\n') + '\n');
});

/** Up to speed in a straight line, then `secs` of drift with `steer`; returns what it measured. */
async function drift(kmh: number, steer: number, secs: number, opts: { tune?: boolean; into?: number } = {}) {
  const rig = await Rig.create({ at: { x: 0, y: 0.36, z: -150 } });
  rig.settle();
  if (opts.tune) rig.car.tune.nitro = 5;
  rig.launch(kmh / KMH);
  for (let i = 0; i < 20; i++) rig.stepInput(input());
  const v0 = rig.car.speed;
  let psi = heading(rig), tv = travel(rig);
  const psi0 = psi, tv0 = tv;
  let minUp = 1, maxSlip = 0, slipAt04 = NaN, tIn = 0;
  for (let t = 0; t < secs; t += DT) {
    rig.stepInput(input({ steer: t < 0.3 ? steer : (opts.into ?? steer), drift: true }));
    psi = unwrap(heading(rig), psi); tv = unwrap(travel(rig), tv);
    minUp = Math.min(minUp, rig.car.up.y);
    if (t > 0.4) maxSlip = Math.max(maxSlip, Math.abs(rig.car.bodySlip));
    if (isNaN(slipAt04) && t >= 0.4) slipAt04 = rig.car.bodySlip;
    if (rig.car.driftPhase === 1) tIn += DT;
  }
  return { rig, v0, turned: psi - psi0, went: tv - tv0, minUp, maxSlip, slipAt04, slipEnd: rig.car.bodySlip, vEnd: rig.car.speed, tIn };
}

describe('arcade drift', () => {
  it('swings out to a steady angle and carves a left arc without spinning', async () => {
    const d = await drift(80, -1, 2.5);
    Object.assign(report, { 'left80.slip at 0.4 s deg': deg(d.slipAt04), 'left80.slip end deg': deg(d.slipEnd), 'left80.max slip deg': deg(d.maxSlip),
      'left80.turned deg': deg(d.turned), 'left80.travel turned deg': deg(d.went), 'left80.speed kept %': 100 * d.vEnd / d.v0, 'left80.drifting s': d.tIn });
    expect(d.rig.car.driftPhase).toBe(1);
    expect(deg(d.slipAt04)).toBeGreaterThan(18);           // out quickly (20 -> 18 on 2026-11-27: the travel turns in sooner, so the angle to it builds a touch later)
    expect(deg(d.slipEnd)).toBeGreaterThan(30);
    expect(deg(d.maxSlip)).toBeLessThan(50);               // never spins
    expect(deg(d.went)).toBeGreaterThan(110);              // the travel itself carves a real corner (left is +)
    expect(d.vEnd / d.v0).toBeGreaterThan(0.82);           // keeps its speed (0.856 -> 0.841 on 2026-11-25: the key is in sooner, so it drifts in deeper)
    expect(d.minUp).toBeGreaterThan(0.95);
  });

  it('begun before the corner: slides on angled and nearly straight, then the key takes the corner', async () => {
    // 2026-10-23, 「漂移成功不了，比如我右转，车子一直向左偏」: the nose must lead the travel (the first version swung it 35°
    // right at once and slid on straight, off the road on the left). 2026-11-28, 「漂移应该做成在路口提前开始漂，等到路口的
    // 时候就能漂过去了，而不是走到路口才开始漂」: a right drift at 60 km/h, the key let go after 0.3 s, held 1 s more - it
    // used to turn 65° and 10 m aside in that second, into the buildings before the corner. Then the key held right.
    const d = await drift(60, 1, 1.3, { into: 0 });
    report['predrift60.travel turned deg'] = deg(d.went);
    report['predrift60.nose ahead deg'] = deg(d.went - d.turned);
    expect(deg(d.went)).toBeGreaterThan(-25);              // nearly straight on (right is -)
    expect(deg(d.turned - d.went)).toBeLessThan(-15);      // but angled, the nose ahead of the travel: a drift
    const tv0 = travel(d.rig), p0 = d.rig.car.pos.clone(); let tv = tv0, ahead = Infinity;
    for (let i = 0; i < 180 && ahead === Infinity; i++) {
      d.rig.stepInput(input({ steer: 1, drift: true }));
      tv = unwrap(travel(d.rig), tv);
      if (tv0 - tv >= Math.PI / 2) ahead = (d.rig.car.pos.x - p0.x) * Math.sin(tv0) + (d.rig.car.pos.z - p0.z) * Math.cos(tv0);
    }
    report['predrift60.then 90° in m'] = ahead;
    expect(ahead).toBeLessThan(18);                        // the corner taken from there (13 m)
    expect(d.rig.car.driftPhase).toBe(1);
  });

  it('a fast right turn: the drift bends the line instead of carrying it on', async () => {
    // 2026-11-27, 「车速起来的时候，前面要右拐弯…根据惯性往前面甩」: the key held right with the drift button, how far the
    // car ran on along its old line before the travel had turned 90° (26 / 45 m at 60 / 100 km/h on 11-26).
    for (const [kmh, most] of [[60, 21], [100, 38]] as const) {
      const rig = await Rig.create({ at: { x: 0, y: 0.36, z: -300 } }); rig.settle(); rig.launch(kmh / KMH);
      for (let i = 0; i < 20; i++) rig.stepInput(input());
      const z0 = rig.car.pos.z, tv0 = travel(rig); let tv = tv0, ahead = Infinity;
      for (let i = 0; i < 240 && ahead === Infinity; i++) {
        rig.stepInput(input({ steer: 1, drift: true }));
        tv = unwrap(travel(rig), tv);
        if (tv0 - tv >= Math.PI / 2) ahead = rig.car.pos.z - z0;
      }
      report[`fast right ${kmh}.ran on m`] = ahead;
      expect(ahead).toBeLessThan(most);
    }
  });

  it('drifts right the same way', async () => {
    const d = await drift(80, 1, 2.5);
    report['right80.slip end deg'] = deg(d.slipEnd);
    report['right80.travel turned deg'] = deg(d.went);
    expect(deg(d.slipEnd)).toBeLessThan(-30);
    expect(deg(d.went)).toBeLessThan(-110);
  });

  it('tightens steering into the drift and widens steering against it', async () => {
    const into = await drift(70, -1, 2, { into: -1 });
    const out = await drift(70, -1, 2, { into: 1 });
    const flat = await drift(70, -1, 2, { into: 0 });
    Object.assign(report, { 'arc.into travel deg': deg(into.went), 'arc.neutral travel deg': deg(flat.went), 'arc.against travel deg': deg(out.went),
      'arc.into slip deg': deg(into.slipEnd), 'arc.against slip deg': deg(out.slipEnd) });
    expect(into.went).toBeGreaterThan(flat.went);
    expect(flat.went).toBeGreaterThan(out.went);
    expect(out.went).toBeGreaterThan(0);                   // still a left drift
    expect(into.slipEnd).toBeGreaterThan(out.slipEnd);
  });

  it('a tap of the other direction nudges the drift instead of throwing it', async () => {
    // 2026-10-23, 「方向键太过灵敏，导致漂移不好操作」: a left drift held 1.5 s, then a 0.15 s tap of ▶ (or none)
    const run = async (tap: boolean) => {
      const d = await drift(70, -1, 1.5, { into: 0 });
      const rig = d.rig, slip0 = rig.car.bodySlip;
      let minSlip = slip0, psi = travel(rig);
      const psi0 = psi;
      for (let t = 0; t < 1; t += DT) {
        rig.stepInput(input({ steer: tap && t < 0.15 ? 1 : 0, drift: true }));
        minSlip = Math.min(minSlip, rig.car.bodySlip); psi = unwrap(travel(rig), psi);
      }
      return { rig, dSlip: slip0 - minSlip, turned: psi - psi0 };
    };
    const tap = await run(true), none = await run(false);
    Object.assign(report, { 'tap.slip given up deg': deg(tap.dSlip), 'tap.turned in 1 s deg': deg(tap.turned), 'tap.untapped turned deg': deg(none.turned) });
    expect(tap.rig.car.driftPhase).toBe(1);
    expect(deg(tap.dSlip)).toBeLessThan(5);
    expect(tap.turned).toBeGreaterThan(none.turned * 0.75);   // still carving left, a little wider
  });

  it('comes out straight along the nose with a push when the key comes up', async () => {
    const d = await drift(80, -1, 1.5);
    const rig = d.rig, nose = heading(rig);
    rig.stepInput(input());
    const kicked = rig.car.kick > 0;
    let tStraight = NaN, maxSlipAfter = 0, maxYaw = 0;
    const v1 = rig.car.speed;
    for (let t = 0; t < 2.5; t += DT) {
      rig.stepInput(input());
      if (isNaN(tStraight) && Math.abs(rig.car.bodySlip) < 0.06) tStraight = t;
      if (t > 0.6) { maxSlipAfter = Math.max(maxSlipAfter, Math.abs(rig.car.bodySlip)); maxYaw = Math.max(maxYaw, Math.abs(rig.car.yawRate)); }
    }
    const offNose = deg(Math.abs(Math.atan2(Math.sin(travel(rig) - nose), Math.cos(travel(rig) - nose))));
    Object.assign(report, { 'exit.straight after s': tStraight, 'exit.slip after 0.6 s deg': deg(maxSlipAfter), 'exit.yaw rate after rad/s': maxYaw,
      'exit.travel off the nose deg': offNose, 'exit.speed gain km/h': (rig.car.speed - v1) * KMH });
    expect(kicked).toBe(true);
    expect(tStraight).toBeLessThan(0.6);
    expect(deg(maxSlipAfter)).toBeLessThan(4);
    expect(maxYaw).toBeLessThan(0.25);
    expect(offNose).toBeLessThan(15);                      // goes where it pointed when the key came up
    expect(rig.car.driftPhase).toBe(0);
  });

  it('a tap is no drift and gives no push', async () => {
    const d = await drift(80, -1, 0.3);
    d.rig.stepInput(input());
    expect(d.rig.car.kick).toBe(0);
  });

  it('fills a fitted nitro bottle', async () => {
    const d = await drift(80, -1, 2, { tune: true });
    report['nitro.fill after 2 s'] = d.rig.car.nitroFill;
    expect(d.rig.car.nitroFill).toBeGreaterThan(0.15);
  });

  it('is the handbrake below its speed', async () => {
    const rig = await Rig.create({ at: { x: 0, y: 0.36, z: -150 } });
    rig.settle();
    rig.launch(20 / KMH);
    for (let i = 0; i < 10; i++) rig.stepInput(input());
    for (let t = 0; t < 1; t += DT) rig.stepInput(input({ forward: 0, drift: true, steer: -1 }));
    report['slow.speed after 1 s km/h'] = rig.car.speed * KMH;
    expect(rig.car.driftPhase).toBe(0);
    expect(rig.car.handbrake).toBe(true);
    expect(rig.car.speed * KMH).toBeLessThan(12);
  });

  it('waits for a direction: the key alone at speed neither drifts nor locks the rear', async () => {
    const d = await drift(80, 0, 1);
    report['nodir.speed kept %'] = 100 * d.vEnd / d.v0;
    expect(d.rig.car.driftPhase).toBe(0);
    expect(d.rig.car.handbrake).toBe(false);
    expect(Math.abs(deg(d.turned))).toBeLessThan(2);
  });
});
