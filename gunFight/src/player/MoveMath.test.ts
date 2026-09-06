import { describe, it, expect } from 'vitest';
import { applyFriction, accelerate, capSpeed, clipVelocity, stepSmoothingDelta, slideSpeedStep, mantlePoint, mantleDuration, landingImpulse, landingSpeedMul } from './MoveMath';
import { horizontalToVerticalFov, zoomSensitivity } from './PlayerSettings';

describe('ground model', () => {
  it('friction brings you to a complete stop', () => {
    const v = { x: 4.6, y: 0, z: 0 };
    for (let i = 0; i < 120; i++) applyFriction(v, 9, 1.6, 1 / 60);
    expect(v.x).toBe(0);
  });
  it('accelerate reaches max speed and does not exceed it', () => {
    const v = { x: 0, y: 0, z: 0 }; const wish = { x: 1, y: 0, z: 0 };
    let t = 0;
    while (v.x < 4.6 - 1e-6 && t < 2) { applyFriction(v, 9, 1.6, 1 / 60); accelerate(v, wish, 4.6, 11, 1 / 60); t += 1 / 60; }
    expect(t).toBeLessThan(0.5);
    for (let i = 0; i < 60; i++) { applyFriction(v, 9, 1.6, 1 / 60); accelerate(v, wish, 4.6, 11, 1 / 60); }
    expect(v.x).toBeLessThanOrEqual(4.6 + 1e-9);
    expect(v.x).toBeGreaterThan(4.4);
  });
  it('accelerate with zero wish does nothing', () => {
    const v = { x: 1, y: 0, z: 2 }; accelerate(v, { x: 0, y: 0, z: 0 }, 5, 10, 0.1);
    expect(v).toEqual({ x: 1, y: 0, z: 2 });
  });
  it('capSpeed preserves direction', () => {
    const v = { x: 3, y: 0, z: 4 }; capSpeed(v, 2.5);
    expect(Math.hypot(v.x, v.z)).toBeCloseTo(2.5); expect(v.x / v.z).toBeCloseTo(0.75);
  });
});

describe('clipVelocity', () => {
  it('removes only the into-wall component (no bounce)', () => {
    const v = { x: 3, y: 0, z: -4 }; clipVelocity(v, { x: 0, y: 0, z: 1 });
    expect(v).toEqual({ x: 3, y: 0, z: 0 });
  });
  it('leaves velocity moving away from the wall alone', () => {
    const v = { x: 3, y: 0, z: 4 }; clipVelocity(v, { x: 0, y: 0, z: 1 });
    expect(v).toEqual({ x: 3, y: 0, z: 4 });
  });
});

describe('stairs', () => {
  it('a step up on flat ground yields an equal and opposite camera offset', () => {
    expect(stepSmoothingDelta(0.2, true, true, true, true)).toBeCloseTo(-0.2);
  });
  it('slopes, airborne frames and tiny changes are ignored', () => {
    expect(stepSmoothingDelta(0.2, true, true, false, true)).toBe(0);
    expect(stepSmoothingDelta(0.2, false, true, true, true)).toBe(0);
    expect(stepSmoothingDelta(0.01, true, true, true, true)).toBe(0);
  });
});

describe('slide / mantle / landing', () => {
  it('slide decays and slopes add speed', () => {
    expect(slideSpeedStep(8, 5.6, 0, 0.5, 0)).toBeCloseTo(5.2);
    expect(slideSpeedStep(8, 5.6, 10, 0.5, 0)).toBeCloseTo(10.2);
    expect(slideSpeedStep(1, 5.6, 0, 1, 0)).toBe(0);
  });
  it('mantle rises before it moves forward and ends exactly at the target', () => {
    const m = { startY: 1, topY: 2, startX: 0, startZ: 0, endX: 0, endZ: -1, duration: 0.4 };
    const p = { x: 0, y: 0, z: 0 };
    mantlePoint(m, 0.1, p);
    expect(p.y).toBeGreaterThan(1.3); expect(p.z).toBeGreaterThan(-0.05);
    mantlePoint(m, 0.4, p); expect(p.y).toBeCloseTo(2); expect(p.z).toBeCloseTo(-1);
    mantlePoint(m, 5, p); expect(p.y).toBeCloseTo(2);
    let prev = 1;
    for (let t = 0; t <= 0.4; t += 0.01) { mantlePoint(m, t, p); expect(p.y).toBeGreaterThanOrEqual(prev - 1e-9); prev = p.y; }
  });
  it('taller ledges take longer', () => { expect(mantleDuration(1.4)).toBeGreaterThan(mantleDuration(0.5)); expect(mantleDuration(0.4)).toBeCloseTo(0.28); });
  it('landing impulse scales with fall speed and is capped', () => {
    expect(landingImpulse(1)).toBe(0);
    expect(landingImpulse(6)).toBeGreaterThan(landingImpulse(4));
    expect(landingImpulse(100)).toBe(3.6);
  });
  it('hard landings cost speed, soft ones do not', () => {
    expect(landingSpeedMul(4)).toBe(1); expect(landingSpeedMul(10)).toBeLessThan(1); expect(landingSpeedMul(100)).toBe(0.4);
  });
});

describe('fov / sensitivity', () => {
  it('80 horizontal at 16:9 is about 50.6 vertical', () => { expect(horizontalToVerticalFov(80, 16 / 9)).toBeCloseTo(50.6, 0); });
  it('relative ADS sensitivity shrinks with zoom, legacy does not', () => {
    expect(zoomSensitivity(80, 55, 'relative', 1)).toBeLessThan(0.7);
    expect(zoomSensitivity(80, 80, 'relative', 1)).toBeCloseTo(1);
    expect(zoomSensitivity(80, 30, 'legacy', 0.9)).toBe(0.9);
  });
});
