-- Mobile-version waitlist. One row per email.
CREATE TABLE IF NOT EXISTS waitlist (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  email      TEXT NOT NULL UNIQUE,
  platform   TEXT NOT NULL DEFAULT '',          -- 'android', 'ios' or ''
  source     TEXT NOT NULL DEFAULT 'website',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS waitlist_created ON waitlist (created_at);
