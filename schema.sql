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
