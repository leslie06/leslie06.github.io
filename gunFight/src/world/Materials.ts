import * as THREE from 'three';
import type { Engine } from '../core/Engine';
import type { PbrMaps } from '../core/Assets';

/**
 * Material library for the level.
 *
 * Every world material is a MeshStandardMaterial with real PBR maps plus a small shader patch
 * (onBeforeCompile) that adds, in world space:
 *   - a grime gradient at wall bases (darker + rougher near the ground, streaky),
 *   - a low-frequency macro variation to kill texture repetition,
 *   - optionally a second PBR layer ("exposed brick under broken render") blended by
 *     3D noise + a per-vertex `damage` attribute, with a darkened chip edge.
 *
 * Geometry UVs are in world meters (see Geo.ts) and each material scales its own texture clones
 * by 1/tile, so the same texture set can be reused at different tiling without re-uploading
 * (three shares GPU textures by Source).
 */
export interface WorldMatSpec {
  set?: string;
  /** metres per texture tile (number = square, [u, v] = anisotropic, e.g. brick sets that are not square in the real world) */
  tile?: number | [number, number];
  color?: number;
  roughness?: number;
  metalness?: number;
  normalScale?: number;
  envMapIntensity?: number;
  /** dirt gradient: height in metres above uDirt ground, strength 0..1 */
  dirt?: { height: number; strength: number; color?: number; ground?: number };
  /** macro variation amplitude 0..1 */
  macro?: number;
  /** second layer shown where damaged */
  layer2?: { set: string; tile: number | [number, number] };
  /** 0..1 desaturate the albedo (kills over-saturated scans) */
  desat?: number;
  /** albedo brightness multiplier applied in the shader before tone mapping */
  gain?: number;
  /**
   * How much of the (desaturated, gained) texture survives, 0..1 — `mix(white, tex * gain, lift)`.
   * Dark scans (rust ≈ 0.06 linear) otherwise multiply a vertex paint tint down to black; a lift of
   * 0.6-0.8 turns them into a modulation mask so the tint carries the colour.
   */
  lift?: number;
  side?: THREE.Side;
  transparent?: boolean;
  depthWrite?: boolean;
  polygonOffset?: number;
  emissive?: number;
  emissiveIntensity?: number;
  aoIntensity?: number;
  alphaTest?: number;
  flat?: boolean;
  /**
   * Parallax-occlusion relief on the hero wall LOD. `height` is the peak-to-trough displacement in metres
   * (brick ≈ 6 mm, plaster spall ≈ 3 mm); the effect is marched with `layers` steps and faded out past
   * `range` metres from the camera so only close-range surfaces pay for it. Needs the set's disp map
   * (preload the set with `{ disp: true }`).
   */
  parallax?: { height: number; layers?: number; range?: number; cavity?: number };
}

const GLSL_NOISE = /* glsl */`
float wmHash3(vec3 p){ p = fract(p * 0.3183099 + vec3(0.1, 0.2, 0.3)); p *= 17.0; return fract(p.x * p.y * p.z * (p.x + p.y + p.z)); }
float wmNoise3(vec3 p){
  vec3 i = floor(p); vec3 f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(mix(wmHash3(i), wmHash3(i + vec3(1,0,0)), f.x), mix(wmHash3(i + vec3(0,1,0)), wmHash3(i + vec3(1,1,0)), f.x), f.y),
    mix(mix(wmHash3(i + vec3(0,0,1)), wmHash3(i + vec3(1,0,1)), f.x), mix(wmHash3(i + vec3(0,1,1)), wmHash3(i + vec3(1,1,1)), f.x), f.y), f.z);
}
float wmFbm(vec3 p){ float v = 0.0; float a = 0.5; for (int i = 0; i < 3; i++) { v += a * wmNoise3(p); p = p * 2.07 + vec3(3.1, 7.3, 1.9); a *= 0.5; } return v / 0.875; }
`;

/**
 * Parallax-occlusion relief for the hero wall materials.
 *
 * The level's UVs are a world-space planar projection chosen by the dominant face normal (see Geo.planarUv),
 * so the tangent frame is known analytically — no derivative frame, no tangent attribute. The march is done in
 * uv space (metres x 1/tile) against the set's displacement map and faded out with distance so only the
 * close-range LOD pays for it.
 */
