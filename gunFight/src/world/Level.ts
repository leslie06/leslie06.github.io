import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';
import { CG, groups } from '../core/Physics';
import type { SurfaceType } from '../core/Events';
import type { LevelApi, NavPoint, PlayerApi } from '../game/Contracts';
import { Rng } from '../core/Rng';
import { registerPose } from '../debug/Poses';
import { MaterialLib } from './Materials';
import { Batcher } from './Batch';
import { box, boxMM, chamferBox, chunkGeo, fbm2, fracturedBox, heightField, lathe, place, prep, softPatch, tube } from './Geo';
import { FH, SLAB, STAIR_D, STAIR_W, T, brokenWall, parapet, slab, stairsU, wall, type BuildCtx, type Opening, type WallSpec } from './Buildings';
import { makeAwningTexture, makeDecalAtlas, makeFacadeAtlas, makeGlassCrackTexture, makePaintTexture, makePaperTexture, makeSignAtlas } from './Canvas';
import * as P from './Props';
import { buildNavGraph } from './Nav';

/**
 * The playable map: a shelled Middle-Eastern / Eastern-European urban block, ~72×72 m.
 *
 *   z<0 (north)                    x: west -36 … east +36
 *   ┌──────────┬─alley─┬────┬──────────────┬─alley─┬────────┐
 *   │  B  (2f) │       │ A  │  main street │  C    │  D (2f)│
 *   │          │       │(3f)│              │(coll.)│        │
 *   ├── cross street ──┼────┼─ intersection ┼───────┼────────┤
 *   │ courtyard N wing │E2  │              │  E    │ market │
 *   │  sheds courtyard │(2f)│              │ (2f)  │  lot   │
 *   └──────────────────┴────┴──────────────┴───────┴────────┘
 */
export class Level implements System, LevelApi {
  name = 'level';
  root = new THREE.Group();
  spawnPoints: THREE.Vector3[] = [new THREE.Vector3(0, 1.1, 33)];
  navPoints: NavPoint[] = [];
  landmarks: Record<string, { position: THREE.Vector3; yaw: number; pitch: number }> = {};
  enemySpawns: THREE.Vector3[] = [];
  bounds = new THREE.Box3(new THREE.Vector3(-37, -3, -37), new THREE.Vector3(37, 45, 37));
  stats = { drawMeshes: 0, triangles: 0, colliders: 0 };

  private lib: MaterialLib;
  private batch!: Batcher;
  private rng = new Rng(20240905);
  private ctx!: BuildCtx;
  private textures: THREE.Texture[] = [];
  private applySkyHaze?: (c: THREE.Color, strength?: number) => void;
  private litMat?: THREE.MeshBasicMaterial;

  constructor(protected engine: Engine) {
    engine.scene.add(this.root);
    this.lib = new MaterialLib(engine);
  }

