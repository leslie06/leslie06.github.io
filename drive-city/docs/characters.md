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

游戏里（`character/Cast.ts`）：主角是陈野，熟人用各自的模型，同样由步态驱动，70 米外换回人群里的低模。2026-10-12 起默认打开，`?cast=0` 换回旧的占位主角和人群低模（对比用）；陈野的模型下载失败时自动退回旧主角。

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

## 人物标准（2026-10-12 定稿，九个人）

每个人物在 `scripts/characters/cast.json` 里一条，生成和压缩都按这一条来，**不在游戏代码里写人物外观**。

```sh
# 一个人物：Blender 生成 + 烘焙遮蔽（约 20 秒），再压缩上色
.scratch/chars/build.sh chenye            # = mpfb_char.py + pack.mjs
# 只改了颜色（look）：不用重跑 Blender
node scripts/characters/pack.mjs .scratch/chars/chenye.glb public/models/characters/chenye.glb
# 九人对比照（游戏渲染器，脸、四分之三侧、全身正背）
node .scratch/chars/portrait.mjs out.png /models/characters/chenye.glb /models/characters/laok.glb ...
# 城里看熟人
node .scratch/chars/contacts.mjs outPrefix [laok,xiaoyu,...]
```

一个人物包括：
1. **体型**（`phenotype`）：性别、年龄（0.5 = 25 岁，0.8 ≈ 60，0.88 ≈ 70）、肌肉、胖瘦、身高；人种全部东亚。
2. **脸型**（`targets`）：每人 8–15 个形态目标，幅度 0.1–0.8。思路：先定脸的轮廓（`head-*`：方、长、圆、倒三角），再定下颌和颧骨（`chin-*`、`lr-cheek-*`），再定眼神（眉骨 `eyebrows-trans-down`、眼皮 `lr-eye-eyefold-down`、眼角 `lr-eye-corner2-up/down`），最后鼻子和嘴（嘴角下垂显凶，`mouth-laugh-lines-out` 显老）。老人加 `head-age-incr`、眼袋、法令纹。
3. **发型、眉毛、睫毛**：男性用稀疏睫毛 `eyelashes01`，女性 `eyelashes02`；眉毛按性格选粗细。
4. **衣服**：MakeHuman 衣服只有十几套，**同一套靠换色给不同的人**（见下）。
5. **`look`**（`pack.mjs` 在贴图上做，游戏里零开销）：
   - `skin`：MakeHuman 的亚洲人皮肤用的其实是浅肤色贴图，原软件靠着色器再染色，导出后会发白发粉。统一往 `#f2e2c8` 方向乘 50%，饱和度 0.65–0.85（老人的贴图偏红，压得更低），亮度 0.82–0.97（风吹日晒的人更暗）。
   - `hair` / `brows`：按贴图亮度乘目标色，所以能把深色头发变灰白（材质颜色只能变暗）。
   - `recolor`：按色相/饱和度/亮度的范围换色，保留布料的明暗和褶皱；同一张贴图上颜色相近的两件（T 恤和牛仔裤都是蓝的）用 `rects` 按贴图区域分开；`contrast` 小于 1 时把褪色牛仔的白斑压平。
   - 遮蔽：`mpfb_char.py` 在 Blender 里用 Cycles 把带头发、眉毛、眼球、衣服的整个人烘焙一张环境光遮蔽到皮肤 UV（`<out>.ao.png`），`pack.mjs` 乘进皮肤（强度 0.85）：眼窝、鼻翼、耳朵、下巴下、发际线、领口有了自然的暗部。**这是脸不再"平"的关键**，游戏里的屏幕空间 AO 太粗，照不出五官。
   - `detail`：从皮肤贴图自己的明暗高通滤波生成一张法线贴图（毛孔、皱纹），0.25（年轻）到 0.4（中老年）。
   - 眼睛：只把偏红的虹膜换成深褐，眼白保持亮（以前整张压暗，眼白发灰）。
   - `lashAlpha`：睫毛透明度，男性 0.6，女性 0.7–0.85。
6. **游戏里的材质**（`Hero.ts`）：头发两遍（先 0.5 裁切写深度，再半透明补发梢和发际线的软边）；眉毛、睫毛半透明混合（裁切会变成锯齿细线）；皮肤 sheen 0.3。

