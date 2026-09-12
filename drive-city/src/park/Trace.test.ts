import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COASTER } from './Layout';
import { advanceTrain, frameAt, makeFrame, trackLength, type TrainState } from './Rides';

/**
 * A lap of 水晶神翼 written out metre by metre, the way vehicle/Trace.test.ts dumps a drive:
 *   PROFILE=1 npx vitest run src/park/Trace.test.ts   ->  .scratch/park/profile.txt
 * Vitest swallows the console output of passing tests, so read the file.
 *
 * The columns are what a coaster lives or dies by: height, gradient, and the speed the train has
 * left. A stall shows up as `v` pinned at the 3 m/s floor.
 */
describe('水晶神翼 profile', () => {
  it.runIf(process.env.PROFILE)('writes a lap trace', () => {
    const f = makeFrame();
    const total = trackLength();
    const st: TrainState = { s: 0, v: 2.4 };
    const dt = 1 / 60;
    const rows: string[] = [`# 水晶神翼: ${total.toFixed(1)} m of track, lift ${COASTER.lift.from}..${COASTER.lift.to}`];
    rows.push('     t      s      y   grade   v m/s   km/h  where');
    let t = 0, next = 0, done = false;
    while (t < 400 && !done) {
      if (st.s >= next) {
        frameAt(st.s, f);
        const zone = st.s < COASTER.lift.from * total ? 'station'
          : st.s < COASTER.lift.to * total ? 'lift'
          : st.s >= COASTER.brake.from * total ? 'brake' : '';
        rows.push(`${t.toFixed(2).padStart(6)} ${st.s.toFixed(1).padStart(6)} ${f.pos.y.toFixed(1).padStart(6)} `
          + `${f.tan.y.toFixed(3).padStart(7)} ${st.v.toFixed(2).padStart(7)} ${(st.v * 3.6).toFixed(1).padStart(6)}  ${zone}`);
        next += 10;
      }
      done = advanceTrain(st, dt);
      t += dt;
    }
    rows.push(`# lap ${done ? 'finished' : 'DID NOT FINISH'} in ${t.toFixed(1)} s`);
    fs.mkdirSync('.scratch/park', { recursive: true });
    fs.writeFileSync('.scratch/park/profile.txt', rows.join('\n') + '\n');
    expect(done).toBe(true);
  });
});
