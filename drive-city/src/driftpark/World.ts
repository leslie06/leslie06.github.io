import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { Rng } from '../core/Rng';
import type { WorldApi } from '../game/Contracts';
import type { RenderApi } from '../render';
import { figureEight } from '../vehicle/Autopilot';
import { TAXI } from '../vehicle/Spec';
import { withMacro } from '../world';
import { PaintBuilder, paintMaterial } from '../world/Paint';
import { Props, jerseyGeometry, lampPostGeometry, poplarGeometry } from '../world/Props';
import { buildSkyline } from '../world/Skyline';
import { staticBody, staticBox } from '../world/Structures';
import * as T from '../world/Textures';
import { COURSE, courseLine, DONUT, EIGHT, GRID, PARK, TEST_LANE } from './Layout';

/**
 * The drift park's ground, paint, walls and buildings (driftpark/Layout.ts says where). Registers the `world` system the
 * way world/ does for the driving-school yard: a spawn, loose props, and a car drifting the 8字 behind the title.
 */

/** A facade tile, one floor (3.5 m) of four windows (8 m): repeated over each block by its size. */
function facade(rng: Rng): THREE.CanvasTexture {
  const c = document.createElement('canvas'); c.width = 256; c.height = 112;
  const g = c.getContext('2d')!;
  g.fillStyle = '#d9d6cf'; g.fillRect(0, 0, 256, 112);
  for (let k = 0; k < 4; k++) {
    const x = 10 + k * 64, lit = rng.next();
    const grad = g.createLinearGradient(0, 18, 0, 92);
    grad.addColorStop(0, lit < 0.2 ? '#8fa6b8' : '#6d8aa3'); grad.addColorStop(1, '#2c4257');
    g.fillStyle = '#9ea3a6'; g.fillRect(x - 3, 15, 50, 80);
    g.fillStyle = grad; g.fillRect(x, 18, 44, 74);
    g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(x, 18, 44, 9);
    g.fillStyle = '#9ea3a6'; g.fillRect(x + 21, 18, 2, 74);
  }
  g.fillStyle = '#b8b5ae'; g.fillRect(0, 104, 256, 8);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}

