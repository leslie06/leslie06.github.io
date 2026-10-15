# b城追车 / B CITY CHASE（目录：drive-city）— 北京背景的 GTA 式开放世界（three.js）

设计文档：https://claude.ai/code/artifact/f84d740e-9e09-4de4-8d47-41c433772ad6（里程碑 M0–M5）。计划文档：`docs/gta-plan.md`（剧情任务，没有枪）、`docs/characters.md`（写实人物管线和人物标准）、`docs/melee.md`（徒步近战）、`docs/open-world-play-design.md`。

现状：M0 车辆沙盒完成（操控评审 7.0/10）；M1–M3 完成（按 OSM 还原北京到四环、分块流式加载、交通、抢车、行人）；M4 进行中——警察、地图/GPS、任务已完成，当前在做剧情战役（`campaign/`，第一至四章已完成，见 `docs/gta-plan.md` §5–8）和近战（`combat/`）。默认 `?world=city`；其他值（如 `?world=yard`）进入 M0 沙盒，只有沙盒里注册了 `ui_hud` / `ui_menu` 两个 pose。

**详细笔记在 `docs/notes/`**（从本文件原样搬过去的：每个功能的设计、数字、坑和 probe 命令，带日期，「」里是用户的原话）。动某块之前先读对应文件；新的细节写到那里，不要写到这里——本文件只放每次会话都需要的内容。

| 文件 | 内容 |
|---|---|
| `vehicles.md` | 九种车身、Blender 车辆/摩托管线（`car.py`、`import.mjs`、`pack.mjs`）、两轮车、电动车、撞击顿帧、车损 |
| `render.md` | 路灯光照图、Blender 行道树及变体、一帧的开销分布（`budget.mjs`）、车辆视锥剔除 |
| `street.md` | 近处路灯和信号灯杆、护栏 LOD、街道设施、屋顶杂物、撞飞街道设施、路灯/候车亭避开车道、沿街店面 |
| `city-data.md` | OSM 数据源（pbf + osmium）、区域和走廊、机器学习建筑轮廓与高度、住宅类型、树冠与绿地、指路标志、挡路建筑、建筑下穿通道 |
| `roads-elevation.md` | 立交与高程模型（含各种坑和审计脚本）、过街天桥、地铁口、铁路、大院围墙、河道、下穿隧道、死胡同、可通行性普查 |
| `traffic.md` | 车道图、每个路口的红绿灯、单行道尽头卡死、火车、公交进站、路边停车、远景车流（ghost） |
| `people.md` | 人群身体、主角模型、行人与密度、热点和站立人群、写实 MPFB 人物和动画、近战、徒步下陷 |
| `police.md` | 通缉/目击者报警、GTA 式追捕、直升机、特警 |
| `nav-map.md` | 寻路、GPS 转向提示、地图标注（`Labeller`）、地图上的地铁 |
| `gameplay.md` | 电台、开局逃亡、战役框架与第一章、氮气/连击/车库/出租车、特技坡道、断桥飞跃、兔儿爷、街头事件、地下车库、胡同捷径、短信剧情、排行榜、地标打卡、计时赛、短任务、玩法 probe |
| `npc.md` | 脚本 NPC、对话框、配音（CosyVoice 录制管线、VoiceManager）、街头遭遇、按时间的街头生活、熟人和好感度福利 |
| `online.md` | 玩家反馈（`/fb`）、在线人数 |
| `home-park.md` | 我家别墅（楼梯、大门、车道的坑）、欢乐谷游乐设施和过山车 |
| `landmarks.md` | Blender 地标管线（`import.mjs`、`Glb.ts` 命名约定、Blender 插件）、楼梯/挡车块、每个地标和每批次 |
| `hosting-phones.md` | 静态托管第 1-5 轮（启动下载量和时间）、加载进度条、手机分辨率、触屏操作 |

## 技术栈
- Vite 8 + TypeScript（strict）、three r185、@dimforge/rapier3d-compat 0.20。开发服务器：`npx vite --port 5195 --strictPort`。类型检查：`npx tsc --noEmit`。测试：`npx vitest run`。
- `npm install` 必须加 `--legacy-peer-deps`（npm 10 的 arborist 处理 vitest 的可选 peer 依赖会崩）。
- 运行时不从网络拉内容：贴图用 canvas 画（`world/Textures.ts`）或是项目自带文件，声音是 Web Audio 合成（`audio/`）加 `public/voice/` 里的录音。联网的例外（`online/`：排行榜、反馈、在线人数，都走统计服务）从不阻塞任何东西；在开发服务器和 shot mode 下默认关闭，除非传 `?lb=<base url>`。

