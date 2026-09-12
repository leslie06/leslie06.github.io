import type { ColliderSpec } from '../game/Contracts';
import { Parts, box, circlePoly, cyl, flat, prism, rectPoly, tube, type V3 } from '../city/landmarks/kit/geo';
import { MOUNTAIN, RIDES } from './Layout';
import { ATTRACTIONS, PATHS, WATER } from './Osm';

/**
 * What fills the park between the three rides you can board.
 *
 * OSM names 34 attractions inside 北京欢乐谷 and gives each a point, but no shape - so each one gets
 * a building massing chosen from its name: 剧院 and 馆 are halls, 木马 is a carousel, 漂流 and
 * 牛奶河 are flumes, 风情街 is a row of shop fronts, 天地双雄 is a drop tower, the coasters get a
 * lattice tower and a loop of track. They are stand-ins, not models of the real rides, but they put
 * the park's own landmarks where the park's own landmarks are, and the place stops reading as a
 * lawn with three rides on it.
 *
 * Trees follow the real footpaths (Osm.PATHS), which is how an avenue ends up where the park has
 * one, and stay out of the lakes and off the boarding areas.
 */

const hash = (n: number): number => {
  const s = Math.sin(n * 127.1 + 311.7) * 43758.5453;
  return s - Math.floor(s);
};

type Kind = 'hall' | 'carousel' | 'flume' | 'street' | 'tower' | 'coaster' | 'spinner' | 'plaza' | 'kiosk';

/** What to build at an attraction, from its name. */
function kindOf(name: string): Kind | null {
  if (/水晶神翼|能量风暴|水晶圣城/.test(name)) return null;          // built for real elsewhere
  if (/剧院|剧场|馆|城堡|魔窟/.test(name)) return 'hall';
  if (/木马|旋转/.test(name)) return 'carousel';
  if (/漂流|牛奶河|海洋|勇进|天灾/.test(name)) return 'flume';
  if (/街/.test(name)) return 'street';
  if (/双雄|飞船|天使之翼|草帽/.test(name)) return 'tower';
  if (/过山车|飞车|战车|神车/.test(name)) return 'coaster';
  if (/广场|入口|出口|喷泉/.test(name)) return 'plaza';
  if (/观光车|驿站|射箭|蹦床|欢乐世界|奇幻东方/.test(name)) return 'spinner';
  return 'kiosk';
}

const inPoly = (poly: [number, number][], x: number, z: number): boolean => {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, zi] = poly[i], [xj, zj] = poly[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) hit = !hit;
  }
  return hit;
};
const inWater = (x: number, z: number): boolean => WATER.some((w) => inPoly(w, x, z));

/** A hall: plastered walls, a colonnade along the front and a pitched roof. */
function hall(P: Parts, x: number, z: number, yaw: number, w: number, d: number, h: number): void {
  P.at(x, 0, z, yaw, () => {
    prism(P.get('plaster'), rectPoly(w / 2, d / 2), 0, h);
    box(P.get('canopy'), 0, h + 0.9, 0, w + 2.2, 1.8, d + 2.2);
    for (let i = -2; i <= 2; i++) cyl(P.get('platform'), i * (w / 5), 0, d / 2 + 1.1, 0.42, 0.38, h * 0.8, 8);
    box(P.get('canopy'), 0, h * 0.8 + 0.35, d / 2 + 1.1, w + 1.4, 0.7, 2.6);
  });
}

/** A carousel: a ring of poles under a conical canopy on a low deck. */
function carousel(P: Parts, x: number, z: number, r: number): void {
  flat(P.get('platform'), circlePoly(r + 1.2, 20, x, z), 0.35);
  cyl(P.get('carTrim'), x, 0.35, z, 0.7, 0.7, 5.4, 10);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    cyl(P.get('carTrim'), x + Math.cos(a) * r, 0.35, z + Math.sin(a) * r, 0.1, 0.1, 3.4, 6);
  }
  cyl(P.get('canopy'), x, 3.75, z, r + 1.4, 0.5, 2.6, 20, { bottom: true });
}

