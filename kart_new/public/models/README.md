# 模型

把卡丁车模型放这儿，命名 `kart.glb`（路径定义在 `src/assets/ModelPaths.ts`）。
没有这个文件时游戏用 `KartView` 里那台 Box 拼的占位车，一切正常，只是没那么好看。

导出约定（完整说明在 `src/render/kartRig.ts` 顶上）：

- 车头朝 **+Z**，轮子贴地 **y = 0**，单位是米（车长 ≈ 2.6m）；
- 四个轮子的节点名里要带 `wheel`（`Wheel_FL` / `wheel.rear.l` 都认）。
  认不出前后就按节点的 z 坐标分，z > 0 是前轮；
- 想跟着车手换配色的材质，**材质名**里带 `body` / `accent` / `trim` / `suit` 之一。
  不带标签的材质（轮胎、玻璃、皮肤）所有车共用 —— 这是故意的，全车都换色就看不出
  是同一个系列的车了。

几何最好用 draco 或 meshopt 压过（`npm run assets:convert`）。压过的话要按
`src/assets/decoders.ts` 顶上的说明把解码器接回来，那三个解码器连着 1.8MB 的 wasm，
所以默认是断开的。
