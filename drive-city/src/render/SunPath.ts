/**
 * Where the sun and the moon are at a given Beijing clock time. Pure math, no three.js.
 *
 * Real solar geometry at Beijing's latitude (39.9 N) and a late-August declination (+12 deg), with
 * one liberty: the clock is mapped to the solar hour angle through a monotone spline instead of
 * 15 deg/h. The real sun drops ~11 deg/h near the horizon, so a golden 17:00 (sun at ~11 deg) would
 * put 19:30 deep in nautical twilight (-16 deg), not blue hour. The spline slows the evening down
 * (the way open-world games stretch magic hour) so the clock reads the way the design asks:
 *
 *   06:00 sunrise (+1.5)   12:15 noon (62)   17:00 golden (11)   17:30 low gold (7)
 *   18:30 sunset (0)       19:30 blue hour (-5)   20:30 dusk ends (-12)   22:00 night (-25)
 *
 * The moon is a full moon: opposite hour angle and declination, so it rises in the east as the sun
 * sets and stands ~38 deg high at 00:30.
 *
 * World frame (the city's, see scripts/city/region.mjs): +X east, +Y up, +Z south.
 */
export const LATITUDE_DEG = 39.9;
export const DECLINATION_DEG = 12;

const D2R = Math.PI / 180;

/** Clock hour -> hour angle in degrees (negative = morning). Padded past both ends so midnight is smooth. */
const KEYS: [number, number][] = [
  [-2, 137.8 - 360], [0, -180], [6, -98.2], [12.25, 0], [17, 85.6], [17.5, 90.9],
  [18.5, 100.2], [19.5, 107.1], [20.5, 117.1], [22, 137.8], [24, 180], [30, 360 - 98.2],
];

/** Fritsch-Carlson monotone cubic through (xs, ys). */
export function monotoneSpline(xs: number[], ys: number[]): (x: number) => number {
  const n = xs.length;
  const d: number[] = [];
  for (let i = 0; i < n - 1; i++) d.push((ys[i + 1] - ys[i]) / (xs[i + 1] - xs[i]));
  const m: number[] = new Array(n);
  m[0] = d[0]; m[n - 1] = d[n - 2];
  for (let i = 1; i < n - 1; i++) m[i] = d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (d[i] === 0) { m[i] = m[i + 1] = 0; continue; }
    const a = m[i] / d[i], b = m[i + 1] / d[i];
    const s = a * a + b * b;
    if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * d[i]; m[i + 1] = t * b * d[i]; }
  }
  return (x: number) => {
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = xs[i + 1] - xs[i];
    const t = (x - xs[i]) / h;
    const t2 = t * t, t3 = t2 * t;
    return (2 * t3 - 3 * t2 + 1) * ys[i] + (t3 - 2 * t2 + t) * h * m[i] + (-2 * t3 + 3 * t2) * ys[i + 1] + (t3 - t2) * h * m[i + 1];
  };
}

const hourAngleSpline = monotoneSpline(KEYS.map((k) => k[0]), KEYS.map((k) => k[1]));

/** Hour angle (deg) of the sun at clock hour `h` (wrapped into 0..24). */
export function sunHourAngle(h: number): number {
  const w = ((h % 24) + 24) % 24;
  return hourAngleSpline(w);
}

export interface SkyBody {
  /** Unit vector from the scene towards the body (world frame). */
  x: number; y: number; z: number;
  elevationDeg: number;
  azimuthDeg: number;
}

/** Direction of a body with hour angle `H` and declination `dec` (degrees) at LATITUDE_DEG; fills `out` if given. */
export function bodyDirection(H: number, dec: number, lat = LATITUDE_DEG, out?: SkyBody): SkyBody {
  const h = H * D2R, d = dec * D2R, p = lat * D2R;
  const sinEl = Math.sin(p) * Math.sin(d) + Math.cos(p) * Math.cos(d) * Math.cos(h);
  const el = Math.asin(Math.max(-1, Math.min(1, sinEl)));
  // Azimuth from north, clockwise (east = 90).
  const az = Math.atan2(-Math.cos(d) * Math.sin(h), Math.sin(d) * Math.cos(p) - Math.cos(d) * Math.sin(p) * Math.cos(h));
  const ce = Math.cos(el);
  const o = out ?? { x: 0, y: 0, z: 0, elevationDeg: 0, azimuthDeg: 0 };
  o.x = ce * Math.sin(az); o.y = Math.sin(el); o.z = -ce * Math.cos(az);
  o.elevationDeg = el / D2R; o.azimuthDeg = ((az / D2R) + 360) % 360;
  return o;
}

export function sunAt(hour: number, out?: SkyBody): SkyBody { return bodyDirection(sunHourAngle(hour), DECLINATION_DEG, LATITUDE_DEG, out); }

export function moonAt(hour: number, out?: SkyBody): SkyBody { return bodyDirection(sunHourAngle(hour) + 180, -DECLINATION_DEG, LATITUDE_DEG, out); }

/** 0 = full day .. 1 = full night, from the sun's elevation: lamps start at sunset, fully on by -9 deg. */
export function nightFromElevation(elevationDeg: number): number {
  const t = Math.max(0, Math.min(1, (3 - elevationDeg) / 12));
  return t * t * (3 - 2 * t);
}
