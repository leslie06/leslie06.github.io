import * as THREE from 'three';
import { GRID, type Atlas } from './Atlas';
import { NO_FLOOR } from './math';

/**
 * GPU particle pool: one InstancedBufferGeometry quad + one interleaved per-particle buffer,
 * one draw call. Particles are integrated analytically in the vertex shader (gravity + linear
 * drag + one floor bounce via Newton iteration), so the CPU only writes a slot when a particle
 * spawns — zero per-frame work, zero allocation. Dead particles are culled in the vertex stage.
 *
 * Blending is premultiplied (ONE, ONE_MINUS_SRC_ALPHA) so a single pool mixes additive sparks
 * (alpha 0 -> pure add) with alpha-blended smoke.
 *
 * Modes: 0 billboard, 1 velocity-stretched billboard, 2 aligned to a fixed normal (paper, ground
 * rings), 3 axis billboard (quad whose +x runs along a world axis from the spawn point, rotated
 * about it to face the camera; muzzle cones / petals).
 * Lit: 0 unlit (rgb * color), 1 normal-mapped (atlas rgb = normal), 2 sphere-lit emissive
 * (atlas rgb = color; a sphere normal from the sprite uv is sun-shaded, gated by luminance so
 * the hot core stays emissive and the smoke phase gets a lit / unlit side).
 * Flipbooks (frames > 1) crossfade between adjacent cells.
 *
 * Per-particle layout (9 x vec4 = 36 floats):
 *  a0 pos.xyz, spawnTime      a1 vel.xyz, life        a2 gravScale, drag, floorY, stretchK
 *  a3 size0, size1, rot, rotSpeed   a4 color0.rgb, alpha0   a5 color1.rgb, alpha1
 *  a6 cell, frames, mode, lit       a7 additive, fadeIn, fadeOut, wobble   a8 normal.xyz, sizeCurve
 */
export const STRIDE = 36;
export const MODE_BILLBOARD = 0, MODE_STRETCH = 1, MODE_ALIGNED = 2, MODE_AXIS = 3;
export const LIT_NONE = 0, LIT_NORMAL = 1, LIT_SPHERE = 2;

/** Mutable spawn descriptor, reused for every emit (no allocation). */
export class ParticleDesc {
  x = 0; y = 0; z = 0; t0 = 0;
  vx = 0; vy = 0; vz = 0; life = 1;
  gravity = 0; drag = 0; floorY = NO_FLOOR; stretch = 0;
  size0 = 0.1; size1 = 0.1; rot = 0; rotSpeed = 0;
  r0 = 1; g0 = 1; b0 = 1; a0 = 1;
  r1 = 1; g1 = 1; b1 = 1; a1 = 1;
  cell = 0; frames = 1; mode = MODE_BILLBOARD; lit = 0;
  additive = 0; fadeIn = 0.05; fadeOut = 0.4; wobble = 0;
  nx = 0; ny = 0; nz = 0; curve = 1;
  reset(t0: number): this {
    this.x = this.y = this.z = 0; this.t0 = t0; this.vx = this.vy = this.vz = 0; this.life = 1;
    this.gravity = 0; this.drag = 0; this.floorY = NO_FLOOR; this.stretch = 0;
    this.size0 = this.size1 = 0.1; this.rot = 0; this.rotSpeed = 0;
    this.r0 = this.g0 = this.b0 = this.a0 = 1; this.r1 = this.g1 = this.b1 = this.a1 = 1;
    this.cell = 0; this.frames = 1; this.mode = MODE_BILLBOARD; this.lit = 0;
    this.additive = 0; this.fadeIn = 0.05; this.fadeOut = 0.4; this.wobble = 0;
    this.nx = this.ny = this.nz = 0; this.curve = 1;
    return this;
  }
  color(r: number, g: number, b: number, a = 1): this { this.r0 = this.r1 = r; this.g0 = this.g1 = g; this.b0 = this.b1 = b; this.a0 = this.a1 = a; return this; }
  colorEnd(r: number, g: number, b: number, a: number): this { this.r1 = r; this.g1 = g; this.b1 = b; this.a1 = a; return this; }
  pos(x: number, y: number, z: number): this { this.x = x; this.y = y; this.z = z; return this; }
  vel(x: number, y: number, z: number): this { this.vx = x; this.vy = y; this.vz = z; return this; }
  size(s0: number, s1 = s0): this { this.size0 = s0; this.size1 = s1; return this; }
  normal(x: number, y: number, z: number): this { this.nx = x; this.ny = y; this.nz = z; return this; }
}

