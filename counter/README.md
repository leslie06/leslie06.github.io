# 访问计数

拿到访客 IP，**按 IP 去重**，存进本地 SQLite。零依赖——数据库用 Node 22 自带的 `node:sqlite`，HTTP 用 `node:http`，不装任何 npm 包。

分两个粒度：**整站有多少访客**，和**每个游戏各被多少人点开过**。

去重不靠代码，靠主键：`visitors` 的主键是 `ip`，`plays` 的主键是 `(game, ip)`。同一个 IP 再来只会把 `hits` 加一，不新增行。所以 `COUNT(*)` 天然就是去重后的人数——整站问 `visitors`，某个游戏问 `plays WHERE game=?`。

`/hit?g=` 是无鉴权的公开接口，谁都能拿 curl 往里灌，所以 `game` 走**白名单**（`server.js` 里的 `GAMES`），不在名单里的直接丢掉。加了新游戏记得往里补一个名字。

## 跑起来

```bash
node server.js
```

另开一个终端拿公网地址：

```bash
cloudflared tunnel --url http://localhost:8787
```

它会打印一个 `https://xxxx-xxxx.trycloudflare.com`。把这一行加进游戏页面：

```html
<script>fetch('https://xxxx-xxxx.trycloudflare.com/hit').catch(()=>{})</script>
```

然后 `http://localhost:8787/` 就是看板，五秒自动刷新，上面一张表是各游戏的去重人数。

| 路径 | 作用 |
| --- | --- |
| `/hit` | 记一次整站访问，返回 204 |
| `/hit?g=roadRash` | 同上，另外记一次「这个游戏被点开」 |
| `/` | 看板 |
| `/stats` | `{uniques, total, today, week, games}` |
| `/games` | 只有各游戏的数：`{roadRash:{uniques,total}, ...}` |
| `/list` | 最近 200 条明细 |

## 接到目录页上

根目录 `index.html` 底部有个常量：

```js
const COUNTER = '';        // 填 https://xxxx-xxxx.trycloudflare.com，不要带结尾斜杠
```

填上就会：进目录页时读 `/games`，把「N 人玩过」写到每张卡片上；点某个游戏时 `sendBeacon` 打一次 `/hit?g=<名字>`。**留空就是整个功能静默关掉**，不发任何请求、卡片上也不显示——目录页不该因为家里的机器关着就报错。

两个要认的地方：

- **打点打在「点开卡片」这一下，不在游戏里。** 仓库的约定是游戏零外部请求，为了统计往五个 `index.html` 里各塞一行 `fetch` 不划算。代价是**直接输网址进 `/roadRash/` 的人统计不到**，数字是「从目录页点进去的人数」而不是「所有玩过的人数」。
- **隧道地址每次重启都变**，变了就得回来改这个常量。想一劳永逸见下面那节。

## 不想存原始 IP

```bash
HASH_SALT=随便一串字符 node server.js
```

存的变成 `sha256(ip + 盐)` 的前 24 位。**去重效果完全一样**，但反推不回具体的人——IP 在《个人信息保护法》和 GDPR 下都算个人信息，这样合规上省事很多。

## 想要 24 小时收数：Worker 版

下面那两条限制的正解在 [`worker/`](worker/)：同一套表、同一套接口，跑在 Cloudflare 上，24 小时收、地址固定、免费额度内不花钱。看数还是用本地这个看板，`node server.js --pull <地址> <token>` 把云上的库同步一份下来。

部署步骤见 [`worker/README.md`](worker/README.md)。

## 两个要认的限制（指本地这个）

**一、只有你的电脑开着、隧道挂着的时候才记得到。** 关机、睡眠、断网期间来的人全部丢失。游戏链接是随机时间被点开的，所以实际大概率只能记到一小部分。

**二、快速隧道的地址每次重启都变。** 变了就得改游戏页面里那行 fetch。想要固定地址，要么在 Cloudflare 上绑一个自己的域名做命名隧道，要么改用 Worker（免费送一个固定的 `*.workers.dev`）。

这两条受不了就用 [`worker/`](worker/) —— 就是按这个思路做的：**Cloudflare Worker + D1 在云上 24 小时收，你想看的时候再同步一份到本地。** 数据不丢，本地也有副本。

## IP 去重本身就不准

同一个 Wi-Fi、公司出口、运营商 NAT 下的多个人算成一个；手机在 4G 和 Wi-Fi 之间切换，同一个人算成两个。作为「大概多少人玩过」够用，别当精确数字。

## 文件

| 文件 | 说明 |
| --- | --- |
| `server.js` | 全部内容，含看板；`--pull` 从 Worker 同步 |
| `worker/` | Cloudflare Worker + D1 版，24 小时收数 |
| `visits.db` | SQLite 数据库，首次运行自动建（`visitors` + `plays` 两张表） |
