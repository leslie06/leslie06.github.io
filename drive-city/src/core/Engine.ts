import * as THREE from 'three';
import { EventBus } from './Events';
import { Input } from './Input';
import { Physics } from './Physics';
import { Assets } from './Assets';
import { detectGpu, pickTier, settingsFor, type GpuInfo, type QualitySettings } from './Quality';
import { newGovernor, step as governorStep, type GovernorConfig, type GovernorState } from './Resolution';

/** Frames the resolution governor ignores at boot (shader compiles, first uploads). */
const WARMUP_FRAMES = 180;
const LITE_KEY = 'drivecity.lite.v1';

/** A system gets a fixed-step tick (60Hz, physics/gameplay) and a per-frame update (render/visuals). */
export interface System {
  name: string;
  fixedUpdate?(dt: number): void;
  /** Runs after every physics step, for systems that read the post-step state (impacts, telemetry). */
  postStep?(dt: number): void;
  update?(dt: number, alpha: number): void;
  resize?(w: number, h: number): void;
  dispose?(): void;
}

/**
 * Owns renderer/scene/camera, the fixed-step loop and the system list. Adapted from gunFight's
 * engine without the first-person viewmodel pass.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  readonly events = new EventBus();
  readonly input: Input;
  readonly physics = new Physics();
  readonly assets = new Assets();
  quality: QualitySettings;
  readonly systems: System[] = [];
  /** performance.now() of the previous tick (THREE.Clock is deprecated in r185). */
  private lastTick = -1;
  time = 0;
  frame = 0;
  paused = false;
  timeScale = 1;
  /** performance.now() until which the world runs slowed (a crash, a punch landing): vehicle/ sets `timeScale` from it. */
  hitStopUntil = 0;
  /** Slow the world for `ms` of wall clock (the hit-stop of an impact; never in shot mode - the caller checks). */
  hitStop(ms: number): void { this.hitStopUntil = Math.max(this.hitStopUntil, performance.now() + ms); }
  renderFrame: (dt: number) => void;
  private accumulator = 0;
  private raf = 0;
  readonly canvas: HTMLCanvasElement;
  private maxSubSteps = 4;
  private governor: GovernorState;
  private governorCfg: GovernorConfig;
  renderScale = 1;
  private lastCompact = -Infinity;
  private compactPending = false;
  readonly gpu: GpuInfo;
  frameCapMs = 0;
  private lastPresent = -1e9;
  contextLost = false;
  /** Mean frame interval (ms) over the last half second, for the diagnostics panel. */
  frameMs = 16.7;
  /**
   * JS time of the last frame (ms): input, fixed steps, updates and the render's draw submission, but not the GPU's
   * own work, which runs after. Close to the frame interval = the CPU is the limit; far under it = the GPU (or vsync).
   */
  cpuMs = 0;
  /**
   * 省电档（2026-10-18，埋点：两台 Mali-G76 安卓手机在最低画质下只有 19 和 25 帧）：模拟手机分辨率、CPU 降速 6 倍时
   * 每帧 47 ms 几乎全是 CPU，降分辨率没用。最低画质下进城后实测帧率中位数连续两段（各约 240 帧）低于 40 帧就打开，
   * 记在本机，下次进游戏直接用：交通车和骑手少一半、行人少三成、小地图隔帧画（各模块读这个字段或听 'quality:lite'）。
   * `?lite=1` 强制打开、`?lite=0` 关掉、清掉本机的记录并且这次不自动打开；只在 low 档生效，菜单里选了中、高画质就没有它。
   */
  lite = false;
  private liteAuto = false;
  private liteArmed = false;
  private liteWin: number[] = [];
  private liteSlow = 0;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    const shot = new URLSearchParams(location.search).has('shot');
    // No canvas MSAA: the post chain (render/PostFx) anti-aliases with SMAA, MSAA would only cost bandwidth.
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false, preserveDrawingBuffer: shot });
    this.gpu = detectGpu(this.renderer.getContext());
    this.quality = settingsFor(pickTier(this.gpu));
    this.governor = newGovernor(1, WARMUP_FRAMES, this.quality.maxRenderScale);
    this.governorCfg = { targetFps: this.quality.targetFps, minScale: this.quality.minRenderScale, maxScale: this.quality.maxRenderScale, window: 30, cooldown: 20 };
    this.frameCapMs = Engine.frameCapMs(this.quality.frameCap);
    this.renderer.setPixelRatio(this.baseRatio(container.clientWidth, container.clientHeight));
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.info.autoReset = false;
    {
      const q = new URLSearchParams(location.search).get('lite');
      let saved = false;
      try { if (q === '0') localStorage.removeItem(LITE_KEY); saved = localStorage.getItem(LITE_KEY) === '1'; } catch { /* private mode */ }
      const low = this.quality.tier === 'low';
      this.lite = q === '1' || (q !== '0' && low && saved);
      this.liteAuto = q === null && low && !this.lite;
      this.events.on('game:start', () => { this.liteArmed = true; });
    }
    // 实例数为 0 的实例化网格不画（2026-10-18，手机帧率）：three 照样切着色器、传 uniform、绑缓冲区，最后画 0 个。
    // 车辆按车身和 LOD 各有一份实例化网格，没用上的那几份一帧 410 次绘制里占了 151 次（主画面 93、阴影 58），
    // 中端安卓手机上 CPU 是瓶颈，这些都是白花的。three 对 drawCount 为 0 的几何体也是这样直接返回。
    const direct = this.renderer.renderBufferDirect.bind(this.renderer);
    this.renderer.renderBufferDirect = (camera, scene, geometry, material, object, group) => {
      if ((object as THREE.InstancedMesh).isInstancedMesh && (object as THREE.InstancedMesh).count === 0) return;
      direct(camera, scene, geometry, material, object, group);
    };
    this.assets.anisotropy = Math.min(this.quality.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    this.assets.maxTextureSize = this.quality.textureRes;
    this.assets.maxCanvasSize = this.quality.canvasTextureRes;

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    // Near at 0.3: the aerial poses sit 170 m up over paint 1 cm off the ground.
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.3, 4000);
    this.input = new Input(this.canvas);
    this.renderFrame = () => this.renderer.render(this.scene, this.camera);

    // Follow the container's real size. 'resize' alone is not enough on a phone: iOS fires it on a
    // rotation before the page is laid out again, so the buffer took the portrait size in landscape
    // and the picture was stretched sideways (「换成横屏，刚开始车很宽，过了一会才正常」) until the
    // resolution governor happened to resize. A ResizeObserver reports the laid-out size; the
    // orientation and visual-viewport events and a late re-check cover browsers that are slower still.
    const onResize = () => { this.resize(); setTimeout(() => this.resizeIfChanged(), 250); setTimeout(() => this.resizeIfChanged(), 700); };
    window.addEventListener('resize', onResize);
    window.addEventListener('orientationchange', onResize);
    window.visualViewport?.addEventListener('resize', onResize);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => this.resizeIfChanged()).observe(container);
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.stop();
      console.error('[drive-city] WebGL context lost - GPU driver reset or out of memory');
      this.events.emit('renderer:contextlost', {});
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      console.warn('[drive-city] WebGL context restored - reload to rebuild the scene');
      this.events.emit('renderer:contextrestored', {});
    });
  }

  private static frameCapMs(tierCap: number): number {
    const q = new URLSearchParams(location.search).get('fps');
    const fps = q !== null && Number.isFinite(Number(q)) ? Number(q) : tierCap;
    return fps > 0 ? 1000 / fps : 0;
  }

  add(system: System): void { this.systems.push(system); }
  get<T extends System>(name: string): T | undefined { return this.systems.find((s) => s.name === name) as T | undefined; }

  /** Tier pixel ratio clamped so the drawing buffer never exceeds `quality.maxPixels`. */
  private baseRatio(w: number, h: number): number {
    const r = this.quality.pixelRatio;
    const px = Math.max(1, w * h) * r * r;
    const cap = this.quality.maxPixels * 1e6;
    return px <= cap ? r : r * Math.sqrt(cap / px);
  }

  /** Size the buffer, camera and post chain was last set up for (CSS pixels). */
  private sized = { w: 0, h: 0 };

  private resizeIfChanged(): void {
    const w = this.canvas.parentElement?.clientWidth ?? window.innerWidth;
    const h = this.canvas.parentElement?.clientHeight ?? window.innerHeight;
    if (w !== this.sized.w || h !== this.sized.h) this.resize();
  }

  resize(): void {
    const w = this.canvas.parentElement?.clientWidth ?? window.innerWidth;
    const h = this.canvas.parentElement?.clientHeight ?? window.innerHeight;
    this.sized = { w, h };
    this.renderer.setPixelRatio(this.baseRatio(w, h) * this.renderScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    for (const s of this.systems) s.resize?.(w, h);
  }

  start(): void {
    this.lastTick = performance.now();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      // 0.8 slack: vsync quantises frame intervals, see gunFight's Engine for the measurement.
      if (this.frameCapMs > 0) {
        const now = performance.now();
        if (now - this.lastPresent < this.frameCapMs * 0.8) return;
        this.lastPresent = now;
      }
      this.tick();
    };
    this.raf = requestAnimationFrame(loop);
  }
  stop(): void { cancelAnimationFrame(this.raf); }

  /** Advance exactly one frame of `dt` seconds (shot mode passes a fixed dt for deterministic frames). */
  tick(forcedDt?: number): void {
    const now = performance.now();
    const interval = forcedDt ?? (this.lastTick < 0 ? 0 : (now - this.lastTick) / 1000);
    this.lastTick = now;
    const raw = Math.min(interval, 0.1);
    const dt = this.paused ? 0 : raw * this.timeScale;
    this.frameMs += (interval * 1000 - this.frameMs) * 0.05;
    this.input.poll();
    this.stepFixed(dt);
    const alpha = this.accumulator / this.physics.fixedDt;
    this.time += dt; this.frame++;
    for (const s of this.systems) s.update?.(dt, alpha);
    // Every 2 s of wall time (paused too: under the title is when the city's textures arrive), a few ms a frame at most
    // until the new ones are all up (Assets.compact).
    if (this.compactPending || now - this.lastCompact >= 2000 || this.frame === 1) {
      if (!this.compactPending) this.lastCompact = now;
      this.compactPending = !this.assets.compact(this.renderer, [this.scene], [this.scene.environment, this.scene.background as THREE.Texture | null], 6);
    }
    this.renderer.info.reset();
    this.renderFrame(dt);
    this.cpuMs = performance.now() - now;
    if (this.liteAuto && this.liteArmed && !this.paused && !forcedDt && interval > 0 && interval < 0.5) this.watchLite(interval * 1000);
    if (this.quality.adaptiveResolution && !forcedDt) {
      const next = governorStep(this.governor, interval * 1000, this.governorCfg);
      if (next !== null) { this.renderScale = next; this.resize(); }
    }
  }

  /** 省电档的自动判断：攒满一段算中位数，慢的段连着两段就打开（一段快的清零，偶尔一卡不算）。 */
  private watchLite(ms: number): void {
    this.liteWin.push(ms);
    if (this.liteWin.length < 240) return;
    const a = this.liteWin.sort((x, y) => x - y), med = a[a.length >> 1];
    this.liteWin.length = 0;
    this.liteSlow = med > 25 ? this.liteSlow + 1 : 0;
    if (this.liteSlow >= 2) this.setLite(true);
  }

  setLite(on: boolean): void {
    if (this.lite === on) return;
    this.lite = on;
    this.liteAuto = false;
    try { if (on) localStorage.setItem(LITE_KEY, '1'); else localStorage.removeItem(LITE_KEY); } catch { /* private mode */ }
    this.events.emit('quality:lite', { on });
  }

  /** Run the fixed-step systems + physics for `dt` seconds of game time (no rendering). */
  stepFixed(dt: number): void {
    const fixed = this.physics.fixedDt;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= fixed && steps < this.maxSubSteps) {
      for (const s of this.systems) s.fixedUpdate?.(fixed);
      if (this.physics.world) this.physics.step();
      for (const s of this.systems) s.postStep?.(fixed);
      this.accumulator -= fixed; steps++;
    }
    if (steps === this.maxSubSteps) this.accumulator = 0;
  }
}
