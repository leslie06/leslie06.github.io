-- 一次会话一行。心跳用 UPSERT 更新 active，所以丢包不会重复计数。
-- 不存完整 IP：只存打码到网段的 ip_masked（223.104.5.x），以及每天换盐的哈希用来数设备。
CREATE TABLE IF NOT EXISTS ev (
  day        TEXT    NOT NULL,          -- 北京时间的日期 YYYY-MM-DD
  game       TEXT    NOT NULL,          -- 游戏目录名，白名单之外的丢弃
  sid        TEXT    NOT NULL,          -- 一次打开 = 一个会话号
  active     INTEGER NOT NULL DEFAULT 0,-- 活跃秒数（页面可见 + 最近有操作）
  mobile     INTEGER NOT NULL DEFAULT 0,
  from_index INTEGER NOT NULL DEFAULT 0,-- 1 = 从目录页点进来的
  country    TEXT    NOT NULL DEFAULT 'XX',
  ip_hash    TEXT    NOT NULL DEFAULT '',
  ip_masked  TEXT    NOT NULL DEFAULT '',-- 最后一段抹掉，用来连地域表
  ts         INTEGER NOT NULL DEFAULT 0,-- 第一次上报的时间戳（毫秒）
  seen       INTEGER NOT NULL DEFAULT 0,-- 最近一次心跳的时间戳（毫秒）：在线人数按它数（索引 ev_seen 由 server.mjs 补字段后再建）
  PRIMARY KEY (day, game, sid)
);
CREATE INDEX IF NOT EXISTS ev_day ON ev (day);

-- 网段 -> 地域。每个网段只查一次，之后一直复用。
CREATE TABLE IF NOT EXISTS geo (
  prefix   TEXT PRIMARY KEY,            -- 和 ev.ip_masked 对应
  province TEXT,
  city     TEXT,
  isp      TEXT,
  ts       INTEGER NOT NULL DEFAULT 0
);

-- 排行榜：每个玩家（随机的 pid，存在他浏览器里）每个榜只占一行，只留最好成绩。
-- 名字是玩家自己填的昵称；ip_hash 同 ev 表，每天换盐，只用来限制一台设备一天能开几个新号。
CREATE TABLE IF NOT EXISTS lb (
  game    TEXT    NOT NULL,
  board   TEXT    NOT NULL,             -- 榜名，白名单见 worker.js 的 BOARDS
  pid     TEXT    NOT NULL,
  name    TEXT    NOT NULL,
  score   INTEGER NOT NULL,             -- 成绩；计时榜是毫秒（越小越好），积分榜越大越好
  day     TEXT    NOT NULL DEFAULT '',  -- 这一行第一次上榜的日期（北京时间）
  ip_hash TEXT    NOT NULL DEFAULT '',
  ts      INTEGER NOT NULL DEFAULT 0,   -- 最近一次刷新成绩的时间戳
  PRIMARY KEY (game, board, pid)
);
CREATE INDEX IF NOT EXISTS lb_rank ON lb (game, board, score);

