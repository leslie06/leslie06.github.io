import { defineConfig } from 'vitest/config';

/**
 * base 用相对路径 './'。
 *
 * GitHub Pages 的项目站点挂在 `/<repo>/` 子路径下，Vercel / Cloudflare Pages 挂在
 * 根路径。写死任何一个绝对路径都会在另外两个上 404，而相对路径三个都对 ——
 * 代价是不能用 HTML 的 `<base>` 标签做路由，这个项目也用不着。
 * 站内自己拼路径的地方（音频、模型、HDRI）统一走 `import.meta.env.BASE_URL`。
 */
export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: {
    // 默认 500KB 一警告，rapier 的 wasm 单块就有 2.8MB（它是动态 import 的，
    // 不会阻塞首屏），调高阈值免得每次构建都刷一屏黄字
    chunkSizeWarningLimit: 3000,
    rollupOptions: {
      output: {
        /**
         * 手动分包。目标不是"块更小"，而是**让缓存命中率高的那部分单独成块**：
         *
         *   three          —— 200KB 出头，我们几乎不会动它，锁在一个块里之后
         *                     改游戏逻辑不会让用户重下这 200KB；
         *   postprocessing —— 同理，而且它只有开了后处理的档位才真的会执行；
         *   howler         —— 小，但同样是"永远不变"的那一类。
         *
         * rapier 不在这里：它本来就是动态 import 的，打包器自然会切出去
         * （见 main.ts 启动序列里的说明）。
         */
        advancedChunks: {
          groups: [
            { name: 'three', test: /node_modules[\\/]three[\\/]build[\\/]/ },
            { name: 'postprocessing', test: /node_modules[\\/]postprocessing[\\/]/ },
            { name: 'audio', test: /node_modules[\\/]howler[\\/]/ },
          ],
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
