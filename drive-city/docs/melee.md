# 徒步近战 v1（2026-10-12）

路线图（`docs/gta-plan.md`）第 2 步的第一块：拳脚连招、反击、帮派敌人 AI。不做枪，走《热血无赖》/《蝙蝠侠：阿卡姆》的节奏。

## 操作

| 动作 | 键盘鼠标 | 手柄 | 触屏 |
|---|---|---|---|
| 攻击（连招） | 左键 / E | B | 「推」键 |
| 反击 / 格挡 | Q / 右键 | LB | 「反击」键（徒步时出现） |

- **连招**：按一下打一拳，在上一招结束后 `CHAIN_GAP` 0.5 s 内再按就接下一招：刺拳 9 → 直拳 11 → 勾拳 14 → 踢腿 20（踢倒）。停顿超过 0.5 s 就从刺拳重新开始。
- **选目标**：在 `SEEK` 4.2 m 内挑人，优先摇杆（或面朝）方向。离得远就向前冲步，最多 `LUNGE` 2.4 m；打中的范围是 `REACH` 1.75 m、正前方 75° 以内。周围没人时，攻击键仍是原来的推人。
- **反击**：敌人蓄力时头上会出现红色闪烁的「Q」（触屏上是「!」），这时按反击，就用上勾拳打这个人：必中，伤害 28，打倒在地，hitStop 240 ms。没人蓄力时按反击是格挡：持续 0.55 s，只吃 25% 伤害。

## 敌人（`combat/Brain.ts`，纯逻辑，Node 可测）

- 状态有：approach、circle、close、windup、strike、recover、flinch、down、ko。
- 平时围成一圈，半径 2.4–3.4 m，绕着玩家来回挪动。
- **攻击令牌**：只有拿到令牌的人才会上前攻击，场上站着的人有 4 个以上时发两个。攻击过程：贴近 → 蓄力约 0.6 s（这就是反击窗口）→ 出拳 → 后撤 → 冷却 1.4–3.2 s。
- **蓄力和出拳时有霸体**：普通拳脚只扣血、打不断，只有反击或击倒能打断。所以狂按攻击键对付不了红标。
- 默认强度 `TOUGH`：70 血，每拳 8 点伤害。`brawl(.., {tough})` 按倍数调整：血量 ×tough，伤害 ×√tough，蓄力时间 ÷√tough。
- 打倒在地的敌人由 people/ 负责起身。血量归零就一直躺着。

## 系统（`combat/index.ts`，system `combat`）

- **生成敌人**：`CombatApi.brawl(x, z, n, {tough})` 用 people/ 的 `spawnActor` 生成 n 个帮派成员。他们是 `fair` 的（打他们不算犯罪），每个人由 `Actor.puppet` 驱动。如果已经构建 `thug1–3`（`cast.json` 里的黑羽绒服、黑 T 恤、黑衬衫），就用这些写实模型，否则用穿黑衣的人群身体。
- **返回值**：`{ done, end, actors }`。`done` 解析为三种结果：
  - won：全部 KO 后再过 1.2 s；
  - lost：玩家 WASTED；
  - fled：所有人都离玩家 60 m 以上。
- **清场**：KO 的人在 30 s 后清掉，或者离镜头超过 70 m 时清掉。
- **打击感**：
  - 命中时有 `engine.hitStop`：普通 55 ms，击倒 110 ms，KO 160 ms，反击 240 ms。
  - 命中时镜头会抖动。
  - 敌人的出拳会让玩家受击（`player.struck`）：踉跄后退，被踢倒时直接倒地。
- **事件**：`combat:hit`、`combat:swing`、`combat:ko`、`combat:counter`。音效（`audio/`）为这些事件合成拳头闷响、格挡声和挥空的风声。
- **HUD**（`combat/Hud.ts`）：20 m 内还站着的敌人头顶有血条，蓄力的人头上有红标。第一次开打时提示一次操作键。

## 动作（`character/Animator.ts` `fight`）

- 程序化动作：guard、jab、cross、hook、kick、uppercut、block、flinch。
- 出招时双手握拳（`Hero.ts` `CURL.fist`）。
- 出招时刻表：`STRIKE`（命中时间 / 总时长）由动画和判定共用。
- 玩家这边：`OnFoot.play(action, secs, yaw, lunge)` 出招时带冲步，冲步速度只作用在前 40% 的时间里。

