# 访问计数 · Worker 版

和上一层的 `server.js` 记同一件事、同一套表，区别只有**谁在收数**：

| | 本地 `server.js` | 这个 Worker |
| --- | --- | --- |
| 什么时候在收 | 你电脑开着、隧道挂着的时候 | 24 小时 |
| 地址 | 快速隧道，每次重启都变 | 固定的 `*.workers.dev` |
| 明细往哪看 | 自带看板 | 没有看板，`--pull` 到本地再看 |
| 花钱吗 | 不 | 免费额度内不（D1 每天 10 万次读、10 万行写） |

**这个 Worker 没有看板，是故意的。** 它的地址公网上谁都能访问，把访客明细挂上去等于公开数据库。看数走本地：`--pull` 拉一份下来，用本地那个看板看。

| 路径 | 公开？ | 作用 |
| --- | --- | --- |
| `/hit` | 是 | 记一次整站访问，返回 204 |
| `/hit?g=roadRash` | 是 | 同上，另外记一次「这个游戏被点开」 |
| `/games` | 是 | `{roadRash:{uniques,total}, ...}`，只有计数、没有个人信息 |
| `/export?k=<token>` | **否** | 全量明细，含 IP。给 `--pull` 用 |

`ADMIN_TOKEN` 没设的话 `/export` 直接 401（fail closed），不会因为忘了配就把库敞开。

## 部署

```bash
npm i -g wrangler          # 没装过的话
cd counter/worker
wrangler login

wrangler d1 create counter                       # 记下打印出来的 database_id
```

把 `database_id` 填进 `wrangler.toml`，然后建表：

```bash
wrangler d1 execute counter --remote --file=schema.sql
```

设两个密钥（**不要写进 `wrangler.toml`，那个文件会进 git**）：

```bash
wrangler secret put HASH_SALT      # 随便一串字符，越长越好
wrangler secret put ADMIN_TOKEN    # 拉数据用的口令
```

`HASH_SALT` 在本地版是可选的（库在自己机器上），**云上强烈建议设**：数据放在别人的机器上，IP 在《个人信息保护法》和 GDPR 下都算个人信息。设了之后存的是 `sha256(ip+盐)` 的前 24 位，去重效果一模一样，但反推不回具体的人。

```bash
wrangler deploy
```

会打印出 `https://counter.<你的子域>.workers.dev`。

## 接到目录页

把上面那个地址填进根目录 `index.html`：

```js
const COUNTER = 'https://counter.xxx.workers.dev';   // 不带结尾斜杠
```

推一次就活了。**地址是固定的，以后不用再动。**

## 把数据同步回本地

```bash
cd counter
node server.js --pull https://counter.xxx.workers.dev <ADMIN_TOKEN>
node server.js                     # 然后开 http://localhost:8787/ 看
```

合并是**照抄云上**而不是加上去：`hits` 直接取 Worker 的值。因为收数的是 Worker，它那行的 `hits` 已经是这个 key 的累计总数，本地再累加就会翻倍——同一份数据拉两次，5 次点击变 10 次（写的时候就踩过这个坑）。照抄天然幂等，重复拉多少次结果都一样。

## 几件要知道的事

- **`/hit` 无鉴权，谁都能灌。** `game` 走白名单挡住了乱写的名字，但挡不住有人拿 curl 把某个游戏刷到十万。真在意就在 Cloudflare 面板上给这个 Worker 加条 Rate Limiting 规则。
- **加了新游戏要同时改两处白名单**：`worker.js` 的 `GAMES` 和 `../server.js` 的 `GAMES`。不在名单里的打点会被静默丢掉。
- **换了 `HASH_SALT` 等于换了一套 key**，老数据和新数据不会合并，去重人数会虚高一段时间。
