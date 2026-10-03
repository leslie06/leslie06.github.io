// network.json -> network.pack.json for the game (src/city/NetPack.ts). Run by build.mjs at its end; by hand:
// npx tsx scripts/city/netpack.mts   (checks the round trip on every edge)
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import type { Network } from '../../src/city/Data';
import { packNetwork, unpackNetwork } from '../../src/city/NetPack';

const DIR = path.resolve('public/city');
const net = JSON.parse(fs.readFileSync(path.join(DIR, 'network.json'), 'utf8')) as Network;
const pk = packNetwork(net), s = JSON.stringify(pk);
const back = unpackNetwork(JSON.parse(s));
// the round trip, exact to the decimetre on every number
const eq = (a: number, b: number) => Math.abs(a - b) < 0.051;
let bad = 0;
if (back.edges.length !== net.edges.length || back.nodes.length !== net.nodes.length) bad++;
net.nodes.forEach((v, i) => { if (!eq(v, back.nodes[i])) bad++; });
net.edges.forEach((e, k) => {
  const f = back.edges[k];
  if (e.a !== f.a || e.b !== f.b || e.c !== f.c || e.o !== f.o || e.l !== f.l || !eq(e.w, f.w) || (e.n ?? '') !== (f.n ?? '') || (e.br ?? 0) !== (f.br ?? 0) || e.p.length !== f.p.length || !!e.h !== !!f.h) bad++;
  e.p.forEach((v, i) => { if (!eq(v, f.p[i])) bad++; });
  e.h?.forEach((v, i) => { if (!eq(v, f.h![i])) bad++; });
});
if (bad) throw new Error(`network pack: ${bad} values differ after the round trip`);
fs.writeFileSync(path.join(DIR, 'network.pack.json'), s);
const gz = (b: string | Buffer) => zlib.gzipSync(b).length;
const raw = fs.readFileSync(path.join(DIR, 'network.json'));
console.log(`network pack: ${(raw.length / 1e6).toFixed(1)} MB / ${(gz(raw) / 1e6).toFixed(2)} MB gzipped -> ${(s.length / 1e6).toFixed(1)} MB / ${(gz(s) / 1e6).toFixed(2)} MB, round trip exact`);
