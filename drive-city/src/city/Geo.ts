/**
 * Map projection shared with scripts/city/region.mjs (keep the two in step). Origin: the Tiananmen
 * gate. Local metres, +X east, +Z south, +Y up. An equirectangular projection is exact to a few
 * centimetres over the 7 km play area.
 */
export const ORIGIN = { lat: 39.90883, lon: 116.39757 };
export const TILE = 256;
const R = 6378137;
const KX = Math.PI / 180 * R * Math.cos(ORIGIN.lat * Math.PI / 180);
const KZ = Math.PI / 180 * R;

export function project(lat: number, lon: number): [number, number] {
  return [(lon - ORIGIN.lon) * KX, -(lat - ORIGIN.lat) * KZ];
}

export function unproject(x: number, z: number): { lat: number; lon: number } {
  return { lat: ORIGIN.lat - z / KZ, lon: ORIGIN.lon + x / KX };
}

export const tileOf = (x: number, z: number): [number, number] => [Math.floor(x / TILE), Math.floor(z / TILE)];
export const tileKey = (ix: number, iz: number) => `${ix}_${iz}`;
