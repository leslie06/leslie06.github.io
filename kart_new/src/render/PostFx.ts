import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { SMAAPass } from 'three/examples/jsm/postprocessing/SMAAPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import type { QualitySettings } from './QualityTiers';

/**
 * 后处理链。渲染的最后一步统一走这里：主循环只调 postFx.render()，
 * 不用关心这一档到底开了什么。
 *
 * 三档：
 *   full  = RenderPass + Bloom + SMAA + OutputPass（tonemapping 在 OutputPass 里做）
 *   bloom = RenderPass + 半分辨率 Bloom + OutputPass
 *   none  = 完全不建 composer，直接 renderer.render，tonemapping 走 renderer 自己的
 *
 * low 档为什么是"不建 composer"而不是"建一个只有 RenderPass 的 composer"：
 * composer 意味着先画进一张 float 的 RT 再拷回屏幕，这一次全屏拷贝在移动 GPU 上
 * 是实打实的带宽开销，1080p 下能吃掉两三毫秒。既然不做效果，就别开这条路。
 */
export class PostFx {
  private composer: EffectComposer | null = null;
  private bloom: UnrealBloomPass | null = null;
  private width = 1;
  private height = 1;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly scene: THREE.Scene,
    private camera: THREE.PerspectiveCamera,
    settings: Readonly<QualitySettings>,
  ) {
    const size = renderer.getSize(new THREE.Vector2());
    this.width = size.x;
    this.height = size.y;
    this.setQuality(settings);
  }

  /** 有没有真的在走后处理。调试面板显示用 */
  get active(): boolean {
    return this.composer !== null;
  }

  setQuality(settings: Readonly<QualitySettings>): void {
    this.disposeComposer();
    if (settings.postFx === 'none') return;

    // tonemapping 的设置一直挂在 renderer 上（OutputPass 是去 renderer 上读的）。
    // 不会被 tonemap 两次：three 只在直接画到画布时才在材质里做 tonemapping，
    // 画进 composer 的 RT 时自动跳过，最后由 OutputPass 补上
    const composer = new EffectComposer(this.renderer);
    composer.setSize(this.width, this.height);
    composer.setPixelRatio(this.renderer.getPixelRatio());
    composer.addPass(new RenderPass(this.scene, this.camera));

    const full = settings.postFx === 'full';
    const bloom = new UnrealBloomPass(
      // medium 档 bloom 只在半分辨率上算：bloom 本来就是糊的，降一半几乎看不出来
      new THREE.Vector2(this.width * (full ? 1 : 0.5), this.height * (full ? 1 : 0.5)),
      settings.bloomStrength,
      full ? 0.5 : 0.35, // radius
      0.82, // threshold：只让高光溢出，别让整个画面发光
    );
    composer.addPass(bloom);
    this.bloom = bloom;

    if (full) composer.addPass(new SMAAPass());

    composer.addPass(new OutputPass());

    this.composer = composer;
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    this.composer?.setSize(width, height);
    this.composer?.setPixelRatio(this.renderer.getPixelRatio());
    this.bloom?.setSize(width, height);
  }

  render(): void {
    if (this.composer) this.composer.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private disposeComposer(): void {
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
  }

  dispose(): void {
    this.disposeComposer();
  }
}
