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
| `/etc/caddy/Caddyfile`（2026-10-18） | `stats.fishai.asia` 下加了 `handle_path /bcity/*` → `/srv/bcity`：b城追车的国内镜像（静态文件，`Access-Control-Allow-Origin: *`），由 `drive-city/scripts/deploy.mjs` 用 rsync 同步；其余路径照旧反代到 8787。备份 `Caddyfile.bak-20261018` |
| `/srv/bcity` | b城追车构建的完整副本（约 400 MB） |

Cloudflare 上那个 Worker + D1 留着当备份，没在用（国内连不上）。

### 改完代码怎么更新服务器

```sh
scp stats/worker.js stats/server.mjs stats/schema.sql stats/mp.mjs root@47.95.248.104:/opt/ai-games-stats/
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

## 漏斗（2026-10-17 起，b城追车）

只看「玩了多久」不知道玩家卡在哪一步，所以 b城追车自己在 `window.__stat` 里记下每一步是打开后第几秒走到的（`drive-city/src/online/Funnel.ts`，`drive-city/index.html` 在程序下载前就建好），打点片段（`apply.mjs`）每次心跳把它作为 `m` 一起带上。别的游戏没有 `__stat`，心跳和以前一样。

- 存：`fn` 表，一次打开一行（`day, game, sid` 和 `ev` 对得上），`data` 是 JSON。键是小写短名、值是数（秒）或短字符串，最多 48 个键、2 KB（`cleanMarks`）；后报的是先报的超集，乱序时留长的那份。
- 步骤（`worker.js` 的 `FUNNEL`，按先后）：`js` 程序下载完开始运行 → `b_city` 下载城市数据 → `b_tiles` 加载出生点街区 → `title` 标题画面 → `start` 点「进入城市」→ `move` 开出 30 米 → `p1m` / `p3m` / `p10m` / `p30m` 玩满 1 / 3 / 10 / 30 分钟（标题、暂停、切后台不算）。
- 进城后做过的事（第一次的时间）：`fare` 接客、`adv` 小飞龙的冒险、`ch` 开始主线章节、`chpass` 通过一章、`foot` 下车、`jack` 抢车、`fight` 打架、`wanted` 被通缉、`busted` 被捕、`map` 大地图、`race` 比赛 / 计时赛、`acct` 登录了账号。
- 环境：`q` 画质档、`gpu` 显卡名、`dlkb` 到标题画面前下载了多少 KB、`kbps` 第一次下载（超过 1.5 MB 才算，缓存过的不算）的速度、`fps` / `fpslo` 进城后第一分钟的帧率中位和最慢 10%、`lost` WebGL 上下文丢失、`err` / `e` 页面报错次数和第一条、`rerr` / `re` 资源下载失败次数和第一个文件、`ret` 这台浏览器以前玩过、`touch` 触屏。不记位置、名字和输入的内容。
- 看：看板的「b城追车 · 漏斗」，可按全部 / 手机 / 电脑 / 第一次来 / 来过的分开看：每一步走到的会话数、占打开、比上一步、打开后第几秒（中位和 25%–75%）、「最远到这一步」；下面是进城以后做了什么、下载速度、帧率、显卡、报错。
- 测：`node stats/test.mjs`（漏斗 10 条）；端到端 `DB_FILE=/tmp/x.sqlite PORT=8788 node stats/server.mjs &` 然后 `node drive-city/.scratch/funnelprobe.mjs http://127.0.0.1:8788 65`（真实帧循环从标题进城玩 65 秒，把 `__stat` 当心跳发过去；`TOUCH=1 ... 8 844 390` 模拟手机），`node drive-city/.scratch/dashshot.mjs http://127.0.0.1:8788 out.png` 截看板的漏斗那块。

## 玩家反馈（2026-10-11 起，b城追车在用）

游戏标题页和暂停页有「意见反馈」按钮：选类型（遇到问题 / 建议 / 好评 / 其他）、写内容、选填联系方式，默认附上打开面板那一刻的游戏画面（JPEG，最宽 960 像素）。游戏还会一起带上版本、画质、帧率、设备和屏幕、语言、在城里的位置和道路、开车还是步行、通缉星数、游戏里的钟点、这次玩了多久。

- 交：`POST /fb`（text/plain 的 JSON），存进 `fb` 表，截图单独存 `fb_shot` 表。
- 看：`https://stats.fishai.asia/fb?k=看板密钥`（看板顶上也有链接）。最新的在上面，可以按未读 / 已读 / 已处理筛，点截图看大图，按钮改状态。同一个玩家提过几条会标出来。
- 限流：同一台设备一天最多 20 条；十分钟内一字不差的重复（连点两下）只收一条。不存完整 IP，只有打码网段（看省份）和每天换盐的哈希。
- 连不上服务器时游戏把反馈存在浏览器里，下次打开游戏自动补发。
- 请求体上限 1 MB（`server.mjs`）。