  // ------------------------------------------------------------------ colliders
  addStaticBox(center: THREE.Vector3, size: THREE.Vector3, surface: SurfaceType, rotationY = 0): void {
    this.collideBox(center.x, center.y, center.z, size.x, size.y, size.z, surface, rotationY);
  }
  collideBox(cx: number, cy: number, cz: number, w: number, h: number, d: number, surface: SurfaceType, rotY = 0): void {
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), rotY);
    this.collideQuat(cx, cy, cz, w, h, d, surface, q);
  }
  collideQuat(cx: number, cy: number, cz: number, w: number, h: number, d: number, surface: SurfaceType, q: THREE.Quaternion): void {
    const p = this.engine.physics;
    const body = p.world.createRigidBody(p.R.RigidBodyDesc.fixed().setTranslation(cx, cy, cz).setRotation({ x: q.x, y: q.y, z: q.z, w: q.w }));
    const col = p.world.createCollider(p.R.ColliderDesc.cuboid(Math.max(0.005, w / 2), Math.max(0.005, h / 2), Math.max(0.005, d / 2)).setCollisionGroups(groups(CG.WORLD, CG.ALL)).setFriction(0.8), body);
    p.tag(col, { surface });
    this.stats.colliders++;
  }
  collideMesh(geo: THREE.BufferGeometry, surface: SurfaceType): void {
    const p = this.engine.physics;
    const pos = geo.getAttribute('position') as THREE.BufferAttribute;
    const idx = geo.index ? new Uint32Array(geo.index.array as ArrayLike<number>) : new Uint32Array(Array.from({ length: pos.count }, (_, i) => i));
    const body = p.world.createRigidBody(p.R.RigidBodyDesc.fixed());
    const col = p.world.createCollider(p.R.ColliderDesc.trimesh(new Float32Array(pos.array as ArrayLike<number>), idx).setCollisionGroups(groups(CG.WORLD, CG.ALL)).setFriction(0.9), body);
    p.tag(col, { surface });
    this.stats.colliders++;
  }
  addStaticTrimesh(mesh: THREE.Mesh, surface: SurfaceType): void {
    mesh.updateWorldMatrix(true, false);
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    this.collideMesh(geo, surface); geo.dispose();
  }

  surfaceAt(point: THREE.Vector3): SurfaceType {
    const hit = this.engine.physics.raycast({ x: point.x, y: point.y + 0.5, z: point.z }, { x: 0, y: -1, z: 0 }, 3, groups(CG.PLAYER, CG.WORLD));
    return hit?.userData.surface ?? 'concrete';
  }

  // ------------------------------------------------------------------ build
  async build(): Promise<void> {
    const t0 = performance.now();
    // Hero wall sets carry their displacement map too: the close-range LOD runs a parallax-occlusion pass so
    // brick courses and plaster spall read as depth rather than a photo (see MaterialLib.parallax).
    this.lib.preload(['damaged_plaster', 'rough_plaster_broken', 'plastered_wall_04', 'yellow_plaster', 'red_brick_plaster_patch_02', 'broken_wall', 'peeling_painted_wall', 'brick_wall_006', 'red_brick_03', 'concrete_wall_008',
      // Round 3 asked for the hero-wall relief on "every wall the camera gets within 3 m of". These are the rest
      // of them: both interior paint sets (world_interior, every room), and the two grounds the player stands on.
      'painted_concrete', 'painted_plaster_wall', 'cobblestone_floor_08', 'concrete_floor_worn_001'], { disp: true });
    this.lib.preload(['asphalt_02', 'worn_asphalt', 'concrete_floor_worn_001', 'cobblestone_floor_08', 'damaged_concrete_floor', 'dirt_floor', 'rubble', 'concrete_debris',
      'painted_concrete',
      'rusty_corrugated_iron', 'rusty_metal_02', 'rusty_metal_sheet', 'rusty_painted_metal', 'painted_metal_shutter', 'wood_planks_dirt', 'hessian_230', 'sand_01', 'fabric_pattern_07',
      'painted_plaster_wall', 'grey_plaster', 'gravel_concrete', 'gravel_floor', 'rust_coarse_01', 'concrete_layers_02']);
    await this.lib.ready();
    this.defineMaterials();
    this.batch = new Batcher(this.lib, this.root);
    const signs = makeSignAtlas(this.rng);
    (this.lib.get('sign') as THREE.MeshStandardMaterial).map = signs.texture;
    this.ctx = {
      batch: this.batch, rng: this.rng, signs,
      collideBox: (cx, cy, cz, w, h, d, s, r) => this.collideBox(cx, cy, cz, w, h, d, s, r),
      collideQuat: (cx, cy, cz, w, h, d, s, q) => this.collideQuat(cx, cy, cz, w, h, d, s, q),
      collideMesh: (g, s) => this.collideMesh(g, s),
    };
    this.ground();
    this.buildingA();
    this.buildingE();
    this.buildingC();
    this.buildingB();
    this.buildingD();
    this.courtyardComplex();
    this.marketLot();
    this.perimeter();
    this.streetProps();
    this.skyline();
    this.batch.flush({ noShadow: new Set(['puddle', 'dirtDecal', 'gravelDecal', 'scorch', 'ao', 'paint', 'skyline', 'skylineLit', 'voidFill', 'cloth', 'glass', 'carGlass', 'decal', 'paper', 'debris']) });
    this.stats.drawMeshes = this.batch.meshes.length; this.stats.triangles = this.batch.triangles;
    (window as unknown as { __worldStats?: () => unknown }).__worldStats = () => ({ meshes: this.stats.drawMeshes, triangles: this.stats.triangles, colliders: this.stats.colliders, nav: this.navPoints.length, top: [...this.batch.report].sort((a, b) => b[1] - a[1]).slice(0, 40) });
    // Diagnostic used by the screenshot loop: name whatever a screen pixel is looking at, so a stray surface in a
    // capture can be traced back to the prop that emitted it (this is how the crater's "flat disc" was found to
    // be the far-ground box slicing through the bowl). Read-only; draws nothing.
    (window as unknown as { __pick?: (nx: number, ny: number) => unknown }).__pick = (nx: number, ny: number) => {
      const rc = new THREE.Raycaster(); rc.setFromCamera(new THREE.Vector2(nx, ny), this.engine.camera);
      return rc.intersectObjects(this.engine.scene.children, true).slice(0, 6)
        .map((h) => ({ n: h.object.name || h.object.type, d: +h.distance.toFixed(2), x: +h.point.x.toFixed(2), y: +h.point.y.toFixed(3), z: +h.point.z.toFixed(2) }));
    };
    this.registerInteriors();
    this.followSky();
    this.spawnsAndLandmarks();
    this.engine.physics.world.step(); // colliders only become queryable once the pipeline has run (only fixed bodies exist yet)
    this.navPoints = buildNavGraph(this.engine, new THREE.Box3(new THREE.Vector3(-35.5, -1, -35.5), new THREE.Vector3(35.5, 14, 35.5)), this.navSeeds(), 2.0);
    this.registerPoses();
    console.info(`[world] built in ${(performance.now() - t0).toFixed(0)}ms: ${this.stats.drawMeshes} meshes, ${this.stats.triangles} tris, ${this.stats.colliders} colliders, ${this.navPoints.length} nav nodes`);
  }

  private defineMaterials(): void {
    const L = this.lib;
    const dirt = (height = 1.4, strength = 0.5, ground = 0) => ({ height, strength, ground });
    // Parallax relief on the hero walls: `height` is peak-to-trough in metres, marched at close range only.
    const HERO = (height: number) => ({ height, layers: 12, range: 7, cavity: 0.5 });
    // Real-world tile sizes. Brick sets are photographed square but a brick course is 215x65 mm, so a 2048px
    // brick_wall_006 tile (≈ 30 courses x 12 stretchers) is ~2.6 m wide and ~2.0 m tall → anisotropic tiles.
    const BRICK_L = [2.6, 2.0] as [number, number];      // brick_wall_006
    const BRICK_S = [1.9, 1.45] as [number, number];     // red_brick_03 (finer course)
    L.define('asphalt', { set: 'asphalt_02', tile: 3.6, macro: 0.3, normalScale: 0.9 });
    L.define('sidewalk', { set: 'concrete_floor_worn_001', tile: 2.4, macro: 0.3, normalScale: 0.8, parallax: { height: 0.005, layers: 8, range: 5, cavity: 0.4 } });
    L.define('cobble', { set: 'cobblestone_floor_08', tile: 2.2, macro: 0.25, normalScale: 1.0, parallax: { height: 0.014, layers: 12, range: 6.5, cavity: 0.55 } });
    L.define('concrete', { set: 'concrete_wall_008', tile: 2.6, macro: 0.28, dirt: dirt(1.2, 0.45), normalScale: 1.4, parallax: { height: 0.006, layers: 8, range: 5.5, cavity: 0.45 } });
    L.define('floorInt', { set: 'damaged_concrete_floor', tile: 2.6, macro: 0.35, normalScale: 0.8, desat: 0.25 });
    L.define('dirt', { set: 'dirt_floor', tile: 3.0, macro: 0.5, normalScale: 1.0, desat: 0.2 });
    L.define('rubble', { set: 'rubble', tile: 1.15, macro: 0.45, normalScale: 1.6, gain: 0.72, dirt: dirt(0.9, 0.4, -0.4) });
    L.define('gravel', { set: 'gravel_concrete', tile: 1.6, macro: 0.3, normalScale: 0.9 });
    // Broken-concrete chunks: a 2.6 m wall tile over a 0.4 m chunk is a smooth wash — the reason the rubble read
    // as "a spilled box of clean foam blocks". A 0.5 m debris tile puts visible aggregate on every fragment.
    L.define('debris', { set: 'concrete_debris', tile: 0.42, macro: 0.5, normalScale: 2.0, desat: 0.18 });
    // Precast barriers (T-walls, Jersey barriers). They stand a metre from the camera in several poses, so they
    // get a board-formed concrete with visible lift lines, a strong splash-dirt band and the parallax pass —
    // the generic wall concrete at a 2.6 m tile read as a raw greybox panel at that range.
    L.define('precast', { set: 'concrete_layers_02', tile: 1.7, macro: 0.34, normalScale: 1.5, desat: 0.3, dirt: dirt(0.85, 0.6, 0), parallax: { height: 0.008, layers: 10, range: 6.5, cavity: 0.5 } });
    L.define('plasterA', { set: 'damaged_plaster', tile: 2.8, layer2: { set: 'red_brick_03', tile: BRICK_S }, dirt: dirt(1.6, 0.5), macro: 0.25, normalScale: 1.45, parallax: HERO(0.009) });
    L.define('plasterB', { set: 'rough_plaster_broken', tile: 2.5, layer2: { set: 'brick_wall_006', tile: BRICK_L }, dirt: dirt(1.5, 0.5), macro: 0.3, normalScale: 1.45, parallax: HERO(0.009) });
    L.define('plasterC', { set: 'plastered_wall_04', tile: 2.6, layer2: { set: 'brick_wall_006', tile: BRICK_L }, dirt: dirt(1.5, 0.55), macro: 0.32, normalScale: 1.3, color: 0xd9d4c9, parallax: HERO(0.008) });
    /**
     * Alley-left / fx_decals hero wall (building B's east face).
     *
     * This was `yellow_plaster`, a smooth painted stucco whose displacement map is almost flat — so even with
     * the parallax pass enabled it had no relief to march, and round 3 called it out as the one wall at hero
     * distance that is "a flat albedo card with zero relief and zero luminance gradient across 6 m" next to
     * plasterA on the opposite side of the same alley. Same broken-plaster set the courtyard uses (real spall
     * depth), pushed ochre by the material colour and the vertex tint, with the brick layer showing through.
     */
    L.define('plasterD', { set: 'rough_plaster_broken', tile: 2.35, layer2: { set: 'red_brick_03', tile: BRICK_S }, dirt: dirt(1.6, 0.5), macro: 0.34, normalScale: 1.55, color: 0xe4d5a8, gain: 1.05, desat: 0.18, parallax: HERO(0.011) });
    L.define('brickD', { set: 'red_brick_plaster_patch_02', tile: [2.4, 1.85], dirt: dirt(1.4, 0.5), macro: 0.22, normalScale: 1.5, parallax: HERO(0.011) });
    L.define('stone', { set: 'broken_wall', tile: 2.3, dirt: dirt(1.2, 0.5), macro: 0.3, normalScale: 1.5, parallax: HERO(0.013) });
    // Interiors: desaturated, slightly darker plaster (the raw scans are a saturated terracotta).
    L.define('interior', { set: 'peeling_painted_wall', tile: 2.3, layer2: { set: 'brick_wall_006', tile: BRICK_L }, dirt: dirt(1.0, 0.45), macro: 0.3, normalScale: 1.35, desat: 0.72, gain: 2.1, parallax: HERO(0.007) });
    L.define('interiorGreen', { set: 'painted_concrete', tile: 2.2, layer2: { set: 'brick_wall_006', tile: BRICK_L }, dirt: dirt(1.0, 0.45), macro: 0.3, normalScale: 1.15, desat: 0.4, gain: 2.1, parallax: HERO(0.006) });
    L.define('interiorGrey', { set: 'painted_plaster_wall', tile: 2.6, layer2: { set: 'brick_wall_006', tile: BRICK_L }, dirt: dirt(1.1, 0.5), macro: 0.3, normalScale: 1.15, desat: 0.2, parallax: HERO(0.006) });
    L.define('brickSolid', { set: 'brick_wall_006', tile: BRICK_L, dirt: dirt(1.2, 0.45), macro: 0.28, normalScale: 1.5, desat: 0.3, parallax: HERO(0.011) });
    L.define('corrugated', { set: 'rusty_corrugated_iron', tile: 1.6, macro: 0.2, normalScale: 1.0, roughness: 0.9 });
    L.define('rust', { set: 'rusty_metal_02', tile: 1.1, macro: 0.2, normalScale: 0.9, metalness: 0.35, roughness: 0.85, gain: 1.9, lift: 0.85 });
    L.define('rustSheet', { set: 'rusty_metal_sheet', tile: 2.0, macro: 0.2, normalScale: 0.9, metalness: 0.4, roughness: 0.75 });
    L.define('paintedMetal', { set: 'rusty_painted_metal', tile: 0.95, macro: 0.28, normalScale: 1.15, metalness: 0.25, roughness: 0.78, desat: 0.5, gain: 2.1, lift: 0.88 });
    // Vehicle body: coarse rust over paint; the vertex tint carries the paint colour, so keep the albedo neutral-ish.
    // rust_coarse_01 is a dark brown scan (~0.05 linear); the paint colour lives in the vertex tint, so desaturate
    // hard and lift the gain until the albedo lands in the mid greys, otherwise every wreck renders black.
    L.define('wreck', { set: 'rust_coarse_01', tile: 1.3, macro: 0.25, normalScale: 1.1, metalness: 0.2, roughness: 0.52, desat: 0.85, gain: 5.0, lift: 0.72, envMapIntensity: 1.7 });
    L.define('shutter', { set: 'painted_metal_shutter', tile: 1.0, macro: 0.15, normalScale: 1.0, metalness: 0.3, roughness: 0.7 });
    L.define('wood', { set: 'wood_planks_dirt', tile: 1.2, macro: 0.25, normalScale: 0.9, gain: 1.7, lift: 0.85 });
    // Burlap: a 1k hessian tile is ~6 cm of real cloth. 0.5 m made 5 mm threads read at 1 m.
    // Sandbags read as "bars of soap" because a 1.45 albedo gain put the hessian at the top of the range where
    // the weave carries no value contrast at all. Gain down, normal up: the cloth does the work, not the tint.
    L.define('hessian', { set: 'hessian_230', tile: 0.055, macro: 0.34, normalScale: 2.0, metalness: 0, roughness: 1, gain: 1.0, lift: 0.9 });
    L.define('hesco', { set: 'hessian_230', tile: 0.095, macro: 0.34, normalScale: 1.7, metalness: 0, roughness: 1, dirt: dirt(0.34, 0.85, 0x4a3a28), gain: 1.05, lift: 0.9 });
    L.define('sand', { set: 'sand_01', tile: 1.0, macro: 0.2, normalScale: 0.8 });
    L.define('fabric', { set: 'fabric_pattern_07', tile: 0.4, macro: 0.35, normalScale: 0.9, desat: 0.45, gain: 1.75, lift: 0.82 });
    // hanging cloth (laundry, tarps) needs both faces
    L.define('cloth', { set: 'fabric_pattern_07', tile: 0.28, macro: 0.35, normalScale: 1.1, desat: 0.45, gain: 1.35, lift: 0.86, side: THREE.DoubleSide });
    L.plain('darkMetal', new THREE.MeshStandardMaterial({ color: 0x9a9a9a, roughness: 0.55, metalness: 0.7 }));
    /**
     * Galvanised wire (concertina coil, HESCO mesh).
     *
     * Round 3: "the bright chrome tube now dominates the frame and reads worse than the round-2 black version",
     * plus CA fringing on the thin white HESCO grid lines. Weathered galvanising is a mid grey that is *rough*
     * — it holds a soft sheen along the top of a coil, not a mirror. Roughness up, metalness and env down; the
     * per-use vertex tints carry the rest.
     */
    L.plain('wire', new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.62, metalness: 0.62, envMapIntensity: 0.9, side: THREE.DoubleSide }));
    L.plain('rubber', new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.88, metalness: 0, envMapIntensity: 0.55 }));
    L.plain('glass', new THREE.MeshStandardMaterial({ color: 0x5f7380, roughness: 0.22, metalness: 0.05, transparent: true, opacity: 0.38, envMapIntensity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    // Vehicle glazing: a laminated pane that has been hit — milky, spidered, still in the frame. Alpha comes
    // from the crack texture so the pane is see-through between the cracks and opaque white along them.
    const crackTex = makeGlassCrackTexture(this.rng); this.textures.push(crackTex);
    L.plain('carGlass', new THREE.MeshStandardMaterial({ map: crackTex, color: 0x9fb0b6, roughness: 0.12, metalness: 0.0, transparent: true, opacity: 0.66, envMapIntensity: 1.7, side: THREE.DoubleSide, depthWrite: false }));

    L.plain('puddle', new THREE.MeshStandardMaterial({ color: 0x0a0c0e, roughness: 0.08, metalness: 0.0, transparent: true, opacity: 0.8, depthWrite: false, envMapIntensity: 0.45, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    L.define('dirtDecal', { set: 'dirt_floor', tile: 2.2, macro: 0.3, transparent: true, depthWrite: false, polygonOffset: -1, normalScale: 0.6, color: 0x4a3d30 });
    L.define('gravelDecal', { set: 'gravel_floor', tile: 0.9, macro: 0.35, transparent: true, depthWrite: false, polygonOffset: -1, normalScale: 0.7, color: 0x9a8f7c });
    // Burnt-out bodywork. A near-black albedo turned every burnt wreck into a paper cut-out: charred steel is a
    // dark warm grey with a lot of *value* structure (soot, scorched primer, bare metal at the creases), so keep
    // enough of the scan and enough base value that panel form still reads against a shadowed wall.
    L.define('burnt', { set: 'rust_coarse_01', tile: 0.85, macro: 0.45, normalScale: 1.35, metalness: 0.15, roughness: 0.85, desat: 0.62, gain: 2.8, lift: 0.82, color: 0x6b6359, envMapIntensity: 1.6, side: THREE.DoubleSide });
    L.plain('scorch', new THREE.MeshStandardMaterial({ color: 0x0b0a09, roughness: 1, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    // Baked-AO / contact-shadow strips: pure black, unlit-ish (no env), alpha from vertex colours.
    L.plain('ao', new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, metalness: 0, envMapIntensity: 0, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    const paint = makePaintTexture(this.rng); this.textures.push(paint);
    L.plain('paint', new THREE.MeshStandardMaterial({ map: paint, color: 0x968f80, roughness: 0.92, alphaTest: 0.4, polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 }));
    L.plain('sign', new THREE.MeshStandardMaterial({ roughness: 0.65, metalness: 0.1 }));
    const awn = makeAwningTexture(this.rng, '#b8352b', '#e8e0cc'); this.textures.push(awn);
    L.plain('awning', new THREE.MeshStandardMaterial({ map: awn, roughness: 0.95, side: THREE.DoubleSide, alphaTest: 0.35, transparent: true }));
    const paper = makePaperTexture(this.rng); this.textures.push(paper);
    L.plain('paper', new THREE.MeshStandardMaterial({ map: paper, color: 0x6e6558, roughness: 1.0, alphaTest: 0.5, side: THREE.DoubleSide }));
    // Shared decal sheet (pocks / shell holes / rain streaks / grime / soot / gravel dust), one merged draw call.
    const decals = makeDecalAtlas(this.rng); this.textures.push(decals);
    L.plain('decal', new THREE.MeshStandardMaterial({ map: decals, roughness: 0.95, transparent: true, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 }));
    // Distant city: one atlas of facade / roof / brick cells, tinted per building face by vertex colour.
    const fac = makeFacadeAtlas(this.rng); this.textures.push(fac);
    const skyMat = L.plain('skyline', new THREE.MeshStandardMaterial({ map: fac, roughness: 0.96, metalness: 0, side: THREE.DoubleSide }));
    // Lit windows at dusk. Unlit, HDR (colour driven above 1 so the bloom threshold picks them up), switched
    // off entirely while the sun is up — see followSky().
    this.litMat = L.basic('skylineLit', new THREE.MeshBasicMaterial({ color: 0x000000, toneMapped: true, fog: false }));
    // Unlit backdrop for openings whose interior receives no light (see Props.voidBack).
    L.basic('voidFill', new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: true }));
    // Aerial perspective: the ring starts at 46 m and runs to 265 m; haze it to ~72% of the horizon colour at
    // the far ring so the towers sit behind the level instead of competing with it.
    // Round 3: "the haze now hides them, which is not the same as fixing them". Now that the blocks have a
    // silhouette worth seeing, the material haze steps back and lets the render module's post pass carry the
    // aerial perspective — a distant block must still show its own value structure (ref_08 keeps three legible
    // mountain layers), it just loses contrast and saturation.
    const setHaze = L.haze(skyMat, { near: 62, far: 260, strength: 0.44, desat: 0.42, lift: 0.055, color: new THREE.Color(0.55, 0.62, 0.74) });
    // The 420 m ground plane behind the perimeter sits at full contrast against a hazed city, which reads as a
    // painted backdrop with the city floating on it. Same treatment, slightly weaker (it is nearer to the eye).
    const farMat = L.define('farGround', { set: 'dirt_floor', tile: 14, macro: 0.55, normalScale: 0.3, desat: 0.4 });
    const setFarHaze = L.haze(farMat, { near: 30, far: 320, strength: 1.0, desat: 0.75, lift: 0.10, color: new THREE.Color(0.55, 0.62, 0.74) });
    this.applySkyHaze = (c, st) => { setHaze(c, st); setFarHaze(c, st === undefined ? undefined : st * 1.12); };
  }

  // ------------------------------------------------------------------ ground & streets
  private ground(): void {
    const B = this.batch, ctx = this.ctx;
    /**
     * Terrain beyond the level, built as a *frame* around the block rather than one slab under it.
     *
     * The old full-extent box had its top face at y = −0.02, which is above the floor of any real hole in the
     * street. It sliced straight through the crater bowl and showed as a flat pale disc across it — that disc
     * is what has been reported as "the crater is a flat disc decal" since round 1, and it also blocked the
     * player from ever standing in the crater. The frame leaves the level footprint clear; a deep backstop
     * sits well below every hole so a gap can never show sky.
     */
    const FAR = 900, EDGE = 37;
    for (const [ax, az, bx, bz] of [[-FAR, -FAR, FAR, -EDGE], [-FAR, EDGE, FAR, FAR], [-FAR, -EDGE, -EDGE, EDGE], [EDGE, -EDGE, FAR, EDGE]] as [number, number, number, number][]) {
      B.add('farGround', boxMM(ax, -1.2, az, bx, -0.02, bz, { tint: 0x7d7264, segs: [4, 1, 4] }));
      this.collideBox((ax + bx) / 2, -0.61, (az + bz) / 2, bx - ax, 1.18, bz - az, 'dirt');
    }
    B.add('farGround', boxMM(-EDGE, -3.0, -EDGE, EDGE, -1.35, EDGE, { tint: 0x6a6156 }));
    this.collideBox(0, -2.2, 0, 2 * EDGE, 1.65, 2 * EDGE, 'dirt');
    // main street (x −6.5..6.5) with a crater hole at the intersection; cross street east/west
    const crater = { x0: -4.4, z0: -6.6, x1: 7.6, z1: 5.4 };
    slab(ctx, -6.5, -36, 6.5, 36, -0.5, 0, [crater], 'asphalt', undefined, { tint: 0xffffff });
    slab(ctx, -36, -5.5, -6.5, 5.5, -0.5, 0, [], 'asphalt', undefined, { tint: 0xf4f0ea });
    slab(ctx, 6.5, -5.5, 36, 5.5, -0.5, 0, [], 'asphalt', undefined, { tint: 0xf4f0ea });
    /**
     * Crater.
     *
     * Round 1 and 2 shipped a flat dark disc decal. This is displaced ground: a bowl 0.95 m deep, a lumpy
     * raised lip standing ~0.3 m proud of the road, radial cracks cut into the asphalt outside the lip, and
     * ejecta thrown along those same rays so the debris pattern agrees with the fracture pattern.
     */
    const cc = { x: 1.6, z: -0.6, r: 3.4, d: 0.95 };
    const cracks = Array.from({ length: 9 }, (_, i) => ({ a: (i / 9) * Math.PI * 2 + this.rng.range(-0.3, 0.3), len: this.rng.range(1.1, 2.4), w: this.rng.range(0.09, 0.19) }));
    const crackFn = (x: number, z: number, dd: number) => {
      const r0 = cc.r * 0.86;
      if (dd < r0) return 0;
      const ang = Math.atan2(z - cc.z, x - cc.x);
      let g = 0;
      for (const c of cracks) {
        const along = (dd - r0) / c.len;
        if (along > 1) continue;
        let da = ang - c.a - 0.1 * Math.sin(dd * 2.3);
        da = Math.atan2(Math.sin(da), Math.cos(da));
        const lateral = da * dd;
        g = Math.max(g, Math.exp(-Math.pow(lateral / c.w, 2)) * (1 - along) * (1 - along));
      }
      return g;
    };
    const craterH = (x: number, z: number) => {
      const dd = Math.hypot(x - cc.x, z - cc.z);
      const t = THREE.MathUtils.clamp(dd / cc.r, 0, 1);
      // asymmetric bowl: the blast came in at an angle, so the far lip is higher and the bowl is offset
      const skew = 1 + 0.16 * Math.cos(Math.atan2(z - cc.z, x - cc.x) - 0.9);
      const bowl = -cc.d * skew * Math.pow(1 - t * t, 1.5);
      const lipN = 0.55 + 0.9 * fbm2(x * 1.9 + 11, z * 1.9 - 7);
      const rim = 0.38 * lipN * Math.exp(-Math.pow((dd - cc.r * 0.96) / 0.55, 2));
      const edgeFade = 1 - THREE.MathUtils.smoothstep(dd, 4.4, 5.5);
      const crack = -0.085 * crackFn(x, z, dd) * edgeFade;
      const floorBreak = (1 - t) * (0.13 * (fbm2(x * 1.7 + 31, z * 1.7 - 17) - 0.45) + 0.06 * (fbm2(x * 4.3, z * 4.3) - 0.5));
      const grain = floorBreak + 0.05 * (fbm2(x * 2.4, z * 2.4) - 0.5) * (1 - t * 0.6) + 0.025 * (fbm2(x * 7, z * 7) - 0.5);
      return (bowl + rim + grain) * edgeFade + crack;
    };
    // Burn and cavity AO baked into the crater's own vertices: a charred core fading out past the lip, plus
    // depth-driven darkening so the bowl does not read as a pale machined dish.
    const craterShade = (x: number, y: number, z: number) => {
      const dd = Math.hypot(x - cc.x, z - cc.z);
      const burn = 1 - 0.58 * (1 - THREE.MathUtils.smoothstep(dd, 0.4, cc.r * 1.3)) * (0.7 + 0.6 * fbm2(x * 1.3 + 5, z * 1.3));
      const depth = 0.66 + 0.46 * THREE.MathUtils.smoothstep(y, -cc.d * 0.95, 0.16);
      return burn * depth;
    };
    const craterGeo = heightField(crater.x0, crater.z0, crater.x1, crater.z1, 0.25, craterH, { tint: 0x8c8378, aoFn: craterShade });
    B.add('rubble', craterGeo);
    this.collideMesh(craterGeo, 'dirt');
    // Burn: draped over the displaced surface, not a disc across the mouth of the hole. A flat decal spanning a
    // 0.95 m bowl is exactly the "flat disc decal" the crater was called for in the first place.
    // Burn: draped over the displaced surface, not a disc across the mouth of the hole. A flat decal spanning a
    // 0.95 m bowl is exactly the "flat disc decal" the crater was called for in the first place. Alpha falls off
    // with radius so the bowl floor is the darkest point and there is no hard circular edge anywhere.
    const drape = (r0: number, r1: number, rings: number, a0: number, a1: number, tint: number, lift: number) => {
      const geo = new THREE.RingGeometry(r0, r1, 44, rings).rotateX(-Math.PI / 2).translate(cc.x, 0, cc.z);
      const pos = geo.getAttribute('position') as THREE.BufferAttribute;
      const g2 = prep(geo, { uv: 'keep', alpha: 1, tint });
      const col = g2.getAttribute('color') as THREE.BufferAttribute;
      const p2 = g2.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < p2.count; i++) {
        const t = THREE.MathUtils.clamp((Math.hypot(p2.getX(i) - cc.x, p2.getZ(i) - cc.z) - r0) / (r1 - r0), 0, 1);
        col.setW(i, THREE.MathUtils.lerp(a0, a1, t * t));
      }
      for (let i = 0; i < p2.count; i++) p2.setY(i, craterH(p2.getX(i), p2.getZ(i)) + lift);
      g2.computeVertexNormals();
      void pos;
      B.add('scorch', g2);
    };
    drape(0.02, 5.6, 10, 0.78, 0.0, 0x0d0a08, 0.03);
    // ejecta along the crack rays: dense at the lip, thinning outward, plus dust haloes
    for (const c of cracks) {
      const dirX = Math.cos(c.a), dirZ = Math.sin(c.a);
      const gx = cc.x + dirX * cc.r * 1.25, gz = cc.z + dirZ * cc.r * 1.25;
      P.gravelPatch(ctx, gx, gz, 1.5, 1.1, craterH(gx, gz) + 0.013, 0.75);
      for (let i = 0; i < 7; i++) {
        const rr = cc.r * 1.05 + Math.pow(this.rng.next(), 0.7) * 4.6;
        const spread = this.rng.gauss() * 0.22;
        const px = cc.x + Math.cos(c.a + spread) * rr, pz = cc.z + Math.sin(c.a + spread) * rr;
        if (Math.abs(px) > 6.2 && Math.abs(pz) > 5.2) continue;
        const gyy = Math.max(0, craterH(px, pz));
        const sc = this.rng.range(0.18, 0.55) * (1 - (rr - cc.r) / 7);
        const kind = this.rng.next();
        const geo: 'shard' | 'wedge' | 'slab' = kind < 0.4 ? 'shard' : kind < 0.7 ? 'wedge' : 'slab';
        const cg = chunkGeo(geo, this.rng, i * 5 + 71);
        cg.scale(Math.max(0.12, sc), Math.max(0.12, sc), Math.max(0.12, sc));
        B.add('debris', place(cg, px, gyy, pz, { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(this.rng.range(-0.9, 0.9), this.rng.range(0, 6), this.rng.range(-0.9, 0.9))), keepColor: true, tint: new THREE.Color().setHSL(0.075, 0.05, this.rng.range(0.45, 0.82)) }));
      }
    }
    P.debrisField(ctx, cc.x, cc.z, cc.r * 1.6, cc.r * 1.6, 90, 0, { bricks: true, chunkScale: 0.9, cluster: 7, groundFn: (x, z) => craterH(x, z) });
    for (let i = 0; i < 7; i++) { const a = (i / 7) * Math.PI * 2 + 1.1; const px = cc.x + Math.cos(a) * cc.r * 0.85, pz = cc.z + Math.sin(a) * cc.r * 0.85; P.rebar(ctx, px, craterH(px, pz) - 0.05, pz, new THREE.Vector3(Math.cos(a), 1.2, Math.sin(a)), this.rng.range(0.5, 1.1)); }
    // sidewalks + curbs (block interiors sit at +0.15 too)
    const walks: [number, number, number, number][] = [[-9, -36, -6.5, -5.5], [-9, 5.5, -6.5, 36], [6.5, -36, 9, -5.5], [6.5, 5.5, 9, 36], [-36, -8, -9, -5.5], [-36, 5.5, -9, 8], [9, -8, 36, -5.5], [9, 5.5, 36, 8]];
    for (const [x0, z0, x1, z1] of walks) slab(ctx, x0, z0, x1, z1, -0.1, 0.15, [], 'sidewalk', undefined, { tint: 0xf2eee8 });
    const curbs: [number, number, number, number][] = [[-6.55, -36, -6.25, -5.5], [-6.55, 5.5, -6.25, 36], [6.25, -36, 6.55, -5.5], [6.25, 5.5, 6.55, 36], [-36, -5.8, -9, -5.5], [-36, 5.5, -9, 5.8], [9, -5.8, 36, -5.5], [9, 5.5, 36, 5.8]];
    for (const [x0, z0, x1, z1] of curbs) B.add('concrete', chamferBox((x0 + x1) / 2, 0.075, (z0 + z1) / 2, x1 - x0, 0.16, z1 - z0, 0.025, { tint: 0xd5d0c6 }));
    // block interior grounds
    slab(ctx, -26, -36, -23, -8, -0.1, 0.15, [], 'cobble', undefined, { tint: 0xe8e4de }, 'concrete');   // west alley
    slab(ctx, 23, -36, 26, -8, -0.1, 0.15, [], 'cobble', undefined, { tint: 0xe2ded6 }, 'concrete');     // east alley
    slab(ctx, -23, -36, -9, -24, -0.1, 0.15, [], 'dirt', undefined, { tint: 0xe6ddd0 }, 'dirt');         // back lot behind A
    slab(ctx, 9, -36, 23, -24, -0.1, 0.15, [], 'dirt', undefined, { tint: 0xe0d8cc }, 'dirt');           // behind C
    slab(ctx, -36, -36, -26, -30, -0.1, 0.15, [], 'dirt', undefined, { tint: 0xe0d8cc }, 'dirt');        // behind B
    slab(ctx, 26, -36, 36, -30, -0.1, 0.15, [], 'dirt', undefined, { tint: 0xe0d8cc }, 'dirt');          // behind D
    this.courtyardGround();
    slab(ctx, -36, 14, -31, 32, -0.1, 0.15, [], 'dirt', undefined, { tint: 0xd8d0c4 }, 'dirt');          // sheds floor
    slab(ctx, 9, 22, 36, 36, -0.1, 0.15, [], 'sidewalk', undefined, { tint: 0xe8e4dc }, 'concrete');    // market lot
    slab(ctx, 23, 8, 36, 22, -0.1, 0.15, [], 'sidewalk', undefined, { tint: 0xe8e4dc }, 'concrete');    // east lot
    // road paint: centre dashes + crosswalks
    for (let z = -33; z < 34; z += 4) { if (Math.abs(z) < 8) continue; B.add('paint', prep(new THREE.PlaneGeometry(0.16, 2.2).rotateX(-Math.PI / 2).translate(0, 0.004, z), { uv: 'keep', alpha: 1 })); }
    for (const zc of [-6.6, 6.6]) for (let x = -5.6; x <= 5.6; x += 1.1) B.add('paint', prep(new THREE.PlaneGeometry(0.55, 2.0).rotateX(-Math.PI / 2).translate(x, 0.004, zc), { uv: 'keep' }));
  }

  /**
   * Courtyard floor.
   *
   * It used to be one flat box on one albedo. Sand outdoors is never uniform: it drifts up against every
   * vertical surface, it is scoured to hard packed dirt where people and vehicles cross, and it holds the
   * marks of both. This is a displaced surface (drift banks at the walls, ruts along the vehicle line,
   * hollows where the ground is scoured) with a hard-packed dirt base, sand drift patches over it, gravel
   * spill, damp shade under the north wall, and boot/tyre traffic between the three doorways.
   */
  private courtyardGround(): void {
    const ctx = this.ctx, B = this.batch, rng = this.rng;
    const x0 = -31, z0 = 14, x1 = -14, z1 = 32, top = 0.15;
    // drift profile: sand piles against the four walls, thickest in the sheltered SW corner
    const drift = (x: number, z: number) => {
      const dw = Math.min(x - x0, x1 - x), dz = Math.min(z - z0, z1 - z);
      const bank = (dd: number, amp: number) => amp * Math.exp(-Math.pow(Math.max(0, dd) / 1.35, 1.6));
      return bank(dw, 0.11) + bank(dz, 0.085) + bank(Math.hypot(x - x0, z - z1) - 0.5, 0.05);
    };
    // ruts: the vehicle line from the passage arch (x -19) down to the south storage gate
    const rut = (x: number, z: number) => {
      let r = 0;
      for (const off of [-0.85, 0.85]) { const dx = x - (-22.5 + off + 1.6 * Math.sin((z - z0) * 0.16)); r -= 0.035 * Math.exp(-Math.pow(dx / 0.45, 2)); }
      return r * THREE.MathUtils.smoothstep(z, 14.5, 17);
    };
    const hf = (x: number, z: number) => top
      + drift(x, z)
      + rut(x, z)
      - 0.028 * THREE.MathUtils.smoothstep(Math.hypot(x + 22, z - 23), 7, 1.5)   // scoured hollow in the middle
      + 0.030 * (fbm2(x * 0.9, z * 0.9) - 0.5)
      + 0.014 * (fbm2(x * 3.1, z * 3.1) - 0.5);
    const g = heightField(x0, z0, x1, z1, 0.5, hf, { tint: 0xf0e6d6, aoFn: (x, y, z) => 0.86 + 0.22 * THREE.MathUtils.smoothstep(y - top, -0.03, 0.09) + 0 * (x + z) });
    B.add('dirt', g);
    this.collideMesh(g, 'dirt');
    this.collideBox((x0 + x1) / 2, -0.4, (z0 + z1) / 2, x1 - x0, 0.6, z1 - z0, 'dirt'); // solid fill under the surface
    // sand drift laid over the packed dirt: light, warm, thickest along the walls
    for (let i = 0; i < 16; i++) {
      const edge = rng.int(0, 3);
      const px = edge === 0 ? rng.range(x0 + 1, x1 - 1) : edge === 1 ? rng.range(x0 + 1, x1 - 1) : edge === 2 ? x0 + rng.range(0.4, 1.8) : x1 - rng.range(0.4, 1.8);
      const pz = edge === 0 ? z0 + rng.range(0.4, 1.8) : edge === 1 ? z1 - rng.range(0.4, 1.8) : rng.range(z0 + 1, z1 - 1);
      const along = edge < 2 ? rng.range(1.4, 2.8) : rng.range(0.5, 1.1);
      const across = edge < 2 ? rng.range(0.5, 1.1) : rng.range(1.4, 2.8);
      B.add('gravelDecal', softPatch(px, hf(px, pz) + 0.008, pz, along, across, rng, { alpha: 0.6, tint: new THREE.Color().setHSL(0.1, 0.22, rng.range(0.56, 0.7)) }));
      P.sandRipple(ctx, px, pz, along * 2, across * 2, edge < 2 ? 0 : Math.PI / 2, hf(px, pz) + 0.012, rng.range(0.4, 0.75));
    }
    // three albedo zones over the packed base: bleached open sand, damp shaded dirt, and a scoured traffic lane
    for (let i = 0; i < 9; i++) {
      const px = rng.range(x0 + 2.5, x1 - 2.5), pz = rng.range(z0 + 2.5, z1 - 2.5);
      B.add('gravelDecal', softPatch(px, hf(px, pz) + 0.007, pz, rng.range(1.4, 3.0), rng.range(1.1, 2.6), rng, { alpha: rng.range(0.3, 0.55), tint: new THREE.Color().setHSL(0.1, rng.range(0.14, 0.26), rng.range(0.5, 0.72)) }));
    }
    for (const [px, pz, rx2, rz2] of [[-22.5, 20.5, 4.2, 2.6], [-26.5, 25.5, 3.2, 3.4], [-18.5, 27.0, 2.8, 2.6], [-28.0, 16.5, 2.4, 2.0]]) P.dirtPatch(ctx, px, pz, rx2, rz2, hf(px, pz) + 0.006, 0.55);
    // hard-packed, damp shade along the north wall; gravel spill by the sheds
    for (let i = 0; i < 5; i++) { const px = rng.range(x0 + 2, x1 - 2); P.dirtPatch(ctx, px, z0 + rng.range(0.8, 2.2), rng.range(1.8, 3.2), rng.range(0.9, 1.6), hf(px, z0 + 1.5) + 0.006, 0.6); }
    for (const [gx, gz] of [[-30.6, 18.5], [-30.6, 25.5], [-16.0, 20.0], [-16.0, 28.5], [-24.0, 15.2]]) P.gravelPatch(ctx, gx, gz, 1.5, 2.4, hf(gx, gz) + 0.009, 0.75);
    // traffic: boots between the arch, the well and the south gate; ruts where the drift shows the tyre line
    P.bootTrail(ctx, new THREE.Vector3(-19.0, 0, 14.6), new THREE.Vector3(-19.5, 0, 18.2), hf(-19.2, 16.4) + 0.006, 0.55, 0.7);
    P.bootTrail(ctx, new THREE.Vector3(-19.5, 0, 18.2), new THREE.Vector3(-24.4, 0, 24.2), hf(-22, 21) + 0.006, 0.55, 0.65);
    P.bootTrail(ctx, new THREE.Vector3(-24.4, 0, 24.2), new THREE.Vector3(-30.2, 0, 29.6), hf(-27, 27) + 0.006, 0.5, 0.6);
    P.bootTrail(ctx, new THREE.Vector3(-16.4, 0, 27.0), new THREE.Vector3(-20.6, 0, 22.4), hf(-18.5, 24.7) + 0.006, 0.5, 0.55);
    P.bootTrail(ctx, new THREE.Vector3(-14.8, 0, 17.8), new THREE.Vector3(-19.2, 0, 18.6), hf(-17, 18.2) + 0.006, 0.48, 0.5);
    for (const [tx, tz, ty, tl] of [[-22.6, 21, 0.1, 13], [-21.0, 22, 0.05, 12]]) P.tireTrack(ctx, tx, tz, ty, tl, hf(tx, tz) + 0.005);
  }

  // ------------------------------------------------------------------ facade damage helper
  private damageFn(blobs: [number, number, number, number][], top: number, base = 0.06) {
    // blobs: [x, y, z, r]; plus a top-edge band and a light base band
    return (x: number, y: number, z: number) => {
      let d = base;
      for (const [bx, by, bz, r] of blobs) { const dd = Math.hypot(x - bx, y - by, z - bz) / r; d += 0.85 * Math.exp(-dd * dd * 1.8); }
      d += 0.22 * THREE.MathUtils.smoothstep(y, top - 1.0, top + 0.3);
      d += 0.08 * (1 - THREE.MathUtils.smoothstep(y, 0.15, 0.9));
      return d;
    };
  }
  private win(u: number, y: number, w = 1.2, h = 1.4, state?: Opening['state']): Opening { return { u0: u - w / 2, u1: u + w / 2, y0: y, y1: y + h, kind: 'window', state }; }
  private door(u: number, y: number, w = 1.1, h = 2.15, state?: Opening['state']): Opening { return { u0: u - w / 2, u1: u + w / 2, y0: y, y1: y + h, kind: 'door', state }; }

  private balcony(axis: 'x' | 'z', u0: number, u1: number, faceV: number, out: 1 | -1, y: number, mat: string, tint: THREE.ColorRepresentation, depth = 1.35): void {
    const B = this.batch;
    const R = (ua: number, ub: number, va: number, vb: number, ya: number, yb: number, m: string, o: Parameters<typeof boxMM>[6] = {}, surf: SurfaceType = 'concrete') => {
      const v0 = Math.min(va, vb), v1 = Math.max(va, vb);
      const g = axis === 'z' ? boxMM(v0, ya, ua, v1, yb, ub, o) : boxMM(ua, ya, v0, ub, yb, v1, o);
      B.add(m, g);
      if (axis === 'z') this.collideBox((v0 + v1) / 2, (ya + yb) / 2, (ua + ub) / 2, v1 - v0, yb - ya, ub - ua, surf); else this.collideBox((ua + ub) / 2, (ya + yb) / 2, (v0 + v1) / 2, ub - ua, yb - ya, v1 - v0, surf);
    };
    const vo = faceV + out * depth;
    R(u0, u1, faceV, vo, y - 0.16, y, 'concrete', { tint: 0xc9c4b8 });
    R(u0, u1, vo - out * 0.12, vo, y, y + 0.95, mat, { tint, damage: 0.2 }, 'plaster');
    R(u0, u0 + 0.12, faceV, vo, y, y + 0.95, mat, { tint, damage: 0.2 }, 'plaster');
    R(u1 - 0.12, u1, faceV, vo, y, y + 0.95, mat, { tint, damage: 0.2 }, 'plaster');
    // coping + corbels
    B.add('concrete', axis === 'z' ? boxMM(Math.min(faceV, vo) - 0.03, y + 0.95, u0 - 0.03, Math.max(faceV, vo) + 0.03, y + 1.01, u1 + 0.03, { tint: 0xd2cdc2 }) : boxMM(u0 - 0.03, y + 0.95, Math.min(faceV, vo) - 0.03, u1 + 0.03, y + 1.01, Math.max(faceV, vo) + 0.03, { tint: 0xd2cdc2 }));
    for (const uc of [u0 + 0.35, u1 - 0.35]) {
      const g = axis === 'z' ? boxMM(Math.min(faceV, faceV + out * 0.5), y - 0.5, uc - 0.1, Math.max(faceV, faceV + out * 0.5), y - 0.16, uc + 0.1, { tint: 0xc0bbb0 }) : boxMM(uc - 0.1, y - 0.5, Math.min(faceV, faceV + out * 0.5), uc + 0.1, y - 0.16, Math.max(faceV, faceV + out * 0.5), { tint: 0xc0bbb0 });
      B.add('concrete', g);
    }
  }

  private bulkhead(x0: number, z0: number, x1: number, z1: number, y: number, doorSide: 'n' | 's' | 'e' | 'w', doorU: number, mat: string, tint: THREE.ColorRepresentation): void {
    const ctx = this.ctx, h = 2.45;
    const d = (side: 'n' | 's' | 'e' | 'w'): Opening[] => side === doorSide ? [this.door(doorU, y, 1.1, 2.1, 'missing')] : [];
    wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z0, b1: z0 + T, y0: y, y1: y + h, out: -1, openings: d('n'), mat, tint, damage: 0.2, details: true });
    wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z1 - T, b1: z1, y0: y, y1: y + h, out: 1, openings: d('s'), mat, tint, damage: 0.2 });
    wall(ctx, { axis: 'z', u0: z0 + T, u1: z1 - T, b0: x0, b1: x0 + T, y0: y, y1: y + h, out: -1, openings: d('w'), mat, tint, damage: 0.2 });
    wall(ctx, { axis: 'z', u0: z0 + T, u1: z1 - T, b0: x1 - T, b1: x1, y0: y, y1: y + h, out: 1, openings: d('e'), mat, tint, damage: 0.2 });
    slab(ctx, x0 - 0.1, z0 - 0.1, x1 + 0.1, z1 + 0.1, y + h, y + h + 0.18, [], 'concrete', undefined, { tint: 0xb9b4a8 });
  }

  // ------------------------------------------------------------------ Building A: corner pharmacy, 3 floors, roof access
  private buildingA(): void {
    const ctx = this.ctx, B = this.batch;
    const x0 = -23, z0 = -24, x1 = -9, z1 = -8, base = 0.15, floors = 3;
    const mat = 'plasterA', tint = 0xe6ddd0, inMat = 'interior', inTint = 0xd8cfc4;
    const top = base + floors * FH;
    const f1 = base + FH, f2 = base + 2 * FH;
    const frameTint = 0x2f5a5a;
    // base slab
    slab(ctx, x0, z0, x1, z1, -0.1, base - 0.02, [], 'concrete', 'floorInt', { tint: 0xd9d4ca });
    // east facade (main street)
    const eastOpen: Opening[] = [
      { u0: -15.4, u1: -11.2, y0: base, y1: base + 2.85, kind: 'shop', state: 'open', sign: 0 },
      this.door(-19.1, base, 1.1, 2.15, 'open'), this.win(-22, base + 1.1, 1.2, 1.3, 'boarded'),
      this.win(-22, f1 + 0.95), this.win(-19.2, f1 + 0.95, 1.2, 1.4, 'glass'), this.win(-16.4, f1 + 0.95, 1.2, 1.4, 'broken'),
      { u0: -14.1, u1: -13.1, y0: f1, y1: f1 + 2.15, kind: 'door', state: 'open' }, this.win(-10.8, f1 + 0.95, 1.2, 1.4, 'broken'),
      this.win(-22, f2 + 0.95, 1.2, 1.4, 'glass'), this.win(-19.2, f2 + 0.95), this.win(-16.4, f2 + 0.95, 1.2, 1.4, 'shutter'), this.win(-13.6, f2 + 0.95, 1.2, 1.4, 'broken'), this.win(-10.8, f2 + 0.95, 1.2, 1.4, 'glass'),
    ];
    wall(ctx, { axis: 'z', u0: z0, u1: z1, b0: x1 - T, b1: x1, y0: base, y1: top, out: 1, openings: eastOpen, mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, courses: [f1 - 0.2, f2 - 0.2], damageFn: this.damageFn([[-9, 5.2, -10.5, 1.6], [-9, 2.2, -17.5, 1.3], [-9, 8.6, -20, 1.4]], top) });
    this.balcony('z', -14.6, -12.1, x1, 1, f1, mat, tint);
    // south facade (cross street)
    const southOpen: Opening[] = [
      { u0: -21.8, u1: -18.2, y0: base, y1: base + 2.85, kind: 'shop', state: 'halfShutter', sign: 1 },
      this.door(-14.7, base, 1.1, 2.15, 'open'), this.win(-12.2, base + 1.1, 1.2, 1.3, 'broken'), this.win(-16.6, base + 1.1, 1.0, 1.3, 'boarded'),
      ...[-21.5, -18.7, -15.9, -13.1, -10.3].map((u) => this.win(u, f1 + 0.95)),
      ...[-21.5, -18.7, -15.9, -13.1, -10.3].map((u) => this.win(u, f2 + 0.95)),
    ];
    wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z1 - T, b1: z1, y0: base, y1: top, out: 1, openings: southOpen, mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, courses: [f1 - 0.2, f2 - 0.2], damageFn: this.damageFn([[-11.5, 4.8, -8, 1.8], [-19.5, 7.5, -8, 1.2]], top) });
    // west facade (alley)
    wall(ctx, { axis: 'z', u0: z0, u1: z1, b0: x0, b1: x0 + T, y0: base, y1: top, out: -1, openings: [this.door(-13, base, 1.1, 2.15, 'open'), this.win(-18, base + 1.2, 0.9, 1.1, 'boarded'), ...[-21, -17.5, -14, -10.5].map((u) => this.win(u, f1 + 0.95, 1.1, 1.3)), ...[-21, -17.5, -14, -10.5].map((u) => this.win(u, f2 + 0.95, 1.1, 1.3))], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, damageFn: this.damageFn([[-23, 3.0, -15, 1.5]], top, 0.12) });
    // north facade (back lot)
    wall(ctx, { axis: 'x', u0: x0, u1: x1 - T, b0: z0, b1: z0 + T, y0: base, y1: top, out: -1, openings: [this.door(-16.9, base, 1.1, 2.15, 'open'), this.win(-12, base + 1.2, 1.0, 1.2, 'shutter'), ...[-20.5, -17, -13.5, -10.5].map((u) => this.win(u, f1 + 0.95, 1.1, 1.3)), ...[-20.5, -17, -13.5, -10.5].map((u) => this.win(u, f2 + 0.95, 1.1, 1.3))], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, damageFn: this.damageFn([[-14, 6.5, -24, 1.6]], top, 0.1) });
    // interior partitions (all floors) + stair enclosure
    const sx0 = x0 + T, sz0 = z0 + T; // stairwell corner (nw)
    const stairRect = { x0: sx0, z0: sz0, x1: sx0 + STAIR_W, z1: sz0 + STAIR_D };
    const levels = [base, f1, f2];
    levels.forEach((y, i) => {
      const yt = y + FH - SLAB;
      wall(ctx, { axis: 'z', u0: z0 + T, u1: z1 - T, b0: -16.08, b1: -15.92, y0: y, y1: yt, out: 1, openings: i < 2 ? [this.door(-11.4, y, 1.0, 2.1, 'missing'), this.door(-19.4, y, 1.0, 2.1, i === 0 ? 'open' : 'missing')] : [this.door(-14, y, 1.0, 2.1, 'missing'), { u0: -21, u1: -18, y0: y + 0.9, y1: y + 2.4, kind: 'hole' }], mat: inMat, tint: 0xcfc3b6, damage: 0.12, surface: 'plaster', frameTint: 0x5a4a3a });
      if (i < 2) wall(ctx, { axis: 'x', u0: -16, u1: x1 - T, b0: -16.08, b1: -15.92, y0: y, y1: yt, out: 1, openings: [this.door(-12.9, y, 1.0, 2.1, 'missing')], mat: inMat, tint: 0xd6cabb, damage: 0.15, surface: 'plaster', frameTint: 0x5a4a3a });
      // stair enclosure: east side + south side with door
      wall(ctx, { axis: 'z', u0: sz0, u1: stairRect.z1, b0: stairRect.x1, b1: stairRect.x1 + 0.16, y0: y, y1: yt, out: 1, openings: [], mat: inMat, tint: 0xcfc3b6, damage: 0.1, surface: 'plaster', details: false });
      wall(ctx, { axis: 'x', u0: sx0, u1: stairRect.x1 + 0.16, b0: stairRect.z1, b1: stairRect.z1 + 0.16, y0: y, y1: yt, out: 1, openings: [this.door(sx0 + 1.95, y, 1.05, 2.1, 'missing')], mat: inMat, tint: 0xcfc3b6, damage: 0.1, surface: 'plaster', frameTint: 0x5a4a3a });
      stairsU(ctx, sx0, stairRect.z1, -1, y, 'concrete', 0xc4bfb4);
    });
    // slabs: floor 1 has a shell hole over the pharmacy
    const hole = { x0: -13.6, z0: -14.2, x1: -11.2, z1: -12.0 };
    slab(ctx, x0 + T, z0 + T, x1 - T, z1 - T, f1 - SLAB, f1, [stairRect, hole], 'concrete', 'floorInt', { tint: 0xcdc8be });
    slab(ctx, x0 + T, z0 + T, x1 - T, z1 - T, f2 - SLAB, f2, [stairRect], 'concrete', 'floorInt', { tint: 0xcdc8be });
    slab(ctx, x0, z0, x1, z1, top - SLAB, top, [stairRect], 'concrete', undefined, { tint: 0xa9a49a });
    // hole edge rebar + debris underneath
    for (let i = 0; i < 10; i++) {
      const t = i / 10, onX = i % 2 === 0;
      const px = onX ? THREE.MathUtils.lerp(hole.x0, hole.x1, t) : (i % 4 === 1 ? hole.x0 : hole.x1), pz = onX ? (i % 4 === 0 ? hole.z0 : hole.z1) : THREE.MathUtils.lerp(hole.z0, hole.z1, t);
      P.rebar(ctx, px, f1 - 0.12, pz, new THREE.Vector3((-12.4 - px), -0.6, (-13.1 - pz)), 0.9);
    }
    // Round 3: "the ceiling hole is a razor-clean rectangular cut with no broken concrete, no spall". Hang
    // fractured lumps off the rim, biting into the opening, so the edge reads as concrete that failed rather
    // than as a rectangle subtracted from a slab.
    for (let i = 0; i < 14; i++) {
      const t = (i + 0.5) / 14, side = i % 4;
      const px = side < 2 ? THREE.MathUtils.lerp(hole.x0, hole.x1, t) : (side === 2 ? hole.x0 : hole.x1);
      const pz = side < 2 ? (side === 0 ? hole.z0 : hole.z1) : THREE.MathUtils.lerp(hole.z0, hole.z1, t);
      const inward = new THREE.Vector3(-12.4 - px, 0, -13.1 - pz).normalize().multiplyScalar(this.rng.range(0.02, 0.16));
      const sc = this.rng.range(0.28, 0.55);
      const g2 = chunkGeo(this.rng.next() < 0.55 ? 'wedge' : 'shard', this.rng, 40 + i * 5);
      g2.scale(sc, sc * this.rng.range(0.5, 0.9), sc);
      this.batch.add('debris', place(g2, px + inward.x, f1 - SLAB - this.rng.range(0.0, 0.06), pz + inward.z, { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(this.rng.range(-0.6, 0.6), this.rng.range(0, 6), this.rng.range(-0.6, 0.6))), keepColor: true, tint: 0xc8c2b6 }));
    }
    P.debrisField(ctx, -12.4, -13.1, 1.6, 1.4, 40, base, { paper: true });
    B.add('rubble', heightField(-14.2, -14.9, -10.6, -11.3, 0.3, (x, z) => { const d = Math.hypot(x + 12.4, z + 13.1); return base + Math.max(0, 0.45 * (1 - d / 1.7)) * (0.7 + 0.5 * fbm2(x * 2, z * 2)); }, { tint: 0xb9b2a6 }));
    // roof: parapet, bulkhead over the stair, tanks, AC, sandbags at the SE corner
    parapet(ctx, x0, z0, x1, z1, top, 0.9, 0.3, mat, { tint });
    this.bulkhead(x0 + T, z0 + T, stairRect.x1 + 0.4, stairRect.z1 + 0.3, top, 's', sx0 + 1.95, mat, tint);
    P.waterTank(ctx, -12, top, -21); P.waterTank(ctx, -13.6, top, -21.4);
    P.satelliteDish(ctx, -10, top, -18, 2.4); P.ventPipe(ctx, -17, top, -14, 1.0); P.ventPipe(ctx, -17.6, top, -13.2, 0.7);
    // roof plant: AC condensers on frames, duct run to the bulkhead, cable tray, dish cluster
    P.acUnit(ctx, -11.2, top + 0.42, -13.8, 0.3); P.acUnit(ctx, -12.1, top + 0.42, -13.6, 0.3); P.acUnit(ctx, -13.0, top + 0.42, -13.4, 0.25);
    for (const dx of [-11.2, -12.1, -13.0]) for (const dz of [-14.1, -13.1]) B.add('darkMetal', box(dx, top + 0.07, dz, 0.7, 0.14, 0.08, { tint: 0x4a4a48 }));
    P.duct(ctx, new THREE.Vector3(-10.6, top + 0.9, -12.6), new THREE.Vector3(-19.6, top + 0.9, -12.2), 0.22);
    P.duct(ctx, new THREE.Vector3(-19.6, top + 0.9, -12.2), new THREE.Vector3(-19.9, top + 1.3, -19.0), 0.18);
    P.satelliteDish(ctx, -15.4, top, -10.2, 1.1); P.satelliteDish(ctx, -16.4, top, -10.6, 0.6);
    P.ventPipe(ctx, -21.2, top, -10.4, 1.3); P.ventPipe(ctx, -20.5, top, -10.9, 0.6);
    P.laundryLine(ctx, new THREE.Vector3(-21.6, top + 1.7, -14.5), new THREE.Vector3(-21.6, top + 1.5, -19.5), 4);
    P.ammoCrate(ctx, -10.8, top, -10.4, 0.4); P.ammoCrate(ctx, -10.8, top + 0.33, -10.4, 0.9);
    P.sandbagWall(ctx, new THREE.Vector3(-12.5, top, -9.0), new THREE.Vector3(-9.6, top, -9.0), 3);
    P.sandbagWall(ctx, new THREE.Vector3(-9.7, top, -9.3), new THREE.Vector3(-9.7, top, -12.5), 3);
    P.crate(ctx, -15, top, -10, 0.4, 0.7); P.crate(ctx, -15.6, top, -10.9, 0.9, 0.55);
    // (was a raw box on the default fabric material — it shipped into render_dusk as a white untextured cuboid)
    P.mattress(ctx, -19, top, -12, 0.3, 0x5e5449);
    P.crate(ctx, -18.2, top, -12.9, 1.1, 0.5);
    // facade props: AC units, awning over the pharmacy, pocks
    P.acUnit(ctx, -8.82, 4.9, -17.2, -Math.PI / 2); P.acUnit(ctx, -8.82, 8.2, -12.4, -Math.PI / 2); P.acUnit(ctx, -23.18, 5.0, -16, Math.PI / 2);
    P.awning(ctx, 'z', -13.3, 4.2, x1, 1, base + 3.2, 1.5, true);
    for (const z of [-21.0, -20.3, -17.6, -16.4, -15.9, -10.4, -9.9, -17.9, -20.8]) P.pocks(ctx, new THREE.Vector3(x1, this.rng.range(0.7, 3.2), z), new THREE.Vector3(1, 0, 0), this.rng.range(0.5, 0.9));
    for (const x of [-22.6, -17.7, -16.2, -15.6, -13.8, -13.3, -10.4, -9.6]) P.pocks(ctx, new THREE.Vector3(x, this.rng.range(0.7, 3.0), z1), new THREE.Vector3(0, 0, 1), this.rng.range(0.5, 0.9));
    for (const z of [-15.2, -14.4, -13.2, -9.6, -10.2]) P.pocks(ctx, new THREE.Vector3(-15.92, this.rng.range(0.7, 2.2), z), new THREE.Vector3(1, 0, 0), 0.7);
    // interior dressing: pharmacy counter + goods shelving + toppled stock + wires from the shell hole
    B.add('wood', box(-12.6, base + 0.5, -10.2, 2.6, 1.0, 0.65, { tint: 0x9a7f5e, segs: [3, 3, 1], aoFn: (_x, y) => 0.7 + 0.3 * THREE.MathUtils.smoothstep(y - base, 0, 0.6) })); this.collideBox(-12.6, base + 0.5, -10.2, 2.6, 1.0, 0.65, 'wood');
    B.add('wood', box(-12.6, base + 1.02, -10.2, 2.7, 0.04, 0.75, { tint: 0x6b5238 }));
    for (const x of [-15.3, -14.1, -12.9]) P.shelfUnit(ctx, x, base, -15.55, 0);
    P.shelfUnit(ctx, -10.4, base, -12.6, -Math.PI / 2);
    P.shelfUnit(ctx, -15.4, base, -9.0, Math.PI, 0.0);
    // toppled shelf on the floor, its goods spilled
    B.add('wood', box(-10.6, base + 0.2, -14.6, 1.1, 0.38, 2.0, { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0, 0.3, 0.05)), tint: 0x7d6549 }));
    this.collideBox(-10.6, base + 0.2, -14.6, 1.1, 0.38, 2.0, 'wood', 0.3);
    P.table(ctx, -13.4, base, -12.2, 0.35, 1.3, 0.75); P.chair(ctx, -14.3, base, -11.5, 1.1); P.chair(ctx, -12.4, base, -12.9, -0.6, true);
    P.debrisPile(ctx, -12.4, base, -13.4, 1.5, 0.38);
    P.mattress(ctx, -15.2, base, -11.4, 0.35, 0x8a7a68);
    for (const [wx, wz] of [[-12.6, -13.4], [-11.6, -12.6], [-13.3, -12.9]]) P.hangingWire(ctx, wx, f1 - 0.3, wz, 1.5, wx < -12.5);
    P.hangingWire(ctx, -14.6, f1 - 0.28, -10.2, 1.2, true);
    P.crate(ctx, -20.5, base, -10, 0.2, 0.7); P.crate(ctx, -19.6, base, -10.3, 1.1, 0.5); P.crate(ctx, -20.2, base + 0.7, -10.1, 0.6, 0.5);
    P.pallet(ctx, -21.5, base, -13.5, 0.1); P.drum(ctx, -17.2, -14.8, 0.4, false, base); P.drum(ctx, -17.9, -14.3, 1.1, true, base);
    P.shelfUnit(ctx, -21.9, base, -19.2, Math.PI / 2, 0.12); P.table(ctx, -19.5, base, -17.5, 1.0); P.chair(ctx, -18.6, base, -18.4, 0.4, true);
    P.debrisPile(ctx, -21.4, base, -15.6, 1.3, 0.32); P.ammoCrate(ctx, -19.9, base, -20.8, 0.8); P.ammoCrate(ctx, -19.9, base + 0.33, -20.8, 1.1);
    B.add('fabric', box(-13.5, base + 0.02, -12.5, 2.2, 0.03, 1.5, { rotY: 0.15, tint: 0x7a3a30 })); // rug
    P.debrisField(ctx, -19, -19, 2.5, 3.5, 18, base, { bricks: false });
    // floor 1: a sandbag nest at the balcony door + mattress + table
    P.sandbagWall(ctx, new THREE.Vector3(-13.9, f1, -12.9), new THREE.Vector3(-11.9, f1, -12.9), 3);
    P.mattress(ctx, -20, f1, -20, 1.2, 0x6a7a80);
    P.table(ctx, -12, f1, -20, 0.2); P.chair(ctx, -12.9, f1, -19.3, 0.6); P.chair(ctx, -11.1, f1, -20.8, -2.4, true);
    P.shelfUnit(ctx, -21.6, f1, -12.4, Math.PI / 2); P.shelfUnit(ctx, -15.6, f1, -9.0, Math.PI, -0.1);
    P.debrisPile(ctx, -17.5, f1, -13.5, 1.6, 0.34);
    for (const [wx, wz] of [[-16.5, -11.2], [-19.4, -18.2]]) P.hangingWire(ctx, wx, f2 - 0.3, wz, 1.4, true);
    P.mattress(ctx, -13.2, f2, -21.2, 0.4, 0x7a7268); P.shelfUnit(ctx, -21.8, f2, -18.4, Math.PI / 2, 0.2);
    P.debrisPile(ctx, -12.8, f2, -14.8, 1.7, 0.4); P.table(ctx, -18.5, f2, -11.5, 2.4);
    P.crate(ctx, -10.5, f1, -22.5, 0.3, 0.6); P.debrisField(ctx, -14, -16, 4, 3, 40, f1, { bricks: true });
    P.debrisField(ctx, -14, -12, 3, 3, 30, f2, { bricks: true });
  }

  // ------------------------------------------------------------------ Building E: workshop/garage, 2 floors, balcony over the intersection
  private buildingE(): void {
    const ctx = this.ctx, B = this.batch;
    const x0 = 9, z0 = 8, x1 = 23, z1 = 22, base = 0.15, floors = 2;
    const mat = 'plasterB', tint = 0xd9cdb8, inMat = 'interiorGreen', inTint = 0xc9c4b4;
    const top = base + floors * FH, f1 = base + FH;
    const frameTint = 0x6b4a2b;
    slab(ctx, x0, z0, x1, z1, -0.1, base - 0.02, [], 'concrete', 'floorInt', { tint: 0xc9c4ba });
    // west facade (main street): garage shutter open + door; floor 1 balcony at the NW corner
    wall(ctx, { axis: 'z', u0: z0, u1: z1, b0: x0, b1: x0 + T, y0: base, y1: top, out: -1, openings: [
      { u0: 10.6, u1: 14.6, y0: base, y1: base + 3.0, kind: 'shop', state: 'open', sign: 5 }, this.door(18.2, base, 1.1, 2.15, 'open'), this.win(20.6, base + 1.1, 1.2, 1.3, 'shutter'),
      { u0: 10.4, u1: 11.4, y0: f1, y1: f1 + 2.15, kind: 'door', state: 'open' }, this.win(14.2, f1 + 0.95, 1.2, 1.4, 'broken'), this.win(17, f1 + 0.95), this.win(19.8, f1 + 0.95, 1.2, 1.4, 'glass'),
    ], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, courses: [f1 - 0.2], damageFn: this.damageFn([[9, 4.8, 15.5, 1.7], [9, 1.6, 16.5, 1.1]], top) });
    this.balcony('z', 9.5, 12.5, x0, -1, f1, mat, tint);
    // north facade (cross street)
    wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z0, b1: z0 + T, y0: base, y1: top, out: -1, openings: [
      { u0: 12.2, u1: 15.6, y0: base, y1: base + 2.85, kind: 'shop', state: 'halfShutter', sign: 2 }, this.win(18.4, base + 1.1, 1.2, 1.3, 'boarded'), this.door(21.1, base, 1.1, 2.15, 'open'),
      ...[11, 13.8, 16.6, 19.4, 21.8].map((u) => this.win(u, f1 + 0.95)),
    ], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, courses: [f1 - 0.2], damageFn: this.damageFn([[19, 4.9, 8, 1.5], [12, 6.3, 8, 1.1]], top) });
    P.awning(ctx, 'x', 13.9, 3.8, z0, -1, base + 3.1, 1.4, false);
    // east + south facades (lot side)
    wall(ctx, { axis: 'z', u0: z0 + T, u1: z1 - T, b0: x1 - T, b1: x1, y0: base, y1: top, out: 1, openings: [this.door(14.6, base, 1.1, 2.15, 'open'), this.win(11, base + 1.2, 1.0, 1.2, 'boarded'), this.win(18.5, base + 1.2, 1.0, 1.2), ...[10.5, 13.5, 16.5, 19.5].map((u) => this.win(u, f1 + 0.95, 1.1, 1.3))], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, damageFn: this.damageFn([[23, 3.4, 17, 1.3]], top, 0.1) });
    wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z1 - T, b1: z1, y0: base, y1: top, out: 1, openings: [this.door(12.5, base, 1.1, 2.15, 'open'), this.win(16, base + 1.2, 1.0, 1.2, 'shutter'), ...[11, 14.5, 18, 21].map((u) => this.win(u, f1 + 0.95, 1.1, 1.3))], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, damageFn: this.damageFn([[15, 5.5, 22, 1.5]], top, 0.1) });
    // interior: garage room (x 9.35..16, z 8.35..15) + stair enclosure (se corner)
    const sx0 = x1 - T - STAIR_W, sz0 = z1 - T - STAIR_D; const stairRect = { x0: sx0, z0: sz0, x1: sx0 + STAIR_W, z1: sz0 + STAIR_D };
    for (const [i, y] of [base, f1].entries()) {
      const yt = y + FH - SLAB;
      wall(ctx, { axis: 'x', u0: x0 + T, u1: x1 - T, b0: 14.92, b1: 15.08, y0: y, y1: yt, out: 1, openings: [this.door(12, y, 1.0, 2.1, 'missing'), this.door(18.6, y, 1.0, 2.1, i === 0 ? 'open' : 'missing')], mat: inMat, tint: 0xc2c0b0, damage: 0.15, surface: 'plaster', frameTint: 0x3a3a3a });
      wall(ctx, { axis: 'z', u0: z0 + T, u1: 14.92, b0: 15.92, b1: 16.08, y0: y, y1: yt, out: 1, openings: [this.door(11.5, y, 1.0, 2.1, 'missing')], mat: inMat, tint: 0xc2c0b0, damage: 0.15, surface: 'plaster', frameTint: 0x3a3a3a });
      wall(ctx, { axis: 'z', u0: sz0, u1: stairRect.z1, b0: sx0 - 0.16, b1: sx0, y0: y, y1: yt, out: -1, openings: [], mat: inMat, tint: 0xc2c0b0, damage: 0.1, surface: 'plaster', details: false });
      wall(ctx, { axis: 'x', u0: sx0 - 0.16, u1: stairRect.x1, b0: sz0 - 0.16, b1: sz0, y0: y, y1: yt, out: -1, openings: [this.door(sx0 + 1.95, y, 1.05, 2.1, 'missing')], mat: inMat, tint: 0xc2c0b0, damage: 0.1, surface: 'plaster', frameTint: 0x3a3a3a });
      stairsU(ctx, sx0, sz0, 1, y, 'concrete', 0xc4bfb4);
    }
    slab(ctx, x0 + T, z0 + T, x1 - T, z1 - T, f1 - SLAB, f1, [stairRect], 'concrete', 'floorInt', { tint: 0xc4bfb5 });
    slab(ctx, x0, z0, x1, z1, top - SLAB, top, [stairRect], 'concrete', undefined, { tint: 0xa9a49a });
    parapet(ctx, x0, z0, x1, z1, top, 0.85, 0.3, mat, { tint });
    this.bulkhead(sx0 - 0.4, sz0 - 0.3, x1 - T, z1 - T, top, 'n', sx0 + 1.95, mat, tint);
    P.waterTank(ctx, 12, top, 19); P.waterTank(ctx, 13.6, top, 19.6); P.acUnit(ctx, 14, top + 0.35, 10.2, 0.4); P.crate(ctx, 11, top, 12, 0.3, 0.6); P.tireStack(ctx, 16, 17, 2); P.debrisField(ctx, 16, 14, 5, 4, 16, top, { bricks: true, chunkScale: 0.6 }); P.ventPipe(ctx, 19.5, top, 15, 0.7); P.acUnit(ctx, 9.18, 5.2, 16, Math.PI / 2); P.acUnit(ctx, 15.5, 5.0, 8.18, 0); P.satelliteDish(ctx, 20, top, 10, -2.2); P.ventPipe(ctx, 17, top, 12, 1.1);
    P.sandbagWall(ctx, new THREE.Vector3(9.4, top, 9.6), new THREE.Vector3(9.4, top, 13.2), 3);
    // garage dressing
    P.car(ctx, 12.6, 11.6, Math.PI / 2 + 0.1, false, 0x6a7a8a, 0, base);
    P.tireStack(ctx, 15.2, 9.6, 4); P.tireStack(ctx, 15.8, 10.4, 2); P.drum(ctx, 10.3, 14.3, 0.3); P.drum(ctx, 11.1, 14.5, 1.3);
    B.add('wood', box(13.5, base + 0.86, 14.4, 2.4, 0.08, 0.7, { tint: 0x7d6549 })); for (const dx of [-1.1, 1.1]) B.add('darkMetal', box(13.5 + dx, base + 0.42, 14.4, 0.08, 0.84, 0.6, { tint: 0x333 }));
    this.collideBox(13.5, base + 0.45, 14.4, 2.4, 0.9, 0.7, 'wood');
    P.shelfUnit(ctx, 9.8, base, 12.0, Math.PI / 2); P.shelfUnit(ctx, 9.8, base, 13.2, Math.PI / 2, 0.05);
    P.ammoCrate(ctx, 11.6, base, 9.4, 0.4); P.ammoCrate(ctx, 12.2, base, 9.5, 1.1, true); P.ammoCrate(ctx, 11.9, base + 0.33, 9.45, 0.7);
    P.debrisPile(ctx, 14.5, base, 12.6, 1.4, 0.3);
    for (const [wx, wz] of [[12.5, 11.0], [16.0, 13.4], [19.0, 10.5]]) P.hangingWire(ctx, wx, f1 - 0.3, wz, 1.5, wx > 15);
    P.mattress(ctx, 21.0, f1, 10.5, 0.3, 0x6a6a5a); P.shelfUnit(ctx, 21.6, f1, 13.5, -Math.PI / 2); P.table(ctx, 18.5, f1, 12.0, 1.4);
    P.chair(ctx, 17.6, f1, 11.2, 0.9); P.debrisPile(ctx, 12.5, f1, 17.5, 1.8, 0.36); P.scaffold(ctx, 10.2, 17.0, -Math.PI / 2, 1, 1, base);
    P.pallet(ctx, 20, base, 11, 0.2); P.pallet(ctx, 20, base + 0.15, 11, 0.3); P.crate(ctx, 21.5, base, 12.5, 0.5, 0.65);
    P.debrisField(ctx, 13, 12, 3, 3, 25, base, { bricks: false });
    for (const z of [9.6, 10.1, 15.2, 16.4, 16.9, 19.6, 21.4]) P.pocks(ctx, new THREE.Vector3(9, this.rng.range(0.7, 3.0), z), new THREE.Vector3(-1, 0, 0), this.rng.range(0.5, 0.9));
    for (const x of [10.4, 11.2, 16.4, 17.2, 19.8, 22.4, 16.8]) P.pocks(ctx, new THREE.Vector3(x, this.rng.range(0.7, 3.0), 8), new THREE.Vector3(0, 0, -1), this.rng.range(0.5, 0.9));
  }

  // ------------------------------------------------------------------ Building C: shelled 3-storey block, SW corner collapsed into a rubble slope
  private buildingC(): void {
    const ctx = this.ctx, B = this.batch, rng = this.rng;
    const x0 = 9, z0 = -24, x1 = 23, z1 = -8, base = 0.15, floors = 3;
    const mat = 'plasterC', tint = 0xe2ddd4, inMat = 'interior', inTint = 0xcfc6ba;
    const top = base + floors * FH, f1 = base + FH, f2 = base + 2 * FH;
    const frameTint = 0x3b5a7a;
    slab(ctx, x0, z0, x1, z1, -0.1, base - 0.02, [], 'concrete', 'floorInt', { tint: 0xbdb8ae });
    // north facade intact
    wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z0, b1: z0 + T, y0: base, y1: top, out: -1, openings: [this.door(12, base, 1.1, 2.15, 'open'), this.win(16, base + 1.2, 1.2, 1.3, 'boarded'), this.win(20, base + 1.2, 1.2, 1.3), ...[11, 14.2, 17.4, 20.6].flatMap((u) => [this.win(u, f1 + 0.95), this.win(u, f2 + 0.95)])], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, courses: [f1 - 0.2, f2 - 0.2], damageFn: this.damageFn([[15, 7, -24, 1.6]], top, 0.12) });
    // east facade: intact to z=-13, then broken down toward the corner
    wall(ctx, { axis: 'z', u0: z0 + T, u1: -13, b0: x1 - T, b1: x1, y0: base, y1: top, out: 1, openings: [this.door(-20, base, 1.1, 2.15, 'open'), this.win(-16, base + 1.2, 1.2, 1.3, 'shutter'), ...[-21.5, -18.5, -15.5].flatMap((u) => [this.win(u, f1 + 0.95), this.win(u, f2 + 0.95)])], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, courses: [f1 - 0.2, f2 - 0.2], damageFn: this.damageFn([[23, 8.5, -13.5, 2.4], [23, 3, -14, 1.6]], top, 0.15) });
    brokenWall(ctx, x1 - T / 2, -13, x1 - T / 2, z1, T, base, (t) => THREE.MathUtils.lerp(9.2, 2.6, t) + 0.6 * Math.sin(t * 9), mat, { tint });
    // west facade (main street): intact rear, broken front
    wall(ctx, { axis: 'z', u0: z0 + T, u1: -16, b0: x0, b1: x0 + T, y0: base, y1: top, out: -1, openings: [this.door(-20.2, base, 1.1, 2.15, 'open'), this.win(-22.5, base + 1.2, 1.0, 1.2, 'boarded'), this.win(-17.6, base + 1.2, 1.2, 1.3, 'broken'), ...[-22, -19, -17].flatMap((u) => [this.win(u, f1 + 0.95, 1.1, 1.4), this.win(u, f2 + 0.95, 1.1, 1.4)])], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, courses: [f1 - 0.2, f2 - 0.2], damageFn: this.damageFn([[9, 6.5, -16.5, 2.6], [9, 2.6, -18.5, 1.4]], top, 0.2) });
    brokenWall(ctx, x0 + T / 2, -16, x0 + T / 2, z1, T, base, (t) => THREE.MathUtils.lerp(5.8, 1.0, t) + 0.5 * Math.sin(t * 11), mat, { tint });
    // south (intersection) facade: low broken stub with a gap
    brokenWall(ctx, x0, z1 - T / 2, x1, z1 - T / 2, T, base, (t) => (t < 0.28 ? 1.6 - t * 2 : t < 0.62 ? 0.25 : 0.7 + (t - 0.62) * 2.6), mat, { tint });
    // interior partition at z=-16 (rear rooms intact); blown out on floor 1
    for (const [i, y] of [base, f1, f2].entries()) {
      const yt = y + FH - SLAB;
      wall(ctx, { axis: 'x', u0: x0 + T, u1: x1 - T, b0: -16.2, b1: -15.85, y0: y, y1: yt, out: 1, openings: i === 1 ? [{ u0: 13.5, u1: 19.5, y0: y, y1: y + 2.4, kind: 'hole' }, this.door(11.2, y, 1.0, 2.1, 'missing')] : [this.door(12.2, y, 1.0, 2.1, 'missing'), this.win(17.5, y + 1.0, 1.2, 1.2, i === 0 ? 'broken' : 'none')], mat: i === 0 ? inMat : mat, tint: i === 0 ? 0xcfc6ba : tint, damage: 0.3, surface: 'plaster', damageFn: (x, yy) => 0.25 + 0.7 * THREE.MathUtils.smoothstep(yy, yt - 1.5, yt) + (i === 1 ? 0.8 * Math.exp(-Math.pow((x - 16.5) / 3.5, 2)) : 0) });
    }
    // stair (ne corner) to floors 1, 2 and roof
    const sx0 = x1 - T - STAIR_W, sz0 = z0 + T; const stairRect = { x0: sx0, z0: sz0, x1: sx0 + STAIR_W, z1: sz0 + STAIR_D };
    for (const y of [base, f1, f2]) {
      const yt = y + FH - SLAB;
      wall(ctx, { axis: 'z', u0: sz0, u1: stairRect.z1, b0: sx0 - 0.16, b1: sx0, y0: y, y1: yt, out: -1, openings: [], mat: inMat, tint: inTint, damage: 0.15, surface: 'plaster', details: false });
      wall(ctx, { axis: 'x', u0: sx0 - 0.16, u1: stairRect.x1, b0: stairRect.z1, b1: stairRect.z1 + 0.16, y0: y, y1: yt, out: 1, openings: [this.door(sx0 + 1.95, y, 1.05, 2.1, 'missing')], mat: inMat, tint: inTint, damage: 0.15, surface: 'plaster', frameTint: 0x3a3a3a });
      stairsU(ctx, sx0, stairRect.z1, -1, y, 'concrete', 0xbcb7ac);
    }
    // slabs: floor 1 intact rear; floor 2 / roof retreat with jagged edges
    slab(ctx, x0 + T, z0 + T, x1 - T, -16, f1 - SLAB, f1, [stairRect], 'concrete', 'floorInt', { tint: 0xc4bfb5 });
    const jaggedSlab = (y: number, zEnd: number, hasRoofFinish: boolean) => {
      const strips = 12; const w = (x1 - x0 - 2 * T) / strips;
      for (let i = 0; i < strips; i++) {
        const xa = x0 + T + i * w, xb = xa + w;
        const ze = zEnd + rng.range(-0.9, 0.6);
        slab(ctx, xa, z0 + T, xb, ze, y - SLAB, y, [stairRect], 'concrete', hasRoofFinish ? undefined : 'floorInt', { tint: 0xc4bfb5, damage: 0.4 });
        if (rng.next() < 0.6) P.rebar(ctx, (xa + xb) / 2, y - 0.1, ze, new THREE.Vector3(rng.range(-0.3, 0.3), -0.5, 1), rng.range(0.6, 1.3));
      }
    };
    jaggedSlab(f2, -16.8, false);
    jaggedSlab(top, -18.2, true);
    parapet(ctx, x0, z0, x1, -18.2, top, 0.9, 0.3, mat, { tint }, { s: false });
    this.bulkhead(sx0 - 0.4, sz0, x1 - T, stairRect.z1 + 0.3, top, 's', sx0 + 1.95, mat, tint);
    P.waterTank(ctx, 12, top, -21.5); P.ventPipe(ctx, 15, top, -20, 0.9); P.satelliteDish(ctx, 18, top, -21, 0.4);
    // collapsed slab: tilted from the intact floor-1 edge down to the street
    const zA = -16, zB = -8.6, yA = f1, yB = 0.3;
    const len = Math.hypot(zB - zA, yA - yB), ang = Math.atan2(yA - yB, zB - zA);
    const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), ang);
    const cx = (x0 + x1) / 2, cy = (yA + yB) / 2 - 0.12, cz = (zA + zB) / 2;
    B.add('debris', place(fracturedBox(x1 - x0 - 2 * T, SLAB, len, rng, { chips: 7, amp: 0.10, seed: 3, tint: 0xada79a }), cx, cy, cz, { quat: q, keepColor: true, damage: 0.5 }));
    this.collideQuat(cx, cy, cz, x1 - x0 - 2 * T, SLAB, len, 'concrete', q);
    // rebar fringe along the broken lower edge of the collapsed slab
    for (let i = 0; i < 9; i++) { const px = x0 + T + (i + 0.5) * (x1 - x0 - 2 * T) / 9; P.rebar(ctx, px, yB + 0.12, zB - 0.1, new THREE.Vector3(rng.range(-0.3, 0.3), 0.5, 1), rng.range(0.4, 0.9)); }
    // rubble draped over the slab and spilling into the intersection
    const rubbleH = (x: number, z: number) => {
      let baseY: number;
      if (z < zA) baseY = yA; else if (z < zB) baseY = yA - (z - zA) / (zB - zA) * (yA - yB); else if (z < -6.2) baseY = THREE.MathUtils.lerp(yB, 0.15, (z - zB) / (-6.2 - zB)); else baseY = 0.15;
      const streetFade = 1 - THREE.MathUtils.smoothstep(z, -8.2, -5.9);
      const xFade = z > -8.3 ? 1 - THREE.MathUtils.smoothstep(Math.abs(x - 16), 4.5, 7.0) : 1;
      const amp = (z < zA ? 0.12 : 0.28) * streetFade * xFade;
      const mound = 0.9 * Math.exp(-(Math.pow((x - 13) / 2.2, 2) + Math.pow((z + 10) / 1.6, 2))) + 0.6 * Math.exp(-(Math.pow((x - 19) / 1.8, 2) + Math.pow((z + 12.5) / 1.8, 2)));
      // three octaves of surface break-up so the pile reads as debris, not a sand dune
      const rough = (0.22 * (fbm2(x * 2.1, z * 2.1) - 0.5) + 0.11 * (fbm2(x * 5.3, z * 5.3) - 0.5) + 0.05 * (fbm2(x * 11, z * 11) - 0.5)) * streetFade * xFade;
      return baseY + amp * (0.35 + fbm2(x * 0.55, z * 0.55)) + mound * streetFade * xFade + rough + (z > zB ? 0.03 : 0.06);
    };
    const rub = heightField(x0 + 0.05, -17.2, x1 - 0.05, -5.6, 0.27, rubbleH, { tint: 0xa89e90, aoFn: (x, y, z) => 0.78 + 0.3 * THREE.MathUtils.clamp(fbm2(x * 2.6, z * 2.6), 0, 1) });
    B.add('rubble', rub); this.collideMesh(rub, 'concrete');
    // chunks, slabs, bricks, rebar on the slope — clustered, half-buried, sitting on the rubble surface
    P.debrisField(ctx, 16, -11.5, 6.6, 5.2, 165, 0, { bricks: true, paper: false, chunkScale: 1.1, groundFn: (x, z) => rubbleH(x, z) - 0.03, cluster: 9 });
    P.debrisField(ctx, 14, -7.6, 5.0, 1.6, 60, 0, { bricks: true, chunkScale: 1.3, groundFn: (x, z) => rubbleH(x, z) - 0.03, cluster: 4 });
    for (let i = 0; i < 26; i++) { const x = rng.range(10, 22), z = rng.range(-15.5, -7); P.rebar(ctx, x, rubbleH(x, z) - 0.12, z, new THREE.Vector3(rng.range(-0.5, 0.5), 1, rng.range(-0.5, 0.5)), rng.range(0.4, 1.2)); }
    // whole slab fragments half-buried in the slope, and gravel/dust skirting the toe of the pile
    for (let i = 0; i < 14; i++) {
      const x = rng.range(10, 22), z = rng.range(-15.5, -7.2), sc = rng.range(1.1, 2.2);
      const bg = chunkGeo('slab', rng, 11 + i * 3); bg.scale(sc, sc, sc);
      B.add('debris', place(bg, x, rubbleH(x, z) - sc * rng.range(0.06, 0.16), z, { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.5, 0.5), rng.range(0, 6), rng.range(-0.5, 0.5))), keepColor: true }));
    }
    // gravel / dust skin over the pile so the heightfield never shows as bare texture
    for (let i = 0; i < 22; i++) { const x = rng.range(9.6, 22.4), z = rng.range(-16.5, -6.0); P.gravelPatch(ctx, x, z, rng.range(1.0, 2.6), rng.range(0.8, 2.0), rubbleH(x, z) + 0.02, rng.range(0.5, 0.85)); }
    for (const [gx, gz, gr] of [[12, -6.6, 3.2], [18, -7.0, 3.0], [15, -6.2, 2.4]]) P.gravelPatch(ctx, gx, gz, gr, gr * 0.7, 0.012, 0.85);
    // hero fragments: whole floor slabs tipped out of the building, rebar fringing the broken edges
    for (const [hx, hz, hy, hs, ht] of [[12.6, -9.4, 0.5, 3.4, 0.55], [18.2, -11.6, 1.3, 3.0, -0.7], [15.4, -7.4, 0.2, 2.6, 2.4]] as [number, number, number, number, number][]) {
      const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(rng.range(-0.35, 0.35), ht, rng.range(0.25, 0.6)));
      const yy = rubbleH(hx, hz) + hy * 0.25;
      B.add('debris', place(fracturedBox(hs, 0.22, hs * 0.72, rng, { chips: 6, amp: 0.09, seed: 7 + hx, tint: new THREE.Color().setHSL(0.08, 0.04, rng.range(0.44, 0.68)) }), hx, yy, hz, { quat: q, keepColor: true, damage: 0.55 }));
      this.collideQuat(hx, yy, hz, hs, 0.22, hs * 0.72, 'concrete', q);
      for (let k = 0; k < 4; k++) { const a = ht + k * 1.3; P.rebar(ctx, hx + Math.cos(a) * hs * 0.45, yy + 0.05, hz + Math.sin(a) * hs * 0.3, new THREE.Vector3(Math.cos(a), rng.range(0.2, 0.8), Math.sin(a)), rng.range(0.5, 1.1)); }
    }
    // big slab fragments leaning in the street
    B.add('debris', place(fracturedBox(2.6, 0.25, 1.9, rng, { chips: 6, amp: 0.09, seed: 21, tint: 0xada79a }), 6.2, 0.55, -6.2, { quat: new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0.4, 0.1)), keepColor: true, damage: 0.5 }));
    this.collideQuat(6.2, 0.55, -6.2, 2.6, 0.25, 1.9, 'concrete', new THREE.Quaternion().setFromEuler(new THREE.Euler(0.55, 0.4, 0.1)));
    P.debrisField(ctx, 8, -6.5, 3.5, 2.2, 70, 0.0, { bricks: true, chunkScale: 1.2 });
    P.debrisField(ctx, 14, -20, 4, 3, 40, base, { bricks: true });
    P.debrisField(ctx, 15, -20, 4, 3, 30, f1, { bricks: true });
    // The collapsed south stub opens straight onto an unlit ground floor, which reads as a pure black rectangle
    // from the rubble slope. A backdrop at the rear partition gives the void a value floor, and a little
    // spill-out dressing just inside the mouth gives the eye something lit to read the depth against.
    P.voidBack(ctx, 16, base, -15.7, 13.4, 6.6, 0, 0.62);
    P.drum(ctx, 12.4, -10.4, 0.9); P.pallet(ctx, 18.6, base, -10.8, 1.1, 0.9); P.crate(ctx, 14.2, base, -12.2, 0.5, 0.62);
    P.debrisPile(ctx, 17.2, base, -9.6, 1.5, 0.32);
    // rear ground floor dressing
    P.crate(ctx, 20, base, -22, 0.4, 0.7); P.drum(ctx, 11, -22.5, 0.2); P.drum(ctx, 11.7, -22.1, 0.9);
    P.mattress(ctx, 13, f1, -22, 0.5, 0x7a7060);
    for (const z of [-23.6, -21.6, -21.1, -19.1, -18.6, -16.6]) P.pocks(ctx, new THREE.Vector3(9, this.rng.range(0.7, 3.0), z), new THREE.Vector3(-1, 0, 0), this.rng.range(0.5, 0.9));
  }

  // ------------------------------------------------------------------ Building B (NW) & D (NE): façade buildings with enterable ground floors
  private simpleBuilding(x0: number, z0: number, x1: number, z1: number, floors: number, mat: string, tint: THREE.ColorRepresentation, spec: { street: 's' | 'n'; alley: 'e' | 'w'; sign: number; frame: number; blobs: [number, number, number, number][] }): void {
    const ctx = this.ctx, base = 0.15, top = base + floors * FH, f1 = base + FH;
    const inMat = 'interior', inTint = 0xcbc2b6;
    slab(ctx, x0, z0, x1, z1, -0.1, base - 0.02, [], 'concrete', 'floorInt', { tint: 0xc4bfb6 });
    const w = x1 - x0, d = z1 - z0;
    const xs = [x0 + 1.8, x0 + w / 2, x1 - 1.8], zs: number[] = []; for (let z = z0 + 2.2; z < z1 - 1.5; z += 3.4) zs.push(z);
    const upper = (us: number[]) => us.flatMap((u) => Array.from({ length: floors - 1 }, (_, k) => this.win(u, base + (k + 1) * FH + 0.95)));
    // street facade with shop + door
    const sZ = spec.street === 's' ? z1 : z0;
    const streetOpen: Opening[] = [{ u0: x0 + 1.5, u1: x0 + 5.0, y0: base, y1: base + 2.85, kind: 'shop', state: 'halfShutter', sign: spec.sign }, this.door(x1 - 2.2, base, 1.1, 2.15, 'open'), this.win(x0 + 7.0, base + 1.1, 1.2, 1.3), ...upper(xs)];
    wall(ctx, { axis: 'x', u0: x0 + T, u1: x1 - T, b0: spec.street === 's' ? sZ - T : sZ, b1: spec.street === 's' ? sZ : sZ + T, y0: base, y1: top, out: spec.street === 's' ? 1 : -1, openings: streetOpen, mat, tint, innerSkin: inMat, innerTint: inTint, frameTint: spec.frame, courses: [f1 - 0.2], damageFn: this.damageFn(spec.blobs, top) });
    const backZ = spec.street === 's' ? z0 : z1;
    wall(ctx, { axis: 'x', u0: x0 + T, u1: x1 - T, b0: spec.street === 's' ? backZ : backZ - T, b1: spec.street === 's' ? backZ + T : backZ, y0: base, y1: top, out: spec.street === 's' ? -1 : 1, openings: [this.win(x0 + w / 2, base + 1.2, 1.0, 1.2, 'boarded'), ...upper([x0 + 2.2, x1 - 2.2])], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint: spec.frame, details: true });
    const aX = spec.alley === 'e' ? x1 : x0;
    wall(ctx, { axis: 'z', u0: z0, u1: z1, b0: spec.alley === 'e' ? aX - T : aX, b1: spec.alley === 'e' ? aX : aX + T, y0: base, y1: top, out: spec.alley === 'e' ? 1 : -1, openings: [this.door(z0 + d * 0.45, base, 1.1, 2.15, 'closed'), this.win(z0 + d * 0.7, base + 1.2, 1.0, 1.2, 'shutter'), this.win(z0 + d * 0.2, base + 1.2, 1.0, 1.2, 'boarded'), ...upper(zs)], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint: spec.frame, courses: [f1 - 0.2], damage: 0.14, damageFn: this.damageFn([[aX, 4.5, z0 + d * 0.5, 1.8], [aX, 2.2, z0 + d * 0.18, 2.4], [aX, 5.4, z0 + d * 0.8, 1.6]], top, 0.1) });
    const oX = spec.alley === 'e' ? x0 : x1;
    wall(ctx, { axis: 'z', u0: z0, u1: z1, b0: spec.alley === 'e' ? oX : oX - T, b1: spec.alley === 'e' ? oX + T : oX, y0: base, y1: top, out: spec.alley === 'e' ? -1 : 1, openings: [], mat, tint, details: false });
    // partition splitting the ground floor into two rooms
    const pz = z0 + d * 0.45;
    for (let k = 0; k < floors; k++) {
      const y = base + k * FH;
      wall(ctx, { axis: 'x', u0: x0 + T, u1: x1 - T, b0: pz - 0.08, b1: pz + 0.08, y0: y, y1: y + FH - SLAB, out: 1, openings: [this.door(x0 + w * 0.4, y, 1.0, 2.1, 'missing')], mat: inMat, tint: inTint, damage: 0.15, surface: 'plaster', frameTint: 0x4a4a4a });
    }
    for (let k = 1; k < floors; k++) slab(ctx, x0 + T, z0 + T, x1 - T, z1 - T, base + k * FH - SLAB, base + k * FH, [], 'concrete', 'floorInt', { tint: 0xc4bfb5 });
    slab(ctx, x0, z0, x1, z1, top - SLAB, top, [], 'concrete', undefined, { tint: 0xa9a49a });
    parapet(ctx, x0, z0, x1, z1, top, 0.85, 0.3, mat, { tint });
    P.waterTank(ctx, x0 + w * 0.3, top, z0 + d * 0.3); P.waterTank(ctx, x0 + w * 0.3 + 1.5, top, z0 + d * 0.3 + 0.4); P.acUnit(ctx, x0 + w * 0.6, top + 0.35, z1 - 1.2, 0); P.debrisField(ctx, x0 + w / 2, z0 + d / 2, w / 2 - 1, d / 2 - 1, 16, top, { bricks: true, chunkScale: 0.6 }); P.crate(ctx, x0 + 1.5, top, z1 - 1.5, 0.4, 0.55); P.acUnit(ctx, spec.street === 's' ? x0 + 6.5 : x0 + 6.5, f1 + 1.4, spec.street === 's' ? z1 + 0.18 : z0 - 0.18, spec.street === 's' ? 0 : Math.PI); P.satelliteDish(ctx, x0 + w * 0.7, top, z0 + d * 0.6, 1.0); P.ventPipe(ctx, x0 + w * 0.5, top, z1 - 2, 0.8);
    // ground floor dressing
    P.crate(ctx, x0 + 2.5, base, pz + 2.5, 0.3, 0.7); P.crate(ctx, x0 + 3.4, base, pz + 3.0, 0.9, 0.55); P.pallet(ctx, x1 - 2.5, base, z0 + 3, 0.2); P.drum(ctx, x1 - 2, z0 + 5, 0.5); P.debrisField(ctx, x0 + w / 2, z0 + d / 2, w / 2 - 1, d / 2 - 1, 35, base, { bricks: false });
  }
  private buildingB(): void {
    this.simpleBuilding(-36, -30, -26, -8, 2, 'plasterD', 0xf2ece2, { street: 's', alley: 'e', sign: 3, frame: 0x6b4a2b, blobs: [[-31, 4.5, -8, 1.6], [-28, 6.6, -8, 1.0]] });
  }
  private buildingD(): void {
    this.simpleBuilding(26, -30, 36, -8, 2, 'brickD', 0xf0e8de, { street: 's', alley: 'w', sign: 6, frame: 0xd8d2c4, blobs: [[30, 4.5, -8, 1.5]] });
  }

  // ------------------------------------------------------------------ Courtyard complex (SW): north wing, east wing with stair, sheds, storage
  private courtyardComplex(): void {
    const ctx = this.ctx, B = this.batch, rng = this.rng;
    const base = 0.15;
    // --- North wing: x -36..-9, z 8..14, 2 floors, arched passage at x -20.4..-17.6
    {
      const x0 = -36, z0 = 8, x1 = -9, z1 = 14, floors = 2, mat = 'plasterB', tint = 0xe3d8c2, inMat = 'interior', inTint = 0xd2c8ba;
      const top = base + floors * FH, f1 = base + FH, frameTint = 0x4a6b3a;
      slab(ctx, x0, z0, x1, z1, -0.1, base - 0.02, [], 'concrete', 'floorInt', { tint: 0xc4bfb6 });
      const arch: Opening = { u0: -20.4, u1: -17.6, y0: base, y1: base + 3.0, kind: 'arch' };
      wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z0, b1: z0 + T, y0: base, y1: top, out: -1, openings: [
        arch, { u0: -15.6, u1: -11.6, y0: base, y1: base + 2.85, kind: 'shop', state: 'open', sign: 4 }, { u0: -30.2, u1: -26.6, y0: base, y1: base + 2.85, kind: 'shop', state: 'shutter', sign: 7 },
        this.door(-24, base, 1.1, 2.15, 'open'), this.win(-33, base + 1.1, 1.2, 1.3, 'shutter'), this.win(-22.2, base + 1.1, 1.0, 1.3, 'boarded'),
        ...[-34, -31, -28, -25, -22, -19, -16, -13, -10.4].map((u) => this.win(u, f1 + 0.95)),
      ], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, courses: [f1 - 0.2], damageFn: this.damageFn([[-13, 5, 8, 1.8], [-27, 2, 8, 1.2], [-22, 6.4, 8, 1.3]], top) });
      P.awning(ctx, 'x', -13.6, 4.4, z0, -1, base + 3.15, 1.5, false);
      wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z1 - T, b1: z1, y0: base, y1: top, out: 1, openings: [arch, this.door(-25, base, 1.1, 2.15, 'open'), this.door(-12, base, 1.1, 2.15, 'open'), this.win(-30, base + 1.2, 1.2, 1.3), this.win(-15, base + 1.2, 1.2, 1.3, 'broken'), ...[-33, -29, -25.5, -22.5, -15.5, -12.5].map((u) => this.win(u, f1 + 0.95, 1.1, 1.3))], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, damageFn: this.damageFn([[-30, 3.5, 14, 1.4]], top, 0.1) });
      wall(ctx, { axis: 'z', u0: z0 + T, u1: z1 - T, b0: x0, b1: x0 + T, y0: base, y1: top, out: -1, openings: [], mat, tint, details: false });
      wall(ctx, { axis: 'z', u0: z0 + T, u1: z1 - T, b0: x1 - T, b1: x1, y0: base, y1: top, out: 1, openings: [this.win(11, base + 1.2, 1.0, 1.2, 'shutter'), this.win(11, f1 + 0.95, 1.0, 1.2, 'glass')], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint });
      // passage walls (so the arch is a proper tunnel through the wing)
      for (const px of [-20.4, -17.6]) wall(ctx, { axis: 'z', u0: z0 + T, u1: z1 - T, b0: px - 0.08, b1: px + 0.08, y0: base, y1: f1 - SLAB, out: px < -19 ? -1 : 1, openings: [], mat: inMat, tint: 0xbdb3a4, damage: 0.3, surface: 'plaster', details: false });
      // room partitions
      for (const [i, y] of [base, f1].entries()) {
        const yt = y + FH - SLAB;
        for (const px of [-26, -11.9]) wall(ctx, { axis: 'z', u0: z0 + T, u1: z1 - T, b0: px - 0.08, b1: px + 0.08, y0: y, y1: yt, out: 1, openings: i === 0 && px === -26 ? [] : [this.door(11, y, 1.0, 2.1, 'missing')], mat: inMat, tint: inTint, damage: 0.15, surface: 'plaster', frameTint: 0x4a4a4a });
      }
      slab(ctx, x0 + T, z0 + T, x1 - T, z1 - T, f1 - SLAB, f1, [], 'concrete', 'floorInt', { tint: 0xc4bfb5 });
      slab(ctx, x0, z0, x1, z1, top - SLAB, top, [], 'concrete', undefined, { tint: 0xa9a49a });
      parapet(ctx, x0, z0, -14, z1, top, 0.85, 0.3, mat, { tint }, { e: false });
      parapet(ctx, -14, z0, x1, z1, top, 0.85, 0.3, mat, { tint }, { w: false, s: false });
      P.waterTank(ctx, -30, top, 11); P.waterTank(ctx, -28.4, top, 11.4); P.debrisField(ctx, -20, 11, 10, 2, 20, top, { bricks: true, chunkScale: 0.6 }); P.acUnit(ctx, -22, top + 0.35, 12.5, 0.2); P.tireStack(ctx, -12, 10, 2); P.satelliteDish(ctx, -16, top, 12, 3.0); P.acUnit(ctx, -30, f1 + 1.3, z0 - 0.18, Math.PI); P.acUnit(ctx, -17.5, f1 + 1.6, z0 - 0.18, Math.PI); P.ventPipe(ctx, -24, top, 10, 0.9);
      // shop dressing (restaurant): tables & chairs
      for (const [tx, tz] of [[-14.5, 11], [-12, 12]]) { B.add('wood', box(tx, base + 0.74, tz, 0.9, 0.05, 0.9, { tint: 0x7a6248 })); B.add('darkMetal', box(tx, base + 0.36, tz, 0.06, 0.72, 0.06, { tint: 0x333 })); this.collideBox(tx, base + 0.4, tz, 0.9, 0.8, 0.9, 'wood'); }
      P.crate(ctx, -28, base, 11, 0.4, 0.6); P.crate(ctx, -33, base, 12, 1.2, 0.7); P.debrisField(ctx, -22, 11, 12, 2.2, 45, base, { bricks: false });
      for (const x of [-35.2, -31.4, -25.4, -23.2, -21.6, -16.8, -16.2, -10.4, -9.8]) P.pocks(ctx, new THREE.Vector3(x, rng.range(0.7, 3.0), z0), new THREE.Vector3(0, 0, -1), rng.range(0.5, 0.9));
    }
    // --- East wing: x -14..-9, z 14..32, 2 floors, passage at z 22..24.8, stair at the south end
    {
      const x0 = -14, z0 = 14, x1 = -9, z1 = 32, floors = 2, mat = 'plasterA', tint = 0xe0d6c8, inMat = 'interior', inTint = 0xd2c8ba;
      const top = base + floors * FH, f1 = base + FH, frameTint = 0x8a8a80;
      slab(ctx, x0, z0, x1, z1, -0.1, base - 0.02, [], 'concrete', 'floorInt', { tint: 0xc4bfb6 });
      const arch: Opening = { u0: 22, u1: 24.8, y0: base, y1: base + 3.0, kind: 'arch' };
      wall(ctx, { axis: 'z', u0: z0, u1: z1, b0: x1 - T, b1: x1, y0: base, y1: top, out: 1, openings: [arch, this.door(17.5, base, 1.1, 2.15, 'open'), this.win(15.3, base + 1.1, 1.2, 1.3, 'shutter'), this.win(19.8, base + 1.1, 1.2, 1.3, 'boarded'), this.win(30, base + 1.1, 1.2, 1.3, 'broken'), ...[15.5, 18.5, 21, 26, 30.5].map((u) => this.win(u, f1 + 0.95)), { u0: 27.3, u1: 28.3, y0: f1, y1: f1 + 2.15, kind: 'door', state: 'open' }], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, courses: [f1 - 0.2], damageFn: this.damageFn([[-9, 4.5, 20, 1.8], [-9, 2.2, 30.5, 1.2]], top) });
      this.balcony('z', 26.6, 29.6, x1, 1, f1, mat, tint);
      wall(ctx, { axis: 'z', u0: z0, u1: z1, b0: x0, b1: x0 + T, y0: base, y1: top, out: -1, openings: [arch, this.door(18, base, 1.1, 2.15, 'open'), this.win(15.5, base + 1.2, 1.1, 1.3), this.win(20, base + 1.2, 1.1, 1.3, 'broken'), this.win(28, base + 1.2, 1.1, 1.3, 'glass'), ...[15.5, 18.5, 21, 26.5, 30].map((u) => this.win(u, f1 + 0.95, 1.1, 1.3))], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint, damageFn: this.damageFn([[-14, 5.2, 24, 2.0]], top, 0.12) });
      wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z1 - T, b1: z1, y0: base, y1: top, out: 1, openings: [this.win(-11.5, base + 1.2, 1.0, 1.2, 'shutter'), this.win(-11.5, f1 + 0.95, 1.0, 1.2, 'boarded')], mat, tint, innerSkin: inMat, innerTint: inTint, frameTint });
      for (const pz of [22, 24.8]) wall(ctx, { axis: 'x', u0: x0 + T, u1: x1 - T, b0: pz - 0.08, b1: pz + 0.08, y0: base, y1: f1 - SLAB, out: pz < 23 ? -1 : 1, openings: [], mat: inMat, tint: 0xbdb3a4, damage: 0.3, surface: 'plaster', details: false });
      const sx0 = x0 + T, sz0 = z1 - T - STAIR_D; const stairRect = { x0: sx0, z0: sz0, x1: sx0 + STAIR_W, z1: sz0 + STAIR_D };
      for (const y of [base, f1]) {
        const yt = y + FH - SLAB;
        wall(ctx, { axis: 'z', u0: sz0, u1: stairRect.z1, b0: stairRect.x1, b1: stairRect.x1 + 0.16, y0: y, y1: yt, out: 1, openings: [], mat: inMat, tint: inTint, damage: 0.1, surface: 'plaster', details: false });
        wall(ctx, { axis: 'x', u0: sx0, u1: stairRect.x1 + 0.16, b0: sz0 - 0.16, b1: sz0, y0: y, y1: yt, out: -1, openings: [this.door(sx0 + 1.95, y, 1.05, 2.1, 'missing')], mat: inMat, tint: inTint, damage: 0.1, surface: 'plaster', frameTint: 0x4a4a4a });
        stairsU(ctx, sx0, sz0, 1, y, 'concrete', 0xc4bfb4);
        wall(ctx, { axis: 'x', u0: x0 + T, u1: x1 - T, b0: 19.4, b1: 19.56, y0: y, y1: yt, out: 1, openings: [this.door(-11.5, y, 1.0, 2.1, 'missing')], mat: inMat, tint: inTint, damage: 0.15, surface: 'plaster', frameTint: 0x4a4a4a });
      }
      slab(ctx, x0 + T, z0 + T, x1 - T, z1 - T, f1 - SLAB, f1, [stairRect], 'concrete', 'floorInt', { tint: 0xc4bfb5 });
      slab(ctx, x0, z0, x1, z1, top - SLAB, top, [stairRect], 'concrete', undefined, { tint: 0xa9a49a });
      parapet(ctx, x0, z0, x1, z1, top, 0.85, 0.3, mat, { tint }, { n: false });
      this.bulkhead(x0 + T, sz0 - 0.3, stairRect.x1 + 0.4, z1 - T, top, 'n', sx0 + 1.95, mat, tint);
      P.waterTank(ctx, -11.5, top, 17); P.sandbagWall(ctx, new THREE.Vector3(-9.6, top, 19), new THREE.Vector3(-9.6, top, 22.5), 3); P.crate(ctx, -12.5, top, 21, 0.2, 0.6); P.acUnit(ctx, -8.82, 5.0, 19.5, -Math.PI / 2);
      P.mattress(ctx, -11.5, f1, 16.5, 0.2, 0x7a7568);
      P.debrisField(ctx, -11.5, 18, 1.8, 3, 25, base, { bricks: false }); P.debrisField(ctx, -11.5, 28, 1.8, 3, 20, f1, { bricks: true });
      for (const z of [14.4, 16.4, 18.6, 21.2, 25.6, 26.4, 28.6, 31.4]) P.pocks(ctx, new THREE.Vector3(x1, rng.range(0.7, 3.0), z), new THREE.Vector3(1, 0, 0), rng.range(0.5, 0.9));
    }
    // --- West sheds: x -36..-31, z 14..32, single storey stone stalls open to the courtyard
    {
      const x0 = -36, z0 = 14, x1 = -31, z1 = 32, h = 2.9;
      wall(ctx, { axis: 'z', u0: z0, u1: z1, b0: x0, b1: x0 + T, y0: base, y1: base + h, out: -1, openings: [], mat: 'stone', tint: 0xd8d2c6, details: false });
      wall(ctx, { axis: 'z', u0: z0, u1: z1, b0: x1 - T, b1: x1, y0: base, y1: base + h, out: 1, openings: [{ u0: 16, u1: 19.5, y0: base, y1: base + 2.3, kind: 'arch' }, { u0: 21.5, u1: 25, y0: base, y1: base + 2.3, kind: 'arch' }, { u0: 27, u1: 30, y0: base, y1: base + 2.3, kind: 'door', state: 'open' }], mat: 'stone', tint: 0xd8d2c6, frameTint: 0x4a3a2a, damageFn: this.damageFn([[-31, 1.5, 20, 1.4]], base + h, 0.1) });
      wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z0, b1: z0 + T, y0: base, y1: base + h, out: -1, openings: [], mat: 'stone', tint: 0xd8d2c6, details: false });
      wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z1 - T, b1: z1, y0: base, y1: base + h, out: 1, openings: [], mat: 'stone', tint: 0xd8d2c6, details: false });
      for (const pz of [20.5, 26]) wall(ctx, { axis: 'x', u0: x0 + T, u1: x1 - T, b0: pz - 0.1, b1: pz + 0.1, y0: base, y1: base + h, out: 1, openings: [], mat: 'stone', tint: 0xcfc8ba, details: false });
      // corrugated roof, slightly sloped toward the courtyard, with rafters
      const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 0, 1), -0.09);
      B.add('corrugated', box((x0 + x1) / 2 + 0.1, base + h + 0.28, (z0 + z1) / 2, x1 - x0 + 0.8, 0.04, z1 - z0 + 0.4, { quat: rq, tint: 0xb0a090 }));
      this.collideQuat((x0 + x1) / 2 + 0.1, base + h + 0.28, (z0 + z1) / 2, x1 - x0 + 0.8, 0.04, z1 - z0 + 0.4, 'metal', rq);
      for (let z = z0 + 0.6; z < z1; z += 1.5) B.add('wood', box((x0 + x1) / 2 + 0.1, base + h + 0.16, z, x1 - x0 + 0.6, 0.12, 0.08, { quat: rq, tint: 0x6b5a45 }));
      for (const [vz, vw] of [[17.75, 3.4], [23.25, 3.4], [28.5, 2.9]] as [number, number][]) P.voidBack(ctx, x0 + T + 0.05, base, vz, vw, 2.25, Math.PI / 2, 1.15);
      P.drum(ctx, -34, 17, 0.3); P.drum(ctx, -33.2, 17.4, 1.4); P.drum(ctx, -34.2, 18.1, 0.7, true); P.tireStack(ctx, -33.5, 23, 3); P.tireStack(ctx, -34.4, 23.8, 2); P.pallet(ctx, -33.5, base, 28.5, 0.3); P.pallet(ctx, -33.5, base + 0.15, 28.5, 0.1); P.crate(ctx, -34.5, base, 30.5, 0.2, 0.6);
    }
    // --- South storage: x -36..-14, z 32..36, stone wall with a closed steel gate
    {
      const x0 = -36, z0 = 32, x1 = -14, z1 = 36, h = 3.1;
      wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z0, b1: z0 + T, y0: base, y1: base + h, out: -1, openings: [{ u0: -24.5, u1: -21.5, y0: base, y1: base + 2.6, kind: 'shop', state: 'shutter' }, this.win(-30, base + 1.5, 1.0, 0.9, 'boarded'), this.win(-17, base + 1.5, 1.0, 0.9, 'shutter')], mat: 'stone', tint: 0xd4cec2, damageFn: this.damageFn([[-28, 2.5, 32, 1.6]], base + h, 0.1) });
      wall(ctx, { axis: 'x', u0: x0, u1: x1, b0: z1 - T, b1: z1, y0: base, y1: base + h, out: 1, openings: [], mat: 'stone', tint: 0xd4cec2, details: false });
      wall(ctx, { axis: 'z', u0: z0 + T, u1: z1 - T, b0: x1 - T, b1: x1, y0: base, y1: base + h, out: 1, openings: [], mat: 'stone', tint: 0xd4cec2, details: false });
      slab(ctx, x0, z0, x1, z1, base + h, base + h + 0.2, [], 'concrete', undefined, { tint: 0xa9a49a });
      parapet(ctx, x0, z0, x1, z1, base + h + 0.2, 0.5, 0.3, 'stone', { tint: 0xd4cec2 });
    }
    // --- Courtyard dressing
    P.car(ctx, -24.5, 24.5, 1.15, true, 0x8c8378, 0, base);
    P.scorch(ctx, -24.5, 24.5, 3.6, base + 0.01);
    P.deadTree(ctx, -27.5, 18.5, base, 5.4, 1);
    P.well(ctx, -19.5, 18.5, base);
    P.hescoRow(ctx, -30.5, 30.5, 0, 3); P.hescoRow(ctx, -30.6, 30.4, -Math.PI / 2, 2);
    P.sandbagWall(ctx, new THREE.Vector3(-16, base, 26.5), new THREE.Vector3(-16, base, 29.5), 3);
    P.sandbagWall(ctx, new THREE.Vector3(-16.2, base, 26.3), new THREE.Vector3(-19, base, 26.3), 2);
    P.pallet(ctx, -22, base, 29, 0.4); P.pallet(ctx, -22, base + 0.15, 29, 0.6); P.crate(ctx, -20.5, base, 29.5, 0.2, 0.7); P.drum(ctx, -17.5, 15.5, 0.2); P.drum(ctx, -18.3, 15.9, 1.0); P.tireStack(ctx, -29, 16, 3);
    // clothes lines with hanging laundry
    P.laundryLine(ctx, new THREE.Vector3(-14.2, 3.9, 20), new THREE.Vector3(-30.8, 3.6, 24.5), 6);
    P.laundryLine(ctx, new THREE.Vector3(-14.2, 6.6, 27), new THREE.Vector3(-30.9, 6.2, 29.5), 5);
    P.laundryLine(ctx, new THREE.Vector3(-9.3, 5.0, 16.5), new THREE.Vector3(-9.3, 4.6, 24.0), 4);
    for (const [x, z, rx, rz] of [[-22, 20, 3, 2.2], [-18, 24, 2.2, 3], [-28, 27, 2.5, 2], [-24, 17, 2.6, 1.8], [-17, 30, 2.2, 2.6], [-29, 21, 2.0, 2.4]]) P.dirtPatch(ctx, x, z, rx, rz, base + 0.006, 0.7);
    for (const [x, z] of [[-20, 19], [-26, 22], [-22, 28], [-16.5, 22]]) P.oilStain(ctx, x, z, 0.7, base + 0.007);
    P.puddle(ctx, -21, 21.5, 2.2, 1.5, base + 0.008);
    P.debrisField(ctx, -22, 23, 7, 7, 55, base, { bricks: true, chunkScale: 0.8 });
    // courtyard dressing: market carts, a stall, scaffolding on the north wing, gravel drift and tracks
    P.cart(ctx, -21.5, 16.5, 0.7, base); P.cart(ctx, -25.5, 27.5, 2.3, base);
    P.scaffold(ctx, -16.5, 14.35, Math.PI, 2, 2, base);
    P.shelfUnit(ctx, -12.4, base, 12.6, Math.PI / 2);
    P.table(ctx, -20.5, base, 21.5, 0.4); P.chair(ctx, -21.3, base, 22.4, 1.2); P.chair(ctx, -19.6, base, 20.7, -2.0, true);
    P.ammoCrate(ctx, -16.4, base, 27.2, 0.3); P.ammoCrate(ctx, -16.4, base + 0.33, 27.2, 0.5); P.ammoCrate(ctx, -17.1, base, 27.5, 1.2, true);
    P.mattress(ctx, -30.2, base, 20.5, 0.6, 0x7a6a58);
    /**
     * Ground story on the sand.
     *
     * "One uniform albedo — no footprints, no vehicle tracks, no drift against the walls, no gravel, no wet
     * patches" has stood for three rounds. Sand records everything: the truck's turning circle, the paths
     * people walk between the gate, the well and the doorways, wind ripples in the lee of the walls, and a
     * drift of loose sand banked against every wall base.
     */
    for (const [tx, tz, ty, tl] of [[-24, 20, 0.9, 9], [-19, 26, 2.4, 9], [-28, 24, 0.2, 9], [-24.5, 24.5, 1.15, 11], [-22, 17.5, 0.15, 12], [-27, 28.5, 1.75, 8]] as [number, number, number, number][]) P.tireTrack(ctx, tx, tz, ty, tl, base + 0.005);
    // walked paths: gate -> well, well -> the north-wing doors, and along the sheds
    for (const [ax, az, bx, bz, wdt] of [[-19.5, 30.5, -19.5, 19.5, 0.85], [-19.5, 18.5, -11.5, 14.6, 0.8], [-19.5, 19.5, -30.5, 22.5, 0.7], [-30.5, 16.5, -30.5, 30.5, 0.65], [-24.5, 26.5, -16.5, 27.5, 0.7]] as [number, number, number, number, number][]) {
      P.bootTrail(ctx, new THREE.Vector3(ax, base, az), new THREE.Vector3(bx, base, bz), base + 0.006, wdt, 0.85);
    }
    // wind ripples in the open middle, and sand drifted against the wall bases
    for (const [rx, rz, rw, rd, ry] of [[-25, 21, 7, 5, 0.4], [-18, 23, 5, 6, 1.9], [-28, 29, 6, 4, 0.9], [-22, 32, 8, 3.5, 0.2]] as [number, number, number, number, number][]) P.sandRipple(ctx, rx, rz, rw, rd, ry, base + 0.0045, 0.5);
    for (const [dx, dz, drx, drz] of [[-30.4, 22, 0.9, 8], [-14.7, 24, 0.9, 9], [-24, 35.3, 10, 0.8], [-24, 14.7, 10, 0.8]] as [number, number, number, number][]) P.dirtPatch(ctx, dx, dz, drx, drz, base + 0.0055, 0.5);
    for (const [gx, gz] of [[-31.5, 17], [-31.5, 24], [-31.5, 30], [-14.6, 18], [-14.6, 26], [-19.5, 18.5], [-25, 31]]) P.gravelPatch(ctx, gx, gz, 1.4, 2.6, base + 0.007, 0.7);
    P.deadTree(ctx, -20.5, 30.5, base, 4.2, 2);
  }

  // ------------------------------------------------------------------ Market lot (SE): canopy shed, hesco positions, stalls
  private marketLot(): void {
    const ctx = this.ctx, B = this.batch, rng = this.rng, base = 0.15;
    // canopy shed x 26..36, z 26..36
    for (const [x, z] of [[27, 27], [31.5, 27], [35.4, 27], [27, 31.5], [35.4, 31.5], [27, 35.4], [31.5, 35.4], [35.4, 35.4]]) { B.add('darkMetal', box(x, base + 1.9, z, 0.12, 3.8, 0.12, { tint: 0x4a4a48 })); this.collideBox(x, base + 1.9, z, 0.12, 3.8, 0.12, 'metal'); }
    const rq = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), 0.07);
    B.add('corrugated', box(31.2, base + 3.85, 31.2, 9.6, 0.04, 9.6, { quat: rq, tint: 0xa89888 }));
    for (let x = 27; x <= 35.4; x += 2.1) B.add('darkMetal', box(x, base + 3.74, 31.2, 0.08, 0.14, 9.4, { quat: rq, tint: 0x4a4a48 }));
    P.pallet(ctx, 29, base, 29, 0.2); P.pallet(ctx, 29, base + 0.15, 29, 0.1); P.crate(ctx, 30.5, base, 33, 0.3, 0.8); P.crate(ctx, 31.4, base, 33.2, 1.0, 0.6); P.crate(ctx, 30.6, base + 0.8, 33, 0.5, 0.55);
    P.drum(ctx, 34, 29, 0.1); P.drum(ctx, 34.7, 29.4, 1.3); P.drum(ctx, 34.3, 30.2, 0.5); P.drum(ctx, 33.4, 34, 0.8, true); P.tireStack(ctx, 28, 34, 4);
    // hesco line + sandbag nests facing the street
    P.hescoRow(ctx, 24.6, 9.5, -Math.PI / 2, 6); P.razorWire(ctx, new THREE.Vector3(24.6, base + 1.37, 9.5), new THREE.Vector3(24.6, base + 1.37, 16.1));
    P.hescoRow(ctx, 25.2, 17.3, 0, 3);
    P.sandbagWall(ctx, new THREE.Vector3(10.5, base, 24.5), new THREE.Vector3(14.5, base, 24.5), 3);
    P.sandbagWall(ctx, new THREE.Vector3(10.3, base, 24.7), new THREE.Vector3(10.3, base, 27.5), 3);
    // stalls (post frame + sagging awning + counter)
    const stall = (x: number, z: number, yaw: number, torn: boolean) => {
      const w = 3.2, d = 2.2;
      for (const [dx, dz] of [[-w / 2, -d / 2], [w / 2, -d / 2], [-w / 2, d / 2], [w / 2, d / 2]]) {
        const px = x + dx * Math.cos(yaw) + dz * Math.sin(yaw), pz = z - dx * Math.sin(yaw) + dz * Math.cos(yaw);
        B.add('darkMetal', box(px, base + 1.15, pz, 0.06, 2.3, 0.06, { tint: 0x3a3a3a }));
      }
      const g = new THREE.PlaneGeometry(w + 0.3, d + 0.3, 8, 6); const pos = g.getAttribute('position') as THREE.BufferAttribute;
      for (let i = 0; i < pos.count; i++) { const px = pos.getX(i), py = pos.getY(i); let zz = -0.18 * Math.cos(px / (w + 0.3) * Math.PI) * Math.cos(py / (d + 0.3) * Math.PI); if (torn && px > 0.6 && py > 0.3) zz -= (px - 0.6) * 0.7; pos.setZ(i, zz); }
      g.computeVertexNormals(); g.rotateX(-Math.PI / 2); g.rotateY(yaw); g.translate(x, base + 2.3, z);
      B.add('awning', prep(g, { uv: 'keep', uvScale: 0.6 }));
      B.add('wood', box(x, base + 0.45, z + 0.6, w - 0.3, 0.9, 0.7, { rotY: yaw, tint: 0x8a7256, segs: [3, 2, 1], aoFn: (_x, y) => 0.72 + 0.28 * THREE.MathUtils.smoothstep(y - base, 0, 0.55) })); this.collideBox(x, base + 0.45, z + 0.6, w - 0.3, 0.9, 0.7, 'wood', yaw);
      // goods: stacked crates behind, sacks and produce boxes on the counter
      const at = (dx: number, dz: number): [number, number] => [x + dx * Math.cos(yaw) + dz * Math.sin(yaw), z - dx * Math.sin(yaw) + dz * Math.cos(yaw)];
      const [bx, bz] = at(-w / 2 + 0.5, -0.5); P.crate(ctx, bx, base, bz, yaw + 0.2, 0.55); P.crate(ctx, bx, base + 0.55, bz, yaw - 0.3, 0.45);
      const [cx2, cz2] = at(w / 2 - 0.6, -0.4); P.crate(ctx, cx2, base, cz2, yaw + 0.5, 0.5);
      for (let i = 0; i < 4; i++) { const [sx2, sz2] = at(-0.9 + i * 0.6, 0.55); B.instanced('sandbag', 'hessian', P.sandbagGeo, new THREE.Matrix4().compose(new THREE.Vector3(sx2, base + 0.98, sz2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw + rng.range(-0.3, 0.3), rng.range(-0.06, 0.06))), new THREE.Vector3(1.15, 1.15, 1.15)), new THREE.Color().setHSL(0.1, 0.28, rng.range(0.36, 0.5)), { uv: 'keep', uvScale: 0.52 }); }
      for (let i = 0; i < 5; i++) { const [px2, pz2] = at(-1.1 + i * 0.5, 0.72); B.add('wood', box(px2, base + 0.96, pz2, 0.36, 0.14, 0.28, { rotY: yaw + rng.range(-0.2, 0.2), tint: rng.pick([0xb08a48, 0x8f6f3c, 0xa8853f]) })); }
      P.aoStrip(ctx, new THREE.Vector3(x, base + 0.004, z + 0.2), new THREE.Vector3(0, 1, 0), new THREE.Vector3(Math.sin(yaw), 0, Math.cos(yaw)), w + 0.4, 0.8, 0.45, 0);
    };
    stall(14, 30, 0.15, true); stall(19.5, 31.5, -0.2, false); stall(21, 26, 1.5, false);
    stall(16.5, 25.5, -1.4, true); stall(26.5, 30.5, 0.9, false);
    // more lot dressing: carts, scaffolding against the E block, ammo crates, laundry over the alley mouth
    P.cart(ctx, 17.5, 28.2, 1.1, base); P.cart(ctx, 24.5, 33.0, -0.4, base);
    P.scaffold(ctx, 23.4, 24.0, -Math.PI / 2, 3, 3, base);
    P.ammoCrate(ctx, 12.4, base, 25.2, 0.4); P.ammoCrate(ctx, 12.4, base + 0.33, 25.2, 0.9, true); P.ammoCrate(ctx, 13.1, base, 25.4, 1.5);
    P.laundryLine(ctx, new THREE.Vector3(9.2, 5.2, 24.5), new THREE.Vector3(9.2, 4.9, 31.5), 5);
    P.shelfUnit(ctx, 27.4, base, 26.6, 0); P.shelfUnit(ctx, 28.5, base, 26.6, 0, 0.06);
    P.table(ctx, 32.5, base, 26.5, 0.6); P.chair(ctx, 33.4, base, 27.3, 2.1); P.chair(ctx, 31.6, base, 25.8, 0.3, true);
    for (const [tx, tz, ty] of [[20, 30, 0.2], [28, 24, 1.4], [15, 24, 0.0]]) P.tireTrack(ctx, tx, tz, ty, 10, base + 0.005);
    for (const [gx, gz] of [[10.5, 33], [34, 25], [20, 22.5]]) P.gravelPatch(ctx, gx, gz, 2.2, 1.6, base + 0.007, 0.7);
    P.dumpster(ctx, 33, 22.5, 0.2); P.tireStack(ctx, 17, 34.5, 3); P.tireFlat(ctx, 15.5, 34, 0.5, 0.2);
    for (const [x, z, rx, rz] of [[16, 27, 3.5, 2.5], [28, 20, 3, 3], [22, 34, 2.5, 2]]) P.dirtPatch(ctx, x, z, rx, rz, base + 0.006, 0.75);
    P.puddle(ctx, 27, 24, 2.6, 1.7, base + 0.008); P.puddle(ctx, 31, 12, 1.8, 1.3, base + 0.008);
    P.debrisField(ctx, 22, 28, 12, 7, 42, base, { bricks: true, chunkScale: 0.7 });
    P.debrisField(ctx, 29, 15, 6, 6, 26, base, { bricks: false, chunkScale: 0.7 });
    P.car(ctx, 30, 19, -1.0, true, 0x877e73, 0.0, base); P.scorch(ctx, 30, 19, 3.5, base + 0.01);
    P.jerseyBarrier(ctx, 11.5, 27.5, 1.57); P.jerseyBarrier(ctx, 11.5, 30.2, 1.57);
    for (const z of [9.4, 12.6, 13.2, 16.2, 17.4, 20.4]) P.pocks(ctx, new THREE.Vector3(23, rng.range(0.7, 3.0), z), new THREE.Vector3(1, 0, 0), rng.range(0.5, 0.9));
  }

  // ------------------------------------------------------------------ perimeter walls, T-walls at the street ends
  private perimeter(): void {
    const ctx = this.ctx, B = this.batch, base = 0.15, h = 3.4;
    const seg = (axis: 'x' | 'z', u0: number, u1: number, b: number, out: 1 | -1) => wall(ctx, { axis, u0, u1, b0: out > 0 ? b : b - 0.4, b1: out > 0 ? b + 0.4 : b, y0: -0.2, y1: base + h, out, openings: [], mat: 'stone', tint: 0xcfc8bb, damage: 0.2, details: false, surface: 'concrete' });
    seg('x', -36.4, 36.4, -36, -1); seg('x', -36.4, 36.4, 36, 1); seg('z', -36, 36, -36, -1); seg('z', -36, 36, 36, 1);
    // T-walls across the four street ends (one gap-less row each) + sandbags
    for (const x of [-6, -3, 0, 3, 6]) { P.tWall(ctx, x, -34.6, 0); P.tWall(ctx, x, 34.6, 0); }
    for (const z of [-4.5, -1.5, 1.5, 4.5]) { P.tWall(ctx, -34.6, z, Math.PI / 2); P.tWall(ctx, 34.6, z, Math.PI / 2); }
    // checkpoint at the south (player) end: hesco + razor wire + sandbag nest
    P.hescoRow(ctx, -6.6, 29.6, 0, 5); P.hescoRow(ctx, 1.4, 29.4, 0, 5);
    P.razorWire(ctx, new THREE.Vector3(-6.6, base + 1.37, 29.6), new THREE.Vector3(-1.1, base + 1.37, 29.6)); P.razorWire(ctx, new THREE.Vector3(1.4, base + 1.37, 29.4), new THREE.Vector3(6.9, base + 1.37, 29.4));
    P.sandbagWall(ctx, new THREE.Vector3(-5.5, 0, 26.5), new THREE.Vector3(-1.5, 0, 26.5), 3); P.sandbagWall(ctx, new THREE.Vector3(-5.7, 0, 26.7), new THREE.Vector3(-5.7, 0, 28.8), 2);
    P.jerseyBarrier(ctx, 3.5, 32.5, 0.3); P.jerseyBarrier(ctx, -3, 32.8, -0.2);
    // north end: rubble barricade + wrecked barrier
    P.jerseyBarrier(ctx, -2, -32, 0.1); P.jerseyBarrier(ctx, 2.5, -32.3, -0.15); P.sandbagWall(ctx, new THREE.Vector3(-5, 0, -30), new THREE.Vector3(-1, 0, -30), 3);
    B.add('rubble', heightField(-6.4, -34.3, 6.4, -30.5, 0.35, (x, z) => Math.max(0, 0.9 * (1 - Math.hypot((x) / 6.0, (z + 33) / 1.6)) * (0.6 + 0.6 * fbm2(x * 0.8, z * 0.8))), { tint: 0xcdc6ba }));
    this.collideBox(0, 0.3, -33, 12, 0.6, 3, 'concrete');
    // east/west cross-street ends
    P.hescoRow(ctx, -33.2, -3.5, -Math.PI / 2, 3); P.sandbagWall(ctx, new THREE.Vector3(31.5, 0, -4.5), new THREE.Vector3(31.5, 0, -0.5), 3); P.drum(ctx, 32.5, 2, 0.2); P.drum(ctx, 33.1, 2.7, 1.1); P.tireStack(ctx, -32, 3, 3);
  }

  // ------------------------------------------------------------------ street props
  private streetProps(): void {
    const ctx = this.ctx, B = this.batch, rng = this.rng;
    // wrecked truck across the west half of the intersection; burnt car on the main street
    P.truck(ctx, -3.5, 2.6, -0.35, 0x5a6e7a, 0.05);
    P.car(ctx, 3.6, 18, 0.3, true, 0x8f867a); P.scorch(ctx, 3.6, 18, 3.4); P.car(ctx, -3.6, -21.5, -0.25, false, 0x8a8f86, 0);
    P.car(ctx, -22, -3.0, -1.35, false, 0xb8b0a0, 0.0); // parked, stripped
    // power poles along the sidewalks + cables (one crossing the street, one dangling)
    const polesE = [[7.9, -30], [7.9, -17], [7.9, 14], [7.9, 27]].map(([x, z]) => P.pole(ctx, x, z, 0));
    const polesW = [[-7.9, -25], [-7.9, 19], [-7.9, 32]].map(([x, z]) => P.pole(ctx, x, z, 0));
    P.cables(ctx, polesE[0], polesE[1]); P.cables(ctx, polesE[2], polesE[3]); P.cables(ctx, polesW[1], polesW[2]);
    P.cables(ctx, polesE[1], [new THREE.Vector3(-8.9, 8.9, -13), new THREE.Vector3(-8.9, 8.6, -13.6), new THREE.Vector3(-8.9, 8.9, -14.2)]);
    P.cables(ctx, polesW[0], [new THREE.Vector3(-8.9, 8.9, -20.5), new THREE.Vector3(-8.9, 8.6, -21), new THREE.Vector3(-8.9, 8.9, -21.5)]);
    P.danglingCable(ctx, polesE[1][2], new THREE.Vector3(6.2, 0, -13.5));
    P.danglingCable(ctx, polesE[2][0], new THREE.Vector3(9.8, 0.15, 14.8));
    P.cables(ctx, polesE[2], [new THREE.Vector3(9.2, 6.4, 12.5), new THREE.Vector3(9.2, 6.2, 13), new THREE.Vector3(9.2, 6.4, 13.5)]);
    // downspouts at facade corners + lamp posts
    const ds: [number, number, number, number][] = [[-8.98, -22.9, 9.87, 1], [-8.98, -9.6, 9.87, 1], [-9.6, -7.98, 9.87, 2], [9.02, 21.3, 6.63, -1], [9.02, 9.6, 6.63, -1], [21.5, 7.98, 6.63, -2], [-8.98, 31.2, 6.63, 1], [-8.98, 14.8, 6.63, 1], [-35.2, 7.98, 6.63, -2], [-10.2, 7.98, 6.63, -2], [-26.98, -9.2, 6.63, -1], [26.02, -9.2, 6.63, 1], [-23.02, -22.9, 9.87, -1], [22.98, -22.9, 9.87, 1]];
    for (const [x, z, h, k] of ds) P.downspout(ctx, x, z, 0.15, h, k === 1 ? new THREE.Vector3(1, 0, 0) : k === -1 ? new THREE.Vector3(-1, 0, 0) : k === 2 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(0, 0, -1));
    P.lampPost(ctx, -7.6, -12, Math.PI / 2 + 0.2, 6.5); P.lampPost(ctx, 7.6, 3.5, -Math.PI / 2, 6.5, 0.12); P.lampPost(ctx, -7.6, 26, Math.PI / 2, 6.5); P.lampPost(ctx, 7.6, -26, -Math.PI / 2, 6.5);
    P.rubbleMound(ctx, -7.9, -17, 1.4, 2.2, 0.55, 0.15); P.rubbleMound(ctx, 8.2, 21, 1.6, 2.6, 0.6, 0.15); P.rubbleMound(ctx, -5.5, -8.5, 1.5, 1.3, 0.4, 0.15); P.rubbleMound(ctx, 12, 6.5, 2.0, 1.4, 0.45, 0.15);
    // sidewalk clutter
    P.drum(ctx, -7.6, 12.5, 0.4); P.drum(ctx, -7.9, 13.2, 1.2); P.drum(ctx, -7.4, 14.0, 0.2, true); P.tireStack(ctx, 7.8, 20, 2); P.pallet(ctx, 7.6, 0.15, 23, 0.3, 0); P.pallet(ctx, 7.9, 0.15, 24.2, 1.2, 0);
    P.bench(ctx, -7.8, -20, 0); P.dumpster(ctx, -7.9, -30.5, 0.05); P.tireFlat(ctx, 2, 10, 0.3); P.tireFlat(ctx, -4.5, -16, 1.2, 0.3);
    P.manhole(ctx, -2.2, 15); P.manhole(ctx, 3.2, -20); P.manhole(ctx, -2.5, -26); P.manhole(ctx, 14, 0.5);
    // street-side market / work clutter (CoD streets are dense): stalls' overflow, carts, scaffolding, crates
    P.cart(ctx, -7.2, 6.5, 1.9); P.cart(ctx, 7.4, -8.5, -1.2); P.cart(ctx, -7.4, -28.0, 0.4);
    P.scaffold(ctx, -8.98, -13.5, Math.PI / 2, 2, 2, 0.15);
    P.scaffold(ctx, 9.02, -11.0, -Math.PI / 2, 2, 3, 0.15);
    P.ammoCrate(ctx, -8.0, 0.15, -6.6, 0.5); P.ammoCrate(ctx, -8.0, 0.48, -6.6, 0.9); P.ammoCrate(ctx, -8.6, 0.15, -6.9, 1.4, true);
    P.ammoCrate(ctx, 7.4, 0.15, 12.6, -0.4); P.ammoCrate(ctx, 7.4, 0.48, 12.6, 0.2);
    // (was a grocery shelving unit full of primary-coloured goods, standing on the open sidewalk — the
    //  "outdoor bookshelf" called in rounds 2 and 3. Street overflow belongs in crates and drums.)
    P.crate(ctx, -7.6, 0.15, 18.0, 0.42, 0.62); P.crate(ctx, -7.55, 0.77, 18.05, 0.18, 0.58);
    P.crate(ctx, -7.9, 0.15, 18.75, 1.15, 0.55); P.pallet(ctx, -7.3, 0.15, 17.1, 1.5, 1.1);
    P.drum(ctx, -7.85, 19.5, 0.8);
    P.mattress(ctx, 7.5, 0.15, -3.5, 0.4, 0x7a7062, 1.35);
    P.laundryLine(ctx, new THREE.Vector3(-8.9, 6.4, -19.0), new THREE.Vector3(-8.9, 6.1, -12.5), 4);
    P.laundryLine(ctx, new THREE.Vector3(9.1, 5.6, 17.6), new THREE.Vector3(9.1, 5.3, 21.6), 3);
    // facade satellite dishes / AC clusters over the street (silhouette clutter)
    for (const [dx, dz, dy, dyaw] of [[-8.9, -16.4, 6.6, -1.3], [-8.9, -11.2, 3.4, -1.9], [9.1, 10.6, 6.4, 1.5], [9.1, 18.4, 3.6, 2.2], [-8.9, 20.5, 6.5, -1.6], [26.1, -12.0, 6.8, 1.2], [-26.1, -14.0, 6.6, -1.4]]) P.satelliteDish(ctx, dx, dy, dz, dyaw);
    for (const [ax, az, ay, ayaw] of [[-8.82, -19.6, 6.0, -Math.PI / 2], [9.18, 13.4, 6.2, Math.PI / 2], [9.18, 20.2, 3.2, Math.PI / 2], [-8.82, 24.8, 3.4, -Math.PI / 2], [-8.82, -25.2, 3.3, -Math.PI / 2]]) P.acUnit(ctx, ax, ay, az, ayaw);
    // sandbag fighting positions at both intersection corners + ammo
    P.sandbagWall(ctx, new THREE.Vector3(6.4, 0.15, -6.2), new THREE.Vector3(8.6, 0.15, -6.2), 3);
    P.sandbagWall(ctx, new THREE.Vector3(8.6, 0.15, -6.4), new THREE.Vector3(8.6, 0.15, -8.4), 2);
    P.ammoCrate(ctx, 7.6, 0.15, -7.6, 0.2);
    P.sandbagWall(ctx, new THREE.Vector3(-6.6, 0.15, 6.4), new THREE.Vector3(-8.6, 0.15, 6.4), 3);
    // ground story on the asphalt: tyre tracks and oil where the vehicles stand
    // (kept clear of the crater rect: a flat track decal draped across a 1 m deep bowl reads as a disc lying over it)
    for (const [tx, tz, ty, tl] of [[0, 18, 0, 14], [2.4, -20, 0.04, 20], [-3.2, 26, 0, 14], [-14, 1.5, 1.57, 20], [16, 2.5, 1.57, 20]]) P.tireTrack(ctx, tx, tz, ty, tl, 0.004);
    for (const [ox, oz, orr] of [[-5.6, 8.0, 0.9], [3.5, -16, 0.7], [-20, 2.5, 0.8], [12.5, -2.0, 0.6]]) P.oilStain(ctx, ox, oz, orr, 0.006);
    for (const [gx, gz, grx, grz] of [[-7.9, -10, 1.1, 6], [7.9, 8, 1.1, 6], [-7.9, 22, 1.0, 5], [7.9, -22, 1.0, 5], [-6.6, -14, 1.2, 4], [6.6, 12, 1.2, 4]]) P.gravelPatch(ctx, gx, gz, grx, grz, 0.007, 0.65);
    // sandbag position at the NW intersection corner + a jersey barrier pair mid-street
    P.sandbagWall(ctx, new THREE.Vector3(-8.7, 0.15, -6.0), new THREE.Vector3(-5.2, 0.15, -6.0), 3); P.sandbagWall(ctx, new THREE.Vector3(-8.7, 0.15, -6.3), new THREE.Vector3(-8.7, 0.15, -8.0), 2);
    P.jerseyBarrier(ctx, -1.5, 12, 0.2); P.jerseyBarrier(ctx, 1.2, 12.4, -0.1);
    // west alley
    P.dumpster(ctx, -24.6, -14, 0.08); P.drum(ctx, -25.2, -18, 0.6); P.drum(ctx, -25.4, -18.8, 1.4); P.tireStack(ctx, -23.8, -22.5, 3); P.pallet(ctx, -25.4, 0.15, -11, 1.57, 1.2); P.crate(ctx, -24, 0.15, -26, 0.4, 0.6); P.crate(ctx, -24.9, 0.15, -27, 0.9, 0.5);
    P.acUnit(ctx, -25.82, 2.9, -12, Math.PI / 2); P.acUnit(ctx, -23.18, 2.6, -20, -Math.PI / 2);
    P.cables(ctx, [new THREE.Vector3(-23.2, 6.5, -16)], [new THREE.Vector3(-25.8, 6.2, -16.5)]);
    P.puddle(ctx, -24.5, -21, 1.3, 2.4, 0.158); P.dirtPatch(ctx, -24.5, -9.5, 1.4, 1.8, 0.156, 0.7);
    P.debrisField(ctx, -24.5, -20, 1.3, 12, 42, 0.15, { bricks: true, chunkScale: 0.7 });
    for (const z of [-28.4, -27.2, -22.2, -21.4, -16.6, -12.2, -9.2]) P.pocks(ctx, new THREE.Vector3(-26, rng.range(0.7, 3.0), z), new THREE.Vector3(1, 0, 0), rng.range(0.5, 0.9));
    // east alley (blocked by a gate halfway) & back lots
    P.dumpster(ctx, 24.5, -16, -0.1); P.drum(ctx, 25.3, -20, 0.2); P.crate(ctx, 24, 0.15, -25, 0.3, 0.7); P.tireStack(ctx, 25.2, -28, 2);
    B.add('darkMetal', box(24.5, 1.4, -22, 3, 2.5, 0.06, { tint: 0x3a4a4a })); this.collideBox(24.5, 1.4, -22, 3, 2.5, 0.06, 'metal');
    P.sandbagWall(ctx, new THREE.Vector3(-10, 0.15, -27), new THREE.Vector3(-13.5, 0.15, -27), 3); P.drum(ctx, -15, -29, 0.4); P.drum(ctx, -15.8, -28.6, 1.4); P.pallet(ctx, -20, 0.15, -30, 0.5); P.tireStack(ctx, -12, -33, 3); P.crate(ctx, -18, 0.15, -33, 0.2, 0.7);
    B.add('rubble', heightField(-21, -35.5, -13, -29.5, 0.35, (x, z) => 0.15 + Math.max(0, 1.1 * (1 - Math.hypot((x + 17) / 3.6, (z + 32.5) / 2.6)) * (0.6 + 0.6 * fbm2(x * 0.7, z * 0.7))), { tint: 0xcdc6ba }));
    this.collideBox(-17, 0.5, -32.5, 6, 0.7, 4.5, 'concrete');
    P.debrisField(ctx, -17, -31, 5, 3, 22, 0.15, { bricks: true });
    P.jerseyBarrier(ctx, 15, -28, 0.4); P.drum(ctx, 20, -32, 0.1); P.drum(ctx, 20.8, -31.5, 0.8); P.pallet(ctx, 12, 0.15, -32, 1.0); P.crate(ctx, 16, 0.15, -33, 0.6, 0.65);
    P.hescoRow(ctx, 27, -33, 0, 4); P.tireStack(ctx, 33, -32, 3); P.drum(ctx, -30, -33, 0.2); P.pallet(ctx, -33, 0.15, -33, 0.3);
    // ground decals on the streets
    for (const [x, z, rx, rz] of [[-3, 22, 3, 2], [4, -24, 2.5, 3.5], [-4, -12, 2, 2.5], [-14, 2, 3, 2], [16, 2.5, 3, 2], [-1, 30, 3.5, 2]]) P.dirtPatch(ctx, x, z, rx, rz, 0.006, 0.75);
    for (const [x, z, rx, rz] of [[2.5, -13, 2.4, 1.6], [-3.2, 8.5, 2.0, 1.3], [5, 6.5, 1.5, 2.2], [-12, 3.5, 2.8, 1.5], [-1, -22, 1.8, 1.2], [18, -2.5, 2.2, 1.4]]) P.puddle(ctx, x, z, rx, rz);
    P.debrisField(ctx, 0, -1, 7, 6, 85, 0, { bricks: true, chunkScale: 1.1 });
    P.debrisField(ctx, 0, 15, 5, 12, 45, 0, { bricks: false, chunkScale: 0.8 });
    P.debrisField(ctx, 0, -20, 5, 10, 50, 0, { bricks: false, chunkScale: 0.8 });
    P.debrisField(ctx, -20, 0, 12, 4, 40, 0, { bricks: true, chunkScale: 0.8 });
    P.debrisField(ctx, 20, 0, 12, 4, 35, 0, { bricks: true, chunkScale: 0.8 });
    P.debrisField(ctx, -7.8, 0, 1.0, 34, 40, 0.15, { bricks: false, chunkScale: 0.6 });
    P.debrisField(ctx, 7.8, 0, 1.0, 34, 40, 0.15, { bricks: false, chunkScale: 0.6 });
  }

  // ------------------------------------------------------------------ skyline beyond the walls
  /**
   * The city outside the block. Three rings of atlas-textured blocks (per-bay windows, balconies, parapets,
   * roof furniture) plus landmarks. Aerial perspective is the render module's job — nothing here fakes fog;
   * the only distance cue baked in is a slight tint lift so the far ring doesn't read as the same value as the near one.
   */
  private skyline(): void {
    const ctx = this.ctx, rng = this.rng;
    // Ring 0: the immediate neighbours just past the perimeter wall — same architecture as the level, low, dense.
    P.cityRing(ctx, 46, 62, 22, [8, 17], 0, { ground: true, roadGap: 11 });
    // Ring 1: mid city, taller, a few towers.
    P.cityRing(ctx, 68, 104, 26, [12, 26], 4, { ground: false, roadGap: 14 });
    // Ring 2: far city — towers dominate the silhouette.
    P.cityRing(ctx, 112, 175, 28, [16, 34], 8, { ground: false, roadGap: 20 });
    // Ring 3: a low haze-line of blocks so the horizon isn't empty between towers.
    P.cityRing(ctx, 190, 265, 15, [14, 30], 5, { ground: false, roadGap: 26 });
    // Landmarks: mosque + minarets, water tower, cranes over a construction site, pylon line, chimney.
    P.mosque(ctx, -78, 66, 0.3);
    P.minaret(ctx, 88, -96, 40); P.minaret(ctx, -142, 44, 34);
    P.waterTower(ctx, -92, -48);
    P.crane(ctx, 104, 62, 0.6); P.crane(ctx, -66, -124, -0.3); P.crane(ctx, 150, -40, 2.1);
    P.smokestack(ctx, -168, -120, 52); P.smokestack(ctx, -158, -128, 40);
    for (let i = 0; i < 5; i++) P.pylon(ctx, 120 + i * 46, -150 - i * 26, 0.4);
    // A few isolated blocks breaking the ring pattern near the corners.
    for (let i = 0; i < 8; i++) {
      const a = rng.range(0, Math.PI * 2), r = rng.range(64, 150);
      const x = Math.cos(a) * r, z = Math.sin(a) * r;
      if (Math.abs(x) < 22 || Math.abs(z) < 22) continue;
      P.distantBuilding(ctx, x, z, rng.range(12, 20), rng.range(12, 18), rng.range(9, 20), rng.range(-0.5, 0.5), P.SKY_STYLES[rng.int(0, 3)], { setback: true, furniture: rng.int(2, 4) });
    }
  }

  /**
   * Keep the skyline's aerial perspective locked to the sky's horizon colour so the distant city dissolves into
   * the same haze at day and at dusk (a constant colour reads as a pink-brown band at sunset).
   */
  private followSky(): void {
    const sky = this.engine.get<System & { state: { fog: { color: THREE.Color }; sunDir: THREE.Vector3 }; onChange: ((s: unknown) => void)[] }>('sky');
    if (!sky || !this.applySkyHaze) return;
    const litMesh = this.batch.meshes.find((m) => m.name === 'static:skylineLit');
    const apply = () => {
      this.applySkyHaze?.(sky.state.fog.color.clone().multiplyScalar(1.35));
      // Window lights come up as the sun drops through the last 12 degrees and are full at/below the horizon.
      const e = 1 - THREE.MathUtils.smoothstep(sky.state.sunDir.y, 0.02, 0.21);
      if (this.litMat) this.litMat.color.setRGB(e * 0.92, e * 0.60, e * 0.31);
      if (litMesh) litMesh.visible = e > 0.02;
    };
    apply();
    sky.onChange.push(apply);
  }

  /**
   * Enterable rooms, as axis-aligned boxes, handed to render/Lighting so indirect light is darkened and
   * warmed inside them (the exterior exposure then reads 2-3 stops brighter through doors and windows).
   * One box per floor plate, inset to the inner face of the exterior walls.
   */
  private registerInteriors(): void {
    const lighting = this.engine.get<System & { setInteriorVolumes(b: THREE.Box3[]): void; setAmbientBounds(b: THREE.Box3): void }>('lighting');
    if (!lighting) return;
    const base = 0.15, boxes: THREE.Box3[] = [];
    const floors = (x0: number, z0: number, x1: number, z1: number, n: number, headroom = FH - SLAB) => {
      for (let k = 0; k < n; k++) {
        const y = base + k * FH;
        boxes.push(new THREE.Box3(new THREE.Vector3(x0 + T, y - 0.1, z0 + T), new THREE.Vector3(x1 - T, y + headroom, z1 - T)));
      }
    };
    floors(-23, -24, -9, -8, 3);      // A
    floors(9, 8, 23, 22, 2);          // E
    floors(9, -24, 23, -16, 3);       // C (rear rooms; the front half is open to the sky)
    floors(-36, -30, -26, -8, 2);     // B
    floors(26, -30, 36, -8, 2);       // D
    floors(-36, 8, -9, 14, 2);        // courtyard north wing
    floors(-14, 14, -9, 32, 2);       // courtyard east wing
    boxes.push(new THREE.Box3(new THREE.Vector3(-36 + T, -0.1, 14 + T), new THREE.Vector3(-31 - T, base + 2.9, 32 - T)));  // west sheds
    boxes.push(new THREE.Box3(new THREE.Vector3(-36 + T, -0.1, 32 + T), new THREE.Vector3(-14 - T, base + 3.1, 36 - T)));  // south storage
    lighting.setInteriorVolumes(boxes);
    lighting.setAmbientBounds(this.bounds);
  }

  // ------------------------------------------------------------------ gameplay data
  private spawnsAndLandmarks(): void {
    const v = (x: number, y: number, z: number) => new THREE.Vector3(x, y, z);
    this.spawnPoints = [v(0, 1.1, 33), v(-3, 1.1, 31)];
    // not visible from the spawn: interiors, alleys, courtyard, back lots, upper floors
    this.enemySpawns = [
      v(-19, 1.25, -20), v(-12, 1.25, -20),                   // A ground floor rear
      v(-24.5, 1.25, -20), v(-16, 1.25, -31),                 // west alley, back lot
      v(16, 1.25, -20), v(24.5, 1.25, -18),                   // C rear, east alley
      v(-22, 1.25, 24), v(-26, 1.25, 18), v(-30, 1.25, 11),   // courtyard, N wing
      v(19, 1.25, 18), v(13, 1.25, 12),                       // E interior
      v(31, 1.25, 31), v(30, 1.25, 12),                       // market shed, east lot
      v(-15, 0.15 + 2 * FH + 1.1, -18), v(16, 0.15 + FH + 1.1, -20), v(-11.5, 0.15 + FH + 1.1, 17), // upper floors
      v(-31, 1.25, -20), v(31, 1.25, -20),                    // B, D ground floors
    ];
    const L = (x: number, y: number, z: number, yaw: number, pitch: number) => ({ position: v(x, y, z), yaw, pitch });
    this.landmarks = {
      street: L(-4.6, 1.1, 23, -0.32, 0.02),
      intersection: L(7.9, 1.25, 7.4, 0.74, -0.03),
      // Interior: stood back in the pharmacy looking straight out through the open shopfront onto the sunlit
      // main street, with the shell hole in the slab overhead. The old framing looked at an inside corner, so
      // every opening in shot led to another interior and the exposure model had no sunlit surface to expose
      // for — the room could only ever be flat. Foreground: shelving, the counter and the debris pile, all
      // silhouetted against the opening.
      interior: L(-15.1, 1.25, -13.4, -1.62, 0.05),
      alley: L(-24.5, 1.25, -9.0, 0.0, 0.06),
      rooftop: L(-11.6, 0.15 + 3 * FH + 1.1, -11.2, -2.2, -0.24),
      courtyard: L(-15.6, 1.25, 16.4, 2.05, -0.02),
      rubble: L(13.2, 1.1, -3.6, -0.18, 0.14),
      detail: L(-7.4, 1.25, -20.3, 1.15, 0.14),
      spawn: L(0, 1.1, 33, 0, -0.03),
    };
  }
  private navSeeds(): THREE.Vector3[] {
    const s: THREE.Vector3[] = [];
    // stair treads and landings for every stairwell (nw of A, se of E, ne of C, s of E2)
    const wells: [number, number, number, number, number][] = [[-22.65, -19.55, -1, 0.15, 3], [20.05, 17.55, 1, 0.15, 2], [20.05, -19.55, -1, 0.15, 3], [-13.65, 27.55, 1, 0.15, 2]];
    for (const [x0, zNear, dir, base, floors] of wells) {
      for (let f = 0; f < floors; f++) {
        const y = base + f * FH;
        for (let k = 0; k < 9; k += 2) s.push(new THREE.Vector3(x0 + 0.62, y + (k + 1) * 0.18, zNear + dir * (0.3 + (k + 0.5) * 0.28)), new THREE.Vector3(x0 + 1.98, y + 1.62 + (k + 1) * 0.18, zNear + dir * (0.3 + 2.52 - (k + 0.5) * 0.28)));
        s.push(new THREE.Vector3(x0 + 1.3, y + 1.62, zNear + dir * 3.4), new THREE.Vector3(x0 + 1.98, y + FH, zNear + dir * 0.1), new THREE.Vector3(x0 + 1.95, y, zNear - dir * 0.9));
      }
    }
    // rubble slope centreline
    for (let z = -6; z >= -16; z -= 1.5) s.push(new THREE.Vector3(16, 4, z), new THREE.Vector3(12, 4, z), new THREE.Vector3(20, 4, z));
    return s;
  }
  private registerPoses(): void {
    const teleport = (name: string) => (engine: Engine) => {
      const lm = this.landmarks[name];
      engine.get<PlayerApi>('player')?.teleport(lm.position.clone(), lm.yaw, lm.pitch);
    };
    const poses: [string, string][] = [
      ['world_street', 'Main street looking north to the intersection'],
      ['world_intersection', 'Bombed-out intersection: crater, wrecked truck, collapsed block'],
      ['world_interior', 'Pharmacy ground floor of building A, shell hole in the ceiling'],
      ['world_alley', 'West alley between A and B'],
      ['world_rooftop', 'Roof of A over the parapet toward the intersection'],
      ['world_courtyard', 'Courtyard behind the SW complex'],
      ['world_rubble', 'Rubble slope of the collapsed building C'],
      ['world_detail', 'Close-up: plaster, brick, sill, shutter, pocks'],
    ];
    for (const [name, description] of poses) registerPose({ name, description, apply: teleport(name.slice(6)), settleFrames: 30 });
  }
}
