-- 和本地 server.js 的表结构一致，去重同样靠主键不靠代码。
-- 建库：wrangler d1 execute counter --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS visitors (
  ip         TEXT PRIMARY KEY,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  hits       INTEGER NOT NULL DEFAULT 1,
  ua         TEXT,
  ref        TEXT
);
CREATE INDEX IF NOT EXISTS idx_last ON visitors(last_seen DESC);

CREATE TABLE IF NOT EXISTS plays (
  game       TEXT NOT NULL,
  ip         TEXT NOT NULL,
  first_seen INTEGER NOT NULL,
  last_seen  INTEGER NOT NULL,
  hits       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (game, ip)
);
CREATE INDEX IF NOT EXISTS idx_play_last ON plays(last_seen DESC);