/** A flume: a raised channel on piers, curving away from the point. */
function flume(P: Parts, x: number, z: number, yaw: number, len: number): void {
  const pts: V3[] = [];
  for (let i = 0; i <= 8; i++) {
    const t = i / 8;
    const a = yaw + t * 1.9;
    pts.push([x + Math.cos(a) * len * t, 3.2 + Math.sin(t * Math.PI) * 4.5, z + Math.sin(a) * len * t]);
  }
  tube(P.get('platform'), pts, 1.5, 6);
  for (let i = 1; i < pts.length; i += 2) cyl(P.get('support'), pts[i][0], 0, pts[i][2], 0.3, 0.26, pts[i][1] - 1.2, 6);
}

/** A row of shop fronts along the street. */
function street(P: Parts, x: number, z: number, yaw: number, n: number): void {
  P.at(x, 0, z, yaw, () => {
    for (let i = 0; i < n; i++) {
      const w = 7 + hash(i * 7 + x) * 3, h = 5 + hash(i * 13 + z) * 2.5;
      const cx = (i - (n - 1) / 2) * 9;
      prism(P.get('plaster'), rectPoly(w / 2, 5), cx, h);
      box(P.get('canopy'), cx, h + 0.5, 0, w + 0.8, 1, 11);
      box(P.get('carTrim'), cx, 3.4, 5.4, w * 0.8, 0.9, 0.35);
    }
  });
}

/** A drop tower or a spinning arm on a mast. */
function tower(P: Parts, x: number, z: number, h: number): void {
  flat(P.get('platform'), circlePoly(7, 16, x, z), 0.3);
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * Math.PI * 2;
    tube(P.get('tower'), [[x + Math.cos(a) * 3, 0, z + Math.sin(a) * 3], [x + Math.cos(a) * 0.9, h, z + Math.sin(a) * 0.9]], 0.28, 6);
  }
  for (let k = 1; k < 5; k++) {
    const y = (k / 5) * h;
    tube(P.get('tower'), circlePoly(3 - (2.1 * y) / h, 3, x, z).concat([[x + 3 - (2.1 * y) / h, z]]).map(([px, pz]) => [px, y, pz] as V3), 0.1, 4);
  }
  // The gondola ring, parked at the bottom.
  cyl(P.get('carTrim'), x, 2.2, z, 4.2, 4.2, 1.1, 14);
  cyl(P.get('seat'), x, 1.4, z, 3.6, 3.6, 0.9, 14);
}

/** Somebody else's coaster: a lattice tower and a loop of track, enough to read from across the park. */
function coasterProp(P: Parts, x: number, z: number, yaw: number, r: number, h: number): void {
  const pts: V3[] = [];
  for (let i = 0; i <= 24; i++) {
    const t = (i / 24) * Math.PI * 2;
    pts.push([x + Math.cos(t + yaw) * r, 3 + (1 - Math.cos(t * 2)) * h * 0.5, z + Math.sin(t + yaw) * r * 0.7]);
  }
  tube(P.get('rail'), pts, 0.12, 5);
  for (let i = 0; i < pts.length; i += 4) cyl(P.get('support'), pts[i][0], 0, pts[i][2], 0.22, 0.18, pts[i][1] - 0.4, 6);
}

/** A spinner: a low deck, a mast and a ring of seats. */
function spinner(P: Parts, x: number, z: number): void {
  flat(P.get('platform'), circlePoly(8, 18, x, z), 0.3);
  cyl(P.get('tower'), x, 0.3, z, 0.8, 0.6, 9, 8);
  cyl(P.get('canopy'), x, 9, z, 7.5, 1.2, 1.6, 18, { bottom: true });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    box(P.get('seat'), x + Math.cos(a) * 6.4, 2.4, z + Math.sin(a) * 6.4, 0.8, 1.1, 0.8, { ry: -a });
  }
}

/** Paved plaza with a pair of flag masts. */
function plaza(P: Parts, x: number, z: number, r: number): void {
  flat(P.get('path'), circlePoly(r, 22, x, z), 0.08);
  for (const s of [-1, 1]) {
    cyl(P.get('platform'), x + s * r * 0.7, 0, z, 0.3, 0.22, 9, 8);
    box(P.get('carTrim'), x + s * r * 0.7, 9.4, z, 0.5, 0.8, 0.5);
  }
}

/** A kiosk: the smallest thing worth drawing. */
function kiosk(P: Parts, x: number, z: number, yaw: number): void {
  P.at(x, 0, z, yaw, () => {
    prism(P.get('plank'), rectPoly(2.6, 2.2), 0, 3);
    box(P.get('canopy'), 0, 3.4, 0, 6.4, 0.5, 5.8);
  });
}