## 架构（src/）
- `core/` — 从 gunFight 拷来精简过：Engine（固定 60 Hz `fixedUpdate` → `physics.step()` → `postStep`，然后每帧 `update(dt, alpha)`）、Input（GTA-V 键位 + 手柄 + `Input.touch`）、Physics（Rapier；碰撞组 `CG.WORLD/CAR/PROP/PED`）、Quality（low/medium/high 三档）、分辨率调节器、I18n（中/英；屏幕上每个字符串都走 `t()`）、Assets.compact、`Retry.ts`、`Boot.ts`（加载进度条）。
- `game/Contracts.ts` — 唯一的跨模块接口（VehicleApi、CameraApi、WorldApi、HudApi……）。只能增量扩展。
- `main.ts` 启动顺序：render → world（yard 或 city）→ vehicle → player → traffic → people → police → nav → missions → races → park → home → garage → underground → stunts → collect → checkin → trials → intro → events → leaderboard → story →（campaign、combat、npc、life、contacts……）→ fx → audio → ui。`install()` 里只能 `engine.get` 比自己早的模块；更晚的模块在运行时惰性获取。只属于城市的模块在 yard 里跳过。
- 模块一览：`vehicle/`（Rapier 刚体上的射线车，自带轮胎模型；`Spec.ts` 调校参数、`ControlFilter`、`Autopilot` 的 PathPilot、`CarKit` 实例化车涂装）、`world/`（沙盒场地）、`render/`（天空/时间 `?tod=`、`?rain=`、CSM 阴影、后处理链、`Lighting` 材质补丁、路灯）、`city/`（OSM 分块、worker 建网格、流式加载、地标在 `city/landmarks/`、可视层在 `city/visual/`）、`traffic/`、`parking/`、`player/`、`character/`、`people/`、`police/`、`nav/`、`ui/`、`missions/`、`campaign/`、`combat/`、`npc/`、`life/`、`contacts/`、`dialogue/`、`voice/`、`story/`、`stunts/`、`collect/`、`checkin/`、`trials/`、`events/`、`garage/`、`home/`、`park/`、`underground/`、`damage/`、`audio/`、`online/`。
- 材质用 `userData.wet = 'ground' | 'surface' | true` 开启湿润效果；`uniforms.uNight` 驱动灯和窗户；`RenderSystem.prepare(root)` 在流式加载的分块加入场景前打补丁。

## 重建城市（改了 `scripts/city/` 或 OSM 数据之后）
- `node scripts/city/extract-pbf.mjs`（需要 `brew install osmium-tool`；改了它的过滤条件后要删掉 `.cache/osm-pbf/filtered.osm.pbf`），然后 `node --max-old-space-size=12000 scripts/city/build.mjs`（约 65 秒；末尾会自动跑 signs、entrances、footbridges、railways、tunnels、shelters、metro、places、sites、netpack 这些步骤）。
- **重建后必须重启 Vite 开发服务器**：它可能对改写过的 `public/city/*.json` 返回 `index.html`（报 `SyntaxError: Unexpected token '<'`）。
- 不要随便重跑 `Spots.gen`（会挪动所有坡道、打乱存档进度编号）。改了任何城市图层后，重跑 `jumpprobe`、`shortcutprobe`、`underprobe`（在 `.scratch/`）；改了道路或桥面还要跑 `roads-elevation.md` 里的审计脚本。

## 到处都会踩的坑
- **瞬移车辆或手动 tick 的 probe 测不出真实帧循环里的 bug。** 单行道尽头的游戏卡死、开局卡在「准备中」、别墅车道和大门卡车，用这种 probe 都没发现。玩家报告的问题，一律从标题画面开始跑真实帧循环来测（参考 `introlive.mjs`、`homefreeze.mjs`、`nightreal.mjs` 的写法）。`stepFixed` 不会跑 `update`，也不会调 `input.poll()`。
- shot mode（`?shot=1`）会关掉很多系统（story、campaign、npc、life、standers、contacts、打卡、intro、延后加载的内容），要用得传对应参数（`?campaign=1`、`?contacts=1`、`?checkin=1`……）。
- 普通开发服务器上跑长时间 probe 时不要改 `src/`（HMR 会在中途重载页面）；长测用 `FROZEN=1 npx vite --port 5198`，改代码或重建城市后要重启它。
- `world.contactPairsWith` 返回的是 broad-phase 配对：说"碰到了"之前要确认 manifold 里真有接触点。
- `render/Lighting` 串联 `onBeforeCompile` 钩子，并在第一次打补丁时冻结材质的 program key——永远不要覆盖钩子（否则人群全部塌回绑定姿势），也不要事后改 shader define（会复用旧 program）。
- 人爬楼梯靠的是 walk-only 坡道（`walkOnly`）：用盒子拼的台阶能站不能走；而人能走的坡车也能开，所以坡道的碰撞过滤去掉了 CAR，另外再配一个只挡车的块（`CarStops`）。有楼梯的地标必须传 `colliders`。详见 `landmarks.md` / `home-park.md`。
- 地标的 footprint 只会删掉 OSM 建筑；树、路灯和街道设施要用 `clear` 区域（或 `streetClear`）清掉。
- Rapier 0.20 每步积分 4 个子步，靠每步冲量托住的刚体静止时会报 vy ≈ -0.375·g·dt（判断静止用水平速度）。冲量会立即改变速度：先收集所有车轮的力，再统一施加（见 `Vehicle.step`）。角色控制器会慢慢陷进巨大的碰撞体；`OnFoot.step` 用一条向下的射线把脚抬回地面。
- zsh 里 `for a in "8 -60"; do node probe.mjs $a` 只传了一个参数；probe 会拒绝非数字参数。
- 热路径性能：游戏里 `Matrix4.toArray` / `setMatrixAt` 比普通循环慢约 30 倍；`CarKit` 用 `put16`。热路径里每帧不分配内存。
- 提交不等于部署：统计服务器（`../stats`）要把 `worker.js`、`server.mjs`、`schema.sql` 拷上去并重启（见 `../stats/README.md`）。伪造心跳的 probe 绝不能指向线上服务器。
- 配音台词：改了要说的台词后，依次重跑 `scripts/voice/lines.mts` / `dialogue.mts`、synth、`dialogue-pack.mjs`（见 `npc.md`）。改 `assets/voice/lines.json`，不要改 `bcity/` 里那份。

