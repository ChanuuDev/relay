CREATE TABLE note_meta (
  note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  doc_type TEXT NOT NULL DEFAULT 'memo' CHECK(doc_type IN ('memo', 'knowledge', 'design', 'decision')),
  doc_status TEXT CHECK(doc_status IS NULL OR doc_status IN ('draft', 'adopted', 'superseded')),
  project TEXT NOT NULL DEFAULT '',
  source_repo TEXT,
  source_path TEXT,
  source_commit TEXT,
  superseded_by TEXT REFERENCES notes(id) ON DELETE SET NULL,
  updated_at INTEGER NOT NULL,
  CHECK(superseded_by IS NULL OR superseded_by <> note_id)
);
CREATE UNIQUE INDEX idx_note_meta_source ON note_meta(source_repo, source_path) WHERE source_repo IS NOT NULL AND source_path IS NOT NULL;
CREATE TABLE note_cards (
  note_id TEXT PRIMARY KEY REFERENCES notes(id) ON DELETE CASCADE,
  content_hash TEXT NOT NULL,
  summary TEXT NOT NULL,
  terms_json TEXT NOT NULL DEFAULT '[]',
  questions_json TEXT NOT NULL DEFAULT '[]',
  author TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);
CREATE TABLE embedding_models (
  model_key TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  dimensions INTEGER NOT NULL,
  prompt TEXT NOT NULL,
  chunk_version INTEGER NOT NULL,
  floor REAL NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0, 1)),
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX idx_embedding_models_active ON embedding_models(active) WHERE active = 1;
CREATE TABLE note_index (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  model_key TEXT NOT NULL REFERENCES embedding_models(model_key) ON DELETE CASCADE,
  input_hash TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  chunk_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('ready', 'failed', 'pending')),
  error TEXT,
  attempts INTEGER NOT NULL DEFAULT 0,
  retry_at INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT,
  lease_until INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (note_id, model_key)
);
CREATE INDEX idx_note_index_model ON note_index(model_key);
CREATE TABLE note_chunks (
  note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  model_key TEXT NOT NULL REFERENCES embedding_models(model_key) ON DELETE CASCADE,
  chunk_index INTEGER NOT NULL,
  heading_path TEXT NOT NULL DEFAULT '',
  line_start INTEGER NOT NULL,
  line_end INTEGER NOT NULL,
  char_start INTEGER NOT NULL,
  char_end INTEGER NOT NULL,
  chunk_hash TEXT NOT NULL,
  token_count INTEGER NOT NULL,
  embedding BLOB NOT NULL,
  PRIMARY KEY (note_id, model_key, chunk_index)
);
CREATE INDEX idx_note_chunks_model ON note_chunks(model_key);
CREATE TABLE note_semantic_links (
  model_key TEXT NOT NULL REFERENCES embedding_models(model_key) ON DELETE CASCADE,
  source_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  target_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  score REAL NOT NULL,
  strength REAL NOT NULL,
  source_heading TEXT NOT NULL DEFAULT '',
  source_start INTEGER NOT NULL,
  source_end INTEGER NOT NULL,
  target_heading TEXT NOT NULL DEFAULT '',
  target_start INTEGER NOT NULL,
  target_end INTEGER NOT NULL,
  PRIMARY KEY (model_key, source_note_id, target_note_id),
  CHECK(source_note_id <> target_note_id)
);
CREATE INDEX idx_note_semantic_links_target ON note_semantic_links(model_key, target_note_id);
CREATE TABLE note_link_dismissals (
  a_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  b_note_id TEXT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  dismissed_at INTEGER NOT NULL,
  PRIMARY KEY (a_note_id, b_note_id),
  CHECK(a_note_id < b_note_id)
);
CREATE TABLE note_index_meta (
  key TEXT PRIMARY KEY,
  value INTEGER NOT NULL
);
INSERT INTO note_index_meta (key, value) VALUES ('docs', 0), ('index', 0);
