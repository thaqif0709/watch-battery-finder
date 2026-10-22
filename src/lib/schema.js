// Database tables, created on first use so a fresh deploy needs no migration step.
// Keep in sync with migrations/0001_init.sql (which the wrangler CLI path uses).
const SCHEMA = `
CREATE TABLE IF NOT EXISTS movements (
  maker TEXT NOT NULL DEFAULT '', calibre_norm TEXT NOT NULL, calibre TEXT NOT NULL, movement_type TEXT, battery TEXT,
  confirmations INTEGER NOT NULL DEFAULT 0, history TEXT NOT NULL DEFAULT '[]', updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (maker, calibre_norm)
);
CREATE TABLE IF NOT EXISTS watches (
  id INTEGER PRIMARY KEY AUTOINCREMENT, brand TEXT, model TEXT, reference TEXT, reference_norm TEXT, caseback_code TEXT,
  caseback_norm TEXT, calibre TEXT, calibre_norm TEXT, maker TEXT, movement_type TEXT, battery TEXT, case_mm REAL,
  owner TEXT, notes TEXT, thumbnail TEXT, lookup_id INTEGER, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS watches_reference ON watches (reference_norm);
CREATE INDEX IF NOT EXISTS watches_caseback ON watches (caseback_norm);
CREATE INDEX IF NOT EXISTS watches_calibre ON watches (calibre_norm);
CREATE TABLE IF NOT EXISTS lookups (
  id INTEGER PRIMARY KEY AUTOINCREMENT, owner TEXT, status TEXT NOT NULL DEFAULT 'pending', battery TEXT, summary TEXT,
  result TEXT NOT NULL, thumbnail TEXT, created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS lookups_status ON lookups (status, created_at);
CREATE TABLE IF NOT EXISTS web_cache (key TEXT PRIMARY KEY, value TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT (datetime('now')))
`;

let ready = null;

export function ensureSchema(db) {
  ready ??= db
    .batch(SCHEMA.split(';').map((s) => s.trim()).filter(Boolean).map((s) => db.prepare(s)))
    .catch((e) => {
      ready = null;
      throw e;
    });
  return ready;
}
