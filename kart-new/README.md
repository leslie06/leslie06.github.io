# kart-new/（构建产物，别手改）

这个目录里的 `index.html` 和 `assets/` 是 `kart_new/` 用 Vite 构建出来的，
提交进仓库只是为了让 GitHub Pages 能直接服务 —— Pages 服务 main 根目录，不跑构建。

**改动请去 `kart_new/src/`，然后：**

```bash
cd kart_new
npm run deploy    # = npm run build + 把 dist 拷到 ../kart-new/
```

手改这里的文件下一次 deploy 就会被覆盖掉。

线上地址：https://leslie06.github.io/kart-new/
