import * as THREE from 'three';

/**
 * Street lamps that actually light the street. A city has tens of thousands of lamps and three
 * can afford a handful of real lights, so the lamps near the camera are splatted into one top-down
 * map instead (an ortho render of one additive quad per lamp, redrawn only when the lamp set
 * changes or the camera has moved `RECENTRE` m), and every lit material reads it back as one extra
 * light:
 *
 *   R  = sum of f(theta) / d^2 over the lamps, at ground level: the radiant intensity reaching the
 *        spot per unit of `color` (f is the head's spread, cut off by 66 deg);
 *   GB = the same sum weighted by the offset from the spot to each head (x, z), so GB / R is where
 *        the light comes from on average - enough for the cosine on walls, bodies and kerbs, and a
 *        specular highlight (streaks on a wet road) at about the right place.
 *
 * The material side goes in through `patch` (called by render/Lighting's scan for every lit
 * material), just after `lights_fragment_begin`, as one more `RE_Direct`: diffuse and specular in
 * whatever model the material uses. It has no shadows - a car under a lamp does not shade the road -
 * and nothing above the heads is lit. Specular takes roughness >= 0.3, or a puddle's 0.03 turns one
 * lamp into a firefly the size of a pixel.
 */
/** Height of the lamp heads (city/Vegetation lampGeometries). */
export const LAMP_HEIGHT = 8.0;
/** How far the splat of one lamp reaches (m): past the 66 deg cutoff at 8 m. */
const SPLAT = 20;
/** Map half extent (m) and when to re-centre it. */
const EXTENT = 256;
const RECENTRE = 48;
/** Radiant intensity of one head (scene units at 1 m), and its colour: a warm 3500 K LED. */
const INTENSITY = 36;
const COLOR = new THREE.Color(1.0, 0.8, 0.58);

const SPLAT_VS = /* glsl */`
attribute vec2 aHead;
varying vec2 vOff;
void main() {
  vec2 p = aHead + position.xy * ${SPLAT.toFixed(1)};
  vOff = aHead - p;
  gl_Position = projectionMatrix * viewMatrix * vec4(p.x, 0.0, p.y, 1.0);
}`;

const SPLAT_FS = /* glsl */`
varying vec2 vOff;
void main() {
  float r2 = dot(vOff, vOff);
  float d2 = r2 + ${(LAMP_HEIGHT * LAMP_HEIGHT).toFixed(1)};
  float th = atan(sqrt(r2), ${LAMP_HEIGHT.toFixed(1)});
  // A little batwing (more light out along the road than straight down), and a cutoff from
  // ~49 to 66 deg (9-18 m out at 8 m), so each lamp leaves a pool with darker road between.
  float f = mix(1.0, 1.4, smoothstep(0.0, 0.7, th)) * (1.0 - smoothstep(0.85, 1.15, th));
  float w = f / d2;
  gl_FragColor = vec4(w, w * vOff.x, w * vOff.y, 0.0);
}`;

export const LAMP_PARS = /* glsl */`
uniform sampler2D dcLampMap;
uniform vec4 dcLampRect;
uniform vec3 dcLampColor;
`;

/** After lights_fragment_begin: geometry*, material and reflectedLight are all in scope. */
export const LAMP_LIGHT = /* glsl */`
if (dcLampColor.r + dcLampColor.g + dcLampColor.b > 0.0) {
  vec3 dcWP = (vec4(geometryPosition, 0.0) * viewMatrix).xyz + cameraPosition;
  // The map is drawn looking down with north (-z) up, so v runs against world z.
  vec2 dcUv = vec2(dcWP.x - dcLampRect.x, dcLampRect.y - dcWP.z) * dcLampRect.z + 0.5;
  vec2 dcEdge = min(dcUv, 1.0 - dcUv);
  float dcFade = smoothstep(0.0, 0.08, min(dcEdge.x, dcEdge.y)) * smoothstep(dcLampRect.w + 0.3, dcLampRect.w - 1.5, dcWP.y);
  vec4 dcS = texture2D(dcLampMap, dcUv);
  if (dcFade > 0.0 && dcS.r > 1e-5) {
    vec2 dcOff = dcS.gb / dcS.r;
    vec3 dcTo = vec3(dcOff.x, dcLampRect.w - dcWP.y, dcOff.y);
    // The map holds 1/d^2 for the ground; a point higher up is that much nearer the head.
    float dcD02 = dot(dcOff, dcOff) + dcLampRect.w * dcLampRect.w;
    float dcNear = clamp(dcD02 / max(dot(dcTo, dcTo), 1e-3), 0.0, 2.5);
    IncidentLight dcLamp;
    dcLamp.color = dcLampColor * (dcS.r * dcNear * dcFade);
    dcLamp.direction = normalize((viewMatrix * vec4(dcTo, 0.0)).xyz);
    dcLamp.visible = true;
    #if defined( STANDARD )
      PhysicalMaterial dcMat = material;
      dcMat.roughness = max(dcMat.roughness, 0.3);
      RE_Direct(dcLamp, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, dcMat, reflectedLight);
    #else
      RE_Direct(dcLamp, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
    #endif
  }
}
`;

export interface LampUniforms {
  dcLampMap: { value: THREE.Texture };
  dcLampRect: { value: THREE.Vector4 };
  dcLampColor: { value: THREE.Color };
}

