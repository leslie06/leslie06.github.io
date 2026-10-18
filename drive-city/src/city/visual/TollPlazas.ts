import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import type { Engine, System } from '../../core/Engine';
import { CG, groups } from '../../core/Physics';
import type { EnvUniforms, WorldApi } from '../../game/Contracts';
import type { Manifest } from '../Data';
import type { RenderSystem } from '../../render/RenderSystem';
import type { TrafficApi } from '../../traffic';
import { CJK } from '../landmarks/kit/tex';

/**
 * The expressways' toll stations (2026-10-18, chapter 5 ends at 白鹿收费站): OSM gives a point (`manifest.named`, a
 * name ending 收费站) and the carriageways run on through it as if nothing were there. Here each gets a canopy over
 * every carriageway near the point, pillars and booths standing only outside the lanes (the verges and the median: the
 * traffic still drives straight through), a name board over each direction lit at night, and lights under the roof.
 * Pillars and booths are solid. Built once traffic's lane graph is in (it is what says where the lanes are).
 */
export interface TollPlaza {
  name: string;
  /** The middle of the canopy, the road's axis there (unit, the way the first carriageway found runs) and its height. */
  x: number; z: number; ux: number; uz: number; y: number;
  /** Each carriageway under it: offset of its centre across the axis (along (-uz, ux)) and half width. */
  ways: { o: number; hw: number }[];
}

const DEPTH = 8;       // half the canopy's length along the road
const ROOF = 6.4;      // underside of the roof
const NEAR = 90;       // carriageways within this of the point are covered

export function findPlazas(engine: Engine): TollPlaza[] {
  const world = engine.get<WorldApi & { manifest?: Manifest }>('world'), g = engine.get<TrafficApi>('traffic')?.graph;
  const named = world?.manifest?.named as Record<string, [number, number]> | undefined;
  if (!g || !named) return [];
  const out: TollPlaza[] = [], at = { x: 0, z: 0, dx: 0, dz: 0 };
  for (const [name, [px, pz]] of Object.entries(named)) {
    if (!/收费站$/.test(name)) continue;
    // the main roads here, nearest first
    const near = g.near(px, pz, NEAR).map((id) => g.links[id]).filter((l) => (l.cls === 'motorway' || l.cls === 'trunk') && l.hmax < 0.5)
      .map((l) => ({ l, pr: g.project(l, px, pz, 0) })).filter((c) => c.pr.d < NEAR).sort((a, b) => a.pr.d - b.pr.d);
    if (!near.length) continue;
    g.at(near[0].l, near[0].pr.s, 0, at);
    const ux = at.dx, uz = at.dz, nx = -uz, nz = ux;
    const ways: { o: number; hw: number }[] = [];
    for (const { l, pr } of near) {
      g.at(l, pr.s, 0, at);
      if (Math.abs(at.dx * ux + at.dz * uz) < 0.9) continue;
      const o = (at.x - px) * nx + (at.z - pz) * nz;
      if (ways.some((w) => Math.abs(w.o - o) < 2)) continue;
      ways.push({ o, hw: l.hw });
    }
    ways.sort((a, b) => a.o - b.o);
    out.push({ name, x: px, z: pz, ux, uz, y: g.heightAt(near[0].l, near[0].pr.s), ways });
  }
  return out;
}

/** The name board's face: white on blue, the name and its English. */
function boardTexture(name: string): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#1d4fa0'; g.fillRect(0, 0, 1024, 128);
  g.fillStyle = '#f4f6f8'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.font = `700 64px ${CJK}`;
  g.fillText(name, 512, 52);
  g.font = '600 26px system-ui, Arial, sans-serif';
  g.fillText(name.replace(/^北京/, '').replace(/收费站$/, '') === '白鹿' ? 'BAILU TOLL STATION' : 'TOLL STATION', 512, 104);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const colored = (g: THREE.BufferGeometry, hex: string) => {
  const geo = g.index ? g.toNonIndexed() : g, n = geo.getAttribute('position').count, c = new THREE.Color(hex), col = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) col.set([c.r, c.g, c.b], i * 3);
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.deleteAttribute('uv');
  return geo;
};

