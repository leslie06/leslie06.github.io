import type { Furniture } from './visual/StreetFurniture';

/** Point in polygon; `r` is a flat [x, z, ...] ring in world XZ. */
export function inside(x: number, z: number, r: number[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 2; i < r.length; j = i, i += 2) {
    const ax = r[i], az = r[i + 1], bx = r[j], bz = r[j + 1];
    if ((az > z) !== (bz > z) && x < (bx - ax) * (z - az) / (bz - az) + ax) c = !c;
  }
  return c;
}

/** `list` without the records (of `stride` numbers, x at `xi` and z at `zi`) that stand in a zone. */
export function dropInside(list: number[], stride: number, zones: number[][], xi = 0, zi = 1): number[] {
  if (!zones.length || !list.length) return list;
  const out: number[] = [];
  for (let i = 0; i < list.length; i += stride) {
    if (zones.some((r) => inside(list[i + xi], list[i + zi], r))) continue;
    for (let k = 0; k < stride; k++) out.push(list[i + k]);
  }
  return out;
}

/**
 * What a landmark's `clear` zones take off the street: trees and lamps (both get colliders in the
 * Streamer) and the furniture drawn along the kerb. A footprint only removes *buildings*; the
 * villa's drive crosses 恒惠路's pavement outside its footprint, and the street tree standing 0.6 m
 * off its centre line, with a lamp on its north edge, wedged every car that turned in from the north.
 */
export function clearStreet(s: { trees: number[]; lamps: number[]; furniture: Furniture }, zones: number[][]): { trees: number[]; lamps: number[]; furniture: Furniture } {
  if (!zones.length) return s;
  const f = s.furniture;
  return {
    trees: dropInside(s.trees, 4, zones),
    lamps: dropInside(s.lamps, 3, zones),
    furniture: {
      rail: dropInside(f.rail, 5, zones, 0, 2), shelter: dropInside(f.shelter, 4, zones, 0, 2),
      bin: dropInside(f.bin, 4, zones, 0, 2), bike: dropInside(f.bike, 5, zones, 0, 2),
    },
  };
}
