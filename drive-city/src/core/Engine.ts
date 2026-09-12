import * as THREE from 'three';
import { EventBus } from './Events';
import { Input } from './Input';
import { Physics } from './Physics';
import { Assets } from './Assets';
import { QUALITY, detectGpu, pickTier, type GpuInfo, type QualitySettings } from './Quality';
import { newGovernor, step as governorStep, type GovernorConfig, type GovernorState } from './Resolution';

/** Frames the resolution governor ignores at boot (shader compiles, first uploads). */
const WARMUP_FRAMES = 180;

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
  renderFrame: (dt: number) => void;
  private accumulator = 0;
  private raf = 0;
  readonly canvas: HTMLCanvasElement;
  private maxSubSteps = 4;
  private governor: GovernorState;
  private governorCfg: GovernorConfig;
  renderScale = 1;
  private lastCompact = -Infinity;
  readonly gpu: GpuInfo;
  frameCapMs = 0;
  private lastPresent = -1e9;
  contextLost = false;
  /** Mean frame interval (ms) over the last half second, for the diagnostics panel. */
  frameMs = 16.7;

  constructor(container: HTMLElement) {
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    const shot = new URLSearchParams(location.search).has('shot');
    // No canvas MSAA: the post chain (render/PostFx) anti-aliases with SMAA, MSAA would only cost bandwidth.
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false, preserveDrawingBuffer: shot });
    this.gpu = detectGpu(this.renderer.getContext());
    this.quality = QUALITY[pickTier(this.gpu)];
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
    this.assets.anisotropy = Math.min(this.quality.anisotropy, this.renderer.capabilities.getMaxAnisotropy());
    this.assets.maxTextureSize = this.quality.textureRes;
    this.assets.maxCanvasSize = this.quality.canvasTextureRes;

    const aspect = container.clientWidth / Math.max(1, container.clientHeight);
    // Near at 0.3: the aerial poses sit 170 m up over paint 1 cm off the ground.
    this.camera = new THREE.PerspectiveCamera(62, aspect, 0.3, 4000);
    this.input = new Input(this.canvas);
    this.renderFrame = () => this.renderer.render(this.scene, this.camera);

    window.addEventListener('resize', () => this.resize());
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

  resize(): void {
    const w = this.canvas.parentElement?.clientWidth ?? window.innerWidth;
    const h = this.canvas.parentElement?.clientHeight ?? window.innerHeight;
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
    if (this.time - this.lastCompact >= 2 || this.frame === 1) {
      this.lastCompact = this.time;
      this.assets.compact(this.renderer, [this.scene], [this.scene.environment, this.scene.background as THREE.Texture | null]);
    }
    this.renderer.info.reset();
    this.renderFrame(dt);
    if (this.quality.adaptiveResolution && !forcedDt) {
      const next = governorStep(this.governor, interval * 1000, this.governorCfg);
      if (next !== null) { this.renderScale = next; this.resize(); }
    }
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
