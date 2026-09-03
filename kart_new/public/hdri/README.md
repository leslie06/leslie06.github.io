# HDRI

放一张等距圆柱投影的 `.hdr`，命名 `afternoon.hdr`（路径在 `src/assets/ModelPaths.ts`）。
它会被 `PMREMGenerator` 预处理成环境贴图挂到 `scene.environment` 上，同时当背景。

没有这个文件时用 `src/render/SkyEnvironment.ts` 里那个程序化渐变天空球烘环境贴图 ——
效果对低多边形卡通风格来说已经够了，而且不占一个字节的下载量。所以这张图是纯粹的
锦上添花，别为它牺牲首屏预算（分辨率 1k~2k 足够，4k 的 HDR 动辄十几 MB）。

注意：换成 HDRI 之后天空的颜色就不是 `AFTERNOON_SKY` 那几个值了，
而雾色仍然取自那张表 —— 两者差太远的话远处会出现一条硬边，挑图时留意一下地平线的颜色。
