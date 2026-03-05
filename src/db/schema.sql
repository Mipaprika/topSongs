CREATE TABLE IF NOT EXISTS recommendation_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_date TEXT NOT NULL UNIQUE,
  selected_count INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS recommendation_run_songs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  song_id TEXT NOT NULL,
  score REAL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  FOREIGN KEY (run_id) REFERENCES recommendation_runs(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS douban_baseline_songs (
  song_id TEXT PRIMARY KEY,
  artist TEXT NOT NULL,
  tags TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);

CREATE TABLE IF NOT EXISTS netease_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL UNIQUE,
  event_id TEXT NOT NULL,
  song_id TEXT NOT NULL,
  action_type TEXT NOT NULL,
  action_time INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
);
