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
