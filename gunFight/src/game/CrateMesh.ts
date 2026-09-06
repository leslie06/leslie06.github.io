import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CRATE_UV, atlasBoxUv, crateTextures, markingTexture, tint, type Rect } from './PropArt';

/**
 * The resupply crate: a stamped-steel ammunition box with a gasketed lid, corner angle iron,
 * draw latches, folding end handles, rubber feet and stencilled lot markings — plus the two
 * pieces of the "this is a resupply point" language: a recessed LED status strip on the box and
 * a painted floor marking with a thin emissive charge ring on top of it.
 *
 * Nothing here spins, bobs or floats. Everything is either a physical part of the prop or a
 * ground-projected marking, which is how a modern military shooter reads a resupply point.
 */

export const CRATE = {
  /** Body footprint / height (m). */
  w: 0.98, d: 0.52, bodyH: 0.40,
  /** Rubber feet lift. */
  footH: 0.035,
  lidH: 0.085,
  /** Overall height including lid. */
  get top(): number { return this.footH + this.bodyH + 0.013 + this.lidH; },
  /** Diameter of the painted floor marking. */
  markSize: 1.85,
  /** Spare ammo can standing beside the crate (local space; Pickups gives it its own collider). */
  can: { w: 0.31, h: 0.214, d: 0.16, dx: 0.76, dz: 0.34, yaw: -0.55 },
};

export interface CrateGeometry {
  paint: THREE.BufferGeometry;
  metal: THREE.BufferGeometry;
  dark: THREE.BufferGeometry;
  status: THREE.BufferGeometry;
}

const R = (rect: Rect) => () => rect;

/** RoundedBoxGeometry is non-indexed while the primitives are indexed; mergeGeometries needs one or the other. */
const flat = (g: THREE.BufferGeometry): THREE.BufferGeometry => (g.index ? g.toNonIndexed() : g);

