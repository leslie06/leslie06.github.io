import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import { CG, groups } from '../core/Physics';

/**
 * "How much sky can this point see" as a coarse 3D grid, used to occlude *indirect* light (IBL +
 * hemisphere) per world position.
 *
 * Why a volume and not a global multiplier: an interior is dark because the walls block the sky dome,
 * not because the whole scene got darker. Scaling `scene.environmentIntensity` while the camera is
 * indoors also darkens the sunlit street seen through the doorway, which kills the one thing that makes
 * an interior read as an interior (2-3 stops of contrast between the room and the opening, ref_09).
 *
 * Build: one upward physics ray per cell (world colliders only). No hit within `maxRay` = open sky;
 * a hit at distance d fades in over 2..9 m so a high ceiling still lets some light in. The grid is then
 * blurred so doorways and window openings gradient instead of stepping.
 *
 * Use: `install()` injects a sampler into every lit material (chained after CSM's hook) that scales
 * `irradiance` / `iblIrradiance` / `radiance` after `<lights_fragment_maps>`, i.e. indirect only -
 * direct sunlight through an opening keeps full strength, which is what draws the light shaft on the floor.
 *
 * Cost: one 3D texture fetch per lit fragment; the build is a one-off (~25k raycasts, tens of ms) that
 * runs on the first frame after the level exists.
 */
export interface AmbientVolumeUniforms {
  uAmbTex: { value: THREE.Data3DTexture | null };
  uAmbMin: { value: THREE.Vector3 };
  uAmbInvSize: { value: THREE.Vector3 };
  /** 0 disables the whole effect (no volume built yet). */
  uAmbStrength: { value: number };
  /**
   * Indirect scale in a fully enclosed cell: IBL (the sky dome, mostly blocked) and the hemisphere term
   * (which stands in for bounce off the floor, so it survives much better). Not 0 - a real room is lit by
   * light that entered somewhere and bounced, and this is the cheap stand-in for that.
   */
  uAmbFloor: { value: number };
  uAmbHemiFloor: { value: number };
  /** Tint applied to indirect light as the cell closes in: light that reached a room bounced off warm
   *  floors and walls on the way (ref_09's sandbags), so enclosure warms as well as darkens. */
  uAmbBounce: { value: THREE.Color };
  /** Warm ground-bounce radiance (sun colour x ground albedo), multiplied by the surface's own albedo. */
  uAmbBounceColor: { value: THREE.Color };
  uAmbBounceStrength: { value: number };
  /** Metres to push the volume lookup along the surface normal, ~0.65 of a cell. */
  uAmbNormalOffset: { value: number };
  /** Unit vector towards the sun; the bounce lift concentrates on faces turned away from it. */
  uAmbSunDir: { value: THREE.Vector3 };
  /** 0 = bounce is pure sun colour, 1 = fully tinted by the surface's own albedo. */
  uAmbBounceTint: { value: number };
  /** Tint applied to indirect light on faces turned away from the sun. */
  uAmbShadeTint: { value: THREE.Color };
}

const VERT_HEAD = /* glsl */`
varying vec3 vAmbWorld;
`;

const VERT_BODY = /* glsl */`
{
  vec4 ambWorld = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    ambWorld = batchingMatrix * ambWorld;
  #endif
  #ifdef USE_INSTANCING
    ambWorld = instanceMatrix * ambWorld;
  #endif
  vAmbWorld = ( modelMatrix * ambWorld ).xyz;
}
`;

const FRAG_HEAD = /* glsl */`
precision highp sampler3D;
varying vec3 vAmbWorld;
uniform sampler3D uAmbTex;
uniform vec3 uAmbMin;
uniform vec3 uAmbInvSize;
uniform float uAmbStrength;
uniform float uAmbFloor;
uniform float uAmbHemiFloor;
uniform vec3 uAmbBounce;
uniform vec3 uAmbBounceColor;
uniform float uAmbBounceStrength;
uniform float uAmbNormalOffset;
uniform vec3 uAmbSunDir;
uniform float uAmbBounceTint;
uniform vec3 uAmbShadeTint;
`;