## 操控测试（M0 验收）
- `npx vitest run` — `vehicle/Handling.test.ts` 在 Node 里无头运行（Rapier，<1 秒），用真实的 Vehicle 和真实的 ControlFilter 开车，结果写到 `.scratch/handling-report.txt`。Vitest 会隐藏通过用例的控制台输出：看报告文件。
- `TRACE=fig8|fig8key|powerdrift|park|slope|accel|brake|handbrake npx vitest run src/vehicle/Trace.test.ts` 把时间轨迹写到 `.scratch/trace-<name>.txt`。
- 评审循环：一个严格的操控评审子代理按 GTA-V 街机手感打分，必须 >= 7/10（第一轮报告和 probe 在 `.scratch/critic/`）。它发现的每个问题在 `Handling.test.ts` 里都有回归测试。
- 键盘转向（`ControlFilter` 的 `KEYBOARD`）是一阶滞后，不是速率限制器（速率限制器会让点按的平均效果约等于占空比的平方）；按住键时高速下转角会减小，这只有配合较慢的高速滞后（`tauFast` 0.3）才安全。`.scratch/sweep/keys.test.ts` 会扫这些参数。
- 一次只改一处，改完跑全套：修一个问题常常会让别的 probe 结果变化。

## 截图
- `node scripts/shot.mjs --poses all --out shots/rN [--hud] [--lang zh]` 渲染 `debug/ShotPoses.ts` 里的每个 pose（`?shot=1`，固定 dt，结果确定）。城市：`--world city`，额外参数 `--params "tod=22&rain=1"`。所有 pose 在同一个页面里跑，每个 pose 必须重置共享状态（`wanted.clear()`；重置车辆会把玩家放回车里）。`ui_*` pose 总是显示 HUD。

## 实测数据（M2 Pro，1600x900，城市出生点）
- high 约 324 次 draw call / 0.8M 三角形，low 约 140 / 0.34M；low GPU 约 7 ms，high 约 13.5 ms。固定步约 0.4 ms。
- `node .scratch/render/perf.mjs http://127.0.0.1:5195 high,low run "world=city"`；`node .scratch/tam/budget.mjs "fx,fy,fz>tx,ty,tz" [quality]` 按网格类别拆分一帧的开销；`node .scratch/soak.mjs 90 high` 查内存泄漏。GPU 同步的数字随机器负载波动很大：要对比就前后紧挨着跑。
- 慢网速下的启动：`MODE=play KBPS=100 node .scratch/bootbytes.mjs <url>`，被测的构建用 `node .scratch/serve.mjs` 提供（见 `hosting-phones.md`）。

## 约定
- 物理和玩法逻辑放在 `fixedUpdate`/`postStep`，画面放在 `update`（用 `alpha` 插值；`VehicleApi.renderPos/renderQuat`）。
- 重复的东西用实例化；刹车印和烟各只占一次 draw call。
- macOS 文件系统不区分大小写：不要建两个只有大小写不同的文件（`poses.ts` 曾覆盖掉 `Poses.ts`）。
- 新功能的说明：在对应的 `docs/notes/` 文件里加一条带日期的条目，「」里写用户原话，用中文写（代码标识符、命令保持原样）；只有跨模块的规则才写到这里。`docs/notes/` 里现有的英文笔记按需翻译：改到哪块功能，就把那块的条目顺手翻成中文。
- 提交信息用中文，前缀 `driveCity：`，用户要求时才提交。
