# 统计：谁打开了、玩了多久

每个游戏的 `index.html` 里有一段二十几行的打点代码（由 `apply.mjs` 生成），把三个数发给统计接口：游戏名、一个随机会话号、活跃秒数。不用 Cookie，不存 IP，网址后面加 `?nostat=1` 就关掉。

`worker.js` 一份代码两处能跑：Cloudflare Worker（数据库用 D1）或自己的服务器（`server.mjs` + 本地 SQLite）。两边的 SQL 和逻辑完全一样。

## 现在跑在哪

**自己的阿里云服务器上**（2026-09-16 起）。原因：Cloudflare 的 `workers.dev` 域名国内直连打不开，实测过。

- 接口：`https://stats.fishai.asia/e`
- 看板：`https://stats.fishai.asia/?k=看板密钥`（密钥在本机 `stats/.dash-key`，不在仓库里）
- 自查：`https://stats.fishai.asia/me` —— 手机上打开，能看到内容就说明连得上

服务器上的东西（`root@47.95.248.104`，Ubuntu 24.04）：

| 位置 | 是什么 |
| --- | --- |
| `/opt/ai-games-stats/` | `worker.js` `server.mjs` `schema.sql` + 独立的 node 22（不碰系统包） |
| `/var/lib/ai-games-stats/stats.sqlite` | 数据库，属主 `aistats` |
| `/etc/ai-games-stats/env` | `DASH_KEY` / `SALT` / `DB_FILE` / `PORT`，权限 600 |
| `/etc/systemd/system/ai-games-stats.service` | 常驻服务，挂了自动重启，只能写数据目录 |
| `/etc/caddy/Caddyfile` | 追加了 `stats.fishai.asia → localhost:8787`，证书 Caddy 自动管；改前的备份是 `Caddyfile.bak-*` |

Cloudflare 上那个 Worker + D1 留着当备份，没在用（国内连不上）。

### 改完代码怎么更新服务器

```sh
scp stats/worker.js stats/server.mjs stats/schema.sql root@47.95.248.104:/opt/ai-games-stats/
ssh root@47.95.248.104 'systemctl restart ai-games-stats && systemctl is-active ai-games-stats'
```

### 数据怎么备份 / 查

服务器上没装 `sqlite3` 命令行，用服务自带的那个 node 就行。WAL 模式下别直接 `cp` 主文件（有一部分数据还在 `-wal` 里），要用 `VACUUM INTO`：

```sh
# 备份到本地
ssh root@47.95.248.104 'cd /opt/ai-games-stats && ./node/bin/node -e "
const {DatabaseSync}=require(\"node:sqlite\");
new DatabaseSync(\"/var/lib/ai-games-stats/stats.sqlite\").exec(\"VACUUM INTO \x27/tmp/stats.bak\x27\");"' \
  && scp root@47.95.248.104:/tmp/stats.bak ./stats-$(date +%F).sqlite

# 随手查最近十条
ssh root@47.95.248.104 'cd /opt/ai-games-stats && ./node/bin/node -e "
const {DatabaseSync}=require(\"node:sqlite\");
const db=new DatabaseSync(\"/var/lib/ai-games-stats/stats.sqlite\");
console.table(db.prepare(\"SELECT day,game,active,ip_masked FROM ev ORDER BY ts DESC LIMIT 10\").all());"'
```

拉回来的备份可以本地打开看：`DB_FILE=./stats-2026-09-16.sqlite node stats/server.mjs`，然后开 `http://127.0.0.1:8787/?k=dev`。

要关掉统计就跑 `node stats/apply.mjs --off` 再推送。

## 排行榜（2026-09-25 起，b城追车在用）

`POST /lb` 交成绩，`GET /lb?g=bcity&b=race0&p=玩家号` 取前十和自己的名次。库里一张 `lb` 表：每个玩家（游戏在浏览器里生成的随机号）每个榜一行，只留最好成绩，带玩家自己起的昵称。哪些榜、成绩合理范围在 `worker.js` 的 `BOARDS` 里，范围外的直接丢；昵称去掉尖括号引号、最多 12 个字、像网址的换成「车手」；同一台设备一天在一个榜上最多开 5 个新号。不存 IP，只存和打点一样的每日换盐哈希。

服务器上建表不用手动：`server.mjs` 启动时会执行 `schema.sql`（`CREATE TABLE IF NOT EXISTS`）。所以按上面「改完代码怎么更新服务器」把 `worker.js`、`schema.sql` 传上去重启就行。

## 玩家反馈（2026-10-11 起，b城追车在用）

游戏标题页和暂停页有「意见反馈」按钮：选类型（遇到问题 / 建议 / 好评 / 其他）、写内容、选填联系方式，默认附上打开面板那一刻的游戏画面（JPEG，最宽 960 像素）。游戏还会一起带上版本、画质、帧率、设备和屏幕、语言、在城里的位置和道路、开车还是步行、通缉星数、游戏里的钟点、这次玩了多久。