const FRAG_BODY = /* glsl */`
if ( uAmbStrength > 0.0 ) {
  // World-space normal: viewMatrix is rigid, so a row-vector multiply is transpose(V) * n = inverse rotation.
  vec3 ambN = normalize( ( vec4( normal, 0.0 ) * viewMatrix ).xyz );
  // Sample in FRONT of the surface, not on it. A wall face sits exactly on the boundary between the
  // enclosed cell inside the wall and the open cell outside, and trilinear filtering would hand every
  // exterior shaded face ~50% interior occlusion.
  vec3 ambUvw = ( vAmbWorld + ambN * uAmbNormalOffset - uAmbMin ) * uAmbInvSize;
  float ambOpen = 1.0;
  if ( all( greaterThanEqual( ambUvw, vec3( 0.0 ) ) ) && all( lessThanEqual( ambUvw, vec3( 1.0 ) ) ) ) {
    ambOpen = texture( uAmbTex, ambUvw ).r;
  }
  ambOpen = mix( 1.0, ambOpen, uAmbStrength );
  float ambIbl = mix( uAmbFloor, 1.0, ambOpen );
  float ambHemi = mix( uAmbHemiFloor, 1.0, ambOpen );
  vec3 ambWarm = mix( uAmbBounce, vec3( 1.0 ), ambOpen );
  // A face turned away from the sun cannot see much of the sky dome either - the building it belongs to
  // is in the way. What reaches it is mostly light bounced off sunlit ground and walls, so its indirect
  // leans warm rather than sky-blue. Sun-facing surfaces are untouched.
  float ambAway = 1.0 - max( dot( ambN, uAmbSunDir ), 0.0 );
  vec3 ambShade = mix( vec3( 1.0 ), uAmbShadeTint, ambAway );
  irradiance *= ambHemi * ambWarm * ambShade;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    iblIrradiance *= ambIbl * ambWarm * ambShade;
    radiance *= ambIbl * ambShade;
  #endif
  // Bounce: sunlight hits the ground and nearby surfaces and comes back carrying the sun's warmth and
  // some of this material's own colour, so a brick wall throws red-brown into its own shade instead of
  // sitting under neutral blue skylight (ref_05, ref_09). Only partly albedo-tinted - a fully tinted
  // bounce cannot warm a dark blue-grey object, which is exactly where the blue cast was worst.
  vec3 ambTint = mix( vec3( 1.0 ), material.diffuseColor, uAmbBounceTint );
  // Weight towards the faces that actually look blue: pointing away from the sun, and not straight up
  // (the ground is the bouncer, though a floor still catches some off the walls).
  float ambSide = mix( 0.35, 1.0, 1.0 - max( ambN.y, 0.0 ) ) * mix( 0.45, 1.0, ambAway );
  irradiance += uAmbBounceColor * ambTint * ( uAmbBounceStrength * ambSide * mix( 0.09, 1.0, ambOpen ) );
}
`;

export class AmbientVolume {
  readonly uniforms: AmbientVolumeUniforms = {
    uAmbTex: { value: null },
    uAmbMin: { value: new THREE.Vector3() },
    uAmbInvSize: { value: new THREE.Vector3(1, 1, 1) },
    uAmbStrength: { value: 0 },
    // A room really is ~2 stops under the street. The old 0.5 / 0.85 barely darkened anything, so the
    // interior sat at street exposure and the sunlit doorway in it read *darker* than the wall beside
    // it. Paired with the interior exposure adaptation in PostFx, this is what buys the 2-3 stop
    // interior/opening contrast of ref_09.
    uAmbFloor: { value: 0.06 },
    uAmbHemiFloor: { value: 0.10 },
    uAmbBounce: { value: new THREE.Color(1.22, 0.99, 0.7) },
    uAmbBounceColor: { value: new THREE.Color(0.55, 0.42, 0.28) },
    uAmbBounceStrength: { value: 0.85 },
    uAmbNormalOffset: { value: 1.3 },
    uAmbSunDir: { value: new THREE.Vector3(0, 1, 0) },
    uAmbBounceTint: { value: 0.65 },
    uAmbShadeTint: { value: new THREE.Color(1.12, 1.02, 0.86) },
  };
  built = false;
  /** Grid data kept on the CPU so the camera's enclosure can be sampled without a GPU readback. */
  private data: Float32Array | null = null;
  private dims = new THREE.Vector3(1, 1, 1);
  private min = new THREE.Vector3();
  private size = new THREE.Vector3(1, 1, 1);
  private tmp = new THREE.Vector3();
  /** Boxes the world module declared as interiors; applied at build time and on every later call. */
  private stamped: THREE.Box3[] = [];

