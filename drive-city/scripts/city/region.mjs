// The playable area and the map projection. Shared by the data scripts (Node) and mirrored in
// src/city/Geo.ts for the game. Origin: the Tiananmen gate. Local metres, +X east, +Z south.
export const ORIGIN = { lat: 39.90883, lon: 116.39757 };
export const BBOX = { s: 39.872, w: 116.386, n: 39.926, e: 116.472 };
export const CHUNKS = 3;
export const TILE = 256;
const R = 6378137;
export function project(lat, lon) {
  const x = (lon - ORIGIN.lon) * Math.PI / 180 * R * Math.cos(ORIGIN.lat * Math.PI / 180);
  const z = -(lat - ORIGIN.lat) * Math.PI / 180 * R;
  return [x, z];
}
