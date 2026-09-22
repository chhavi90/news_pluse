"""Runtime configuration for the News Pulse pipeline.

Everything is driven by environment variables (optionally loaded from
``scraper/.env``) so that no URLs or secrets are hard-coded.
"""
from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path

from dotenv import load_dotenv

PACKAGE_DIR = Path(__file__).resolve().parent
ROOT = PACKAGE_DIR.parent

# Real environment variables always win over the .env file.
load_dotenv(PACKAGE_DIR / ".env")


def _get(name: str, default: str = "") -> str:
    value = os.getenv(name)
    return default if value is None or value.strip() == "" else value.strip()


def _int(name: str, default: int) -> int:
    try:
        return int(_get(name, str(default)))
    except ValueError:
        return default


def _float(name: str, default: float) -> float:
    try:
        return float(_get(name, str(default)))
    except ValueError:
        return default


def _bool(name: str, default: bool) -> bool:
    raw = os.getenv(name)
    if raw is None or raw.strip() == "":
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def _resolve(value: str, default: Path) -> Path:
    if not value:
        return default
    path = Path(value)
    return path if path.is_absolute() else (ROOT / path).resolve()


BROWSER_UA = (
    "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) "
    "Chrome/124.0 Safari/537.36 NewsPulse/1.0"
)


@dataclass
class Settings:
    # storage
    database_url: str = ""
    sqlite_path: Path = ROOT / "data" / "newspulse.db"
    # sources / extraction
    feeds_file: Path = PACKAGE_DIR / "feeds.json"
    max_items_per_feed: int = 40
    fetch_full_text: bool = True
    request_timeout: float = 12.0
    max_workers: int = 8
    user_agent: str = BROWSER_UA
    min_body_chars: int = 200
    max_body_chars: int = 30000
    retain_days: int = 7
    # clustering
    cluster_method: str = "tfidf"          # "tfidf" | "keyword"
    similarity_threshold: float = 0.20     # tfidf: average-linkage cosine similarity
    max_gap_hours: float = 48.0            # never merge articles further apart than this
    keyword_min_shared: int = 3            # keyword: shared meaningful words
    keyword_min_jaccard: float = 0.10
    story_similarity_threshold: float = 0.40
    story_max_gap_hours: float = 36.0
    cluster_max_articles: int = 2000
    body_chars_for_vectors: int = 1000
    extra: dict = field(default_factory=dict)

    @classmethod
    def from_env(cls) -> "Settings":
        method = _get("CLUSTER_METHOD", "tfidf").lower()
        if method not in {"tfidf", "keyword"}:
            method = "tfidf"
        return cls(
            database_url=_get("DATABASE_URL"),
            sqlite_path=_resolve(_get("SQLITE_PATH"), ROOT / "data" / "newspulse.db"),
            feeds_file=_resolve(_get("FEEDS_FILE"), PACKAGE_DIR / "feeds.json"),
            max_items_per_feed=_int("MAX_ITEMS_PER_FEED", 40),
            fetch_full_text=_bool("FETCH_FULL_TEXT", True),
            request_timeout=_float("REQUEST_TIMEOUT", 12.0),
            max_workers=max(1, _int("MAX_WORKERS", 8)),
            user_agent=_get("USER_AGENT", BROWSER_UA),
            retain_days=max(1, _int("RETAIN_DAYS", 7)),
            cluster_method=method,
            similarity_threshold=_float("SIMILARITY_THRESHOLD", 0.20),
            max_gap_hours=_float("MAX_GAP_HOURS", 48.0),
            keyword_min_shared=_int("KEYWORD_MIN_SHARED", 3),
            keyword_min_jaccard=_float("KEYWORD_MIN_JACCARD", 0.10),
            story_similarity_threshold=_float("STORY_SIMILARITY_THRESHOLD", 0.40),
            story_max_gap_hours=_float("STORY_MAX_GAP_HOURS", 36.0),
            cluster_max_articles=_int("CLUSTER_MAX_ARTICLES", 2000),
            body_chars_for_vectors=_int("BODY_CHARS_FOR_VECTORS", 1000),
        )
