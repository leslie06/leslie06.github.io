# 项目约定
- src/kart/kartStep.ts 是纯函数，禁止 import three / rapier
- 输入必须经过 InputState 抽象，上层不直接读键盘事件
- 物理固定 60Hz 步长，渲染插值
- 手感参数集中在 KartConfig.ts，并挂到 lil-gui
- 新增逻辑优先写成可单测的纯函数
- AI 只产出 InputState，物理走和玩家完全相同的 stepKart + KartConfig；
  想让 AI 快一点就改它那份 config 副本的 maxSpeed，不要在 stepKart 里开分支
- src/ai/ 同样禁止 import three / rapier：赛道信息经 AITrack 这个裸数字接口进来
  （TrackSpline 的适配器在 SplineSampler.ts，只用 type-only import）
- 道具同理：kartStep 不知道道具存在。效果统一表示成 {type, duration, magnitude}，
  通过改**传给 stepKart 的那份 config 副本**生效（EffectSystem.applyTo）
- 加道具 = 往 src/items/ItemDefs.ts 的表里加一条。别处不许写 switch (itemId)；
  要分支只能对 targetType 或 ItemOutcome 的字段分支。有测试钉着这条
- 需要随机的地方用 src/items/rng.ts 的带种子 PRNG，不要用 Math.random ——
  整局比赛必须可复现

# 移动端 / 性能
- 画质参数全部在 src/render/QualityTiers.ts 的三档表里。任何地方都不许再硬编码
  像素比、阴影分辨率、雾距离、粒子数、装饰物密度 —— 要加可调项就往 QualitySettings
  里加字段，然后在 main.ts 的 applyQuality() 里套上去（那是唯一改这些参数的入口）
- 设备探测（UA / WebGL 参数 / 屏幕）集中在 src/core/DeviceCaps.ts，探完变成裸数字
  结构交出去；分档逻辑 pickTier 是纯函数，有测试
- **low 档性能预算：drawcall ≤ 150、三角面 ≤ 20 万、贴图 ≤ 1024。**
  实测 low 37 / 1.5 万，medium 104 / 3.3 万，high 133 / 4.4 万（含阴影和后处理的 pass）。
  重复的东西（装饰物、道具箱、车影）一律 InstancedMesh；一辆车的车身按材质合并成
  两个几何体 + 四个轮子，共 6 个 drawcall。跑起来之后 PerfBudget.ts 会拿
  renderer.info 跟预算对一遍，超了在控制台喊
- 贴图只收 KTX2（Basis），模型必须声明 draco 或 meshopt 压缩；PNG/JPG 直接进不了
  AssetManifest（validateManifest 会报错，有测试钉着）。转换走 npm run assets:convert
- 首屏（AssetManifest 里 phase='core' 的那批）总量 ≤ 10MB。rapier 是动态 import 的：
  先出加载界面，再下这个大块头
- 三个解码器（KTX2/draco/meshopt）的接线在 src/assets/decoders.ts，**现在是断开的**：
  打包器只要看见那句 import() 就会连着 1.8MB 的 wasm 一起产出来，不管跑不跑得到。
  清单是空的就不许接，加第一条资源时按 decoders.ts 顶上的说明接回来 ——
  AssetLoader.test.ts 钉着这个双向约束（清单空 <-> 没接线）
- 触屏输入和键盘平级，都只产出 InputState；虚拟摇杆的数学在 touchMath.ts（纯函数、
  有测试），DOM 那一坨在 TouchAdapter.ts。控件必须是 CSS 定位的 DOM，不许画进 canvas
- 移动端 UI 一律用 env(safe-area-inset-*) 让开刘海和小白条；触屏时的布局差异
  统一挂在 body.touch-input 这个 class 下
- 调试用 URL 参数：?quality=low|medium|high|auto、?input=touch|keyboard（不写回存储）
