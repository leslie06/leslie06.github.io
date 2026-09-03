/**
 * 赛道缩略图：把控制点变成一条 SVG 路径。
 *
 * 纯函数，不 import three、不碰 DOM —— 输出的是一个字符串，
 * 谁想画都行（现在是赛道选择界面）。所以它可以直接单测。
 *
 * ## 为什么不截个图
 * 截图要先把赛道建出来、渲染一遍、再存成文件，四条道就是四张图，
 * 而且改了控制点之后图就过期了还没人发现。**从控制点算**永远不会过期，
 * 也不占一个字节的下载量。
 *
 * ## 为什么要做 Catmull-Rom 转贝塞尔
 * 直接把控制点连成折线的话，缩略图上全是尖角，和实际跑起来的圆弧对不上 ——
 * 那种图会误导人（"这条道全是直角弯"）。CatmullRom 段可以**精确**转成一段三次
 * 贝塞尔，所以这里画出来的形状和 TrackSpline 生成的中心线是同一条曲线。
 */
import type { ControlPoint } from './TrackConfig';

/** 和 TrackSpline 里 CatmullRomCurve3 的 tension 保持一致，不然缩略图和实际形状对不上 */
const TENSION = 0.5;

export interface ThumbnailOptions {
  /** viewBox 的边长。路径坐标会被归一化到这个范围里 */
  size?: number;
  /** 四周留白（同一坐标系）。线宽的一半以上，否则描边会被裁掉 */
  padding?: number;
}

export interface TrackOutline {
  /** SVG path 的 d 属性，闭合曲线 */
  path: string;
  /** 起点（也是终点）在图上的坐标，用来画发车线的标记 */
  start: { x: number; y: number };
  /** 归一化用的比例尺，给调用方按需再算别的点 */
  scale: number;
}

/**
 * 把控制点投影成 SVG 路径。
 *
 * 投影用的是 (x, z) 平面 —— 也就是俯视图，高度信息丢掉。缩略图要回答的是
 * "这条道什么形状"，起伏靠难度标记和一句话描述说明。
 *
 * **z 轴要翻转**：世界坐标里 +z 是"北"，而 SVG 的 +y 朝下，
 * 不翻的话缩略图和实际赛道是镜像的。
 */
export function trackOutline(
  points: readonly ControlPoint[],
  options: ThumbnailOptions = {},
): TrackOutline {
  const size = options.size ?? 100;
  const padding = options.padding ?? 6;
  const n = points.length;
  if (n < 3) return { path: '', start: { x: size / 2, y: size / 2 }, scale: 1 };

  // 1. 包围盒。注意曲线会稍微鼓出控制点的凸包，padding 顺带把这一点吃掉
  let minX = Infinity;
  let maxX = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (const [x, , z] of points) {
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const span = Math.max(maxX - minX, maxZ - minZ, 1e-6);
  const scale = (size - padding * 2) / span;
  // 长边贴边，短边居中
  const offsetX = padding + ((size - padding * 2) - (maxX - minX) * scale) / 2;
  const offsetY = padding + ((size - padding * 2) - (maxZ - minZ) * scale) / 2;

  const project = (p: ControlPoint): { x: number; y: number } => ({
    x: round2((p[0] - minX) * scale + offsetX),
    // z 翻转：世界的 +z 在图上要朝上
    y: round2((maxZ - p[2]) * scale + offsetY),
  });

  // 2. 每一段 CatmullRom 转成一段三次贝塞尔。闭合曲线，所以下标取模绕回去
  const projected = points.map(project);
  let path = `M${projected[0]!.x} ${projected[0]!.y}`;
  for (let i = 0; i < n; i++) {
    const p0 = projected[(i - 1 + n) % n]!;
    const p1 = projected[i]!;
    const p2 = projected[(i + 1) % n]!;
    const p3 = projected[(i + 2) % n]!;
    // 端点切线 = tension * (下一个点 - 上一个点)，控制点落在切线的三分之一处
    const c1x = round2(p1.x + ((p2.x - p0.x) * TENSION) / 3);
    const c1y = round2(p1.y + ((p2.y - p0.y) * TENSION) / 3);
    const c2x = round2(p2.x - ((p3.x - p1.x) * TENSION) / 3);
    const c2y = round2(p2.y - ((p3.y - p1.y) * TENSION) / 3);
    path += `C${c1x} ${c1y} ${c2x} ${c2y} ${p2.x} ${p2.y}`;
  }
  path += 'Z';

  return { path, start: projected[0]!, scale };
}

/**
 * 一整个 `<svg>` 字符串，直接塞进 innerHTML。
 *
 * 画两层：底下一条粗的深色描边当"路基"，上面一条细的亮色当路面 ——
 * 一条线的缩略图在浅色卡片上会糊掉，两层就有了立体感。
 */
export function trackThumbnailSvg(
  points: readonly ControlPoint[],
  options: ThumbnailOptions & { roadColor?: string; baseColor?: string; startColor?: string } = {},
): string {
  const size = options.size ?? 100;
  const { path, start } = trackOutline(points, options);
  if (!path) return '';
  const road = options.roadColor ?? 'currentColor';
  const base = options.baseColor ?? 'rgba(0,0,0,0.45)';
  const startColor = options.startColor ?? '#ffffff';
  return (
    `<svg viewBox="0 0 ${size} ${size}" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">` +
    `<path d="${path}" fill="none" stroke="${base}" stroke-width="7" stroke-linejoin="round"/>` +
    `<path d="${path}" fill="none" stroke="${road}" stroke-width="3.4" stroke-linejoin="round"/>` +
    // 发车线：起点上一个小圆点。没有它的话看不出这圈从哪儿开始
    `<circle cx="${start.x}" cy="${start.y}" r="4" fill="${startColor}" stroke="${base}" stroke-width="1.5"/>` +
    `</svg>`
  );
}

/** 保留两位小数：路径字符串会进 DOM，多余的位数纯粹是体积 */
function round2(v: number): number {
  return Math.round(v * 100) / 100;
}