/** Build the crate once; every crate instance shares these buffers. */
export function buildCrateGeometry(): CrateGeometry {
  const { w: W, d: D, bodyH: BH, footH: FY, lidH: LH } = CRATE;
  const paint: THREE.BufferGeometry[] = [];
  const metal: THREE.BufferGeometry[] = [];
  const dark: THREE.BufferGeometry[] = [];
  const status: THREE.BufferGeometry[] = [];

  const bodyY = FY + BH / 2;
  const gasketY = FY + BH + 0.0065;
  const lidY = FY + BH + 0.013 + LH / 2;

  // ---- painted shell -----------------------------------------------------
  // body: long sides get the stencil block, ends get the unit marking, top/bottom plain
  const body = new RoundedBoxGeometry(W, BH, D, 2, 0.010);
  atlasBoxUv(body, [W, BH, D], (a) => (a === 4 || a === 5 ? CRATE_UV.long : a === 0 || a === 1 ? CRATE_UV.end : CRATE_UV.plain));
  body.translate(0, bodyY, 0);
  paint.push(body);

  // lid: overhangs 15 mm all round, top carries the "AMMUNITION" stencil
  const lid = new RoundedBoxGeometry(W + 0.030, LH, D + 0.030, 2, 0.008);
  atlasBoxUv(lid, [W + 0.030, LH, D + 0.030], (a) => (a === 2 ? CRATE_UV.lid : CRATE_UV.plain));
  lid.translate(0, lidY, 0);
  paint.push(lid);

  // stiffening ribs pressed into the lid, either side of the stencil
  for (const sz of [-1, 1]) {
    const rib = new RoundedBoxGeometry(W - 0.10, 0.008, 0.020, 1, 0.003);
    atlasBoxUv(rib, [W - 0.10, 0.008, 0.020], R(CRATE_UV.plain));
    rib.translate(0, lidY + LH / 2, sz * (D / 2 - 0.045));
    paint.push(rib);
  }
  // stacking lugs at the lid corners (crates stack in the field)
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const lug = new RoundedBoxGeometry(0.070, 0.010, 0.055, 1, 0.004);
    atlasBoxUv(lug, [0.070, 0.010, 0.055], R(CRATE_UV.plain));
    lug.translate(sx * (W / 2 - 0.075), lidY + LH / 2, sz * (D / 2 - 0.062));
    paint.push(lug);
  }

  // ---- gasket seam + rubber feet ----------------------------------------
  const gasket = new THREE.BoxGeometry(W - 0.004, 0.013, D - 0.004);
  gasket.translate(0, gasketY, 0);
  dark.push(tint(gasket, 0x141412));
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const foot = new RoundedBoxGeometry(0.090, FY, 0.080, 1, 0.006);
    foot.translate(sx * (W / 2 - 0.075), FY / 2, sz * (D / 2 - 0.070));
    dark.push(tint(foot, 0x1b1b19));
  }

  // ---- steel hardware ----------------------------------------------------
  const STEEL = 0x7c8078, DARKSTEEL = 0x3c3e37, LATCH = 0x585b50, BRASSY = 0x9a8656;

  // Corner angle iron, corner caps and the bottom rim are painted the same colour as the shell —
  // bare metal here went pure black on the shadow side and read as a hole in the prop.
  const plain = (g: THREE.BufferGeometry, size: [number, number, number]): THREE.BufferGeometry => {
    atlasBoxUv(g, size, R(CRATE_UV.plain), 0.30);
    return g;
  };
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const legA = new THREE.BoxGeometry(0.075, BH + 0.012, 0.012);
    legA.translate(sx * (W / 2 - 0.0375), bodyY, sz * (D / 2 + 0.005));
    const legB = new THREE.BoxGeometry(0.012, BH + 0.012, 0.075);
    legB.translate(sx * (W / 2 + 0.005), bodyY, sz * (D / 2 - 0.0375));
    paint.push(plain(legA, [0.075, BH, 0.012]), plain(legB, [0.012, BH, 0.075]));
    const cap = new THREE.BoxGeometry(0.082, 0.015, 0.082);
    cap.translate(sx * (W / 2 - 0.035), FY + BH + 0.004, sz * (D / 2 - 0.035));
    paint.push(plain(cap, [0.082, 0.015, 0.082]));
  }
  for (const sz of [-1, 1]) {
    const g = new THREE.BoxGeometry(W + 0.014, 0.018, 0.013);
    g.translate(0, FY + 0.011, sz * (D / 2 + 0.005));
    paint.push(plain(g, [W, 0.018, 0.013]));
  }

  // draw latches on the front (+z) face: keeper on the body, lever hooking over the lid lip
  for (const sx of [-1, 1]) {
    const x = sx * 0.30, z = D / 2;
    const plate = new RoundedBoxGeometry(0.058, 0.062, 0.009, 1, 0.003);
    plate.translate(x, FY + BH - 0.040, z + 0.0045);
    const lever = new RoundedBoxGeometry(0.042, 0.052, 0.013, 1, 0.004);
    lever.rotateX(-0.09); lever.translate(x, FY + BH + 0.004, z + 0.012);
    const hook = new THREE.BoxGeometry(0.026, 0.026, 0.008);
    hook.translate(x, FY + BH + 0.030, z + 0.017);
    const pin = new THREE.CylinderGeometry(0.005, 0.005, 0.064, 8);
    pin.rotateZ(Math.PI / 2); pin.translate(x, FY + BH - 0.064, z + 0.007);
    metal.push(tint(plate, DARKSTEEL), tint(lever, LATCH), tint(hook, LATCH), tint(pin, BRASSY));
  }
  // hinges on the back (-z)
  for (const sx of [-1, 1]) {
    const x = sx * 0.30, z = -D / 2;
    const barrel = new THREE.CylinderGeometry(0.010, 0.010, 0.085, 10);
    barrel.rotateZ(Math.PI / 2); barrel.translate(x, gasketY, z - 0.010);
    const leaf = new THREE.BoxGeometry(0.075, 0.052, 0.008);
    leaf.translate(x, gasketY - 0.026, z - 0.004);
    metal.push(tint(barrel, STEEL), tint(leaf, DARKSTEEL));
  }

  // folding drop handles on both ends
  for (const sx of [-1, 1]) {
    const x = sx * (W / 2 + 0.010);
    for (const sz of [-1, 1]) {
      const lug = new THREE.BoxGeometry(0.016, 0.038, 0.018);
      lug.translate(x, FY + BH - 0.072, sz * 0.085);
      metal.push(tint(lug, DARKSTEEL));
    }
    // U-shaped drop handle hanging off the two lugs, protruding ~35 mm from the face
    const y0 = FY + BH - 0.078;
    const bend = sx * 0.036;
    const path = new THREE.CatmullRomCurve3([
      new THREE.Vector3(x, y0, -0.085),
      new THREE.Vector3(x + bend * 0.8, y0 - 0.030, -0.080),
      new THREE.Vector3(x + bend, y0 - 0.048, -0.045),
      new THREE.Vector3(x + bend, y0 - 0.050, 0),
      new THREE.Vector3(x + bend, y0 - 0.048, 0.045),
      new THREE.Vector3(x + bend * 0.8, y0 - 0.030, 0.080),
      new THREE.Vector3(x, y0, 0.085),
    ], false, 'catmullrom', 0.4);
    const bar = new THREE.TubeGeometry(path, 24, 0.0072, 7, false);
    metal.push(tint(bar, STEEL));
  }

  // ---- spare ammo can standing beside the crate --------------------------
  {
    const cw = CRATE.can.w, ch = 0.19, cd = CRATE.can.d;
    const cx = CRATE.can.dx, cz = CRATE.can.dz, cy = 0.005, ryaw = CRATE.can.yaw;
    const grp: THREE.BufferGeometry[] = [];
    const can = new RoundedBoxGeometry(cw, ch, cd, 2, 0.007);
    atlasBoxUv(can, [cw, ch, cd], R(CRATE_UV.plain), 0.30);
    can.translate(0, ch / 2, 0); grp.push(can);
    const clid = new RoundedBoxGeometry(cw + 0.014, 0.024, cd + 0.014, 1, 0.005);
    atlasBoxUv(clid, [cw + 0.014, 0.024, cd + 0.014], R(CRATE_UV.plain), 0.30);
    clid.translate(0, ch + 0.010, 0); grp.push(clid);
    for (const g of grp) { g.rotateY(ryaw); g.translate(cx, cy, cz); paint.push(g); }
    // folding carry handle across the top
    const hp = new THREE.CatmullRomCurve3([
      new THREE.Vector3(-cw * 0.30, ch + 0.022, 0),
      new THREE.Vector3(-cw * 0.20, ch + 0.062, 0),
      new THREE.Vector3(0, ch + 0.072, 0),
      new THREE.Vector3(cw * 0.20, ch + 0.062, 0),
      new THREE.Vector3(cw * 0.30, ch + 0.022, 0),
    ], false, 'catmullrom', 0.4);
    const handle = new THREE.TubeGeometry(hp, 18, 0.0060, 6, false);
    handle.rotateY(ryaw); handle.translate(cx, cy, cz);
    metal.push(tint(handle, STEEL));
    const clasp = new THREE.BoxGeometry(0.030, 0.040, 0.010);
    clasp.translate(0, ch - 0.010, cd / 2 + 0.004);
    clasp.rotateY(ryaw); clasp.translate(cx, cy, cz);
    metal.push(tint(clasp, DARKSTEEL));
  }

  // ---- status strip + beacon (the only emissive parts) -------------------
  // recessed housing under the lid overhang so the strip sits in shade
  for (const sz of [-1, 1]) {
    const housing = new THREE.BoxGeometry(0.36, 0.026, 0.010);
    housing.translate(0, FY + BH - 0.016, sz * (D / 2 + 0.004));
    metal.push(tint(housing, 0x24261f));
    const lens = new THREE.BoxGeometry(0.330, 0.011, 0.006);
    lens.translate(0, FY + BH - 0.016, sz * (D / 2 + 0.008));
    status.push(lens);
  }
  // low-profile beacon on the lid corner
  const base = new THREE.CylinderGeometry(0.019, 0.021, 0.014, 12);
  base.translate(-W / 2 + 0.075, lidY + LH / 2 + 0.007, D / 2 - 0.062);
  metal.push(tint(base, 0x1e201b));
  const dome = new THREE.SphereGeometry(0.016, 12, 8, 0, Math.PI * 2, 0, Math.PI / 2);
  dome.translate(-W / 2 + 0.075, lidY + LH / 2 + 0.013, D / 2 - 0.062);
  status.push(dome);

  return {
    paint: mergeGeometries(paint.map(flat), false)!,
    metal: mergeGeometries(metal.map(flat), false)!,
    dark: mergeGeometries(dark.map(flat), false)!,
    status: mergeGeometries(status.map(flat), false)!,
  };
}