和排行榜一样，表是 `server.mjs` 启动时建的；按上面「改完代码怎么更新服务器」把 `worker.js`、`server.mjs`、`schema.sql` 传上去重启就行。

### 反馈里的对话（2026-10-28 起）

后台在每条反馈下面直接回复玩家；玩家下次打开游戏（或玩着的时候，最多 3 分钟）会看到提示，在「意见反馈 → 我的反馈」里看对话、接着回。

| 接口 | 谁用 | 传什么 | 回什么 |
| --- | --- | --- | --- |
| `POST /fb/msg?id=&k=` | 后台 | 正文 `{t}`（最多 2000 字） | `msg`；这条反馈是未读的就标成已读 |
| `POST /fb/msgdel?id=&k=` | 后台 | | 删掉一条开发者回复（玩家的话删不掉） |
| `GET /fb/mine?g=&p=` | 游戏 | 随机玩家号 | 这个号最近 20 条反馈和对话、`unread` 没看过的回复数（不回玩家号和设备） |
| `POST /fb/seen` | 游戏 | `g, p` | 回复都算看过（后台显示「玩家已看」） |
| `POST /fb/reply` | 游戏 | `g, p, id, t` | `msg`；只能回自己玩家号的反馈，最多 1000 字、一天 30 条、10 分钟内同一句只收一条；回了这条反馈变回未读 |

- 库表：`fb_msg`（`who` = `dev` / `me`，`seen` = 玩家看过的时间），启动时自动建，不用迁移。
- 玩家号就是排行榜那个随机号，从没公开回给别人过，所以只凭它取对话。
- 本地测：`node stats/test.mjs`（对话 17 条）。

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

游戏表里还有一列 **总时长**：期间所有会话的活跃时间加起来。

**注册账号**（2026-10-17 起）：每个游戏的账号总数、期间新增、今天新增、7 天内登录过、有云存档的、累计和人均游戏时长、每日注册柱状图；下面是账号列表（最近登录的在上，最多 200 个）：用户名、注册日期、最后登录、游戏时长、章节、钱、存档同步时间。时长、章节、钱是从云存档里读的（b城的 `drivecity.playtime.v1` 等键），是玩家最近一次同步时的数；没存档的显示 –。账号总数和列表不受天数按钮影响。

再下面还有两块：**来自哪里**（按省份汇总的打开数、设备数、有效游玩、平均时长、占比）和**最近的会话**（最近 60 条：时间、游戏、省份城市、运营商、IP 网段、时长、手机还是电脑、从哪进来的）。

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

## 游戏里的聊天（2026-10-15 起，b城追车在用）

在线玩家在游戏里发言，游戏每隔几秒来取新的（聊天打开时 2.5 秒，关着 15 秒）。登录的显示账号名，没登录的显示「游客」+ 4 位编号（由随机玩家号算出，同一台设备固定）。

| 接口 | 传什么 | 回什么 |
| --- | --- | --- |
| `POST /chat` | `g, text, p`（随机玩家号）、`t`（登录令牌，可不给） | `msg`，或 `error`：`fast` 太快、`dup` 重复、`ad` 广告、`banned` 禁言中（带 `until`） |
| `GET /chat?g=&after=id&wait=秒` | `after` 不给就是最近 50 条；带 `after` 和 `wait`（最多 25）时 Node 版没有新消息就挂着，有人发言马上回（长轮询，Worker 版忽略 `wait`） | `msgs`（旧的在前）、`last` |

- **限制**：每条 1–120 字；同一个人（玩家号或设备）3 秒一条、一分钟最多 15 条；30 秒内一字不差的重复不收；网址、微信、QQ、7 位以上数字这类广告联系方式不收；脏话换成星号。
- **屏蔽词**：`worker.js` 的 `CHAT_WORDS` 是默认的一小份；自建服务器上设 `CHAT_WORDS_FILE=/etc/ai-games-stats/chat-words.txt`（一行一个词，写进 `/etc/ai-games-stats/env`），重启服务生效，可以随时往里加。
- **管理**：`https://stats.fishai.asia/chat/admin?k=看板密钥`，最近的消息（新的在上），每条可以删除 / 恢复、禁言 1 天 / 30 天 / 解除（按这条消息的玩家号、账号和设备一起禁）。
- **库表**：`chat`（不存完整 IP，`ip_hash` 每天换盐）、`chat_ban`。服务启动时自动建。
- **合规提醒**：服务器在国内，公开发言属于互联网跟帖评论，需要有人管：建议定期看一眼后台，把常见的违规词加进屏蔽词文件。
- 本地测：`node stats/test.mjs`（聊天部分 17 条）。

