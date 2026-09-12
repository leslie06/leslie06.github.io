// The playable area and the map projection. Shared by the data scripts (Node) and mirrored in
// src/city/Geo.ts for the game. Origin: the Tiananmen gate. Local metres, +X east, +Z south.
export const ORIGIN = { lat: 39.90883, lon: 116.39757 };
// Extended south-east on 2026-09-12 to reach 北京欢乐谷 (39.8637 N, 116.4937 E) and the East 4th
// Ring Road with it. The projection origin is unchanged, so every tile already built keeps its key.
export const BBOX = { s: 39.857, w: 116.386, n: 39.926, e: 116.504 };
export const CHUNKS = 4;   // 16 chunks of ~2.0 x 2.5 km: the 5.3 MB chunk was already near the Overpass timeout.
export const TILE = 256;
const R = 6378137;
export function project(lat, lon) {
  const x = (lon - ORIGIN.lon) * Math.PI / 180 * R * Math.cos(ORIGIN.lat * Math.PI / 180);
  const z = -(lat - ORIGIN.lat) * Math.PI / 180 * R;
  return [x, z];
}
