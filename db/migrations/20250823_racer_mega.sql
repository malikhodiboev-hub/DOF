-- db/migrations/20250823_racer_mega.sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA foreign_keys=ON;

-- safe add columns (if not present)
-- (SQLite doesn't support IF NOT EXISTS for columns; assume previous pack created tables)

-- seasons
CREATE TABLE IF NOT EXISTS racer_seasons(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT,
  is_active INTEGER DEFAULT 1,
  started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  ended_at DATETIME
);
CREATE TABLE IF NOT EXISTS racer_season_scores(
  season_id INTEGER NOT NULL,
  tg_id INTEGER NOT NULL,
  exp INTEGER DEFAULT 0,
  coins INTEGER DEFAULT 0,
  PRIMARY KEY(season_id, tg_id)
);

-- skins
CREATE TABLE IF NOT EXISTS racer_skins_store(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT UNIQUE,
  title TEXT,
  cost_plate INTEGER DEFAULT 50
);
CREATE TABLE IF NOT EXISTS racer_skins_user(
  tg_id INTEGER NOT NULL,
  skin_code TEXT NOT NULL,
  PRIMARY KEY(tg_id, skin_code)
);