- 交：`POST /fb`（text/plain 的 JSON），存进 `fb` 表，截图单独存 `fb_shot` 表。
- 看：`https://stats.fishai.asia/fb?k=看板密钥`（看板顶上也有链接）。最新的在上面，可以按未读 / 已读 / 已处理筛，点截图看大图，按钮改状态。同一个玩家提过几条会标出来。
- 限流：同一台设备一天最多 20 条；十分钟内一字不差的重复（连点两下）只收一条。不存完整 IP，只有打码网段（看省份）和每天换盐的哈希。
- 连不上服务器时游戏把反馈存在浏览器里，下次打开游戏自动补发。
- 请求体上限 1 MB（`server.mjs`）。

和排行榜一样，表是 `server.mjs` 启动时建的；按上面「改完代码怎么更新服务器」把 `worker.js`、`server.mjs`、`schema.sql` 传上去重启就行。

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

下面还有两块：**来自哪里**（按省份汇总的打开数、设备数、有效游玩、平均时长、占比）和**最近的会话**（最近 60 条：时间、游戏、省份城市、运营商、IP 网段、时长、手机还是电脑、从哪进来的）。

地域是这么来的：打点入库时把 IP 打码成网段（`223.104.5.x`，最后一段抹掉），完整地址不落库；后台每分钟拿还没查过的网段去查一次归属地，结果存在 `geo` 表里永久复用，同一网段不会重复查。查询走太平洋 IP 库（国内服务器连得上，返回 GBK 要转码），连不上时退回 ip-api。发出去的也是打码后的地址。

「活跃」只算页面可见、且最近 30 秒内有过操作的时间。切到后台、开着标签页去吃饭都不计。

## 备份方案：Cloudflare Worker + D1

**国内直连不通，现在没在用**，留着备查（比如以后要统计海外访客）。步骤：

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

   **2026-09-16 实测：国内不挂代理时 `workers.dev` 根本打不开**，所以最后没走这条路。

## 没数据怎么办

1. 打开 `https://stats.fishai.asia/health`，返回 `ok` 说明服务活着
2. 服务器上看日志：`ssh root@47.95.248.104 'journalctl -u ai-games-stats -n 50 --no-pager'`
3. 游戏页按 F12 看网络面板里 `/e` 那条请求，红了就是发不出去
4. 手机上打开 `https://stats.fishai.asia/me`，打不开就是网络层的问题，不是代码问题

## 本地开发

不用 Cloudflare 账号也能跑：

```sh
node stats/server.mjs                                    # 起在 8787，库在 stats/.dev.sqlite
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
- **占用**：服务常驻内存约 60 MB（systemd 里限了 300 MB 上限），一次会话在库里就一行、几十字节，每天一万次会话一年也才几十 MB。
- **丢数据的情况**：心跳 15 秒一次，手机上标签页被系统杀掉时，最后不到 15 秒的时长会丢。统计趋势没影响。
- **密钥别外传**：看板地址带着 `?k=`，发给别人等于给了查看权限。密钥泄露了重新 `wrangler secret put DASH_KEY` 就行。

## 账号和云存档（2026-10-15 起，b城追车在用）

玩家用用户名加密码注册，存档整份存在服务器上，换设备登录接着玩。不收手机号、邮箱。接口都是 POST text/plain 的 JSON（不触发跨域预检），登录令牌放在请求体的 `t` 里，不用 Cookie：

| 接口 | 传什么 | 回什么 |
| --- | --- | --- |
| `/acct/register` | `g, name, pw` | `token, name, recovery`（恢复码只给这一次） |
| `/acct/login` | `g, name, pw` | `token, name` |
| `/acct/reset` | `g, name, recovery, pw` | `token, name, recovery`（新恢复码；这个号原来的登录全部作废） |
| `/acct/logout` | `g, t` | `ok` |
| `/save/get` | `g, t` | `name, ver, ts, data`（没存过 `data` 是 null） |
| `/save/put` | `g, t, ver, data, force` | `ver, ts`；`ver` 不是库里当前的版本（别的设备存过）回 409，`force` 强行覆盖 |

- **库里存什么**：`acct` 表只有用户名和两个哈希（密码、恢复码；PBKDF2-SHA256 迭代 10 万次加 16 字节随机盐，格式 `pbkdf2$迭代$盐$哈希`）；`sess` 表只存令牌的 SHA-256，180 天不用失效；`save` 表一个号一行（存档 JSON 文本，最多 60 万字符）和版本号；`acct_fail` 记登录失败，限流用。
- **限制**：用户名 2–16 个字（字母、数字、汉字、下划线、减号，不分大小写查重）；密码 6–64 位；同一台设备（每天换盐的 ip_hash）一天最多注册 5 个号；同一个号 15 分钟内登录或重设失败 10 次、同一台设备 30 次，就先回 429。
- **哪些游戏能用**：`worker.js` 的 `SAVE_GAMES`（现在只有 `bcity`）。
- 表是 `schema.sql` 里的 `CREATE TABLE IF NOT EXISTS`，服务启动时自动建，更新服务器照上面「改完代码怎么更新服务器」传三个文件、重启就行。
- 本地测：`node stats/test.mjs`（账号部分 24 条）。
