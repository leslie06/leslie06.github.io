# 项目约定
- src/kart/kartStep.ts 是纯函数，禁止 import three / rapier
- 输入必须经过 InputState 抽象，上层不直接读键盘事件
- 物理固定 60Hz 步长，渲染插值
- 手感参数集中在 KartConfig.ts，并挂到 lil-gui
- 新增逻辑优先写成可单测的纯函数