## 促销兑换码（2026-10-29 起，b城追车在用）

后台一批批生成一次性兑换码，私发给玩家；玩家在游戏车行里输码，核对通过就免费领奖品（现在只有蛮牛跑车 `super`）。码只存在服务器上，游戏代码里没有，扒不出来。

- 管理：`https://stats.fishai.asia/promo/admin?k=看板密钥`（看板顶上「兑换码 →」）：开始 / 结束活动，生成码（一次最多 500 个，可写备注），看哪些码被谁（账号名或游客）什么时候用了，作废没用过的码，一键复制没用过的。
- 码：8 位，字母数字去掉容易看错的 0 O 1 I，显示成 `XXXX-XXXX`；玩家输小写、带横线空格都认。

| 接口 | 谁用 | 传什么 | 回什么 |
| --- | --- | --- | --- |
| `GET /promo/state?g=` | 游戏 | | `on`：活动开着的奖品 |
| `POST /promo/redeem` | 游戏 | `g, p`（随机玩家号）`, code, t`（登录令牌，可不给） | `{ok, prize}`；或 `error`：`code` 码不对 / `used` 别人用过 / `have` 这个玩家号或账号领过同一种奖品 / `off` 活动没开 / `busy` 一台设备一小时输错 20 次 |
| `POST /promo/gen?prize=&n=&note=&k=` | 后台 | | `codes` |
| `POST /promo/toggle?prize=&on=1|0&k=` | 后台 | | `on` |
| `POST /promo/void?code=&k=` | 后台 | | 作废一个没用过的码 |
| `GET /promo/list?k=` | 后台 | | 奖品、开关、计数、所有码 |

- 同一个玩家号拿自己用过的码再兑一次回 ok（`again`），网络断在半路时能重试。结束活动后没用过的码不作废，再开始又能用。
- 库表：`promo_code`（码、奖品、备注、生成时间、`used` 兑换时间 / 0 没用 / -1 作废、玩家号、账号、设备哈希）、`promo`（开关）、`promo_fail`（输错记录）。服务启动时自动建。
- 加奖品：`worker.js` 的 `PROMO_PRIZES`，游戏那边 `garage/index.ts` 的 `redeem` 按奖品给东西（现在认车行里的车）。
- 本地测：`node stats/test.mjs`（兑换码 17 条）。

## 联机（2026-10-29 起，b城追车在用）

和朋友在同一个城市里各开各的车：一个人建房间（4 位房间号 / 邀请链接），朋友输号或开链接进来，每个房间最多 4 人。`mp.mjs` 是 WebSocket 中转，接在 `server.mjs` 的 HTTP 服务上（`/mp` 的升级请求），手写的 RFC 6455，没有依赖。**只有自建服务器（Node）上有，Cloudflare Worker 版没有。** Caddy 的 `reverse_proxy` 自动转发 WebSocket，不用改配置。

- 第一条消息 `{t:'create', g, p, tk}` 建房间或 `{t:'join', g, p, tk, room}` 进房间，回 `{t:'joined', room, id, name, max, peers}` 或 `{t:'err', e}`（`noroom` / `full` / `bad` / `busy`）。
- 之后游戏发 `{t:'s', …}`（自己的位置、车，每秒约 10 次）和 `{t:'e', …}`（喇叭、撞车），服务器加上 `id` 原样转给房间里其他人；有人进来 `{t:'peer', id, name}`，走了 `{t:'gone', id}`。
- 名字服务器定：登录的用账号名，没登录是「游客」+ 4 位编号（和聊天一样），冒充不了别人的账号。
- 房间只在内存里，最后一个人走了就删；服务重启所有房间都断（游戏会自动重连回原房间号，房间没了就提示）。
- 限制：一条最多 2 KB，一个连接每秒最多 40 条（多的丢掉），最多 3000 个房间；15 秒 ping 一次，40 秒没回音就断。
- 更新服务器时 **`mp.mjs` 也要传**（见上面「改完代码怎么更新服务器」）。
- 本地测：`node stats/mp.test.mjs`（起一个真的 server.mjs，用 Node 自带的 WebSocket 当几个玩家，13 条）。
