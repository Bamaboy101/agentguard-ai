CREATE TABLE IF NOT EXISTS services (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  expected_interval_s INTEGER NOT NULL,
  last_seen_utc TEXT,
  last_success_utc TEXT,
  state TEXT NOT NULL DEFAULT 'healthy',
  demo INTEGER DEFAULT 1
);

CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  run_id TEXT,
  event_utc TEXT NOT NULL,
  type TEXT NOT NULL,
  duration_ms INTEGER
);

CREATE TABLE IF NOT EXISTS incidents (
  id TEXT PRIMARY KEY,
  service_id TEXT NOT NULL,
  rule TEXT NOT NULL,
  severity TEXT NOT NULL,
  first_seen_utc TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open'
);

CREATE TABLE IF NOT EXISTS actions (
  id TEXT PRIMARY KEY,
  incident_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  approved_utc TEXT NOT NULL,
  audit_note TEXT
);

INSERT OR IGNORE INTO services (id, name, expected_interval_s, state, demo) VALUES
  ('svc-demo-web', 'demo-web', 30, 'healthy', 1),
  ('svc-demo-worker', 'demo-worker', 60, 'healthy', 1);
