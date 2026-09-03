import * as THREE from 'three';
import {
  BloomEffect,
  type Effect,
  EffectComposer,
  EffectPass,
  RenderPass,
  SMAAEffect,
  SMAAPreset,
  ToneMappingEffect,
  ToneMappingMode,
  VignetteEffect,
} from 'postprocessing';
import type { QualitySettings } from './QualityTiers';

/**
 * 后处理链。渲染的最后一步统一走这里：主循环只调 postFx.render()，
 * 不用关心这一档到底开了什么。
 *
 * 用 pmndrs 的 postprocessing 而不是 three 自带的 EffectComposer，理由只有一个：
 * **合并 pass**。自带的那套是一个效果一个全屏 pass，bloom + SMAA + tonemapping +
 * 暗角就是四次全屏读写；postprocessing 把所有 Effect 编译进**一个** EffectPass 的
 * 片元着色器里，全屏读写只发生一次。1080p 下这一条能省两三毫秒，在移动 GPU 上更多
 * （它们卡的从来不是算力，是带宽）。
 *
 * 三档：
 *   full  = RenderPass + [Bloom, SMAA, Vignette, ToneMapping] 合成一个 EffectPass
 *   bloom = RenderPass + [Bloom, Vignette, ToneMapping]（没有 SMAA）
 *   none  = 完全不建 composer，直接 renderer.render，tonemapping 交回 renderer 自己做
 *
 * low 档为什么是"不建 composer"而不是"建一个只有 tonemapping 的 composer"：
 * composer 意味着先画进一张 half-float 的 RT 再拷回屏幕，这一次全屏拷贝在移动 GPU 上
 * 是实打实的带宽开销。既然不做效果，就别开这条路。
 *
 * tonemapping 的归属要跟着档位换手：开 composer 时由 ToneMappingEffect 做
 * （renderer 必须设成 NoToneMapping，否则会 tonemap 两次，画面发灰），
 * 不开 composer 时由 renderer 自己做。setQuality 每次都会把这件事摆平。
 */
export class PostFx {
  private composer: EffectComposer | null = null;
  private bloom: BloomEffect | null = null;
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

    if (settings.postFx === 'none') {
      // 没有 composer 了，tonemapping 交回 renderer 自己做
      this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
      return;
    }
    // 有 composer：tonemapping 由链尾的 ToneMappingEffect 做，renderer 必须让开，
    // 否则一帧被 tonemap 两次，画面会发灰发平
    this.renderer.toneMapping = THREE.NoToneMapping;

    // half-float 的中间缓冲：bloom 要在 tonemapping **之前**取高光，
    // 8bit 缓冲里超过 1.0 的亮度早就被截断了，阈值再怎么调也挑不出东西来
    const composer = new EffectComposer(this.renderer, {
      frameBufferType: THREE.HalfFloatType,
      multisampling: 0, // 抗锯齿交给 SMAA，MSAA 和 bloom 一起开是白花带宽
    });
    composer.addPass(new RenderPass(this.scene, this.camera));

    const effects: Effect[] = [];

    if (settings.bloomStrength > 0) {
      // 阈值 0.85：只让**已经很亮**的东西溢出 —— 火花、道具箱的自发光、天上的太阳。
      // 卡通风格最忌讳整个画面糊着一层光，所以宁可保守
      this.bloom = new BloomEffect({
        intensity: settings.bloomStrength,
        luminanceThreshold: 0.85,
        luminanceSmoothing: 0.1,
        radius: settings.bloomRadius,
        mipmapBlur: true,
      });
      effects.push(this.bloom);
    }

    // SMAA 比 FXAA 清晰（它认边缘的形状，不是一律糊一遍），比 MSAA 便宜
    // （MSAA 在 composer 的 RT 上还得开 multisampling，带宽翻倍）
    if (settings.smaa) effects.push(new SMAAEffect({ preset: SMAAPreset.MEDIUM }));

    // offset 0.35 = 从画面中央 35% 之外才开始压暗，压的是四角不是脸
    if (settings.vignette > 0) {
      effects.push(new VignetteEffect({ offset: 0.35, darkness: settings.vignette }));
    }

    // tonemapping 永远排在最后：它是"把 HDR 压回可显示范围"的那一步，
    // 排在 bloom 前面的话 bloom 拿到的就是压过的值，等于没有高光可挑
    effects.push(new ToneMappingEffect({ mode: ToneMappingMode.ACES_FILMIC }));

    composer.addPass(new EffectPass(this.camera, ...effects));
    composer.setSize(this.width, this.height);

    this.composer = composer;
  }

  setCamera(camera: THREE.PerspectiveCamera): void {
    this.camera = camera;
  }

  setSize(width: number, height: number): void {
    this.width = width;
    this.height = height;
    // composer 自己读 renderer 的像素比，不用单独喂
    this.composer?.setSize(width, height);
  }

  /** @param frameDt 真实帧间隔，postprocessing 的时间相关效果要用 */
  render(frameDt = 0): void {
    if (this.composer) this.composer.render(frameDt);
    else this.renderer.render(this.scene, this.camera);
  }

  private disposeComposer(): void {
    // dispose() 会把它管的 pass / effect / RT 一起释放。
    // 换档位是很低频的操作（手动改或者自适应降档），所以每次重建整条链，
    // 不做"留着复用"的优化 —— 那种复用最容易变成半旧半新的状态
    this.composer?.dispose();
    this.composer = null;
    this.bloom = null;
  }

  dispose(): void {
    this.disposeComposer();
  }
}
