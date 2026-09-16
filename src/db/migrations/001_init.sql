CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  agent TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  session_name TEXT,
  model TEXT,
  working_directory TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('ACTIVE', 'INTERRUPTED', 'COMPLETED', 'ABANDONED')),
  summary TEXT NOT NULL,
  parent_session_id TEXT REFERENCES sessions(id),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  UNIQUE(provider, provider_session_id),
  CHECK(parent_session_id IS NULL OR parent_session_id <> id),
  CHECK((status = 'ACTIVE' AND ended_at IS NULL) OR (status <> 'ACTIVE' AND ended_at IS NOT NULL))
);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC, id DESC);
CREATE INDEX idx_sessions_status_updated ON sessions(status, updated_at DESC, id DESC);
CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
CREATE TABLE session_updates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  type TEXT NOT NULL CHECK(type IN ('START', 'PROGRESS', 'END')),
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(session_id, sequence)
);