export async function install(engine: Engine): Promise<void> {
  const { scene, physics, quality: q } = engine;
  const R = physics.R;
  const rng = new Rng(28);
  const render = engine.get<RenderApi>('render');
  const haze = render?.hazeColor ?? new THREE.Color('#c4c8c6');
  const H = PARK.half;
  const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), UP = new THREE.Vector3(0, 1, 0);

  // Ground: one collider; the paved lot, grass beyond the hoarding.
  const ground = physics.world.createCollider(R.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0).setFriction(0.95)
    .setCollisionGroups(groups(CG.WORLD, CG.ALL)), staticBody(physics));
  physics.tag(ground, { surface: 'asphalt' });
  const size = H * 2 + 20;
  const asphalt = T.asphalt(q.tier === 'low' ? 512 : 1024);
  asphalt.map.wrapS = asphalt.map.wrapT = asphalt.rough.wrapS = asphalt.rough.wrapT = THREE.RepeatWrapping;
  asphalt.map.repeat.set(size / 9, size / 9); asphalt.rough.repeat.set(size / 9, size / 9);
  const lotMat = new THREE.MeshStandardMaterial({ map: asphalt.map, roughnessMap: asphalt.rough, roughness: 1, color: '#d9d9d6' });
  lotMat.userData.wet = 'ground';
  withMacro(lotMat, T.asphaltMacro(), size);
  const lot = new THREE.Mesh(new THREE.PlaneGeometry(size, size), lotMat);
  lot.rotation.x = -Math.PI / 2; lot.receiveShadow = true;
  scene.add(lot);
  const grassTex = T.grass(); grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping; grassTex.repeat.set(300, 300);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.6; grass.receiveShadow = true;
  scene.add(grass);

  const white = new PaintBuilder(), yellow = new PaintBuilder(), red = new PaintBuilder(), pave = new PaintBuilder();
  const concreteTex = T.concrete(); concreteTex.wrapS = concreteTex.wrapT = THREE.RepeatWrapping; concreteTex.repeat.set(0.4, 0.4);

  // ---- the grid: roads, sidewalks, blocks --------------------------------------------------------------------------
  const hw = GRID.width / 2, xs = GRID.xs, zs = GRID.zs;
  const roadPaint = (ax: number, az: number, bx: number, bz: number) => {
    const L = Math.hypot(bx - ax, bz - az); if (L < 1) return;
    const dx = (bx - ax) / L, dz = (bz - az) / L, nx = dz, nz = -dx;
    const off = (o: number) => [ax + nx * o, az + nz * o, bx + nx * o, bz + nz * o] as const;
    for (const s of [-1, 1]) {
      white.line(...off(s * (hw - 0.4)), 0.15);
      white.dashed(...off(s * GRID.lane), 0.12, 4, 6);
      yellow.line(...off(s * 0.18), 0.12);
    }
  };
  // stop line and zebra on the approach to a junction box at (jx, jz), coming along (dx, dz)
  const approach = (jx: number, jz: number, dx: number, dz: number) => {
    const nx = dz, nz = -dx; // right of the travel
    const at = (along: number, side: number) => [jx - dx * (hw + along) + nx * side, jz - dz * (hw + along) + nz * side] as const;
    const [s0x, s0z] = at(5.5, 0), [s1x, s1z] = at(5.5, hw - 0.4);
    white.line(s0x, s0z, s1x, s1z, 0.45);
    for (let o = -hw + 1; o < hw - 0.5; o += 1.2) {
      const [ax, az] = at(4.5, o), [bx, bz] = at(0.6, o);
      white.line(ax, az, bx, bz, 0.55);
    }
  };
  const xLo = xs[0], xHi = xs[xs.length - 1], zLo = zs[0], zHi = zs[zs.length - 1];
  for (const gx of xs) {
    const start = gx === TEST_LANE.x ? TEST_LANE.z0 : GRID.leadZ;
    roadPaint(gx, start, gx, zLo - hw);
    approach(gx, zLo, 0, 1);
    for (let i = 0; i + 1 < zs.length; i++) { roadPaint(gx, zs[i] + hw, gx, zs[i + 1] - hw); approach(gx, zs[i + 1], 0, 1); approach(gx, zs[i], 0, -1); }
  }
  for (const gz of zs) for (let i = 0; i + 1 < xs.length; i++) {
    roadPaint(xs[i] + hw, gz, xs[i + 1] - hw, gz);
    approach(xs[i + 1], gz, 1, 0); approach(xs[i], gz, -1, 0);
  }
  // the test lane: distance marks across the right-hand half before the stop line, numbered
  for (const d of TEST_LANE.marks) {
    const z = TEST_LANE.zStop - d;
    yellow.line(TEST_LANE.x - 0.4, z, TEST_LANE.x - hw + 0.4, z, d % 20 === 0 ? 0.5 : 0.25);
  }

  // blocks: a sidewalk round each, a building on it (two, with an alley, now and then)
  const facades = [0, 1, 2].map(() => facade(rng));
  const roofMat = new THREE.MeshStandardMaterial({ color: '#8d8b86', roughness: 0.95 });
  const sideMat = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9, color: '#cfccc4', polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
  sideMat.userData.wet = 'ground';
  const tints = ['#ffffff', '#f0e6d6', '#dde4e8', '#efe0d8', '#e6e6e0'];
  const building = (x0: number, z0: number, x1: number, z1: number, h: number) => {
    const w = x1 - x0, d = z1 - z0;
    const tex = facades[rng.int(0, facades.length - 1)];
    const color = new THREE.Color(tints[rng.int(0, tints.length - 1)]);
    const sideX = tex.clone(); sideX.repeat.set(d / 8, h / 3.5); sideX.needsUpdate = true;
    const sideZ = tex.clone(); sideZ.repeat.set(w / 8, h / 3.5); sideZ.needsUpdate = true;
    const mx = new THREE.MeshStandardMaterial({ map: sideX, color, roughness: 0.75 }), mz = new THREE.MeshStandardMaterial({ map: sideZ, color, roughness: 0.75 });
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mx, mx, roofMat, roofMat, mz, mz]);
    mesh.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);
    staticBox(physics, mesh.position.x, h / 2, mesh.position.z, w / 2, h / 2, d / 2);
  };
  // `back`: the setback on the west (+x) and east sides when not the sidewalk's
  const block = (x0: number, z0: number, x1: number, z1: number, hLo: number, hHi: number, back: [number, number] = [GRID.sidewalk, GRID.sidewalk]) => {
    const walk = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0), sideMat);
    walk.rotation.x = -Math.PI / 2; walk.position.set((x0 + x1) / 2, 0.006, (z0 + z1) / 2); walk.receiveShadow = true;
    scene.add(walk);
    const s = GRID.sidewalk, bx0 = x0 + back[1], bz0 = z0 + s, bx1 = x1 - back[0], bz1 = z1 - s;
    if (rng.next() < 0.4) {
      // an alley through the middle, along the block's longer side
      if (bx1 - bx0 >= bz1 - bz0) { const m = (bx0 + bx1) / 2; building(bx0, bz0, m - 3, bz1, rng.range(hLo, hHi)); building(m + 3, bz0, bx1, bz1, rng.range(hLo, hHi)); }
      else { const m = (bz0 + bz1) / 2; building(bx0, bz0, bx1, m - 3, rng.range(hLo, hHi)); building(bx0, m + 3, bx1, bz1, rng.range(hLo, hHi)); }
    } else building(bx0, bz0, bx1, bz1, rng.range(hLo, hHi));
  };
  for (let i = 0; i + 1 < xs.length; i++) for (let j = 0; j + 1 < zs.length; j++) block(xs[i] + hw, zs[j] + hw, xs[i + 1] - hw, zs[j + 1] - hw, 14, 46);
  // the lower row south of the first road, either side of the test lane
  for (let i = 0; i + 1 < xs.length; i++) if (xs[i] === TEST_LANE.x || xs[i + 1] === TEST_LANE.x) {
    const sb = GRID.south.setback, sw = GRID.sidewalk;
    block(xs[i] + hw, GRID.south.z0, xs[i + 1] - hw, zLo - hw, 9, 22, [xs[i + 1] === TEST_LANE.x ? sb : sw, xs[i] === TEST_LANE.x ? sb : sw]);
  }

  // lamp posts along the grid's sidewalks
  const lampSpots: [number, number, number][] = [];
  const every = 30 / q.propDensity;
  for (const gx of xs) for (const s of [-1, 1]) for (let z = (gx === TEST_LANE.x ? TEST_LANE.z0 : GRID.leadZ) + 10; z < zHi; z += every) {
    if (zs.some((gz) => Math.abs(z - gz) < hw + 8)) continue;
    lampSpots.push([gx + s * (hw + 0.8), z, s > 0 ? -Math.PI / 2 : Math.PI / 2]);
  }
  for (const gz of zs) for (const s of [-1, 1]) for (let x = xLo + hw + 10; x < xHi - hw; x += every) {
    if (xs.some((gx) => Math.abs(x - gx) < hw + 8)) continue;
    lampSpots.push([x, gz + s * (hw + 0.8), s > 0 ? Math.PI : 0]);
  }
  // round the inside of the hoarding
  for (let s = -H + 20; s < H - 10; s += 44 / q.propDensity) lampSpots.push([s, H + 2, Math.PI], [s, -H - 2, 0], [H + 2, s, -Math.PI / 2], [-H - 2, s, Math.PI / 2]);
  const kept = lampSpots.filter(([x, z]) => !(Math.abs(x) < PARK.gate.width && z < 0 && Math.abs(z) > H));
  const lamps = new THREE.InstancedMesh(lampPostGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), kept.length);
  kept.forEach(([x, z, yaw], i) => {
    lamps.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0, z), quat.setFromAxisAngle(UP, yaw), one));
    const c = physics.world.createCollider(R.ColliderDesc.cylinder(4, 0.14).setTranslation(x, 4, z).setCollisionGroups(groups(CG.WORLD, CG.ALL)), staticBody(physics));
    physics.tag(c, { surface: 'metal' });
  });
  lamps.castShadow = true;
  scene.add(lamps);

  // ---- the course: edge lines, kerbs on the corners, jersey barriers both sides -----------------------------------
  const line = courseLine(2), n = line.length, cw = COURSE.width / 2;
  // (cos h, -sin h) is the left of a heading h: `off` > 0 goes left
  const at = (i: number, off: number) => { const p = line[(i + n) % n]; return [p.x + Math.cos(p.h) * off, p.z - Math.sin(p.h) * off] as const; };
  for (let i = 0; i < n; i++) for (const s of [-1, 1]) { const [ax, az] = at(i, s * (cw - 0.3)), [bx, bz] = at(i + 1, s * (cw - 0.3)); white.line(ax, az, bx, bz, 0.18); }
  for (let i = 0; i < n; i++) {
    const a = line[i], b = line[(i + 1) % n];
    const turn = Math.atan2(Math.sin(b.h - a.h), Math.cos(b.h - a.h));
    if (Math.abs(turn) < 0.02) continue;
    const inside = Math.sign(turn); // + turning left: the inside is the left
    const [ax, az] = at(i, inside * (cw + 0.5)), [bx, bz] = at(i + 1, inside * (cw + 0.5));
    (i % 2 ? red : white).line(ax, az, bx, bz, 1.0);
  }
  // start line: a chequer across the first straight
  {
    const z = COURSE.startZ, x0 = COURSE.corners[0][0];
    for (let k = 0; k < 12; k++) for (let r = 0; r < 2; r++) if ((k + r) % 2 === 0) pave.line(x0 - cw + k + 0.5, z + r - 1, x0 - cw + k + 0.5, z + r, 1);
  }
  const jersey = jerseyGeometry();
  const barrierPos: [number, number, number][] = [];
  // along each edge every 3.05 m (a barrier's length and a hair), interpolated between the line's points
  for (const s of [-1, 1]) {
    const off = s * (cw + 1.6), E = line.map((_, i) => at(i, off));
    let next = 1.5;
    for (let i = 0, run = 0; i < n; i++) {
      const [ax, az] = E[i], [bx, bz] = E[(i + 1) % n], L = Math.hypot(bx - ax, bz - az);
      while (next <= run + L) {
        const u = (next - run) / L, x = ax + (bx - ax) * u, z = az + (bz - az) * u;
        next += 3.05;
        // the way in: the lot's side (+X, the left of a car heading north) of the start straight
        if (s > 0 && Math.abs(x - (COURSE.corners[0][0] + off)) < 1 && z > COURSE.gap[0] && z < COURSE.gap[1]) continue;
        barrierPos.push([x, z, Math.atan2(bx - ax, bz - az)]);
      }
      run += L;
    }
  }
  const jm = new THREE.InstancedMesh(jersey, new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.85, color: '#e6e3dc' }), barrierPos.length);
  barrierPos.forEach(([x, z, yaw], i) => {
    jm.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0, z), quat.setFromAxisAngle(UP, yaw), one));
    staticBox(physics, x, 0.4, z, 0.28, 0.4, 1.48, yaw);
  });
  jm.castShadow = true; jm.receiveShadow = true;
  scene.add(jm);

  // ---- 定圆 and 8字 -------------------------------------------------------------------------------------------------
  white.arc(DONUT.x, DONUT.z, DONUT.r, 0, Math.PI * 2, 0.2);
  yellow.arc(DONUT.x, DONUT.z, DONUT.r + 6, 0, Math.PI * 2, 0.15, 3, 3);
  for (const sz of [-1, 1]) {
    const cz = EIGHT.cz + sz * EIGHT.r;
    white.arc(EIGHT.cx, cz, EIGHT.r - EIGHT.lane / 2, 0, Math.PI * 2, 0.2);
    white.arc(EIGHT.cx, cz, EIGHT.r + EIGHT.lane / 2, 0, Math.PI * 2, 0.2);
    yellow.arc(EIGHT.cx, cz, EIGHT.r, 0, Math.PI * 2, 0.15, 3, 3);
  }
  white.box(PARK.spawn.x, PARK.spawn.z, 3, 6, 0.15);
  scene.add(white.build(paintMaterial('#ecebe4')), yellow.build(paintMaterial('#e8b62a'), 0.013), red.build(paintMaterial('#c8261e'), 0.014), pave.build(paintMaterial('#ecebe4'), 0.014));

  const props = new Props(physics, scene, 60, 8);
  props.cone(DONUT.x, DONUT.z);
  for (let k = 0; k < 8; k++) { const a = (k / 8) * Math.PI * 2; props.cone(DONUT.x + Math.cos(a) * 2.4, DONUT.z + Math.sin(a) * 2.4); }
  for (const sz of [-1, 1]) {
    const cz = EIGHT.cz + sz * EIGHT.r;
    props.cone(EIGHT.cx, cz);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; props.cone(EIGHT.cx + Math.cos(a) * 2.2, cz + Math.sin(a) * 2.2); }
  }
  // the course's apexes: a cone on the inside of each corner
  apexCones(line, cw, props);
  engine.add(props);

  // ---- lettering ---------------------------------------------------------------------------------------------------
  const letter = (text: string, x: number, z: number, w: number, yaw = 0, color?: string) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 160 / 512), new THREE.MeshStandardMaterial({ map: T.stencil(text, color), transparent: true, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false }));
    m.rotation.set(-Math.PI / 2, 0, yaw);
    m.position.set(x, 0.015, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  // readable by a car driving north: the text's top towards +z
  const NORTH = Math.PI;
  letter('测试路口', TEST_LANE.x - hw / 2, TEST_LANE.z0 + 16, 6, NORTH);
  for (const d of TEST_LANE.marks) if (d % 20 === 0) letter(`${d}`, TEST_LANE.x - hw + 1.4, TEST_LANE.zStop - d - 1.6, 2.6, NORTH, '#e8b62a');
  letter('提前漂', TEST_LANE.x - hw / 2, TEST_LANE.zStop - 25, 5, NORTH, '#e8b62a');
  letter('城市街区', xs[0] - hw / 2, GRID.leadZ + 12, 6, NORTH);
  letter('起点', COURSE.corners[0][0], COURSE.startZ - 5, 5, NORTH);
  letter('连续弯', COURSE.corners[0][0], COURSE.startZ - 22, 6, NORTH);
  letter('定圆', DONUT.x, DONUT.z - DONUT.r - 12, 5, NORTH);
  letter('8字', EIGHT.cx + EIGHT.r + EIGHT.lane / 2 + 7, EIGHT.cz, 6, Math.PI / 2);

  // distance boards on the test lane's right
  for (const d of TEST_LANE.marks) {
    const z = TEST_LANE.zStop - d, x = TEST_LANE.x - hw - 2.2;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 8), new THREE.MeshStandardMaterial({ color: '#9aa0a5', metalness: 0.6, roughness: 0.4 }));
    post.position.set(x, 0.9, z); post.castShadow = true;
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: T.board(String(d)), roughness: 0.6 }));
    board.position.set(x, 2.1, z); board.rotation.y = Math.PI;
    scene.add(post, board);
  }

  // ---- the hoarding, the gate, trees, the city in the haze ------------------------------------------------------
  walls(engine);
  const { trunk, crown } = poplarGeometry();
  const treeSpots: THREE.Matrix4[] = [];
  const ring = H + 14;
  for (let s = -ring; s <= ring; s += 11 / q.propDensity) {
    for (const [x, z] of [[s, ring], [s, -ring], [ring, s], [-ring, s]] as [number, number][]) {
      if (Math.abs(x) < PARK.gate.width + 6 && z < 0) continue;
      const sc = rng.range(0.8, 1.25);
      treeSpots.push(new THREE.Matrix4().compose(new THREE.Vector3(x + rng.range(-2, 2), 0, z + rng.range(-2, 2)), quat.setFromAxisAngle(UP, rng.range(0, 6)), new THREE.Vector3(sc, sc * rng.range(0.9, 1.2), sc)));
    }
  }
  const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: '#8d8a7e', roughness: 0.9 }), treeSpots.length);
  const crowns = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), treeSpots.length);
  treeSpots.forEach((mm, i) => { trunks.setMatrixAt(i, mm); crowns.setMatrixAt(i, mm); crowns.setColorAt(i, new THREE.Color('#ffffff').offsetHSL(rng.range(-0.03, 0.03), 0, rng.range(-0.12, 0))); });
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);
  scene.add(buildSkyline(haze));

  const per = 120;
  const api: WorldApi = {
    name: 'world',
    spawn: { x: PARK.spawn.x, y: TAXI.wheelRadius + 0.05, z: PARK.spawn.z, yaw: PARK.spawn.yaw },
    props,
    attract: {
      path: figureEight(EIGHT.cx, EIGHT.cz, EIGHT.r, per), closed: true, speed: 13,
      start: { x: EIGHT.cx, z: EIGHT.cz, yaw: Math.PI / 2 },
      drift: { tap: 0.32, slip: 0.4, rekick: 0.2, entries: [6, per + 6], kickZones: [[16, per - 14], [per + 16, 2 * per - 14]] },
    },
    placeName: () => '',
  };
  engine.add(api);
}

