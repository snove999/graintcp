-- GrainTCP Workers D1 初始化（wrangler d1 execute graintcp --remote --file=schema.sql）
-- config    : 面板「保存配置」写入的环境变量后备存储（键与环境变量同名）
-- whitelist : 面板 IP 白名单
-- logs      : 访问日志（自动封顶 2000 条）
-- stats     : 每日请量统计（自动清理 730 天前）
CREATE TABLE IF NOT EXISTS config (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS whitelist (
  ip         TEXT PRIMARY KEY,
  created_at TEXT
);
CREATE TABLE IF NOT EXISTS logs (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  time   TEXT,
  ip     TEXT,
  region TEXT,
  action TEXT
);
CREATE TABLE IF NOT EXISTS stats (
  date  TEXT PRIMARY KEY,
  count INTEGER
);
