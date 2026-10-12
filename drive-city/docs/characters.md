# 人物写实化

日期：2026-10-12。起因：主角和 NPC 太抽象（老K是程序生成的人体，像服装店模特；陈野是超级英雄身材的占位模型，衣服像充气的）。用户选定**写实路线**。

## 方案

用 Blender 的 **MPFB 插件（MakeHuman）** 批量生成人物：
- 可调东亚面孔，年龄、胖瘦、身高、脸型（上百个形态目标）都能调。
- 有皮肤贴图、发型、眉毛、睫毛、眼睛、衣服、鞋，绑好骨骼。
- 能用 Python 脚本驱动，接进现有的"Blender 脚本 → glb → 游戏"流水线。

授权：插件本身是 GPL，只在本机用来生成，不进游戏；生成出来的人物和 MakeHuman 素材包都是 **CC0**，可以随游戏发布。

骨骼用 MPFB 的 `game_engine` 骨架，骨骼名和虚幻引擎一致（pelvis、spine_01、upperarm_l……），现有的主角动作驱动（`character/hero/Hero.ts`）直接能用，只有头骨的大小写不同（`head`/`Head`）。

## 流水线

```sh
# 一次性：在项目自己的 Blender 配置里装 MPFB 和素材包（不碰你自己的 Blender）
export BLENDER_USER_RESOURCES=$PWD/.cache/mpfb/user
/Applications/Blender.app/Contents/MacOS/Blender -b --command extension install-file -r user_default --enable mpfb.zip
#   mpfb.zip: https://extensions.blender.org/add-ons/mpfb/ （2.0.18）
#   素材包 makehuman_system_assets_cc0.zip（267 MB）解压到 .cache/mpfb/user/extensions/.user/user_default/mpfb/data/

# 每个人物：按 scripts/characters/cast.json 里的描述生成，再压缩进游戏
/Applications/Blender.app/Contents/MacOS/Blender -b -P scripts/blender/characters/mpfb_char.py -- \
  --cast scripts/characters/cast.json --id chenye --out .scratch/chars/chenye.glb [--blend .scratch/chars/chenye.blend]
node scripts/characters/pack.mjs .scratch/chars/chenye.glb public/models/characters/chenye.glb
```

`cast.json` 里每个人物写：体型（性别、年龄、肌肉、胖瘦、身高、比例、人种）、脸型目标（`head-square`、`chin-width-incr`、`lr-eye-bag-incr`……，`lr-` 表示左右成对）、皮肤、发型、眉毛、衣服。

压缩（`pack.mjs`）：
- 皮肤贴图 1024，其余 512，全部转成 WebP；网格用 meshopt 压缩。
- 材质修正：Blender 把所有材质都导出成半透明，three.js 会把嘴里的牙齿画到脸上面。所以改成身体、衣服、眼睛不透明，头发、眉毛、睫毛用透明裁切。
- 去掉牙齿：嘴不张开时用不着，能省 7000 个三角面。
- 眼睛：MakeHuman 的"棕色"虹膜偏红，游戏距离下看着像红眼，压成深褐色。
- 高精度眼球带一层角膜壳，改成不透明后眼睛变黑，所以改用单层眼球。

游戏里（`character/Cast.ts`）：`?cast=1` 时主角换成陈野；熟人有模型的（目前老K）由自己的模型画，同样由步态驱动，70 米外换回人群里的低模。

## 动画片段（AnimationMixer，2026-10-12）

用户从 Mixamo 下载了 5 个动作（FBX，Without Skin，走/跑勾选 In Place）放在 `assets/anims/mixamo/`：idle、walk、run、sitting_idle、talk。

```sh
# FBX -> 每个动作一个 glb（只有骨架和一段动画），再压缩（只留旋转和胯部位移，重采样，meshopt）
/Applications/Blender.app/Contents/MacOS/Blender -b --factory-startup -P scripts/blender/characters/anims.py -- \
  --src assets/anims/mixamo --out .scratch/anims/out
node scripts/characters/pack-anims.mjs .scratch/anims/out public/models/anims     # 5 个共 276 KB
```

- **重定向**（`character/Clips.ts`）：加载时把 Mixamo 骨架上的动画"烘焙"到每个人物自己的骨架上（MPFB 的 `game_engine` 骨架），所以一套动画所有人通用，不用为每个模型重新导出。
  - 每根骨骼取源骨骼在世界空间里"相对静止姿势的转动"，加到目标骨骼的静止姿势上。
  - 但会先把源的 T 字静止姿势逐骨对齐到 MakeHuman 的 A 字姿势（按骨骼指向下一根骨骼的方向）。
  - 头部例外：保留自己的静止朝向。否则 MakeHuman 脖子比 Mixamo 前倾 30°，所有人的脸都会仰天。
  - 胯部位移按两者胯高比例缩放；再让整段动画里最低的脚底点落在站立时的高度（不然脚陷地 3 厘米）。
  - 同时测出走、跑动画原地踏步的速度（着地脚往后滑的速度）：走 1.53 m/s，跑 3.85 m/s。
