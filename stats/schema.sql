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
