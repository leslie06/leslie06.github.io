/**
 * Guide signs on the real city (`placeSigns`): the expressways signed at their interchanges, every
 * pole off the carriageways, and the roads running off the data closed. `PROFILE=1` writes the list
 * to .scratch/signs.txt.
 */
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { Manifest, Network } from './Data';
import { LaneGraph } from '../traffic/LaneGraph';
import { placeSigns } from './Signs';

const read = <T>(f: string) => JSON.parse(fs.readFileSync(fileURLToPath(new URL(`../../public/city/${f}`, import.meta.url)), 'utf8')) as T;
const net = read<Network>('network.json'), man = read<Manifest>('manifest.json');
const g = new LaneGraph(net);
const t0 = performance.now();
const { signs, closures } = placeSigns(g, net, man.regions);
const ms = performance.now() - t0;

if (process.env.PROFILE) {
  const rows = signs.map((s) => `${s.kind} ${s.colour} ${s.x.toFixed(0)},${s.y.toFixed(1)},${s.z.toFixed(0)} yaw ${s.yaw.toFixed(2)} reach ${s.reach.toFixed(1)} ${s.heading ?? ''} | ${s.lines.map((q) => `${q.dir ?? ''}${q.name}${q.km !== undefined ? ' ' + q.km + 'km' : ''}`).join(' / ')} | ${g.links[s.link].name}`);
  fs.writeFileSync(fileURLToPath(new URL('../../.scratch/signs.txt', import.meta.url)), `${signs.length} signs (${['cross', 'exit', 'ahead'].map((k) => `${k} ${signs.filter((s) => s.kind === k).length}`).join(', ')}), ${closures.length} closures, ${ms.toFixed(0)} ms\n` + rows.join('\n') + '\n' + closures.map((c) => `closed ${c.x.toFixed(0)},${c.z.toFixed(0)} w ${c.width.toFixed(1)}`).join('\n'));
}

describe('guide signs', () => {
  it('are placed quickly and in number', () => {
    expect(ms).toBeLessThan(3000);
    expect(signs.filter((s) => s.kind === 'cross').length).toBeGreaterThan(200);
    expect(signs.filter((s) => s.kind === 'exit').length).toBeGreaterThan(40);
    expect(signs.filter((s) => s.kind === 'ahead').length).toBeGreaterThan(20);
  });
  it('sign 东四环 northbound to 双新桥 and 东风北桥', () => {
    const north = signs.filter((s) => s.kind === 'ahead' && s.lines[0].name === '东四环' && s.heading === '北');
    expect(north.some((s) => s.lines.some((q) => q.name === '双新桥') && s.lines.some((q) => q.name === '东风北桥'))).toBe(true);
  });
  it('sign 京通快速路 eastbound past 高碑店桥', () => {
    expect(signs.some((s) => s.kind === 'ahead' && s.lines[0].name === '京通快速路' && s.heading === '东' && s.lines.some((q) => q.name === '高碑店桥'))).toBe(true);
  });
  it('stand every pole off every carriageway at its level', () => {
    for (const s of signs) for (const id of g.near(s.x, s.z, 30)) {
      const o = g.links[id];
      for (let k = 1; k < o.cum.length; k++) {
        const ax = o.pts[k * 2 - 2], az = o.pts[k * 2 - 1], vx = o.pts[k * 2] - ax, vz = o.pts[k * 2 + 1] - az, L2 = vx * vx + vz * vz || 1;
        const t = Math.max(0, Math.min(1, ((s.x - ax) * vx + (s.z - az) * vz) / L2)), d = Math.hypot(s.x - ax - vx * t, s.z - az - vz * t);
        const h = g.heightAt(o, o.cum[k - 1] + t * Math.sqrt(L2));
        if (Math.abs(h - s.y) < 3) expect(d, `${s.kind} pole at ${s.x.toFixed(0)},${s.z.toFixed(0)} in ${o.name || o.cls}`).toBeGreaterThan(o.hw + (s.y > 0.4 ? 0.1 : 0.3));
      }
    }
  });
  it('have no deck over the pole or the plate (every segment scanned, not just nearby points)', () => {
    const bad: string[] = [];
    for (const s of signs) {
      const c = Math.cos(s.yaw), sn = Math.sin(s.yaw);
      const spots = [0, s.reach - s.w / 2, s.reach, s.reach + s.w / 2].map((r) => [s.x - r * c, s.z + r * sn]);
      for (const o of g.links) {
        if (!o.h || o.hmax < s.y + 1.5) continue;
        for (let k = 1; k < o.cum.length; k++) {
          const ax = o.pts[k * 2 - 2], az = o.pts[k * 2 - 1], vx = o.pts[k * 2] - ax, vz = o.pts[k * 2 + 1] - az, L2 = vx * vx + vz * vz || 1;
          for (const [x, z] of spots) {
            const t = Math.max(0, Math.min(1, ((x - ax) * vx + (z - az) * vz) / L2)), d = Math.hypot(x - ax - vx * t, z - az - vz * t);
            if (d > o.hw + 1.2) continue;
            const h = g.heightAt(o, o.cum[k - 1] + t * Math.sqrt(L2));
            if (h > s.y + 1.5 && h < s.y + s.clear + s.h + 1) bad.push(`${s.kind} ${s.lines.map((q) => q.name).join('/')} at ${s.x.toFixed(0)},${s.z.toFixed(0)} under ${o.name || o.cls} at ${h.toFixed(1)} m`);
          }
        }
      }
    }
    expect(bad).toEqual([]);
  });
  it('close the roads that run off the data', () => {
    expect(closures.length).toBeGreaterThan(20);
    // 东四环 north of 东风北桥 leaves the data at z -6028.
    expect(closures.some((c) => c.z < -5900 && c.x > 6400 && c.x < 6800)).toBe(true);
  });
});
