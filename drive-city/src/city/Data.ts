/**
 * City data as written by scripts/city/build.mjs (public/city/). Local metres, +X east, +Z south.
 * Outer rings have positive signed area in (x, z), holes negative.
 */
export type BuildingKind = 'glass' | 'office' | 'resid' | 'hutong' | 'trad' | 'wall' | 'low' | 'station';
export type AreaKind = 'water' | 'plaza' | 'pitch' | 'wood' | 'park' | 'grass' | 'parking' | 'rail';

export interface RoadPiece {
  /** OSM highway class. */
  c: string;
  /** Carriageway width, m. */
  w: number;
  /** 1 = one-way in point order. */
  o: 0 | 1;
  /** Lane count when tagged, else 0. */
  l: number;
  br: 0 | 1;
  n?: string;
  /** Flat [x, z, ...] points; `j[i]` = 1 where point i is a junction. */
  p: number[];
  j: number[];
  /** Neighbour points just outside this piece (for continuous normals), or 0. */
  a: number[] | 0;
  b: number[] | 0;
}

export interface BuildingRec {
  i: number;
  k: BuildingKind;
  /** Total height incl. roof, base height, roof shape code, roof height. */
  h: number; m: number; r: 'f' | 'g' | 'h' | 'p' | 's' | 'd'; rh: number;
  o: number[];
  hs?: number[][];
  c?: string; rc?: string;
  /** Oriented box [cx, cz, angle of long axis, half length, half width] for pitched roofs. */
  ob?: [number, number, number, number, number];
  n?: string;
  /** Per-building random 0..1. */
  s: number;
}

export interface AreaRec { k: AreaKind; o: number[]; hs?: number[][] }

export interface TileData {
  ix: number; iz: number;
  roads: RoadPiece[];
  buildings: BuildingRec[];
  areas: AreaRec[];
  /** [x, z, type, scale] per tree: 0 scholar tree, 1 poplar, 2 cypress, 3 ginkgo. */
  trees: number[];
  /** [x, z, yaw] per street lamp (yaw points the arm over the road). */
  lamps: number[];
  signals: number[];
  /** [x, z, road angle, road width] per zebra crossing. */
  crossings: number[];
  /** [x, z, road angle] per bus stop. */
  stops: number[];
}

export interface Manifest {
  version: number;
  tile: number;
  origin: { lat: number; lon: number };
  bounds: { x0: number; z0: number; x1: number; z1: number };
  /** "ix_iz" -> [buildings, road pieces, trees]. */
  tiles: Record<string, [number, number, number]>;
  spawn: { x: number; z: number; yaw: number; road: string };
  named: Record<string, [number, number]>;
  attribution: string;
}

export interface NetworkEdge { a: number; b: number; p: number[]; c: string; o: 0 | 1; l: number; w: number; n?: string; br?: 1 }
export interface Network { nodes: number[]; sig: number[]; edges: NetworkEdge[] }
/** Buildings of 20 m+ for the far skyline: [cx, cz, angle, halfLength, halfWidth, height, kindIndex, seed] each. */
export interface Skyline { b: number[] }
export const KINDS: BuildingKind[] = ['glass', 'office', 'resid', 'hutong', 'trad', 'wall', 'low', 'station'];

const BASE: string = (import.meta as unknown as { env?: { BASE_URL?: string } }).env?.BASE_URL ?? '/';

export async function loadCity<T>(file: string): Promise<T> {
  const r = await fetch(`${BASE}city/${file}`);
  if (!r.ok) throw new Error(`city data ${file}: HTTP ${r.status}`);
  return r.json() as Promise<T>;
}