const VERT = /* glsl */`
precision highp float;
uniform float uTime; uniform float uGrid;
attribute vec4 a0; attribute vec4 a1; attribute vec4 a2; attribute vec4 a3; attribute vec4 a4; attribute vec4 a5; attribute vec4 a6; attribute vec4 a7; attribute vec4 a8;
varying vec2 vUv; varying vec2 vUv2; varying vec4 vColor; varying vec4 vFlags; varying mat3 vBasis; varying vec3 vViewPos; varying vec4 vPlane; varying vec2 vLocal; varying vec2 vSoft;
#include <fog_pars_vertex>

void integ(vec3 p0, vec3 v0, float gs, float k, float t, out vec3 p, out vec3 v) {
  vec3 g = vec3(0.0, -9.81 * gs, 0.0);
  float e = exp(-k * t);
  vec3 gk = g / k;
  float f = (1.0 - e) / k;
  p = p0 + gk * t + (v0 - gk) * f;
  v = gk + (v0 - gk) * e;
}
float yAt(float y0, float vy0, float gs, float k, float t) { float gk = -9.81 * gs / k; float e = exp(-k * t); return y0 + gk * t + (vy0 - gk) * (1.0 - e) / k; }
float vyAt(float vy0, float gs, float k, float t) { float gk = -9.81 * gs / k; return gk + (vy0 - gk) * exp(-k * t); }
vec2 cellUv(float cell) { float col = mod(cell, uGrid); float row = floor(cell / uGrid); return (vec2(col, row) + uv) / uGrid; }

void main() {
  float age = uTime - a0.w; float life = a1.w;
  if (age < 0.0 || age >= life || life <= 0.0) {
    gl_Position = vec4(2.0, 2.0, 2.0, 1.0);
    vUv = vec2(0.0); vUv2 = vec2(0.0); vColor = vec4(0.0); vFlags = vec4(0.0); vBasis = mat3(1.0); vViewPos = vec3(0.0); vPlane = vec4(0.0); vLocal = vec2(0.0); vSoft = vec2(0.0);
    #ifdef USE_FOG
      vFogDepth = 0.0;
    #endif
    return;
  }
  float t = age / life;
  float gs = a2.x; float k = max(a2.y, 1e-3); float floorY = a2.z;
  vec3 p; vec3 v;
  integ(a0.xyz, a1.xyz, gs, k, age, p, v);
  float rest = 0.0;
  if (floorY > -1.0e5 && p.y < floorY) {
    float th = age;
    for (int i = 0; i < 5; i++) { float yy = yAt(a0.y, a1.y, gs, k, th) - floorY; float dy = vyAt(a1.y, gs, k, th); th -= yy / min(dy, -1e-3); }
    th = clamp(th, 0.0, age);
    vec3 ph; vec3 vh; integ(a0.xyz, a1.xyz, gs, k, th, ph, vh);
    vec3 vb = vec3(vh.x * 0.6, -vh.y * 0.35, vh.z * 0.6);
    integ(ph, vb, gs, k, age - th, p, v);
    if (p.y < floorY) { p.y = floorY; v = vec3(0.0); rest = 1.0; }
  }
  float wob = a7.w;
  float flicker = 1.0;
  if (wob > 0.0) {
    p += wob * vec3(sin(age * 1.3 + a0.x * 7.0), sin(age * 0.9 + a0.z * 5.0), cos(age * 1.1 + a0.y * 3.0));
    if (a7.x > 0.5) flicker = 0.7 + 0.3 * sin(age * 9.0 + a0.x * 17.0 + a0.z * 11.0); // additive motes/embers only
  }
  float curve = a8.w > 0.0 ? a8.w : 1.0;
  float ts = pow(t, curve);
  float sz = mix(a3.x, a3.y, ts);
  float rot = a3.z + a3.w * age;
  float cr = cos(rot), sr = sin(rot);
  int mode = int(a6.z + 0.5);
  mat3 vm = mat3(modelViewMatrix);
  vec3 c = (modelViewMatrix * vec4(p, 1.0)).xyz;
  vec3 offs;
  float edgeFade = 1.0;
  float planeFade = 0.06;
  vLocal = position.xy * 2.0;
  if (mode == 2) {
    vec3 n = normalize(a8.xyz);
    vec3 t1 = normalize(cross(n, abs(n.y) < 0.99 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0)));
    vec3 b = cross(n, t1);
    vec3 ax = t1 * cr + b * sr; vec3 ay = -t1 * sr + b * cr;
    vec3 bx = vm * ax; vec3 by = vm * ay;
    offs = bx * (position.x * sz) + by * (position.y * sz);
    vBasis = mat3(bx, by, vm * n);
    vPlane = vec4(0.0);
  } else if (mode == 1) {
    vec3 vv = vm * v;
    float l2 = dot(vv.xy, vv.xy);
    vec2 ax = l2 > 1e-6 ? vv.xy * inversesqrt(l2) : vec2(1.0, 0.0);
    float len = max(sz, sqrt(l2) * a2.w);
    vec2 pp = vec2(-ax.y, ax.x);
    offs = vec3(ax * (position.x * len) + pp * (position.y * sz), 0.0);
    vBasis = mat3(vec3(ax, 0.0), vec3(pp, 0.0), vec3(0.0, 0.0, 1.0));
    vPlane = vec4(0.0);
  } else if (mode == 3) {
    vec3 av = normalize(vm * a8.xyz);
    vec3 vd = normalize(c);
    vec3 side = cross(av, vd); float sl = length(side);
    side = sl > 1e-4 ? side / sl : vec3(0.0, 1.0, 0.0);
    float len = a2.w > 0.0 ? mix(a2.w * 0.6, a2.w, ts) : sz;
    offs = av * ((position.x + 0.5) * len) + side * (position.y * sz);
    vBasis = mat3(av, side, cross(av, side));
    vPlane = vec4(0.0);
    edgeFade = smoothstep(0.05, 0.3, sl);
  } else {
    vec2 rp = vec2(position.x * cr - position.y * sr, position.x * sr + position.y * cr) * sz;
    offs = vec3(rp, 0.0);
    vBasis = mat3(vec3(cr, sr, 0.0), vec3(-sr, cr, 0.0), vec3(0.0, 0.0, 1.0));
    // surface plane (spawn point + normal) for fading pixels that would poke through the wall
    vec3 pn = a8.xyz;
    if (dot(pn, pn) > 0.5) {
      vec3 nv = normalize(vm * pn); vec3 ov = (modelViewMatrix * vec4(a0.xyz, 1.0)).xyz;
      vPlane = vec4(nv, -dot(nv, ov));
      // How wide the plane fade has to be depends entirely on how the plane meets the billboard.
      // Face-on to the wall (nv.z ~ +-1) the plane is parallel to the quad, so the fade dims the
      // sprite uniformly and a contact-scale width is right - that is what makes a puff emerge
      // from the wall as it travels. Seen along the wall the same plane slices *across* the quad,
      // and a 6 cm transition on a half-metre puff is the dead-straight edge the impact clouds
      // were showing. So interpolate: contact-scale head on, sprite-scale edge on.
      planeFade = mix(0.06, clamp(sz * 0.6, 0.08, 0.9), 1.0 - abs(nv.z));
    }
    else vPlane = vec4(0.0);
  }
  vec3 vp = c + offs;
  vViewPos = vp;
  // TWO fade widths, both scaled by the sprite's own radius - a 3 m smoke puff needs metres of
  // softness, a 1 cm spark needs none. Surface-aligned sprites (mode 2: shock rings, ground discs)
  // are deliberately coplanar with geometry and must never fade at all, or they erase themselves.
  //  .x  depth fade (soft particles). Contact-scale, not metres: the seam a clipped quad draws is a
  //      hard discontinuity, so even a 10-20 cm fade removes it, while a fade approaching the
  //      sprite's own radius eats the body of the smoke and leaves the fireball lobes showing
  //      through as bare discs.
  //  .y  spawn-surface plane fade (mode 0 only, see vPlane), widened above when the plane cuts
  //      across the quad instead of lying parallel to it.
  vSoft = mode == 2 ? vec2(0.0, planeFade) : vec2(clamp(sz * 0.18, 0.03, 0.4), planeFade);
  float fi = max(a7.y, 1e-3), fo = max(a7.z, 1e-3);
  float env = smoothstep(0.0, fi, t) * (1.0 - smoothstep(1.0 - fo, 1.0, t));
  float alpha = mix(a4.w, a5.w, t) * env * flicker * edgeFade;
  alpha *= smoothstep(0.1, 0.4, -c.z);
  vColor = vec4(mix(a4.rgb, a5.rgb, t), alpha);
  float frames = max(a6.y, 1.0);
  float fpos = t * frames;
  float f0 = min(floor(fpos), frames - 1.0); float f1 = min(f0 + 1.0, frames - 1.0);
  vFlags = vec4(a6.w, a7.x, rest, frames > 1.5 ? fract(fpos) : 0.0);
  vUv = cellUv(a6.x + f0); vUv2 = cellUv(a6.x + f1);
  vec4 mvPosition = vec4(vp, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  #include <fog_vertex>
}`;

