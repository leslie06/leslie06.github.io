# Kart Prototype

马里奥赛车那种街机手感的卡丁车原型。Three.js + Vite + TypeScript。
现在有：一条程序化生成的闭合赛道（带起伏、路肩、护栏）、一辆贴地形跑的车、一个跟随相机。

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
| `R` | 回到起跑线 |
| `H` | 收起 / 展开调参面板 |

## 架构

```
src/
  kart/
    kartStep.ts        纯函数 stepKart(state, input, ground, config, dt)。不许 import three / rapier
    GroundSample.ts    地面探测结果的裸数字结构，外层算好喂进 stepKart
    KartConfig.ts      所有手感参数 + GUI 用的范围表
    kartStep.test.ts   含一条测试直接读源码断言没有 three / rapier / DOM 引用
  input/
    InputState.ts      中立输入意图 { steer, throttle, brake, drift } + InputAdapter 接口
    KeyboardAdapter.ts 键盘 -> InputState。以后加触屏摇杆只要再实现一个 Adapter
  core/
    FixedStepLoop.ts   固定步长累加器，物理 60Hz，渲染拿 alpha 插值
  track/
    TrackConfig.ts     赛道控制点（带 y）+ 宽度/路肩/护栏尺寸
    TrackSpline.ts     闭合 CatmullRom 中心线；getProgress 用 500 点预采样表查最近点
    TrackMesh.ts       沿样条挤出路面 + 路肩 + 护栏 + 裙边，顺带产出碰撞几何
  physics/
    PhysicsSystem.ts   只用 rapier 做 raycast：赛道 trimesh + 每帧一条向下的射线
  render/
    World.ts           地面网格 + 光照 + 参照物
    KartView.ts        Box 拼的占位车 + 纯视觉的侧倾/后仰/前轮转角
    FollowCamera.ts    弹簧阻尼跟随，速度越快拉得越远、FOV 越大
  ui/
    Hud.ts             DOM 显示速度和 FPS
    DebugGui.ts        lil-gui，三组参数全部实时可调
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

## 下一步

- 触屏摇杆（实现 `InputAdapter` 即可）
- 换 glTF 车模型（保证车头朝 `+Z`、轮子贴地 `y=0`，外面代码不用动）
- 圈速 / 计圈（`getProgress` 的 `t` 已经是现成的进度）
- 道具、人机对手
- 真正的护栏碰撞体（现在是按横向偏移拉回来的）
