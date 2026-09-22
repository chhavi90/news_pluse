-- News Pulse schema (PostgreSQL dialect). Safe to run repeatedly.
CREATE TABLE IF NOT EXISTS articles (
  id                  SERIAL PRIMARY KEY,
  url_hash            TEXT        NOT NULL UNIQUE,
  title_hash          TEXT        NOT NULL,
  source              TEXT        NOT NULL,
  guid                TEXT,
  url                 TEXT        NOT NULL,
  title               TEXT        NOT NULL,
  summary             TEXT        NOT NULL DEFAULT '',
  content             TEXT        NOT NULL DEFAULT '',
  content_status      TEXT        NOT NULL DEFAULT 'skipped',
  published_at        TIMESTAMPTZ NOT NULL,
  published_estimated INTEGER     NOT NULL DEFAULT 0,
  fetched_at          TIMESTAMPTZ NOT NULL,
  cluster_id          INTEGER,
  story_id            INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_articles_source_title ON articles (source, title_hash);
CREATE INDEX IF NOT EXISTS idx_articles_cluster   ON articles (cluster_id);
CREATE INDEX IF NOT EXISTS idx_articles_published ON articles (published_at);
CREATE INDEX IF NOT EXISTS idx_articles_source    ON articles (source);
CREATE INDEX IF NOT EXISTS idx_articles_story     ON articles (story_id);

CREATE TABLE IF NOT EXISTS clusters (
  id                   INTEGER     PRIMARY KEY,
  label                TEXT        NOT NULL,
  keywords             TEXT        NOT NULL DEFAULT '[]',
  representative_title TEXT        NOT NULL DEFAULT '',
  method               TEXT        NOT NULL,
  updated_at           TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS jobs (
  id          TEXT PRIMARY KEY,
  status      TEXT        NOT NULL,
  stage       TEXT,
  created_at  TIMESTAMPTZ NOT NULL,
  started_at  TIMESTAMPTZ,
  finished_at TIMESTAMPTZ,
  stats       TEXT,
  error       TEXT,
  log_tail    TEXT
);
CREATE INDEX IF NOT EXISTS idx_jobs_created ON jobs (created_at);
