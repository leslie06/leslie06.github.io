# 超级酷跑兄弟

纯前端的横版跳跃小游戏，单文件、零依赖、零外部请求。Canvas 手绘像素画面，音效由 Web Audio 实时合成，没有任何图片或音频素材。

**在线试玩：** https://leslie06.github.io/mario/

## 玩法

| 按键 | 作用 |
| --- | --- |
| `←` `→` | 移动 |
| `SPACE` | 跳跃，长按跳得更高 |
| `SHIFT` | 加速 · 发射火球 |
| `P` | 暂停 |
| `R` | 重来 |

打开后**先点一下画面**，键盘才会生效。手机上有屏幕虚拟手柄（左下方向键、右下 A/B），横屏体验更好。

## 内容

三个关卡：**1-1 平原**、**1-2 空中要塞**、**1-3 熔岩城堡**。

三段形态：小 →（蘑菇）大 →（花）火焰。火焰形态下按 `SHIFT` 发射火球，同屏最多两颗。受伤退回上一形态，小形态再受伤掉一条命，共 3 条。

敌人有板栗仔和乌龟，踩头击杀；金币、砖块、问号块、水管、升降地形都在。

## 文件

| 文件 | 说明 |
| --- | --- |
| `mario.html` | **源文件**，游戏逻辑都在里面的 `<script>` 中 |
| `build-web.py` | 从 `mario.html` 抽出脚本，生成下面两个产物 |
| `index.html` | 完整独立文档，**零外部请求**，静态托管入口，可离线运行 |
| `mario-web.html` | 页面片段（无 `<!DOCTYPE>`/`<head>`/`<body>`），供 Artifact 一类平台套壳使用 |

两个产物的差异只有字体策略：`mario-web.html` 联网加载 Press Start 2P 与站酷快乐体；`index.html` 剥掉字体链接改用系统字体栈，靠字重和字距补足观感。

**国内分享请用 `index.html`** —— `mario-web.html` 依赖 `fonts.googleapis.com`，在国内会等到超时才回退，首屏白屏数秒。

## 开发

改完 `mario.html` 后重新生成产物：

```bash
python3 build-web.py
```

本地预览直接双击 `index.html` 即可。想让同一 Wi-Fi 下的手机访问：

```bash
python3 -m http.server 8000
```

然后手机浏览器打开 `http://<你的内网IP>:8000/`。

## 部署

仓库同时托管在 GitHub 与 Gitee，`git push` 一次推送两边：

```bash
git remote -v   # origin 配了两个 push 地址
```

GitHub Pages 从 `main` 分支根目录自动部署，推送后自行更新。`index.html` 位于根目录，因此在线地址不必带文件名。