const GLSL_PARALLAX = /* glsl */`
#ifdef WM_PARALLAX
vec2 wmParallax(vec2 uv){
  vec3 n = normalize(vWNormal);
  vec3 an = abs(n);
  vec3 T, B;
  if (an.x >= an.y && an.x >= an.z)      { T = vec3(0.0, 0.0, 1.0); B = vec3(0.0, 1.0, 0.0); }
  else if (an.y >= an.z)                 { T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 0.0, 1.0); }
  else                                   { T = vec3(1.0, 0.0, 0.0); B = vec3(0.0, 1.0, 0.0); }
  vec3 d = cameraPosition - vWPos;
  float dist = length(d);
  float fade = 1.0 - smoothstep(uParallax.w * 0.55, uParallax.w, dist);
  if (fade <= 0.002) return vec2(0.0);
  vec3 V = d / max(dist, 1e-4);
  float vn = abs(dot(V, n));
  // total uv travel across the full relief depth, clamped so grazing angles do not smear
  vec2 P = vec2(dot(V, T) * uParallax.x, dot(V, B) * uParallax.y) * (uParallax.z / max(vn, 0.28)) * fade;
  P = clamp(P, vec2(-0.35), vec2(0.35));
  float layers = float(WM_PAR_LAYERS);
  vec2 dUv = P / layers;
  float layerD = 1.0 / layers;
  float curD = 0.0;
  vec2 cur = uv;
  float curH = 1.0 - texture2D(heightMap, cur).r;
  for (int i = 0; i < WM_PAR_LAYERS; i++) {
    if (curD >= curH) break;
    cur -= dUv; curD += layerD;
    curH = 1.0 - texture2D(heightMap, cur).r;
  }
  vec2 prev = cur + dUv;
  float after = curH - curD;
  float before = (1.0 - texture2D(heightMap, prev).r) - curD + layerD;
  float w = clamp(after / (after - before + 1e-5), 0.0, 1.0);
  return mix(cur, prev, w) - uv;
}
#endif
`;

export class MaterialLib {
  private mats = new Map<string, THREE.MeshStandardMaterial>();
  private sets = new Map<string, PbrMaps>();
  private pending: Promise<void>[] = [];

  constructor(private engine: Engine) {}

  /** Preload a set of PBR texture sets (parallel). */
  preload(names: string[], opts: { disp?: boolean } = {}): void {
    for (const n of names) {
      if (this.sets.has(n)) continue;
      this.pending.push(this.engine.assets.pbr(n, { withDisp: opts.disp }).then((m) => { this.sets.set(n, m); }));
    }
  }
  async ready(): Promise<void> { await Promise.all(this.pending); this.pending = []; }

  get(key: string): THREE.MeshStandardMaterial {
    const m = this.mats.get(key);
    if (!m) throw new Error(`[world] unknown material ${key}`);
    return m;
  }
  has(key: string): boolean { return this.mats.has(key); }
  all(): [string, THREE.MeshStandardMaterial][] { return [...this.mats.entries()]; }

  private cloneScaled(t: THREE.Texture | undefined, tile: number | [number, number]): THREE.Texture | undefined {
    if (!t) return undefined;
    const c = t.clone();
    const [tu, tv] = Array.isArray(tile) ? tile : [tile, tile];
    c.repeat.set(1 / tu, 1 / tv);
    c.needsUpdate = true;
    return c;
  }