export interface CrateMaterials {
  paint: THREE.MeshStandardMaterial;
  metal: THREE.MeshStandardMaterial;
  dark: THREE.MeshStandardMaterial;
  marking: THREE.MeshStandardMaterial;
}

export function crateMaterials(aniso: number): CrateMaterials {
  const t = crateTextures(aniso);
  const paint = new THREE.MeshStandardMaterial({
    map: t.map, normalMap: t.normalMap, roughnessMap: t.roughnessMap, aoMap: t.aoMap,
    aoMapIntensity: 0.85, roughness: 1, metalness: 0.2,
    normalScale: new THREE.Vector2(1.1, 1.1),
  });
  const metal = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.5, metalness: 0.8 });
  const dark = new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, roughness: 0.88, metalness: 0.05 });
  const marking = new THREE.MeshStandardMaterial({
    map: markingTexture(aniso), transparent: true, roughness: 0.82, metalness: 0,
    depthWrite: false, polygonOffset: true, polygonOffsetFactor: -6, polygonOffsetUnits: -6,
    side: THREE.FrontSide,
  });
  return { paint, metal, dark, marking };
}

/** Emissive LED material — one per crate so cooldown state animates independently. */
export function statusMaterial(): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({
    color: 0x121512, emissive: new THREE.Color(0x7fe08a), emissiveIntensity: 1.15,
    roughness: 0.25, metalness: 0, toneMapped: true,
  });
}

