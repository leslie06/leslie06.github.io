import * as THREE from 'three';
import type { Engine, System } from '../core/Engine';

export type TimeOfDayName = 'day' | 'dusk';

/** Everything the rest of the render module needs to know about the current sky. */
export interface SkyState {
  tod: TimeOfDayName;
  /** Unit vector from the scene towards the sun (world space, after HDRI rotation). */
  sunDir: THREE.Vector3;
  sunColor: THREE.Color;
  sunIntensity: number;
  exposure: number;
  envIntensity: number;
  /** Hemisphere ambient: cool sky term + warm ground bounce, plus the albedo-tinted bounce radiance. */
  ambient: { sky: THREE.Color; ground: THREE.Color; intensity: number; bounce: THREE.Color; bounceStrength: number };
  /** Aerial perspective / height fog parameters consumed by the Atmosphere effect. */
  fog: { color: THREE.Color; sunScatter: THREE.Color; density: number; heightFalloff: number; base: number; sunPower: number; maxFog: number; skyHaze: number; desaturate: number; lift: number; tint: THREE.Color };
  /**
   * Small blurred equirect of the current sky in scene radiance units, plus the Y rotation that was
   * applied to the background. The Atmosphere effect samples it per pixel so the haze colour IS the
   * sky behind the geometry; without it the horizon draws a hard band wherever the two disagree.
   */
  skyTex: THREE.DataTexture | null;
  skyRotation: number;
  /** Procedural cloud layer (render/effects/Clouds). Colours are HDR radiance, pre-tone-map. */
  clouds: { lit: THREE.Color; dark: THREE.Color; coverage: number; sharpness: number; altitude: number; thickness: number; scale: number; wind: THREE.Vector2; opacity: number; cirrus: number; shadow: number; maxDist: number; profile: number; gain: number; detail: number };
}

interface TodPreset {
  hdri: string;
  /** Where the sun should sit in the world, in degrees: azimuth = atan2(z, x). */
  targetAzimuthDeg: number;
  /** Optional elevation override in degrees. Leave undefined to keep the HDRI's own sun elevation so the
   *  baked sky glow, the disc and the shadow direction agree. */
  elevationDeg?: number;
  sunIntensity: number;
  sunColor: THREE.Color;
  /** Blend between the HDRI-derived sun colour (0) and `sunColor` (1). */
  sunColorMix: number;
  envIntensity: number;
  /** Radiance clamp applied to the IBL copy of the HDRI (not the background): the analytic sun owns the
   *  direct specular, so the baked sun must not blow every glossy surface to white through the env map. */
  envMax: number;
  bgIntensity: number;
  exposure: number;
  /** 0 hides the procedural disc (the HDRI already carries a sun). */
  discIntensity: number;
  /**
   * A light blur on the HDRI background. Only enough to take the photographic crispness off its baked
   * clouds so the lit procedural layer reads as the nearer, shaped one - blurring it away entirely
   * turns a 60%-cloud sky into flat milk and loses the blue. The IBL keeps its own unblurred PMREM.
   */
  bgBlur: number;
  clouds: SkyState['clouds'];
  ambient: SkyState['ambient'];
  fog: SkyState['fog'];
}

