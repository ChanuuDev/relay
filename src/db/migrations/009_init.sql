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
  position REAL,
  CHECK(parent_id IS NULL OR parent_id <> id)
);
CREATE INDEX idx_notes_parent ON notes(parent_id);
CREATE TABLE notes_meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO notes_meta (key, value) VALUES ('revision', 0);
CREATE TABLE calculations (
  id TEXT PRIMARY KEY,
  expression TEXT NOT NULL,
  result TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX idx_calculations_created ON calculations(created_at DESC, id DESC);
CREATE TABLE note_images (
  id TEXT PRIMARY KEY CHECK(length(id) = 64),
  type TEXT NOT NULL,
  size INTEGER NOT NULL,
  data BLOB NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  project TEXT NOT NULL DEFAULT '',
  memo TEXT NOT NULL DEFAULT '',
  provider TEXT CHECK(provider IS NULL OR provider IN ('anthropic', 'openai', 'xai', 'cursor')),
  status TEXT NOT NULL CHECK(status IN ('todo', 'doing', 'review', 'done')),
  board INTEGER NOT NULL DEFAULT 0 CHECK(board IN (0, 1)),
  position REAL,
  notes_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  completed_at INTEGER,
  revision INTEGER NOT NULL
);
CREATE TABLE calendar_events (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL DEFAULT '',
  all_day INTEGER NOT NULL CHECK(all_day IN (0, 1)),
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  memo TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  attachments_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  revision INTEGER NOT NULL,
  CHECK(end_at >= start_at)
);
CREATE INDEX idx_calendar_events_start ON calendar_events(start_at);
CREATE TABLE planner_meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO planner_meta (key, value) VALUES ('revision', 0);
CREATE TABLE activity_log (
  id INTEGER PRIMARY KEY,
  session_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  agent TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_activity_log_created ON activity_log(created_at);
INSERT INTO activity_log (session_id, provider, agent, created_at)
  SELECT u.session_id, s.provider, s.agent, u.created_at FROM session_updates u JOIN sessions s ON s.id = u.session_id
  WHERE u.summary <> '세션 첫 기록 (훅 자동 기록)' ORDER BY u.created_at, u.id;
CREATE TRIGGER session_updates_activity AFTER INSERT ON session_updates
WHEN NEW.summary <> '세션 첫 기록 (훅 자동 기록)'
BEGIN
  INSERT INTO activity_log (session_id, provider, agent, created_at)
    SELECT NEW.session_id, provider, agent, NEW.created_at FROM sessions WHERE id = NEW.session_id;
END;