  define(key: string, spec: WorldMatSpec): THREE.MeshStandardMaterial {
    const maps = spec.set ? this.sets.get(spec.set) ?? {} : {};
    const tile = spec.tile ?? 2;
    const mat = new THREE.MeshStandardMaterial({
      color: spec.color ?? 0xffffff,
      roughness: spec.roughness ?? 1,
      metalness: spec.metalness ?? (maps.metalnessMap ? 1 : 0),
      vertexColors: true,
      side: spec.side ?? THREE.FrontSide,
      transparent: spec.transparent ?? false,
      depthWrite: spec.depthWrite ?? true,
      envMapIntensity: spec.envMapIntensity ?? 1,
      flatShading: spec.flat ?? false,
    });
    if (spec.alphaTest !== undefined) mat.alphaTest = spec.alphaTest;
    if (spec.polygonOffset !== undefined) { mat.polygonOffset = true; mat.polygonOffsetFactor = spec.polygonOffset; mat.polygonOffsetUnits = spec.polygonOffset; }
    if (spec.emissive !== undefined) { mat.emissive = new THREE.Color(spec.emissive); mat.emissiveIntensity = spec.emissiveIntensity ?? 1; }
    mat.map = this.cloneScaled(maps.map, tile) ?? null;
    mat.normalMap = this.cloneScaled(maps.normalMap, tile) ?? null;
    mat.roughnessMap = this.cloneScaled(maps.roughnessMap, tile) ?? null;
    mat.aoMap = this.cloneScaled(maps.aoMap, tile) ?? null;
    mat.metalnessMap = this.cloneScaled(maps.metalnessMap, tile) ?? null;
    if (mat.aoMap) mat.aoMapIntensity = spec.aoIntensity ?? 0.9;
    mat.normalScale.setScalar(spec.normalScale ?? 1);

    const layer2 = spec.layer2 ? this.sets.get(spec.layer2.set) : undefined;
    const hasLayer2 = !!(layer2 && layer2.map && spec.layer2);
    const dirt = spec.dirt;
    const tileUV = Array.isArray(tile) ? tile : [tile, tile];
    const l2tile = spec.layer2 ? (Array.isArray(spec.layer2.tile) ? spec.layer2.tile : [spec.layer2.tile, spec.layer2.tile]) : [1, 1];
    const par = spec.parallax && maps.displacementMap ? spec.parallax : undefined;
    const uniforms = {
      uDirt: { value: new THREE.Vector4(dirt?.ground ?? 0, dirt?.height ?? 1, dirt?.strength ?? 0, 0) },
      uDirtColor: { value: new THREE.Color(dirt?.color ?? 0x5a4d40) },
      uMacro: { value: spec.macro ?? 0 },
      uDesat: { value: new THREE.Vector3(spec.desat ?? 0, spec.gain ?? 1, spec.lift ?? 1) },
      uUv2Scale: { value: hasLayer2 ? new THREE.Vector2(tileUV[0] / l2tile[0], tileUV[1] / l2tile[1]) : new THREE.Vector2(1, 1) },
      map2: { value: hasLayer2 ? this.cloneScaled(layer2!.map, tile) : null },
      normalMap2: { value: hasLayer2 ? this.cloneScaled(layer2!.normalMap, tile) ?? null : null },
      roughnessMap2: { value: hasLayer2 ? this.cloneScaled(layer2!.roughnessMap, tile) ?? null : null },
      aoMap2: { value: hasLayer2 ? this.cloneScaled(layer2!.aoMap, tile) ?? null : null },
      heightMap: { value: par ? this.cloneScaled(maps.displacementMap, tile) ?? null : null },
      // x,y: metres -> uv-space scale (1/tile); z: relief height in metres; w: fade-out distance in metres
      uParallax: { value: new THREE.Vector4(1 / tileUV[0], 1 / tileUV[1], par?.height ?? 0, par?.range ?? 6) },
      uCavity: { value: par?.cavity ?? 0.55 },
    };
    const wantsPatch = !!par || hasLayer2 || (dirt && dirt.strength > 0) || (spec.macro ?? 0) > 0 || (spec.desat ?? 0) > 0 || (spec.gain !== undefined && spec.gain !== 1) || (spec.lift !== undefined && spec.lift !== 1);
    if (wantsPatch) {
      const layers = par?.layers ?? 12;
      const flags = `${hasLayer2 ? 'L2' : ''}${uniforms.normalMap2.value ? 'N2' : ''}${uniforms.roughnessMap2.value ? 'R2' : ''}${uniforms.aoMap2.value ? 'A2' : ''}${mat.map ? 'M' : ''}${par ? 'P' + layers : ''}`;
      mat.customProgramCacheKey = () => `wm:${flags}`;
      mat.onBeforeCompile = (shader) => {
        Object.assign(shader.uniforms, uniforms);
        shader.defines = shader.defines ?? {};
        if (hasLayer2) shader.defines.WM_LAYER2 = 1;
        if (uniforms.normalMap2.value) shader.defines.WM_NORMAL2 = 1;
        if (uniforms.roughnessMap2.value) shader.defines.WM_ROUGH2 = 1;
        if (uniforms.aoMap2.value) shader.defines.WM_AO2 = 1;
        if (par) { shader.defines.WM_PARALLAX = 1; shader.defines.WM_PAR_LAYERS = layers; }

        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nattribute float damage;\nvarying float vDamage;`)
          .replace('#include <project_vertex>', `#include <project_vertex>\n{ vec4 wmP = vec4(transformed, 1.0);\nvec3 wmN = objectNormal;\n#ifdef USE_INSTANCING\n wmP = instanceMatrix * wmP; wmN = mat3(instanceMatrix) * wmN;\n#endif\n vWPos = (modelMatrix * wmP).xyz; vWNormal = normalize(mat3(modelMatrix) * wmN); vDamage = damage; }`);

        shader.fragmentShader = shader.fragmentShader
          .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\nvarying float vDamage;\nuniform vec4 uDirt; uniform vec3 uDirtColor; uniform float uMacro; uniform vec2 uUv2Scale; uniform vec3 uDesat;\n#ifdef WM_LAYER2\nuniform sampler2D map2;\n#endif\n#ifdef WM_NORMAL2\nuniform sampler2D normalMap2;\n#endif\n#ifdef WM_ROUGH2\nuniform sampler2D roughnessMap2;\n#endif\n#ifdef WM_AO2\nuniform sampler2D aoMap2;\n#endif\n#ifdef WM_PARALLAX\nuniform sampler2D heightMap;\nuniform vec4 uParallax;\nuniform float uCavity;\n#endif\n${GLSL_NOISE}\nfloat wmMask = 0.0; float wmDirt = 0.0; vec2 wmUvOff = vec2(0.0); float wmRelief = 1.0;\n${GLSL_PARALLAX}\nfloat wmMaskFn(vec3 p, float dmg){ float n = wmFbm(p * 1.1) * 0.6 + wmFbm(p * 0.27 + vec3(7.1, 3.3, 9.7)) * 0.4; n = n + 0.12 * (wmNoise3(p * 5.0) - 0.5); float t = dmg * 1.3 + n * 0.9 - 0.82; return smoothstep(0.0, 0.08, t); }`)
          // diffuse: layer blend + macro + dirt
          .replace('#include <map_fragment>', `
{
  #ifdef WM_PARALLAX
    wmUvOff = wmParallax(vMapUv);
    // cavity darkening: what the relief pushed away from the eye sits in shadow
    wmRelief = 1.0 - uCavity * (1.0 - texture2D(heightMap, vMapUv + wmUvOff).r);
  #endif
  #ifdef WM_LAYER2
    wmMask = wmMaskFn(vWPos, vDamage);
  #endif
  float wmD = (1.0 - smoothstep(0.0, uDirt.y, vWPos.y - uDirt.x)) * uDirt.z;
  wmD *= 0.55 + 0.45 * wmFbm(vec3(vWPos.x * 1.9, vWPos.y * 0.7, vWPos.z * 1.9));
  wmDirt = clamp(wmD, 0.0, 1.0);
  #ifdef USE_MAP
    vec4 sampledDiffuseColor = texture2D( map, vMapUv + wmUvOff );
    #ifdef WM_LAYER2
      vec4 wmC2 = texture2D( map2, (vMapUv + wmUvOff) * uUv2Scale );
      sampledDiffuseColor = mix(sampledDiffuseColor, wmC2, wmMask);
      float wmEdge = smoothstep(0.0, 0.45, wmMask) * (1.0 - smoothstep(0.45, 1.0, wmMask));
      sampledDiffuseColor.rgb *= 1.0 - 0.5 * wmEdge;
    #endif
  #else
    vec4 sampledDiffuseColor = vec4(1.0);
  #endif
  float wmMacro = 1.0 + uMacro * (wmFbm(vec3(vWPos.x * 0.13, vWPos.y * 0.09, vWPos.z * 0.13)) - 0.5) * 2.2;
  sampledDiffuseColor.rgb *= wmMacro;
  sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, sampledDiffuseColor.rgb * uDirtColor, wmDirt);
  sampledDiffuseColor.rgb = mix(sampledDiffuseColor.rgb, vec3(dot(sampledDiffuseColor.rgb, vec3(0.299, 0.587, 0.114))), uDesat.x);
  sampledDiffuseColor.rgb = mix(vec3(1.0), sampledDiffuseColor.rgb * uDesat.y, uDesat.z);
  sampledDiffuseColor.rgb *= wmRelief;
  diffuseColor *= sampledDiffuseColor;
}`)
          .replace('#include <roughnessmap_fragment>', `
float roughnessFactor = roughness;
#ifdef USE_ROUGHNESSMAP
  vec4 texelRoughness = texture2D( roughnessMap, vRoughnessMapUv + wmUvOff );
  float wmR = texelRoughness.g;
  #ifdef WM_ROUGH2
    wmR = mix(wmR, texture2D( roughnessMap2, (vRoughnessMapUv + wmUvOff) * uUv2Scale ).g, wmMask);
  #endif
  roughnessFactor *= wmR;
#endif
roughnessFactor = clamp(roughnessFactor + wmDirt * 0.25, 0.02, 1.0);`)
          .replace('#include <normal_fragment_maps>', `
#ifdef USE_NORMALMAP_TANGENTSPACE
  vec3 mapN = texture2D( normalMap, vNormalMapUv + wmUvOff ).xyz * 2.0 - 1.0;
  #ifdef WM_NORMAL2
    vec3 wmN2 = texture2D( normalMap2, (vNormalMapUv + wmUvOff) * uUv2Scale ).xyz * 2.0 - 1.0;
    mapN = normalize(mix(mapN, wmN2, wmMask));
  #endif
  mapN.xy *= normalScale;
  normal = normalize( tbn * mapN );
#endif`)
          .replace('#include <aomap_fragment>', `
#ifdef USE_AOMAP
  float wmAo = texture2D( aoMap, vAoMapUv + wmUvOff ).r;
  #ifdef WM_AO2
    wmAo = mix(wmAo, texture2D( aoMap2, (vAoMapUv + wmUvOff) * uUv2Scale ).r, wmMask);
  #endif
  float ambientOcclusion = ( wmAo - 1.0 ) * aoMapIntensity + 1.0;
  ambientOcclusion *= 1.0 - wmDirt * 0.35;
  reflectedLight.indirectDiffuse *= ambientOcclusion;
  #if defined( USE_ENVMAP ) && defined( STANDARD )
    float dotNV = saturate( dot( geometryNormal, geometryViewDir ) );
    reflectedLight.indirectSpecular *= computeSpecularOcclusion( dotNV, ambientOcclusion, material.roughness );
  #endif
#endif`);
      };
    }
    mat.name = key;
    this.mats.set(key, mat);
    return mat;
  }

