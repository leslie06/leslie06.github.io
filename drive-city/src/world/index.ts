import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import { Rng } from '../core/Rng';
import type { WorldApi } from '../game/Contracts';
import type { RenderApi } from '../render';
import { FIGURE8, HILL, JUMP, PARKED, SLALOM, STRIP, TEST_AREA, YARD } from './Layout';
import { PaintBuilder, paintMaterial } from './Paint';
import { Props, jerseyGeometry, lampPostGeometry, poplarGeometry, tint } from './Props';
import { buildHill, buildOffice, buildRamp, buildWalls, staticBody, staticBox } from './Structures';
import { buildSkyline } from './Skyline';
import * as T from './Textures';
import { buildCar, COACH_LIVERY } from '../vehicle/CarModel';
import { figureEight } from '../vehicle/Autopilot';
import { TAXI } from '../vehicle/Spec';

/**
 * The M0 sandbox: a Beijing driving-school yard (驾校训练场). A figure-eight pad, a drag strip with
 * a braking box, a slalom, a kicker, the driving test's hill start and parking bays, blue hoarding,
 * poplars outside, and the CBD standing in the haze to the north.
 */
/**
 * Multiply a material's albedo by `macro`, sampled in world XZ over `size` metres. The tile texture
 * repeats every 9 m; this one does not repeat at all, which is what hides the tiling.
 */
function withMacro(mat: THREE.MeshStandardMaterial, macro: THREE.Texture, size: number): void {
  mat.onBeforeCompile = (sh) => {
    sh.uniforms.uMacro = { value: macro };
    sh.uniforms.uMacroSize = { value: size };
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMacroUv;\nuniform float uMacroSize;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvMacroUv = (modelMatrix * vec4(transformed, 1.0)).xz / uMacroSize + 0.5;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\nvarying vec2 vMacroUv;\nuniform sampler2D uMacro;')
      .replace('#include <map_fragment>', '#include <map_fragment>\ndiffuseColor.rgb *= mix(0.74, 1.16, texture2D(uMacro, vMacroUv).r);');
  };
}

