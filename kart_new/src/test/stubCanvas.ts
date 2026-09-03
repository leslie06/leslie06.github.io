/**
 * 测试辅助：vitest 跑在 node 环境里，没有 document。
 * TrackMesh / World 会用 CanvasTexture 画程序化纹理，构造时要 document.createElement('canvas')。
 * 这里塞一个什么都不做的假 canvas，纹理内容在 node 里本来也没人看，
 * 我们要测的是几何，不是像素。
 */
export function stubCanvasForNode(): void {
  if (typeof (globalThis as { document?: unknown }).document !== 'undefined') return;
  const ctx = new Proxy({}, { get: () => () => {} });
  (globalThis as { document?: unknown }).document = {
    createElement: () => ({ width: 0, height: 0, getContext: () => ctx }),
  };
}
