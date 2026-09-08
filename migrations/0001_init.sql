CREATE TABLE sites (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  tower_total INTEGER NOT NULL DEFAULT 1600
);

CREATE TABLE zones (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL DEFAULT 1 REFERENCES sites (id),
  code TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  excel_label TEXT NOT NULL,
  position INTEGER NOT NULL,
  is_car INTEGER NOT NULL DEFAULT 0,
  in_tower INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE guard_devices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  revoked_at TEXT
);

CREATE TABLE reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL DEFAULT 1 REFERENCES sites (id),
  device_id INTEGER REFERENCES guard_devices (id),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'confirmed', 'rejected')),
  client_request_id TEXT NOT NULL,
  tokens_json TEXT NOT NULL,
  raw_input TEXT,
  business_date TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  confirmed_at TEXT,
  supersedes_report_id INTEGER REFERENCES reports (id),
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (site_id, client_request_id)
);

CREATE TABLE records (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  report_id INTEGER NOT NULL UNIQUE REFERENCES reports (id),
  site_id INTEGER NOT NULL DEFAULT 1 REFERENCES sites (id),
  business_date TEXT NOT NULL,
  tokens_json TEXT NOT NULL,
  line_report TEXT NOT NULL,
  control_report TEXT,
  excel_values TEXT,
  tower_usage_pct REAL,
  remarks_json TEXT,
  prepared_by TEXT NOT NULL,
  report_time TEXT NOT NULL,
  confirmed_at TEXT NOT NULL
);

CREATE INDEX idx_reports_status ON reports (site_id, status, submitted_at);
CREATE INDEX idx_records_date ON records (site_id, business_date);
