import { describe, expect, it } from 'vitest';
import { COASTER, MOUNTAIN } from './Layout';
import { advanceTrain, buildParkStatic, frameAt, makeFrame, trackLength, type TrainState } from './Rides';

/**
 * 水晶神翼 has to be a coaster a train can actually get round: long enough, high enough, upside
 * down somewhere, never underground, and - the one that matters - a lap that always comes home.
 * The train is stepped by the same `advanceTrain` the ride uses, so a change to the spline or the
 * lift that would strand the player shows up here instead of in the game.
 */
describe('水晶神翼 track', () => {
  const f = makeFrame();

  it('is about as long as the real ride', () => {
    const len = trackLength();
    expect(len).toBeGreaterThan(COASTER.advertised.lengthM * 0.75);
    expect(len).toBeLessThan(COASTER.advertised.lengthM * 1.25);
  });

  it('crests near the advertised 32 m and never goes underground', () => {
    const len = trackLength();
    let hi = -Infinity, lo = Infinity;
    for (let s = 0; s < len; s += 1) {
      frameAt(s, f);
      hi = Math.max(hi, f.pos.y);
      lo = Math.min(lo, f.pos.y);
    }
    expect(hi).toBeGreaterThan(COASTER.advertised.heightM - 3);
    expect(hi).toBeLessThan(COASTER.advertised.heightM + 3);
    expect(lo).toBeGreaterThan(1.5);
  });

  it('turns the train upside down and keeps the rails continuous', () => {
    const len = trackLength();
    let minUp = 1, worstStep = 1;
    const prev = makeFrame();
    frameAt(0, prev);
    for (let s = 1; s < len; s += 1) {
      frameAt(s, f);
      minUp = Math.min(minUp, f.pos.y > 0 ? f.up.y : 1);
      worstStep = Math.min(worstStep, f.up.dot(prev.up));
      prev.up.copy(f.up);
    }
    // At least one inversion: the riders' up points down somewhere.
    expect(minUp).toBeLessThan(-0.4);
    // The frame never flips between samples (a flip tears the track open).
    expect(worstStep).toBeGreaterThan(0.9);
  });

  it('flies around 水晶圣城 rather than through it', () => {
    const len = trackLength();
    let near = Infinity;
    for (let s = 0; s < len; s += 2) {
      frameAt(s, f);
      near = Math.min(near, Math.hypot(f.pos.x - MOUNTAIN.x, f.pos.z - MOUNTAIN.z));
    }
    expect(near).toBeGreaterThan(MOUNTAIN.r);
  });

  it('completes a lap from the station and gets home with speed in hand', () => {
    const st: TrainState = { s: 0, v: 2.4 };
    const dt = 1 / 60;
    let t = 0, top = 0, stalls = 0;
    let done = false;
    while (t < 300 && !done) {
      done = advanceTrain(st, dt);
      t += dt;
      top = Math.max(top, st.v);
      if (st.v <= 3.01 && st.s > COASTER.lift.to * trackLength()) stalls++;
    }
    expect(done).toBe(true);
    // A lap takes a ride's worth of time, not a coffee break.
    expect(t).toBeGreaterThan(35);
    expect(t).toBeLessThan(200);
    // Never crawls between the lift and the brake run.
    expect(stalls).toBe(0);
    // Top speed in the right country: the real one does 82 km/h.
    expect(top * 3.6).toBeGreaterThan(55);
    expect(top * 3.6).toBeLessThan(110);
  });

  it('brakes to the station when the rider asks to get off', () => {
    const st: TrainState = { s: trackLength() * 0.5, v: 20 };
    let t = 0, done = false;
    while (t < 300 && !done) { done = advanceTrain(st, 1 / 60, true); t += 1 / 60; }
    expect(done).toBe(true);
    expect(st.v).toBeLessThanOrEqual(COASTER.brake.speed + 0.01);
  });
});

describe('park model', () => {
  it('builds with colliders and the real boundary as its footprint', () => {
    const p = buildParkStatic();
    expect(p.parts.triangles()).toBeGreaterThan(5000);
    expect(p.colliders.length).toBeGreaterThan(10);
    expect(p.footprint.length).toBeGreaterThan(10);
    expect(p.height).toBeCloseTo(MOUNTAIN.h, 1);
  });
});
