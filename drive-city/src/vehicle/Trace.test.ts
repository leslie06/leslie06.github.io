/**
 * Time traces for tuning, off by default: `TRACE=fig8 npx vitest run src/vehicle/Trace.test.ts`
 * (park | accel | brake | fig8 | fig8key | handbrake). Prints one row every `EVERY` steps.
 */
import { describe, it } from 'vitest';
import fs from 'node:fs';
import { Rig, KeyTapper } from './Rig';
import { PathPilot, figureEight } from './Autopilot';
import { emptyControls, type DriveInput } from './ControlFilter';

const which = process.env.TRACE ?? '';
const EVERY = Number(process.env.EVERY ?? 15);
const DT = 1 / 60;
const f = (v: number, d = 2) => (Number.isFinite(v) ? v.toFixed(d) : String(v)).padStart(7);
const input = (o: Partial<DriveInput> = {}): DriveInput => ({ forward: 0, back: 0, steer: 0, analog: false, handbrake: false, ...o });

function row(rig: Rig, extra = ''): string {
  const c = rig.car, w = c.wheels;
  return `${f(rig.time)} v${f(c.forwardSpeed * 3.6, 1)} lat${f(c.lateralSpeed)} vy${f(c.vel.y, 3)} slip${f(c.bodySlip * 57.3, 1)} yaw${f(c.yawRate)} ` +
    `g${c.gear} rpm${f(c.rpm, 0)} thr${f(c.throttle)} brk${f(c.brake)} st${f(c.steerAngle * 57.3, 1)} ` +
    `Fz${w.map((x) => f(x.load, 0)).join('')} sk${w.map((x) => f(x.skid, 1)).join('')} up${f(c.up.y, 3)} ${extra}`;
}

describe.skipIf(!which)('trace', () => {
  it(which, async () => {
    const out: string[] = [];
    if (which === 'park' || which === 'slope') {
      const rig = await Rig.create(which === 'slope' ? { slope: Math.atan(0.15), at: { x: 0, y: 0.5, z: 0 } } : {});
      for (let i = 0; i < 60 * 6; i++) { rig.stepControls(emptyControls()); if (i % EVERY === 0) out.push(row(rig, `z${f(rig.car.pos.z, 3)}`)); }
    } else if (which === 'accel') {
      const rig = await Rig.create(); rig.settle();
      for (let i = 0; i < 60 * 14; i++) { rig.stepInput(input({ forward: 1 })); if (i % EVERY === 0) out.push(row(rig)); }
    } else if (which === 'brake') {
      const rig = await Rig.create(); rig.settle(); rig.launch(100 / 3.6);
      for (let i = 0; i < 60 * 5; i++) { rig.stepInput(input({ back: 1 })); if (i % EVERY === 0) out.push(row(rig, `x${f(rig.car.pos.x)} z${f(rig.car.pos.z)}`)); }
    } else if (which === 'handbrake') {
      const rig = await Rig.create(); rig.settle(); rig.launch(60 / 3.6);
      for (let i = 0; i < 60 * 5; i++) { const t = i / 60; rig.stepInput(input({ steer: t < 1.6 ? -1 : 0, handbrake: t < 1, forward: t > 1 && t < 2.2 ? 1 : 0 })); if (i % EVERY === 0) out.push(row(rig)); }
    } else if (which === 'powerdrift') {
      const rig = await Rig.create(); rig.settle(); rig.launch(50 / 3.6);
      for (let i = 0; i < 60 * 8; i++) { const t = i / 60; rig.stepInput(input({ steer: -1, handbrake: t < 0.4, forward: t >= 0.4 ? 1 : 0 })); if (i % EVERY === 0) out.push(row(rig)); }
    } else if (which.startsWith('fig8')) {
      const rig = await Rig.create({ yaw: Math.PI / 2 }); rig.settle();
      const per = 120;
      const pilot = new PathPilot(figureEight(0, 0, 24, per), { speed: 13, lookahead: 10, closed: true, drift: { tap: 0.32, slip: 0.4, rekick: 0.2, entries: [6, per + 6], kickZones: [[16, per - 14], [per + 16, 2 * per - 14]] } });
      const sk = new KeyTapper();
      for (let i = 0; i < 60 * 40; i++) {
        const a = pilot.update(rig.view(), DT);
        const inp = which === 'fig8key' ? input({ steer: sk.tap(a.steer), forward: a.forward > 0.45 ? 1 : 0, back: a.back > 0.3 ? 1 : 0, handbrake: a.handbrake }) : a;
        rig.stepInput(inp);
        if (i % EVERY === 0) out.push(row(rig, `idx${String(pilot.index).padStart(4)} cte${f(pilot.crossTrack)} laps${f(pilot.laps)} hb${inp.handbrake ? 1 : 0} in${f(a.steer)}`));
      }
    }
    fs.mkdirSync('.scratch', { recursive: true });
    fs.writeFileSync(`.scratch/trace-${which}.txt`, out.join('\n') + '\n');
  }, 120000);
});