  constructor(private engine: Engine) {}

  /**
   * Samples the level. `bounds` should cover the playable space; it is padded so the border cells read
   * as open sky. Returns false if physics isn't ready yet.
   */
  build(bounds: THREE.Box3, cell = 2.0, cellY = 1.75, maxRay = 14): boolean {
    const ph = this.engine.physics;
    if (!ph.world) return false;
    const b = bounds.clone().expandByVector(new THREE.Vector3(cell * 1.5, cellY * 1.5, cell * 1.5));
    const size = b.getSize(new THREE.Vector3());
    const nx = THREE.MathUtils.clamp(Math.ceil(size.x / cell), 2, 96);
    const ny = THREE.MathUtils.clamp(Math.ceil(size.y / cellY), 2, 32);
    const nz = THREE.MathUtils.clamp(Math.ceil(size.z / cell), 2, 96);
    const open = new Float32Array(nx * ny * nz);
    const filter = groups(CG.ALL, CG.WORLD);
    const up = { x: 0, y: 1, z: 0 };
    const o = { x: 0, y: 0, z: 0 };
    for (let k = 0; k < nz; k++) {
      o.z = b.min.z + (k + 0.5) / nz * size.z;
      for (let j = 0; j < ny; j++) {
        o.y = b.min.y + (j + 0.5) / ny * size.y;
        for (let i = 0; i < nx; i++) {
          o.x = b.min.x + (i + 0.5) / nx * size.x;
          const hit = ph.raycast(o, up, maxRay, filter);
          // No roof = full sky. A roof 9 m up still lets a good deal of the dome in.
          open[(k * ny + j) * nx + i] = hit ? THREE.MathUtils.smoothstep(hit.distance, 2, 9) : 1;
        }
      }
    }
    // Blur so openings gradient instead of stepping, but only ever *brighten*: a symmetric blur would let
    // the enclosed cells under a roof bleed upwards and dim the open rooftop above it.
    const raw = open.slice();
    this.blur(open, nx, ny, nz);
    this.blur(open, nx, ny, nz);
    for (let i = 0; i < open.length; i++) open[i] = Math.max(open[i], raw[i]);
    const tex = new THREE.Data3DTexture(open, nx, ny, nz);
    tex.format = THREE.RedFormat; tex.type = THREE.FloatType;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.wrapS = tex.wrapT = tex.wrapR = THREE.ClampToEdgeWrapping;
    tex.unpackAlignment = 1;
    tex.needsUpdate = true;
    this.uniforms.uAmbTex.value = tex;
    // Texel centres sit at (i+0.5)/n, matching how the grid was sampled.
    this.uniforms.uAmbMin.value.copy(b.min);
    this.uniforms.uAmbInvSize.value.set(1 / size.x, 1 / size.y, 1 / size.z);
    this.uniforms.uAmbStrength.value = 1;
    this.data = open; this.dims.set(nx, ny, nz); this.min.copy(b.min); this.size.copy(size);
    this.built = true;
    if (this.stamped.length) this.stampInteriors(this.stamped);
    return true;
  }

