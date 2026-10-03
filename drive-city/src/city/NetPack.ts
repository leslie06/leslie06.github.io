import type { Network, NetworkEdge } from './Data';

/**
 * network.json packed for the wire (2026-10-03): 6.8 MB / 1.7 MB gzipped held up the boot on a slow
 * link, and the boot waits for it (traffic, GPS, the map's roads). The full file stays as it is - the
 * build's scripts and the tests read it - and `public/city/network.pack.json` is what the game fetches:
 * every coordinate in decimetres as a delta (an edge's first point from its start node, the rest from
 * the point before), heights in decimetres as deltas, the class and name of each edge as an index into a
 * table, and the edge fields in parallel arrays. Lossless at the 0.1 m the file already rounds to.
 * Shared by the build (`packNetwork`) and the game (`unpackNetwork`), so the two cannot drift.
 */
export interface NetworkPack {
  v: 1;
  /** Node coordinates as decimetre deltas from the node before. */
  nodes: number[];
  sig: number[];
  classes: string[]; names: string[];
  a: number[]; b: number[];
  /** Per edge: point count, then the deltas of all of them, flattened. */
  pn: number[]; p: number[];
  c: number[]; o: number[]; l: number[]; w: number[];
  /** Name index + 1 per edge (0: unnamed). */
  n: number[];
  /** Edges that are bridges. */
  br: number[];
  /** Per edge with heights: its index, then its points' heights as decimetre deltas. */
  h: number[];
  brn?: Network['br']; en?: Network['en'];
}

const dm = (v: number) => Math.round(v * 10);

export function packNetwork(net: Network): NetworkPack {
  const classes: string[] = [], names: string[] = [], ci = new Map<string, number>(), ni = new Map<string, number>();
  const idx = (m: Map<string, number>, list: string[], s: string) => { let i = m.get(s); if (i === undefined) { i = list.length; list.push(s); m.set(s, i); } return i; };
  const nodes: number[] = [];
  let px = 0, pz = 0;
  for (let i = 0; i < net.nodes.length; i += 2) { const x = dm(net.nodes[i]), z = dm(net.nodes[i + 1]); nodes.push(x - px, z - pz); px = x; pz = z; }
  const out: NetworkPack = { v: 1, nodes, sig: net.sig, classes, names, a: [], b: [], pn: [], p: [], c: [], o: [], l: [], w: [], n: [], br: [], h: [], brn: net.br, en: net.en };
  net.edges.forEach((e, k) => {
    out.a.push(e.a); out.b.push(e.b);
    let qx = dm(net.nodes[2 * e.a]), qz = dm(net.nodes[2 * e.a + 1]);
    out.pn.push(e.p.length / 2);
    for (let i = 0; i < e.p.length; i += 2) { const x = dm(e.p[i]), z = dm(e.p[i + 1]); out.p.push(x - qx, z - qz); qx = x; qz = z; }
    out.c.push(idx(ci, classes, e.c)); out.o.push(e.o); out.l.push(e.l); out.w.push(dm(e.w));
    out.n.push(e.n ? idx(ni, names, e.n) + 1 : 0);
    if (e.br) out.br.push(k);
    if (e.h) { out.h.push(k); let ph = 0; for (const v of e.h) { const d = dm(v); out.h.push(d - ph); ph = d; } }
  });
  return out;
}

export function unpackNetwork(pk: NetworkPack): Network {
  const nodes = new Array<number>(pk.nodes.length);
  let px = 0, pz = 0;
  for (let i = 0; i < pk.nodes.length; i += 2) { px += pk.nodes[i]; pz += pk.nodes[i + 1]; nodes[i] = px / 10; nodes[i + 1] = pz / 10; }
  const br = new Set(pk.br);
  const heights = new Map<number, number[]>();
  for (let i = 0; i < pk.h.length;) {
    const k = pk.h[i++], n = pk.pn[k], hs: number[] = [];
    let ph = 0;
    for (let j = 0; j < n; j++) { ph += pk.h[i++]; hs.push(ph / 10); }
    heights.set(k, hs);
  }
  const edges: NetworkEdge[] = [];
  let pi = 0;
  for (let k = 0; k < pk.a.length; k++) {
    const n = pk.pn[k], p = new Array<number>(n * 2);
    let qx = Math.round(nodes[2 * pk.a[k]] * 10), qz = Math.round(nodes[2 * pk.a[k] + 1] * 10);
    for (let j = 0; j < n; j++) { qx += pk.p[pi++]; qz += pk.p[pi++]; p[2 * j] = qx / 10; p[2 * j + 1] = qz / 10; }
    const e: NetworkEdge = { a: pk.a[k], b: pk.b[k], p, c: pk.classes[pk.c[k]], o: pk.o[k] as 0 | 1, l: pk.l[k], w: pk.w[k] / 10 };
    if (pk.n[k]) e.n = pk.names[pk.n[k] - 1];
    if (br.has(k)) e.br = 1;
    const h = heights.get(k);
    if (h) e.h = h;
    edges.push(e);
  }
  const net: Network = { nodes, sig: pk.sig, edges };
  if (pk.brn) net.br = pk.brn;
  if (pk.en) net.en = pk.en;
  return net;
}