const PRESETS: Record<TimeOfDayName, TodPreset> = {
  day: {
    // kloofendal_48d: real sun disc at 48 deg elevation, partly cloudy, blue-grey horizon. Kept at native elevation.
    hdri: 'kloofendal_48d_partly_cloudy_puresky_2k', targetAzimuthDeg: 30,
    sunIntensity: 6.0, sunColor: new THREE.Color(1.0, 0.93, 0.82), sunColorMix: 0.55,
    envIntensity: 0.45, envMax: 24, bgIntensity: 1.0, exposure: 0.95, discIntensity: 26, bgBlur: 0.06,
    clouds: { lit: new THREE.Color(2.10, 2.14, 2.24), dark: new THREE.Color(0.15, 0.21, 0.40), coverage: 0.575, sharpness: 0.05, altitude: 1100, thickness: 900, scale: 0.00090, wind: new THREE.Vector2(0.0011, 0.0004), opacity: 1.0, cirrus: 0.12, shadow: 6.6, maxDist: 3600, profile: 0.16, gain: 5.0, detail: 0.075 },
    ambient: { sky: new THREE.Color(0.62, 0.68, 0.80), ground: new THREE.Color(0.74, 0.57, 0.37), intensity: 1.06, bounce: new THREE.Color(0.62, 0.47, 0.30), bounceStrength: 0.98 },
    // heightFalloff 0.009 = a 111 m scale height, so the 60-80 m skyline still sits in haze
    // (0.045 was 22 m: everything above ~40 m came through at full contrast and full saturation).
    fog: { color: new THREE.Color(0.55, 0.62, 0.74), sunScatter: new THREE.Color(0.62, 0.47, 0.29), density: 0.0020, heightFalloff: 0.009, base: 0, sunPower: 6, maxFog: 0.97, skyHaze: 0.30, desaturate: 0.34, lift: 0.10, tint: new THREE.Color(0.94, 0.98, 1.07) },
  },
  dusk: {
    hdri: 'industrial_sunset_puresky_2k', targetAzimuthDeg: -150,
    sunIntensity: 5.2, sunColor: new THREE.Color(1.0, 0.52, 0.24), sunColorMix: 0.6,
    // Exposure is the whole dusk look: at 1.05 the bright sunset HDRI clipped over most of the frame
    // and everything under it landed in the same milky midtone. 0.78 puts the sky just under clipping,
    // keeps the disc and its bloom halo, and lets the ground fall away into real shadow.
    envIntensity: 0.46, envMax: 30, bgIntensity: 1.0, exposure: 0.82, discIntensity: 60, bgBlur: 0.10,
    // Dusk: the sun rakes the layer from below, so tops go orange-white and bases go violet.
    clouds: { lit: new THREE.Color(4.6, 2.42, 1.12), dark: new THREE.Color(0.07, 0.062, 0.14), coverage: 0.50, sharpness: 0.09, altitude: 1200, thickness: 950, scale: 0.00082, wind: new THREE.Vector2(0.0009, 0.0003), opacity: 1.0, cirrus: 0.22, shadow: 5.2, maxDist: 3600, profile: 0.155, gain: 5.2, detail: 0.08 },
    ambient: { sky: new THREE.Color(0.42, 0.43, 0.58), ground: new THREE.Color(0.62, 0.37, 0.21), intensity: 0.66, bounce: new THREE.Color(0.58, 0.34, 0.18), bounceStrength: 0.85 },
    fog: { color: new THREE.Color(0.32, 0.31, 0.42), sunScatter: new THREE.Color(0.55, 0.26, 0.10), density: 0.0014, heightFalloff: 0.011, base: 0, sunPower: 5, maxFog: 0.87, skyHaze: 0.22, desaturate: 0.13, lift: 0.05, tint: new THREE.Color(0.95, 0.96, 1.04) },
  },
};

interface EnvEntry { env: THREE.Texture; bg: THREE.DataTexture; sunImg: THREE.Vector3; horizon: THREE.Color; sunRgb: THREE.Color; skyLo: THREE.DataTexture }

/**
 * Sky + environment lighting. HDRI background/IBL (PMREM) for the world and the viewmodel scene,
 * sun direction derived from the brightest region of the HDRI (then rotated to a good place over the
 * level), horizon colour sampled from the HDRI for the fog, and a HDR sun disc used by bloom / shafts.
 * Time of day: `?tod=dusk` at boot or `setTimeOfDay()` at runtime.
 */
export class Sky implements System {
  name = 'sky';
  state: SkyState;
  sunDisc: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  fog: THREE.FogExp2;
  onChange: ((s: SkyState) => void)[] = [];
  private envCache = new Map<string, EnvEntry>();
  private discTex: THREE.DataTexture;

