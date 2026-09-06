import * as THREE from 'three';

/**
 * Separable-gaussian mip chain for the out-of-scope periphery.
 *
 * What it replaces: the periphery used to be one low-resolution world render upsampled straight to
 * full screen with a 5x5 tap on top. A hard upsample cannot invent the samples between source texels,
 * so every high-contrast edge — power lines, building silhouettes — came back as 8-16 px stair steps
 * that no amount of tap radius removes. Round 2 flagged exactly that.
 *
 * Instead the source is halved twice, each halving preceded by a proper 9-tap gaussian in each axis, so
 * detail is filtered out *before* it is thrown away. The result is a genuinely defocused image rather
 * than a pixelated one, and it costs four passes at 480x270 and below.
 */
export class MipBlur {
  private mat: THREE.ShaderMaterial;
  private quad: THREE.Mesh;
  private scene = new THREE.Scene();
  private cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  /** ping/pong pair per halving step */
  private rts: THREE.WebGLRenderTarget[] = [];
  private sizes: [number, number][] = [];

  constructor(w: number, h: number, steps = 2, type: THREE.TextureDataType = THREE.HalfFloatType) {
    for (let k = 1; k <= steps; k++) {
      const sw = Math.max(1, w >> k), sh = Math.max(1, h >> k);
      this.sizes.push([sw, sh]);
      for (let i = 0; i < 2; i++) {
        const rt = new THREE.WebGLRenderTarget(sw, sh, { type, depthBuffer: false, stencilBuffer: false });
        rt.texture.minFilter = THREE.LinearFilter; rt.texture.magFilter = THREE.LinearFilter;
        rt.texture.wrapS = rt.texture.wrapT = THREE.ClampToEdgeWrapping;
        this.rts.push(rt);
      }
    }
    this.mat = new THREE.ShaderMaterial({
      uniforms: { map: { value: null }, texel: { value: new THREE.Vector2() }, dir: { value: new THREE.Vector2(1, 0) } },
      vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }',
      fragmentShader: /* glsl */`
        uniform sampler2D map; uniform vec2 texel; uniform vec2 dir; varying vec2 vUv;
        void main() {
          // 9-tap gaussian (sigma ~2 source texels), sampled along the dir axis
          const float w0 = 0.2270270270, w1 = 0.1945945946, w2 = 0.1216216216, w3 = 0.0540540541, w4 = 0.0162162162;
          vec2 o = dir * texel;
          vec3 c = texture2D(map, vUv).rgb * w0;
          c += (texture2D(map, vUv + o).rgb + texture2D(map, vUv - o).rgb) * w1;
          c += (texture2D(map, vUv + o * 2.0).rgb + texture2D(map, vUv - o * 2.0).rgb) * w2;
          c += (texture2D(map, vUv + o * 3.0).rgb + texture2D(map, vUv - o * 3.0).rgb) * w3;
          c += (texture2D(map, vUv + o * 4.0).rgb + texture2D(map, vUv - o * 4.0).rgb) * w4;
          gl_FragColor = vec4(c, 1.0);
        }`,
      depthTest: false, depthWrite: false,
    });
    this.quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), this.mat);
    this.quad.frustumCulled = false;
    this.scene.add(this.quad);
  }

  /** Blur + halve `src` through the chain. Returns the smallest level's texture (stable across frames). */
  run(r: THREE.WebGLRenderer, src: THREE.Texture, srcW: number, srcH: number): THREE.Texture {
    const prev = r.getRenderTarget();
    let input = src, iw = srcW, ih = srcH;
    for (let k = 0; k < this.sizes.length; k++) {
      const [sw, sh] = this.sizes[k];
      const a = this.rts[k * 2], b = this.rts[k * 2 + 1];
      // horizontal at the *input* texel size (filter before discarding), then vertical at the new size
      this.pass(r, input, a, 1 / iw, 1 / ih, 1, 0);
      this.pass(r, a.texture, b, 1 / sw, 1 / sh, 0, 1);
      input = b.texture; iw = sw; ih = sh;
    }
    r.setRenderTarget(prev);
    return input;
  }

  private pass(r: THREE.WebGLRenderer, map: THREE.Texture, dst: THREE.WebGLRenderTarget, tx: number, ty: number, dx: number, dy: number): void {
    const u = this.mat.uniforms;
    u.map.value = map;
    (u.texel.value as THREE.Vector2).set(tx, ty);
    (u.dir.value as THREE.Vector2).set(dx, dy);
    r.setRenderTarget(dst);
    r.render(this.scene, this.cam);
  }

  dispose(): void { for (const rt of this.rts) rt.dispose(); this.mat.dispose(); this.quad.geometry.dispose(); }
}
