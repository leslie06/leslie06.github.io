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

# 视觉 / 音效
- **车模型**：KartView 有两种形态，外面看不出区别 —— Box 拼的占位车（默认）和
  glTF 模型（setModel 之后换上）。模型是边玩边下的，下不到就一直用占位车，
  所以 public/models/kart.glb 放不放都能跑。导出约定（车头朝 +Z、轮子节点名带
  wheel、可换色的材质名带 body/accent/trim/suit）写在 src/render/kartRig.ts 顶上
- 换配色**不许**给每辆车克隆一套材质：走 kartRig 的 TintCache 按 (原材质, 颜色)
  查表，同色的车共用同一份材质。材质各不相同 = 每份都要单独编译一次着色器，
  也再不可能被合批。有测试钉着这条
- **天空和环境光**在 src/render/SkyEnvironment.ts：程序化渐变球 + PMREM 烘出来的
  环境贴图。三个颜色必须一致 —— 雾色 == 天空地平线色 == 地面远处的颜色，
  对不上远处就有一条硬边，所以雾色是 World 从 sky.fogColor 取的，不许各写各的。
  HDRI（public/hdri/）是可选的，下到了就换掉渐变球，下不到不影响任何东西
- 半球光和环境贴图是同一件事的两种做法，强度**此消彼长**（见 World 里的两个常数）。
  两个都开满的后果是过曝，ACES 会把它压回来，代价是颜色全发灰
- **后处理**用 pmndrs 的 postprocessing，不用 three 自带的 EffectComposer：
  前者把所有 Effect 编译进一个 EffectPass，全屏读写只发生一次。
  tonemapping 的归属跟着档位换手 —— 开 composer 时由 ToneMappingEffect 做
  （renderer 必须设成 NoToneMapping，否则 tonemap 两次画面发灰），不开时由 renderer 做。
  PostFx.setQuality 每次都会把这件事摆平，别在别处动 renderer.toneMapping
- **粒子**统一用 src/render/ParticlePool.ts：一个池子 = 一个 drawcall，
  粒子存世界坐标，所以**全场共用一个池**，不许每辆车一个（八辆车各一套火花和扬尘
  就是 16 个 drawcall，low 档总共才 150）。用法是"每辆车 emit 一次、每帧 step 一次"。
  容量在构造时定死（typed array 不能改大小），发射是覆盖最老的一颗，全程零分配
- 特效一共只吃 5 个 drawcall（火花 / 扬尘 / 爆闪 / 拖尾 / 假阴影各一个），
  和场上有几辆车无关。加新特效前先想清楚它是不是能塞进已有的池子
- 自己写 ShaderMaterial 时两件事必须记得：用 `color` 属性要开 vertexColors，
  吃雾要把 `THREE.UniformsLib.fog` 合并进 uniforms（只写 fog: true 会让
  refreshFogUniforms 读到 undefined 直接抛，表现是白屏 + 一条看不出出处的报错）

# 音频
- 所有声音走 src/audio/AudioManager.ts 一个入口，上层只说"播 boost"，不碰 Howl
- **加一个音效 = 往 src/audio/SoundDefs.ts 的表里加一条**。别处不许写
  `if (soundId === ...)`：音量、循环与否、走哪条总线、同时发声数上限全是表里的字段
- 音频文件缺失时自动退回 src/audio/synth.ts 现场合成的占位音（纯函数，有测试）。
  所以**没有任何音频文件时整套系统照样能验**，把真文件放进 public/audio/ 就自动切过去
- 引擎声、漂移摩擦、蓄力是三条**一直在播**的循环音，靠音量和音高表达状态，
  不反复启停 —— 移动端每次 play() 都有几十毫秒延迟，启停的漂移声会碎成一片
- "比赛里发生的事 -> 播哪个音"的规则在 src/audio/RaceAudio.ts，它不 import three，
  只吃裸数字和已有的事件类型
- AudioManager.init() **必须在用户手势的调用栈里同步调**（主菜单那一下），
  异步之后 iOS 就不认这个手势了，之后播什么都是静音而且不报错

# UI
- 所有界面的颜色、圆角、阴影、字体从 src/ui/theme.ts 的令牌取，
  **不许再硬编码一个 #4d9bff 或者 border-radius: 12px**。和 QualityTiers 同一个道理
- 浅色赛道上的字一律用 .k-outline / .k-outline-lg 描边，不要只靠投影 ——
  白字在天蓝和草绿上会直接糊进背景
- **加一条赛道 = 往 src/track/TrackCatalog.ts 的表里加一条**（控制点 + TrackConfig +
  道具箱位置 + 圈数）。TrackCatalog.test.ts 会验不自交、坡度、最小曲率半径、
  相邻控制点间距和道具箱是否在柏油上 —— 自交的赛道跑起来只表现为"进度突然跳一大截"，
  肉眼很难当场看出来
- 换赛道是**重载页面**（?track= 或者结算面板上的按钮）：赛道网格、rapier 碰撞体、
  发车格、AI 采样器全是按那条赛道建的，运行时换等于把整个世界拆了重搭
- 画质档位在主菜单里也能改，因为**对手数量在开局时就定死了**，进游戏后改档位不影响它
