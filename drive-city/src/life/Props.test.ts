/**
 * The street's solid props (life/Props.ts PropBodies): a car driven into a 煎饼 cart pushes it on and
 * keeps going (140 kg against 1.4 t), into a 马扎 sends it flying; the props are asleep until then and
 * make their knock once.
 */
import { describe, expect, it } from 'vitest';
import { Rig } from '../vehicle/Rig';
import { PropBodies, type PropKind } from './Props';

async function ram(kind: PropKind, speed: number): Promise<{ moved: number; carAfter: number; knocks: number }> {
  const rig = await Rig.create({ at: { x: 0, y: 0.36, z: -10 }, yaw: 0 });
  let knocks = 0;
  const bodies = new PropBodies({ physics: rig.physics, events: { emit: () => { knocks++; } } });
  const b = bodies.add(kind, 0, 0.0, 0, 0)!;
  rig.car.setMoving(speed);
  for (let i = 0; i < 120; i++) { rig.stepControls({ throttle: 0.4, brake: 0, steer: 0, handbrake: false } as never); bodies.update(); }
  const t = b.translation();
  return { moved: Math.hypot(t.x, t.z), carAfter: rig.car.speed, knocks };
}

describe('solid street props', () => {
  it('a car pushes a cart aside and drives on', async () => {
    const r = await ram('cart', 8);
    expect(r.moved).toBeGreaterThan(1);
    expect(r.carAfter).toBeGreaterThan(2);
    expect(r.knocks).toBe(1);
  });
  it('a stool is knocked away or run over, never a wall', async () => {
    const r = await ram('stool', 8);
    expect(r.moved).toBeGreaterThan(0.2);
    expect(r.carAfter).toBeGreaterThan(5);
  });
  it('a table goes flying', async () => {
    const r = await ram('table', 8);
    expect(r.moved).toBeGreaterThan(2);
    expect(r.carAfter).toBeGreaterThan(5);
  });
});