  /**
   * Aerial perspective for the distant city.
   *
   * The scene's exponential fog is tuned for the playable block (50 m) and the render module's height fog has a
   * ~22 m scale height, so nothing above 40 m receives haze — the skyline keeps full saturation and contrast at
   * 500-800 m. This adds a height-independent distance term directly on the skyline material, in linear HDR
   * before tone mapping: desaturate, lift, then mix toward the horizon colour, in three soft bands (ref_08).
   * Returns a setter so the level can follow the sky's time of day.
   */
  haze(mat: THREE.MeshStandardMaterial, opts: { near: number; far: number; strength: number; desat: number; lift: number; color: THREE.Color }): (c: THREE.Color, strength?: number) => void {
    const uHaze = { value: new THREE.Vector4(opts.near, opts.far, opts.strength, 0) };
    const uHazeB = { value: new THREE.Vector2(opts.desat, opts.lift) };
    const uHazeColor = { value: opts.color.clone() };
    mat.customProgramCacheKey = () => 'wm:haze';
    mat.onBeforeCompile = (shader) => {
      Object.assign(shader.uniforms, { uHaze, uHazeB, uHazeColor });
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;')
        .replace('#include <project_vertex>', '#include <project_vertex>\nvWPos = (modelMatrix * vec4(transformed, 1.0)).xyz;');
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', '#include <common>\nvarying vec3 vWPos;\nuniform vec4 uHaze;\nuniform vec2 uHazeB;\nuniform vec3 uHazeColor;')
        .replace('#include <opaque_fragment>', `
{
  float wmD = length(cameraPosition - vWPos);
  float t = clamp((wmD - uHaze.x) / max(1.0, uHaze.y - uHaze.x), 0.0, 1.0);
  // three soft bands rather than one smooth ramp: distinct depth steps read as distance, a gradient reads as fog
  float band = (floor(t * 3.0) + smoothstep(0.2, 0.8, fract(t * 3.0))) / 3.0;
  band = mix(band, t, 0.35);
  float lum = dot(outgoingLight, vec3(0.2126, 0.7152, 0.0722));
  outgoingLight = mix(outgoingLight, vec3(lum), uHazeB.x * band);
  outgoingLight += uHazeColor * (uHazeB.y * band);
  outgoingLight = mix(outgoingLight, uHazeColor, uHaze.z * band);
}
#include <opaque_fragment>`);
    };
    mat.needsUpdate = true;
    return (c: THREE.Color, strength?: number) => { uHazeColor.value.copy(c); if (strength !== undefined) uHaze.value.z = strength; };
  }

  /** Plain material without PBR maps (cables, rubber, glass...). */
  plain(key: string, mat: THREE.MeshStandardMaterial): THREE.MeshStandardMaterial {
    mat.vertexColors = true; mat.name = key; this.mats.set(key, mat); return mat;
  }

  /**
   * Unlit material (emissive windows at dusk). MeshBasicMaterial's `color` is *not* clamped to 1 in a linear
   * HDR pipeline, so a colour above white makes the window bloom exactly like a real emissive; vertex colours
   * carry the per-window hue and brightness spread.
   */
  basic(key: string, mat: THREE.MeshBasicMaterial): THREE.MeshBasicMaterial {
    mat.vertexColors = true; mat.name = key;
    this.mats.set(key, mat as unknown as THREE.MeshStandardMaterial);
    return mat;
  }
}
