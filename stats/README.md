# 统计：谁打开了、玩了多久

每个游戏的 `index.html` 里有一段二十几行的打点代码（由 `apply.mjs` 生成），把三个数发给一个 Cloudflare Worker：游戏名、一个随机会话号、活跃秒数。不用 Cookie，不存 IP，网址后面加 `?nostat=1` 就关掉。

**已经在收数据了**（2026-09-16 起）：

- 接口：`https://ai-games-stats.kangyu034.workers.dev`
- 看板：`https://ai-games-stats.kangyu034.workers.dev/?k=看板密钥`（密钥在本机 `stats/.dash-key`，不在仓库里）
- 数据库：D1 的 `ai-games-stats`

要关掉就跑 `node stats/apply.mjs --off` 再推送。

## 能看到什么

看板（`https://你的接口地址/?k=密钥`）按游戏列出：

| 指标 | 说明 |
| --- | --- |
| 打开 | 打开次数。直接输网址进来的也算得到 |
| 设备 | 当天按 IP+UA 哈希去重 |
| 有效游玩 / 有效率 | 活跃满 60 秒的会话数和占比——**这是最该看的一列**，打开就关的不算 |
| 平均 / 中位时长 | 中位数比平均数实在，平均容易被一个挂机的人拉高 |
| 手机 | 手机会话占比 |
| 从目录进 | 从目录页点进来的占比，其余是直接输网址或外部链接 |
| 每日打开 | 最近每天的柱状图 |

「活跃」只算页面可见、且最近 30 秒内有过操作的时间。切到后台、开着标签页去吃饭都不计。

## 部署（约二十分钟，全程免费）

1. 去 cloudflare.com 注册账号（邮箱即可）。
2. 在本目录登录：`npx wrangler login`，浏览器点同意。
3. 建数据库：

   ```sh
   npx wrangler d1 create ai-games-stats
   ```

   它会打印一段 `database_id = "..."`，**复制进 `wrangler.toml`**。

4. 建表：

   ```sh
   npx wrangler d1 execute ai-games-stats --remote --file=./schema.sql
   ```

5. 设两个密钥（自己想两串随机字符，`SALT` 泄露了别人就能反推设备哈希）：

   ```sh
   npx wrangler secret put DASH_KEY   # 看板密码
   npx wrangler secret put SALT       # 哈希盐
   ```

6. 部署：`npx wrangler deploy`。它会给你一个地址，形如
   `https://ai-games-stats.你的账号.workers.dev`。

7. 回仓库根目录，把这个地址写进所有游戏（注意结尾的 `/e`）：

   ```sh
   node stats/apply.mjs https://ai-games-stats.你的账号.workers.dev/e
   ```

8. 提交推送。等一分钟 GitHub Pages 生效，然后**用手机流量**（不要连 WiFi、不要挂代理）打开一个游戏玩 30 秒，再看看板：

   ```
   https://ai-games-stats.你的账号.workers.dev/?k=你的DASH_KEY
   ```

   出现数字就成了。这一步是在验国内到 Cloudflare 的连通性——`workers.dev` 在国内不稳定，没数据不代表代码错了。

## 没数据怎么办

先在电脑上打开 `https://你的接口/health`，返回 `ok` 说明服务活着。再打开游戏页按 F12 看网络面板里 `/e` 那条请求是不是失败了。

如果确认是国内连不上，两条退路，前面的代码基本都能复用：

- 把自己的域名接到 Cloudflare，用 `stats.你的域名` 代替 `workers.dev`（国内走 Cloudflare 的国际节点，通常比 `workers.dev` 好一些）
- 租一台香港小机器，用 `dev.mjs` 的方式跑同一份 `worker.js`（数据库换成本地 SQLite 文件即可）

## 本地开发

不用 Cloudflare 账号也能跑：

```sh
node stats/dev.mjs                                    # 起在 8787，库在 stats/.dev.sqlite
node stats/apply.mjs http://127.0.0.1:8787/e kart     # 让 kart 往本地发
# 浏览器打开 kart/index.html 玩十几秒
open http://127.0.0.1:8787/?k=dev                     # 看板
node stats/apply.mjs                                  # 改回占位符
```

`node stats/test.mjs` 是这套逻辑的自测（用 `node:sqlite` 冒充 D1），改了 `worker.js` 跑一遍，退出码 0 就是全过。

## 关掉

```sh
node stats/apply.mjs --off      # 把所有页面里的片段删干净
```

## 几件要注意的事

- **文案**：开始收数据以后，首页那句「零依赖、零外部请求」就不准了。建议改成「不加载任何第三方资源；只有一行匿名统计打点（不存 IP、不用 Cookie），网址后面加 `?nostat=1` 可关掉」。
- **免费额度**：Workers 每天 10 万次请求、D1 每天 10 万次写入。一次游戏会话按玩十分钟算约 40 次写入，也就是每天两千多次会话才用得完。
- **丢数据的情况**：心跳 15 秒一次，手机上标签页被系统杀掉时，最后不到 15 秒的时长会丢。统计趋势没影响。
- **密钥别外传**：看板地址带着 `?k=`，发给别人等于给了查看权限。密钥泄露了重新 `wrangler secret put DASH_KEY` 就行。
