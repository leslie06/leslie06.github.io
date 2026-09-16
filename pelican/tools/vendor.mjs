// 把 three.js、用到的后期处理模块和字体子集内嵌进 index.html，
// 让这一页零外部请求、断网也能直接打开。改 three 版本后重新跑一次：
//   node tools/vendor.mjs
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const THREE_VER = '0.170.0';
const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CACHE = join(ROOT, 'tools', '.cache');
const CDN = `https://cdn.jsdelivr.net/npm/three@${THREE_VER}`;
// 依赖顺序：被依赖的先进来
const ADDONS = [
  'shaders/CopyShader.js', 'shaders/LuminosityHighPassShader.js', 'shaders/OutputShader.js',
  'postprocessing/Pass.js', 'postprocessing/ShaderPass.js', 'postprocessing/MaskPass.js',
  'postprocessing/EffectComposer.js', 'postprocessing/RenderPass.js',
  'postprocessing/UnrealBloomPass.js', 'postprocessing/OutputPass.js',
  'utils/BufferGeometryUtils.js',
];
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36';

async function get(url, { binary = false } = {}) {
  const key = join(CACHE, url.replace(/[^a-z0-9.]+/gi, '_').slice(-180));
  if (existsSync(key)) return binary ? readFile(key) : readFile(key, 'utf8');
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`${res.status} ${url}`);
  const buf = Buffer.from(await res.arrayBuffer());
  await mkdir(CACHE, { recursive: true });
  await writeFile(key, buf);
  return binary ? buf : buf.toString('utf8');
}

// three 的构建文件末尾是一整段 export{短名 as 公开名}，转成 THREE 命名空间 + 顶层解构，
// 这样内嵌进来的 addon 里直接写 Vector2 也能用
function inlineThree(src) {
  const m = src.match(/export\s*\{([^}]*)\}\s*;?\s*$/);
  if (!m) throw new Error('没找到 three 的 export 段');
  const pairs = m[1].split(',').map(s => s.trim()).filter(Boolean).map(s => {
    const [local, pub] = s.split(/\s+as\s+/).map(x => x.trim());
    return [pub ?? local, local];
  });
  const body = src.slice(0, m.index);
  const ns = pairs.map(([pub, local]) => (pub === local ? pub : `${pub}:${local}`)).join(',');
  const names = pairs.map(([pub]) => pub).join(',');
  return `${body}\nconst THREE = {${ns}};\nconst {${names}} = THREE;\n`;
  // 注意：整段会被包进一个立即执行函数，压缩后的短变量名不会漏到外面和本页的变量撞名
}

// addon 之间的 import/export 在内嵌后都是同一个作用域，直接去掉
function inlineAddon(src, name) {
  return `\n/* ---- three/addons/${name} ---- */\n` + src
    .replace(/^\s*import[\s\S]*?from\s*['"][^'"]+['"]\s*;?\s*$/gm, '')
    .replace(/^\s*export\s*\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/^export\s+(class|function|const|let|var)\s/gm, '$1 ')
    .trim() + '\n';
}

async function fontFaces(specs) {
  let out = '';
  for (const { family, css } of specs) {
    const sheet = await get(css);
    for (const block of sheet.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      if (!/woff2/.test(block)) continue;
      const url = block.match(/url\((https:[^)]+)\)/)?.[1];
      if (!url) continue;
      const b64 = (await get(url, { binary: true })).toString('base64');
      out += block.replace(/src:[^;]+;/, `src:url(data:font/woff2;base64,${b64}) format('woff2');`)
        .replace(/\s+/g, ' ').replace(/; }/, ';}') + '\n';
      console.log(`  ${family}: ${(b64.length * 0.75 / 1024).toFixed(1)} KB`);
      break;   // 每个字体只取第一个（子集）分片
    }
  }
  return out;
}

const three = inlineThree(await get(`${CDN}/build/three.module.min.js`));
let addons = '';
for (const a of ADDONS) addons += inlineAddon(await get(`${CDN}/examples/jsm/${a}`), a);

console.log('字体子集：');
const fonts = await fontFaces([
  // 标题只用到「鹈鹕骑单车」五个字，按 text= 取最小子集
  { family: 'ZCOOL QingKe HuangYou', css: 'https://fonts.googleapis.com/css2?family=ZCOOL+QingKe+HuangYou&text=' + encodeURIComponent('鹈鹕骑单车') + '&display=swap' },
  { family: 'Chivo Mono 400', css: 'https://fonts.googleapis.com/css2?family=Chivo+Mono:wght@400&display=swap' },
  { family: 'Chivo Mono 600', css: 'https://fonts.googleapis.com/css2?family=Chivo+Mono:wght@600&display=swap' },
]);

const file = join(ROOT, 'index.html');
let html = await readFile(file, 'utf8');
const swap = (text, a, b, payload) => {
  const i = text.indexOf(a), j = text.indexOf(b);
  if (i < 0 || j < 0) throw new Error(`没找到标记 ${a}`);
  return text.slice(0, i + a.length) + '\n' + payload + text.slice(j);
};
html = swap(html, '<!-- FONTS_START -->', '<!-- FONTS_END -->', `<style>\n${fonts}</style>\n`);
const EXPORTS = 'THREE, EffectComposer, RenderPass, UnrealBloomPass, OutputPass, mergeGeometries';
html = swap(html, '//@@VENDOR_START@@', '//@@VENDOR_END@@',
  `/* three.js r${THREE_VER.split('.')[1]} (MIT) https://threejs.org — 压缩版与所用 addon 原样内嵌 */\n`
  + `const { ${EXPORTS} } = (function () {\n${three}${addons}\nreturn { ${EXPORTS} };\n})();\n`);
await writeFile(file, html);
console.log(`index.html: ${(html.length / 1024 / 1024).toFixed(2)} MB`);
