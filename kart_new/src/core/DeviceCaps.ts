/**
 * 设备能力探测。
 *
 * 这里是**唯一**碰 navigator / screen / WebGL 上下文的地方，探完就变成一个裸数字结构
 * （DeviceCaps）交出去。分档逻辑在 QualityTiers.ts 里，那边是纯函数，可以单测 ——
 * 跟 AI 那边 AITrack 的做法是一个思路：脏活集中在一个适配器里。
 */

export interface DeviceCaps {
  /** navigator.userAgent 原文，只用来做粗判 */
  ua: string;
  /** 触摸点数上限。0 = 纯鼠标设备 */
  maxTouchPoints: number;
  /** CSS 像素下的屏幕长边 */
  screenLongEdge: number;
  /** window.devicePixelRatio */
  devicePixelRatio: number;
  /** 逻辑核数，探不到按 4 算 */
  hardwareConcurrency: number;
  /** navigator.deviceMemory（GB），Safari 没有，探不到是 null */
  deviceMemoryGB: number | null;
  /** 有没有 WebGL2。只有 WebGL1 的机器基本可以直接判 low */
  webgl2: boolean;
  /** GL_MAX_TEXTURE_SIZE */
  maxTextureSize: number;
  /** WEBGL_debug_renderer_info 拿到的 GPU 名，拿不到是空串 */
  gpu: string;
}

/** 探不到任何东西时的保底值：按"中等偏弱的手机"算，宁可保守。 */
export const FALLBACK_CAPS: Readonly<DeviceCaps> = Object.freeze({
  ua: '',
  maxTouchPoints: 0,
  screenLongEdge: 1280,
  devicePixelRatio: 1,
  hardwareConcurrency: 4,
  deviceMemoryGB: null,
  webgl2: true,
  maxTextureSize: 4096,
  gpu: '',
});

/** 测试和调用方拼假 caps 用，省得每次写全 9 个字段。 */
export function makeCaps(partial: Partial<DeviceCaps> = {}): DeviceCaps {
  return { ...FALLBACK_CAPS, ...partial };
}

/**
 * 真机探测。会**临时**建一个 WebGL 上下文来读参数，读完立刻丢掉 ——
 * 不复用主渲染器的上下文是因为分档要在建渲染器之前决定（antialias 是构造参数，
 * 建完就改不了了）。iOS 上同时活着的 WebGL 上下文数量有限，所以这里显式 lose 掉。
 */
export function probeDeviceCaps(): DeviceCaps {
  if (typeof navigator === 'undefined' || typeof document === 'undefined') return makeCaps();

  const nav = navigator as Navigator & { deviceMemory?: number };
  const screenLongEdge =
    typeof screen !== 'undefined' ? Math.max(screen.width, screen.height) : window.innerWidth;

  let webgl2 = false;
  let maxTextureSize = FALLBACK_CAPS.maxTextureSize;
  let gpu = '';

  const canvas = document.createElement('canvas');
  const gl =
    (canvas.getContext('webgl2') as WebGL2RenderingContext | null) ??
    (canvas.getContext('webgl') as WebGLRenderingContext | null);
  if (gl) {
    webgl2 = typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    if (info) gpu = String(gl.getParameter(info.UNMASKED_RENDERER_WEBGL) ?? '');
    gl.getExtension('WEBGL_lose_context')?.loseContext();
  }

  return {
    ua: nav.userAgent ?? '',
    maxTouchPoints: nav.maxTouchPoints ?? 0,
    screenLongEdge,
    devicePixelRatio: window.devicePixelRatio || 1,
    hardwareConcurrency: nav.hardwareConcurrency || 4,
    deviceMemoryGB: typeof nav.deviceMemory === 'number' ? nav.deviceMemory : null,
    webgl2,
    maxTextureSize,
    gpu,
  };
}

/**
 * UA 粗判是不是手机 / 平板。
 *
 * UA 谁都能改，所以它只是**一票**而不是判决：分档还看核数、显存、GPU 名，
 * 选输入方式还看 maxTouchPoints。iPadOS 的 Safari UA 里写的是 Macintosh，
 * 所以那条要靠"Mac + 有触摸点"兜住。
 */
export function isMobileUA(ua: string): boolean {
  if (/Android|iPhone|iPod|IEMobile|Opera Mini|Mobile Safari/i.test(ua)) return true;
  return /iPad/i.test(ua);
}

/** iOS / iPadOS。Safari 有一串专项坑（音频、上下文丢失），要单独判。 */
export function isIOSUA(ua: string, maxTouchPoints = 0): boolean {
  if (/iPhone|iPad|iPod/i.test(ua)) return true;
  // iPadOS 13+ 默认伪装成桌面 Mac，靠"Mac + 能多点触摸"认出来
  return /Macintosh/i.test(ua) && maxTouchPoints > 1;
}
