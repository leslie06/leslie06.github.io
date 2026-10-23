import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildCar, defaultLivery } from '../vehicle/CarModel';
import type { BodyType } from '../vehicle/Bodies';
import { SPEC_OF } from '../vehicle/Spec';

/** What a picture shows: the body and its two paints (the taxi's sign and lettering when `taxi`). */
export interface ThumbLook { body: BodyType; upper: string; lower: string; taxi: boolean }

/** Picture size in pixels (shown at half: sharp on a phone's 2-3x screen). */
const W = 240, H = 136;

/**
 * Pictures of cars for the 车行 (2026-10-23, 「现在车行的页面只有车名，加上汽车的图片」): the full-detail model (vehicle/'s
 * `buildCar`, in the car's own paint) drawn from the front three-quarters into a small render target with the game's
 * renderer, read back into a PNG data URL, and kept by look: a car's first picture costs a model build, a draw and the
 * car shaders' first compile (lit by a room environment and two lights of its own, not the city's: nothing of the street's
 * light state is shared), every later one nothing. No tone mapping (render targets skip it): the lights are kept low.
 */
export class CarThumbs {
  private cache = new Map<string, string>();
  private queue: { key: string; look: ThumbLook; done: (url: string | null) => void }[] = [];
  private busy = false;
  /** The first picture's materials, never disposed: their shader programs stay compiled for every later car. */
  private keep: THREE.Material[] | null = null;

  constructor(private renderer: THREE.WebGLRenderer) {}

  private static key(l: ThumbLook): string { return `${l.body}|${l.upper}|${l.lower}|${l.taxi ? 1 : 0}`; }

  /** The picture if it is made, else null (and `ready` is called when it is, one car a frame). */
  get(look: ThumbLook, ready: (url: string) => void): string | null {
    const key = CarThumbs.key(look);
    const have = this.cache.get(key);
    if (have) return have;
    this.queue.push({ key, look, done: (url) => { if (url) ready(url); } });
    if (!this.busy) { this.busy = true; requestAnimationFrame(() => this.next()); }
    return null;
  }

  private next(): void {
    const job = this.queue.shift();
    if (!job) { this.busy = false; return; }
    let url = this.cache.get(job.key) ?? null;
    if (!url) {
      try { url = this.draw(job.look); this.cache.set(job.key, url); } catch (e) { console.warn('[garage] car picture failed', e); url = null; }
    }
    job.done(url);
    requestAnimationFrame(() => this.next());
  }

  private draw(look: ThumbLook): string {
    const r = this.renderer;
    const model = buildCar(SPEC_OF[look.body], defaultLivery(look.body), look.body);
    model.setPaint(new THREE.Color(look.upper), new THREE.Color(look.lower), look.taxi);
    const scene = new THREE.Scene();
    const pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    const env = pmrem.fromScene(room, 0.04).texture;
    scene.environment = env;
    scene.environmentIntensity = 0.55;
    scene.add(new THREE.HemisphereLight('#f2f4f7', '#3a3836', 0.6));
    const sun = new THREE.DirectionalLight('#fff6ea', 1.6);
    sun.position.set(-3, 6, 4);
    scene.add(sun);
    scene.add(model.root);
    // the front three-quarters from the car's right (body frame: +z forward, +x left, y 0 at the hubs)
    const s = model.size, wr = SPEC_OF[look.body].wheelRadius;
    const centre = new THREE.Vector3(0, s.height / 2 - wr, 0);
    const cam = new THREE.PerspectiveCamera(28, W / H, 0.1, 100);
    const dir = new THREE.Vector3(-0.78, 0.36, 0.95).normalize();
    // far enough that the car's length fits the width and its height the height
    const half = THREE.MathUtils.degToRad(cam.fov / 2);
    const across = Math.max(s.length * 0.86, s.width * 1.4) / 2, up = Math.max(s.height * 0.9, across / cam.aspect);
    const d = Math.max(across / (Math.tan(half) * cam.aspect), up / Math.tan(half)) * 1.08 + s.width / 2;
    cam.position.copy(centre).addScaledVector(dir, d);
    cam.lookAt(centre);

    const rt = new THREE.WebGLRenderTarget(W, H, { samples: 4, colorSpace: THREE.SRGBColorSpace });
    const prevRT = r.getRenderTarget(), prevColor = r.getClearColor(new THREE.Color()), prevAlpha = r.getClearAlpha();
    const prevAuto = r.autoClear, prevShadow = r.shadowMap.enabled;
    const px = new Uint8Array(W * H * 4);
    try {
      r.shadowMap.enabled = false;
      r.autoClear = true;
      r.setRenderTarget(rt);
      r.setClearColor(0x000000, 0);
      r.clear();
      r.render(scene, cam);
      r.readRenderTargetPixels(rt, 0, 0, W, H, px);
    } finally {
      r.setRenderTarget(prevRT);
      r.setClearColor(prevColor, prevAlpha);
      r.autoClear = prevAuto;
      r.shadowMap.enabled = prevShadow;
      rt.dispose(); env.dispose(); pmrem.dispose(); room.dispose();
      const mats = new Set<THREE.Material>();
      model.root.traverse((o) => {
        const m = o as THREE.Mesh;
        if (!m.isMesh) return;
        m.geometry.dispose();
        for (const x of Array.isArray(m.material) ? m.material : [m.material]) mats.add(x);
      });
      if (!this.keep) this.keep = [...mats];
      else for (const x of mats) x.dispose();
    }
    // rows come bottom first
    const c = document.createElement('canvas');
    c.width = W; c.height = H;
    const g = c.getContext('2d')!;
    const img = g.createImageData(W, H);
    for (let y = 0; y < H; y++) img.data.set(px.subarray((H - 1 - y) * W * 4, (H - y) * W * 4), y * W * 4);
    g.putImageData(img, 0, 0);
    return c.toDataURL('image/png');
  }
}
