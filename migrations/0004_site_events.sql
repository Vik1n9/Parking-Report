CREATE TABLE site_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL DEFAULT 1 REFERENCES sites (id),
  business_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('guiding', 'jam', 'special')),
  zone_code TEXT,
  occurred_at TEXT NOT NULL,
  cleared_at TEXT,
  detail TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX idx_site_events_date ON site_events (site_id, business_date, occurred_at);
