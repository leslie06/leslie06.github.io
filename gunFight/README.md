# 枪火防线 GUNFIGHT

第一人称波次生存射击。战损街区，五把枪，会找掩体的敌人小队。

**在线试玩：** https://leslie06.github.io/gun-fight/

和这个仓库里其他游戏不同，这个不是单文件零依赖的：它用 three.js 渲染、Rapier 做物理、pmndrs 的 postprocessing 做后期，需要构建步骤，并且用了 Polyhaven 的 CC0 贴图和 HDRI。

## 玩法

波次生存。敌人小队从街区各处推进，打完一波有 8 秒喘息，补给箱重新充能。爆头分更高，连杀有倍率。死亡后按空格重新部署，从当前波次重来。最高分存在浏览器里。

| 键 | 动作 |
| --- | --- |
| WASD | 移动 |
| Shift | 疾跑（双击进战术冲刺） |
| Ctrl / C | 蹲下；疾跑中按 = 滑铲 |
| 空格 | 跳跃；对着齐腰掩体自动翻越 |
| 左键 / 右键 | 开火 / 机瞄 |
| R | 换弹 |
| 1 2 3 / 滚轮 | 换枪 |
| G / V / F | 手雷 / 近战 / 检视 |
| E | 交互 |
| Esc | 暂停 |

## 开发

```bash
npm install
npm run assets:fetch   # 从 Polyhaven 下载 CC0 贴图和 HDRI（幂等，仓库不存这些）
npm run dev            # http://127.0.0.1:5180
npm test               # 136 个单测
npm run build          # 产物在 dist/
```

`npm run shot` 用无头 Chromium 把所有注册的相机姿态渲染成 PNG，是这个项目的主要验证手段——每个模块自己截图、自己对着参考图打分。姿态注册在各模块的 `index.ts` 里，见 `src/debug/Poses.ts`。

`node scripts/prune-assets.mjs --dry` 检查有多少贴图是下载了但代码从不加载的。

## 结构

一个目录一个模块，模块之间只通过 `src/game/Contracts.ts` 的接口、`engine.events` 事件总线和 `engine.get(name)` 通信。启动顺序在 `main.ts`：render → world → player → weapons → enemies → fx → audio → ui → game。

约定写在 `CLAUDE.md` 里，包括画质档位表、物理与渲染的分工、粒子池和贴花的绘制调用预算。

## 素材

贴图和 HDRI 来自 [Polyhaven](https://polyhaven.com/license)（CC0）。音效没有文件，全部是 Web Audio 运行时合成的。
