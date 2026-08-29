# 访问计数

拿到访客 IP，**按 IP 去重**，存进本地 SQLite。零依赖——数据库用 Node 22 自带的 `node:sqlite`，HTTP 用 `node:http`，不装任何 npm 包。

去重不靠代码，靠 `ip` 这一列的 `PRIMARY KEY`：同一个 IP 再来只会把 `hits` 加一，不新增行。所以 `COUNT(*)` 天然就是去重后的人数。

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

然后 `http://localhost:8787/` 就是看板，五秒自动刷新。

| 路径 | 作用 |
| --- | --- |
| `/hit` | 打点，返回 204 |
| `/` | 看板 |
| `/stats` | `{uniques, total, today, week}` |
| `/list` | 最近 200 条明细 |

## 不想存原始 IP

```bash
HASH_SALT=随便一串字符 node server.js
```

存的变成 `sha256(ip + 盐)` 的前 24 位。**去重效果完全一样**，但反推不回具体的人——IP 在《个人信息保护法》和 GDPR 下都算个人信息，这样合规上省事很多。

## 两个要认的限制

**一、只有你的电脑开着、隧道挂着的时候才记得到。** 关机、睡眠、断网期间来的人全部丢失。游戏链接是随机时间被点开的，所以实际大概率只能记到一小部分。

**二、快速隧道的地址每次重启都变。** 变了就得改游戏页面里那行 fetch。想要固定地址，要么在 Cloudflare 上绑一个自己的域名做命名隧道，要么改用 Worker（免费送一个固定的 `*.workers.dev`）。

如果这两条受不了，正确的做法是：**用 Cloudflare Worker + D1 在云上 24 小时收，你想看的时候再同步一份到本地。** 数据不丢，本地也有副本。

## IP 去重本身就不准

同一个 Wi-Fi、公司出口、运营商 NAT 下的多个人算成一个；手机在 4G 和 Wi-Fi 之间切换，同一个人算成两个。作为「大概多少人玩过」够用，别当精确数字。

## 文件

| 文件 | 说明 |
| --- | --- |
| `server.js` | 全部内容，含看板 |
| `visits.db` | SQLite 数据库，首次运行自动建 |
