-- News Pulse schema (SQLite dialect). Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS articles (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  url_hash            TEXT    NOT NULL UNIQUE,      -- sha256 of canonical URL (dedupe key #1)
  title_hash          TEXT    NOT NULL,             -- sha256 of normalised headline (dedupe key #2)
  source              TEXT    NOT NULL,             -- outlet name, e.g. "BBC News"
  guid                TEXT,
  url                 TEXT    NOT NULL,
  title               TEXT    NOT NULL,
  summary             TEXT    NOT NULL DEFAULT '',
  content             TEXT    NOT NULL DEFAULT '',  -- extracted full body text (may be empty)
  content_status      TEXT    NOT NULL DEFAULT 'skipped',  -- ok | feed | failed | skipped
  published_at        TEXT    NOT NULL,             -- ISO-8601 UTC, e.g. 2026-09-20T10:15:00Z
  published_estimated INTEGER NOT NULL DEFAULT 0,   -- 1 when the feed had no usable date
  fetched_at          TEXT    NOT NULL,
  cluster_id          INTEGER,                      -- -> clusters.id (NULL = not clustered yet)
  story_id            INTEGER                       -- same real-world story across outlets
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_source_title ON articles (source, title_hash);
CREATE INDEX IF NOT EXISTS idx_articles_cluster   ON articles (cluster_id);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles (published_at);
CREATE INDEX IF NOT EXISTS idx_articles_source    ON articles (source);
CREATE INDEX IF NOT EXISTS idx_articles_story     ON articles (story_id);

CREATE TABLE IF NOT EXISTS clusters (
  id                   INTEGER PRIMARY KEY,         -- = smallest article id in the cluster (stable-ish)
  label                TEXT    NOT NULL,
  keywords             TEXT    NOT NULL DEFAULT '[]',   -- JSON array of strings
  representative_title TEXT    NOT NULL DEFAULT '',
  method               TEXT    NOT NULL,            -- tfidf | keyword
  updated_at           TEXT    NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,                     -- UUID returned by POST /ingest/trigger
  status      TEXT NOT NULL,                        -- queued | running | succeeded | failed
  stage       TEXT,
  created_at  TEXT NOT NULL,
  started_at  TEXT,
  finished_at TEXT,
  stats       TEXT,                                 -- JSON summary from the Python pipeline
  error       TEXT,
  log_tail    TEXT                                  -- JSON array with the last log lines
);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at);