**动作片段（2026-10-13 接入）**：用户下载的 9 个 Mixamo FBX（FightIdle、LeadJab、CrossPunch、HookPunch、Uppercut、MmaKick、BodyBlock、HeadHit、StomachHit）放在 `assets/anims/mixamo/`，用 `scripts/blender/characters/anims.py` 和 `scripts/characters/pack-anims.mjs` 转成 `public/models/anims/*.glb`（9 个共约 450 KB），在 `public/models/characters/cast.json` 里映射：
- **对齐命中时刻**：每个出招片段都裁掉前面的准备和后面的收势，再加速，让拳头（或脚）打到的那一帧正好落在 `STRIKE[k].hit`。刺拳 [0.30, 0.88] ×1.9，直拳 [0.85, 1.63] ×2.3，勾拳 [0.68, 1.44] ×1.8，上勾拳 [0.33, 0.96] ×1.25，踢腿 [0.30, 1.18] ×1.45（锚定起点）。命中时刻用 `.scratch/sweep/animmeasure.test.ts` 量：拳头最快那一帧稍后一点。不能用"伸得最远"来量：勾拳是横扫的，上勾拳打完还会举过头顶，这么量两个都会量错。
- **站姿**：陈野用刺拳片段的第一帧当站姿（双拳护在下巴前，`guardUp`）。Mixamo 的 Fight Idle 是 MMA 式的，双手伸在身前，改给黑豹的三个打手用（`thug1-3` 的 `actions.guard`），像街头混混，敌我也好区分。
- **腿**：站姿、刺拳、直拳、勾拳、格挡、受击用游戏自己的步态腿（他们会移动、会冲步）；上勾拳和踢腿用片段的全身动作。受击每次随机选打头（HeadHit）或打肚子（StomachHit）：`clip` 写成数组，每次进入动作时挑一个（`Hero.ts`）。
- **坑**：Mixamo 的格斗架势髋部往右转约 45°，上半身再拧回来；换成游戏的步态髋部以后，上半身跟着偏了 45°，每一拳都打向左前方。`Hero.animate` 现在会把片段髋部和步态髋部的差补到 `spine_01` 上（坐姿类动作除外）。另外，出拳、格挡、受击的片段淡入改成 0.04 秒（`SNAP`），原来 0.12 秒的淡入，到命中时拳头只伸出六成。
- 这 9 个 FBX 是从另一个更大的 Mixamo 角色导出的（髋到脚 1.53，走路片段是 0.95），重定向按比例缩放，不影响。
- 检查：`Clips.test.ts`（打斗片段的四肢方向允许偏差 4°，走路类是 1°；新增一条测试：用步态播放站姿、出拳、踢腿和两种受击，没有 NaN、脚不离地）；`TIMES="jab:0.06,0.12;kick:0.26" CAMX=2.6 CAMZ=2.4 node .scratch/combat/poses.mjs out.png [castId]` 按指定时刻拍定格表（默认用游戏的方式加载 chenye，带动作片段）；`.scratch/sweep/animjoints.test.ts`（`AT=FightIdle:1`）打印片段某一时刻的关节位置。

## 遭遇：黑豹的人（`npc/` kind `gang`）

- 只在徒步时出现。2–3 个打手出现在玩家前方 10 m，那里没地方就换到侧面或身后（要求胸口高度 12 m 内的射线没有挡住）。
- 领头的会在对话框里挑衅。
- 打赢了每人给 ¥120，弹出提示「放倒了黑豹的人」，并记入人物志。

## 平衡（3 个敌人，`brawl.mjs`）

| 机器人打法 | 结果 |
|---|---|
| 站着不动 | 约 25 s 后被打死 |
| 只打不反击 | 能赢，掉约 56 血 |
| 六成概率反击 | 能赢，只掉约 7 血 |

## 测试与探针

- `src/combat/Combat.test.ts`：
  - 敌人：保持包围圈；一次完整的攻击循环（蓄力时间 ≥ 0.8 × windup，只命中一拳）；玩家退出攻击范围时打空；霸体和反击打断；敌人之间保持间距。
  - 玩家：选目标、连招衔接、攻击范围。
- `node .scratch/combat/brawl.mjs outPrefix [n] [secs] [params]`：机器人打一场，结束时截图。
  - `PASSIVE=1`：站着不动；`COUNTER=0`：从不反击；`SKILL=0..1`：反击的概率。
  - `ENC=1`：打街头遭遇，params 需要加 `npc=1`。
  - `SIDE=1`：镜头放到侧面，每个状态截一张图。
- `node .scratch/combat/poses.mjs out.png [glb]`：动作定格表。
- 调试：`debug.brawl(n, tough)`、`debug.fighters()`。

## 后续（第 2 步剩下的）

环境处决（把人往墙、车门、垃圾箱上撞）、擒拿、高速跳车夺车。第二章已完成（`docs/gta-plan.md` §6）。
