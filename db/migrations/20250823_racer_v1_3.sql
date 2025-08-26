-- 20250823_racer_v1_3.sql (PvP + energy + tx) — idempotent
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS racer_tx(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('earn','spend')),
  amount INTEGER NOT NULL,
  reason TEXT,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_racer_tx_tg ON racer_tx(tg_id);

CREATE TABLE IF NOT EXISTS racer_garage(
  tg_id INTEGER NOT NULL,
  car_id TEXT NOT NULL,
  level INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY(tg_id, car_id)
);

CREATE TABLE IF NOT EXISTS racer_races(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id INTEGER NOT NULL,
  opponent_tg_id INTEGER,
  car_id TEXT NOT NULL,
  result TEXT NOT NULL CHECK(result IN ('win','lose','draw')),
  points_delta INTEGER NOT NULL DEFAULT 0,
  ts DATETIME DEFAULT CURRENT_TIMESTAMP,
  replay TEXT
);
CREATE INDEX IF NOT EXISTS idx_racer_races_tg ON racer_races(tg_id);

CREATE TABLE IF NOT EXISTS racer_energy(
  tg_id INTEGER PRIMARY KEY,
  value INTEGER NOT NULL DEFAULT 5,
  updated_ts DATETIME DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS racer_challenges(
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  from_tg INTEGER NOT NULL,
  to_tg INTEGER NOT NULL,
  car_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','declined','canceled','done')),
  created_ts DATETIME DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_racer_chal_to ON racer_challenges(to_tg, status);
CREATE INDEX IF NOT EXISTS idx_racer_chal_from ON racer_challenges(from_tg, status);