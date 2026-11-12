import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import clipping from 'polygon-clipping';
import { FAMOUS, alongLine, lineLength, pointOn, streetWall } from './Famous';
import type { BuildingRec, TileData } from './Data';
import infill from './famous.gen.json';

const buildings = infill.b as BuildingRec[];
const polygon = (o: number[]): clipping.Polygon => [Array.from({ length: o.length / 2 }, (_, i) => [o[i * 2], o[i * 2 + 1]] as [number, number])];
const bounds = (o: number[]) => {
  const x = o.filter((_, i) => i % 2 === 0), z = o.filter((_, i) => i % 2 === 1);
  return [Math.min(...x), Math.max(...x), Math.min(...z), Math.max(...z)];
};
const area = (ring: clipping.Ring) => Math.abs(ring.reduce((sum, a, i) => { const b = ring[(i + 1) % ring.length]; return sum + a[0] * b[1] - b[0] * a[1]; }, 0)) / 2;

describe('名片街补建铺面', () => {
  it('三条街都有铺面，且没有侵入街心通道', () => {
    for (const street of FAMOUS) {
      const nearby = buildings.filter((b) => alongLine(street.pts, b.o[0], b.o[1]).d < street.r);
      expect(nearby.length, street.id).toBeGreaterThan(10);
      for (const b of nearby) for (let i = 0; i < b.o.length; i += 2) {
        expect(alongLine(street.pts, b.o[i], b.o[i + 1]).d, `${street.id}/${b.i}`).toBeGreaterThan(street.infill.front - 0.1);
      }
      const p = { x: 0, z: 0, dx: 0, dz: 0 };
      for (let s = 0; s < lineLength(street.pts); s += 2) {
        pointOn(street.pts, s, 0, p);
        expect(nearby.some((b) => clipping.intersection(polygon(b.o), [[[p.x - 0.3, p.z - 0.3], [p.x + 0.3, p.z - 0.3], [p.x + 0.3, p.z + 0.3], [p.x - 0.3, p.z + 0.3]]]).length > 0)).toBe(false);
      }
    }
  });

  it('补建铺面之间、与保留的原有建筑不重叠', () => {
    const originals = new Map<number, BuildingRec>();
    const keys = new Set<string>();
    for (const b of buildings) {
      const [x0, x1, z0, z1] = bounds(b.o);
      for (let ix = Math.floor(x0 / 256) - 1; ix <= Math.floor(x1 / 256) + 1; ix++) for (let iz = Math.floor(z0 / 256) - 1; iz <= Math.floor(z1 / 256) + 1; iz++) keys.add(`${ix}_${iz}`);
    }
    for (const key of keys) {
      const file = new URL(`../../public/city/t_${key}.json`, import.meta.url);
      if (!fs.existsSync(file)) continue;
      for (const b of (JSON.parse(fs.readFileSync(file, 'utf8')) as TileData).buildings) if (!(b.k === 'wall' && streetWall(b.o))) originals.set(b.i, b);
    }
    const all = [...buildings, ...originals.values()].map((b) => ({ b, box: bounds(b.o), poly: polygon(b.o) }));
    const bad: string[] = [];
    for (let i = 0; i < buildings.length; i++) {
      const a = all[i];
      for (let j = i + 1; j < all.length; j++) {
        const b = all[j];
        if (a.box[1] <= b.box[0] || b.box[1] <= a.box[0] || a.box[3] <= b.box[2] || b.box[3] <= a.box[2]) continue;
        const overlap = clipping.intersection(a.poly, b.poly).reduce((sum, p) => sum + area(p[0]) - p.slice(1).reduce((s, h) => s + area(h), 0), 0);
        if (overlap > 0.02) bad.push(`${a.b.i}/${b.b.i}: ${overlap.toFixed(2)} m²`);
      }
    }
    expect(bad).toEqual([]);
  });
});