export function install(engine: Engine): void {
  if (new URLSearchParams(location.search).get('toll') === '0') return;
  const plazas = findPlazas(engine);
  if (!plazas.length) return;
  const env = engine.get<RenderSystem & { uniforms?: EnvUniforms }>('render')?.uniforms;
  const { R, world } = engine.physics;
  const body = world.createRigidBody(R.RigidBodyDesc.fixed());
  const solid = groups(CG.WORLD, CG.ALL);
  const root = new THREE.Group();
  root.name = 'toll-plazas';
  const paint = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.15 });
  paint.userData.wet = 'surface';
  const glow = new THREE.MeshStandardMaterial({ color: '#2a2c2e', emissive: new THREE.Color('#fff4dc'), emissiveIntensity: 0.1, roughness: 0.4 });
  const boards: THREE.MeshStandardMaterial[] = [];

  const build = (p: TollPlaza) => {
    const nx = -p.uz, nz = p.ux, yaw = Math.atan2(p.ux, p.uz);
    const lo = Math.min(...p.ways.map((w) => w.o - w.hw)) - 3, hi = Math.max(...p.ways.map((w) => w.o + w.hw)) + 3;
    const inLane = (o: number) => p.ways.some((w) => o > w.o - w.hw - 0.4 && o < w.o + w.hw + 0.4);
    // pillars: a metre and a half off each carriageway's edges, and every 8 m across a wide median
    const cols = new Set<number>();
    for (const w of p.ways) for (const o of [w.o - w.hw - 1.5, w.o + w.hw + 1.5]) if (!inLane(o)) cols.add(Math.round(o * 10) / 10);
    for (let i = 0; i + 1 < p.ways.length; i++) {
      const a = p.ways[i].o + p.ways[i].hw + 1.5, b = p.ways[i + 1].o - p.ways[i + 1].hw - 1.5;
      for (let o = a + 8; o < b - 4; o += 8) cols.add(o);
    }
    const parts: THREE.BufferGeometry[] = [], lights: THREE.BufferGeometry[] = [];
    // in the plaza's frame: x across (n), z along (u); placed by the group's transform below
    const span = hi - lo, mid = (lo + hi) / 2;
    parts.push(colored(new THREE.BoxGeometry(span, 0.7, DEPTH * 2).translate(mid, ROOF + 0.35, 0), '#e9ecef'));
    for (const end of [-1, 1]) parts.push(colored(new THREE.BoxGeometry(span, 1.0, 0.25).translate(mid, ROOF + 0.4, end * DEPTH), '#1d4fa0'));
    for (const o of cols) {
      parts.push(colored(new THREE.BoxGeometry(0.7, ROOF, 0.7).translate(o, ROOF / 2, 0), '#c9cdd1'));
      // the booth on the island, its kerb round it
      parts.push(colored(new THREE.BoxGeometry(1.5, 2.5, 2.8).translate(o, 1.25 + 0.2, 3.2), '#f2f3f4'));
      parts.push(colored(new THREE.BoxGeometry(1.52, 0.6, 2.82).translate(o, 1.9, 3.2), '#2b3a4a'));   // its windows
      parts.push(colored(new THREE.BoxGeometry(2.0, 0.2, 9).translate(o, 0.1, 1.5), '#e4c434'));       // the island, yellow kerb
      const cx = p.x + nx * o, cz = p.z + nz * o;
      const pillar = R.ColliderDesc.cuboid(0.35, ROOF / 2, 0.35).setTranslation(cx, p.y + ROOF / 2, cz).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
      engine.physics.tag(world.createCollider(pillar.setCollisionGroups(solid), body), { surface: 'concrete', tag: 'toll' });
      const bx = cx + p.ux * 3.2, bz = cz + p.uz * 3.2;
      const booth = R.ColliderDesc.cuboid(0.75, 1.35, 1.4).setTranslation(bx, p.y + 1.35, bz).setRotation({ x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) });
      engine.physics.tag(world.createCollider(booth.setCollisionGroups(solid), body), { surface: 'concrete', tag: 'toll' });
    }
    // strip lights under the roof over each lane
    for (const w of p.ways) for (let k = -1; k <= 1; k++) lights.push(new THREE.BoxGeometry(0.4, 0.06, DEPTH * 1.6).translate(w.o + k * w.hw * 0.6, ROOF - 0.03, 0));
    const grp = new THREE.Group();
    grp.position.set(p.x, p.y, p.z);
    // local x (across) maps to n, local z (along) to u
    grp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(new THREE.Vector3(nx, 0, nz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(p.ux, 0, p.uz)));
    const mesh = new THREE.Mesh(mergeGeometries(parts)!, paint);
    mesh.castShadow = true; mesh.receiveShadow = true;
    grp.add(mesh);
    grp.add(new THREE.Mesh(mergeGeometries(lights)!, glow));
    // a board over each carriageway, facing the traffic coming at it
    for (const w of p.ways) {
      const tex = boardTexture(p.name);
      const m = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: new THREE.Color('#ffffff'), emissiveIntensity: 0.15, roughness: 0.5 });
      boards.push(m);
      const bw = Math.min(w.hw * 2, 12), board = new THREE.Mesh(new THREE.PlaneGeometry(bw, bw / 8), m);
      // both ends: each faces the traffic coming at it from that side
      board.position.set(w.o, ROOF + 1.6, -DEPTH - 0.14);
      board.rotation.y = Math.PI;
      grp.add(board);
      const back = board.clone(); back.position.z = DEPTH + 0.14; back.rotation.y = 0;
      grp.add(back);
    }
    root.add(grp);
    engine.get<RenderSystem>('render')?.prepare?.(grp);
  };
  engine.scene.add(root);

  /**
   * Where along the road the canopy goes: OSM puts the station's point on its office block, which stood in the
   * median right through the roof, and long buildings line some plazas. Up to 60 m either way, the place whose roof and
   * pillars meet fewest solid things (buildings, trees, posts: only what is loaded, so this waits for the tiles).
   */
  const settle = (p: TollPlaza): void => {
    const lo = Math.min(...p.ways.map((w) => w.o - w.hw)) - 3, hi = Math.max(...p.ways.map((w) => w.o + w.hw)) + 3;
    const nx = -p.uz, nz = p.ux, yaw = Math.atan2(p.ux, p.uz), q = { x: 0, y: Math.sin(yaw / 2), z: 0, w: Math.cos(yaw / 2) };
    const box = new R.Cuboid((hi - lo) / 2, 3.2, DEPTH + 1);
    const mid = (lo + hi) / 2;
    let best = 0, bestHits = Infinity;
    for (let k = 0; k <= 30; k++) {
      const shift = (k % 2 ? 1 : -1) * Math.ceil(k / 2) * 4;
      const cx = p.x + p.ux * shift + nx * mid, cz = p.z + p.uz * shift + nz * mid;
      let hits = 0;
      world.intersectionsWithShape({ x: cx, y: p.y + 4.2, z: cz }, q, box, (col) => { if (col.parent() !== body && !col.isSensor()) hits++; return true; }, undefined, groups(CG.WORLD, CG.WORLD));
      if (hits < bestHits) { bestHits = hits; best = shift; if (!hits) break; }
    }
    p.x += p.ux * best; p.z += p.uz * best;
  };
  const waiting = plazas.map(() => -1);
  const sys: System & { plazas: TollPlaza[] } = {
    name: 'tollPlazas',
    plazas,
    update(dt) {
      // each one once the camera is near enough for its tiles (and their colliders) to be in: a few seconds in range
      const cam = engine.camera.position;
      plazas.forEach((p, i) => {
        if (waiting[i] === -2) return;
        if (Math.hypot(cam.x - p.x, cam.z - p.z) > 450) { waiting[i] = -1; return; }
        waiting[i] = Math.max(0, waiting[i]) + dt;
        if (waiting[i] < 3) return;
        waiting[i] = -2;
        settle(p); build(p);
      });
      const n = env?.uNight.value ?? 0;
      glow.emissiveIntensity = 0.1 + 3.2 * n;
      for (const b of boards) b.emissiveIntensity = 0.15 + 0.6 * n;
    },
  };
  engine.add(sys);
}