-- 玩家反馈（2026-10-11 起，b城追车在用）：游戏里的「反馈」面板交上来的意见。
-- 不存完整 IP：ip_masked 打码到网段（连地域表看省份），ip_hash 每天换盐，只用来限流和去重。
CREATE TABLE IF NOT EXISTS fb (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  game      TEXT    NOT NULL,
  day       TEXT    NOT NULL,             -- 北京时间日期
  ts        INTEGER NOT NULL,
  kind      TEXT    NOT NULL,             -- bug / idea / praise / other
  text      TEXT    NOT NULL,             -- 玩家写的内容，最多 2000 字
  contact   TEXT    NOT NULL DEFAULT '',  -- 选填的联系方式
  ctx       TEXT    NOT NULL DEFAULT '',  -- 游戏附带的情况（JSON：版本、画质、设备、位置、道路、时间……）
  pid       TEXT    NOT NULL DEFAULT '',  -- 和排行榜同一个随机玩家号，看同一个人提过几次
  ip_hash   TEXT    NOT NULL DEFAULT '',
  ip_masked TEXT    NOT NULL DEFAULT '',
  state     TEXT    NOT NULL DEFAULT 'new', -- new / read / done
  has_shot  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS fb_ts ON fb (game, ts);
-- 截图单独一张表（JPEG 的 data URL，最多 ~400 KB），列表查询不用把它们拖出来。
CREATE TABLE IF NOT EXISTS fb_shot (
  id   INTEGER PRIMARY KEY,
  data TEXT    NOT NULL
);
-- 反馈里的来回对话（2026-10-28 起）：后台回复（who = 'dev'）和玩家在游戏里接着回（who = 'me'）。
-- 玩家凭反馈带的随机玩家号（fb.pid）取自己那几条的对话；seen = 玩家在游戏里看过这条开发者回复的时间。
CREATE TABLE IF NOT EXISTS fb_msg (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  fb_id   INTEGER NOT NULL,
  ts      INTEGER NOT NULL,
  who     TEXT    NOT NULL,             -- dev / me
  text    TEXT    NOT NULL,
  seen    INTEGER NOT NULL DEFAULT 0,
  ip_hash TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS fb_msg_fb ON fb_msg (fb_id, id);
CREATE INDEX IF NOT EXISTS fb_pid ON fb (game, pid);

-- 账号和云存档（2026-10-15 起，b城追车在用）：用户名 + 密码，只存加盐的 PBKDF2 哈希（pbkdf2$迭代$盐$哈希）。
-- 不收手机号、邮箱；忘了密码靠注册时给的恢复码（同样只存哈希）。ip_hash 同 ev 表，每天换盐，只用来限制一台设备一天注册几个号。
CREATE TABLE IF NOT EXISTS acct (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  game    TEXT    NOT NULL,
  name    TEXT    NOT NULL,             -- 玩家起的用户名（原样显示）
  lname   TEXT    NOT NULL,             -- 小写，查重和登录用
  pw      TEXT    NOT NULL,
  rc      TEXT    NOT NULL,             -- 恢复码的哈希
  day     TEXT    NOT NULL DEFAULT '',
  ip_hash TEXT    NOT NULL DEFAULT '',
  ts      INTEGER NOT NULL DEFAULT 0,
  seen    INTEGER NOT NULL DEFAULT 0,
  UNIQUE (game, lname)
);
CREATE INDEX IF NOT EXISTS acct_day ON acct (day, ip_hash);
-- 登录状态：游戏里存一个随机令牌，库里只存它的 SHA-256；180 天不用就失效，重设密码时这个号的全部作废。
CREATE TABLE IF NOT EXISTS sess (
  token TEXT    PRIMARY KEY,
  acct  INTEGER NOT NULL,
  ts    INTEGER NOT NULL,
  seen  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sess_acct ON sess (acct);
-- 存档：每个号一份（游戏 localStorage 里要同步的那些键，JSON），ver 每存一次加一，用来发现两台设备同时改。
CREATE TABLE IF NOT EXISTS save (
  acct INTEGER PRIMARY KEY,
  data TEXT    NOT NULL,
  ver  INTEGER NOT NULL,
  ts   INTEGER NOT NULL
);
-- 登录 / 重设失败的记录，限流用（同一个号 15 分钟 10 次，同一台设备 15 分钟 30 次），一天前的随手删掉。
CREATE TABLE IF NOT EXISTS acct_fail (
  key TEXT    NOT NULL,
  ts  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS acct_fail_key ON acct_fail (key, ts);

-- 游戏里的聊天（2026-10-15 起，b城追车在用）：在线玩家实时发言。登录的显示账号名，没登录的显示「游客」+ 编号（由随机玩家号算出，同一台设备固定）。
-- 不存完整 IP：ip_hash 每天换盐，只用来限流和禁言；hidden = 1 是后台删掉的（不再给玩家看）。
CREATE TABLE IF NOT EXISTS chat (
  id      INTEGER PRIMARY KEY AUTOINCREMENT,
  game    TEXT    NOT NULL,
  ts      INTEGER NOT NULL,
  name    TEXT    NOT NULL,
  acct    INTEGER,                      -- 登录的账号 id，游客为空
  pid     TEXT    NOT NULL DEFAULT '',  -- 和排行榜同一个随机玩家号
  text    TEXT    NOT NULL,
  ip_hash TEXT    NOT NULL DEFAULT '',
  hidden  INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS chat_game ON chat (game, id);
CREATE INDEX IF NOT EXISTS chat_pid ON chat (pid, ts);
-- 禁言：key 是 p:玩家号 / a:账号 / d:设备哈希，到 until 为止不能发。
CREATE TABLE IF NOT EXISTS chat_ban (
  key   TEXT    PRIMARY KEY,
  until INTEGER NOT NULL,
  ts    INTEGER NOT NULL
);

-- 漏斗（2026-10-17 起，b城追车）：一次打开一行。游戏自己记下的关键节点——打开后第几秒走到的（下载完程序、
-- 到标题画面、点进入城市、第一次开动、玩满 1 分钟……），以及几项环境（画质、显卡、帧率、下载量、出错信息），
-- 一个 JSON。随心跳一起报，后报的是先报的超集，所以留更长的那份。看板的「b城追车 · 漏斗」按它汇总。
CREATE TABLE IF NOT EXISTS fn (
  day    TEXT    NOT NULL,
  game   TEXT    NOT NULL,
  sid    TEXT    NOT NULL,              -- 和 ev.sid 同一个会话号
  mobile INTEGER NOT NULL DEFAULT 0,
  data   TEXT    NOT NULL DEFAULT '{}',
  ts     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, game, sid)
);
CREATE INDEX IF NOT EXISTS fn_day ON fn (game, day);

-- 促销兑换码（2026-10-29 起，b城追车：输码领一辆蛮牛跑车）。后台一批批生成一次性码，私发给玩家；
-- 玩家在游戏的车行里输码，服务器核对后游戏把车给他。码只在这里，游戏代码里没有。
CREATE TABLE IF NOT EXISTS promo_code (
  code    TEXT    PRIMARY KEY,          -- 8 位大写字母数字（去掉 0 O 1 I），不带横线
  game    TEXT    NOT NULL,
  prize   TEXT    NOT NULL,             -- 奖品，比如 super = 蛮牛跑车
  note    TEXT    NOT NULL DEFAULT '',  -- 生成时写的备注（发给谁、哪个渠道）
  ts      INTEGER NOT NULL,             -- 生成时间
  used    INTEGER NOT NULL DEFAULT 0,   -- 兑换时间；0 = 没用过；-1 = 作废
  pid     TEXT    NOT NULL DEFAULT '',  -- 兑换的玩家号
  acct    INTEGER,                      -- 兑换时登录的账号
  ip_hash TEXT    NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS promo_code_pid ON promo_code (game, prize, pid);
-- 活动开关：一种奖品一行，on = 1 才能兑换。
CREATE TABLE IF NOT EXISTS promo (
  game  TEXT    NOT NULL,
  prize TEXT    NOT NULL,
  on_   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (game, prize)
);
-- 输错码的记录（防止猜码：一台设备一小时最多错 PROMO_FAILS 次）。
CREATE TABLE IF NOT EXISTS promo_fail (
  ip_hash TEXT    NOT NULL,
  ts      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS promo_fail_ip ON promo_fail (ip_hash, ts);