  constructor(private engine: Engine) {
    const p = PRESETS.day;
    this.state = {
      tod: 'day', sunDir: new THREE.Vector3(-0.45, 0.4, -0.8).normalize(), sunColor: p.sunColor.clone(), sunIntensity: p.sunIntensity, exposure: p.exposure, envIntensity: p.envIntensity,
      ambient: { sky: p.ambient.sky.clone(), ground: p.ambient.ground.clone(), intensity: p.ambient.intensity, bounce: p.ambient.bounce.clone(), bounceStrength: p.ambient.bounceStrength },
      fog: { ...p.fog, color: p.fog.color.clone(), sunScatter: p.fog.sunScatter.clone(), tint: p.fog.tint.clone() },
      skyTex: null, skyRotation: 0,
      clouds: { ...p.clouds, lit: p.clouds.lit.clone(), dark: p.clouds.dark.clone(), wind: p.clouds.wind.clone() },
    };
    this.fog = new THREE.FogExp2(p.fog.color.getHex(), p.fog.density * 0.3);
    engine.scene.fog = this.fog;
    engine.scene.background = new THREE.Color(0x8fa6c4);

    this.discTex = Sky.makeDiscTexture(256);
    const mat = new THREE.MeshBasicMaterial({ map: this.discTex, transparent: true, depthWrite: false, depthTest: true, fog: false, blending: THREE.AdditiveBlending, color: new THREE.Color(1, 1, 1) });
    mat.toneMapped = false;
    this.sunDisc = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), mat);
    this.sunDisc.frustumCulled = false; this.sunDisc.renderOrder = -1000; this.sunDisc.name = 'sunDisc';
    this.sunDisc.castShadow = false; this.sunDisc.receiveShadow = false;
    engine.scene.add(this.sunDisc);
  }

  /** Core radius as a fraction of the quad's half-width; the rest of the quad is the halo. */
  private static readonly DISC_CORE = 0.14;
  private static readonly DISC_ANGLE_DEG = 1.15;

  /**
   * Sun sprite: a small hard core inside a wide, steeply-falling halo. Drawn additively at
   * `discIntensity` x the sun colour, so the core and the inner halo clip to white and the outer
   * halo lands just above the bloom threshold - which is what draws ref_10's 15-20%-of-frame glow
   * instead of a bare dot.
   */
  private static makeDiscTexture(n: number): THREE.DataTexture {
    const f = Sky.DISC_CORE;
    const data = new Uint8Array(n * n * 4);
    for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
      const dx = (x + 0.5) / n - 0.5, dy = (y + 0.5) / n - 0.5; const r = Math.sqrt(dx * dx + dy * dy) * 2; // 0 center .. 1 edge
      const core = THREE.MathUtils.smoothstep(1 - r, 1 - f, 1 - f * 0.75);
      const k = Math.max(0, 1 - r);
      const glow = Math.pow(k, 4) * 0.30 + Math.pow(k, 1.4) * 0.012;
      const a = Math.min(1, core + glow);
      const i = (y * n + x) * 4; data[i] = data[i + 1] = data[i + 2] = 255; data[i + 3] = Math.round(a * 255);
    }
    const t = new THREE.DataTexture(data, n, n, THREE.RGBAFormat); t.needsUpdate = true; t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  async load(tod: TimeOfDayName = 'day'): Promise<void> { await this.setTimeOfDay(tod); }

  /** Switches sky, IBL, sun and fog. Safe to call at runtime; the previous sky stays until the new HDRI is decoded. */
  async setTimeOfDay(tod: TimeOfDayName): Promise<void> {
    const p = PRESETS[tod] ?? PRESETS.day;
    try {
      const entry = await this.getEnv(p);
      this.apply(tod, p, entry);
    } catch (e) {
      console.warn('[sky] HDRI unavailable, keeping gradient', e);
      this.state.tod = tod; this.applyFallback(p);
    }
  }

  private async getEnv(p: TodPreset): Promise<EnvEntry> {
    let e = this.envCache.get(p.hdri);
    if (e) return e;
    const tex = await this.engine.assets.hdri(p.hdri);
    const a = Sky.analyze(tex);
    const clamped = Sky.clampRadiance(tex, p.envMax);
    const pmrem = new THREE.PMREMGenerator(this.engine.renderer);
    const env = pmrem.fromEquirectangular(clamped).texture;
    pmrem.dispose();
    if (clamped !== tex) clamped.dispose();
    e = { env, bg: tex, sunImg: a.sunDir, horizon: a.horizon, sunRgb: a.sunRgb, skyLo: Sky.lowResSky(tex) };
    this.envCache.set(p.hdri, e);
    return e;
  }

  /** Copy of the HDRI with per-pixel luminance limited to `maxL` (hue preserved) for the IBL. Returns the input if nothing exceeds it. */
  private static clampRadiance(tex: THREE.DataTexture, maxL: number): THREE.DataTexture {
    const img = tex.image as { width: number; height: number; data: Float32Array | Uint16Array };
    const w = img.width, h = img.height, raw = img.data;
    const half = raw instanceof Uint16Array;
    const ch = raw.length / (w * h);
    const get = (i: number) => half ? THREE.DataUtils.fromHalfFloat(raw[i]) : (raw[i] as number);
    let over = false;
    for (let i = 0; i < raw.length; i += ch) { if (get(i) > maxL || get(i + 1) > maxL || get(i + 2) > maxL) { over = true; break; } }
    if (!over) return tex;
    const out = new Float32Array(w * h * 4);
    for (let p = 0, o = 0; p < raw.length; p += ch, o += 4) {
      const r = get(p), g = get(p + 1), b = get(p + 2);
      const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const s = l > maxL ? maxL / l : 1;
      out[o] = r * s; out[o + 1] = g * s; out[o + 2] = b * s; out[o + 3] = 1;
    }
    const t = new THREE.DataTexture(out, w, h, THREE.RGBAFormat, THREE.FloatType);
    t.mapping = THREE.EquirectangularReflectionMapping; t.colorSpace = tex.colorSpace; t.flipY = tex.flipY;
    t.needsUpdate = true;
    return t;
  }

  /**
   * Small blurred equirect of the sky in scene radiance units, used as the aerial-perspective haze
   * colour. Rows run bottom (v=0, elevation -90) to top (v=1, +90) so `asin(dir.y)/PI + 0.5` indexes
   * it directly, independent of how the HDR loader flipped the source.
   *
   * The sun is clamped out (`maxL`) before binning: this is the *diffuse* sky term, and letting a
   * 300x radiance pixel into a horizon bin would paint that whole side of the world white. Forward
   * scatter around the sun is a separate lobe in the shader.
   */
  private static lowResSky(tex: THREE.DataTexture, nx = 128, ny = 64, maxL = 6): THREE.DataTexture {
    const img = tex.image as { width: number; height: number; data: Float32Array | Uint16Array };
    const w = img.width, h = img.height, raw = img.data;
    const half = raw instanceof Uint16Array;
    const ch = raw.length / (w * h);
    const get = (i: number) => half ? THREE.DataUtils.fromHalfFloat(raw[i]) : (raw[i] as number);
    const acc = new Float32Array(nx * ny * 3);
    const cnt = new Float32Array(nx * ny);
    const step = w > 1024 ? 2 : 1;
    for (let y = 0; y < h; y += step) {
      // Source row 0 is the top of the image (elevation +90); our row 0 is the bottom.
      const elev = 0.5 - (y + 0.5) / h;                    // +0.5 top .. -0.5 bottom
      const j = THREE.MathUtils.clamp(Math.floor((elev + 0.5) * ny), 0, ny - 1);
      for (let x = 0; x < w; x += step) {
        const i = THREE.MathUtils.clamp(Math.floor(((x + 0.5) / w) * nx), 0, nx - 1);
        const o = (y * w + x) * ch;
        let r = get(o), g = get(o + 1), b = get(o + 2);
        const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        if (l > maxL) { const k = maxL / l; r *= k; g *= k; b *= k; }
        const d = (j * nx + i) * 3;
        acc[d] += r; acc[d + 1] += g; acc[d + 2] += b; cnt[j * nx + i]++;
      }
    }
    const flat = new Float32Array(nx * ny * 3);
    for (let i = 0; i < nx * ny; i++) {
      const n = Math.max(cnt[i], 1);
      flat[i * 3] = acc[i * 3] / n; flat[i * 3 + 1] = acc[i * 3 + 1] / n; flat[i * 3 + 2] = acc[i * 3 + 2] / n;
    }
    // Two 3x3 blurs (wrapping in u, clamping in v) so cloud edges do not print into the haze colour.
    const tmp = new Float32Array(flat.length);
    for (let pass = 0; pass < 2; pass++) {
      tmp.set(flat);
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
        let r = 0, g = 0, b = 0;
        for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
          const jj = THREE.MathUtils.clamp(j + dj, 0, ny - 1), ii = (i + di + nx) % nx;
          const d = (jj * nx + ii) * 3; r += tmp[d]; g += tmp[d + 1]; b += tmp[d + 2];
        }
        const d = (j * nx + i) * 3; flat[d] = r / 9; flat[d + 1] = g / 9; flat[d + 2] = b / 9;
      }
    }
    const data = new Float32Array(nx * ny * 4);
    for (let i = 0; i < nx * ny; i++) { data[i * 4] = flat[i * 3]; data[i * 4 + 1] = flat[i * 3 + 1]; data[i * 4 + 2] = flat[i * 3 + 2]; data[i * 4 + 3] = 1; }
    const t = new THREE.DataTexture(data, nx, ny, THREE.RGBAFormat, THREE.FloatType);
    t.wrapS = THREE.RepeatWrapping; t.wrapT = THREE.ClampToEdgeWrapping;
    t.minFilter = t.magFilter = THREE.LinearFilter;
    t.colorSpace = THREE.NoColorSpace; t.flipY = false; t.generateMipmaps = false;
    t.needsUpdate = true;
    return t;
  }

  /** Scans the equirect HDR for the sun (luminance-weighted centroid of the brightest pixels) and the mean horizon colour. */
  private static analyze(tex: THREE.DataTexture): { sunDir: THREE.Vector3; horizon: THREE.Color; sunRgb: THREE.Color } {
    const img = tex.image as { width: number; height: number; data: Float32Array | Uint16Array };
    const w = img.width, h = img.height, raw = img.data;
    const half = raw instanceof Uint16Array;
    const ch = raw.length / (w * h);
    const px = (x: number, y: number, c: number) => { const v = raw[(y * w + x) * ch + c]; return half ? THREE.DataUtils.fromHalfFloat(v) : v; };
    const step = 2;
    let maxL = 0;
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) { const l = 0.2126 * px(x, y, 0) + 0.7152 * px(x, y, 1) + 0.0722 * px(x, y, 2); if (l > maxL) maxL = l; }
    let cx = 0, cy = 0, cw = 0; const sunRgb = new THREE.Color(0, 0, 0); let sn = 0;
    for (let y = 0; y < h; y += step) for (let x = 0; x < w; x += step) {
      const r = px(x, y, 0), g = px(x, y, 1), b = px(x, y, 2); const l = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (l > maxL * 0.3) { cx += x * l; cy += y * l; cw += l; sunRgb.r += r; sunRgb.g += g; sunRgb.b += b; sn++; }
    }
    cx /= Math.max(cw, 1e-6); cy /= Math.max(cw, 1e-6);
    if (sn > 0) sunRgb.multiplyScalar(1 / sn);
    // three's equirect mapping: u = atan(z, x) / 2pi + 0.5, v = asin(y) / pi + 0.5 ; row 0 of the file is the top (flipY).
    const elev = (0.5 - cy / h) * Math.PI, phi = (cx / w - 0.5) * Math.PI * 2;
    const sunDir = new THREE.Vector3(Math.cos(elev) * Math.cos(phi), Math.sin(elev), Math.cos(elev) * Math.sin(phi));
    // Horizon: rows 1.5..5 degrees above the horizon, excluding +-30 degrees of azimuth around the sun.
    const horizon = new THREE.Color(0, 0, 0); let hn = 0;
    const y0 = Math.floor((0.5 - 5 / 180) * h), y1 = Math.floor((0.5 - 1.5 / 180) * h);
    for (let y = y0; y <= y1; y += 1) for (let x = 0; x < w; x += 4) {
      let dphi = Math.abs((x / w - 0.5) * 360 - phi * 180 / Math.PI); if (dphi > 180) dphi = 360 - dphi;
      if (dphi < 30) continue;
      horizon.r += px(x, y, 0); horizon.g += px(x, y, 1); horizon.b += px(x, y, 2); hn++;
    }
    if (hn > 0) horizon.multiplyScalar(1 / hn);
    return { sunDir, horizon, sunRgb };
  }

  private apply(tod: TimeOfDayName, p: TodPreset, e: EnvEntry): void {
    const s = this.engine.scene, vs = this.engine.viewmodelScene;
    // Rotate the sky so the sun lands at the preset azimuth. World dir = R(theta) * imageDir, and a
    // rotation of +theta about Y maps azimuth phi to phi - theta.
    const phiImg = Math.atan2(e.sunImg.z, e.sunImg.x);
    const theta = phiImg - THREE.MathUtils.degToRad(p.targetAzimuthDeg);
    s.background = e.bg; s.backgroundIntensity = p.bgIntensity; s.backgroundBlurriness = p.bgBlur;
    s.backgroundRotation.set(0, theta, 0);
    s.environment = e.env; s.environmentIntensity = p.envIntensity; s.environmentRotation.set(0, theta, 0);
    vs.environment = e.env; vs.environmentIntensity = p.envIntensity; vs.environmentRotation.set(0, theta, 0);

    const dir = e.sunImg.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), theta);
    if (p.elevationDeg !== undefined) {
      const el = THREE.MathUtils.degToRad(p.elevationDeg); const az = Math.atan2(dir.z, dir.x);
      dir.set(Math.cos(el) * Math.cos(az), Math.sin(el), Math.cos(el) * Math.sin(az));
    }
    const st = this.state;
    st.tod = tod;
    st.sunDir.copy(dir.normalize());
    // Sun colour: HDRI sun chroma (normalised to max channel) blended with the preset.
    const hc = e.sunRgb.clone(); const m = Math.max(hc.r, hc.g, hc.b, 1e-4); hc.multiplyScalar(1 / m);
    st.sunColor.copy(hc).lerp(p.sunColor, p.sunColorMix);
    st.sunIntensity = p.sunIntensity;
    st.exposure = p.exposure;
    st.envIntensity = p.envIntensity;
    st.ambient.sky.copy(p.ambient.sky); st.ambient.ground.copy(p.ambient.ground); st.ambient.intensity = p.ambient.intensity;
    // Bounce carries the sun's own colour: it is sunlight that hit the ground and came back.
    st.ambient.bounce.copy(p.ambient.bounce).multiply(st.sunColor); st.ambient.bounceStrength = p.ambient.bounceStrength;
    // Fog: HDRI horizon radiance, desaturated and pushed slightly blue so distance reads as air, not grey paint.
    const hz = e.horizon.clone().multiplyScalar(p.bgIntensity);
    const lum = 0.2126 * hz.r + 0.7152 * hz.g + 0.0722 * hz.b;
    const desat = new THREE.Color(lum, lum, lum).lerp(hz, 0.6).multiply(new THREE.Color(0.9, 0.96, 1.08)).multiplyScalar(0.7);
    st.fog.color.copy(desat).lerp(p.fog.color, 0.45);
    st.fog.sunScatter.copy(p.fog.sunScatter);
    st.fog.density = p.fog.density; st.fog.heightFalloff = p.fog.heightFalloff; st.fog.base = p.fog.base; st.fog.sunPower = p.fog.sunPower; st.fog.maxFog = p.fog.maxFog; st.fog.skyHaze = p.fog.skyHaze;
    st.fog.desaturate = p.fog.desaturate; st.fog.lift = p.fog.lift; st.fog.tint.copy(p.fog.tint);
    st.skyTex = e.skyLo; st.skyRotation = theta;
    st.clouds.lit.copy(p.clouds.lit); st.clouds.dark.copy(p.clouds.dark); st.clouds.wind.copy(p.clouds.wind);
    st.clouds.coverage = p.clouds.coverage; st.clouds.sharpness = p.clouds.sharpness;
    st.clouds.altitude = p.clouds.altitude; st.clouds.thickness = p.clouds.thickness;
    st.clouds.scale = p.clouds.scale; st.clouds.opacity = p.clouds.opacity;
    st.clouds.cirrus = p.clouds.cirrus; st.clouds.shadow = p.clouds.shadow; st.clouds.maxDist = p.clouds.maxDist;
    st.clouds.profile = p.clouds.profile; st.clouds.gain = p.clouds.gain; st.clouds.detail = p.clouds.detail;
    // The Atmosphere effect owns aerial perspective now. scene.fog stays only as a far-clip safety net
    // for the bypass path; at the old 0.3x it double-fogged everything the post pass already hazed.
    this.fog.color.copy(st.fog.color); this.fog.density = p.fog.density * 0.12;

    this.sunDisc.material.color.copy(st.sunColor).multiplyScalar(Math.max(p.discIntensity, 0.001));
    this.sunDisc.visible = p.discIntensity > 0;
    this.engine.renderer.toneMappingExposure = p.exposure;
    for (const cb of this.onChange) cb(st);
  }

  private applyFallback(p: TodPreset): void {
    const st = this.state;
    st.sunColor.copy(p.sunColor); st.sunIntensity = p.sunIntensity; st.exposure = p.exposure; st.envIntensity = p.envIntensity;
    st.fog.color.copy(p.fog.color); st.fog.density = p.fog.density;
    this.engine.scene.background = new THREE.Color(0x8fa6c4);
    for (const cb of this.onChange) cb(st);
  }

  /** Keeps the sun disc pinned at 'infinity' along the sun direction. Runs right before the frame is drawn. */
  beforeRender(): void {
    const cam = this.engine.camera;
    const dist = Math.min(cam.far * 0.8, 480);
    const d = this.sunDisc;
    d.position.copy(cam.position).addScaledVector(this.state.sunDir, dist);
    d.quaternion.copy(cam.quaternion);
    // The quad is sized so the *core* subtends DISC_ANGLE_DEG; the halo fills the rest of it.
    const size = dist * Math.tan(THREE.MathUtils.degToRad(Sky.DISC_ANGLE_DEG)) * 2 / Sky.DISC_CORE;
    d.scale.set(size, size, 1);
    d.updateMatrixWorld();
  }

  update(): void { /* nothing per frame besides beforeRender */ }
}
