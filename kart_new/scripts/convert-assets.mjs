/**
 * 资源压缩流水线：assets-src/ -> public/assets/
 *
 *   *.png / *.jpg      -> *.ktx2   （Basis UASTC/ETC1S，用 KTX-Software 的 `ktx` 命令）
 *   *.glb / *.gltf     -> *.glb    （meshopt 压缩几何 + 内嵌贴图转 KTX2，用 gltf-transform）
 *
 * 这两个工具都不是本项目的依赖（一个是 C++ 写的原生工具，一个体积很大且只在
 * 出包时用得上），所以这里是**调外部命令**，缺了就打印安装办法然后退出。
 *   brew install ktx                     # 或 https://github.com/KhronosGroup/KTX-Software/releases
 *   npm i -g @gltf-transform/cli
 *
 * 跑：npm run assets:convert
 * 转完记得往 src/assets/AssetManifest.ts 里登记，不登记等于没有。
 */
import { execFile } from 'node:child_process';
import { mkdir, readdir, stat } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SRC = resolve(root, 'assets-src');
const OUT = resolve(root, 'public/assets');

/** 贴图压到多大。1024 是 low 档的硬上限（见 CLAUDE.md 的性能预算） */
const MAX_TEXTURE = 1024;

async function has(command, args) {
  try {
    await run(command, args);
    return true;
  } catch {
    return false;
  }
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(path);
    else yield path;
  }
}

const ktxOk = await has('ktx', ['--version']);
const gltfOk = await has('gltf-transform', ['--version']);
if (!ktxOk) console.warn('[assets] 找不到 ktx，跳过贴图：brew install ktx');
if (!gltfOk) console.warn('[assets] 找不到 gltf-transform，跳过模型：npm i -g @gltf-transform/cli');

await mkdir(OUT, { recursive: true });
let converted = 0;

for await (const file of walk(SRC)) {
  const ext = extname(file).toLowerCase();
  const name = basename(file, ext);

  if (['.png', '.jpg', '.jpeg'].includes(ext)) {
    if (!ktxOk) continue;
    const out = join(OUT, `${name}.ktx2`);
    // UASTC 给法线/细节图，ETC1S 体积小给颜色图。这里统一用 ETC1S + 较高质量，
    // 需要更好的图自己在这儿分流
    await run('ktx', [
      'create',
      '--format', 'R8G8B8A8_SRGB',
      '--encode', 'basis-lz',
      '--clevel', '4',
      '--qlevel', '192',
      '--generate-mipmap',
      '--width', String(MAX_TEXTURE),
      file,
      out,
    ]);
    console.log(`[assets] ${basename(file)} -> ${basename(out)} (${(await stat(out)).size} B)`);
    converted++;
  } else if (['.glb', '.gltf'].includes(ext)) {
    if (!gltfOk) continue;
    const out = join(OUT, `${name}.glb`);
    await run('gltf-transform', ['optimize', file, out, '--compress', 'meshopt', '--texture-compress', 'ktx2']);
    console.log(`[assets] ${basename(file)} -> ${basename(out)} (${(await stat(out)).size} B)`);
    converted++;
  }
}

console.log(`[assets] 完成，共 ${converted} 个文件。别忘了登记到 src/assets/AssetManifest.ts`);
