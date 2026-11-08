-- 預設角色帳號、session、登入限速；回報單加入隊長複核狀態與欄位。
-- 裝置 token 作廢：guard_devices 保留表，清空所有列。
-- 時間戳一律 UTC ISO，由程式寫入。

-- D1 預設開啟外鍵；records.report_id 指向 reports，重建表要延後到 transaction 結束才檢查。
PRAGMA defer_foreign_keys = on;

CREATE TABLE users (
  username TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('admin', 'console', 'secretary', 'captain', 'patrol', 'manager')),
  post_code TEXT,
  password_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'disabled')),
  must_change_pw INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  last_login_at TEXT
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  username TEXT NOT NULL REFERENCES users (username),
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX idx_sessions_expires ON sessions (expires_at);

CREATE TABLE login_attempts (
  key TEXT PRIMARY KEY,
  fails INTEGER NOT NULL DEFAULT 0,
  locked_until TEXT,
  updated_at TEXT
);

-- SQLite 的 CHECK 不能就地修改：重建 reports，保留所有舊欄位與資料，
-- status 加上 awaiting_captain（車巡上傳後等隊長複核）。
CREATE TABLE reports_new (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  site_id INTEGER NOT NULL DEFAULT 1 REFERENCES sites (id),
  device_id INTEGER,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('awaiting_captain', 'pending', 'confirmed', 'rejected')),
  client_request_id TEXT NOT NULL,
  values_json TEXT NOT NULL,
  raw_input TEXT,
  business_date TEXT NOT NULL,
  submitted_at TEXT NOT NULL,
  confirmed_at TEXT,
  supersedes_report_id INTEGER REFERENCES reports_new (id),
  reject_reason TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  submitted_by TEXT,
  reviewed_values_json TEXT,
  review_corrections_json TEXT,
  reviewed_by TEXT,
  reviewed_at TEXT,
  UNIQUE (site_id, client_request_id)
);

INSERT INTO reports_new
  (id, site_id, device_id, status, client_request_id, values_json, raw_input,
   business_date, submitted_at, confirmed_at, supersedes_report_id, reject_reason, created_at)
SELECT
  id, site_id, device_id, status, client_request_id, values_json, raw_input,
  business_date, submitted_at, confirmed_at, supersedes_report_id, reject_reason, created_at
FROM reports;

DROP TABLE reports;
ALTER TABLE reports_new RENAME TO reports;

CREATE INDEX idx_reports_status ON reports (site_id, status, submitted_at);

ALTER TABLE records ADD COLUMN captain_corrections_json TEXT;

DELETE FROM guard_devices;
