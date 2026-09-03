# Kart Prototype

马里奥赛车那种街机手感的卡丁车原型。Three.js + Vite + TypeScript，风格是明亮卡通低多边形。
现在有：三条可选赛道（程序化生成，带起伏、路肩、护栏）、一辆贴地形跑的车、AI 对手、
道具系统，以及一套完整的比赛流程 —— 主菜单选赛道、倒计时发车、checkpoint 防抄近道、
圈速计时、名次、结算面板。
视觉上有渐变天空 + PMREM 环境光、bloom / SMAA / 暗角后处理、漂移火花、轮胎扬尘、
boost 拖尾和命中爆闪；音效走 Howler，引擎声的音高跟着速度走。
手机上也能开：虚拟摇杆 + 三档画质自适应，见[移动端适配](#移动端适配)。

> 外部美术资源（车模型 / HDRI / 音频文件）**现在一个都没有**，全部有程序化的东西顶着：
> 占位车是 Box 拼的、天空是渐变球、音效是现场合成的。把文件放进 `public/` 的对应位置
> 就自动换过去，代码一个字不用改 —— 路径和约定见 [`src/assets/ModelPaths.ts`](src/assets/ModelPaths.ts)。

## 跑起来

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # tsc --noEmit + vite build
npm test         # vitest
```

## 操作

| 键 | 作用 |
|---|---|
| `W` / `↑` | 油门 |
| `S` / `↓` | 刹车，停住后继续按是倒车 |
| `A` `D` / `←` `→` | 转向 |
| `Space` | 刹车 |
| `Shift` | 漂移蓄力，松开放 mini-turbo |
| `R` | 重开比赛（回起跑线 + 倒计时重来） |
| `H` | 收起 / 展开调参面板 |

触屏（手机/平板自动切过去，也可以在左上角 ⚙ 设置里手动选）：左下浮动摇杆转向，
右下三个按钮是油门 / 刹车倒车 / 漂移，右上角是道具键。

调试用的 URL 参数：`?quality=low|medium|high|auto`、`?input=touch|keyboard`、
`?track=meadow|sunset|ridge`、`?mute=1|0`（都不写回存储）。

## 架构

```
src/
  kart/
    kartStep.ts        纯函数 stepKart(state, input, ground, config, dt)。不许 import three / rapier
    GroundSample.ts    地面探测结果的裸数字结构，外层算好喂进 stepKart
    KartConfig.ts      所有手感参数 + GUI 用的范围表
    kartStep.test.ts   含一条测试直接读源码断言没有 three / rapier / DOM 引用
  input/
    InputState.ts      中立输入意图 { steer, throttle, brake, drift, useItem } + InputAdapter 接口
    KeyboardAdapter.ts 键盘 -> InputState
    TouchAdapter.ts    虚拟摇杆 + 按钮（CSS 定位的 DOM）-> InputState，和键盘平级
    touchMath.ts       摇杆的死区/曲线，纯函数
    InputMode.ts       键盘还是触屏：探测 + 手动覆盖
  core/
    FixedStepLoop.ts   固定步长累加器，物理 60Hz，渲染拿 alpha 插值
    DeviceCaps.ts      UA / WebGL 参数 / 屏幕探测，探完变成裸数字结构
    Prefs.ts           画质档位和操作方式的本机设置（localStorage + URL 参数覆盖）
  track/
    TrackConfig.ts     默认赛道的控制点（带 y）+ 宽度/路肩/护栏尺寸
    TrackCatalog.ts    三条可选赛道的表（控制点 + 配置 + 圈数 + 道具箱），纯数据
    TrackSpline.ts     闭合 CatmullRom 中心线；getProgress 用 500 点预采样表查最近点
    TrackMesh.ts       沿样条挤出路面 + 路肩 + 护栏 + 裙边，顺带产出碰撞几何
  physics/
    PhysicsSystem.ts   只用 rapier 做 raycast：赛道 trimesh + 每帧一条向下的射线
  render/
    World.ts           天空 + 地面 + 光照 + 参照物（InstancedMesh，密度按档位）
    SkyEnvironment.ts  渐变天空球 + PMREM 环境贴图；HDRI 可选，下不到就用渐变的
    KartView.ts        车的可视部分：Box 拼的占位车 / glTF 模型两种形态，外面看不出区别
    kartRig.ts         从 glTF 树里拆出车身和四个轮子 + 按材质名标签换配色（TintCache）
    FollowCamera.ts    弹簧阻尼跟随；速度相关的 FOV/距离、漂移侧移、撞击震动
    QualityTiers.ts    high/medium/low 三档参数表 + 分档逻辑（纯函数）
    PostFx.ts          后处理链（postprocessing 库）：bloom / SMAA / 暗角 / ACES
    ParticlePool.ts    通用粒子池：一个池一个 drawcall，世界坐标，全程零分配
    DriftSparks.ts     漂移火花，按档位变色（白 -> 橙 -> 蓝）
    TireDust.ts        轮胎扬尘，漂移和越野时从轮下扬起
    ImpactFx.ts        命中/撞击的爆闪 + 碎光扩散
    BoostTrails.ts     boost 拖尾，所有车的飘带在同一个几何体里
    BlobShadows.ts     贴片假影子，low 档没有实时阴影时顶上
    FrameMonitor.ts    最近 60 帧的账本，持续掉帧就建议降档（纯逻辑）
    PerfBudget.ts      拿 renderer.info 核 low 档预算
  assets/
    AssetManifest.ts   资源清单 + 校验（PNG/JPG 直接报错，首屏 10MB 预算）
    AssetLoader.ts     按 phase 分批加载 + 进度回调
    decoders.ts        KTX2 / draco / meshopt 的接线，故意不被 import（见下）
    LoadProgress.ts    加权任务的进度账本（下载之外还有 wasm 编译、网格生成）
    ModelLibrary.ts    通用 glTF 加载 + 缓存；克隆共享几何体和材质
    ModelPaths.ts      可选美术资源的路径（模型 / HDRI），没有就退回程序化的东西
  audio/
    AudioManager.ts    所有声音的唯一入口（Howler）：两条总线 + 总音量 + 静音
    SoundDefs.ts       音效表，纯数据。加音效 = 往这里加一条
    synth.ts           音频文件缺失时现场合成占位音（纯函数，输出 WAV data URI）
    RaceAudio.ts       "比赛里发生的事 -> 播哪个音"，不 import three
  race/
    RaceProgress.ts    单车的圈数 / checkpoint / 圈速。纯逻辑，只吃 t 和 dt
    RaceState.ts       倒计时 -> 比赛中 -> 结束的状态机 + 输入锁 + 名次。接口按多车写
    LapRecord.ts       最佳圈速存 localStorage，存储对象从外面注入所以可测
    formatTime.ts      秒 -> `m:ss.mmm`
  ui/
    theme.ts           设计令牌（颜色 / 圆角 / 阴影 / 字体）+ 描边字、面板、按钮几个共用类
    MainMenu.ts        主菜单 + 赛道选择（在所有重活之前，选完才开始建世界）
    Hud.ts             DOM 显示速度和 FPS
    RaceHud.ts         DOM 显示圈数 / 名次 / 圈速 / 倒计时 / 结算面板
    DebugGui.ts        lil-gui，所有参数实时可调
    LoadingScreen.ts   首屏进度条
    SettingsMenu.ts    画质 / 操作方式 / 音量 / 静音（给玩家看的那四行）
    DeviceOverlays.ts  竖屏遮罩、WebGL 上下文丢失、双击缩放拦截
    Toast.ts           "已自动降画质"这类一句话提示
```

### 几条硬规矩

- **`kartStep.ts` 是纯的**：没有副作用、没有随机数、不 import 渲染层。同样的输入永远得到同样的输出，所以能直接跑测试、能做回放、以后能拿来跑人机。有一条测试直接读它的源码来守这条线。
- **上层不读键盘事件**：一律走 `InputState`。加触屏摇杆 = 新写一个 `InputAdapter`，别的代码不用动。
- **物理不吃 deltaTime**：`FixedStepLoop` 用累加器固定 60Hz，渲染用 `lerpKartState` 插值。掉帧不会改手感。
- **视觉的东西不进 kartStep**：车身侧倾、加速后仰在 `KartView`，相机弹簧在 `FollowCamera`。
- **地形查询也不进 kartStep**：射线要用 rapier，那是物理层的事。`PhysicsSystem` 每步算好
  一个 `GroundSample`（接触点高度、地面法线、在不在赛道上、横向偏移、重生点）当参数传进去。

### 运动学模型

只维护标量 `speed` 和朝向角 `heading`，每帧沿 heading 推进位置。没有横向速度分量，
所以抓地力天然是满的 —— 不侧滑、不打转、撞不到东西就不会失控。

转向角速度 = `turnRate * steer * 权限 * 速度衰减`：

- **权限**：低于 `steerAuthoritySpeed` 时线性淡入，保证原地静止打方向车不会自转
- **速度衰减**：到 `maxSpeed` 时降到 `highSpeedSteerFactor` 倍，低速灵、高速钝
- 倒车时转向方向自动反过来

`heading` 故意不做 `[-π, π]` 归一化，这样渲染插值可以直接线性 lerp，不用处理绕圈跳变。

### 转向的符号（踩过两次的坑）

`heading` 是绕 `+y` 的右手旋转，可以直接赋给 `object.rotation.y`。但**绕 `+y` 的正向旋转
从上往下看是逆时针，也就是左转**，所以 `steer = +1`（玩家按右）对应 `heading` 减小，
`yawRate` 前面有个负号。同一个坑在 `KartView` 的前轮视觉转角上也有一份。

另外模型面朝 `+z`，所以**车自身的右侧在局部 `-x` 上**（`forward × up = -x`），
车身侧倾的符号跟直觉是反的。

这三处符号现在都有测试守着，而且都写成了跟坐标约定无关的判据：

- `kartStep.test.ts` 用车自身的右向量投影，不断言 heading 增减
- `KartView.test.ts` 断言前轮转向和实际偏航同向、车身往弯内侧倒
- `FollowCamera.test.ts` 把车的位移变换到相机空间 —— 相机 local `+x` 就是屏幕右，
  这条才真正对应"你按右、画面里往右转"

改符号前先跑一遍 `npm test`，这三条会一起报。

### 相机的一个坑

弹簧追一个匀速移动的目标会有**固定稳态滞后**（临界阻尼下约 `2v/ωn`）。不补偿的话满速时
相机会被拖到配置值的 1.6 倍远，`baseDistance` / `distanceGain` 这两个旋钮就白调了。
`FollowCamera.computeDesired` 里加了速度前馈把这段滞后提前加到目标点上，配置多少就是多少；
转弯过程中的拖尾还是保留着，那个是好看的。`FollowCamera.test.ts` 里有回归测试守着。

## 漂移蓄力 / Mini-Turbo

全部逻辑在 `kartStep.ts` 里，仍然是纯函数。

### 状态机

`KartState.driftPhase`: `'none' | 'drifting' | 'boosting'`，没有一堆布尔标志。

```
none ──按住drift + 有方向 + speed>driftMinSpeed──> drifting
drifting ──松开drift，level≥1──> boosting ──boostTime耗尽──> none
drifting ──松开drift，level=0──> none          （无奖励）
drifting ──speed 掉到 driftMinSpeed 以下──> none（charge 清零，无奖励）
```

**`driftPhase` 和 boost 生效与否是两回事。** phase 描述玩家在做什么，
boost 生效看 `boostTime > 0`。所以 boost 期间可以直接起下一个漂移：
phase 回到 `drifting`，`boostTime` 继续跑，剩余的 boost 不会因为起漂就白丢。

### 几个要点

- **driftDir 起漂瞬间锁定**，中途反打也不变
- **反打不能取消漂移**：转向倍率是 `lerp(driftCounterSteer, 1, ...)`，
  `driftCounterSteer` 的 GUI 下界故意不给 0，所以这个倍率**恒为正** —— 反打只能掰松，掰不停也掰不反
- **车斜着走但前进方向不变**：`driftYawOffset` 只影响渲染朝向，
  位置推进严格只用 `heading`。有测试逐帧验证位移无横向分量
- **boost 结束要平滑回落**：加速那一步用 `accelerateToward`，超过上限时**原样返回**，
  绝不把 speed 硬拽回 cap。写成 `Math.min(cap, speed + delta)` 的话 boost 一结束
  就会单帧掉 11.5 m/s，手感像撞墙 —— 这个坑有测试守着

### 事件

`stepKart` 是纯函数，发不出回调，所以事件做成两个状态的**差分**：

```ts
for (const event of diffKartEvents(previous, current)) onKartEvent(event);
```

主循环在**每个物理子步**之后调一次。只在 render 里比 `previous`/`current` 会漏事件 ——
一个渲染帧可能跑了多步物理。

事件类型：`driftStart` / `driftLevelUp` / `driftEnd`（带 `level` 和 `boosted`）/
`boostStart` / `boostEnd`。接音效直接挂在 `main.ts` 的 `onKartEvent` 上。

### 视觉（都不在 kartStep 里）

- `KartView`：漂移时侧倾乘 `driftRollMul` 再加 `driftRollBias` 偏置
- `DriftSparks`：固定 400 容量的 Points 池，循环覆盖，全程不分配对象。
  **必须挂 scene 不能挂车上** —— 粒子存的是世界坐标，挂车上火花会跟着车跑。
  一档蓝 / 二档橙 / 三档粉紫
- `FollowCamera.punch()`：boost 起步 FOV 短促推一下再自己衰减回落
- `Hud`：boost 期间屏幕边缘放射状速度线，中间留空不挡视线

## 赛道与地形

### 赛道数据

`TrackSpline` 包一条闭合的 `CatmullRomCurve3`，控制点带 `y`，所以赛道是有起伏的。
控制点写在 `TrackConfig.ts` 里，一组 18 个，用"半径随角度变化的星形"生成再取整
（星形保证不自交）。实测周长约 1010m、最小曲率半径 33m、高差 12m、最大坡度 4.4°。

**`getProgress(x, z)` 是每帧都要调的**，所以不能去遍历曲线求最近点：构造时把曲线按弧长
均分成 500 个点建表，查询时先扫表找最近的采样点，再在它左右两段上做一次线性投影细化
（不细化的话 t 的分辨率就被采样密度锁死在 1.7m 一格）。整个查询对曲线本身只求值常数次，
`TrackSpline.test.ts` 里有一条测试给曲线打桩计数守着这条。

返回进度 `t`、**带符号的横向偏移**（正 = 车手视角右侧）、最近的中心点和该处朝向。

### 网格生成

`TrackMesh` 沿样条按固定间隔采环，每环在横向挤出若干顶点，相邻两环缝成三角带：
路面 → 路肩（红白减速带，外沿下沉一点）→ 护栏（内面/顶面/外面三片）→ 裙边（垂到草地高度，
挡住路面悬空的缝）。UV 的 `v` 用累计弧长，所以纹理沿长度方向自然平铺。

顶点法线用样条算出来的**路面法线**（`side × tangent`），不是固定的 `(0,1,0)` ——
用固定值的话上下坡会被照得跟平地一样，起伏就看不出来了。

面朝向只有一条规则：**面法线 = `(b - a) × 切线`**。三角带的缠绕是固定的，
所以要让某个面朝哪边，只需要安排 `a`/`b` 的先后；左右两侧 `side` 方向相反，
左侧所有面都要反过来排。`TrackMesh.test.ts` 逐三角形比对几何叉积和顶点法线，
一处排反了就会报（渲染上表现为"破洞"，因为被背面剔除吃掉了）。

碰撞几何复用路面 + 路肩的三角形，另外多铺一条**不渲染**的护栏底座
（可行驶半宽往外 `wallThickness` 宽的水平带）。蹭墙时车会短暂待在可行驶半宽之外
（采样差一帧），没有这条带子那几帧射线就打空了 —— 车不会飞出去，但拿不到接触点高度，
蹭着墙上坡时车高会卡住不动。护栏本身不进碰撞体，见下面。

### 地形贴合

`PhysicsSystem` 里 **rapier 只当射线加速结构用**：赛道注册成一个静态 trimesh collider，
车没有刚体，也没用车辆控制器。每步从 `车高 + 3m` 往下打一条射线，拿到接触点高度和法线。

> **坑**：`castRay` 走的是 broad phase 的加速结构，而那个结构是在 `world.step()` 里建的。
> 建完 collider 不 step 一次的话**每一条射线都会 MISS**，车会一直判定成掉出赛道。
> `PhysicsSystem` 构造时有一次且仅有一次 `step()`，`PhysicsSystem.test.ts` 守着这条。

kartStep 拿到 `GroundSample` 之后：

- **贴地**：`y` 按 `groundStickSmoothing` 阻尼逼近接触点，不瞬间吸附，所以过坎有起伏感
- **姿态**：地面法线也做平滑（`groundNormalSmoothing`）后存进 state，`KartView` 把它转成旋转：
  `quaternion = tilt * yaw`，先转朝向再把车顶掰到法线上。
  写成 `yaw * tilt` 的话坡度会变成随朝向变化的侧倾，那个错得多
- **掉出赛道**：射线打空 → `airborne`，按 `gravity` 下落，`respawnDelay`（默认 2s）后
  重生到最近的样条点，速度和蓄力全部清零

采样对应的是**这一步开始时**的位置，推进之后才拿它做贴地和护栏修正，也就是差一帧。
60Hz 下看不出来，换来的是"查询和积分完全解耦"。

### 护栏

没做真的碰撞体：横向偏移超出可行驶半宽（路面一半 + 路肩）就沿 `toCenter` 把车拉回来，
同时按 `wallDecel` 掉速。便宜、稳定、永远不会穿墙。因为采样差一帧，稳态下最多超出
"一帧的位移"那么多，不会越顶越远 —— `kartStep.test.ts` 里有一条闭环测试（每帧重新采样）
盯着这个收敛性。

> **坑**：护栏修正**不能**加 `ground.onTrack` 这个条件。碰撞几何是有边界的，采样又差一帧，
> 满速斜着撞墙时"射线打空"和"该被墙挡住"会同时成立 —— 加了条件就等于直接穿墙飞出去
> （实测 34 m/s 斜撞，横向偏移一路跑到 70m）。
> 但也不能无条件生效，否则真掉出去的车会被墙从半空吸回来。所以有两道闸：已经在下落的车不管，
> 超出量大于"一帧可能走过的距离"的也不管。三种情况都有回归测试。

### 调试

GUI 的「赛道」一栏：显示样条中心线（品红色 `Line`）、当前进度 `t`、当前横向偏移、
是否掉出赛道。后三个是只读读数，每帧回读。

## 比赛：圈速 / checkpoint / 名次

`RaceProgress` 和 `RaceState` 跟 `kartStep` 守同一条线：不 import three / rapier / DOM，
只吃赛道进度 `t` 和 `dt`。有测试直接读源码断言这一点。

### 为什么不直接积分 t 的增量

"每帧把 Δt 累加起来，过 1 就是一圈"挡不住抄近道：从赛道内侧横穿过去，`getProgress`
找的是**最近的样条点**，`t` 会直接从 0.3 跳到 0.7，累加器照收不误。

所以按 checkpoint 走：样条均分成 8 段（sector），checkpoint `i` = sector `i` 的入口
（`t = i/8`），0 号就是起点线。**只认相邻的 sector 变化**，非相邻的跳变一律判为
抄近道/传送，整圈作废。漏了任何一个 checkpoint，过起点线不计圈。

### 倒车过线

比"不加圈"要细一点。反向穿过起点线时把刚记上的那一圈**整个撤销**：圈数减一、
圈速弹回来接着走、已通过的 checkpoint 恢复。再正着开过来会重新记这一圈 ——
净效果就是不加圈，而且来回折腾浪费的时间会算进那一圈里，不会白送。

这里有个必须守的标志 `_lineCredited`：漏了 checkpoint 的那次过线本来就没加圈，
退回去时当然也不能去减前面某一圈。没有它的话"跑完一圈 → 第二圈漏 checkpoint 过线 →
倒车退回"会把第一圈吃掉。

### 重生点

掉出赛道后送回 `getLastCheckpoint()`（当前 sector 的入口），不是最近的样条点。
从赛道外面横着摔出去时，最近样条点可能落在赛道**另一段**上，那等于摔一跤白送一大截近道。
`PhysicsSystem.sample()` 多了一个可选的 `respawnT` 参数走这条路。

代价是往回退得比较狠：周长 1012m / 8 段 = 每段 126m，平均退 63m。嫌罚重就把
`RaceConfig.checkpointCount` 调到 16，其余逻辑不用动。

### 状态机与输入锁

`'countdown' | 'racing' | 'finished'`。倒计时和冲线后 `gateInput()` 一律返回
`NEUTRAL_INPUT`，车靠 `coastFriction` 自然减速停下 —— 不需要在 `kartStep` 里加任何状态。

> **坑**：倒计时归零的判定用了 `1e-6` 阈值。3 秒按 `1/60` 减 180 次，二进制误差会剩下
> ~1e-14，直接写 `<= 0` 会卡住多跑一帧。

名次按 `totalProgress`（= 已完成圈数 + 当前进度）降序，已冲线的按冲线顺序排在最前。
现在只有玩家一辆车，但 `RaceState` 的接口是按多车写的。

注意 `totalProgress` 在"漏了 checkpoint 却过了线"时会掉回将近 1 —— 那一圈确实不算，
名次也就该退回去。

### HUD

`RaceHud` 走 DOM 不走 3D：左上圈数、右上三行计时（本局最佳金色、破纪录绿色）、
中央倒计时和圈速弹窗、完赛结算面板。最佳圈速存 localStorage，破纪录时中央弹窗带绿色辉光。

> **坑一**：`el.hidden` 藏不住 `display: flex` 的元素 —— 作者样式的 `display` 会盖掉
> UA 的 `[hidden]{display:none}`，结果空的结算面板一直挂在屏幕中间。
> 样式表里补了一条 `.race-hud [hidden]{display:none!important}`。
>
> **坑二**：计时面板和 lil-gui 都钉在右上角，会被压住。`DebugGui` 现在往 `body` 上打
> 一个 `debug-gui-open` class，HUD 据此左移，按 `H` 收起面板时自动回位。

## 移动端适配

目标：手机浏览器稳定 30fps、首屏 10MB 以内。分四块：触屏输入、画质分档、资源管线、
iOS Safari 的几个专项坑。

### 触屏输入

`TouchAdapter` 和 `KeyboardAdapter` 平级，都只产出 `InputState`，上层完全不知道
这一帧的输入是手指还是键盘来的。启动时按设备探测选一个（`detectInputMode`），
设置菜单里可以手动切。

- 左下一大块是**浮动摇杆**：手指按在哪儿圆心就落在哪儿。固定圆心的摇杆在看不见手的
  情况下很难摸准，横屏握持时尤其明显。
- 右下三个按钮：油门（大、最靠角）、刹车/倒车、漂移；道具键单独放右上角。
- 控件全是 CSS 定位的 DOM，**不画在 canvas 里** —— 画进去意味着每帧重画、自己做命中
  判定、还要跟着分辨率缩放，而 DOM 这些全是白送的，且 0 drawcall。
- 用 Pointer Events + `setPointerCapture`，不用 `touchstart/touchmove`：捕获之后
  手指滑出按钮范围也还算按住，松开一定收得到 up。这是"过弯时手指晃了一下车就熄火"
  的根治办法。
- 摇杆的死区/曲线在 `touchMath.ts` 里，是纯函数、有测试。按下去那一点几乎不可能正好是
  圆心，没死区车会一直微微歪。

### 画质分档

`QualityTiers.ts` 是一张三档表（high / medium / low），**所有**渲染参数从这里读：
像素比上限、阴影分辨率、后处理级别、AI 数量、粒子池容量、装饰物密度、雾距离、各向异性。
探测（UA + WebGL 参数 + 屏幕）在 `core/DeviceCaps.ts`，分档 `pickTier` 是纯函数。

| | high | medium | low |
|---|---|---|---|
| 像素比上限 | 2 | 1.5 | 1 |
| 阴影 | 2048 | 1024 | 关，改用贴片假影子 |
| 后处理 | bloom + SMAA | 半分辨率 bloom | 只有 tonemapping |
| AI 数量 | 7 | 5 | 3 |
| 雾 | 180–620m | 130–420m | 80–240m |

low 档不建 `EffectComposer` 而不是"建一个只有 RenderPass 的"：composer 意味着先画进
一张 RT 再全屏拷回屏幕，这一次拷贝在移动 GPU 上是实打实的带宽开销。

改档位只有一个入口 —— `main.ts` 的 `applyQuality()`，手动改和自动降档都走它，
所以不会出现"改了像素比但忘了改阴影"的半套状态。三样东西只能在启动时定：
AI 数量、火花池容量（typed array 建好不能改大小）、抗锯齿（renderer 的构造参数）。

### 性能预算

**low 档：drawcall ≤ 150、三角面 ≤ 20 万、贴图 ≤ 1024。** 实测（含阴影和后处理的 pass）：

| | drawcall | 三角面 |
|---|---|---|
| low | 37 | 1.5 万 |
| medium | 104 | 3.3 万 |
| high | 133 | 4.4 万 |

怎么压下来的：

- 495 个装饰物 → 2 个 `InstancedMesh`（锥桶一个，矮方块和高柱子共用一个，
  它们都是单位立方体，差别只在每实例的缩放）。降档靠改 `count`：摆位是同一串确定性
  随机，少画就是取前缀，已经在那儿的不会跳位置。
- 24 个道具箱 + 同样多的描边 → 1 个 `InstancedMesh`。
- 一辆车原来是 23 个 Mesh（15 个方块 + 4 个轮子各带轮毂），现在按材质合并成
  2 个几何体 + 4 个轮子 = 6 个 drawcall，颜色烘进顶点色。8 辆车 184 → 48。
  颜色走顶点色而不是多材质：three 是按 (几何体, 材质) 对发 drawcall 的，
  多材质合并出来还是几个 drawcall，等于没合。
- low 档关阴影后车会像浮在路上，用一个 `InstancedMesh` 的圆片假影子补回来 ——
  影子留在**路面高度**上不跟着车飞，腾空多高一眼看得出来。

跑起来之后 `PerfBudget.ts` 拿 `renderer.info` 跟预算对一遍，超了在控制台喊。
注意 `renderer.info.autoReset = false` + 每帧手动 `reset()`：开了后处理之后一帧有
好几个 pass，自动清零的话 `info.render` 里只剩最后那个全屏 pass 的 1 个 drawcall。

### 资源管线

- 贴图只收 KTX2（Basis），模型必须声明 `draco` 或 `meshopt`。PNG/JPG 进不了
  `AssetManifest` —— `validateManifest` 直接报错，有测试钉着。转换：
  `npm run assets:convert`（外部工具 `ktx` + `gltf-transform`）。
- 分批：`phase: 'core'`（赛道 + 玩家的车）先下，`'deferred'`（AI 车、装饰物）进比赛
  之后再补。core 总量有 10MB 预算，超了 `validateManifest` 会报。
- 清单现在是**空的**：赛道、车、地面纹理全是程序化生成的，一个字节都不用下载。
  这套管线是给以后换真模型准备的，加一条就自动进分批加载和进度条。
- rapier（2.8MB）是动态 `import`，首屏 JS 只有 ~580KB。静态引的话这几兆要下完才轮到
  第一行 JS 跑，加载界面根本来不及出现。
- 三个解码器的接线（`decoders.ts`）**现在是断开的**。`KTX2Loader` / `DRACOLoader` 里的
  转码器路径是 `new URL(..., import.meta.url)` 写的，打包器只要**看见**那句 `import()`
  就会把 basis / draco 的 wasm 产出来（1.8MB），不管运行时会不会执行到 —— 动态 import
  也救不了。清单空着的时候这 1.8MB 就是纯死重，所以断开；加第一条资源时按
  `decoders.ts` 顶上的说明接回来。`AssetLoader.test.ts` 读源码钉着这个双向约束：
  清单空却接了线、或者清单非空却没接线，测试都红。
- 进度条按**加权任务**记账（`LoadProgress`），不只算下载量：wasm 编译和赛道网格挤出
  也是实打实的几百毫秒，只算下载会出现"100% 之后再黑屏两秒"。

### iOS Safari 专项

- **音频**：`AudioContext` 必须在用户手势的事件处理函数里创建/恢复，还得真的播一个
  1 帧的空 buffer 才算解锁。不这么做的话之后播什么都是静音，而且不报任何错。
- **上下文丢失**：监听 `webglcontextlost` 并且**必须 `preventDefault()`** ——
  不拦下来浏览器根本不会尝试恢复。恢复前主循环要停掉。
- **竖屏**：触屏模式下竖屏盖一层"请横屏游玩"，同时把主循环停掉。
- **安全区**：`viewport-fit=cover` + 所有 UI 用 `env(safe-area-inset-*)` 让开刘海和
  小白条。不写 cover 的话 iOS 自己留白边，横屏时左右各黑一条。
- **手势**：`user-scalable=no` 在 iOS 10 之后被 Safari 无视了，真正拦住缩放的是
  `installGestureGuards()`（`gesturestart` + 300ms 内的第二次 `touchend` + `touchmove`）。

### 帧率自适应

`FrameMonitor` 盯最近 60 帧的平均帧时，持续低于目标就建议降一档，主循环照办并弹一句
提示。三个防误判的设计缺一不可：开头几秒 warmup 不算（着色器还在编）、
单帧毛刺丢掉（切标签页回来会有个几秒的巨帧）、降完有 cooldown（降档本身会引起一波
卡顿，不冷静一下会连降到底）。判据留了 5% 容差 —— 刚好压在 30fps 上的机器是达标的。

调试用 URL 参数：`?quality=low|medium|high|auto`、`?input=touch|keyboard`，不写回存储，
手机上扫个二维码就能直接进低画质。

## 视觉打磨

### 车模型：两种形态，外面看不出区别

`KartView` 有占位车（十几个 Box 按材质合并成 6 个 drawcall）和 glTF 模型两种形态，
`setModel()` 换。模型是**边玩边下**的：先拿占位车开着，下完了无缝换上，
不为了等一个模型把加载界面多顶几秒；下不到（现在就是）就一直用占位车。

模型的导出约定写在 [`src/render/kartRig.ts`](src/render/kartRig.ts) 顶上：
车头朝 `+Z`、轮子贴地 `y=0`、轮子节点名带 `wheel`、可换色的材质名带
`body`/`accent`/`trim`/`suit`。名字对不上也不会崩，只是轮子不转。

轮子建 rig 时会**从车身子树里摘出来**挂到根节点上（世界变换保持不变）——
车身要侧倾，轮子得一直贴着地，挂在车身下面的话车一歪四个轮子就跟着离地了。
每个轮子外面再套一层 pivot：pivot 转 y 是转向，子对象转 x 是滚动，两个旋转互不干扰。

换配色**不克隆整套材质**。最省事的写法是 `mesh.material = mesh.material.clone()`
然后改 color，但那样每辆车都会多出一整套材质：材质各不相同 = 每份都要单独编译一次
着色器，也再不可能被合批。这里换成按 `(原材质, 颜色)` 查表（`TintCache`），
同色的车共用同一份材质，而且和模型里有多少个 mesh 无关。有测试钉着这条。

### 天空、环境光、雾：三个颜色必须是一个

低多边形模型的背光面如果只剩一个常数环境色，整台车会像一张贴纸。所以
`SkyEnvironment` 生成一张 PMREM 环境贴图挂到 `scene.environment` 上，背光面就带上了
天空的蓝和地面的反光。来源有两个、接口一样：程序化渐变天空球（默认，不占一个字节的
下载量）或者 HDRI（`public/hdri/`，下不到就退回渐变的）。

**雾色 == 天空地平线色 == 地面远处的颜色**，对不上远处就会出现一条硬边。
所以颜色表在 `SkyEnvironment` 里，`World` 从 `sky.fogColor` 取雾色，不许各写各的。

半球光和环境贴图是同一件事的两种做法（都在补背光面），强度**此消彼长**：
有环境贴图的档位把半球光压到 0.35，没有的（low 档）拉回 1.15。两个都开满的后果是
过曝，ACES 会把它压回来，代价是颜色全部发灰 —— 卡通风格最怕这个。

主光源是午后的角度（仰角 34° 左右、偏暖），影子拉得够长能看出立体感，
又不至于像黄昏那样长到糊住整条赛道。

### 后处理：一个 pass，不是四个

用 pmndrs 的 `postprocessing` 而不是 three 自带的 `EffectComposer`，理由只有一个：
**合并 pass**。自带的那套是一个效果一个全屏 pass，bloom + SMAA + tonemapping + 暗角
就是四次全屏读写；`postprocessing` 把所有 Effect 编译进**一个** `EffectPass` 的片元
着色器里，全屏读写只发生一次。1080p 下能省两三毫秒，移动 GPU 上更多（它们卡的从来
不是算力，是带宽）。

三档：`full` = bloom + SMAA + 暗角 + ACES；`bloom` = 去掉 SMAA；`none` = 完全不建
composer，直接画到屏幕。low 档为什么不是"建一个只有 tonemapping 的 composer"：
composer 意味着先画进一张 half-float 的 RT 再拷回屏幕，这一次全屏拷贝在移动 GPU 上
是实打实的带宽开销。

两个容易踩的点：

- **tonemapping 的归属跟着档位换手**。开 composer 时由 `ToneMappingEffect` 做，
  这时 `renderer.toneMapping` 必须是 `NoToneMapping`，否则一帧被 tonemap 两次，
  画面发灰发平；不开 composer 时反过来。`PostFx.setQuality` 每次都会摆平这件事。
- **中间缓冲必须是 half-float**。bloom 要在 tonemapping **之前**取高光，
  8bit 缓冲里超过 1.0 的亮度早就被截断了，阈值再怎么调也挑不出东西来。

bloom 的阈值定在 0.85，只让本来就很亮的东西溢出（火花、道具箱的自发光、太阳）。
卡通风格最忌讳整个画面糊着一层光。

### 粒子：一个池子一个 drawcall

火花、扬尘、爆闪全部走同一个 `ParticlePool`。三条设计约束：

1. **粒子存世界坐标，所以全场共用一个池**。每辆车各一套火花和扬尘就是 16 个
   drawcall，而 low 档总预算才 150 个。粒子既然是世界坐标的，谁发射的对渲染来说
   毫无区别，合并是白赚的。用法是"每辆车 `emit` 一次，每帧 `step` 一次"。
2. **全程零分配**。容量构造时定死（typed array 建好不能改大小），发射是覆盖最老的
   一颗（环形游标），`spawn` 的参数走一个复用的描述对象 —— 每帧几百次 `{...}`
   是实打实的 GC 压力。
3. **每颗粒子有自己的大小和透明度**，所以用 `ShaderMaterial` 而不是 `PointsMaterial`
   （后者的 size 是整个材质一个值）。扬尘要"边飘边变大变淡"、火花要"越飞越小"，
   没有 per-particle size 就做不了。

`gl_PointSize` 里带上了 `projectionMatrix[1][1]`（= `1/tan(fov/2)`），
而不是照抄 three 内置的那套：boost 时相机 FOV 会被推出去十几度，不带这一项的话
粒子的屏幕大小不跟着变，看着像粒子突然被拉近了。

自己写 `ShaderMaterial` 时有两个坑，都踩过：用 `color` 属性要开 `vertexColors`
（否则着色器里根本没有那个 attribute，直接编译失败）；吃雾要把
`THREE.UniformsLib.fog` **合并进 uniforms**，只写 `fog: true` 会让 three 的
`refreshFogUniforms` 读到 `undefined` 直接抛 —— 表现是白屏加一条堆栈里完全看不出
出处的报错。

特效一共只吃 5 个 drawcall（火花 / 扬尘 / 爆闪 / 拖尾 / 假阴影各一个），
**和场上有几辆车无关**。boost 拖尾也是这个思路：所有车的飘带在同一个几何体里，
每辆车固定占一段顶点区间。

### 相机

在弹簧跟随的基础上加了三件事，都是为了强化"我开得很快 / 我在过弯"的主观感受，
而车的实际物理一点没变：

- 速度相关的距离和 FOV（原来就有），boost 起步时 FOV 短促推一下再自己回落；
- **漂移时相机往弯外侧平移**。玩家能看到弯内侧更多路面，主观上会觉得车转得更急了；
- **撞击时的屏幕震动**。三个互质频率的正弦叠出来的，不是每帧随机 ——
  随机数在高帧率下会糊成一片抖动，看着像画面撕裂而不是"被撞了一下"。
  幅度默认压到 16cm：这是最容易做过头的一件事，大一点就从"有打击感"变成"晕"。

## 音效

全部走 `AudioManager` 一个入口（Howler），上层只说"播 boost"，不碰 `Howl`。
两条总线（sfx / music）各有自己的音量，再乘一个总音量，外加静音开关，三个值都存
localStorage。

**加一个音效 = 往 [`SoundDefs.ts`](src/audio/SoundDefs.ts) 的表里加一条**，
别处不许写 `if (soundId === ...)`：音量、循环与否、走哪条总线、同时发声数上限
全是表里的字段。和道具表是同一个路子。

### 没有音频文件也能出声

`public/audio/` 下现在一个文件都没有。最省事的做法是静音，但那样整套音频系统就没法
验 —— 引擎声的音高有没有跟上速度、蓄力音有没有分档、音量开关有没有生效，全都看不
出来。所以 [`synth.ts`](src/audio/synth.ts) 会现场合成一份占位音：一段参数描述
（波形、频率、扫频、泛音、噪声、包络）渲染成 WAV 的 data URI，喂给 Howler 的接口和
真文件完全一样。加载失败就换合成音，把真文件放进 `public/audio/` 就自动切回去。

这个文件是纯函数（不 import Howler、不碰 DOM、噪声走带种子的 PRNG），有测试。
循环音的时长会被凑成**整数个周期**并且不做包络，否则每循环一次接口处就"啪"一声。

### 三条循环音

引擎、漂移摩擦、蓄力是**一直在播**的，靠音量和音高表达状态，不反复启停 ——
移动端每次 `play()` 都有几十毫秒延迟，启停的漂移声会碎成一片。

- 引擎：一个低频锯齿 + 6 个泛音的循环音，`rate` 从 0.75 拉到 2.35 跟着速度走，
  boost 时再拔高一点，腾空时音量减 40%（轮子不着地，引擎空转）；
- 漂移摩擦：音量跟着速度；
- 蓄力：音高按档位跳一级（纯五度往上叠，1 : 1.5 : 2.25），还没成档时用最低档的
  音高、音量减半。

撞墙没有专门的事件，是从"横向偏移顶到可行驶半宽"推出来的，留了 0.15m 余量
（`kartStep` 把车推回来之后 lateral 会正好卡在边界上，严格相等会在贴墙行驶时反复
触发）。撞车只数**玩家**的接触对数，不数全场的 —— 八辆车互相挤的时候全场对数一直
在跳，拿它驱动音效和震动的话，玩家会在完全没被碰到的时候被晃一下。

### 解锁

iOS/Chrome 只允许在**用户手势的事件处理函数里**启动音频，不这么做 context 会一直是
`suspended`，之后播什么都是静音而且不报任何错。所以 `AudioManager.init()` 必须在点击
的调用栈里同步调 —— 主菜单的"开始比赛"那一下正好是。另外兜两层底：后续手势再
resume 一次、切回前台时 resume（iOS 会在切后台时把 context 挂起）。

## 主菜单 / 赛道选择

菜单排在**所有重活前面**：赛道网格、rapier 的碰撞体、环境贴图全都是按选中的那条
赛道建的，先建就白建了。顺带解决了音频解锁 —— "开始比赛"那一下就是那个手势。

三条赛道在 [`TrackCatalog.ts`](src/track/TrackCatalog.ts) 里，纯数据。
**加一条赛道 = 往表里加一条**（控制点 + `TrackConfig` + 道具箱位置 + 圈数）。
控制点都是用"半径随角度变化的星形"生成再取整的（星形保证不自交），
`TrackCatalog.test.ts` 会验不自交、坡度、最小曲率半径、相邻控制点间距和道具箱是不是
落在柏油上 —— 自交的赛道跑起来只表现为"进度突然跳一大截"，肉眼很难当场看出来。

最小曲率半径这个数决定了赛道的性格：满速时普通转向的转弯半径约 30m，所以
草原环线（62m）全程不用松油门、黄昏赛道（33m）是临界、山脊长道（24m）好几个弯必须
减速或者漂过去。

| 赛道 | 长度 | 路宽 | 最小曲率半径 | 圈数 |
|---|---|---|---|---|
| 草原环线 | 850m | 20m | 62m | 3 |
| 黄昏赛道 | 1010m | 17m | 33m | 3 |
| 山脊长道 | 1200m | 15m | 24m | 2 |

**换赛道是重载页面**（`?track=` 或者结算面板上的按钮）。赛道网格、rapier 碰撞体、
发车格、AI 的赛道采样器全是按那条赛道建的，运行时换等于把整个世界拆了重搭；
重载几秒钟就完事，而且加载界面本来就在，比维护一套"拆干净"的代码可靠得多。

画质档位在主菜单里也能改，因为**对手数量在开局时就定死了**（高 7 / 中 5 / 低 3），
进游戏之后再改档位对手也不会跟着变。

纪录是**每条赛道一份**的：850m 的草原和 1200m 的山脊圈速没有可比性，共用一个键的话
跑一次长道就把短道的纪录永久顶掉，而且再也破不了。

## UI 风格

所有界面的颜色、圆角、阴影、字体从 [`theme.ts`](src/ui/theme.ts) 的令牌取，
**不许再硬编码一个 `#4d9bff` 或者 `border-radius: 12px`**。和 `QualityTiers` 是同一个
道理：想统一风格就改一处。

两个具体决定：

- **描边字不是投影字**。赛道是明亮的浅色（天蓝 + 草绿 + 白色路肩），纯投影在浅底上
  几乎看不见，白字直接糊进背景里。描边（八个方向的 `text-shadow` 拼出来的）不管底色
  深浅都能把字抠出来，而且正好是卡通风格该有的样子。用 `-webkit-text-stroke` 不行：
  它的描边是压在字身上的（往里吃掉一半笔画），小字号下会糊成一团。
- **不下载任何字体文件**。`ui-rounded` 在苹果系统上就是 SF Pro Rounded，其它平台按栈
  往下退。为一套 UI 拖一个几百 KB 的 webfont 不值 —— 首屏预算总共才 10MB，
  而且字体是阻塞渲染的。

名次是整块 HUD 里最大的一个数字，字号压过速度表：它是"我现在打得怎么样"的唯一答案，
应该扫一眼就看到。

## 下一步

- 真正的护栏碰撞体（现在是按横向偏移拉回来的）
- 分屏 / 联机（`RaceState` 的接口已经是按多车写的）
- 赛道主题（不同赛道换一套天空颜色和装饰物，`SkyColors` 已经是参数了）
