
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  tg_id INTEGER PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  last_name TEXT,
  joined_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS games (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  hashtag TEXT NOT NULL UNIQUE,
  title TEXT,
  starts_at TEXT DEFAULT (datetime('now')),
  ends_at TEXT
);

INSERT OR IGNORE INTO games (id, hashtag, title) VALUES (1, '#plates', 'Plate Hunt');

CREATE TABLE IF NOT EXISTS submissions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  file_id TEXT NOT NULL,
  plate_text TEXT,
  points INTEGER DEFAULT 0,
  is_valid INTEGER DEFAULT 1,
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (game_id, tg_id, plate_text)
);

CREATE TABLE IF NOT EXISTS bonuses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  game_id INTEGER NOT NULL REFERENCES games(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,
  amount INTEGER NOT NULL,
  reason TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE VIEW IF NOT EXISTS leaderboard AS
SELECT
  u.tg_id,
  COALESCE(u.username,'') AS username,
  COALESCE(u.first_name,'') AS first_name,
  COALESCE(u.last_name,'') AS last_name,
  COALESCE(SUM(CASE WHEN IFNULL(s.is_valid,1) <> 0 THEN IFNULL(s.points,0) ELSE 0 END),0)
    + COALESCE(SUM(b.amount),0) AS total_points,
  COUNT(DISTINCT CASE WHEN IFNULL(s.is_valid,1) <> 0 THEN s.plate_text END) AS unique_plates
FROM users u
LEFT JOIN submissions s ON s.tg_id = u.tg_id
LEFT JOIN bonuses b ON b.tg_id = u.tg_id
GROUP BY u.tg_id, u.username, u.first_name, u.last_name
ORDER BY total_points DESC, unique_plates DESC;

CREATE INDEX IF NOT EXISTS idx_submissions_game_day ON submissions (game_id, created_at);
CREATE INDEX IF NOT EXISTS idx_submissions_tg ON submissions (tg_id);

CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  count INTEGER NOT NULL DEFAULT 0,
  reset_at TEXT NOT NULL
);
