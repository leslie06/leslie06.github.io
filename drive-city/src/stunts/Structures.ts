/**
 * Dimensions of the built stunt structures, shared by the generator that places them
 * (Spots.gen.test.ts) and the code that builds them.
 */

/**
 * Overpass flight: an embankment `ramp` m long rising to `h`, a flat deck `deck` m on pillars to the
 * lip, `w` wide; across the road a mound `landH` high: its edge `front` m past the kerb, a flat top
 * `top` m long, then a `land` m slope down. A flight lands 2-10 m past the kerb with the nose up
 * (held throttle pitches it ~35° over a second in the air); with a ridge 6 m in the car came down
 * on the ridge and bounced into a roll, and on a bare down slope the rear touched first and it
 * went over the nose. A flat top takes it the way the ramps' flat landings do.
 */
export const OVERPASS = { ramp: 55, deck: 15, h: 6, w: 8, land: 25, landH: 3, front: 2, top: 12 };

/** The underground car park: a ramp `ramp` m long and `rampW` wide down to `depth`, then a hall `hall` m long and `hallW` wide under a slab. */
export const UNDERGROUND = { ramp: 36, rampW: 7, depth: 5, hall: 40, hallW: 30, slab: 0.5 };

/** Half width of the lane cleared through a hutong shortcut, and how far it runs on past each end. */
export const SHORTCUT_LANE = { half: 4, lead: 8 };

/**
 * The shortcuts' corridors as `clear` zones for the city (world XZ, flat rings, one quad per
 * segment): the generator only asks for a car's half width clear of the line, but nobody drives a
 * footpath on its centre line - #5 has a street tree 3.65 m off it, which a car 2.5 m wide of the
 * line meets. Trees, lamps and kerb furniture within `half` of the line go, as on the villa's
 * drive; buildings stay.
 */
export function shortcutClear(paths: readonly { p: readonly number[] }[]): number[][] {
  const { half, lead } = SHORTCUT_LANE, out: number[][] = [];
  for (const { p } of paths) {
    const n = p.length / 2;
    for (let k = 1; k < n; k++) {
      let ax = p[k * 2 - 2], az = p[k * 2 - 1], bx = p[k * 2], bz = p[k * 2 + 1];
      const L = Math.hypot(bx - ax, bz - az);
      if (L < 1e-3) continue;
      const dx = (bx - ax) / L, dz = (bz - az) / L, nx = dz * half, nz = -dx * half;
      // Overlap the joints by the half width, and run on past the two ends onto the street.
      const a = k === 1 ? lead : half, b = k === n - 1 ? lead : half;
      ax -= dx * a; az -= dz * a; bx += dx * b; bz += dz * b;
      out.push([ax + nx, az + nz, bx + nx, bz + nz, bx - nx, bz - nz, ax - nx, az - nz]);
    }
  }
  return out;
}