| 人物 | 设定 | 发型 | 衣服（换色后） |
|---|---|---|---|
| 陈野 | 28 岁前地下车手，瘦削、棱角 | short01 黑 | casualsuit05：黑羽绒服、红黑条纹衫、深靛牛仔 |
| 老K | 60 多岁，茶摊的"中间人" | short04 灰白后梳 | elegantsuit01：棕色西装、白衬衫、深棕皮鞋 |
| 小雨 | 22 岁，修手机的技术宅 | bob02 黑，斜刘海 | female_casualsuit01：藏青 T 恤、黑裤 |
| 大刘 | 38 岁，修车师傅，壮 | short01 黑 | worksuit01：藏青背带工装、白 T |
| 王队 | 45 岁，派出所 | short02 黑 | casualsuit01：浅蓝衬衫、藏青裤（像夏季警服） |
| 老张 | 70 岁，出租站老司机，瘦 | short01 灰 | casualsuit05：橄榄绿外套、深灰裤 |
| 刘姐 | 45 岁，煎饼摊 | ponytail01 黑 | female_casualsuit01：白 T、深灰裤 |
| 小飞龙 | 19 岁，飙车小子 | short03 染棕 | casualsuit04：红 T（黑标）、黑裤 |
| 豹哥 | 40 岁，黑豹帮头目 | short04 黑后梳 | elegantsuit01：全黑西装、黑衬衫、暗红领带 |

每人 0.46–0.68 MB、2.6–4.0 万三角面，九人共 5.1 MB。豹哥的模型做好了，但游戏里还没有他出场的位置（第二章起）。

**缺的素材**（MakeHuman 自带的 CC0 包里没有，需要另找或自己建模）：眼镜（小雨、老K原设定戴眼镜）、帽子（只有礼帽：大刘、王队、老张、刘姐原设定都戴帽子）、警服、夹克/卫衣/中山装、胡子（只能画在皮肤贴图上）、发髻。

## 试验结果（2026-10-12）

| | 旧 | 新（MPFB） |
|---|---|---|
| 陈野 | 2.6 MB，Quaternius 占位，超级英雄身材 | 0.53 MB，3.0 万三角面 |
| 老K | 程序人体，无贴图 | 0.73 MB，3.8 万三角面 |
| 第一章开场画面（high） | 603 draw call，194 万三角面 | 614 draw call，214 万三角面 |

- 骨骼接上了：走路、坐着喝茶、打电话的动作都能驱动新模型。之后站、走、跑、说话改用 Mixamo 动画片段（见上）。
- 已知不足（第一版；脸型、发色、肤色、边缘已按上面的标准解决）：
  - 没有表情和口型。
  - 发际线仍是头发卡片的硬边（后梳的 short04 最明显）。

## 后续步骤

1. ~~精调陈野和老K，定标准~~、~~铺开到其余熟人和豹哥~~（见"人物标准"）。下一步：补缺的素材（眼镜、帽子、胡茬贴图）。
2. 对话框头像改成模型脸部的渲染截图。
3. 补动画：坐凳子、挥手、推人、打电话、摔倒爬起等，补一个就在 `cast.json` 的 `actions` 里加一行。
4. 让人"活"起来：说话时嘴巴随配音音量开合（MPFB 带面部表情目标，可以导出成少量形变）、眨眼、看向说话对象；过场时给人物打主光和轮廓光。
5. 路人：生成 8–12 个基础人体（男女 × 青中老年）加几套换装，替换 22 米内的近景人群模型。远景继续用现在的程序人体，保证手机性能。
6. ~~默认打开~~（2026-10-12）。手机实测（模拟 iPhone 13 Pro，低画质，`.scratch/chars/phonecost.mjs "cast=0" "cast=1"`，步行站在老K桌边，画面里有主角和老K）：
   - 最初每帧多约 4 ms、30 个 draw call。拆开看：隐藏模型就回到原水平，换普通材质不省时间，开销在绘制次数和影子。
   - 低画质改为精简模式（`AuthoredOpts.lite`）：不画头发软边那一遍，头发不投影；眉毛、睫毛、眼球所有画质都不投影（太小看不出）。身体、衣服、鞋仍然投影，不然人会"飘"。
   - 之后五组平均多约 2 ms（12.7 → 15 ms，噪声 ±2 ms），只在步行且熟人在 70 米内时。
   - 下载：陈野 0.62 MB + 10 个动画约 1 MB，在开局之后后台加载，不拖慢进入游戏；每遇到一个熟人再多约 0.6 MB。
