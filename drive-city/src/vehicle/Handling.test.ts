/**
 * M0 acceptance: the taxi's handling, measured headlessly. Each maneuver drives the real Vehicle
 * through the real ControlFilter on a Rapier world, and the numbers land in a table at the end
 * (`npx vitest run src/vehicle/Handling.test.ts`), which is what the handling critic reads.
 */
import { describe, it, expect, afterAll } from 'vitest';
import fs from 'node:fs';
import { Rig, KeyTapper } from './Rig';
import { PathPilot, figureEight } from './Autopilot';
import { ControlFilter, emptyControls, type DriveInput } from './ControlFilter';

const DT = 1 / 60;
const FIG8_DRIFT = { tap: 0.32, slip: 0.4, rekick: 0.2 };
const report: Record<string, string | number> = {};
const KMH = 3.6;
const deg = (r: number) => r * 180 / Math.PI;
const input = (o: Partial<DriveInput> = {}): DriveInput => ({ forward: 0, back: 0, steer: 0, analog: false, handbrake: false, ...o });
const headingOf = (rig: Rig) => Math.atan2(rig.car.fwd.x, rig.car.fwd.z);

afterAll(() => {
  const w = Math.max(...Object.keys(report).map((k) => k.length));
  const text = 'HANDLING REPORT\n' + Object.entries(report).map(([k, v]) => `${k.padEnd(w)}  ${typeof v === 'number' ? +v.toFixed(3) : v}`).join('\n') + '\n';
  // Vitest hides console output of passing tests, so the table goes to a file the critic can read.
  fs.mkdirSync('.scratch', { recursive: true });
  fs.writeFileSync('.scratch/handling-report.txt', text);
  console.log(text);
});