const GLOW_VERT = /* glsl */`
varying vec2 vUvG;
varying float vFogDepth;
void main() {
  vUvG = uv;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vFogDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}`;

const GLOW_FRAG = /* glsl */`
uniform vec3 uColor;
uniform float uTime;
uniform float uAlpha;
uniform float uCharge;
uniform vec3 fogColor;
uniform float fogDensity;
varying vec2 vUvG;
varying float vFogDepth;

void main() {
  vec2 p = vUvG * 2.0 - 1.0;
  float r = length(p);
  if (r > 1.0) discard;
  float ang = atan(p.y, p.x);
  float t = fract((ang + 3.14159265) / 6.28318531);

  // four arcs with gaps on the diagonals, matching the painted marking underneath
  float seg = abs(fract(t * 4.0 + 0.5) - 0.5) * 2.0;
  float gap = smoothstep(0.05, 0.22, seg);
  float d = (r - 0.795) / 0.026;
  float ring = exp(-d * d) * gap;

  // charge readout: the ring lights up as the crate comes back online
  float lit = mix(0.14, 1.0, step(t, uCharge));

  // slow sweep so the marker breathes without spinning
  float s = fract(t - uTime * 0.10);
  float sd = min(s, 1.0 - s) / 0.055;
  float sweep = exp(-sd * sd);

  // very faint pool of light inside the ring
  float pool = exp(-pow(r / 0.85, 3.0)) * 0.045;

  float a = (ring * (0.85 + 0.6 * sweep) * lit + pool * uCharge) * uAlpha;
  float fogF = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
  a *= clamp(1.0 - fogF, 0.0, 1.0);
  gl_FragColor = vec4(uColor, a);
}`;

/** Additive charge ring drawn over the painted marking. One material per crate (own uniforms). */
export function glowMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uColor: { value: new THREE.Color(0xffb050) },
        uTime: { value: 0 },
        uAlpha: { value: 0.5 },
        uCharge: { value: 1 },
      },
    ]),
    vertexShader: GLOW_VERT,
    fragmentShader: GLOW_FRAG,
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    fog: true,
    side: THREE.FrontSide,
  });
}
