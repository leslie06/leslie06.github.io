import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ASSET_MANIFEST } from './AssetManifest';

/**
 * 解码器接线的双向约束。
 *
 * 背景：KTX2Loader / DRACOLoader 里的转码器路径是 new URL(..., import.meta.url) 写的，
 * 打包器只要**看见**那句 import() 就会把 basis / draco 的 wasm 产出来（1.8MB），
 * 不管运行时会不会执行到。所以：
 *   - 清单是空的 -> 不许接线，否则白白部署 1.8MB 没人会去取的东西；
 *   - 清单非空   -> 必须接线，否则加载会静默失败（loader 直接 reject）。
 *
 * 这条约束靠读源码来钉：和 kartStep.test.ts 里"不许 import three"是同一个路子。
 */
const loaderSrc = readFileSync(new URL('./AssetLoader.ts', import.meta.url), 'utf8');
const decodersSrc = readFileSync(new URL('./decoders.ts', import.meta.url), 'utf8');

/**
 * 注释要先剥掉再查：文件里那段"怎么接回来"的说明本身就写着 import('./decoders')，
 * 不剥的话这条测试永远认为已经接上了。
 */
const stripComments = (src: string): string =>
  src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

/** AssetLoader 有没有真的把 decoders 接上（代码里，不是注释里） */
const wired = /import\(\s*['"]\.\/decoders['"]\s*\)/.test(stripComments(loaderSrc));

describe('解码器接线', () => {
  it('清单为空时不接线，清单非空时必须接线', () => {
    expect(wired).toBe(ASSET_MANIFEST.length > 0);
  });

  it('AssetLoader 自己不许直接 import 三个解码器（那会把 wasm 拖进部署）', () => {
    expect(stripComments(loaderSrc)).not.toMatch(
      /import\([^)]*(KTX2Loader|DRACOLoader|GLTFLoader|meshopt)/,
    );
    // 类型引用不算：import type 会被编译期抹掉，不进打包图
    const valueImports = [...loaderSrc.matchAll(/^import\s+(?!type\b)[^;]*from\s+['"]([^'"]+)['"]/gm)];
    for (const [, spec] of valueImports) {
      expect(spec).not.toMatch(/loaders|meshopt/);
    }
  });

  it('接线代码本身还在（断开不等于删掉，加资源时要能直接接回来）', () => {
    expect(decodersSrc).toMatch(/export async function makeTextureLoader/);
    expect(decodersSrc).toMatch(/export async function makeModelLoader/);
    expect(decodersSrc).toMatch(/detectSupport/);
    expect(decodersSrc).toMatch(/setDRACOLoader/);
    expect(decodersSrc).toMatch(/setMeshoptDecoder/);
  });

  it('没接线的时候拿 loader 会得到一个说人话的错误，而不是静默什么都不干', () => {
    expect(loaderSrc).toMatch(/DECODERS_OFF/);
    expect(loaderSrc).toMatch(/decoders\.ts/);
  });
});
