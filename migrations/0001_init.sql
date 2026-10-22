-- Movements you have confirmed by opening a watch (movement -> battery). Grows over time.
CREATE TABLE IF NOT EXISTS movements (
  maker TEXT NOT NULL DEFAULT '',
  calibre_norm TEXT NOT NULL,
  calibre TEXT NOT NULL,
  movement_type TEXT,
  battery TEXT,
  confirmations INTEGER NOT NULL DEFAULT 0,
  history TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (maker, calibre_norm)
);

-- Watches you have confirmed after opening (watch -> movement -> battery).
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  brand TEXT,
  model TEXT,
  reference TEXT,
  reference_norm TEXT,
  caseback_code TEXT,
  caseback_norm TEXT,
  calibre TEXT,
  calibre_norm TEXT,
  maker TEXT,
  movement_type TEXT,
  battery TEXT,
  case_mm REAL,
  owner TEXT,
  notes TEXT,
  thumbnail TEXT,
  lookup_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS watches_reference ON watches (reference_norm);
CREATE INDEX IF NOT EXISTS watches_caseback ON watches (caseback_norm);
CREATE INDEX IF NOT EXISTS watches_calibre ON watches (calibre_norm);

-- Every identification you run. "pending" ones make up the battery shopping list.
CREATE TABLE IF NOT EXISTS lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  owner TEXT,
  status TEXT NOT NULL DEFAULT 'pending', -- pending | done | dismissed
  battery TEXT,
  summary TEXT,
  result TEXT NOT NULL,
  thumbnail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS lookups_status ON lookups (status, created_at);

-- Cached web search evidence, so the same movement doesn't burn search quota twice.
CREATE TABLE IF NOT EXISTS web_cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