  /**
   * Marks explicit boxes as enclosed regardless of what the roof probe found (rooms whose ceiling is not
   * a physics collider, covered walkways, and so on). Safe to call before the volume is built - the boxes
   * are replayed once it is. Cells are darkened, never brightened, so this only ever adds interiors.
   */
  stampInteriors(boxes: THREE.Box3[]): void {
    this.stamped = boxes.map((b) => b.clone());
    if (!this.data || !this.built) return;
    const { x: nx, y: ny, z: nz } = this.dims;
    const p = new THREE.Vector3();
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      p.set(this.min.x + (i + 0.5) / nx * this.size.x, this.min.y + (j + 0.5) / ny * this.size.y, this.min.z + (k + 0.5) / nz * this.size.z);
      for (const b of boxes) {
        if (!b.containsPoint(p)) continue;
        const idx = (k * ny + j) * nx + i;
        this.data[idx] = Math.min(this.data[idx], 0.05);
        break;
      }
    }
    const tex = this.uniforms.uAmbTex.value;
    if (tex) tex.needsUpdate = true;
  }

  /** Separable-ish 3x3x3 box blur in place (cheap, runs twice at build time). */
  private blur(a: Float32Array, nx: number, ny: number, nz: number): void {
    const src = a.slice();
    const at = (i: number, j: number, k: number) => src[(THREE.MathUtils.clamp(k, 0, nz - 1) * ny + THREE.MathUtils.clamp(j, 0, ny - 1)) * nx + THREE.MathUtils.clamp(i, 0, nx - 1)];
    for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      let s = 0;
      for (let dk = -1; dk <= 1; dk++) for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) s += at(i + di, j + dj, k + dk);
      a[(k * ny + j) * nx + i] = s / 27;
    }
  }

  /** Trilinear CPU lookup, 1 = open sky. Used for the camera's enclosure (sun shafts, audio, debug). */
  sampleOpenness(p: THREE.Vector3): number {
    if (!this.data) return 1;
    const { x: nx, y: ny, z: nz } = this.dims;
    const u = this.tmp.copy(p).sub(this.min).divide(this.size);
    const fx = THREE.MathUtils.clamp(u.x * nx - 0.5, 0, nx - 1);
    const fy = THREE.MathUtils.clamp(u.y * ny - 0.5, 0, ny - 1);
    const fz = THREE.MathUtils.clamp(u.z * nz - 0.5, 0, nz - 1);
    const i0 = Math.floor(fx), j0 = Math.floor(fy), k0 = Math.floor(fz);
    const i1 = Math.min(i0 + 1, nx - 1), j1 = Math.min(j0 + 1, ny - 1), k1 = Math.min(k0 + 1, nz - 1);
    const tx = fx - i0, ty = fy - j0, tz = fz - k0;
    const g = (i: number, j: number, k: number) => this.data![(k * ny + j) * nx + i];
    const lerp = THREE.MathUtils.lerp;
    const c00 = lerp(g(i0, j0, k0), g(i1, j0, k0), tx), c10 = lerp(g(i0, j1, k0), g(i1, j1, k0), tx);
    const c01 = lerp(g(i0, j0, k1), g(i1, j0, k1), tx), c11 = lerp(g(i0, j1, k1), g(i1, j1, k1), tx);
    return lerp(lerp(c00, c10, ty), lerp(c01, c11, ty), tz);
  }

  /** Adds the sampler to one material's shader. Safe to call on materials compiled before the build. */
  patch(shader: THREE.WebGLProgramParametersWithUniforms): void {
    const u = shader.uniforms as unknown as Record<string, unknown>;
    for (const [k, v] of Object.entries(this.uniforms)) u[k] = v;
    if (!shader.vertexShader.includes('vAmbWorld')) {
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
        .replace('#include <project_vertex>', `#include <project_vertex>\n${VERT_BODY}`);
    }
    if (!shader.fragmentShader.includes('vAmbWorld')) {
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
        .replace('#include <lights_fragment_maps>', `#include <lights_fragment_maps>\n${FRAG_BODY}`);
    }
  }
}
