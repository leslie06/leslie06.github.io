import * as THREE from 'three';
import { EventBus } from './Events';
import { Input } from './Input';
import { Physics } from './Physics';
import { Assets } from './Assets';
import { QUALITY, pickTier, type QualitySettings } from './Quality';

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
  readonly hdr = true;

  constructor(container: HTMLElement) {
    this.quality = QUALITY[pickTier()];
    this.canvas = document.createElement('canvas');
    container.appendChild(this.canvas);
    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: false, powerPreference: 'high-performance', stencil: false, depth: true, alpha: false, preserveDrawingBuffer: new URLSearchParams(location.search).has('shot') });
    this.renderer.setPixelRatio(this.quality.pixelRatio);
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
  }

  add(system: System): void { this.systems.push(system); }
  get<T extends System>(name: string): T | undefined { return this.systems.find((s) => s.name === name) as T | undefined; }

  resize(): void {
    const w = this.canvas.parentElement?.clientWidth ?? window.innerWidth;
    const h = this.canvas.parentElement?.clientHeight ?? window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / Math.max(1, h); this.camera.updateProjectionMatrix();
    this.viewmodelCamera.aspect = this.camera.aspect; this.viewmodelCamera.updateProjectionMatrix();
    for (const s of this.systems) s.resize?.(w, h);
  }

  start(): void {
    this.clock.start();
    const loop = () => { this.raf = requestAnimationFrame(loop); this.tick(); };
    this.raf = requestAnimationFrame(loop);
  }
  stop(): void { cancelAnimationFrame(this.raf); }

  /** Advance exactly one frame of `dt` seconds (used by shot mode for deterministic rendering). */
  tick(forcedDt?: number): void {
    const raw = forcedDt ?? Math.min(this.clock.getDelta(), 0.1);
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
  }
}