export class StreetLights {
  readonly uniforms: LampUniforms;
  private target: THREE.WebGLRenderTarget;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-EXTENT, EXTENT, EXTENT, -EXTENT, -10, 10);
  private mesh: THREE.Mesh;
  private heads: THREE.InstancedBufferAttribute;
  private geo: THREE.InstancedBufferGeometry;
  private cap = 4096;
  private all: Float32Array = new Float32Array(0);
  private dirty = false;
  private centre = new THREE.Vector2(1e9, 1e9);

  /** `gain` scales every lamp (`?lamps=0.5`; 0 leaves the streets to the moon, for A/B). */
  constructor(private renderer: THREE.WebGLRenderer, size: number, private gain = 1) {
    this.target = new THREE.WebGLRenderTarget(size, size, {
      type: THREE.HalfFloatType, format: THREE.RGBAFormat, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
      depthBuffer: false, stencilBuffer: false, generateMipmaps: false,
    });
    this.target.texture.name = 'streetLights';
    this.uniforms = {
      dcLampMap: { value: this.target.texture },
      dcLampRect: { value: new THREE.Vector4(0, 0, 1 / (2 * EXTENT), LAMP_HEIGHT) },
      dcLampColor: { value: new THREE.Color(0, 0, 0) },
    };
    const quad = new THREE.PlaneGeometry(2, 2);
    this.geo = new THREE.InstancedBufferGeometry();
    this.geo.index = quad.index;
    this.geo.setAttribute('position', quad.getAttribute('position'));
    this.heads = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 2), 2);
    this.heads.setUsage(THREE.DynamicDrawUsage);
    this.geo.setAttribute('aHead', this.heads);
    this.geo.instanceCount = 0;
    const mat = new THREE.ShaderMaterial({
      vertexShader: SPLAT_VS, fragmentShader: SPLAT_FS, depthTest: false, depthWrite: false, side: THREE.DoubleSide,
      blending: THREE.CustomBlending, blendEquation: THREE.AddEquation, blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor,
      blendSrcAlpha: THREE.OneFactor, blendDstAlpha: THREE.OneFactor,
    });
    // A plain Mesh on an InstancedBufferGeometry: an InstancedMesh would bind its 1-long instanceMatrix.
    this.mesh = new THREE.Mesh(this.geo, mat);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
    // Top down, +x east (u) and north, world -z, up (v): the material side assumes both.
    this.cam.position.set(0, 5, 0);
    this.cam.up.set(0, 0, -1);
    this.cam.lookAt(0, 0, 0);
  }

  /** The lamp heads the city has streamed in, as world [x, z] pairs. */
  setHeads(xz: Float32Array): void { this.all = xz; this.dirty = true; }

  /** Before the frame: brightness follows the night, the map follows the camera. */
  update(focus: THREE.Vector3, night: number): void {
    const on = this.all.length > 0 ? night * this.gain : 0;
    this.uniforms.dcLampColor.value.copy(COLOR).multiplyScalar(INTENSITY * on);
    if (on <= 0) return;
    if (Math.abs(focus.x - this.centre.x) > RECENTRE || Math.abs(focus.z - this.centre.y) > RECENTRE) {
      this.centre.set(Math.round(focus.x / 8) * 8, Math.round(focus.z / 8) * 8);
      this.dirty = true;
    }
    if (this.dirty) this.draw();
  }

  private draw(): void {
    this.dirty = false;
    const cx = this.centre.x, cy = this.centre.y, reach = EXTENT + SPLAT;
    const src = this.all, dst = this.heads.array as Float32Array;
    let n = 0;
    for (let i = 0; i < src.length && n < this.cap; i += 2) {
      if (Math.abs(src[i] - cx) > reach || Math.abs(src[i + 1] - cy) > reach) continue;
      dst[n * 2] = src[i]; dst[n * 2 + 1] = src[i + 1]; n++;
    }
    this.heads.needsUpdate = true;
    this.geo.instanceCount = n;
    this.cam.position.set(cx, 5, cy);
    this.cam.lookAt(cx, 0, cy);
    this.uniforms.dcLampRect.value.set(cx, cy, 1 / (2 * EXTENT), LAMP_HEIGHT);
    const r = this.renderer, prev = r.getRenderTarget(), clear = r.getClearColor(new THREE.Color()), alpha = r.getClearAlpha();
    r.setRenderTarget(this.target);
    r.setClearColor(0x000000, 0);
    r.clear(true, false, false);
    if (n) r.render(this.scene, this.cam);
    r.setRenderTarget(prev);
    r.setClearColor(clear, alpha);
  }

  /** Inject the lamp light into a lit material's shader (inside onBeforeCompile). */
  patch(shader: THREE.WebGLProgramParametersWithUniforms): void {
    const fs = shader.fragmentShader;
    if (!fs.includes('#include <common>') || !fs.includes('#include <lights_fragment_begin>')) return;
    Object.assign(shader.uniforms, this.uniforms);
    shader.fragmentShader = fs
      .replace('#include <common>', '#include <common>\n' + LAMP_PARS)
      .replace('#include <lights_fragment_begin>', '#include <lights_fragment_begin>\n' + LAMP_LIGHT);
  }

  dispose(): void { this.target.dispose(); this.geo.dispose(); (this.mesh.material as THREE.Material).dispose(); }
}
