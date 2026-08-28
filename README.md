# 小游戏合集

一个仓库装所有小游戏，一个目录一个游戏。全都是**单文件、零依赖、零外部请求**：一个 `index.html` 打开就能玩，画面是 Canvas（或自己写的 WebGL）现场画的，音乐音效由 Web Audio 实时合成，仓库里没有任何图片、模型或音频素材。

**在线试玩：** https://leslie06.github.io/

| 游戏 | 类型 | 地址 |
| --- | --- | --- |
| [尸潮之夜](zombie/) | 俯视角波次生存射击，夜战 | https://leslie06.github.io/zombie/ |
| [飛簷 · 屋顶轻功](wuxia/) | 3D 武侠屋顶跑酷，手写 WebGL | https://leslie06.github.io/wuxia/ |
| [合金小队](contra/) | 魂斗罗风格横版跑射，三关 | https://leslie06.github.io/contra/ |
| [超级酷跑兄弟](mario/) | 横版跳跃 | https://leslie06.github.io/mario/ |

每个游戏目录里都有一份自己的 README，写了玩法、内容和改动方式。

## 加一个新游戏

1. 新建目录 `<名字>/`，里面放 `index.html` 和 `README.md`
2. 在根目录的 `index.html` 里加一张卡片
3. `git push` —— 几十秒后 `https://leslie06.github.io/<名字>/` 就是活的

不用建新仓库，不用再设一次 Pages。

## 约定

- **单文件**：游戏的全部逻辑写在 `index.html` 的 `<script>` 里，没有构建步骤，改完刷新即可
- **零外部请求**：不引 CDN、不引字体、不放素材文件；画面和声音都在运行时生成
- **手机能玩**：触屏走虚拟摇杆或手柄，横竖屏都不能塌
- **无头测试**（可选）：放在游戏目录的 `tools/` 里，用假的 DOM 把游戏逻辑在 Node 里跑起来，查异常、NaN 和数值曲线。`wuxia/` 和 `zombie/` 有，跑 `node tools/test.js`

## 本地预览

双击任意游戏的 `index.html` 即可。想连目录页一起看，或者让同一 Wi-Fi 下的手机访问：

```bash
python3 -m http.server 8000
```

然后打开 `http://localhost:8000/`，手机上换成你的内网 IP。

## 部署

仓库名必须正好是 `leslie06.github.io`，GitHub Pages 从 `main` 分支根目录自动部署，推送后自行更新。
