CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  agent TEXT NOT NULL,
  provider_session_id TEXT NOT NULL,
  session_name TEXT,
  model TEXT,
  working_directory TEXT NOT NULL,
  summary TEXT NOT NULL,
  parent_session_id TEXT REFERENCES sessions(id),
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  ended_at TEXT,
  end_reason TEXT,
  status TEXT CHECK(status IS NULL OR status IN ('working', 'blocked', 'handoff', 'done')),
  pinned INTEGER NOT NULL DEFAULT 0 CHECK(pinned IN (0, 1)),
  UNIQUE(provider, provider_session_id),
  CHECK(parent_session_id IS NULL OR parent_session_id <> id)
);
CREATE INDEX idx_sessions_updated ON sessions(updated_at DESC, id DESC);
CREATE INDEX idx_sessions_parent ON sessions(parent_session_id);
CREATE TABLE session_updates (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
  sequence INTEGER NOT NULL CHECK(sequence > 0),
  summary TEXT NOT NULL,
  created_at TEXT NOT NULL,
  status TEXT CHECK(status IS NULL OR status IN ('working', 'blocked', 'handoff', 'done')),
  UNIQUE(session_id, sequence)
);
CREATE TABLE notes (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK(kind IN ('folder', 'note')),
  parent_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  CHECK(parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_notes_parent ON notes(parent_id);
CREATE TABLE notes_meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO notes_meta (key, value) VALUES ('revision', 0);