/** A cone just inside the middle of each corner's arc: the clipping point to brush past. */
function apexCones(line: { x: number; z: number; h: number }[], cw: number, props: Props): void {
  const n = line.length;
  const turnAt = (i: number) => { const a = line[(i + n) % n], b = line[(i + 1 + n) % n]; return Math.atan2(Math.sin(b.h - a.h), Math.cos(b.h - a.h)); };
  let i0 = -1;
  // start where the line runs straight, so no arc is split across the end
  let s = 0; while (Math.abs(turnAt(s)) > 0.02 && s < n) s++;
  for (let k = 0; k <= n; k++) {
    const i = s + k, curved = Math.abs(turnAt(i)) > 0.02;
    if (curved && i0 < 0) i0 = i;
    if (!curved && i0 >= 0) {
      const mid = Math.round((i0 + i - 1) / 2), p = line[mid % n], side = Math.sign(turnAt(mid));
      const off = side * (cw - 1.2);
      props.cone(p.x + Math.cos(p.h) * off, p.z - Math.sin(p.h) * off);
      i0 = -1;
    }
  }
}

/** The blue hoarding round the lot, a gap on the south side for the gate and its sign. */
function walls(engine: Engine): void {
  const { physics, scene } = engine;
  const h = 2.6, half = PARK.half + 6, gap = PARK.gate.width / 2;
  const tex = T.hoarding();
  const run = (x0: number, z0: number, x1: number, z1: number) => {
    const L = Math.hypot(x1 - x0, z1 - z0);
    const t = tex.clone(); t.wrapS = THREE.RepeatWrapping; t.repeat.set(L / 32, 1); t.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.BoxGeometry(L, h, 0.12), new THREE.MeshStandardMaterial({ map: t, roughness: 0.55, metalness: 0.3 }));
    const yaw = -Math.atan2(z1 - z0, x1 - x0);
    m.position.set((x0 + x1) / 2, h / 2, (z0 + z1) / 2);
    m.rotation.y = yaw;
    m.castShadow = true; m.receiveShadow = true;
    scene.add(m);
    staticBox(physics, m.position.x, h / 2, m.position.z, L / 2, h / 2, 0.15, yaw, 'metal');
  };
  run(-half, half, half, half); run(half, half, half, -half); run(-half, -half, -half, half);
  run(half, -half, gap, -half); run(-gap, -half, -half, -half);
  const pillarMat = new THREE.MeshStandardMaterial({ color: '#b8231b', roughness: 0.6 });
  for (const sx of [-1, 1]) {
    const p = new THREE.Mesh(new THREE.BoxGeometry(1, 6.4, 1), pillarMat);
    p.position.set(sx * (gap + 0.6), 3.2, -half); p.castShadow = true;
    scene.add(p);
    staticBox(physics, p.position.x, 3.2, p.position.z, 0.5, 3.2, 0.5);
  }
  const beam = new THREE.Mesh(new THREE.BoxGeometry(gap * 2 + 2.2, 1.5, 0.5), pillarMat);
  beam.position.set(0, 6.1, -half); beam.castShadow = true;
  scene.add(beam);
  const signMat = new THREE.MeshStandardMaterial({ map: T.gateSign('京城漂移练习场'), roughness: 0.5, emissive: '#ffffff', emissiveIntensity: 0.05 });
  for (const side of [-1, 1]) {
    const sign = new THREE.Mesh(new THREE.PlaneGeometry(gap * 2 + 1.6, 1.25), signMat);
    sign.position.set(0, 6.1, -half + side * 0.26);
    if (side < 0) sign.rotation.y = Math.PI;
    scene.add(sign);
  }
}
