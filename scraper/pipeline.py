"""The whole scrape -> extract -> store -> cluster run, safe to repeat any number of times."""
from __future__ import annotations

import json
import logging
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from typing import Callable, Optional

from .clustering import ArticleRecord, cluster_articles
from .config import Settings
from .database import Database, from_db, to_iso
from .fetcher import FeedError, build_session, fetch_article_body, fetch_feed
from .models import Article
from .normalize import normalize_entry

log = logging.getLogger("newspulse.pipeline")


class PipelineError(RuntimeError):
    """The run could not do its job at all (e.g. every feed failed)."""


def load_feeds(settings: Settings) -> list[dict]:
    try:
        raw = json.loads(settings.feeds_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as exc:
        raise PipelineError(f"cannot read feeds file {settings.feeds_file}: {exc}") from exc
    feeds = [f for f in raw if f.get("enabled", True) and f.get("name") and f.get("url")]
    if not feeds:
        raise PipelineError("no enabled feeds configured")
    return feeds


def _stage(name: str) -> None:
    # The Node API parses lines starting with "STAGE:" to show progress in the UI.
    print(f"STAGE:{name}", flush=True)


# --------------------------------------------------------------------------
# steps
# --------------------------------------------------------------------------
def prune_old(db: Database, settings: Settings, now: datetime) -> int:
    cutoff = to_iso(now - timedelta(days=settings.retain_days))
    return max(db.execute("DELETE FROM articles WHERE published_at < ?", (cutoff,)), 0)


def collect_new_articles(db: Database, settings: Settings, now: datetime, stats: dict) -> list[Article]:
    """Download every feed, normalise entries, drop what we already have."""
    known_urls = {r["url_hash"] for r in db.query("SELECT url_hash FROM articles")}
    known_titles = {(r["source"], r["title_hash"]) for r in db.query("SELECT source, title_hash FROM articles")}
    cutoff = now - timedelta(days=settings.retain_days)
    session = build_session(settings)
    fresh: list[Article] = []
    stats["feeds"] = {}

    for feed in load_feeds(settings):
        name = feed["name"]
        info = {"status": "ok", "entries": 0, "new": 0, "invalid": 0, "duplicates": 0, "stale": 0}
        stats["feeds"][name] = info
        try:
            entries = fetch_feed(session, feed["url"], settings)
        except FeedError as exc:
            info.update(status="error", error=str(exc)[:300])
            log.warning("feed %s failed: %s", name, exc)
            continue
        info["entries"] = len(entries)
        for entry in entries:
            article = normalize_entry(entry, name, now)
            if article is None:
                info["invalid"] += 1
                continue
            key_title = (name, article.title_hash)
            if article.url_hash in known_urls or key_title in known_titles:
                info["duplicates"] += 1
                continue
            if article.published_at < cutoff:
                info["stale"] += 1
                continue
            known_urls.add(article.url_hash)
            known_titles.add(key_title)
            fresh.append(article)
            info["new"] += 1
        log.info("%s: %d entries, %d new", name, info["entries"], info["new"])

    if all(f["status"] == "error" for f in stats["feeds"].values()):
        raise PipelineError("every feed failed: " + "; ".join(
            f"{n}: {f.get('error', '?')}" for n, f in stats["feeds"].items()))
    return fresh


def extract_bodies(articles: list[Article], settings: Settings, stats: dict) -> None:
    """Fetch full article pages concurrently; a failed page never fails the run."""
    ok = failed = 0
    if not settings.fetch_full_text:
        for a in articles:
            a.content_status = "skipped"
    else:
        session = build_session(settings)

        def work(article: Article) -> None:
            text, status = fetch_article_body(session, article.url, settings)
            if status == "ok":
                article.content, article.content_status = text, "ok"
            elif article.feed_body:                         # feed already carried a body
                article.content, article.content_status = article.feed_body, "feed"
            else:
                article.content, article.content_status = "", "failed"

        with ThreadPoolExecutor(max_workers=settings.max_workers) as pool:
            list(pool.map(work, articles))
        ok = sum(1 for a in articles if a.content_status in {"ok", "feed"})
        failed = sum(1 for a in articles if a.content_status == "failed")
    stats["bodies_extracted"], stats["bodies_failed"] = ok, failed


def store_articles(db: Database, articles: list[Article], now: datetime) -> int:
    inserted = 0
    fetched = to_iso(now)
    with db.transaction():
        for a in articles:
            inserted += max(db.execute(
                """INSERT INTO articles
                   (url_hash, title_hash, source, guid, url, title, summary, content,
                    content_status, published_at, published_estimated, fetched_at)
                   VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
                   ON CONFLICT DO NOTHING""",
                (a.url_hash, a.title_hash, a.source, a.guid, a.url, a.title, a.summary,
                 a.content, a.content_status, to_iso(a.published_at), int(a.published_estimated), fetched),
            ), 0)
    return inserted


def recluster(db: Database, settings: Settings, now: datetime) -> dict:
    """Re-group every retained article and rewrite the cluster tables atomically."""
    rows = db.query(
        "SELECT id, source, title, summary, content, published_at FROM articles "
        "ORDER BY published_at DESC, id DESC LIMIT ?", (settings.cluster_max_articles,))
    records = [ArticleRecord(r["id"], r["source"], r["title"], r["summary"], r["content"],
                             from_db(r["published_at"])) for r in rows]
    result = cluster_articles(records, settings)

    cluster_rows = [(c.id, c.label, json.dumps(c.keywords), next(r.title for r in records if r.id == c.representative_id),
                     c.method, to_iso(now)) for c in result.clusters]
    assignments = [(c.id, result.story_ids.get(aid), aid) for c in result.clusters for aid in c.article_ids]

    with db.transaction():
        db.execute("UPDATE articles SET cluster_id = NULL, story_id = NULL")
        db.execute("DELETE FROM clusters")
        db.executemany("INSERT INTO clusters (id, label, keywords, representative_title, method, updated_at) "
                       "VALUES (?,?,?,?,?,?)", cluster_rows)
        db.executemany("UPDATE articles SET cluster_id = ?, story_id = ? WHERE id = ?", assignments)

    multi = sum(1 for c in result.clusters if len(c.article_ids) > 1)
    stories = len({s for s in result.story_ids.values() if s is not None})
    return {"articles_clustered": len(records), "clusters": len(result.clusters),
            "multi_article_clusters": multi, "cross_source_stories": stories}


# --------------------------------------------------------------------------
# orchestration
# --------------------------------------------------------------------------
def run_pipeline(settings: Optional[Settings] = None, *, recluster_only: bool = False,
                 db: Optional[Database] = None, now: Optional[datetime] = None) -> dict:
    settings = settings or Settings.from_env()
    now = now or datetime.now(timezone.utc)
    started = time.time()
    own_db = db is None
    db = db or Database(settings)
    db.connect()
    stats: dict = {"method": settings.cluster_method, "database": db.dialect}
    try:
        db.init_schema()
        stats["pruned"] = prune_old(db, settings, now)
        if not recluster_only:
            _stage("fetching feeds")
            new_articles = collect_new_articles(db, settings, now, stats)
            stats["new_candidates"] = len(new_articles)
            _stage(f"reading {len(new_articles)} new articles")
            extract_bodies(new_articles, settings, stats)
            stats["new_articles"] = store_articles(db, new_articles, now)
        _stage("grouping topics")
        stats.update(recluster(db, settings, now))
        stats["total_articles"] = db.query("SELECT COUNT(*) AS n FROM articles")[0]["n"]
        stats["duration_seconds"] = round(time.time() - started, 2)
        return stats
    finally:
        if own_db:
            db.close()
