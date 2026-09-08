import * as THREE from 'three';
import { EventBus } from './Events';
import { Input } from './Input';
import { Physics } from './Physics';
import { Assets } from './Assets';
import { QUALITY, detectGpu, pickTier, type GpuInfo, type QualitySettings } from './Quality';
import { newGovernor, step as governorStep, type GovernorConfig, type GovernorState } from './Resolution';

/**
 * Frames the resolution governor ignores at boot. Shader compilation, the first texture uploads and
 * the first ragdoll all land in the first seconds and are one-off costs; reacting to them starts
 * the session at the render-scale floor. 180 frames is 3 s at the 60 fps cap - long enough to cover
 * the compile storm that follows the first time each material is drawn.
 */
const WARMUP_FRAMES = 180;

/** A system gets a fixed-step tick (60Hz, physics/gameplay) and a per-frame update (render/visuals). */
export interface System {
  name: string;
  fixedUpdate?(dt: number): void;
  update?(dt: number, alpha: number): void;
  resize?(w: number, h: number): void;
  dispose?(): void;
}

/**
 * Owns renderer/scene/camera, the fixed-step loop and the system list.
 * Post-processing is plugged in through `renderFrame` so PostFx can take over the final draw.
 */
export class Engine {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  /** Separate camera+scene for the first-person weapon so it never clips into walls. */
  readonly viewmodelScene = new THREE.Scene();
  readonly viewmodelCamera: THREE.PerspectiveCamera;
  readonly events = new EventBus();
  readonly input: Input;
  readonly physics = new Physics();
  readonly assets = new Assets();
  quality: QualitySettings;
  readonly systems: System[] = [];
  readonly clock = new THREE.Clock(false);
  time = 0;
  frame = 0;
  paused = false;
  timeScale = 1;
  /** Replaceable by PostFx. */
  renderFrame: (dt: number) => void;
  private accumulator = 0;
  private raf = 0;
  readonly canvas: HTMLCanvasElement;
  private maxSubSteps = 4;
  /** Adaptive resolution: see core/Resolution.ts for why pixelRatio alone is not enough. */
  private governor: GovernorState;
  private governorCfg: GovernorConfig;
  /** Current drawing-buffer multiplier on quality.pixelRatio; the UI reads this. */
  renderScale = 1;
  /** The adapter the renderer actually bound. Drives the boot tier; the diagnostics panel shows it. */
  readonly gpu: GpuInfo;
  /** Minimum ms between presented frames (0 = every display refresh). See quality.frameCap. */
  frameCapMs = 0;
  private lastPresent = -1e9;
  /** Set when the GPU dropped the context. Nothing renders after this; the UI reports it. */
  contextLost = false;
  readonly hdr = true;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false, preserveDrawingBuffer: new URLSearchParams(location.search).has('shot') });
    // The tier is picked from the adapter the renderer just bound, not from the CPU: see pickTier.
    // `high-performance` above is only a hint - the browser and the OS can still hand us an
    // integrated GPU, and when they do the tier has to follow.
    this.gpu = detectGpu(this.renderer.getContext());
    this.quality = QUALITY[pickTier(this.gpu)];
    this.governor = newGovernor(1, WARMUP_FRAMES, this.quality.maxRenderScale);
    this.governorCfg = { targetFps: this.quality.targetFps, minScale: this.quality.minRenderScale,
      maxScale: this.quality.maxRenderScale, window: 30, cooldown: 20 };
    this.frameCapMs = Engine.frameCapMs(this.quality.frameCap);
    this.renderer.setPixelRatio(this.baseRatio(container.clientWidth, container.clientHeight));
    this.renderer.setSize(container.clientWidth, container.clientHeight, false);
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.autoClear = true;
    this.renderer.info.autoReset = false;
    this.assets.anisotropy = Math.min(this.quality.anisotropy, this.renderer.capabilities.getMaxAnisotropy());

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    this.camera = new THREE.PerspectiveCamera(80, aspect, 0.08, 600);
    this.viewmodelCamera = new THREE.PerspectiveCamera(60, aspect, 0.01, 10);
    this.input = new Input(this.canvas);

    this.renderFrame = () => {
      this.renderer.render(this.scene, this.camera);
      this.renderer.autoClear = false;
      this.renderer.clearDepth();
      this.renderer.render(this.viewmodelScene, this.viewmodelCamera);
      this.renderer.autoClear = true;
    };

    window.addEventListener('resize', () => this.resize());

    // Without these the page just stops: three.js keeps issuing draw calls into a dead context and
    // the tab either freezes or is killed by the browser, with nothing on screen to say why. A lost
    // context is what a driver reset (Windows TDR, after a frame that overran the watchdog) or a
    // GPU-process kill looks like from in here, and it is the difference between "the game crashed"
    // and a diagnosis. preventDefault() is required for the browser to even attempt a restore.
    this.canvas.addEventListener('webglcontextlost', (e) => {
      e.preventDefault();
      this.contextLost = true;
      this.stop();
      console.error('[gunfight] WebGL context lost - GPU driver reset or out of memory');
      this.events.emit('renderer:contextlost', {});
    });
    this.canvas.addEventListener('webglcontextrestored', () => {
      // Every GPU resource this engine built died with the old context; three.js cannot rebuild the
      // level, the soldiers and the post chain from here, so a reload is the honest recovery.
      console.warn('[gunfight] WebGL context restored - reload to rebuild the scene');
      this.events.emit('renderer:contextrestored', {});
    });
  }

  /** ms between presented frames for an fps cap, honouring a `?fps=N` override (N=0 uncaps). */
  private static frameCapMs(tierCap: number): number {
    const q = new URLSearchParams(location.search).get('fps');
    const fps = q !== null && Number.isFinite(Number(q)) ? Number(q) : tierCap;
    return fps > 0 ? 1000 / fps : 0;
  }

  add(system: System): void { this.systems.push(system); }
  get<T extends System>(name: string): T | undefined { return this.systems.find((s) => s.name === name) as T | undefined; }

  /**
   * Device pixel ratio to draw at, before the governor's scale: the tier's ratio, clamped so the
   * buffer never exceeds `quality.maxPixels`. Area, not ratio, is what the post chain is priced in
   * (a 1.5x ratio is 2.1 MP in a 1280x720 window and 7.5 MP in a 2560x1305 one), so the cap has to
   * be expressed that way too.
   */
  private baseRatio(w: number, h: number): number {
    const r = this.quality.pixelRatio;
    const px = Math.max(1, w * h) * r * r;
    const cap = this.quality.maxPixels * 1e6;
    return px <= cap ? r : r * Math.sqrt(cap / px);
  }

  resize(): void {
    const w = this.canvas.parentElement?.clientWidth ?? window.innerWidth;
    const h = this.canvas.parentElement?.clientHeight ?? window.innerHeight;
    // setSize multiplies by the current pixel ratio, so the ratio has to be current first.
    this.renderer.setPixelRatio(this.baseRatio(w, h) * this.renderScale);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    this.viewmodelCamera.aspect = this.camera.aspect; this.viewmodelCamera.updateProjectionMatrix();
    for (const s of this.systems) s.resize?.(w, h);
  }

  start(): void {
    this.clock.start();
    const loop = () => {
      this.raf = requestAnimationFrame(loop);
      // Frame cap. rAF fires once per display refresh, so on a 144 Hz panel an uncapped loop draws
      // 144 frames for a 60 fps design - 2.4x the GPU work, 2.4x the power, for frames the quality
      // budget never promised. The 0.8 slack is because vsync quantises the choice: at 60 fps on
      // 144 Hz the only candidates are 13.9 ms and 20.8 ms, and a strict >= 16.7 ms test would pick
      // 20.8 and settle the game at 48 fps. Landing on the tick just under the target keeps the cap
      // from costing frame rate it was not asked to cost.
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

  /** Advance exactly one frame of `dt` seconds (used by shot mode for deterministic rendering). */
  tick(forcedDt?: number): void {
    // Two different numbers on purpose: `interval` is the true wall-clock gap between frames and is
    // what the governor must see (clamping it first is what let a hitching machine look fine), while
    // `raw` is the clamped version simulation gets, so a long stall never advances the world by a
    // second in one step.
    const interval = forcedDt ?? this.clock.getDelta();
    const raw = Math.min(interval, 0.1);
    const dt = this.paused ? 0 : raw * this.timeScale;
    this.input.poll();
    const fixed = this.physics.fixedDt;
    this.accumulator += dt;
    let steps = 0;
    while (this.accumulator >= fixed && steps < this.maxSubSteps) {
      for (const s of this.systems) s.fixedUpdate?.(fixed);
      if (this.physics.world) this.physics.step();
      this.accumulator -= fixed; steps++;
    }
    if (steps === this.maxSubSteps) this.accumulator = 0;
    const alpha = this.accumulator / fixed;
    this.time += dt; this.frame++;
    for (const s of this.systems) s.update?.(dt, alpha);
    this.renderer.info.reset();
    this.renderFrame(dt);
    if (this.quality.adaptiveResolution && !forcedDt) {
      // Feed the *frame interval*, not the time spent inside renderFrame. WebGL submission is
      // asynchronous: the draw calls return long before the GPU has done the work, so timing around
      // renderFrame measures CPU submit cost and reads ~1 ms even at 20 fps. `interval` is the real
      // wall-clock gap between frames and is what the player actually feels.
      // forcedDt means shot mode, where frames are stepped by hand and timing is meaningless.
      const next = governorStep(this.governor, interval * 1000, this.governorCfg);
      if (next !== null) { this.renderScale = next; this.resize(); }
    }
  }
}