/** One tree: a trunk and two crown cones. */
function tree(P: Parts, x: number, z: number, s: number): void {
  cyl(P.get('trunk'), x, 0, z, 0.22 * s, 0.16 * s, 2.6 * s, 5);
  cyl(P.get('leaf'), x, 2.1 * s, z, 2.4 * s, 1.5 * s, 3.2 * s, 7, { bottom: true });
  cyl(P.get('leaf'), x, 4.4 * s, z, 1.7 * s, 0.1 * s, 2.8 * s, 7);
}

/**
 * Everything above, placed. Returns the colliders for the solid pieces; the trees are scenery and
 * get none (the city's own trees do not have them either).
 */
export function buildProps(P: Parts): ColliderSpec[] {
  const out: ColliderSpec[] = [];
  const rides = RIDES.map((r) => [r.x, r.z] as const);
  const clearOfRides = (x: number, z: number, d: number) => rides.every(([rx, rz]) => Math.hypot(x - rx, z - rz) > d);

  for (let i = 0; i < ATTRACTIONS.length; i++) {
    const a = ATTRACTIONS[i];
    const kind = kindOf(a.name);
    if (!kind) continue;
    const { x, z } = a;
    if (Math.hypot(x - MOUNTAIN.x, z - MOUNTAIN.z) < MOUNTAIN.r * 0.8) continue;   // inside the rock
    const yaw = hash(i * 3.7) * Math.PI * 2;
    switch (kind) {
      case 'hall': {
        const w = 26 + hash(i) * 14, d = 18 + hash(i + 9) * 10, h = 9 + hash(i + 3) * 5;
        hall(P, x, z, yaw, w, d, h);
        out.push({ kind: 'box', center: [x, h / 2, z], half: [w / 2, h / 2, d / 2], yaw });
        break;
      }
      case 'carousel': carousel(P, x, z, 7.5); out.push({ kind: 'cylinder', center: [x, 2, z], radius: 9, halfHeight: 2 }); break;
      case 'flume': flume(P, x, z, yaw, 34); break;
      case 'street': street(P, x, z, yaw, 5); out.push({ kind: 'box', center: [x, 3, z], half: [23, 3, 6], yaw }); break;
      case 'tower': tower(P, x, z, 34 + hash(i + 5) * 18); out.push({ kind: 'cylinder', center: [x, 3, z], radius: 4.6, halfHeight: 3 }); break;
      case 'coaster': coasterProp(P, x, z, yaw, 26 + hash(i + 2) * 12, 14 + hash(i + 6) * 8); break;
      case 'spinner': spinner(P, x, z); out.push({ kind: 'cylinder', center: [x, 1.5, z], radius: 8, halfHeight: 1.5 }); break;
      case 'plaza': plaza(P, x, z, 16); break;
      case 'kiosk': kiosk(P, x, z, yaw); out.push({ kind: 'box', center: [x, 1.5, z], half: [3.2, 1.5, 2.9], yaw }); break;
    }
  }

  // Avenues: trees down both sides of the real footpaths.
  let n = 0;
  for (let li = 0; li < PATHS.length; li++) {
    const line = PATHS[li];
    for (let i = 0; i + 1 < line.pts.length; i++) {
      const [x0, z0] = line.pts[i], [x1, z1] = line.pts[i + 1];
      const dx = x1 - x0, dz = z1 - z0;
      const len = Math.hypot(dx, dz);
      for (let d = 6; d < len; d += 15) {
        const t = d / len;
        const px = x0 + dx * t, pz = z0 + dz * t;
        const nx = (-dz / len) * (line.w / 2 + 3.5), nz = (dx / len) * (line.w / 2 + 3.5);
        for (const s of [-1, 1]) {
          const tx = px + nx * s, tz = pz + nz * s;
          const r = hash(li * 31 + i * 7 + d + s);
          if (r > 0.55) continue;
          if (inWater(tx, tz)) continue;
          if (!clearOfRides(tx, tz, 18)) continue;
          if (Math.hypot(tx - MOUNTAIN.x, tz - MOUNTAIN.z) < MOUNTAIN.r) continue;
          tree(P, tx, tz, 0.8 + r * 0.9);
          n++;
        }
      }
    }
  }
  return out;
}
