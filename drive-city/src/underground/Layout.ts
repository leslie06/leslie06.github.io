import { UNDERGROUND_AT } from '../stunts/spots';
import { UNDERGROUND } from '../stunts/Structures';

/**
 * Where the underground car park is and how it maps to the world. Local frame: the top of the ramp
 * at the origin, +z down the ramp along the heading (which is square to the axes, see the
 * generator), +x to its left... well, to +x of that turn; the hall follows the ramp.
 */
export const U = UNDERGROUND;
export const AT = UNDERGROUND_AT;

/** Local (x, z) to world (x, z). */
export function toWorld(lx: number, lz: number): [number, number] {
  const a = AT!, c = Math.cos(a.yaw), s = Math.sin(a.yaw);
  return [a.x + lx * c + lz * s, a.z - lx * s + lz * c];
}
/** World (x, z) to local (x, z). */
export function toLocal(x: number, z: number): [number, number] {
  const a = AT!, c = Math.cos(a.yaw), s = Math.sin(a.yaw), dx = x - a.x, dz = z - a.z;
  return [dx * c - dz * s, dx * s + dz * c];
}

interface Box { x0: number; z0: number; x1: number; z1: number }
const bounds = (lx0: number, lz0: number, lx1: number, lz1: number): Box => {
  const pts = [toWorld(lx0, lz0), toWorld(lx1, lz0), toWorld(lx0, lz1), toWorld(lx1, lz1)];
  return { x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])), z0: Math.min(...pts.map((p) => p[1])), z1: Math.max(...pts.map((p) => p[1])) };
};

/**
 * The holes the city cuts in its ground for the car park: `all` in the collider (the car park's own
 * floors and roof take over), `open` in the drawn plane (the ramp, open to the sky).
 */
export function undergroundHoles(): { all: Box; open: Box } | null {
  if (!AT) return null;
  const wall = 0.6;
  return {
    all: bounds(-U.hallW / 2 - wall, -1, U.hallW / 2 + wall, U.ramp + U.hall + wall),
    open: bounds(-U.rampW / 2 - 0.4, 0, U.rampW / 2 + 0.4, U.ramp),
  };
}
