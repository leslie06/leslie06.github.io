/**
 * public/city/mountain.bin (scripts/city/mountain.mjs): the ground west of the city, the roads to and up 妙峰山 with
 * their heights and banking, the guardrail runs, the trees and the props. gzip over: u32 header length, the header
 * JSON (padded to 4), the terrain (Int16 decimetres, rows by z, each row's first sample and then the steps), each road's
 * points (Float32 x, y, z, bank), the trees (Uint16 x, z from the grid's corner in 0.1 / 0.2 m, Int16 y dm, Uint8 type
 * and scale in hundredths).
 */
/**
 * The ground the mountain owns west of the city's edge (its far hills reach this far north and south): the city's ground
 * plane leaves it out (city/index.ts), or the two would fight at y 0 along the edge. Matches scripts/city/mountain.mjs
 * (the far hills' box); `?mountain=0` gives it back to the city.
 */
export const WEST = { x1: -17211.9, z0: -12100, z1: 3600 };
/** Roads the city's traffic does not drive into (2026-10-22: it jammed on the hairpins; the hills are quiet at dawn).
 *  The police still follow you up (they route, they do not wander). */
export const NO_TRAFFIC_ROADS = new Set(['京拉路', '妙峰山路']);
export const mountainOn = (): boolean => typeof location === 'undefined' || new URLSearchParams(location.search).get('mountain') !== '0';

export interface MountainRoad { name: string; en: string; cls: string; hw: number; n: number; ring: boolean; /** x, y, z, bank per point, 2 m apart. */ p: Float32Array }
export interface MountainProp { k: string; x: number; y: number; z: number; yaw?: number; [key: string]: unknown }
export interface MountainData {
  grid: { x0: number; z0: number; nx: number; nz: number; cell: number };
  /** Heights (m), nx per row, nz rows (row j at z0 + j * cell). */
  h: Float32Array;
  roads: MountainRoad[];
  /** [road, side (+1 left of travel, -1 right), from, to] point indices. */
  rails: [number, number, number, number][];
  props: MountainProp[];
  summit: { x: number; y: number; z: number };
  foot: { x: number; y: number; z: number };
  merge: [number, number];
  shoulder: number;
  /** x, y, z, type, scale per tree. */
  trees: Float32Array;
  /** The far hills round the detailed ground (100 m): heights, NaN inside the detailed ground. */
  ring: { x0: number; z0: number; nx: number; nz: number; cell: number; h: Float32Array };
}

async function gunzip(buf: ArrayBuffer): Promise<ArrayBuffer> {
  if (typeof window === 'undefined') {
    const zlib = await import(/* @vite-ignore */ 'node:zlib');
    const b = zlib.gunzipSync(Buffer.from(buf));
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  }
  const ds = new Blob([buf]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Response(ds).arrayBuffer();
}

export function parseMountain(raw: ArrayBuffer): MountainData {
  const dv = new DataView(raw);
  const hl = dv.getUint32(0, true);
  const hdr = JSON.parse(new TextDecoder().decode(new Uint8Array(raw, 4, hl)));
  let o = 4 + hl;
  const { nx, nz } = hdr.grid;
  const t = new Int16Array(raw.slice(o, o + nx * nz * 2));
  o += nx * nz * 2;
  const h = new Float32Array(nx * nz);
  for (let j = 0; j < nz; j++) { let v = 0; for (let i = 0; i < nx; i++) { const k = j * nx + i; v = i ? v + t[k] : t[k]; h[k] = v / 10; } }
  const roads: MountainRoad[] = hdr.roads.map((r: Omit<MountainRoad, 'p'>) => {
    const p = new Float32Array(raw.slice(o, o + r.n * 16));
    o += r.n * 16;
    return { ...r, p };
  });
  const nt: number = hdr.trees;
  const tx = new Uint16Array(raw.slice(o, o + nt * 4)); o += nt * 4;
  const ty = new Int16Array(raw.slice(o, o + nt * 2)); o += nt * 2;
  const tk = new Uint8Array(raw.slice(o, o + nt * 2)); o += nt * 2;
  const R = hdr.ring, rr = new Int16Array(raw.slice(o, o + R.nx * R.nz * 2)), rh = new Float32Array(R.nx * R.nz);
  for (let k = 0; k < rh.length; k++) rh[k] = rr[k] === -32768 ? NaN : rr[k] / 10;
  const trees = new Float32Array(nt * 5);
  for (let k = 0; k < nt; k++) trees.set([hdr.grid.x0 + tx[k * 2] / 10, ty[k] / 10, hdr.grid.z0 + tx[k * 2 + 1] / 5, tk[k * 2], tk[k * 2 + 1] / 100], k * 5);
  return { grid: hdr.grid, h, roads, rails: hdr.rails, props: hdr.props, summit: hdr.summit, foot: hdr.foot, merge: hdr.merge, shoulder: hdr.shoulder, trees, ring: { ...R, h: rh } };
}

export async function loadMountain(): Promise<MountainData> {
  let buf: ArrayBuffer;
  if (typeof window === 'undefined') {
    const fs = await import(/* @vite-ignore */ 'node:fs');
    const b = fs.readFileSync('public/city/mountain.bin');
    buf = b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  } else {
    const r = await fetch(new URL(`${import.meta.env.BASE_URL}city/mountain.bin`, document.baseURI).href);
    if (!r.ok) throw new Error(`mountain.bin: HTTP ${r.status}`);
    buf = await r.arrayBuffer();
  }
  return parseMountain(await gunzip(buf));
}

/** Ground height at (x, z), bilinear (clamped to the grid). */
export function heightAt(d: MountainData, x: number, z: number): number {
  const { x0, z0, nx, nz, cell } = d.grid;
  const fx = Math.min(Math.max((x - x0) / cell, 0), nx - 1.001), fz = Math.min(Math.max((z - z0) / cell, 0), nz - 1.001);
  const i = Math.floor(fx), j = Math.floor(fz), u = fx - i, v = fz - j, h = d.h;
  const a = h[j * nx + i] + (h[j * nx + i + 1] - h[j * nx + i]) * u, b = h[(j + 1) * nx + i] + (h[(j + 1) * nx + i + 1] - h[(j + 1) * nx + i]) * u;
  return a + (b - a) * v;
}