- **播放**（`Hero.useClips`）：每个人物一个 `THREE.AnimationMixer`。
  - 站、走、跑按移动速度混合；走和跑共用一个步伐相位，播放速度按"着地脚速度 = 移动速度"调节，防止滑步。
  - 动作切换在 0.12 秒内交叉淡入淡出。
  - 没有动画片段的动作（推人、骑车、摔倒、挥手、喝茶等二十多种）继续用程序步态，和片段之间 0.15 秒过渡。
  - 坐着的动作：骨盆和腿用步态（凳子高度、脚的位置），上半身用片段。
- **数据**：`public/models/characters/cast.json` 写人物文件、发色、动画片段列表（`clips`）和"哪个动作播哪个片段"（`actions`）。全局默认，每个人物可覆盖；代码里没有模型和动画路径。
- 实测：
  - 主角小跑（3.56 m/s）时着地脚滑动中位数 0.36 m/s，冲刺（6.3 m/s）时 0.35 m/s；脚底贴地。
  - Mixamo 的 Sitting Idle 是靠在椅背上的姿势，老K坐的是无靠背小凳，会往后仰进身后的垃圾桶。所以凳子类动作（喝茶、下棋）先保留程序步态，等补一个"坐凳子"动画。
- **第二批动作**（同日，用户又下载了 6 个）：sit（凳子坐姿，手放膝上）、wave（举右手招手）、talking_on_phone（右手贴耳，取 2.8–36 秒循环）、punch（拳架加左拳刺出，取 0.3–0.8 秒给推人用，腿保持步态）、fall_back_death（向后倒地，取 0.15–2 秒、1.2 倍速，锚定起点，躺地时停在最后一帧）、getting_up（从仰卧起身，取 2.2–6.1 秒、1.6 倍速，锚定终点即站回原地）。
  - `cast.json` 的片段可以写成 `{file, range, speed, loop, anchor}`，动作可以写成 `{clip, legs: "gait"}`。
  - 连续的动作用同一个片段时不重播（被撞飞 → 躺地都用 fall）。
  - 模型有自己的起身片段时，路人（people/）和玩家（OnFoot）的起身时间按它来（`CharacterModel.getupSecs`，现为 2.4 秒；否则 0.9 秒）。
  - 原始 FBX 不进仓库（`.gitignore` 的 `/assets/anims/`），游戏用转好的 `public/models/anims/`（10 个共约 980 KB，其中打电话 439 KB）。
  - 喝茶、下棋仍用程序动作（端杯、走棋）。
- 测试：
  - `Clips.test.ts`：四个片段重定向后四肢方向和源一致（< 1°），脊柱 < 3°，头部转动和源相差 < 3°，脚底不陷不飘，原地速度在合理范围，经过步态播放无 NaN。
  - 探针：`.scratch/chars/closeup.mjs`（主角站、走、跑）、`laok.mjs`（老K坐、说话、走）、`slide.mjs`（滑步和脚高）、`retdbg.mjs`（逐骨比较源和目标）。
- 材质（`Hero.ts` 的 `physical`）：换成 `MeshPhysicalMaterial`，按类型调参。
  - 皮肤：偏暖的 sheen，模拟耳朵、脸颊边缘透光。
  - 头发：sheen 高光带，透明裁切双面。
  - 眼睛：清漆层，带湿润高光。
  - 衣服：布料 sheen。
  - 鞋：微光泽。

## 试验结果（2026-10-12）

| | 旧 | 新（MPFB） |
|---|---|---|
| 陈野 | 2.6 MB，Quaternius 占位，超级英雄身材 | 0.53 MB，3.0 万三角面 |
| 老K | 程序人体，无贴图 | 0.73 MB，3.8 万三角面 |
| 第一章开场画面（high） | 603 draw call，194 万三角面 | 614 draw call，214 万三角面 |

- 骨骼接上了：走路、坐着喝茶、打电话的动作都能驱动新模型。之后站、走、跑、说话改用 Mixamo 动画片段（见上）。
- 已知不足：
  - 脸型还偏普通、偏嫩，需要逐个精调。
  - 头发是透明裁切，边缘发硬。
  - 老K的灰发上色不明显（原贴图太深）。
  - 没有表情和口型。

## 后续步骤

1. 精调陈野和老K的脸，确定一个满意的标准（必要时自己画皮肤细节贴图：胡茬、皱纹）。
2. 其余熟人：小雨、大刘、王队、老张、刘姐、小飞龙，加反派豹哥。每人设计专属的脸、发型和衣服，衣服颜色在 `cast.json` 里改。
3. 对话框头像改成模型脸部的渲染截图。
4. 补动画：坐凳子、挥手、推人、打电话、摔倒爬起等，补一个就在 `cast.json` 的 `actions` 里加一行。
5. 让人"活"起来：说话时嘴巴随配音音量开合（MPFB 带面部表情目标，可以导出成少量形变）、眨眼、看向说话对象；过场时给人物打主光和轮廓光。
6. 路人：生成 8–12 个基础人体（男女 × 青中老年）加几套换装，替换 22 米内的近景人群模型。远景继续用现在的程序人体，保证手机性能。
7. 默认打开（去掉 `?cast=1`），测手机帧率和下载大小。
