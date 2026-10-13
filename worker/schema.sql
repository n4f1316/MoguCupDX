-- もぐらたたきカップ用 D1 テーブル
CREATE TABLE IF NOT EXISTS entries (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  entry_name TEXT NOT NULL,
  x_id       TEXT NOT NULL,
  rating     INTEGER NOT NULL,
  frate      REAL NOT NULL,
  memo       TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS entries_name ON entries (entry_name COLLATE NOCASE);
CREATE UNIQUE INDEX IF NOT EXISTS entries_x ON entries (x_id COLLATE NOCASE);

-- 大会設定（settings）と組み合わせ（matches）を JSON で保存
CREATE TABLE IF NOT EXISTS kv (
  key        TEXT PRIMARY KEY,
  value      TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
