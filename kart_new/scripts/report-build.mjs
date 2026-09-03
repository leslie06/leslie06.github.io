/**
 * 构建产物体积报告：原始 / gzip / brotli 三列。
 *
 * 为什么要有它：部署平台（Vercel、Cloudflare、GitHub Pages）都会自动压，
 * 但"自动压了多少"没人告诉你 —— 而首屏预算说的是**压缩后**的大小。
 * 这个脚本本地就能把那个数字算出来，不用等部署完再去开 DevTools 数。
 *
 * 用法：npm run build && npm run size
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { brotliCompressSync, gzipSync, constants } from 'node:zlib';

const DIST = new URL('../dist/', import.meta.url).pathname;

/** 已经压过的格式再压一遍是白费力气，报告里直接标出来 */
const ALREADY_COMPRESSED = /\.(ktx2|png|jpg|jpeg|webp|woff2?|mp3|ogg|webm|m4a)$/i;

async function* walk(dir, prefix = '') {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) yield* walk(path, rel);
    else yield { path, rel, size: (await stat(path)).size };
  }
}

const rows = [];
let totalRaw = 0;
let totalGzip = 0;
let totalBrotli = 0;

for await (const file of walk(DIST)) {
  const compressible = !ALREADY_COMPRESSED.test(file.rel);
  let gzip = file.size;
  let brotli = file.size;
  if (compressible) {
    const buffer = await readFile(file.path);
    gzip = gzipSync(buffer, { level: 9 }).length;
    brotli = brotliCompressSync(buffer, {
      params: { [constants.BROTLI_PARAM_QUALITY]: 11 },
    }).length;
  }
  rows.push({ ...file, gzip, brotli, compressible });
  totalRaw += file.size;
  totalGzip += gzip;
  totalBrotli += brotli;
}

rows.sort((a, b) => b.brotli - a.brotli);

const kb = (n) => `${(n / 1024).toFixed(1)} kB`.padStart(10);
console.log('文件'.padEnd(44) + '原始'.padStart(9) + 'gzip'.padStart(11) + 'brotli'.padStart(11));
console.log('-'.repeat(76));
for (const row of rows) {
  const name = row.rel.length > 42 ? `…${row.rel.slice(-41)}` : row.rel;
  const mark = row.compressible ? '' : '  (已压缩)';
  console.log(name.padEnd(44) + kb(row.size) + kb(row.gzip) + kb(row.brotli) + mark);
}
console.log('-'.repeat(76));
console.log('合计'.padEnd(44) + kb(totalRaw) + kb(totalGzip) + kb(totalBrotli));
console.log(
  '\n注：三个部署平台都会自动开 gzip/brotli，所以玩家实际下载的是最后一列。' +
    '\n    rapier（PhysicsSystem 那块）是动态 import 的，不进首屏 —— 先出加载界面再下它。',
);