describe('taxi handling', () => {
  it('sits still and level when parked', async () => {
    const rig = await Rig.create();
    rig.settle(3);
    const c = rig.car;
    const load = c.wheels.reduce((a, w) => a + w.load, 0);
    // Horizontal only: with 4 solver substeps Rapier reports a body held up by per-step impulses
    // at -0.375·g·dt vertically even when it is not moving.
    const hSpeed = Math.hypot(c.vel.x, c.vel.z);
    report['parked.speed m/s'] = hSpeed;
    report['parked.load/weight'] = load / (c.spec.mass * 9.81);
    report['parked.hub height m'] = c.pos.y;
    expect(hSpeed).toBeLessThan(0.01);
    expect(c.wheels.every((w) => w.contact)).toBe(true);
    expect(Math.abs(load / (c.spec.mass * 9.81) - 1)).toBeLessThan(0.05);
    expect(c.up.y).toBeGreaterThan(0.999);
  });

  it('accelerates like a quick saloon and tops out at the limiter', async () => {
    const rig = await Rig.create();
    rig.settle();
    let t100 = NaN, t60 = NaN, shifts = 0, minUp = 1;
    rig.car.onShift = () => shifts++;
    const t0 = rig.time;   // measured from the throttle, not from the settle before it
    for (let t = 0; t < 45; t += DT) {
      rig.stepInput(input({ forward: 1 }));
      const kmh = rig.car.forwardSpeed * KMH;
      if (isNaN(t60) && kmh >= 60) t60 = rig.time - t0;
      if (isNaN(t100) && kmh >= 100) t100 = rig.time - t0;
      minUp = Math.min(minUp, rig.car.up.y);
    }
    const top = rig.car.forwardSpeed * KMH;
    Object.assign(report, { 'accel.0-60 s': t60, 'accel.0-100 s': t100, 'accel.top km/h': top, 'accel.gear at top': rig.car.gear, 'accel.shifts': shifts });
    expect(t100).toBeGreaterThan(5.5);
    expect(t100).toBeLessThan(8.5);
    expect(top).toBeGreaterThan(165);
    expect(top).toBeLessThan(190);
    expect(minUp).toBeGreaterThan(0.98);
  });

  it('stops from 100 km/h in a straight line in under 45 m', async () => {
    const rig = await Rig.create();
    rig.settle();
    rig.launch(100 / KMH);
    for (let i = 0; i < 12; i++) rig.stepControls(emptyControls());
    const x0 = rig.car.pos.clone(), h0 = headingOf(rig);
    let t = 0;
    while (rig.car.speed > 0.3 && t < 10) { rig.stepInput(input({ back: 1 })); t += DT; }
    const dist = rig.car.pos.distanceTo(x0);
    const lateral = Math.abs(rig.car.pos.x - x0.x);
    report['brake.100-0 m'] = dist;
    report['brake.100-0 s'] = t;
    report['brake.drift m'] = lateral;
    expect(dist).toBeGreaterThan(32);
    expect(dist).toBeLessThan(45);
    expect(lateral).toBeLessThan(0.5);
    expect(deg(Math.abs(headingOf(rig) - h0))).toBeLessThan(3);
  });

  it('pulls about 1 g on a skidpad without spinning', async () => {
    const rig = await Rig.create({ at: { x: 40, y: 0.36, z: 0 } });
    rig.settle();
    const R = 40, n = 240;
    const circle: [number, number][] = [];
    for (let i = 0; i < n; i++) { const a = -(i / n) * Math.PI * 2; circle.push([R * Math.cos(a), R * Math.sin(a)]); }
    let speed = 8;
    const pilot = new PathPilot(circle, { speed: () => speed, lookahead: 9, closed: true });
    let bestG = 0, maxSlip = 0;
    for (let t = 0; t < 60; t += DT) {
      speed = 8 + t * 0.35;
      rig.stepInput(pilot.update(rig.view(), DT));
      const latG = Math.abs(rig.car.accel.x) / 9.81;
      // Only while gripping and on the line: a spinning car's yaw rate is not cornering grip.
      if (pilot.crossTrack < 1.5 && Math.abs(rig.car.bodySlip) < 0.15 && t > 5) bestG = Math.max(bestG, latG);
      maxSlip = Math.max(maxSlip, Math.abs(rig.car.bodySlip));
    }
    report['skidpad.max lateral g'] = bestG;
    report['skidpad.max body slip deg'] = deg(maxSlip);
    expect(bestG).toBeGreaterThan(0.85);
    expect(bestG).toBeLessThan(1.2);
    expect(rig.car.up.y).toBeGreaterThan(0.9);
  });

  it('changes lanes at 80 km/h and settles straight', async () => {
    const rig = await Rig.create();
    rig.settle();
    rig.launch(80 / KMH);
    const path: [number, number][] = [];
    for (let z = 0; z <= 400; z += 2) {
      const u = z < 60 ? 0 : z < 90 ? (1 - Math.cos((z - 60) / 30 * Math.PI)) / 2 : z < 120 ? 1 : z < 150 ? (1 + Math.cos((z - 120) / 30 * Math.PI)) / 2 : 0;
      path.push([3.5 * u, z]);
    }
    const pilot = new PathPilot(path, { speed: 80 / KMH, lookahead: 14, closed: false });
    let maxSlip = 0, maxCte = 0;
    for (let t = 0; t < 12; t += DT) {
      rig.stepInput(pilot.update(rig.view(), DT));
      maxSlip = Math.max(maxSlip, Math.abs(rig.car.bodySlip));
      maxCte = Math.max(maxCte, pilot.crossTrack);
    }
    report['lanechange.max body slip deg'] = deg(maxSlip);
    report['lanechange.max tracking error m'] = maxCte;
    expect(deg(maxSlip)).toBeLessThan(8);
    // Pure pursuit cuts the S at this lookahead; the point is that the car follows without sliding.
    expect(maxCte).toBeLessThan(2);
  });

  it('handbrake turn: swaps ends at 60 km/h and stays on its wheels', async () => {
    const rig = await Rig.create();
    rig.settle();
    rig.launch(60 / KMH);
    const h0 = headingOf(rig);
    let minUp = 1, maxSlip = 0, turned = 0, prev = h0, tTurn = NaN;
    for (let t = 0; t < 5; t += DT) {
      const pull = t < 1.0;
      rig.stepInput(input({ steer: t < 1.6 ? -1 : 0, handbrake: pull, forward: t > 1.0 && t < 2.2 ? 1 : 0 }));
      const h = headingOf(rig);
      let d = h - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
      turned += d; prev = h;
      if (isNaN(tTurn) && Math.abs(turned) > Math.PI * 2 / 3) tTurn = t;
      minUp = Math.min(minUp, rig.car.up.y);
      maxSlip = Math.max(maxSlip, Math.abs(rig.car.bodySlip));
    }
    report['handbrake.turned deg'] = deg(Math.abs(turned));
    report['handbrake.time to 120 deg s'] = tTurn;
    report['handbrake.peak body slip deg'] = deg(maxSlip);
    report['handbrake.min upright'] = minUp;
    expect(deg(Math.abs(turned))).toBeGreaterThan(120);
    expect(tTurn).toBeLessThan(2.5);
    expect(minUp).toBeGreaterThan(0.85);
  });

  for (const mode of ['gamepad', 'keyboard'] as const) {
    it(`drifts a figure-eight for a minute without flipping (${mode})`, async () => {
      // Start at the crossing, pointing along +X (yaw = +90°).
      const rig = await Rig.create({ yaw: Math.PI / 2 });
      rig.settle();
      const R8 = 24, per = 120;
      const pilot = new PathPilot(figureEight(0, 0, R8, per), { speed: 13, lookahead: 10, closed: true, drift: { ...FIG8_DRIFT, entries: [6, per + 6], kickZones: [[16, per - 14], [per + 16, 2 * per - 14]] } });
      const steerKeys = new KeyTapper();
      let minUp = 1, maxSlip = 0, drifting = 0, total = 0, cteSum = 0, cteMax = 0, airborne = 0, maxAirborne = 0;
      for (let t = 0; t < 70; t += DT) {
        const a = pilot.update(rig.view(), DT);
        const i = mode === 'gamepad' ? a : input({
          steer: steerKeys.tap(a.steer),
          // A person holds W through a slide and lets go to catch it; they do not flutter it.
          forward: a.forward > 0.45 ? 1 : 0,
          back: a.back > 0.3 ? 1 : 0,
          handbrake: a.handbrake,
        });
        rig.stepInput(i);
        const c = rig.car;
        minUp = Math.min(minUp, c.up.y);
        if (t > 4) {
          total++;
          if (Math.abs(c.bodySlip) > 0.2 && c.speed > 6) drifting++;
          maxSlip = Math.max(maxSlip, Math.abs(c.bodySlip));
          cteSum += pilot.crossTrack; cteMax = Math.max(cteMax, pilot.crossTrack);
        }
        airborne = c.grounded < 2 ? airborne + DT : 0;
        maxAirborne = Math.max(maxAirborne, airborne);
      }
      const k = `fig8.${mode}.`;
      Object.assign(report, {
        [k + 'laps']: pilot.laps, [k + 'drift time %']: 100 * drifting / total, [k + 'max body slip deg']: deg(maxSlip),
        [k + 'mean tracking error m']: cteSum / total, [k + 'max tracking error m']: cteMax, [k + 'min upright']: minUp,
      });
      expect(minUp).toBeGreaterThan(0.8);
      expect(maxAirborne).toBeLessThan(0.3);
      expect(pilot.laps).toBeGreaterThan(2);
      expect(drifting / total).toBeGreaterThan(0.35);
      expect(deg(maxSlip)).toBeLessThan(75);
      expect(cteSum / total).toBeLessThan(5);
    });
  }

  it('holding throttle and lock after a handbrake flick keeps the car drifting', async () => {
    // The simplest thing a keyboard player does: flick, then hold W + A.
    const rig = await Rig.create();
    rig.settle();
    rig.launch(50 / KMH);
    let held = 0, maxSlip = 0, minUp = 1;
    for (let t = 0; t < 8; t += DT) {
      rig.stepInput(input({ steer: -1, handbrake: t < 0.4, forward: t >= 0.4 ? 1 : 0 }));
      if (t > 0.4 && Math.abs(rig.car.bodySlip) > 0.26 && rig.car.speed > 5) held += DT;
      maxSlip = Math.max(maxSlip, Math.abs(rig.car.bodySlip));
      minUp = Math.min(minUp, rig.car.up.y);
    }
    report['powerdrift.seconds over 15 deg'] = held;
    report['powerdrift.max body slip deg'] = deg(maxSlip);
    expect(held).toBeGreaterThan(4);
    expect(minUp).toBeGreaterThan(0.85);
  });

  // --- Regression probes from handling critic round 1 (.scratch/critic/handling-r1.md) ----------

  it('holding a steering key at motorway speed does not turn into a big slide', async () => {
    for (const kmh of [100, 120]) {
      const rig = await Rig.create(); rig.settle(0.5); rig.launch(kmh / KMH);
      let maxSlip = 0;
      // 6 s, not 4: as the car slows in the turn the keyboard gives back lock, and a slide that
      // comes late is still a slide.
      for (let t = 0; t < 6; t += DT) { rig.stepInput(input({ steer: -1 })); maxSlip = Math.max(maxSlip, Math.abs(rig.car.bodySlip)); }
      report[`heldkey.${kmh} coasting max slip deg`] = deg(maxSlip);
      expect(deg(maxSlip)).toBeLessThan(12);
    }
    const rig = await Rig.create(); rig.settle(0.5); rig.launch(80 / KMH);
    let maxSlip = 0;
    for (let t = 0; t < 6; t += DT) { rig.stepInput(input({ steer: -1, forward: 1 })); maxSlip = Math.max(maxSlip, Math.abs(rig.car.bodySlip)); }
    report['heldkey.80 W+A max slip deg'] = deg(maxSlip);
    expect(deg(maxSlip)).toBeLessThan(12);
  });

  it('a drift ends when the wheel is straightened, even with W held', async () => {
    const rig = await Rig.create(); rig.settle(0.5); rig.launch(50 / KMH);
    for (let t = 0; t < 4; t += DT) rig.stepInput(input({ steer: -1, handbrake: t < 0.4, forward: t >= 0.4 ? 1 : 0 }));
    const slip0 = Math.abs(rig.car.bodySlip);
    let calm = 0, tOut = NaN;
    for (let t = 0; t < 4; t += DT) {
      rig.stepInput(input({ forward: 1 }));
      if (Math.abs(rig.car.bodySlip) < 0.087) { calm += DT; if (isNaN(tOut) && calm > 0.4) tOut = t - 0.4; } else calm = 0;
    }
    report['driftexit.slip before deg'] = deg(slip0);
    report['driftexit.seconds to <5 deg with W held'] = tOut;
    expect(deg(slip0)).toBeGreaterThan(25);
    expect(tOut).toBeLessThan(2);
  });

  it('a handbrake 90-degree corner, then straight with W held, does not overshoot', async () => {
    for (const kmh of [40, 60]) {
      const rig = await Rig.create(); rig.settle(0.5); rig.launch(kmh / KMH);
      let heading = 0, prev = headingOf(rig), turned = false, maxH = 0;
      for (let t = 0; t < 5; t += DT) {
        rig.stepInput(input({ steer: turned ? 0 : -1, handbrake: t < 0.25, forward: t >= 0.25 ? 1 : 0 }));
        const h = headingOf(rig);
        let d = h - prev; if (d > Math.PI) d -= 2 * Math.PI; if (d < -Math.PI) d += 2 * Math.PI;
        heading += d; prev = h;
        if (!turned && Math.abs(heading) >= Math.PI / 2) turned = true;
        maxH = Math.max(maxH, Math.abs(heading));
      }
      report[`hb90.${kmh} km/h overshoot deg`] = deg(maxH) - 90;
      expect(turned).toBe(true);
      expect(deg(maxH) - 90).toBeLessThan(45);
    }
  });

  it('power in a gripping corner and a standing start leave no smoke or limiter drone', async () => {
    const rig = await Rig.create(); rig.settle(0.5); rig.launch(30 / KMH);
    let maxSkid = 0, maxSlip = 0;
    for (let t = 0; t < 3; t += DT) {
      rig.stepInput(input({ forward: 1, steer: -0.6, analog: true }));
      if (t > 0.5) { maxSkid = Math.max(maxSkid, rig.car.wheels[2].skid, rig.car.wheels[3].skid); maxSlip = Math.max(maxSlip, Math.abs(rig.car.bodySlip)); }
    }
    report['gripcorner.max rear skid'] = maxSkid;
    report['gripcorner.max slip deg'] = deg(maxSlip);
    expect(maxSkid).toBeLessThan(0.3);
    const r2 = await Rig.create(); r2.settle(0.5);
    let rpmAt30 = NaN, skidSum = 0, n = 0;
    for (let t = 0; t < 6; t += DT) {
      r2.stepInput(input({ forward: 1 }));
      const kmh = r2.car.forwardSpeed * KMH;
      if (isNaN(rpmAt30) && kmh >= 30) rpmAt30 = r2.car.rpm;
      if (kmh > 10 && kmh < 50) { skidSum += Math.max(r2.car.wheels[2].skid, r2.car.wheels[3].skid); n++; }
    }
    report['launch.rpm at 30 km/h'] = rpmAt30;
    report['launch.mean rear skid 10-50 km/h'] = skidSum / n;
    expect(rpmAt30).toBeLessThan(5200);
    expect(skidSum / n).toBeLessThan(0.3);
  });

  it('W+A from a standstill spins a donut', async () => {
    const rig = await Rig.create(); rig.settle(0.5);
    let sum = 0, n = 0;
    for (let t = 0; t < 6; t += DT) {
      rig.stepInput(input({ forward: 1, steer: -1 }));
      if (t > 3) { sum += Math.abs(rig.car.bodySlip); n++; }
    }
    report['donut.mean slip deg'] = deg(sum / n);
    expect(deg(sum / n)).toBeGreaterThan(20);
    expect(rig.car.up.y).toBeGreaterThan(0.9);
  });

  it('keyboard taps steer in proportion to how long the key is down', async () => {
    // What the wheel does (critic round 1, issue 3: taps under 63% duty gave 0.14 of lock or less, over 75% all of it).
    // The key comes back to centre faster than it goes in (KEYBOARD.tauRelease), so the mean sits under the duty.
    for (const [duty, lo, hi] of [[2, 0.06, 0.3], [4, 0.2, 0.55], [6, 0.45, 0.85]] as const) {
      const f = new ControlFilter();
      let sum = 0, n = 0;
      for (let fr = 0; fr < 900; fr++) {
        const o = f.update(input({ steer: fr % 8 < duty ? -1 : 0 }), 50 / KMH, DT);
        if (fr > 450) { sum += -o.steer; n++; }
      }
      report[`keytaps.${duty}/8 duty mean steer`] = sum / n;
      expect(sum / n).toBeGreaterThan(lo);
      expect(sum / n).toBeLessThan(hi);
    }
    // What the car does with it, which is what the player feels: the turn rate at 50 km/h as a share of a held key's.
    // The front tyres are at their limit from ~0.4 of the key, so with one lag both ways 2/8 taps already turned the
    // car 0.7 as fast as a held key and 4/8 as fast as it goes (2026-11-25). A held key is a little past the tyres' peak
    // (steer.overdrive), which is how 6/8 can out-turn it.
    const yawAt = async (duty: number) => {
      const rig = await Rig.create(); rig.settle(0.5); rig.launch(50 / KMH);
      let sum = 0, n = 0;
      for (let fr = 0; fr < 240; fr++) {
        rig.stepInput(input({ steer: fr % 8 < duty ? -1 : 0, forward: rig.car.forwardSpeed * KMH < 50 ? 1 : 0 }));
        if (fr >= 120) { sum += Math.abs(rig.car.yawRate); n++; }
      }
      return sum / n;
    };
    const held = await yawAt(8);
    let last = 0;
    for (const [duty, lo, hi] of [[2, 0.1, 0.45], [4, 0.28, 0.75], [6, 0.5, 1.1]] as const) {
      const share = await yawAt(duty) / held;
      report[`keytaps.${duty}/8 duty turn rate / held`] = share;
      expect(share).toBeGreaterThan(lo);
      expect(share).toBeLessThan(hi);
      expect(share).toBeGreaterThan(last);
      last = share;
    }
  });

  it('a gentle bend can be driven on keys', async () => {
    // 2026-11-25: the tyre's force was all there by 0.4 of the key, so a driver on keys (sees 0.18 s late, decides ten
    // times a second, can only press or not) swung ±0.76 g round a 0.35 g bend at 90 km/h. The turn now follows the key.
    for (const [kmh, sdMax] of [[60, 0.36], [90, 0.5], [130, 0.55]] as const) {
      const rig = await Rig.create(); rig.settle(0.5); rig.launch(kmh / KMH);
      const v0 = kmh / KMH, keep = () => (rig.car.forwardSpeed < v0 ? 1 : 0);
      for (let i = 0; i < 30; i++) rig.stepInput(input({ forward: keep() }));
      const R = v0 * v0 / (0.35 * 9.81), cx = rig.car.pos.x - R, cz = rig.car.pos.z;
      const hist: { off: number; herr: number; yr: number }[] = [];
      let key = 0, n = 0, sum = 0, sum2 = 0;
      for (let i = 0; i < 480; i++) {
        const c = rig.car, dx = c.pos.x - cx, dz = c.pos.z - cz, off = Math.hypot(dx, dz) - R;
        const e0 = Math.atan2(c.vel.x, c.vel.z) - Math.atan2(-dz, dx);
        hist.push({ off, herr: Math.atan2(Math.sin(e0), Math.cos(e0)), yr: -c.yawRate });
        if (i % 6 === 0) {
          const s = hist[Math.max(0, i - 11)], vv = Math.max(5, c.speed), dead = 0.12 * vv / R + 0.015;
          const e = vv / R + (s.herr + s.off / (vv * 1.2)) / 0.7 - s.yr;
          key = key === 1 ? (e > -dead * 0.3 ? 1 : 0) : e > dead ? 1 : e < -3 * dead ? -1 : 0;
        }
        rig.stepInput(input({ steer: key, forward: keep() }));
        if (i > 120) { const a = Math.abs(c.yawRate * c.forwardSpeed) / 9.81; n++; sum += a; sum2 += a * a; }
      }
      const sd = Math.sqrt(Math.max(0, sum2 / n - (sum / n) ** 2));
      report[`bend.${kmh} km/h 0.35 g bend on keys, +-g`] = sd;
      expect(sd).toBeLessThan(sdMax);
    }
  });

  it('a held key with the throttle down does not spin a slow car', async () => {
    // The yaw aid asking for all of the grip at 25-40 km/h did (56°).
    for (const kmh of [25, 40, 60]) for (const gas of [0, 1]) {
      const rig = await Rig.create(); rig.settle(0.5); rig.launch(kmh / KMH);
      for (let i = 0; i < 20; i++) rig.stepInput(input({ forward: gas }));
      let slip = 0;
      for (let i = 0; i < 240; i++) { rig.stepInput(input({ steer: 1, forward: gas })); if (rig.car.speed > 5) slip = Math.max(slip, Math.abs(rig.car.bodySlip)); }
      expect(deg(slip)).toBeLessThan(22);                  // coasting down to 18 km/h on full lock is 19° by geometry
    }
  });

  it('a key dodges a car ahead at once', async () => {
    // 「转向慢了一点…半天头转不过去」: the middle of the nose 1.9 m across, off the brakes.
    for (const [kmh, most] of [[40, 0.61], [60, 0.61], [90, 0.66], [130, 0.7]] as const) {
      const rig = await Rig.create(); rig.settle(0.5); rig.launch(kmh / KMH);
      const keep = () => (rig.car.forwardSpeed * KMH < kmh ? 1 : 0);
      for (let i = 0; i < 30; i++) rig.stepInput(input({ forward: keep() }));
      const x0 = rig.car.pos.x;
      let t = NaN;
      for (let i = 0; i < 120 && isNaN(t); i++) { rig.stepInput(input({ steer: 1, forward: keep() })); if (Math.abs(rig.car.pos.x + rig.car.fwd.x * 2.2 - x0) >= 1.9) t = (i + 1) * DT; }
      report[`dodge.${kmh} km/h s`] = t;
      expect(t).toBeLessThan(most);
    }
  });

  it('a let-go key stops the turn', async () => {
    // 2026-11-25, 「开车的手感不好」: the wheel came back through the same lag it went in by, and most of that was above
    // what the front tyres can use, so the car turned on for 0.5-1 s after the key came up (19° more at 60 km/h after a
    // 0.6 s press) and a 0.1 s tap turned it 9.5°.
    for (const [kmh, moreMax, tapMax] of [[40, 12, 7.5], [60, 8.5, 5.5], [120, 3, 2]] as const) {
      const rig = await Rig.create(); rig.settle(0.5);
      const hold = () => (rig.car.forwardSpeed * KMH < kmh ? 1 : 0);
      const start = () => { rig.car.reset({ x: 0, y: 0.36, z: 0 }, 0); rig.filter.reset(); rig.launch(kmh / KMH); for (let i = 0; i < 30; i++) rig.stepInput(input({ forward: hold() })); };
      start();
      for (let i = 0; i < 36; i++) rig.stepInput(input({ steer: 1, forward: hold() }));
      const h1 = headingOf(rig), y1 = Math.abs(rig.car.yawRate);
      let calm = NaN, slip = 0;
      for (let i = 0; i < 150; i++) {
        rig.stepInput(input({ forward: hold() }));
        if (isNaN(calm) && Math.abs(rig.car.yawRate) < 0.15 * y1) calm = (i + 1) * DT;
        slip = Math.max(slip, Math.abs(rig.car.bodySlip));
      }
      const more = Math.abs(deg(headingOf(rig) - h1));
      start();
      const h0 = headingOf(rig);
      for (let i = 0; i < 66; i++) rig.stepInput(input({ steer: i < 6 ? 1 : 0, forward: hold() }));
      const tap = Math.abs(deg(headingOf(rig) - h0));
      Object.assign(report, { [`release.${kmh} km/h s to 15% turn rate`]: calm, [`release.${kmh} km/h turned on deg`]: more, [`release.${kmh} km/h 0.1 s tap deg`]: tap });
      expect(calm).toBeLessThan(0.4);
      expect(more).toBeLessThan(moreMax);
      expect(tap).toBeLessThan(tapMax);
      expect(deg(slip)).toBeLessThan(8);
    }
  });

  it('the player can brake and steer round the car in front', async () => {
    // 2026-11-25, 「我开车离前面的车很近，想变向，半天头转不过去，就撞在前面的车上了」: on the brake the front tyres had 0.31 of
    // their grip left to turn with, and the nose never got a car's width across. `trail` (the player's car only) has
    // the ABS let go with the wheel turned. Held to a stop, it must not spin or tip.
    for (const [kmh, clearMax] of [[60, 0.8], [90, 0.8], [130, 0.85]] as const) {
      const run = async (trail: boolean) => {
        const rig = await Rig.create(); rig.settle(0.5); rig.launch(kmh / KMH);
        for (let i = 0; i < 30; i++) rig.stepInput(input({ forward: rig.car.forwardSpeed * KMH < kmh ? 1 : 0 }));
        const x0 = rig.car.pos.x, h0 = headingOf(rig), p0 = rig.car.pos.clone();
        let clear = NaN, turned = 0, slip = 0, up = 1, stop = NaN;
        for (let i = 0; i < 600 && isNaN(stop); i++) {
          rig.stepInput(input({ steer: 1, back: 1, trail }));
          const c = rig.car;
          if (i === 29) turned = Math.abs(deg(headingOf(rig) - h0));
          // the middle of the nose, a car's width to the side
          if (isNaN(clear) && Math.abs(c.pos.x + c.fwd.x * 2.2 - x0) >= 1.9) clear = (i + 1) * DT;
          if (c.speed > 5) slip = Math.max(slip, Math.abs(c.bodySlip));
          up = Math.min(up, c.up.y);
          if (c.speed < 1) stop = c.pos.distanceTo(p0);
        }
        return { clear, turned, slip: deg(slip), up, stop };
      };
      const off = await run(false), on = await run(true);
      Object.assign(report, {
        [`brakesteer.${kmh} km/h nose clear s`]: on.clear, [`brakesteer.${kmh} km/h turned in 0.5 s deg`]: on.turned,
        [`brakesteer.${kmh} km/h turned in 0.5 s deg (traffic)`]: off.turned, [`brakesteer.${kmh} km/h max slip deg`]: on.slip,
        [`brakesteer.${kmh} km/h stops in m`]: on.stop, [`brakesteer.${kmh} km/h stops in m (traffic)`]: off.stop,
      });
      expect(on.clear).toBeLessThan(clearMax);
      expect(on.turned).toBeGreaterThan(off.turned * 2);
      expect(on.slip).toBeLessThan(9);
      expect(on.up).toBeGreaterThan(0.98);
      expect(on.stop).toBeLessThan(off.stop * 1.45);
    }
    // straight, the brakes are what they were
    const straight = async (trail: boolean) => {
      const rig = await Rig.create(); rig.settle(0.5); rig.launch(100 / KMH);
      const p0 = rig.car.pos.clone();
      for (let i = 0; i < 600 && rig.car.speed > 0.3; i++) rig.stepInput(input({ back: 1, trail }));
      return rig.car.pos.distanceTo(p0);
    };
    expect(Math.abs(await straight(true) - await straight(false))).toBeLessThan(0.01);
  });

  it('the player can brake in a slide without coming round', async () => {
    // Handling critic round 3: at 25° of slip the brake alone took the car to 62-89°; off it the car caught itself.
    for (const kmh of [60, 100, 140]) {
      const rig = await Rig.create(); rig.settle(0.5); rig.launch(kmh / KMH);
      const v = kmh / KMH, th = 25 / 57.3;
      rig.car.body.setLinvel({ x: -Math.sin(th) * v, y: 0, z: Math.cos(th) * v }, true);
      rig.car.body.setAngvel({ x: 0, y: 0.6, z: 0 }, true);
      let slip = 0;
      for (let t = 0; t < 4; t += DT) { rig.stepInput(input({ back: t > 0.2 && rig.car.forwardSpeed > 1 ? 1 : 0, trail: true })); if (rig.car.speed > 4) slip = Math.max(slip, Math.abs(rig.car.bodySlip)); }
      report[`slidebrake.${kmh} km/h max slip deg`] = deg(slip);
      expect(deg(slip)).toBeLessThan(36);
    }
  });

  it('small corrections on the brakes cost little', async () => {
    // Round 3: a 0.1 s tap each half second made the stop from 100 km/h 16% longer (TRAIL let go from 0.05 of the wheel).
    const stop = async (tap: boolean) => {
      const rig = await Rig.create(); rig.settle(0.5); rig.launch(100 / KMH);
      let d = 0;
      for (let t = 0; t < 10 && rig.car.forwardSpeed > 1; t += DT) { rig.stepInput(input({ back: 1, trail: true, steer: tap && t % 0.5 < 0.1 ? (Math.floor(t / 0.5) % 2 ? 1 : -1) : 0 })); d += rig.car.speed * DT; }
      return d;
    };
    const a = await stop(false), b = await stop(true);
    report['brake.100-0 tapping / straight'] = b / a;
    expect(b / a).toBeLessThan(1.1);
  });

  it('backing with the wheel turned does not wind up into a spin', async () => {
    const rig = await Rig.create(); rig.settle(0.5);
    let turned = 0, last = headingOf(rig), early = 0;
    for (let i = 0; i < 240; i++) {
      rig.stepInput(input({ back: 1, steer: 1, trail: true }));
      const h = headingOf(rig); turned += Math.abs(Math.atan2(Math.sin(h - last), Math.cos(h - last))); last = h;
      if (i === 143) early = turned;
    }
    Object.assign(report, { 'backing.turned in 2.4 s deg': deg(early), 'backing.turned in 4 s deg': deg(turned) });
    expect(deg(early)).toBeGreaterThan(70);                // still comes round
    expect(deg(turned)).toBeLessThan(230);                 // was 304
  });

  it('the tyres say how near their limit they are', async () => {
    // 2026-11-25, item 3: the sound and the camera read `strainFront` / `strainRear`.
    const at = async (duty: number) => {
      const rig = await Rig.create(); rig.settle(0.5); rig.launch(60 / KMH);
      let f = 0, n = 0;
      for (let i = 0; i < 180; i++) { rig.stepInput(input({ steer: i % 8 < duty ? 1 : 0, forward: rig.car.forwardSpeed * KMH < 60 ? 1 : 0 })); if (i > 60) { f += rig.car.strainFront; n++; } }
      return f / n;
    };
    const [straight, third, half, most, full] = [await at(0), await at(2), await at(4), await at(6), await at(8)];
    Object.assign(report, { 'strain.2/8': third, 'strain.4/8': half, 'strain.6/8': most, 'strain.8/8': full });
    expect(straight).toBe(0);
    expect(third).toBeLessThan(0.15);
    expect(half).toBeGreaterThan(third);
    expect(most).toBeGreaterThan(0.7);
    expect(full).toBeGreaterThan(0.95);
  });

  it('the handbrake slides by how long it is held, the steering sets the angle, letting go straightens', async () => {
    // 2026-11-25, 「改GTA」: Space is a real handbrake on keys; `CATCH` straightens the car once everything is let go.
    const slide = async (kmh: number, hb: number, duty: number, gas: number, letGo = Infinity) => {
      const rig = await Rig.create(); rig.settle(0.6); rig.launch(kmh / KMH);
      let max = 0, sum = 0, n = 0, straight = NaN, up = 1;
      for (let i = 0; i < 240; i++) {
        const off = i >= letGo;
        rig.stepInput(input({ steer: off ? 0 : i < 12 + hb || i % 8 < duty ? 1 : 0, handbrake: i >= 6 && i < 6 + hb, forward: !off && i > 6 + hb ? gas : 0, trail: true }));
        const s = Math.abs(rig.car.bodySlip);
        max = Math.max(max, s); up = Math.min(up, rig.car.up.y);
        if (i >= 72 && i < 180) { sum += s; n++; }
        if (off) { if (s < 5 / 57.3) { if (isNaN(straight)) straight = (i - letGo) * DT; } else straight = NaN; }
      }
      expect(rig.car.driftPhase).toBe(0);
      expect(up).toBeGreaterThan(0.95);
      return { max: deg(max), mean: deg(sum / n), straight };
    };
    const short = await slide(60, 9, 0, 1), mid = await slide(60, 24, 0, 1);
    expect(short.max).toBeLessThan(18);
    expect(mid.max).toBeGreaterThan(25);
    const held = await slide(60, 24, 8, 1), half = await slide(60, 24, 4, 1), none = await slide(60, 24, 0, 1);
    expect(held.mean).toBeGreaterThan(38);
    expect(held.max).toBeLessThan(75);
    expect(half.mean).toBeGreaterThan(25);
    expect(half.mean).toBeLessThan(held.mean - 5);
    expect(none.mean).toBeLessThan(12);
    for (const kmh of [60, 80, 110]) {
      const r = await slide(kmh, 30, 8, 1, 72);
      report[`gtahb.${kmh} km/h s to straight`] = r.straight;
      expect(r.straight).toBeLessThan(1.6);
    }
    Object.assign(report, { 'gtahb.0.15 s tap max deg': short.max, 'gtahb.0.4 s max deg': mid.max, 'gtahb.held W mean deg': held.mean, 'gtahb.4/8 taps mean deg': half.mean, 'gtahb.no steer mean deg': none.mean });
  });

  it('nervous key taps at 120 km/h keep the car on its line', async () => {
    // Critic probe P5: alternating 67 ms taps at 6 Hz for 4 s at a held 120 km/h; lateral
    // peak-to-peak between 1 and 4 s (the net offset from the tap phase is not the point).
    const rig = await Rig.create(); rig.settle(0.5); rig.launch(120 / KMH);
    const hold = () => (rig.car.forwardSpeed * KMH < 120 ? 1 : 0);
    for (let i = 0; i < 30; i++) rig.stepInput(input({ forward: hold() }));
    const x0 = rig.car.pos.x;
    let minX = Infinity, maxX = -Infinity, maxSlip = 0;
    for (let fr = 0; fr < 60 * 7; fr++) {
      const steer = fr < 240 && fr % 10 < 4 ? (Math.floor(fr / 10) % 2 ? 1 : -1) : 0;
      rig.stepInput(input({ steer, forward: hold() }));
      if (fr > 60 && fr < 240) { minX = Math.min(minX, rig.car.pos.x - x0); maxX = Math.max(maxX, rig.car.pos.x - x0); }
      maxSlip = Math.max(maxSlip, Math.abs(rig.car.bodySlip));
    }
    report['taps120.lateral pk-pk m (1-4 s)'] = maxX - minX;
    report['taps120.max slip deg'] = deg(maxSlip);
    expect(maxX - minX).toBeLessThan(1);
    expect(deg(maxSlip)).toBeLessThan(3);
  });

  // --- Regression probes from handling critic round 2 ------------------------------------------

  // Tight low-speed turns are judged by the rear tyres' slip angle: at full lock and 18 km/h the
  // body slip is ~20° from geometry alone while the car grips; a rear tyre past ~12° is sliding.
  const rearSlip = (rig: Rig) => Math.max(Math.abs(rig.car.wheels[2].slipAngle), Math.abs(rig.car.wheels[3].slipAngle));

  it('full lock and throttle while rolling slowly grips instead of spinning', async () => {
    for (const kmh of [10, 20]) {
      const rig = await Rig.create(); rig.settle(0.5); rig.launch(kmh / KMH);
      let maxSlip = 0;
      for (let t = 0; t < 4; t += DT) { rig.stepInput(input({ steer: -1, forward: 1 })); if (t > 0.3) maxSlip = Math.max(maxSlip, rearSlip(rig)); }
      report[`rolling W+A ${kmh} km/h max rear tyre slip deg`] = deg(maxSlip);
      expect(deg(maxSlip)).toBeLessThan(12);
    }
  });

  it('a late trail-brake into a corner stays under control', async () => {
    const rig = await Rig.create(); rig.settle(0.5); rig.launch(100 / KMH);
    let maxSlip = 0;
    for (let t = 0; t < 6; t += DT) {
      rig.stepInput(input({ back: t < 2.6 ? 1 : 0, steer: t >= 1.6 ? 1 : 0, forward: t >= 2.6 ? 1 : 0 }));
      if (rig.car.speed > 2) maxSlip = Math.max(maxSlip, rearSlip(rig));
    }
    report['latetrail.max rear tyre slip deg'] = deg(maxSlip);
    expect(deg(maxSlip)).toBeLessThan(12);
  });

  it('reversing at full lock turns instead of smoking the tyres', async () => {
    const rig = await Rig.create(); rig.settle(0.5);
    let skid = 0;
    for (let t = 0; t < 4; t += DT) {
      rig.stepInput(input({ back: 1, steer: -1 }));
      if (t > 1.5) skid = Math.max(skid, rig.car.wheels[2].skid, rig.car.wheels[3].skid);
    }
    report['reverselock.max rear skid'] = skid;
    expect(skid).toBeLessThan(0.4);
  });

  it('slaloms cones 18 m apart at 60 km/h without sliding out', async () => {
    const rig = await Rig.create(); rig.settle(0.5); rig.launch(60 / KMH);
    const path: [number, number][] = [];
    for (let z = 0; z <= 400; z += 1) path.push([z > 20 ? 2.2 * Math.sin((z - 20) / 18 * Math.PI) : 0, z]);
    const pilot = new PathPilot(path, { speed: 60 / KMH, lookahead: 9, closed: false });
    let maxSlip = 0;
    for (let t = 0; t < 12; t += DT) { rig.stepInput(pilot.update(rig.view(), DT)); maxSlip = Math.max(maxSlip, Math.abs(rig.car.bodySlip)); }
    report['slalom60.max slip deg'] = deg(maxSlip);
    expect(deg(maxSlip)).toBeLessThan(10);
  });

  it('full lock at 150 km/h slides but does not roll', async () => {
    const rig = await Rig.create();
    rig.settle();
    rig.launch(150 / KMH);
    let minUp = 1;
    for (let t = 0; t < 4; t += DT) { rig.stepInput(input({ steer: 1, forward: 1 })); minUp = Math.min(minUp, rig.car.up.y); }
    report['fulllock150.min upright'] = minUp;
    expect(minUp).toBeGreaterThan(0.85);
  });

  it('flies off a ramp at 80 km/h and lands on its wheels', async () => {
    const rig = await Rig.create({ ramps: [{ x: 0, z: 40, yaw: 0, length: 7, width: 5, height: 1.4 }] });
    rig.settle();
    rig.launch(80 / KMH);
    let air = 0, maxAir = 0, minUp = 1, hardest = 0;
    for (let t = 0; t < 6; t += DT) {
      rig.stepInput(input({ forward: 0.6 }));
      air = rig.car.grounded === 0 ? air + DT : 0;
      maxAir = Math.max(maxAir, air);
      minUp = Math.min(minUp, rig.car.up.y);
      hardest = Math.max(hardest, rig.car.impact);
    }
    report['jump.air time s'] = maxAir;
    report['jump.min upright'] = minUp;
    report['jump.hardest chassis hit m/s'] = hardest;
    expect(maxAir).toBeGreaterThan(0.4);
    expect(minUp).toBeGreaterThan(0.8);
    expect(rig.car.wheels.every((w) => w.contact)).toBe(true);
  });

  it('holds still on a 15% slope with no input', async () => {
    const rig = await Rig.create({ slope: Math.atan(0.15), at: { x: 0, y: 0.5, z: 0 } });
    rig.settle(2);
    const p0 = rig.car.pos.clone();
    rig.settle(5);
    const moved = Math.hypot(rig.car.pos.x - p0.x, rig.car.pos.z - p0.z);
    report['slope15.creep in 5 s m'] = moved;
    expect(moved).toBeLessThan(0.05);
  });

  it('rolls itself back over after landing on its roof', async () => {
    const rig = await Rig.create({ at: { x: 0, y: 1.6, z: 0 } });
    rig.car.body.setRotation({ x: 0, y: 0, z: 1, w: 0 }, true);   // upside down
    let t = 0;
    do { rig.stepControls(emptyControls()); t += DT; } while (t < 12 && !(t > 0.5 && rig.car.up.y > 0.9 && rig.car.grounded === 4));
    report['selfright.seconds'] = t;
    expect(rig.car.up.y).toBeGreaterThan(0.9);
    expect(t).toBeLessThan(rig.car.spec.assists.selfRight + 4);
  });

  it('reverses when S is held from a standstill, capped near 35 km/h', async () => {
    const rig = await Rig.create();
    rig.settle();
    for (let t = 0; t < 8; t += DT) rig.stepInput(input({ back: 1 }));
    report['reverse.speed km/h'] = -rig.car.forwardSpeed * KMH;
    expect(rig.car.gear).toBe(-1);
    expect(-rig.car.forwardSpeed * KMH).toBeGreaterThan(28);
    expect(-rig.car.forwardSpeed * KMH).toBeLessThan(40);
  });

  it('W+S at a standstill is a burnout: rear tyres spin, the car stays put', async () => {
    const rig = await Rig.create();
    rig.settle();
    const p0 = rig.car.pos.clone();
    for (let t = 0; t < 2; t += DT) rig.stepInput(input({ forward: 1, back: 1 }));
    const moved = rig.car.pos.distanceTo(p0);
    report['burnout.moved m'] = moved;
    report['burnout.rpm'] = rig.car.rpm;
    expect(moved).toBeLessThan(0.3);
    expect(rig.car.wheels[2].skid).toBeGreaterThan(0.5);
    expect(rig.car.rpm).toBeGreaterThan(4000);
  });
});