const FRAG = /* glsl */`
precision highp float;
uniform sampler2D uAtlas; uniform mat3 uCamRot; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform vec3 uHemiSky; uniform vec3 uHemiGround;
uniform sampler2D uDepth; uniform vec2 uCamNearFar; uniform vec2 uResolution; uniform float uSoftScale;
varying vec2 vUv; varying vec2 vUv2; varying vec4 vColor; varying vec4 vFlags; varying mat3 vBasis; varying vec3 vViewPos; varying vec4 vPlane; varying vec2 vLocal; varying vec2 vSoft;
#include <fog_pars_fragment>
void main() {
  vec4 tex = texture2D(uAtlas, vUv);
  if (vFlags.w > 0.0) tex = mix(tex, texture2D(uAtlas, vUv2), vFlags.w);
  float lit = vFlags.x; float add = vFlags.y;
  float a = tex.a * vColor.a;
  if (dot(vPlane.xyz, vPlane.xyz) > 0.5) { float d = dot(vPlane.xyz, vViewPos) + vPlane.w; a *= smoothstep(-vSoft.y * 0.25, vSoft.y, d); }
  #ifdef SOFT_PARTICLES
  // Soft particles: fade out where the sprite gets close to the world surface behind it, so a big
  // smoke puff intersecting a wall dissolves into it instead of showing the dead-straight seam
  // where the quad is clipped. uDepth is the world pass's depth, copied after that pass (so it has
  // no viewmodel in it and is one frame old, which is exactly what we want to sample here).
  if (vSoft.x > 0.0) {
    float d = texture2D(uDepth, gl_FragCoord.xy / uResolution).r;
    float n = uCamNearFar.x, f = uCamNearFar.y;
    float sceneZ = n * f / (f - d * (f - n));
    a *= clamp((sceneZ + vViewPos.z) / (vSoft.x * uSoftScale), 0.0, 1.0);   // vViewPos.z is negative in front of the eye
  }
  #endif
  if (a < 0.003) discard;
  vec3 rgb;
  if (lit > 1.5) {
    // sphere-lit emissive (fireball flipbook): sun-shade the smoke, keep the hot core emissive
    float r2 = dot(vLocal, vLocal);
    vec3 n = normalize(vBasis * vec3(vLocal * 0.8, sqrt(max(0.0, 1.0 - min(r2, 1.0))) + 0.3));
    vec3 nw = uCamRot * n;
    float ndl = dot(nw, uSunDir);
    float wrap = smoothstep(-0.5, 1.0, ndl);
    vec3 amb = mix(uHemiGround, uHemiSky, nw.y * 0.5 + 0.5);
    vec3 light = amb * 1.2 + uSunColor * wrap * 0.34;
    float lum = dot(tex.rgb, vec3(0.35, 0.5, 0.15));
    float emis = smoothstep(0.2, 0.5, lum);
    rgb = tex.rgb * vColor.rgb * mix(light, vec3(1.0), emis);
  } else if (lit > 0.5) {
    vec3 n = normalize(vBasis * (tex.rgb * 2.0 - 1.0));
    vec3 nw = uCamRot * n;
    float ndl = dot(nw, uSunDir);
    float wrap = smoothstep(-0.45, 1.0, ndl);
    vec3 amb = mix(uHemiGround, uHemiSky, nw.y * 0.5 + 0.5);
    vec3 viewDir = normalize(-vViewPos);
    // Mie forward scattering: a broad lobe, not a pinpoint. A pow-8 lobe only lit particles within
    // a few degrees of the sun, so haze lit up nowhere unless the sun was dead centre in frame.
    float back = pow(max(0.0, dot(-(uCamRot * viewDir), uSunDir)), 3.0);
    // sun side / shadow side ~4:1, plus forward scattering when the puff is between us and the sun
    vec3 light = amb * 0.95 + uSunColor * (wrap * 0.34 + back * 0.62 * (1.0 - tex.a * 0.7));
    // dense parts of the puff self-shadow: gives the sprite internal structure instead of a flat cotton ball
    light *= 1.0 - tex.a * 0.4;
    rgb = vColor.rgb * light;
  } else {
    rgb = tex.rgb * vColor.rgb;
  }
  float occ = a * (1.0 - add);
  vec3 outRgb = rgb * a;
  #ifdef USE_FOG
    #ifdef FOG_EXP2
      float fogFactor = 1.0 - exp(-fogDensity * fogDensity * vFogDepth * vFogDepth);
    #else
      float fogFactor = smoothstep(fogNear, fogFar, vFogDepth);
    #endif
    outRgb = mix(outRgb, fogColor * occ, fogFactor);
  #endif
  gl_FragColor = vec4(outRgb, occ);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export interface PoolLighting { sunDir: THREE.Vector3; sunColor: THREE.Color; hemiSky: THREE.Color; hemiGround: THREE.Color }

export class ParticlePool {
  readonly mesh: THREE.Mesh;
  readonly material: THREE.ShaderMaterial;
  readonly data: Float32Array;
  readonly capacity: number;
  readonly d = new ParticleDesc();
  private buffer: THREE.InstancedInterleavedBuffer;
  private head = 0;
  private dirtyMin = Infinity; private dirtyMax = -1; private dirtyAll = false;
  private range = { start: 0, count: 0 };
  private camRot = new THREE.Matrix3();
  private soft = false;
  alive = 0;

  constructor(atlas: Atlas, capacity: number, renderOrder = 20) {
    this.capacity = Math.max(16, capacity | 0);
    const quad = new THREE.PlaneGeometry(1, 1);
    const geo = new THREE.InstancedBufferGeometry();
    geo.index = quad.index; geo.setAttribute('position', quad.getAttribute('position')); geo.setAttribute('uv', quad.getAttribute('uv'));
    geo.instanceCount = this.capacity;
    this.data = new Float32Array(this.capacity * STRIDE);
    this.buffer = new THREE.InstancedInterleavedBuffer(this.data, STRIDE, 1);
    this.buffer.setUsage(THREE.DynamicDrawUsage);
    for (let i = 0; i < 9; i++) geo.setAttribute('a' + i, new THREE.InterleavedBufferAttribute(this.buffer, 4, i * 4));
    geo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    this.material = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, {
        uTime: { value: 0 }, uGrid: { value: GRID }, uAtlas: { value: atlas.texture }, uCamRot: { value: this.camRot },
        uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color(1, 1, 1) }, uHemiSky: { value: new THREE.Color(0.4, 0.45, 0.55) }, uHemiGround: { value: new THREE.Color(0.2, 0.18, 0.16) },
        uDepth: { value: null }, uCamNearFar: { value: new THREE.Vector2(0.1, 600) }, uResolution: { value: new THREE.Vector2(1920, 1080) }, uSoftScale: { value: 1 },
      }]),
      vertexShader: VERT, fragmentShader: FRAG,
      transparent: true, depthWrite: false, depthTest: true, side: THREE.DoubleSide, fog: true,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneMinusSrcAlphaFactor, blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    });
    this.material.uniforms.uAtlas.value = atlas.texture;
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = renderOrder;
    this.mesh.name = 'fx-particles';
    this.mesh.matrixAutoUpdate = false;
  }

  /**
   * Turn on depth-based soft particles for this pool. `texture` is the world pass's depth copy
   * (render/'s RenderPostApi.sceneDepth). Only pools drawn into the world pass may use it: the
   * viewmodel is rendered after a depth clear and is not in the copy, so a viewmodel pool sampling
   * it would fade the muzzle flash against whatever happens to be behind the gun.
   */
  enableSoftParticles(texture: THREE.Texture): void {
    if (this.soft) { this.material.uniforms.uDepth.value = texture; return; }
    this.soft = true;
    this.material.uniforms.uDepth.value = texture;
    this.material.defines = { ...(this.material.defines ?? {}), SOFT_PARTICLES: '' };
    this.material.needsUpdate = true;
  }
  /** Per-frame camera/target state for the soft-particle fade. No-op until enableSoftParticles. */
  setDepthParams(near: number, far: number, width: number, height: number): void {
    if (!this.soft) return;
    const u = this.material.uniforms;
    u.uCamNearFar.value.set(near, far);
    u.uResolution.value.set(width, height);
  }

  /** Start describing a particle; fill fields on the returned descriptor and call emit(). */
  begin(t0: number): ParticleDesc { return this.d.reset(t0); }

  /** Slot index that the next emit() will write. Used to keep a handle on particles that are
   *  re-anchored to a moving transform each frame (see Fx's muzzle-flash attachment). */
  get nextSlot(): number { return this.head; }
  /** Move a live particle and its axis (world space), and flag the slot for re-upload. */
  repoint(slot: number, x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    const o = slot * STRIDE, a = this.data;
    a[o] = x; a[o + 1] = y; a[o + 2] = z;
    a[o + 32] = nx; a[o + 33] = ny; a[o + 34] = nz;
    if (slot < this.dirtyMin) this.dirtyMin = slot;
    if (slot > this.dirtyMax) this.dirtyMax = slot;
  }

  emit(): void {
    const d = this.d, o = this.head * STRIDE, a = this.data;
    a[o] = d.x; a[o + 1] = d.y; a[o + 2] = d.z; a[o + 3] = d.t0;
    a[o + 4] = d.vx; a[o + 5] = d.vy; a[o + 6] = d.vz; a[o + 7] = d.life;
    a[o + 8] = d.gravity; a[o + 9] = d.drag; a[o + 10] = d.floorY; a[o + 11] = d.stretch;
    a[o + 12] = d.size0; a[o + 13] = d.size1; a[o + 14] = d.rot; a[o + 15] = d.rotSpeed;
    a[o + 16] = d.r0; a[o + 17] = d.g0; a[o + 18] = d.b0; a[o + 19] = d.a0;
    a[o + 20] = d.r1; a[o + 21] = d.g1; a[o + 22] = d.b1; a[o + 23] = d.a1;
    a[o + 24] = d.cell; a[o + 25] = d.frames; a[o + 26] = d.mode; a[o + 27] = d.lit;
    a[o + 28] = d.additive; a[o + 29] = d.fadeIn; a[o + 30] = d.fadeOut; a[o + 31] = d.wobble;
    a[o + 32] = d.nx; a[o + 33] = d.ny; a[o + 34] = d.nz; a[o + 35] = d.curve;
    if (this.head < this.dirtyMin) this.dirtyMin = this.head;
    if (this.head > this.dirtyMax) this.dirtyMax = this.head;
    this.head = (this.head + 1) % this.capacity;
    if (this.head === 0) this.dirtyAll = true;
    this.alive++;
  }

  /** Kill everything (poses). */
  clear(): void { this.data.fill(0); this.dirtyAll = true; this.head = 0; this.alive = 0; }

  update(time: number, camera: THREE.Camera, light: PoolLighting): void {
    const u = this.material.uniforms;
    u.uTime.value = time;
    this.camRot.setFromMatrix4(camera.matrixWorld);
    u.uSunDir.value.copy(light.sunDir);
    u.uSunColor.value.copy(light.sunColor);
    u.uHemiSky.value.copy(light.hemiSky);
    u.uHemiGround.value.copy(light.hemiGround);
    if (this.dirtyAll) {
      this.range.start = 0; this.range.count = this.data.length;
      this.buffer.updateRanges.push(this.range); this.buffer.needsUpdate = true;
    } else if (this.dirtyMax >= 0) {
      this.range.start = this.dirtyMin * STRIDE; this.range.count = (this.dirtyMax - this.dirtyMin + 1) * STRIDE;
      this.buffer.updateRanges.push(this.range); this.buffer.needsUpdate = true;
    }
    this.dirtyAll = false; this.dirtyMin = Infinity; this.dirtyMax = -1;
  }
}