export async function install(engine: Engine): Promise<void> {
  const { scene, physics, quality: q } = engine;
  const R = physics.R;
  const rng = new Rng(3);
  const render = engine.get<RenderApi>('render');
  const haze = render?.hazeColor ?? new THREE.Color('#c4c8c6');

  // Ground: one big collider, the paved yard, and grass beyond the hoarding.
  const ground = physics.world.createCollider(R.ColliderDesc.cuboid(4000, 1, 4000).setTranslation(0, -1, 0).setFriction(0.95)
    .setCollisionGroups(groups(CG.WORLD, CG.ALL)), staticBody(physics));
  physics.tag(ground, { surface: 'asphalt' });
  const asphalt = T.asphalt(q.tier === 'low' ? 512 : 1024);
  const tiles = (YARD.half * 2 + 20) / 9;
  asphalt.map.wrapS = asphalt.map.wrapT = asphalt.rough.wrapS = asphalt.rough.wrapT = THREE.RepeatWrapping;
  asphalt.map.repeat.set(tiles, tiles); asphalt.rough.repeat.set(tiles, tiles);
  const yardMat = new THREE.MeshStandardMaterial({ map: asphalt.map, roughnessMap: asphalt.rough, roughness: 1, color: '#e2e2e0' });
  yardMat.userData.wet = 'ground';
  withMacro(yardMat, T.asphaltMacro(), YARD.half * 2 + 20);
  const yard = new THREE.Mesh(new THREE.PlaneGeometry(YARD.half * 2 + 20, YARD.half * 2 + 20), yardMat);
  yard.rotation.x = -Math.PI / 2;
  yard.receiveShadow = true;
  scene.add(yard);
  const grassTex = T.grass(); grassTex.wrapS = grassTex.wrapT = THREE.RepeatWrapping; grassTex.repeat.set(300, 300);
  const grass = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), new THREE.MeshStandardMaterial({ map: grassTex, roughness: 1 }));
  // Well below the asphalt: at aerial distances a few centimetres is below depth precision.
  grass.rotation.x = -Math.PI / 2; grass.position.y = -0.6;
  grass.receiveShadow = true;
  scene.add(grass);

  // Paint.
  const white = new PaintBuilder(), yellow = new PaintBuilder();
  const { cx, cz, r, lane } = FIGURE8;
  for (const sz of [-1, 1]) {
    const ccz = cz + sz * r;
    white.arc(cx, ccz, r - lane / 2, 0, Math.PI * 2, 0.2);
    white.arc(cx, ccz, r + lane / 2, 0, Math.PI * 2, 0.2);
    yellow.arc(cx, ccz, r, 0, Math.PI * 2, 0.15, 3, 3);
  }
  // Drag strip.
  const sx0 = STRIP.x - STRIP.laneWidth, sx1 = STRIP.x + STRIP.laneWidth;
  white.line(sx0, STRIP.z0, sx0, STRIP.z1, 0.2).line(sx1, STRIP.z0, sx1, STRIP.z1, 0.2);
  white.dashed(STRIP.x, STRIP.z0, STRIP.x, STRIP.z1, 0.15, 4, 6);
  white.line(sx0, STRIP.z0 + 10, sx1, STRIP.z0 + 10, 0.5);
  for (let k = 0; k <= 4; k++) yellow.line(sx0, STRIP.brakeBoxZ + k * 10, sx1, STRIP.brakeBoxZ + k * 10, 0.3);
  // Test-area paint: reverse-park bays, parallel box, S-bend, right-angle turn.
  const b = TEST_AREA.bays;
  for (let k = 0; k < b.count; k++) yellow.box(b.x + k * b.width, b.z, b.width, b.depth, 0.15, 0, 0);
  const pp = TEST_AREA.parallel;
  yellow.box(pp.x, pp.z, pp.width, pp.length, 0.15, 0, 1);
  const sb = TEST_AREA.sbend;
  for (const off of [-sb.width / 2, sb.width / 2]) {
    yellow.arc(sb.x + sb.r, sb.z, sb.r + off, Math.PI / 2, Math.PI * 1.5, 0.15);
    yellow.arc(sb.x - sb.r, sb.z + sb.r * 2, sb.r - off, -Math.PI / 2, Math.PI / 2, 0.15);
  }
  const ra = TEST_AREA.rightAngle;
  yellow.line(ra.x - ra.width / 2, ra.z, ra.x - ra.width / 2, ra.z + ra.arm, 0.15).line(ra.x + ra.width / 2, ra.z, ra.x + ra.width / 2, ra.z + ra.arm - ra.width, 0.15);
  yellow.line(ra.x - ra.width / 2, ra.z + ra.arm, ra.x + ra.arm, ra.z + ra.arm, 0.15).line(ra.x + ra.width / 2, ra.z + ra.arm - ra.width, ra.x + ra.arm, ra.z + ra.arm - ra.width, 0.15);
  // Ring road inside the hoarding: edge lines and a dashed yellow centre, so the yard reads as a
  // place with roads rather than a car park.
  {
    const e0 = YARD.half - 6, e1 = YARD.half - 16, mid = (e0 + e1) / 2;
    for (const e of [e0, e1]) {
      white.line(-e, -e, e, -e, 0.18).line(e, -e, e, e, 0.18).line(e, e, -e, e, 0.18).line(-e, e, -e, -e, 0.18);
    }
    yellow.dashed(-mid, -mid, mid, -mid, 0.15, 6, 6).dashed(mid, -mid, mid, mid, 0.15, 6, 6).dashed(mid, mid, -mid, mid, 0.15, 6, 6).dashed(-mid, mid, -mid, -mid, 0.15, 6, 6);
  }
  // Slalom dots and the spawn box.
  for (let k = 0; k < SLALOM.count; k++) white.box(SLALOM.x, SLALOM.z0 + k * SLALOM.gap, 0.6, 0.6, 0.1);
  white.box(YARD.spawn.x, YARD.spawn.z, 3, 6, 0.15);
  scene.add(white.build(paintMaterial('#ecebe4')), yellow.build(paintMaterial('#e8b62a'), 0.013));

  // Ground lettering.
  const letter = (text: string, x: number, z: number, w: number, yaw = 0, color?: string) => {
    const tex = T.stencil(text, color);
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 160 / 512), new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.65, polygonOffset: true, polygonOffsetFactor: -3, depthWrite: false }));
    m.rotation.set(-Math.PI / 2, 0, yaw);
    m.position.set(x, 0.015, z);
    m.receiveShadow = true;
    scene.add(m);
  };
  letter('8字漂移', cx + r + lane / 2 + 7, cz, 9, Math.PI / 2);
  letter('起点', STRIP.x, STRIP.z0 + 6, 5, Math.PI);
  letter('刹车区', STRIP.x, STRIP.brakeBoxZ - 4, 6, Math.PI, '#e8b62a');
  letter('倒车入库', b.x + b.width * 1.5, b.z - b.depth / 2 - 3, 7, Math.PI, '#e8b62a');
  letter('侧方停车', pp.x + 5, pp.z, 7, Math.PI / 2, '#e8b62a');
  letter('S弯', sb.x, sb.z - 5, 4, Math.PI, '#e8b62a');
  letter('直角转弯', ra.x, ra.z - 4, 7, Math.PI, '#e8b62a');
  letter('绕桩', SLALOM.x + 5, SLALOM.z0 - 6, 4, Math.PI);
  letter('坡道定点停车', HILL.x, HILL.z - 5, 9, Math.PI, '#e8b62a');

  // Distance boards along the strip.
  for (let k = 1; k * STRIP.boards < STRIP.z1 - STRIP.z0; k++) {
    const z = STRIP.z0 + 10 + k * STRIP.boards;
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.8, 8), new THREE.MeshStandardMaterial({ color: '#9aa0a5', metalness: 0.6, roughness: 0.4 }));
    post.position.set(sx1 + 3, 0.9, z);
    const board = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), new THREE.MeshStandardMaterial({ map: T.board(String(k * STRIP.boards)), roughness: 0.6 }));
    board.position.set(sx1 + 3, 2.1, z);
    board.rotation.y = Math.PI;
    post.castShadow = true;
    scene.add(post, board);
  }

  // Concrete things: the kicker, the hill, jersey barriers.
  const concreteTex = T.concrete(); concreteTex.wrapS = concreteTex.wrapT = THREE.RepeatWrapping; concreteTex.repeat.set(0.4, 0.4);
  const concrete = new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.9 });
  const chev = new THREE.MeshStandardMaterial({ map: T.chevrons(), roughness: 0.7 });
  buildRamp(physics, scene, JUMP, concrete, chev);
  buildHill(physics, scene, concrete, paintMaterial('#ecebe4'));
  const jersey = jerseyGeometry();
  const jerseyPos: [number, number, number][] = [];
  for (let k = -2; k <= 2; k++) jerseyPos.push([STRIP.x + k * 3.05, STRIP.z1 + 4, Math.PI / 2]);
  for (let k = 0; k < 6; k++) jerseyPos.push([JUMP.x - 8, JUMP.z + 30 + k * 3.05, 0], [JUMP.x + 8, JUMP.z + 30 + k * 3.05, 0]);
  const jm = new THREE.InstancedMesh(jersey, new THREE.MeshStandardMaterial({ map: concreteTex, roughness: 0.85, color: '#e6e3dc' }), jerseyPos.length);
  const m4 = new THREE.Matrix4(), quat = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1);
  jerseyPos.forEach(([x, z, yaw], i) => {
    jm.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0, z), quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), one));
    staticBox(physics, x, 0.4, z, 0.28, 0.4, 1.48, yaw);
  });
  jm.castShadow = true; jm.receiveShadow = true;
  scene.add(jm);

  buildWalls(physics, scene);
  buildOffice(physics, scene);

  // Loose props.
  const props = new Props(physics, scene);
  for (let k = 0; k < SLALOM.count; k++) props.cone(SLALOM.x, SLALOM.z0 + k * SLALOM.gap);
  for (const sz of [-1, 1]) {
    const ccz = cz + sz * r;
    props.cone(cx, ccz);
    for (let k = 0; k < 6; k++) { const a = (k / 6) * Math.PI * 2; props.cone(cx + Math.cos(a) * 2.2, ccz + Math.sin(a) * 2.2); }
  }
  for (let k = 0; k < 5; k++) { props.cone(sx0 - 0.4, STRIP.brakeBoxZ + k * 10); props.cone(sx1 + 0.4, STRIP.brakeBoxZ + k * 10); }
  for (let k = -2; k <= 2; k++) for (let row = 0; row < 2; row++) props.tyreStack(STRIP.x + k * 1.6, STRIP.z1 - 2 - row * 0.8);
  for (let k = 0; k < 6; k++) props.tyreStack(JUMP.x - 3.5 + k * 1.4, JUMP.z + 58);
  engine.add(props);

  // Parked training cars by the office.
  for (const pc of PARKED) {
    const car = buildCar(TAXI, COACH_LIVERY);
    car.root.position.set(pc.x, TAXI.wheelRadius, pc.z);
    car.root.rotation.y = pc.yaw;
    for (const h of car.hubs) h.position.y = 0;
    scene.add(car.root);
    staticBox(physics, pc.x, 0.75, pc.z, 0.88, 0.6, 2.3, pc.yaw, 'metal');
  }

  // Lamp posts round the inside of the hoarding; poplars outside it.
  const lampSpots: [number, number, number][] = [];
  const edge = YARD.half + 2;
  const every = 40 / q.propDensity;
  for (let s = -edge + 20; s < edge - 10; s += every) {
    lampSpots.push([s, edge, Math.PI], [s, -edge, 0], [edge, s, -Math.PI / 2], [-edge, s, Math.PI / 2]);
  }
  const lamps = new THREE.InstancedMesh(lampPostGeometry(), new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.5, metalness: 0.4 }), lampSpots.length);
  lampSpots.forEach(([x, z, yaw], i) => {
    if (Math.abs(x) < YARD.gate.width && z < 0) { lamps.setMatrixAt(i, m4.makeScale(0, 0, 0)); return; }
    lamps.setMatrixAt(i, m4.compose(new THREE.Vector3(x, 0, z), quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw), one));
    const c = physics.world.createCollider(R.ColliderDesc.cylinder(4, 0.14).setTranslation(x, 4, z).setCollisionGroups(groups(CG.WORLD, CG.ALL)), staticBody(physics));
    physics.tag(c, { surface: 'metal' });
  });
  lamps.castShadow = true;
  scene.add(lamps);
  const { trunk, crown } = poplarGeometry();
  const treeSpots: THREE.Matrix4[] = [];
  const ring = YARD.half + 14;
  const treeEvery = 11 / q.propDensity;
  for (let s = -ring; s <= ring; s += treeEvery) {
    for (const [x, z] of [[s, ring], [s, -ring], [ring, s], [-ring, s]] as [number, number][]) {
      if (Math.abs(x) < YARD.gate.width + 6 && z < 0) continue;
      const sc = rng.range(0.8, 1.25);
      treeSpots.push(new THREE.Matrix4().compose(new THREE.Vector3(x + rng.range(-2, 2), 0, z + rng.range(-2, 2)), quat.setFromAxisAngle(new THREE.Vector3(0, 1, 0), rng.range(0, 6)), new THREE.Vector3(sc, sc * rng.range(0.9, 1.2), sc)));
    }
  }
  const trunks = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: '#8d8a7e', roughness: 0.9 }), treeSpots.length);
  const crowns = new THREE.InstancedMesh(crown, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9, flatShading: true }), treeSpots.length);
  treeSpots.forEach((mm, i) => { trunks.setMatrixAt(i, mm); crowns.setMatrixAt(i, mm); crowns.setColorAt(i, new THREE.Color('#ffffff').offsetHSL(rng.range(-0.03, 0.03), 0, rng.range(-0.12, 0))); });
  trunks.castShadow = crowns.castShadow = true;
  scene.add(trunks, crowns);
  void tint;

  scene.add(buildSkyline(haze));

  const api: WorldApi = {
    name: 'world',
    spawn: { x: YARD.spawn.x, y: TAXI.wheelRadius + 0.05, z: YARD.spawn.z, yaw: YARD.spawn.yaw },
    props,
    attract: {
      path: figureEight(FIGURE8.cx, FIGURE8.cz, FIGURE8.r, 120), closed: true, speed: 13,
      start: { x: FIGURE8.cx, z: FIGURE8.cz, yaw: Math.PI / 2 },
      drift: { tap: 0.32, slip: 0.4, rekick: 0.2, entries: [6, 126], kickZones: [[16, 106], [136, 226]] },
    },
  };
  engine.add(api);
}
